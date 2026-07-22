/**
 * Pure helpers for building the Phase 11 Run of Show schedule.
 *
 * The schedule is auto-generated per stage from the event's doors_time
 * and end_time and the DJ slots booked for that stage. Times are stored
 * as 'HH:MM' strings on the event row (24-hour); we parse to minutes,
 * do the arithmetic in minute-space, and format back to 12-hour 'h:mm a'
 * for display.
 *
 * Wrap-around: an event that ends past midnight has end_time < doors_time
 * (e.g., doors 21:00, end 02:00). We detect this by comparing minute
 * values and add 1440 to end so all downstream offsets are positive and
 * monotonically increasing. Anything that wraps back across midnight
 * after formatting (e.g., LosGothsCo Out at 02:30 the next day) just
 * shows up as the wrapped wall-clock time — admins know the date.
 *
 * Pure / deterministic / no Supabase / no globals — trivial to unit test.
 */

import { type SlotType } from './event-defaults'

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * Parse 'HH:MM' or 'HH:MM:SS' (24-hour) to minutes-from-midnight.
 * Tolerates the trailing seconds because Postgres TIME columns serialize
 * back as 'HH:MM:SS' even though we never store sub-minute resolution —
 * the run-of-show page reads event.doors_time / end_time straight from
 * the DB, so we need to handle either form. NaN-safe → 0.
 */
export function parseHHMM(hhmm: string | null | undefined): number {
  if (!hhmm || typeof hhmm !== 'string') return 0
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hhmm.trim())
  if (!m) return 0
  const h = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return 0
  return ((h % 24) + 24) % 24 * 60 + ((mm % 60) + 60) % 60
}

/**
 * Format a minute count (which may exceed 1440 for next-day rows or be
 * negative for pre-doors rows) to 'h:mm a'. Wraps mod 1440 so the
 * display always lands in 0..23:59.
 */
export function formatHHMM12(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440
  const h24 = Math.floor(wrapped / 60)
  const m = wrapped % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// ---------------------------------------------------------------------------
// Schedule building
// ---------------------------------------------------------------------------

/**
 * One slot booked on a stage. The schedule only shows DJ rows for slot
 * types that actually have a booking; unbooked types are skipped.
 */
export type RunOfShowSlot = {
  slot_type: SlotType
  dj_name: string
  /**
   * Optional per-slot custom start time (Phase 14). When set, this
   * overrides the doors + slot-type offset that buildSchedule would
   * otherwise compute. Useful when an event needs a non-standard
   * cadence (e.g. headliner pushed back, late support set). Same
   * format as event.doors_time — 'HH:MM' or 'HH:MM:SS'.
   */
  start_time?: string | null
}

export type RunOfShowEvent = {
  doors_time: string | null | undefined
  end_time: string | null | undefined
  /**
   * Optional manual override for the "LosGothsCo load-in" production
   * row (default doors - 180min). Same format as doors_time — 'HH:MM'
   * or 'HH:MM:SS'. A time at/after doors is treated as the previous
   * evening (load-in always precedes doors).
   */
  losgoths_load_in_time?: string | null
  /**
   * Optional manual override for the "DJs load-in" production row
   * (default doors - 90min). Same rules as losgoths_load_in_time.
   */
  dj_load_in_time?: string | null
}

/**
 * One row in the schedule. `kind` lets the UI style production rows
 * (load-in, soundcheck, doors, load-out) differently from DJ rows.
 */
export type RunOfShowRow = {
  /** Absolute minutes-from-midnight, possibly > 1440 for next-day rows. */
  minutes: number
  /** Pre-formatted wall-clock time, 'h:mm a'. */
  time: string
  /** Display label. DJ rows include slot label + DJ name. */
  label: string
  /**
   * 'production' for venue/ops rows, 'dj' for performer rows, 'doors'
   * for the highlighted doors row. Lets the UI style each band.
   */
  kind: 'production' | 'doors' | 'dj'
}

/**
 * Result of buildSchedule. `rows` is always populated (at minimum the
 * pre-doors production rows + doors), but `endUsable` tells the UI
 * whether the end-anchored half of the schedule (Main support /
 * Headliner / Closer / Load-out / Out) was generated. When false, the
 * UI should surface a "set an end time" warning so the admin doesn't
 * mistake the truncated schedule for a complete one.
 */
export type RunOfShowResult = {
  rows: RunOfShowRow[]
  endUsable: boolean
}

/**
 * Slot offset table. Per BUILD_PLAN Phase 11:
 *
 *   open         → doors           (Opener)
 *   support_1    → doors + 60      (Support 1)
 *   support_2    → doors + 120     (Support 2)
 *   main_support → end   − 180     (Main support)
 *   headline     → end   − 120     (Headliner)
 *   close        → end   − 60      (Closer)
 *   resident     → doors           (Resident, alongside opener as warmup)
 *
 * The BUILD_PLAN spec doesn't include 'resident' explicitly. Residents
 * here at LosGothsCo run warmup sets that line up with doors, so we
 * place them at the same time as the opener. Two residents (or a
 * resident + an opener) on one stage will show as stacked rows at the
 * same time — that's accurate to how a handoff actually plays out.
 */
type Anchor = 'doors' | 'end'
const SLOT_OFFSETS: Record<
  SlotType,
  { anchor: Anchor; deltaMinutes: number }
> = {
  open:         { anchor: 'doors', deltaMinutes: 0 },
  resident:     { anchor: 'doors', deltaMinutes: 0 },
  support_1:    { anchor: 'doors', deltaMinutes: 60 },
  support_2:    { anchor: 'doors', deltaMinutes: 120 },
  main_support: { anchor: 'end',   deltaMinutes: -180 },
  headline:     { anchor: 'end',   deltaMinutes: -120 },
  close:        { anchor: 'end',   deltaMinutes: -60 },
}

/**
 * Build the schedule for one stage. Returns rows in chronological order
 * along with an `endUsable` flag.
 *
 * Production rows pre-doors and the Doors row always render. The
 * end-anchored half of the schedule (Main support / Headliner / Closer
 * / End / Out) and DJ rows tied to those anchors only render when an
 * end time is set AND it's plausibly after doors. The threshold is 30
 * minutes — if `end - doors < 30` (treating end as next-day when it
 * comes back earlier than doors on the clock), we treat it as a
 * not-set / mis-entered end time and skip the back half. The UI
 * surfaces a warning in that case so the admin notices.
 *
 * Why the 30-minute floor instead of just `end <= doors`: an admin
 * who left end_time blank will get end=0, doors=0 → both equal. Strict
 * `<=` would still treat that as a 0-minute show, which lets the
 * end-anchored rows wrap to the previous evening (the bug Chase saw).
 *
 * Slots whose type isn't in the offset table are skipped (defensive —
 * the SLOT_TYPES enum is closed, but new types could land before this
 * map updates).
 */
/**
 * Resolve a load-in row's minutes-from-midnight: the manual override
 * when set, otherwise `defaultMinutes` (doors +/- a fixed offset).
 *
 * Load-in always precedes doors. If an override time parses to >= doors
 * (e.g., an admin enters "22:00" for a midnight-doors event, meaning
 * "the night before"), normalize it back a day so it still sorts ahead
 * of Doors.
 */
function resolveLoadInMinutes(
  override: string | null | undefined,
  doors: number,
  defaultMinutes: number
): number {
  if (!override) return defaultMinutes
  const minutes = parseHHMM(override)
  return minutes >= doors ? minutes - 1440 : minutes
}

export function buildSchedule(
  event: RunOfShowEvent,
  slots: RunOfShowSlot[]
): RunOfShowResult {
  const doors = parseHHMM(event.doors_time)
  let end = parseHHMM(event.end_time)
  // Wrap past-midnight ends so end > doors and offsets stay sane.
  if (end < doors) end += 1440
  const endUsable = end - doors >= 30

  const rows: RunOfShowRow[] = []

  // --- Production: pre-doors --------------------------------------------
  const losgothsLoadIn = resolveLoadInMinutes(
    event.losgoths_load_in_time,
    doors,
    doors - 180
  )
  rows.push({
    minutes: losgothsLoadIn,
    time: formatHHMM12(losgothsLoadIn),
    label: 'LosGothsCo load-in',
    kind: 'production',
  })
  const djLoadIn = resolveLoadInMinutes(
    event.dj_load_in_time,
    doors,
    doors - 90
  )
  rows.push({
    minutes: djLoadIn,
    time: formatHHMM12(djLoadIn),
    label: 'DJs load-in',
    kind: 'production',
  })
  rows.push({
    minutes: doors - 60,
    time: formatHHMM12(doors - 60),
    label: 'Soundcheck start',
    kind: 'production',
  })
  rows.push({
    minutes: doors - 10,
    time: formatHHMM12(doors - 10),
    label: 'Soundcheck end',
    kind: 'production',
  })

  // --- Doors -------------------------------------------------------------
  rows.push({
    minutes: doors,
    time: formatHHMM12(doors),
    label: 'Doors',
    kind: 'doors',
  })

  // --- DJ rows -----------------------------------------------------------
  for (const slot of slots) {
    // Phase 14: honor a per-slot start_time override before falling back
    // to the doors+offset calculation. When set, the slot is anchored to
    // the override time directly — no end-time gating needed because the
    // admin chose this time explicitly.
    if (slot.start_time) {
      const customMin = parseHHMM(slot.start_time)
      // If the override falls in the early-morning window before the
      // (wrapped) end time, it's an after-midnight slot on the next
      // calendar day — normalize forward by 1440 so it sorts after doors
      // and before end. A raw "< doors" check alone isn't enough: any
      // same-evening pre-doors time (e.g. 9:00 PM with doors at 9:30 PM)
      // is also numerically less than doors, but it isn't after midnight
      // and must NOT be shifted, or it wrongly sorts to the very end of
      // the schedule (the bug Chase saw with "LosGothsCo. DJs").
      const minutes =
        end > 1440 && customMin < doors && customMin <= end - 1440
          ? customMin + 1440
          : customMin
      rows.push({
        minutes,
        time: formatHHMM12(minutes),
        label: slot.dj_name,
        kind: 'dj',
      })
      continue
    }
    const offset = SLOT_OFFSETS[slot.slot_type]
    if (!offset) continue
    // Skip end-anchored DJ rows when there's no usable end time —
    // otherwise they'd land in the prior evening and look bizarre.
    if (offset.anchor === 'end' && !endUsable) continue
    const minutes =
      (offset.anchor === 'doors' ? doors : end) + offset.deltaMinutes
    rows.push({
      minutes,
      time: formatHHMM12(minutes),
      label: slot.dj_name,
      kind: 'dj',
    })
  }

  // --- Production: post-end ---------------------------------------------
  // Same gating as end-anchored DJ rows: only show End / Out when the
  // end time is actually informative.
  if (endUsable) {
    rows.push({
      minutes: end,
      time: formatHHMM12(end),
      label: 'End / load-out',
      kind: 'production',
    })
    rows.push({
      minutes: end + 30,
      time: formatHHMM12(end + 30),
      label: 'LosGothsCo out',
      kind: 'production',
    })
  }

  // Sort chronologically. Stable sort across same-minute rows preserves
  // insertion order — production rows sit ahead of same-time DJ rows
  // (Doors before Opener at doors), and Opener before Resident if both
  // exist (insertion order: opener slot listed first by slot_order).
  rows.sort((a, b) => a.minutes - b.minutes)

  return { rows, endUsable }
}
