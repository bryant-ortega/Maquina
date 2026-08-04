'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { sendDjRegistrationConfirmation } from '@/lib/email'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  checkRateLimit,
  formatRetryAfter,
  getClientIp,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/**
 * Server action for /register/dj.
 *
 * Flow (Phase Auth — email + password):
 *   1. Validate input (matches DJ table CHECK constraints).
 *   2. Refuse if a djs row already exists for this email — friendly
 *      message + link to /login.
 *   3. Create the auth user via the admin client with email_confirm:true,
 *      password set, and `roles: ['dj']` in user_metadata so the
 *      handle_new_user trigger marks the profile as a DJ.
 *   4. Insert the djs row directly via the admin client. We're past the
 *      magic-link callback dance — once the password is on file, the
 *      account is real.
 *   5. Sign the new user in via the SSR client (sets auth cookies on
 *      this response), then redirect to /dj/upload-w9 so they can finish
 *      onboarding. No email round-trip.
 *
 * Rate limited to 5 attempts / 15 min by IP — same tier as login, to
 * stop scripted account-creation spam. Checked before the "already
 * registered" DB lookup even runs.
 */

const RegisterDjInput = z.object({
  dj_name: z.string().trim().min(1, 'DJ name is required').max(100),
  government_name: z.string().trim().min(1, 'Legal name is required').max(200),
  email: z.string().trim().toLowerCase().max(254, 'Invalid email').email('Invalid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be 128 characters or fewer'),
  phone: z.string().trim().min(1, 'Phone is required').max(40),
  region: z.enum(['SoCal', 'NorCal', 'Chicago', 'Arizona', 'Seattle', 'Other', 'New York', 'Portland', 'Texas', 'Central Cal', 'Las Vegas']),
  pay_method: z.enum(['zelle', 'venmo', 'paypal'], { message: 'Pay method is required' }),
  pay_handle: z
    .string()
    .trim()
    .min(1, 'Pay handle is required')
    .max(120),
})

export type RegisterDjResult =
  | { ok: false; reason: 'invalid'; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: 'already_registered' }
  | { ok: false; reason: 'create_failed'; message: string }
  | { ok: false; reason: 'orphan_wrong_password' }
  | { ok: false; reason: 'orphan_wrong_role' }
  | { ok: false; reason: 'rate_limited'; message: string }
// On success the action redirects, so the form never sees an `ok: true`.

export async function registerDj(
  formData: FormData
): Promise<RegisterDjResult | never> {
  const ip = getClientIp(await headers())
  const ipLimit = await checkRateLimit(`register:ip:${ip}`, RATE_LIMITS.AUTH)
  if (!ipLimit.allowed) {
    return {
      ok: false,
      reason: 'rate_limited',
      message: `Too many registration attempts. Try again in ${formatRetryAfter(ipLimit.retryAfterSeconds)}.`,
    }
  }

  const raw = {
    dj_name: formData.get('dj_name'),
    government_name: formData.get('government_name'),
    email: formData.get('email'),
    password: formData.get('password'),
    phone: formData.get('phone'),
    region: formData.get('region'),
    pay_method: formData.get('pay_method'),
    pay_handle: formData.get('pay_handle'),
  }

  const parsed = RegisterDjInput.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const input = parsed.data

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Refuse duplicate DJ registration. We don't reveal whether a non-DJ
  // (admin/partner) exists with this email — that would leak the admin
  // roster.
  const { data: existing } = await admin
    .from('djs')
    .select('id')
    .eq('email', input.email)
    .maybeSingle()
  if (existing) {
    return { ok: false, reason: 'already_registered' }
  }

  // Create the auth user. email_confirm:true skips the verification email —
  // we trust the registration form because the immediately-following
  // password proves intent. (Email verification could be added later as a
  // soft "please confirm" UX, but it's not a hard auth requirement.)
  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        roles: ['dj'],
        display_name: input.dj_name,
      },
    })

  if (createErr || !created.user) {
    // Recovery branch: an auth user with this email exists but there's no
    // djs row (we already checked above). This happens when a DJ profile
    // was deleted but the orphaned auth user wasn't cleaned up. Try to
    // reclaim the account by signing in with the password they just typed.
    if (isEmailExistsError(createErr)) {
      return await reclaimOrphanAccount(input)
    }

    return {
      ok: false,
      reason: 'create_failed',
      message:
        createErr?.message ??
        'Could not create account. Try a different email.',
    }
  }

  // Insert the djs row. handle_new_user already wrote the profile row;
  // this writes the DJ-specific columns. RLS doesn't apply to the admin
  // client, so we don't need a policy here.
  const { error: djErr } = await admin.from('djs').insert({
    user_id: created.user.id,
    dj_name: input.dj_name,
    government_name: input.government_name,
    email: input.email,
    phone: input.phone,
    pay_method: input.pay_method,
    pay_handle: input.pay_handle,
    region: input.region,
  })
  if (djErr) {
    // Best-effort cleanup of the half-created auth user so the same email
    // can be retried.
    await admin.auth.admin.deleteUser(created.user.id)
    // Log the real Postgres error server-side (constraint/column names
    // aren't secret, but this is a public, unauthenticated endpoint —
    // no reason to hand a stranger raw DB error text instead of a
    // generic message).
    console.error('[register/dj] djs insert failed:', djErr.message)
    return {
      ok: false,
      reason: 'create_failed',
      message: 'Something went wrong creating your account. Please try again in a moment.',
    }
  }

  // Best-effort registration confirmation. Never blocks sign-in — the
  // email lib no-ops without RESEND_API_KEY and swallows its own errors.
  try {
    await sendDjRegistrationConfirmation({
      to: input.email,
      djName: input.dj_name,
    })
  } catch {
    // ignore — registration already succeeded
  }

  // Sign in via the SSR client so the response sets the session cookies.
  const supabase = await createServerSupabaseClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  })
  if (signInErr) {
    // Account is created — fall back to the login page rather than
    // surfacing this as a failure.
    redirect('/login')
  }

  redirect('/dj/upload-w9')
}

/**
 * True iff the createUser error indicates the email is already on file.
 * Supabase returns slightly different shapes across versions, so we check
 * the structured code, the HTTP status, and the message text as a fallback.
 */
function isEmailExistsError(err: { code?: string; status?: number; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'email_exists' || err.code === 'user_already_exists') return true
  if (err.status === 422) return true
  const m = (err.message ?? '').toLowerCase()
  return m.includes('already') && (m.includes('registered') || m.includes('exists'))
}

type RegisterDjInputT = z.infer<typeof RegisterDjInput>

/**
 * Recovery flow when an auth user already exists for this email but no
 * djs row does. We try to sign in with the password the user just typed
 * — if that works, they own the account and we can safely insert the
 * missing djs row.
 *
 * Refuses if:
 *   - Password doesn't match (could be a different person trying to claim)
 *   - The auth user's profile role is anything other than 'dj' (would
 *     overwrite an admin/partner account)
 */
async function reclaimOrphanAccount(
  input: RegisterDjInputT
): Promise<RegisterDjResult | never> {
  const supabase = await createServerSupabaseClient()
  const { data: signed, error: signInErr } =
    await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    })

  if (signInErr || !signed.user) {
    return { ok: false, reason: 'orphan_wrong_password' }
  }

  // Use the SSR client (now authenticated as the user) for the role check
  // and the writes — keeps types simple and lets RLS act as a backstop.
  // Make sure we're not about to attach DJ-shaped data to an admin/partner.
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('roles')
    .eq('user_id', signed.user.id)
    .maybeSingle()
  if (existingProfile?.roles && !existingProfile.roles.includes('dj')) {
    await supabase.auth.signOut()
    return { ok: false, reason: 'orphan_wrong_role' }
  }

  // Bring profile back in line with the new DJ identity (display_name +
  // role). The profile row was created by handle_new_user when the auth
  // user was originally registered, so update (not insert).
  await supabase
    .from('profiles')
    .update({ roles: ['dj'], display_name: input.dj_name })
    .eq('user_id', signed.user.id)

  // Insert the missing djs row.
  const { error: djErr } = await supabase.from('djs').insert({
    user_id: signed.user.id,
    dj_name: input.dj_name,
    government_name: input.government_name,
    email: input.email,
    phone: input.phone,
    pay_method: input.pay_method,
    pay_handle: input.pay_handle,
    region: input.region,
  })
  if (djErr) {
    console.error('[register/dj] djs insert failed (orphan reclaim):', djErr.message)
    return {
      ok: false,
      reason: 'create_failed',
      message: 'Something went wrong creating your account. Please try again in a moment.',
    }
  }

  try {
    await sendDjRegistrationConfirmation({
      to: input.email,
      djName: input.dj_name,
    })
  } catch {
    // ignore — account reclaim already succeeded
  }

  redirect('/dj/upload-w9')
}
