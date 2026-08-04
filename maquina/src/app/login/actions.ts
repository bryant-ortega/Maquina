'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  checkRateLimit,
  formatRetryAfter,
  getClientIp,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/**
 * Server action for the email + password login form.
 *
 * Why a server action and not a client-side `signInWithPassword`:
 *   - Auth cookies need to be set on the SSR side so the very next
 *     navigation already has the session. With client-side login the
 *     cookies land in the browser but the server-side render of /events
 *     still sees the user as anonymous on the first hop.
 *   - Role lookup happens server-side too, so we can route to the right
 *     surface in one redirect.
 *
 * Rate limited to 5 attempts / 15 min, checked by BOTH client IP and
 * the submitted email — whichever bucket fills first blocks the
 * request. IP-only would let an attacker spread guesses across many
 * accounts from one connection; email-only would let them rotate IPs
 * against a single account. Checked before signInWithPassword runs,
 * so a throttled attempt never even reaches Supabase's own auth check.
 */

// .max() bounds here aren't UX limits — they cap how much a caller can
// throw at the parser (and, for email, at the rate-limit key below)
// before Zod ever runs the expensive .email() regex against it. 254 is
// RFC 5321's own limit on an email address; 128 matches the password
// max enforced at registration (register/dj + register/vendor).
const LoginInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'Enter a valid email')
    .email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password').max(128, 'Enter your password'),
})

export type LoginResult =
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'auth'; message: string }
  | { ok: false; reason: 'rate_limited'; message: string }
// On success we redirect, so there is no `ok: true` case the form needs to handle.

export async function loginUser(formData: FormData): Promise<LoginResult | never> {
  const parsed = LoginInput.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    const first =
      parsed.error.issues[0]?.message ?? 'Please check your email and password.'
    return { ok: false, reason: 'invalid', message: first }
  }

  const ip = getClientIp(await headers())
  const [ipLimit, emailLimit] = await Promise.all([
    checkRateLimit(`login:ip:${ip}`, RATE_LIMITS.AUTH),
    checkRateLimit(`login:email:${parsed.data.email}`, RATE_LIMITS.AUTH),
  ])
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retryAfterSeconds = Math.max(
      ipLimit.allowed ? 0 : ipLimit.retryAfterSeconds,
      emailLimit.allowed ? 0 : emailLimit.retryAfterSeconds
    )
    return {
      ok: false,
      reason: 'rate_limited',
      message: `Too many login attempts. Try again in ${formatRetryAfter(retryAfterSeconds)}.`,
    }
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })
  if (error || !data.user) {
    return {
      ok: false,
      reason: 'auth',
      message: 'Email or password is incorrect.',
    }
  }

  // Look up the role to decide where to land.
  const { data: profile } = await supabase
    .from('profiles')
    .select('roles')
    .eq('user_id', data.user.id)
    .maybeSingle()
  const roles: string[] = profile?.roles ?? ['dj']

  if (roles.includes('admin')) {
    redirect('/events')
  }
  if (roles.includes('viewer')) {
    redirect('/viewer/year')
  }
  if (roles.includes('contract')) {
    redirect('/contract/view')
  }
  if (roles.includes('finance')) {
    redirect('/finance/events')
  }
  if (roles.includes('ofrendas_partner')) {
    redirect('/ofrendas-vendor-applications')
  }
  if (roles.includes('collab')) {
    redirect('/collab/events')
  }
  if (roles.includes('vendor')) {
    const { data: v } = await supabase
      .from('vendors')
      .select('w9_status')
      .eq('user_id', data.user.id)
      .maybeSingle()
    redirect(v?.w9_status === 'on_file' ? '/vendor/profile' : '/vendor/upload-w9')
  }

  // DJ — destination depends on whether their W-9 is on file.
  const { data: dj } = await supabase
    .from('djs')
    .select('w9_status')
    .eq('user_id', data.user.id)
    .maybeSingle()
  redirect(dj?.w9_status === 'on_file' ? '/dj/profile' : '/dj/upload-w9')
}
