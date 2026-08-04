'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { sendVendorRegistrationConfirmation } from '@/lib/email'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  checkRateLimit,
  formatRetryAfter,
  getClientIp,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/**
 * Server action for /register/vendor.
 *
 * Flow mirrors registerDj almost verbatim — see register/dj/actions.ts
 * for the design notes. Differences:
 *   - Writes to `vendors` (not `djs`).
 *   - profile role = 'vendor'.
 *   - On success → /vendor/upload-w9.
 *   - "Already registered" is checked against `vendors`, not `djs`.
 *
 * Reusing the same orphan-account / wrong-role / wrong-password
 * recovery branches keeps the UX consistent across DJs and vendors.
 *
 * Same 5 attempts / 15 min IP rate limit as registerDj.
 */

const RegisterVendorInput = z.object({
  company_name: z.string().trim().min(1, 'Company name is required').max(200),
  contact_name: z.string().trim().min(1, 'Contact name is required').max(200),
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

export type RegisterVendorResult =
  | { ok: false; reason: 'invalid'; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: 'already_registered' }
  | { ok: false; reason: 'create_failed'; message: string }
  | { ok: false; reason: 'orphan_wrong_password' }
  | { ok: false; reason: 'orphan_wrong_role' }
  | { ok: false; reason: 'rate_limited'; message: string }
// Success path redirects, so the form never sees `ok: true`.

export async function registerVendor(
  formData: FormData
): Promise<RegisterVendorResult | never> {
  // Same `register:ip:*` bucket as registerDj — intentional. Otherwise
  // an attacker could get 5 DJ signups + 5 vendor signups from one IP
  // per window instead of 5 total.
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
    company_name: formData.get('company_name'),
    contact_name: formData.get('contact_name'),
    email: formData.get('email'),
    password: formData.get('password'),
    phone: formData.get('phone'),
    region: formData.get('region'),
    pay_method: formData.get('pay_method'),
    pay_handle: formData.get('pay_handle'),
  }

  const parsed = RegisterVendorInput.safeParse(raw)
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

  const { data: existing } = await admin
    .from('vendors')
    .select('id')
    .eq('email', input.email)
    .maybeSingle()
  if (existing) {
    return { ok: false, reason: 'already_registered' }
  }

  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        roles: ['vendor'],
        display_name: input.company_name,
      },
    })

  if (createErr || !created.user) {
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

  const { error: vendorErr } = await admin.from('vendors').insert({
    user_id: created.user.id,
    company_name: input.company_name,
    contact_name: input.contact_name,
    email: input.email,
    phone: input.phone,
    pay_method: input.pay_method,
    pay_handle: input.pay_handle,
    region: input.region,
  })
  if (vendorErr) {
    await admin.auth.admin.deleteUser(created.user.id)
    // Public, unauthenticated endpoint — log the real error server-side
    // rather than handing a stranger raw DB error text.
    console.error('[register/vendor] vendors insert failed:', vendorErr.message)
    return {
      ok: false,
      reason: 'create_failed',
      message: 'Something went wrong creating your account. Please try again in a moment.',
    }
  }

  // Best-effort registration confirmation (dormant-safe; never blocks).
  try {
    await sendVendorRegistrationConfirmation({
      to: input.email,
      companyName: input.company_name,
    })
  } catch {
    // ignore — registration already succeeded
  }

  const supabase = await createServerSupabaseClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  })
  if (signInErr) {
    redirect('/login')
  }

  redirect('/vendor/upload-w9')
}

function isEmailExistsError(
  err: { code?: string; status?: number; message?: string } | null
): boolean {
  if (!err) return false
  if (err.code === 'email_exists' || err.code === 'user_already_exists') return true
  if (err.status === 422) return true
  const m = (err.message ?? '').toLowerCase()
  return m.includes('already') && (m.includes('registered') || m.includes('exists'))
}

type RegisterVendorInputT = z.infer<typeof RegisterVendorInput>

async function reclaimOrphanAccount(
  input: RegisterVendorInputT
): Promise<RegisterVendorResult | never> {
  const supabase = await createServerSupabaseClient()
  const { data: signed, error: signInErr } =
    await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    })

  if (signInErr || !signed.user) {
    return { ok: false, reason: 'orphan_wrong_password' }
  }

  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('roles')
    .eq('user_id', signed.user.id)
    .maybeSingle()
  if (existingProfile?.roles && !existingProfile.roles.includes('vendor')) {
    await supabase.auth.signOut()
    return { ok: false, reason: 'orphan_wrong_role' }
  }

  await supabase
    .from('profiles')
    .update({ roles: ['vendor'], display_name: input.company_name })
    .eq('user_id', signed.user.id)

  const { error: vendorErr } = await supabase.from('vendors').insert({
    user_id: signed.user.id,
    company_name: input.company_name,
    contact_name: input.contact_name,
    email: input.email,
    phone: input.phone,
    pay_method: input.pay_method,
    pay_handle: input.pay_handle,
    region: input.region,
  })
  if (vendorErr) {
    console.error('[register/vendor] vendors insert failed (orphan reclaim):', vendorErr.message)
    return {
      ok: false,
      reason: 'create_failed',
      message: 'Something went wrong creating your account. Please try again in a moment.',
    }
  }

  try {
    await sendVendorRegistrationConfirmation({
      to: input.email,
      companyName: input.company_name,
    })
  } catch {
    // ignore — account reclaim already succeeded
  }

  redirect('/vendor/upload-w9')
}
