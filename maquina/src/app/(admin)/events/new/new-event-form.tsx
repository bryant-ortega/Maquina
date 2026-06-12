'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  EVENT_TYPES,
  SLOT_TYPES,
  SLOT_TYPE_LABELS,
  SLOT_DEFAULT_RATES,
  TYPE_DATE_OFFSETS,
  US_STATES,
  ART_DUE_BUSINESS_DAYS_BEFORE_ANNOUNCE,
  BEGIN_ART_DAYS_BEFORE_ART_DUE,
  addDays,
  addMinutes,
  nextMondayOnOrAfter,
  subtractBusinessDays,
  type EventType,
  type SlotType,
} from '@/lib/event-defaults'
import { createEvent, type CreateEventResult } from './actions'

/**
 * Admin event-create form.
 *
 * The form is "controlled" rather than react-hook-form because of all the
 * cross-field auto-derivation: changing `type` or `date` recalculates the
 * four milestone dates; changing `slot_type` on a row pre-fills its rate;
 * typing in `city` filters the venue autocomplete; etc. Doing that with
 * useState lets us keep one source of truth and re-derive on render.
 *
 * Validation is light here — the server action re-validates with zod and
 * surfaces issues field-by-field. We do enough client-side checking to
 * prevent obvious "submit empty form" mistakes.
 */

type Dj = { id: string; dj_name: string; region: string | null }
type Venue = { id: string; name: string; city: string; state: string }

type StageRow = {
  stage_number: number
  stage_name: string
}

type SlotRow = {
  uid: string // local React key; not sent
  stage_number: number
  slot_order: number
  slot_type: SlotType
  dj_id: string
  rate: string // string in form, coerced on submit
  start_time: string
  end_time: string
}

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)

function newSlot(
  stage_number = 1,
  slot_order = 1,
  slot_type: SlotType = 'open',
  doorsTime = '21:00'
): SlotRow {
  return {
    uid: crypto.randomUUID(),
    stage_number,
    slot_order,
    slot_type,
    dj_id: '',
    rate: String(SLOT_DEFAULT_RATES[slot_type] ?? 0),
    start_time: doorsTime,
    end_time: addMinutes(doorsTime, 60),
  }
}

export function NewEventForm({
  djs,
  venues,
}: {
  djs: Dj[]
  venues: Venue[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [topError, setTopError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // -------- Core fields --------------------------------------------------
  const [type, setType] = useState<EventType>('club')
  const [date, setDate] = useState<string>(TODAY_ISO())
  const [title, setTitle] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [venueName, setVenueName] = useState('')
  const [status, setStatus] = useState<'tentative' | 'confirmed'>('tentative')
  const [collab, setCollab] = useState(false)
  const [doorsTime, setDoorsTime] = useState('21:00')
  const [endTime, setEndTime] = useState('02:00')
  const [losgothsLoadInTime, setLosgothsLoadInTime] = useState('')
  const [djLoadInTime, setDjLoadInTime] = useState('')
  const [capacity, setCapacity] = useState('')
  const [guarantee, setGuarantee] = useState(false)
  const [barIncluded, setBarIncluded] = useState(false)
  const [rent, setRent] = useState('')
  const [splitPct, setSplitPct] = useState('')
  const [venueTixFee, setVenueTixFee] = useState('')
  const [advanceEmail, setAdvanceEmail] = useState('')
  const [advancePhone, setAdvancePhone] = useState('')

  // -------- Auto-derived milestone dates -------------------------------
  // Each milestone holds an "override" — null means "derive from
  // (type, date)" on every render; a string means the admin typed
  // something and we honor that exact value. This keeps the auto-update
  // behavior without a setState-in-effect cascade.
  const [announceOverride, setAnnounceOverride] = useState<string | null>(null)
  const [beginArtOverride, setBeginArtOverride] = useState<string | null>(null)
  const [artDueOverride, setArtDueOverride] = useState<string | null>(null)
  const [onSaleOverride, setOnSaleOverride] = useState<string | null>(null)

  const derivedMilestones = useMemo(() => {
    if (!date)
      return { announce: '', beginArt: '', artDue: '', onSale: '' }
    const o = TYPE_DATE_OFFSETS[type]
    // Subtract the per-type lead time, then optionally roll forward to
    // the next Monday (club only) so announce always lands on a Monday.
    const baseAnnounce = addDays(date, -o.announceBeforeEvent)
    const announce = o.roundAnnounceToMonday
      ? nextMondayOnOrAfter(baseAnnounce)
      : baseAnnounce
    // art_due = announce − 3 business days; begin_art = art_due − 14 days.
    // Pipeline runs: begin_art → art_due → announce → event_date.
    const artDue = subtractBusinessDays(
      announce,
      ART_DUE_BUSINESS_DAYS_BEFORE_ANNOUNCE
    )
    const beginArt = addDays(artDue, -BEGIN_ART_DAYS_BEFORE_ART_DUE)
    return {
      announce,
      beginArt,
      artDue,
      onSale: addDays(announce, o.onSaleAfterAnnounce),
    }
  }, [type, date])

  const announceDate = announceOverride ?? derivedMilestones.announce
  const beginArtDate = beginArtOverride ?? derivedMilestones.beginArt
  const artDueDate = artDueOverride ?? derivedMilestones.artDue
  const onSaleDate = onSaleOverride ?? derivedMilestones.onSale

  // -------- Stages -------------------------------------------------------
  const [stages, setStages] = useState<StageRow[]>([
    { stage_number: 1, stage_name: 'Main' },
  ])

  // -------- Slots --------------------------------------------------------
  // Initial slot uses the default doors time (21:00). Subsequent adds
  // pull the *current* doors time so changing it before adding more
  // slots gets propagated.
  const tbdDjId = djs.find((d) => d.dj_name === 'TBD')?.id ?? ''
  const [slots, setSlots] = useState<SlotRow[]>([{ ...newSlot(1, 1, 'open', '21:00'), dj_id: tbdDjId }])

  // -------- Venue autocomplete ------------------------------------------
  // Filter venues matching the typed city (case-insensitive contains).
  // Hidden when no city typed yet — autocomplete only makes sense once
  // the admin has narrowed the candidate set.
  const venueSuggestions = useMemo(() => {
    const c = city.trim().toLowerCase()
    if (!c) return []
    const v = venueName.trim().toLowerCase()
    return venues
      .filter((venue) => venue.city.trim().toLowerCase() === c)
      .filter((venue) =>
        v ? venue.name.toLowerCase().includes(v) : true
      )
      .slice(0, 8)
  }, [city, venueName, venues])

  const [showSuggestions, setShowSuggestions] = useState(false)

  // ------------------------------------------------------------------- Submit

  function clientValidate(): string | null {
    if (!title.trim()) return 'Title is required'
    if (!city.trim()) return 'City is required'
    if (!state.trim()) return 'State is required'
    if (!venueName.trim()) return 'Venue is required'
    if (!doorsTime) return 'Doors time is required'
    if (!endTime) return 'End time is required'
    if (stages.length === 0) return 'At least one stage is required'
    if (stages.some((s) => !s.stage_name.trim()))
      return 'Every stage needs a name'
    if (slots.some((s) => !s.dj_id))
      return 'Every DJ slot needs a DJ selected (or remove the row)'
    return null
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTopError(null)
    setFieldErrors({})

    const clientError = clientValidate()
    if (clientError) {
      setTopError(clientError)
      return
    }

    const payload = {
      type,
      date,
      title: title.trim(),
      city: city.trim(),
      state: state.trim(),
      venue_name: venueName.trim(),
      status,
      collab,
      doors_time: doorsTime,
      end_time: endTime,
      losgoths_load_in_time: losgothsLoadInTime,
      dj_load_in_time: djLoadInTime,
      capacity,
      guarantee,
      bar_included: barIncluded,
      rent,
      split_pct: splitPct,
      venue_tix_fee: venueTixFee,
      advance_contact_email: advanceEmail,
      advance_contact_phone: advancePhone,
      announce_date: announceDate,
      begin_art_date: beginArtDate,
      art_due_date: artDueDate,
      on_sale_date: onSaleDate,
      stages: stages.map((s) => ({
        stage_number: s.stage_number,
        stage_name: s.stage_name.trim(),
      })),
      slots: slots.map((s) => ({
        stage_number: s.stage_number,
        slot_order: s.slot_order,
        slot_type: s.slot_type,
        dj_id: s.dj_id,
        rate: s.rate,
        start_time: s.start_time,
        end_time: s.end_time,
      })),
    }

    startTransition(async () => {
      const result: CreateEventResult = await createEvent(
        payload as Parameters<typeof createEvent>[0]
      )
      if (result.ok) {
        // Phase 7b will add /events/[id]; until then we land on the
        // events index. Pass the new event_id as a query param so the
        // index can flash a "Created XYZ" toast.
        router.push(`/events?created=${encodeURIComponent(result.eventCode)}`)
        router.refresh()
        return
      }
      if (result.reason === 'invalid') {
        const fErrors: Record<string, string> = {}
        const stray: string[] = []
        for (const issue of result.issues) {
          if (issue.path && !issue.path.startsWith('(')) {
            fErrors[issue.path] = issue.message
          } else {
            stray.push(issue.message)
          }
        }
        setFieldErrors(fErrors)
        setTopError(
          stray.length > 0
            ? stray.join('; ')
            : 'Please fix the highlighted fields.'
        )
        return
      }
      if (result.reason === 'forbidden' || result.reason === 'unauth') {
        setTopError('You are not authorized to create events.')
        return
      }
      setTopError(result.message)
    })
  }

  // ---------------------------------------------------------------- Helpers

  function addStage() {
    if (stages.length >= 4) return
    const next = stages.length + 1
    setStages([...stages, { stage_number: next, stage_name: `Stage ${next}` }])
  }

  function removeStage(stage_number: number) {
    if (stages.length <= 1) return
    // Renumber remaining stages 1..N to keep stage_number contiguous.
    const remaining = stages.filter((s) => s.stage_number !== stage_number)
    const renumbered = remaining.map((s, i) => ({
      ...s,
      stage_number: i + 1,
    }))
    setStages(renumbered)
    // Drop slots whose stage was removed; renumber slot stage_numbers too.
    const oldToNew = new Map<number, number>()
    remaining.forEach((s, i) => oldToNew.set(s.stage_number, i + 1))
    setSlots((prev) =>
      prev
        .filter((s) => oldToNew.has(s.stage_number))
        .map((s) => ({ ...s, stage_number: oldToNew.get(s.stage_number)! }))
    )
  }

  function addSlot() {
    if (slots.length >= 36) return
    // Default: stage 1, next slot_order, type 'open'.
    // Start = current doors time, end = start + 1h.
    const stage1Slots = slots.filter((s) => s.stage_number === 1)
    const nextOrder =
      (stage1Slots.length > 0
        ? Math.max(...stage1Slots.map((s) => s.slot_order))
        : 0) + 1
    setSlots([
      ...slots,
      { ...newSlot(1, Math.min(nextOrder, 6), 'open', doorsTime || '21:00'), dj_id: tbdDjId },
    ])
  }

  function removeSlot(uid: string) {
    setSlots((prev) => prev.filter((s) => s.uid !== uid))
  }

  function updateSlot(uid: string, patch: Partial<SlotRow>) {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.uid !== uid) return s
        const next = { ...s, ...patch }
        // If slot_type changed, refresh the rate to the new default,
        // unless the admin has already typed a non-default rate.
        if (patch.slot_type && patch.slot_type !== s.slot_type) {
          const oldDefault = String(SLOT_DEFAULT_RATES[s.slot_type] ?? 0)
          if (s.rate === oldDefault || s.rate === '' || s.rate === '0') {
            next.rate = String(SLOT_DEFAULT_RATES[patch.slot_type] ?? 0)
          }
        }
        // If start_time changed, shift end_time to keep the 1-hour
        // window — but only if end was still tracking the default
        // (i.e., start_old + 60min). If admin has typed a custom end,
        // leave it alone.
        if (
          patch.start_time !== undefined &&
          patch.start_time !== s.start_time &&
          patch.start_time !== ''
        ) {
          const expectedDefault = addMinutes(s.start_time, 60)
          if (s.end_time === expectedDefault || s.end_time === '') {
            next.end_time = addMinutes(patch.start_time, 60)
          }
        }
        return next
      })
    )
  }

  // ---------------------------------------------------------------- Render

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      {/* ---------- Section 1: Core ---------- */}
      <Section title="Event basics">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Type" error={fieldErrors.type}>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as EventType)}
              className={inputClass}
              disabled={pending}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Date" error={fieldErrors.date}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>

          <Field
            label="Title"
            error={fieldErrors.title}
            className="sm:col-span-2"
          >
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              disabled={pending}
              placeholder="e.g. Goth Night"
            />
          </Field>

          <Field label="City" error={fieldErrors.city}>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={inputClass}
              disabled={pending}
              placeholder="Los Angeles"
            />
          </Field>

          <Field label="State" error={fieldErrors.state}>
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className={inputClass}
              disabled={pending}
            >
              <option value="">— Select state —</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Venue"
            error={fieldErrors.venue_name}
            className="sm:col-span-2"
          >
            <div className="relative">
              <input
                type="text"
                value={venueName}
                onChange={(e) => {
                  setVenueName(e.target.value)
                  setShowSuggestions(true)
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() =>
                  setTimeout(() => setShowSuggestions(false), 150)
                }
                className={inputClass}
                disabled={pending}
                placeholder={
                  city
                    ? 'Type to search or add new'
                    : 'Enter city above first to autocomplete'
                }
                autoComplete="off"
              />
              {showSuggestions && venueSuggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {venueSuggestions.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          // onMouseDown fires before blur so the click
                          // sticks even though we close-on-blur above.
                          e.preventDefault()
                          setVenueName(v.name)
                          // Only auto-fill state if it's still empty
                          // *and* the venue's stored state is a known
                          // USPS code. Older rows may have stored full
                          // names; for those we leave the dropdown for
                          // the admin to pick.
                          if (!state) {
                            const known = US_STATES.find(
                              (us) =>
                                us.code.toUpperCase() ===
                                v.state.trim().toUpperCase()
                            )
                            if (known) setState(known.code)
                          }
                          setShowSuggestions(false)
                        }}
                        className="block w-full cursor-pointer px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span className="font-medium">{v.name}</span>
                        <span className="ml-2 text-xs text-zinc-500">
                          {v.city}, {v.state}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Existing venues match by city. New venues are created
              automatically on save.
            </p>
          </Field>
        </div>
      </Section>

      {/* ---------- Section 2: Schedule + door ---------- */}
      <Section title="Schedule">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Doors time" error={fieldErrors.doors_time}>
            <input
              type="time"
              value={doorsTime}
              onChange={(e) => setDoorsTime(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>

          <Field label="End time" error={fieldErrors.end_time}>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>

          <Field
            label="LosGothsCo load-in (optional)"
            error={fieldErrors.losgoths_load_in_time}
          >
            <input
              type="time"
              value={losgothsLoadInTime}
              onChange={(e) => setLosgothsLoadInTime(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Run of show default: {addMinutes(doorsTime || '00:00', -180)}{' '}
              (doors − 3h). Leave blank to use the default.
            </p>
          </Field>

          <Field
            label="DJs load-in (optional)"
            error={fieldErrors.dj_load_in_time}
          >
            <input
              type="time"
              value={djLoadInTime}
              onChange={(e) => setDjLoadInTime(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Run of show default: {addMinutes(doorsTime || '00:00', -90)}{' '}
              (doors − 1.5h). Leave blank to use the default.
            </p>
          </Field>

          <Field label="Capacity" error={fieldErrors.capacity}>
            <input
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>

          <Field label="Status" error={fieldErrors.status}>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as 'tentative' | 'confirmed')
              }
              className={inputClass}
              disabled={pending}
            >
              <option value="tentative">Tentative</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap gap-6">
          <Checkbox
            label="Collab"
            checked={collab}
            onChange={setCollab}
            disabled={pending}
          />
          <Checkbox
            label="Guarantee"
            checked={guarantee}
            onChange={setGuarantee}
            disabled={pending}
          />
          <Checkbox
            label="Bar included"
            checked={barIncluded}
            onChange={setBarIncluded}
            disabled={pending}
          />
        </div>
      </Section>

      {/* ---------- Section 3: Money ---------- */}
      <Section title="Venue terms">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Rent ($)" error={fieldErrors.rent}>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>

          <Field label="Split %" error={fieldErrors.split_pct}>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={splitPct}
              onChange={(e) => setSplitPct(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>

          <Field label="Venue tix fee ($)" error={fieldErrors.venue_tix_fee}>
            <input
              type="number"
              min={0}
              step="0.01"
              value={venueTixFee}
              onChange={(e) => setVenueTixFee(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field
            label="Advance contact email"
            error={fieldErrors.advance_contact_email}
          >
            <input
              type="email"
              value={advanceEmail}
              onChange={(e) => setAdvanceEmail(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
          <Field
            label="Advance contact phone"
            error={fieldErrors.advance_contact_phone}
          >
            <input
              type="tel"
              value={advancePhone}
              onChange={(e) => setAdvancePhone(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
        </div>
      </Section>

      {/* ---------- Section 4: Milestones ---------- */}
      <Section
        title="Milestones"
        subtitle="Auto-derived from event type and date. Edit if needed."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Announce" error={fieldErrors.announce_date}>
            <input
              type="date"
              value={announceDate}
              onChange={(e) => setAnnounceOverride(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
          <Field label="Begin art" error={fieldErrors.begin_art_date}>
            <input
              type="date"
              value={beginArtDate}
              onChange={(e) => setBeginArtOverride(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
          <Field label="Art due" error={fieldErrors.art_due_date}>
            <input
              type="date"
              value={artDueDate}
              onChange={(e) => setArtDueOverride(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
          <Field label="On sale" error={fieldErrors.on_sale_date}>
            <input
              type="date"
              value={onSaleDate}
              onChange={(e) => setOnSaleOverride(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
        </div>
      </Section>

      {/* ---------- Section 5: Stages ---------- */}
      <Section
        title="Stages"
        subtitle="At least one stage is required. Up to 4."
      >
        <div className="space-y-3">
          {stages.map((stage) => (
            <div
              key={stage.stage_number}
              className="flex items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50"
            >
              <span className="w-16 shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Stage {stage.stage_number}
              </span>
              <input
                type="text"
                value={stage.stage_name}
                onChange={(e) =>
                  setStages((prev) =>
                    prev.map((s) =>
                      s.stage_number === stage.stage_number
                        ? { ...s, stage_name: e.target.value }
                        : s
                    )
                  )
                }
                className={inputClass}
                disabled={pending}
                placeholder="Stage name"
              />
              {stages.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStage(stage.stage_number)}
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                  disabled={pending}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        {stages.length < 4 && (
          <button
            type="button"
            onClick={addStage}
            className="mt-3 text-xs font-medium text-zinc-700 hover:underline dark:text-zinc-300"
            disabled={pending}
          >
            + Add stage
          </button>
        )}
      </Section>

      {/* ---------- Section 6: DJ slots ---------- */}
      <Section
        title="DJ slots"
        subtitle="Each slot creates a DJ booking and a default expense line. Rate auto-fills from slot type."
      >
        {slots.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No slots yet.
          </p>
        ) : (
          <div className="space-y-3">
            {slots.map((slot) => (
              <div
                key={slot.uid}
                className="flex flex-wrap items-end gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50"
              >
                <div className="w-16 shrink-0">
                  <label className={miniLabel}>Stage</label>
                  <select
                    value={slot.stage_number}
                    onChange={(e) =>
                      updateSlot(slot.uid, {
                        stage_number: Number(e.target.value),
                      })
                    }
                    className={inputClass}
                    disabled={pending}
                  >
                    {stages.map((s) => (
                      <option key={s.stage_number} value={s.stage_number}>
                        {s.stage_number}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="w-16 shrink-0">
                  <label className={miniLabel}>Order</label>
                  <select
                    value={slot.slot_order}
                    onChange={(e) =>
                      updateSlot(slot.uid, {
                        slot_order: Number(e.target.value),
                      })
                    }
                    className={inputClass}
                    disabled={pending}
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="min-w-[140px] flex-[2]">
                  <label className={miniLabel}>Slot type</label>
                  <select
                    value={slot.slot_type}
                    onChange={(e) =>
                      updateSlot(slot.uid, {
                        slot_type: e.target.value as SlotType,
                      })
                    }
                    className={inputClass}
                    disabled={pending}
                  >
                    {SLOT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {SLOT_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="min-w-[180px] flex-[3]">
                  <label className={miniLabel}>DJ</label>
                  <select
                    value={slot.dj_id}
                    onChange={(e) =>
                      updateSlot(slot.uid, { dj_id: e.target.value })
                    }
                    className={inputClass}
                    disabled={pending}
                  >
                    <option value="">— Select DJ —</option>
                    {djs.map((dj) => (
                      <option key={dj.id} value={dj.id}>
                        {dj.dj_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="w-24 shrink-0">
                  <label className={miniLabel}>Rate</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={slot.rate}
                    onChange={(e) =>
                      updateSlot(slot.uid, { rate: e.target.value })
                    }
                    className={inputClass}
                    disabled={pending}
                  />
                </div>

                <div className="w-28 shrink-0">
                  <label className={miniLabel}>Start</label>
                  <input
                    type="time"
                    value={slot.start_time}
                    onChange={(e) =>
                      updateSlot(slot.uid, { start_time: e.target.value })
                    }
                    className={inputClass}
                    disabled={pending}
                  />
                </div>

                <div className="w-28 shrink-0">
                  <label className={miniLabel}>End</label>
                  <input
                    type="time"
                    value={slot.end_time}
                    onChange={(e) =>
                      updateSlot(slot.uid, { end_time: e.target.value })
                    }
                    className={inputClass}
                    disabled={pending}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => removeSlot(slot.uid)}
                  className="ml-auto pb-2 text-xs text-red-600 hover:underline dark:text-red-400"
                  disabled={pending}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {slots.length < 36 && (
          <button
            type="button"
            onClick={addSlot}
            className="mt-3 text-xs font-medium text-zinc-700 hover:underline dark:text-zinc-300"
            disabled={pending}
          >
            + Add DJ slot
          </button>
        )}
      </Section>

      {/* ---------- Submit row ---------- */}
      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? 'Creating…' : 'Create event'}
        </button>
        {topError && (
          <span className="text-xs text-red-600 dark:text-red-400">
            {topError}
          </span>
        )}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Tiny presentational helpers
// ---------------------------------------------------------------------------

const inputClass =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-700'

const miniLabel =
  'block text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1'

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-5">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-900"
      />
      {label}
    </label>
  )
}
