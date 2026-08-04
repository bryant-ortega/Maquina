import { createClient } from '@supabase/supabase-js'

/**
 * Shared rate limiter — Postgres-backed fixed-window counter via the
 * check_rate_limit() function (migration 0036). No Redis/Upstash/KV is
 * configured for this app (checked package.json — nothing there, no
 * matching env vars), so this reuses the existing Supabase project
 * instead of adding new infra — same service-role call pattern as
 * every other admin action in this codebase.
 *
 * Safe to call from both middleware (Edge runtime) and Server
 * Actions/Route Handlers (Node runtime): @supabase/supabase-js is
 * fetch-based, no Node-only APIs. getClientIp() takes a plain Headers
 * object for the same reason — `request.headers` (middleware) and
 * `await headers()` (Server Actions) both satisfy it, but `next/headers`
 * itself only works in the latter, so this file never imports it.
 */

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number }

export const RATE_LIMITS = {
  /** Login, registration, and password-reset requests. */
  AUTH: { max: 5, windowSeconds: 15 * 60 },
  /** Public, unauthenticated forms (e.g. the Ofrendas vendor call). */
  PUBLIC_FORM: { max: 5, windowSeconds: 15 * 60 },
  /** General API routes — a generous DoS/abuse backstop, not a UX gate. */
  API: { max: 60, windowSeconds: 60 },
} as const

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Caps how long a caller waits on the rate-limit check itself. Without
// this, "fails open on error" only helps when Supabase responds with
// an error quickly — a slow-but-eventually-successful response would
// just make every login/register/etc. as slow as Supabase is having a
// bad moment, with no upper bound. 1.5s is generous for a
// single-row upsert under normal conditions but short enough that a
// real outage doesn't make the login page feel broken.
const RATE_LIMIT_TIMEOUT_MS = 1500

/**
 * Checks and increments the counter for `key` in one atomic DB call
 * (see check_rate_limit()'s SQL for the race-safety argument).
 *
 * Fails OPEN — if the rate-limit check itself errors, throws, or
 * doesn't come back within RATE_LIMIT_TIMEOUT_MS, this returns
 * `allowed: true` rather than blocking real traffic. A broken or slow
 * rate limiter should never be the reason logins go down.
 */
export async function checkRateLimit(
  key: string,
  opts: { max: number; windowSeconds: number }
): Promise<RateLimitResult> {
  const supabase = serviceClient()
  try {
    const { data, error } = await supabase
      .rpc('check_rate_limit', {
        p_key: key,
        p_max_attempts: opts.max,
        p_window_seconds: opts.windowSeconds,
      })
      .abortSignal(AbortSignal.timeout(RATE_LIMIT_TIMEOUT_MS))
      .maybeSingle()

    if (error || !data) {
      console.error('[rate-limit] check failed, failing open:', error?.message)
      return { allowed: true, remaining: opts.max }
    }

    const row = data as {
      allowed: boolean
      remaining: number
      retry_after_seconds: number
    }
    return row.allowed
      ? { allowed: true, remaining: row.remaining }
      : { allowed: false, retryAfterSeconds: row.retry_after_seconds }
  } catch (err) {
    // AbortSignal.timeout() firing surfaces here as a thrown
    // DOMException (TimeoutError) rather than through the `error`
    // field above — catch defensively so a slow response degrades to
    // "fail open," not an unhandled rejection.
    console.error('[rate-limit] check threw, failing open:', err)
    return { allowed: true, remaining: opts.max }
  }
}

/**
 * Best-effort client IP from standard proxy headers. Vercel sets
 * x-forwarded-for on every request; x-real-ip is a fallback for other
 * hosts. Falls back to 'unknown' rather than throwing — worst case,
 * everyone sharing that bucket shares a limit, which fails toward
 * "too permissive," never "locks a real user out."
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  const real = headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

/** "5 minutes" / "45 seconds" — for the user-facing throttle message. */
export function formatRetryAfter(seconds: number): string {
  if (seconds <= 60) {
    const s = Math.max(seconds, 1)
    return `${s} second${s === 1 ? '' : 's'}`
  }
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
