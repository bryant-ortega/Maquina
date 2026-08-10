/**
 * Single source of truth for when the Ofrendas vendor call closes.
 * Shared by page.tsx (hides the form, keeps the rest of the page
 * visible) and actions.ts (rejects late submissions server-side, so
 * this can't be bypassed by someone who has the page cached or hits
 * the server action directly).
 *
 * Deadline: end of day Tuesday, Aug 11 2026, Pacific time — i.e. the
 * form closes the instant Wednesday Aug 12 begins in Pacific time.
 * Pacific is on daylight time (PDT, UTC-7) in August, so that's
 * 2026-08-12T00:00:00 PDT = 2026-08-12T07:00:00Z.
 *
 * No cron job needed: the page (see `export const dynamic =
 * 'force-dynamic'` in page.tsx) re-evaluates this on every request,
 * so it flips automatically at the deadline without a redeploy.
 */
export const OFRENDAS_APPLICATION_DEADLINE = new Date('2026-08-12T07:00:00Z')

export function isOfrendasApplicationClosed(): boolean {
  return Date.now() >= OFRENDAS_APPLICATION_DEADLINE.getTime()
}
