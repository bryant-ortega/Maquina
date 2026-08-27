/**
 * Centralized constants and pure helpers for the event creation/edit forms.
 *
 * Keeping these in one module means the create form, edit form, and any
 * future scheduled-task that bootstraps an event all share the same
 * defaults. Editing this file is the only ceremony required to tweak slot
 * rates or expense templates later.
 *
 * Everything here is pure / deterministic — no Supabase, no fetch, no
 * randomness. Trivially unit-testable.
 */

// ---------------------------------------------------------------------------
// Slot-type defaults
// ---------------------------------------------------------------------------
// Pulled from BUILD_PLAN.md Phase 7. Override system arrives in Phase 14.
export const SLOT_TYPES = [
  'open',
  'support_1',
  'support_2',
  'main_support',
  'headline',
  'close',
  'resident',
] as const

export type SlotType = (typeof SLOT_TYPES)[number]

export const SLOT_DEFAULT_RATES: Record<SlotType, number> = {
  open: 100,
  support_1: 150,
  support_2: 150,
  main_support: 200,
  headline: 250,
  close: 200,
  resident: 300,
}

export const SLOT_TYPE_LABELS: Record<SlotType, string> = {
  open: 'Open',
  support_1: 'Support 1',
  support_2: 'Support 2',
  main_support: 'Main support',
  headline: 'Headline',
  close: 'Close',
  resident: 'Resident',
}

// ---------------------------------------------------------------------------
// Event types + auto-calculated date offsets
// ---------------------------------------------------------------------------
// announce_date and on_sale_date are still derived from the event type, but
// the art-pipeline dates now follow constant rules per Chase:
//
//   announce       = event_date - announceBeforeEvent
//   art_due        = announce - 3 business days (Mon–Fri)
//   begin_art      = art_due - 14 calendar days
//   on_sale        = announce + onSaleAfterAnnounce
//
// `beginArtAfterAnnounce` and `artDueAfterAnnounce` were removed because
// they no longer vary by event type.
export const EVENT_TYPES = ['club', 'concert', 'festival'] as const
export type EventType = (typeof EVENT_TYPES)[number]

// "Presented by" — whose branding heads the Run of Show / Budget PDFs.
// The default renders the usual LosGothsCo triangle + wordmark; any
// other option renders as plain text in its place instead (see
// src/components/pdf-templates/brand-band.tsx). Short list by design —
// add entries here by hand as new co-presented series come up.
export const PRESENTED_BY_OPTIONS = ['LosGothsCo.', 'Scam and Jam'] as const
export type PresentedBy = (typeof PRESENTED_BY_OPTIONS)[number]
export const DEFAULT_PRESENTED_BY: PresentedBy = 'LosGothsCo.'

export const TYPE_DATE_OFFSETS: Record<
  EventType,
  {
    announceBeforeEvent: number
    onSaleAfterAnnounce: number
    /**
     * If true, after subtracting `announceBeforeEvent` from the event date
     * we roll forward to the next Monday (only when the result isn't
     * already a Monday). Anchors recurring weekly announce posts.
     */
    roundAnnounceToMonday?: boolean
  }
> = {
  // Club: announce 5 calendar weeks (35 days) before the event, rounded
  // forward to the following Monday so the announcement always lands on
  // a Monday.
  club: {
    announceBeforeEvent: 35,
    onSaleAfterAnnounce: 1,
    roundAnnounceToMonday: true,
  },
  concert: { announceBeforeEvent: 42, onSaleAfterAnnounce: 2 },
  festival: { announceBeforeEvent: 90, onSaleAfterAnnounce: 3 },
}

/** Business days the art is due before the announce date. */
export const ART_DUE_BUSINESS_DAYS_BEFORE_ANNOUNCE = 3
/** Calendar days art work begins before the art-due date. */
export const BEGIN_ART_DAYS_BEFORE_ART_DUE = 14

// ---------------------------------------------------------------------------
// US states — used by the event-create form's state dropdown.
// ---------------------------------------------------------------------------
// Stored as the 2-letter USPS code ("CA"). Display labels show the full
// name. DC is included since events sometimes happen there. Sorted
// alphabetically by full name to match how the dropdown renders.
export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
]

// ---------------------------------------------------------------------------
// Default expense lines for a freshly-created event's estimated budget.
// ---------------------------------------------------------------------------
// Per Chase's spec (screenshot, Phase 7). Two literal "name" placeholders
// in the staff category are intentional — admins fill in the real names
// per event (e.g., security 1, security 2). All lines insert at qty=1,
// unit_price=0; admins update later.
export type DefaultExpense = {
  category:
    | 'digital'
    | 'consumables'
    | 'travel'
    | 'transportation'
    | 'vendors'
    | 'staff'
    | 'rent'
  label: string
}

export const DEFAULT_EVENT_EXPENSES: DefaultExpense[] = [
  { category: 'digital', label: 'Flyer' },
  { category: 'digital', label: 'IG Ads' },
  { category: 'consumables', label: 'Balloons' },
  { category: 'consumables', label: 'Helium Tank' },
  { category: 'consumables', label: 'glow sticks' },
  { category: 'travel', label: 'food' },
  { category: 'travel', label: 'Hotels' },
  { category: 'transportation', label: 'flights' },
  { category: 'transportation', label: 'rental car' },
  { category: 'transportation', label: 'Fuel' },
  { category: 'vendors', label: 'Robot' },
  { category: 'vendors', label: '360 Video' },
  { category: 'staff', label: 'name' },
  { category: 'staff', label: 'name' },
  { category: 'staff', label: 'Videographer1' },
  { category: 'staff', label: 'photographer' },
  { category: 'rent', label: 'variable' },
]

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Add (or subtract) minutes to an "HH:MM" 24-hour time string, returning the
 * new time as "HH:MM". Wraps modulo 24h so 23:30 + 60min → 00:30. The form
 * uses this to default a slot's end_time to one hour after its start_time.
 */
export function addMinutes(hhmm: string, minutes: number): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  const total = (((h * 60 + m + minutes) % (24 * 60)) + 24 * 60) % (24 * 60)
  const nh = Math.floor(total / 60).toString().padStart(2, '0')
  const nm = (total % 60).toString().padStart(2, '0')
  return `${nh}:${nm}`
}

/**
 * If the given ISO date is already a Monday, return it unchanged. Otherwise
 * roll forward to the next Monday. Used to anchor club announce dates so
 * the public-facing announce always lands on a Monday.
 */
export function nextMondayOnOrAfter(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  const dow = d.getUTCDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
  if (dow === 1) return isoDate
  const daysToAdd = (1 - dow + 7) % 7 // 1..6 for non-Mondays
  return addDays(isoDate, daysToAdd)
}

/**
 * Walk backwards from an ISO date by N business days (Mon–Fri only). Used
 * to compute art_due relative to announce. Skips Saturday and Sunday but
 * not US holidays — adding holiday awareness is intentionally deferred
 * until we have a holiday source of truth.
 */
export function subtractBusinessDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  let remaining = days
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1)
    const dow = d.getUTCDay() // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--
  }
  return d.toISOString().slice(0, 10)
}

/**
 * Add (or subtract) whole days to an ISO date string ("YYYY-MM-DD"), returning
 * a new ISO date string. UTC-anchored to avoid timezone-induced day drift.
 */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Day of the week in long form ("Saturday") for a given ISO date. */
export function dayOfWeek(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

/** Year for a given ISO date. */
export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4))
}

/**
 * Which occurrence of this weekday in the month — "1st Sat = 1", "2nd Sat = 2",
 * etc. Always 1..5.
 */
export function weekendNumber(isoDate: string): number {
  const day = Number(isoDate.slice(8, 10))
  return Math.floor((day - 1) / 7) + 1
}

/**
 * BUILD_PLAN says "good" if the weekend_number is 2/3/4 (middle of month);
 * "warning" if 1 or last weekday-of-month. Anything else (5th occurrences
 * always represent a tail edge) gets "warning".
 */
export function weekendFlag(isoDate: string): 'good' | 'warning' {
  const wn = weekendNumber(isoDate)
  if (wn === 2 || wn === 3 || wn === 4) {
    // Could still be the LAST occurrence in the month (e.g., the 4th
    // Saturday is also the last in many months). Compare against the next
    // week's date; if that lands in a different month we're at the tail.
    const next = addDays(isoDate, 7)
    const sameMonth = next.slice(0, 7) === isoDate.slice(0, 7)
    return sameMonth ? 'good' : 'warning'
  }
  return 'warning'
}

/**
 * Build a 3-letter city code from a city name.
 *
 * Rules:
 *   - Single-word city: first 3 letters (e.g., Sacramento → SAC).
 *   - Multi-word city: first letter of each word, padded with subsequent
 *     letters of the LAST word until we reach 3 chars (e.g., San Francisco
 *     → SFR, Los Angeles → LAN, New York → NYO).
 *   - 3+ words: first 3 initials (e.g., Salt Lake City → SLC).
 *   - Non-letter chars are stripped before splitting.
 *   - Falls back to 'XXX' if the input has no letters.
 */
export function buildCityCode(city: string): string {
  const words = city
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)

  if (words.length === 0) return 'XXX'

  if (words.length === 1) {
    return (words[0] + 'XXX').slice(0, 3)
  }

  const initials = words.map((w) => w[0]).join('')
  if (initials.length >= 3) return initials.slice(0, 3)

  // 2-word city: 2 initials, pad with letters from the last word.
  const lastWord = words[words.length - 1]
  return (initials + lastWord.slice(1) + 'XXX').slice(0, 3)
}

/**
 * Build the human-friendly event_id: YYYYMMDD-CITYCODE-STATECODE.
 *   - CITYCODE: 3 letters via buildCityCode (handles multi-word cities).
 *   - STATECODE: 2-letter US state code (uppercased; padded with XX if blank).
 *
 * The state suffix disambiguates same-spelled cities across states (e.g.,
 * Portland-OR vs Portland-ME) and absorbs the rare same-code collision
 * (Santa Ana-CA vs San Antonio-TX both build to SAN).
 */
export function buildEventId(
  isoDate: string,
  city: string,
  state: string
): string {
  const yyyymmdd = isoDate.replace(/-/g, '')
  const cityCode = buildCityCode(city)
  const stateCode = (state.toUpperCase().replace(/[^A-Z]/g, '') + 'XX').slice(
    0,
    2
  )
  return `${yyyymmdd}-${cityCode}-${stateCode}`
}

/**
 * Given an event date and event type, compute the four auto-derived
 * milestone dates. All admin-editable in the form.
 *
 * Pipeline order is now:
 *   begin_art  →  art_due  →  announce  →  event_date
 *                                          (and on_sale lands after announce)
 */
export function deriveMilestones(
  date: string,
  type: EventType
): {
  announce_date: string
  begin_art_date: string
  art_due_date: string
  on_sale_date: string
} {
  const o = TYPE_DATE_OFFSETS[type]
  const baseAnnounce = addDays(date, -o.announceBeforeEvent)
  const announce = o.roundAnnounceToMonday
    ? nextMondayOnOrAfter(baseAnnounce)
    : baseAnnounce
  const art_due = subtractBusinessDays(
    announce,
    ART_DUE_BUSINESS_DAYS_BEFORE_ANNOUNCE
  )
  const begin_art = addDays(art_due, -BEGIN_ART_DAYS_BEFORE_ART_DUE)
  return {
    announce_date: announce,
    begin_art_date: begin_art,
    art_due_date: art_due,
    on_sale_date: addDays(announce, o.onSaleAfterAnnounce),
  }
}
