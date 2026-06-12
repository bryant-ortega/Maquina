import Link from 'next/link'
import { EmailRunOfShowButton } from './email-button'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  buildSchedule,
  type RunOfShowSlot,
  type RunOfShowRow,
} from '@/lib/run-of-show'
import type { SlotType } from '@/lib/event-defaults'

/**
 * Run of Show — Phase 11.
 *
 * Per-stage schedule auto-generated from doors_time, end_time, and the
 * DJ slots booked for that stage. Production rows (load-in, soundcheck,
 * doors, load-out) always render; DJ rows only render for slot types
 * that actually have a booking (per BUILD_PLAN: "no empty rows for
 * unbooked slots").
 *
 * No editing happens here — admins change times by editing the event,
 * and re-add/remove DJs by editing slots. This page is a derived view.
 *
 * If the event has multiple stages, each stage gets its own card so the
 * admin can see all schedules at a glance. Stages are ordered by
 * stage_number.
 *
 * Auth gate is owned by the (admin) layout.
 */
export default async function RunOfShowPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const [
    { data: event, error: eventErr },
    { data: stages },
    { data: slots },
  ] = await Promise.all([
    supabase
      .from('events')
      .select(
        'id, event_id, title, date, city, state, doors_time, end_time, losgoths_load_in_time, dj_load_in_time'
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('event_stages')
      .select('id, stage_number, stage_name')
      .eq('event_id', id)
      .order('stage_number', { ascending: true }),
    // Slots come with their DJ name joined in. We order by slot_order so
    // same-time rows (e.g., Opener + Resident at doors) keep a stable
    // visual order on the page.
    supabase
      .from('event_dj_slots')
      .select(
        'id, stage_id, slot_order, slot_type, start_time, djs(dj_name)'
      )
      .eq('event_id', id)
      .order('stage_id', { ascending: true })
      .order('slot_order', { ascending: true }),
  ])

  if (eventErr || !event) notFound()

  // Group slots by stage for per-stage schedule generation.
  const slotsByStage = new Map<string, RunOfShowSlot[]>()
  for (const raw of slots ?? []) {
    const stageId = raw.stage_id as string
    // Supabase types joined relations as either an array (one-to-many) or a
    // single object (one-to-one). djs is one-to-one in this query.
    const dj = Array.isArray(raw.djs)
      ? raw.djs[0]
      : (raw.djs as { dj_name: string } | null)
    const list = slotsByStage.get(stageId) ?? []
    list.push({
      slot_type: raw.slot_type as SlotType,
      dj_name: (dj?.dj_name as string) ?? 'TBA',
      start_time: (raw.start_time as string | null) ?? null,
    })
    slotsByStage.set(stageId, list)
  }

  const eventTimes = {
    doors_time: event.doors_time as string | null,
    end_time: event.end_time as string | null,
    losgoths_load_in_time: event.losgoths_load_in_time as string | null,
    dj_load_in_time: event.dj_load_in_time as string | null,
  }

  // Strip ':SS' tail off the wall-clock display (Postgres TIME comes
  // back as 'HH:MM:SS'). Used in the header summary line only.
  const trim = (t: string | null | undefined) =>
    t ? String(t).split(':').slice(0, 2).join(':') : '—'

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <Link
            href={`/events/${id}/edit`}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← Back to event
          </Link>
        </div>

        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Run of show
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {event.title} ·{' '}
              {new Date(`${event.date}T00:00:00`).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}{' '}
              · {event.city}, {event.state}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Doors {trim(event.doors_time as string | null)} · End{' '}
              {trim(event.end_time as string | null)}
            </p>
            <p className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
              {event.event_id}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-start">
            <a
              href={`/api/pdf?view=runofshow&eventId=${id}`}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Export PDF
            </a>
            <EmailRunOfShowButton eventId={id} />
          </div>
        </header>

        {(stages ?? []).length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            This event has no stages yet. Edit the event to add a stage,
            then come back.
          </div>
        ) : (
          <div className="space-y-6">
            {/*
              Compute schedules once. If ANY stage's schedule lacks a
              usable end time, surface a single warning at the top — the
              fix is on the event itself, not per-stage.
            */}
            {(() => {
              const schedules = (stages ?? []).map((stage) => ({
                stage,
                result: buildSchedule(
                  eventTimes,
                  slotsByStage.get(stage.id as string) ?? []
                ),
              }))
              const anyEndMissing = schedules.some((s) => !s.result.endUsable)
              return (
                <>
                  {anyEndMissing ? (
                    <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      <span aria-hidden="true">⚠</span>
                      <div className="space-y-1">
                        <p className="font-medium">
                          End time is missing or matches doors.
                        </p>
                        <p>
                          Set an end time on the{' '}
                          <Link
                            href={`/events/${id}/edit`}
                            className="underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-100"
                          >
                            event edit page
                          </Link>{' '}
                          to generate the rest of the schedule (Main support,
                          Headliner, Closer, End / load-out).
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {schedules.map(({ stage, result }) => (
                    <StageCard
                      key={stage.id as string}
                      stageNumber={stage.stage_number as number}
                      stageName={stage.stage_name as string}
                      rows={result.rows}
                    />
                  ))}
                </>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stage card
// ---------------------------------------------------------------------------

function StageCard({
  stageNumber,
  stageName,
  rows,
}: {
  stageNumber: number
  stageName: string
  rows: RunOfShowRow[]
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-700 dark:text-zinc-200">
          <span className="text-zinc-500 dark:text-zinc-400">
            Stage {stageNumber}
          </span>{' '}
          · {stageName}
        </h2>
      </header>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={`${row.minutes}-${idx}-${row.label}`}
              className={
                row.kind === 'doors'
                  ? 'border-b border-zinc-200 bg-zinc-100 last:border-0 dark:border-zinc-800 dark:bg-zinc-900'
                  : 'border-b border-zinc-100 last:border-0 dark:border-zinc-900'
              }
            >
              <td
                className={
                  row.kind === 'doors'
                    ? 'w-32 px-5 py-2 text-left font-mono text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-50'
                    : 'w-32 px-5 py-2 text-left font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400'
                }
              >
                {row.time}
              </td>
              <td
                className={
                  row.kind === 'doors'
                    ? 'px-5 py-2 text-left font-semibold text-zinc-900 dark:text-zinc-50'
                    : row.kind === 'dj'
                      ? 'px-5 py-2 text-left text-zinc-800 dark:text-zinc-100'
                      : 'px-5 py-2 text-left text-zinc-600 dark:text-zinc-300'
                }
              >
                {row.label}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
