'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { absoluteUrl } from '@/lib/email'
import {
  checkRateLimit,
  formatRetryAfter,
  getClientIp,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/**
 * Server action for /forgot-password.
 *
 * Moved from a client-side `supabase.auth.resetPasswordForEmail(...)`
 * call to a server action for one reason: rate limiting has to happen
 * server-side, and this is the "login route" most exposed to abuse —
 * repeatedly requesting reset emails for arbitrary addresses is both
 * an email-bombing vector and a way to probe which emails exist (even
 * though we never say so in the response).
 *
 * Rate limited to 5 attempts / 15 min by IP + by email, same as login.
 *
 * Always returns `ok: true` on the non-rate-limited path, regardless
 * of whether Supabase actually found an account for that email — the
 * page keeps showing its "check your email" success state either way,
 * same behavior as before this moved server-side.
 */

// 254 is RFC 5321's limit on an email address — rejects oversized junk
// before it's used as a rate-limit key or handed to Supabase.
const EmailInput = z.string().trim().toLowerCase().max(254).email()

export type RequestPasswordResetResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'rate_limited'; message: string }

export async function requestPasswordReset(
  formData: FormData
): Promise<RequestPasswordResetResult> {
  const parsed = EmailInput.safeParse(formData.get('email'))
  if (!parsed.success) {
    return { ok: false, reason: 'invalid' }
  }
  const email = parsed.data

  const ip = getClientIp(await headers())
  const [ipLimit, emailLimit] = await Promise.all([
    checkRateLimit(`reset:ip:${ip}`, RATE_LIMITS.AUTH),
    checkRateLimit(`reset:email:${email}`, RATE_LIMITS.AUTH),
  ])
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retryAfterSeconds = Math.max(
      ipLimit.allowed ? 0 : ipLimit.retryAfterSeconds,
      emailLimit.allowed ? 0 : emailLimit.retryAfterSeconds
    )
    return {
      ok: false,
      reason: 'rate_limited',
      message: `Too many requests. Try again in ${formatRetryAfter(retryAfterSeconds)}.`,
    }
  }

  const supabase = await createServerSupabaseClient()
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: absoluteUrl('/reset-password'),
  })

  return { ok: true }
}
