'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  EVENT_TYPES,
  PRESENTED_BY_OPTIONS,
  DEFAULT_PRESENTED_BY,
  SLOT_TYPES,
  SLOT_TYPE_LABELS,
  SLOT_DEFAULT_RATES,
  US_STATES,
  addMinutes,
  type EventType,
  type PresentedBy,
  type SlotType,
} from '@/lib/event-defaults'
import { deleteEvent, updateEvent, type UpdateEventResult } from './actions'

/**
 * Admin event-edit form.
 *
 * Mirrors NewEventForm visually and structurally. Differences:
 *   - Initial state hydrates from `initial` prop (server prefetch).
 *   - Stages and slots track an `id` per row when one exists in the DB.
 *     New rows added in this form get no id; the server diffs against the
 *     DB, deleting rows whose ids disappear, inserting rows with no id.
 *   - Milestone dates initialize from the DB and are admin-editable; we
 *     don't auto-rederive on date/type change (avoids clobbering manual
 *     overrides set in prior sessions).
 *   - Submit handler calls updateEvent. On success: refresh + flash banner.
 *
 * Visual primitives (Section, Field, Checkbox, inputClass, miniLabel) are
 * duplicated from the create form to keep the two forms cleanly separate;
 * if drift becomes painful we'll lift them into _components/.
 */

type Dj = { id: string; dj_name: string; region: string | null }
type Venue = {
  id: string
  name: string
  city: string
  state: string
  address: string | null
}
type Vendor = { id: string; company_name: string }

type StageRow = {
  uid: string
  id?: string // present for existing DB rows
  stage_number: number
  stage_name: string
}

type SlotRow = {
  uid: string
  id?: string
  stage_number: number
  slot_order: number
  slot_type: SlotType
  dj_id: string
  rate: string
  start_time: string
  end_time: string
}

type VendorRow = {
  uid: string
  vendor_id: string
}

function newVendorRow(): VendorRow {
  return { uid: crypto.randomUUID(), vendor_id: '' }
}

export type EditInitial = {
  id: string
  type: EventType
  date: string
  title: string
  city: string
  state: string
  venue_name: string
  venue_address: string
  presented_by: PresentedBy
  status: 'tentative' | 'confirmed'
  collab: boolean
  doors_time: string
  end_time: string
  losgoths_load_in_time: string
  dj_load_in_time: string
  capacity: string
  guarantee: boolean
  bar_included: boolean
  rent: string
  split_pct: string
  venue_tix_fee: string
  advance_contact_email: string
  advance_contact_phone: string
  announce_date: string
  begin_art_date: string
  art_due_date: string
  on_sale_date: string
  stages: { id: string; stage_number: number; stage_name: string }[]
  slots: {
    id: string
    stage_number: number
    slot_order: number
    slot_type: string
    dj_id: string
    rate: string
    start_time: string
    end_time: string
  }[]
  vendor_ids: string[]
}

export function EditEventForm({
  djs,
  venues,
  vendors,
  initial,
}: {
  djs: Dj[]
  venues: Venue[]
  vendors: Vendor[]
  initial: EditInitial
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [deleting, startDelete] = useTransition()
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [topError, setTopError] = useState<string | null>(null)
  const [topSuccess, setTopSuccess] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // -------- Core fields --------------------------------------------------
  const [type, setType] = useState<EventType>(initial.type)
  const [date, setDate] = useState<string>(initial.date)
  const [title, setTitle] = useState(initial.title)
  const [city, setCity] = useState(initial.city)
  const [state, setState] = useState(initial.state)
  const [venueName, setVenueName] = useState(initial.venue_name)
  const [venueAddress, setVenueAddress] = useState(initial.venue_address)
  const [presentedBy, setPresentedBy] = useState<PresentedBy>(
    initial.presented_by
  )
  const [status, setStatus] = useState<'tentative' | 'confirmed'>(
    initial.status
  )
  const [collab, setCollab] = useState(initial.collab)
  const [doorsTime, setDoorsTime] = useState(initial.doors_time)
  const [endTime, setEndTime] = useState(initial.end_time)
  const [losgothsLoadInTime, setLosgothsLoadInTime] = useState(
    initial.losgoths_load_in_time
  )
  const [djLoadInTime, setDjLoadInTime] = useState(initial.dj_load_in_time)
  const [capacity, setCapacity] = useState(initial.capacity)
  const [guarantee, setGuarantee] = useState(initial.guarantee)
  const [barIncluded, setBarIncluded] = useState(initial.bar_included)
  const [rent, setRent] = useState(initial.rent)
  const [splitPct, setSplitPct] = useState(initial.split_pct)
  const [venueTixFee, setVenueTixFee] = useState(initial.venue_tix_fee)
  const [advanceEmail, setAdvanceEmail] = useState(initial.advance_contact_email)
  const [advancePhone, setAdvancePhone] = useState(initial.advance_contact_phone)

  // -------- Milestones (DB-loaded; admin-editable) ----------------------
  const [announceDate, setAnnounceDate] = useState(initial.announce_date)
  const [beginArtDate, setBeginArtDate] = useState(initial.begin_art_date)
  const [artDueDate, setArtDueDate] = useState(initial.art_due_date)
  const [onSaleDate, setOnSaleDate] = useState(initial.on_sale_date)

  // -------- Stages -------------------------------------------------------
  const [stages, setStages] = useState<StageRow[]>(() =>
    initial.stages.map((s) => ({
      uid: crypto.randomUUID(),
      id: s.id,
      stage_number: s.stage_number,
      stage_name: s.stage_name,
    }))
  )

  // -------- Slots --------------------------------------------------------
  const [slots, setSlots] = useState<SlotRow[]>(() =>
    initial.slots.map((s) => ({
      uid: crypto.randomUUID(),
      id: s.id,
      stage_number: s.stage_number,
      slot_order: s.slot_order,
      slot_type: s.slot_type as SlotType,
      dj_id: s.dj_id,
      rate: s.rate,
      start_time: s.start_time,
      end_time: s.end_time,
    }))
  )
  const tbdDjId = djs.find((d) => d.dj_name === 'TBD')?.id ?? ''

  // -------- Vendors -------------------------------------------------------
  // Same shape as the DJ slots section: one dropdown row at a time, "+ Add
  // vendor" appends another. Hydrate one row per already-assigned vendor;
  // fall back to a single empty row when none are assigned yet.
  const [vendorRows, setVendorRows] = useState<VendorRow[]>(() =>
    initial.vendor_ids.length > 0
      ? initial.vendor_ids.map((id) => ({
          uid: crypto.randomUUID(),
          vendor_id: id,
        }))
      : [newVendorRow()]
  )

  function addVendorRow() {
    setVendorRows((prev) => [...prev, newVendorRow()])
  }

  function removeVendorRow(uid: string) {
    setVendorRows((prev) => prev.filter((r) => r.uid !== uid))
  }

  function updateVendorRow(uid: string, vendor_id: string) {
    setVendorRows((prev) =>
      prev.map((r) => (r.uid === uid ? { ...r, vendor_id } : r))
    )
  }

  // -------- Venue autocomplete ------------------------------------------
  const venueSuggestions = useMemo(() => {
    const c = city.trim().toLowerCase()
    if (!c) return []
    const v = venueName.trim().toLowerCase()
    return venues
      .filter((venue) => venue.city.trim().toLowerCase() === c)
      .filter((venue) => (v ? venue.name.toLowerCase().includes(v) : true))
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
    setTopSuccess(null)
    setFieldErrors({})

    const clientError = clientValidate()
    if (clientError) {
      setTopError(clientError)
      return
    }

    const payload = {
      id: initial.id,
      type,
      date,
      title: title.trim(),
      city: city.trim(),
      state: state.trim(),
      venue_name: venueName.trim(),
      venue_address: venueAddress.trim(),
      presented_by: presentedBy,
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
        id: s.id,
        stage_number: s.stage_number,
        stage_name: s.stage_name.trim(),
      })),
      slots: slots.map((s) => ({
        id: s.id,
        stage_number: s.stage_number,
        slot_order: s.slot_order,
        slot_type: s.slot_type,
        dj_id: s.dj_id,
        rate: s.rate,
        start_time: s.start_time,
        end_time: s.end_time,
      })),
      vendor_ids: Array.from(
        new Set(vendorRows.map((r) => r.vendor_id).filter((id) => id !== ''))
      ),
    }

    startTransition(async () => {
      const result: UpdateEventResult = await updateEvent(
        payload as Parameters<typeof updateEvent>[0]
      )
      if (result.ok) {
        setTopSuccess(`Saved · ${result.eventCode}`)
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
        setTopError('You are not authorized to edit events.')
        return
      }
      if (result.reason === 'not_found') {
        setTopError('Event not found.')
        return
      }
      setTopError(result.message)
    })
  }

  // ---------------------------------------------------------------- Helpers

  function addStage() {
    if (stages.length >= 4) return
    const next = stages.length + 1
    setStages([
      ...stages,
      {
        uid: crypto.randomUUID(),
        stage_number: next,
        stage_name: `Stage ${next}`,
      },
    ])
  }

  function removeStage(uid: string) {
    if (stages.length <= 1) return
    const removed = stages.find((s) => s.uid === uid)
    if (!removed) return
    // Refuse to remove a stage that still has DJ slots assigned to it.
    // Chase's choice (option A): admins must explicitly clear the slots
    // first. We surface the warning right at the click rather than
    // letting it travel to the server.
    const blockingSlots = slots.filter(
      (s) => s.stage_number === removed.stage_number
    )
    if (blockingSlots.length > 0) {
      setTopError(
        `Stage ${removed.stage_number} has ${blockingSlots.length} DJ slot${blockingSlots.length === 1 ? '' : 's'} assigned. Remove ${blockingSlots.length === 1 ? 'it' : 'them'} first.`
      )
      return
    }
    setTopError(null)
    const remaining = stages.filter((s) => s.uid !== uid)
    // Renumber to keep stage_number contiguous 1..N.
    const renumbered = remaining.map((s, i) => ({
      ...s,
      stage_number: i + 1,
    }))
    setStages(renumbered)
    // Re-map any remaining slots' stage_number under the new numbering
    // (stage_number changes because we may have removed a stage above
    // them in the order).
    const oldToNew = new Map<number, number>()
    remaining.forEach((s, i) => oldToNew.set(s.stage_number, i + 1))
    setSlots((prev) =>
      prev.map((s) => ({
        ...s,
        stage_number: oldToNew.get(s.stage_number) ?? s.stage_number,
      }))
    )
  }

  function addSlot() {
    if (slots.length >= 36) return
    const stage1Slots = slots.filter((s) => s.stage_number === 1)
    const nextOrder =
      (stage1Slots.length > 0
        ? Math.max(...stage1Slots.map((s) => s.slot_order))
        : 0) + 1
    setSlots([
      ...slots,
      {
        uid: crypto.randomUUID(),
        stage_number: 1,
        slot_order: Math.min(nextOrder, 6),
        slot_type: 'open',
        dj_id: tbdDjId,
        rate: String(SLOT_DEFAULT_RATES['open']),
        // Phase 14: empty start/end means "use the doors+offset auto
        // calculation in run-of-show". Admins fill these in only to
        // override the default cadence for a specific slot.
        start_time: '',
        end_time: '',
      },
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
        if (patch.slot_type && patch.slot_type !== s.slot_type) {
          const oldDefault = String(SLOT_DEFAULT_RATES[s.slot_type] ?? 0)
          if (s.rate === oldDefault || s.rate === '' || s.rate === '0') {
            next.rate = String(SLOT_DEFAULT_RATES[patch.slot_type] ?? 0)
          }
        }
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

  // Mobile fix (2026-07-26): window.confirm() is silently suppressed
  // inside iOS home-screen (PWA) contexts and most in-app browsers, so
  // `if (!confirm(...)) return` used to no-op the tap on mobile with no
  // dialog ever shown. Two-tap inline confirm (armed state) works the
  // same everywhere. See view-toolbar.tsx / email-button.tsx for the
  // same fix applied elsewhere.
  function handleDelete() {
    setDeleteArmed(false)
    startDelete(async () => {
      const result = await deleteEvent({ event_id: initial.id })
      // deleteEvent calls redirect() on success — control should never
      // return here in the success path.
      if (!result?.ok) {
        setTopError(deleteErrorMessage(result))
      }
    })
  }

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
            />
          </Field>

          <Field label="City" error={fieldErrors.city}>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={inputClass}
              disabled={pending}
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
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                className={inputClass}
                disabled={pending}
                autoComplete="off"
              />
              {showSuggestions && venueSuggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {venueSuggestions.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setVenueName(v.name)
                          setVenueAddress(v.address ?? '')
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

          <Field
            label="Venue address (optional)"
            error={fieldErrors.venue_address}
            className="sm:col-span-2"
          >
            <input
              type="text"
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
              className={inputClass}
              disabled={pending}
              placeholder="448 S Main St"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Saved on the venue itself, so filling this in once carries
              over to every other event at {venueName || 'this venue'}.
            </p>
          </Field>

          <Field label="Presented by" error={fieldErrors.presented_by}>
            <select
              value={presentedBy}
              onChange={(e) => setPresentedBy(e.target.value as PresentedBy)}
              className={inputClass}
              disabled={pending}
            >
              {PRESENTED_BY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Controls the branding at the top of the Run of Show and Budget
              PDFs. {DEFAULT_PRESENTED_BY} keeps the usual logo; anything else
              prints as text instead.
            </p>
          </Field>
        </div>
      </Section>

      {/* ---------- Section 2: Schedule ---------- */}
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
        subtitle="Loaded from the saved event. Edit if needed."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Announce" error={fieldErrors.announce_date}>
            <input
              type="date"
              value={announceDate}
              onChange={(e) => setAnnounceDate(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
          <Field label="Begin art" error={fieldErrors.begin_art_date}>
            <input
              type="date"
              value={beginArtDate}
              onChange={(e) => setBeginArtDate(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
          <Field label="Art due" error={fieldErrors.art_due_date}>
            <input
              type="date"
              value={artDueDate}
              onChange={(e) => setArtDueDate(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
          <Field label="On sale" error={fieldErrors.on_sale_date}>
            <input
              type="date"
              value={onSaleDate}
              onChange={(e) => setOnSaleDate(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
          </Field>
        </div>
      </Section>

      {/* ---------- Section 5: Stages ---------- */}
      <Section
        title="Stages"
        subtitle="At least one stage. Up to 4. Removing a stage with booked DJs is blocked."
      >
        <div className="space-y-3">
          {stages.map((stage) => (
            <div
              key={stage.uid}
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
                      s.uid === stage.uid
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
                  onClick={() => removeStage(stage.uid)}
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
        subtitle="Edits to slot DJs / rates do not auto-update budget expense lines (Phase 9)."
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
                      <option key={s.uid} value={s.stage_number}>
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
                  <label className={miniLabel} title="Leave blank for auto from doors + slot offset">
                    Start (auto)
                  </label>
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
                  <label className={miniLabel} title="Leave blank for auto">
                    End (auto)
                  </label>
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

      {/* ---------- Section 7: Vendors ---------- */}
      <Section
        title="Vendors"
        subtitle="Vendors working this event. They'll be added to the Run of Show email recipient list."
      >
        {vendors.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No vendors on roster yet.
          </p>
        ) : (
          <>
            {vendorRows.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No vendors added yet.
              </p>
            ) : (
              <div className="space-y-3">
                {vendorRows.map((row) => (
                  <div
                    key={row.uid}
                    className="flex flex-wrap items-end gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50"
                  >
                    <div className="min-w-[200px] flex-1">
                      <label className={miniLabel}>Vendor</label>
                      <select
                        value={row.vendor_id}
                        onChange={(e) =>
                          updateVendorRow(row.uid, e.target.value)
                        }
                        className={inputClass}
                        disabled={pending}
                      >
                        <option value="">— Select vendor —</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.company_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeVendorRow(row.uid)}
                      className="pb-2 text-xs text-red-600 hover:underline dark:text-red-400"
                      disabled={pending}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={addVendorRow}
              className="mt-3 text-xs font-medium text-zinc-700 hover:underline dark:text-zinc-300"
              disabled={pending}
            >
              + Add vendor
            </button>
          </>
        )}
      </Section>

      {/* ---------- Submit row ---------- */}
      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button
          type="submit"
          disabled={pending || deleting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        {deleteArmed ? (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 text-right">
            <span className="text-xs text-rose-700 dark:text-rose-300">
              Permanently delete &quot;{title || initial.title}&quot;? This
              removes stages, slots, budget, and collaborators too.
            </span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending || deleting}
              className="rounded-md border border-rose-200 bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-700 dark:hover:bg-rose-600"
            >
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button
              type="button"
              onClick={() => setDeleteArmed(false)}
              disabled={pending || deleting}
              className="rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDeleteArmed(true)}
            disabled={pending || deleting}
            className="ml-auto rounded-md border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-zinc-950 dark:text-rose-300 dark:hover:bg-rose-950/40"
          >
            Delete event
          </button>
        )}
        {topSuccess && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            ✓ {topSuccess}
          </span>
        )}
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
// Tiny presentational helpers (mirrored from new-event-form.tsx)
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

function deleteErrorMessage(
  result?: { ok: false; reason: string; message?: string } | { ok: true }
): string {
  if (!result) return 'Delete failed.'
  if (result.ok) return 'OK'
  switch (result.reason) {
    case 'unauth':
      return 'You must be signed in.'
    case 'forbidden':
      return 'Only admins can delete events.'
    case 'invalid':
      return result.message ?? 'Invalid input.'
    case 'db_failed':
      return result.message ?? 'Database error. Try again.'
    default:
      return 'Something went wrong.'
  }
}
