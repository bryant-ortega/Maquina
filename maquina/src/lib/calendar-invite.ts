/**
 * Calendar invite — emails a .ics attachment whenever an event gets
 * marked 'confirmed'. Two recipient groups, two different attachments:
 *
 *   - Full recipients (Chase, Elvis): show date + every set production
 *     milestone (begin art, art due, announce, on sale).
 *   - Show-only recipients (verbalortega@gmail.com): just the show
 *     date, no milestones.
 *
 * Delivery is via email, not direct CalDAV push, per Chase: doesn't
 * want to store an Apple ID app-specific password as a standing server
 * secret for a feature that only fires ~weekly. One email per group,
 * one .ics attachment with however many VEVENTs apply (the `ics`
 * package bundles them into a single VCALENDAR) — iPhone Mail shows an
 * "Add to Calendar" screen listing every event in the file, added in
 * one tap.
 *
 * DORMANT-SAFE like the rest of src/lib/email.ts: if RESEND_API_KEY
 * isn't set, sendEmail() no-ops and this function just logs a warning.
 * Never throws — callers (createEvent / updateEvent) treat this as
 * best-effort and never fail the DB write over an email hiccup. The
 * two sends are independent — one failing/skipping doesn't stop the
 * other.
 *
 * Env vars (both comma-separated email lists, both optional):
 *   CALENDAR_INVITE_RECIPIENTS           — full invite (show + milestones).
 *                                           Defaults to Chase + Elvis.
 *   CALENDAR_INVITE_SHOW_ONLY_RECIPIENTS — show date only, no milestones.
 *                                           Defaults to verbalortega@gmail.com.
 */

import { createEvents, type EventAttributes } from 'ics'
import { sendEmail, escapeHtml } from './email'
import { parseHHMM } from './run-of-show'

const DEFAULT_FULL_RECIPIENTS = ['kalicorose@gmail.com', 'elvis@losgoths.co']
const DEFAULT_SHOW_ONLY_RECIPIENTS = ['verbalortega@gmail.com']

function envRecipients(envVar: string, fallback: string[]): string[] {
  const raw = process.env[envVar]
  if (!raw) return fallback
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : fallback
}

function fullRecipients(): string[] {
  return envRecipients('CALENDAR_INVITE_RECIPIENTS', DEFAULT_FULL_RECIPIENTS)
}

function showOnlyRecipients(): string[] {
  return envRecipients(
    'CALENDAR_INVITE_SHOW_ONLY_RECIPIENTS',
    DEFAULT_SHOW_ONLY_RECIPIENTS
  )
}

export type ConfirmedEventForInvite = {
  id: string
  event_id: string
  title: string
  date: string // 'YYYY-MM-DD'
  city: string
  state: string
  doors_time: string | null
  end_time: string | null
  announce_date: string | null
  begin_art_date: string | null
  art_due_date: string | null
  on_sale_date: string | null
}

/** [y, m, d] from an ISO date string, for the `ics` package's DateArray. */
function isoToDateArray(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map((n) => Number(n))
  return [y, m, d]
}

/** [y, m, d] for `iso` shifted by `days` (handles month/year rollover). */
function shiftIsoDate(iso: string, days: number): [number, number, number] {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
}

const MILESTONE_DEFS: {
  key: string
  label: string
  pick: (e: ConfirmedEventForInvite) => string | null
}[] = [
  { key: 'begin-art', label: 'Begin art', pick: (e) => e.begin_art_date },
  { key: 'art-due', label: 'Art due', pick: (e) => e.art_due_date },
  { key: 'announce', label: 'Announce', pick: (e) => e.announce_date },
  { key: 'on-sale', label: 'On sale', pick: (e) => e.on_sale_date },
]

/**
 * The show itself as an `ics` EventAttributes object — timed, using
 * doors_time → end_time, wrap-around-aware (same 'end_time < doors_time
 * means next day' convention as run-of-show.ts). Shared by both the
 * full and show-only builders below.
 */
function buildShowEventAttributes(event: ConfirmedEventForInvite): EventAttributes {
  const [y, m, d] = isoToDateArray(event.date)
  const doorsMin = parseHHMM(event.doors_time)
  const endMin = parseHHMM(event.end_time)
  const wraps = event.doors_time && event.end_time && endMin < doorsMin
  const [endY, endM, endD] = wraps ? shiftIsoDate(event.date, 1) : [y, m, d]

  return {
    uid: `${event.id}-show@maquina.losgoths.co`,
    title: event.title,
    start: [y, m, d, Math.floor(doorsMin / 60), doorsMin % 60],
    // Floating local time, not UTC. Without these, the `ics` package
    // converts through whatever OS timezone the process happens to run
    // in — fine in dev (this sandbox is America/Los_Angeles) but wrong
    // on Vercel (UTC by default), which would silently shift every show
    // time by 7-8 hours. Floating time writes the doors/end numbers
    // as-is with no timezone conversion at all, so the calendar entry
    // reads "9:00 PM" regardless of what timezone the server runs in —
    // correct since doors_time/end_time are already venue-local wall
    // clock, and we have no per-venue IANA timezone data to convert
    // with anyway. Verified empirically: see commit message / handoff.
    startInputType: 'local',
    startOutputType: 'local',
    end: [endY, endM, endD, Math.floor(endMin / 60), endMin % 60],
    endInputType: 'local',
    endOutputType: 'local',
    location: [event.city, event.state].filter(Boolean).join(', '),
    description: `LosGothsCo event — ${event.event_id}`,
    status: 'CONFIRMED',
  }
}

function buildMilestoneEventAttributes(
  event: ConfirmedEventForInvite
): EventAttributes[] {
  const out: EventAttributes[] = []
  for (const ms of MILESTONE_DEFS) {
    const date = ms.pick(event)
    if (!date) continue
    const [my, mm, md] = isoToDateArray(date)
    out.push({
      uid: `${event.id}-${ms.key}@maquina.losgoths.co`,
      title: `${ms.label}: ${event.title}`,
      start: [my, mm, md],
      duration: { days: 1 },
      description: `LosGothsCo — ${event.event_id}`,
      status: 'CONFIRMED',
    })
  }
  return out
}

/** Show date + every set production milestone. */
export function buildFullConfirmedEventICS(
  event: ConfirmedEventForInvite
): { error: Error | null; value: string | null } {
  const events = [buildShowEventAttributes(event), ...buildMilestoneEventAttributes(event)]
  return createEvents(events, { calName: 'LosGothsCo · Maquina' })
}

/** Show date only — no milestones. */
export function buildShowOnlyConfirmedEventICS(
  event: ConfirmedEventForInvite
): { error: Error | null; value: string | null } {
  return createEvents([buildShowEventAttributes(event)], {
    calName: 'LosGothsCo · Maquina',
  })
}

/**
 * Sends both confirmed-event calendar invite emails (full + show-only
 * groups). Best-effort throughout: each send is independent, and
 * nothing here ever throws — logs and returns instead, so a bad send
 * never blocks the event save that triggered it.
 */
export async function sendConfirmedEventCalendarInvite(
  event: ConfirmedEventForInvite
): Promise<void> {
  await Promise.all([
    sendOneInvite({
      event,
      to: fullRecipients(),
      build: buildFullConfirmedEventICS,
      includeMilestonesInCopy: true,
    }),
    sendOneInvite({
      event,
      to: showOnlyRecipients(),
      build: buildShowOnlyConfirmedEventICS,
      includeMilestonesInCopy: false,
    }),
  ])
}

async function sendOneInvite(args: {
  event: ConfirmedEventForInvite
  to: string[]
  build: (
    event: ConfirmedEventForInvite
  ) => { error: Error | null; value: string | null }
  includeMilestonesInCopy: boolean
}): Promise<void> {
  const { event, to, build, includeMilestonesInCopy } = args
  if (to.length === 0) return

  const { error, value } = build(event)
  if (error || !value) {
    console.error('[calendar-invite] ics generation failed:', error)
    return
  }

  const milestoneCount = includeMilestonesInCopy
    ? MILESTONE_DEFS.filter((ms) => ms.pick(event)).length
    : 0
  const html = `
    <p style="margin:0 0 12px;"><strong>${escapeHtml(event.title)}</strong> is confirmed.</p>
    <p style="margin:0 0 16px;">Calendar invite attached — the show date${
      milestoneCount > 0
        ? ` and ${milestoneCount} production milestone${milestoneCount === 1 ? '' : 's'}`
        : ''
    }. Open the attachment on your phone and tap "Add All" to drop ${milestoneCount > 0 ? 'them' : 'it'} onto your calendar.</p>
  `

  const result = await sendEmail({
    to,
    subject: `Confirmed: ${event.title} — calendar invite`,
    html,
    text: `${event.title} is confirmed. Calendar invite attached (.ics)${
      milestoneCount > 0 ? ' with the show date and production milestones.' : ' with the show date.'
    }`,
    attachments: [{ filename: `${event.event_id}.ics`, content: value }],
  })

  if (!result.ok) {
    console.error(
      '[calendar-invite] send failed:',
      result.skipped ? 'no api key' : result.message
    )
  }
}

