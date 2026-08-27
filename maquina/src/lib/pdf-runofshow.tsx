/**
 * Run of Show PDF helper.
 *
 * Both the GET /api/pdf route and the email-runofshow server action
 * need the same artefact: a finished PDF buffer plus a few labelling
 * scalars (event_id, title, date) for the filename and email subject.
 * Sharing this one function avoids drift between the two surfaces.
 *
 * The supabase client is passed in so callers can reuse their existing
 * SSR-bound client (RLS still applies on the queries).
 */

import { renderToBuffer } from '@react-pdf/renderer'
import {
  buildSchedule,
  formatHHMM12,
  parseHHMM,
  type RunOfShowSlot,
} from '@/lib/run-of-show'
import type { SlotType } from '@/lib/event-defaults'
import { RunOfShowPDF } from '@/components/pdf-templates/run-of-show-pdf'

type SBClient = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (...args: any[]) => any
  }
}

export type RenderRosResult =
  | {
      ok: true
      buffer: Buffer
      filename: string
      eventCode: string
      title: string
      date: string
      city: string
      state: string
    }
  | { ok: false; reason: 'not_found' }

export async function renderRunOfShowPdf({
  supabase,
  eventId,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  eventId: string
}): Promise<RenderRosResult> {
  const sb = supabase as SBClient
  const [
    { data: event, error: eventErr },
    { data: stages },
    { data: slots },
  ] = await Promise.all([
    sb
      .from('events')
      .select(
        'id, event_id, title, date, city, state, doors_time, end_time, losgoths_load_in_time, dj_load_in_time, presented_by, venues(name, address)'
      )
      .eq('id', eventId)
      .maybeSingle(),
    sb
      .from('event_stages')
      .select('id, stage_number, stage_name')
      .eq('event_id', eventId)
      .order('stage_number', { ascending: true }),
    sb
      .from('event_dj_slots')
      .select(
        'id, stage_id, slot_order, slot_type, start_time, djs(dj_name)'
      )
      .eq('event_id', eventId)
      .order('stage_id', { ascending: true })
      .order('slot_order', { ascending: true }),
  ])

  if (eventErr || !event) return { ok: false, reason: 'not_found' }

  // Supabase returns the venues join as an object for a to-one FK, but
  // types it as an array in some client versions — handle both shapes.
  const venueRaw = event.venues as
    | { name: string; address: string | null }
    | { name: string; address: string | null }[]
    | null
  const venue = Array.isArray(venueRaw) ? venueRaw[0] : venueRaw

  const slotsByStage = new Map<string, RunOfShowSlot[]>()
  for (const raw of slots ?? []) {
    const stageId = raw.stage_id as string
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
  const doorsMin = parseHHMM(event.doors_time as string | null)
  let endMin = parseHHMM(event.end_time as string | null)
  if (endMin < doorsMin) endMin += 1440
  const endUsable = endMin - doorsMin >= 30

  type StageRow = { id: string; stage_number: number; stage_name: string }
  const stagePayload = ((stages ?? []) as StageRow[]).map((s) => {
    const result = buildSchedule(
      eventTimes,
      slotsByStage.get(s.id) ?? []
    )
    return {
      stageNumber: s.stage_number,
      stageName: s.stage_name,
      rows: result.rows,
    }
  })

  const buffer = await renderToBuffer(
    <RunOfShowPDF
      event={{
        title: (event.title as string) ?? 'Untitled',
        date: event.date as string,
        city: (event.city as string) ?? '',
        state: (event.state as string) ?? '',
        doorsLabel: event.doors_time ? formatHHMM12(doorsMin) : '—',
        endLabel: endUsable ? formatHHMM12(endMin) : '—',
        venueName: venue?.name ?? null,
        venueAddress: venue?.address ?? null,
        presentedBy: event.presented_by as string | null,
      }}
      stages={stagePayload}
      generatedAt={new Date().toISOString()}
    />
  )

  const eventCode = (event.event_id as string) ?? eventId
  return {
    ok: true,
    buffer,
    filename: `run-of-show-${eventCode}.pdf`,
    eventCode,
    title: (event.title as string) ?? 'Untitled',
    date: event.date as string,
    city: (event.city as string) ?? '',
    state: (event.state as string) ?? '',
  }
}
