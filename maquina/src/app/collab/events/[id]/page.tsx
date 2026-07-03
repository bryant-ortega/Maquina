import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  buildSchedule,
  type RunOfShowSlot,
} from '@/lib/run-of-show'
import {
  computeBudget,
  formatUSD,
} from '@/lib/budget'
import type { SlotType } from '@/lib/event-defaults'

/**
 * Read-only event detail for collaboration partners — Phase 13.
 *
 * Single page, two sections (Run of show / Budget summary). No edit
 * forms, no Actualize button, no delete. Mirrors what an admin would
 * see in /events/[id]/runofshow + the totals row of /events/[id]/budget,
 * but with all interaction stripped.
 *
 * Data flows:
 *   - Event scalars + stages + slots + venue → render Run of Show table
 *     by reusing buildSchedule().
 *   - Estimated budget + expenses + tiers → run computeBudget() and
 *     show the summary numbers (Income / Expenses / Profit / Walkout).
 *
 * RLS already filters every read here to events the user is attached to,
 * so a 404 from the event lookup means "you don't have access" — same
 * effect as if the event didn't exist.
 *
 * The Export PDF buttons hand off to the existing /api/pdf route, which
 * we'll teach to honor the collab role in Phase 13.4.
 */
export default async function CollabEventDetailPage({
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
        'id, event_id, title, date, city, state, doors_time, end_time, status, split_pct, bar_included, venues(name)'
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('event_stages')
      .select('id, stage_number, stage_name')
      .eq('event_id', id)
      .order('stage_number', { ascending: true }),
    supabase
      .from('event_dj_slots')
      .select('id, stage_id, slot_order, slot_type, start_time, djs(dj_name)')
      .eq('event_id', id)
      .order('stage_id', { ascending: true })
      .order('slot_order', { ascending: true }),
  ])

  if (eventErr || !event) notFound()

  // ----- Budget summary (estimated) -----
  const { data: estBudget } = await supabase
    .from('event_budgets')
    .select(
      'id, drop_off, guests, tix_tax, deductions, sponsor_income, vendor_income, merch_gross, merch_pct_after_fees, merch_cogs_pct, merch_seller_fee, bar_per_head, bar_pct'
    )
    .eq('event_id', id)
    .eq('budget_type', 'estimated')
    .maybeSingle()

  let budgetSummary: ReturnType<typeof computeBudget> | null = null
  if (estBudget) {
    const [{ data: rawExpenses }, { data: rawTiers }] = await Promise.all([
      supabase
        .from('event_budget_expenses')
        .select('id, qty, price')
        .eq('budget_id', estBudget.id),
      supabase
        .from('event_tix_tiers')
        .select('id, price, sold')
        .eq('budget_id', estBudget.id),
    ])
    budgetSummary = computeBudget({
      tiers: (rawTiers ?? []).map((t) => ({
        price: Number(t.price ?? 0),
        sold: Number(t.sold ?? 0),
      })),
      drop_off: Number(estBudget.drop_off ?? 0),
      guests: Number(estBudget.guests ?? 0),
      tix_tax: Number(estBudget.tix_tax ?? 0),
      deductions: Number(estBudget.deductions ?? 0),
      sponsor_income: Number(estBudget.sponsor_income ?? 0),
      vendor_income: Number(estBudget.vendor_income ?? 0),
      split_pct: Number(event.split_pct ?? 0),
      bar_included: !!event.bar_included,
      merch_gross: Number(estBudget.merch_gross ?? 0),
      merch_pct_after_fees: Number(estBudget.merch_pct_after_fees ?? 0),
      merch_cogs_pct: Number(estBudget.merch_cogs_pct ?? 0),
      merch_seller_fee: Number(estBudget.merch_seller_fee ?? 0),
      bar_per_head: Number(estBudget.bar_per_head ?? 24),
      bar_pct: Number(estBudget.bar_pct ?? 0.16),
      expenses: (rawExpenses ?? []).map((e) => ({
        qty: Number(e.qty ?? 0),
        price: Number(e.price ?? 0),
      })),
    })
  }

  // ----- Run of show: group slots by stage_id, build per-stage schedule -----
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
  }
  const stagePayload = (stages ?? []).map((s) => ({
    stageNumber: s.stage_number as number,
    stageName: s.stage_name as string,
    schedule: buildSchedule(eventTimes, slotsByStage.get(s.id as string) ?? []),
  }))

  const venueName = Array.isArray(event.venues)
    ? event.venues[0]?.name
    : (event.venues as { name: string } | null)?.name

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <Link
            href="/collab/events"
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← All events
          </Link>
        </div>

        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {event.title}
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {new Date(`${event.date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}{' '}
              · {venueName ?? '—'} · {event.city}, {event.state}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/pdf?view=runofshow&eventId=${id}`}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Run of show PDF
            </a>
            <a
              href={`/api/pdf?view=budget&eventId=${id}&budget=estimated`}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Budget PDF
            </a>
          </div>
        </header>

        {/* ---------- Run of show ---------- */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Run of show
          </h2>

          {stagePayload.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
              No stages on this event yet.
            </div>
          ) : (
            stagePayload.map(({ stageNumber, stageName, schedule }) => (
              <div
                key={stageNumber}
                className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
                  <h3 className="text-sm font-semibold tracking-wide text-zinc-700 dark:text-zinc-200">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Stage {stageNumber}
                    </span>{' '}
                    · {stageName}
                  </h3>
                </header>
                <table className="w-full text-sm">
                  <tbody>
                    {schedule.rows.map((row, idx) => (
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
              </div>
            ))
          )}
        </section>

        {/* ---------- Budget summary ---------- */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Budget summary (estimated)
          </h2>

          {!budgetSummary ? (
            <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
              No budget yet on this event.
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <table className="w-full text-sm">
                <tbody>
                  <SummaryRow
                    label="Paid attendance"
                    value={String(budgetSummary.paid_attendance)}
                  />
                  <SummaryRow
                    label="Gross ticket sales"
                    value={formatUSD(budgetSummary.gross_tix_total)}
                  />
                  {budgetSummary.tix_tax > 0 && (
                    <SummaryRow
                      label="Net ticket sales (after tax)"
                      value={formatUSD(budgetSummary.net_tix_total)}
                    />
                  )}
                  <SummaryRow
                    label="Walkout"
                    value={formatUSD(budgetSummary.walkout)}
                  />
                  <SummaryRow
                    label="Estimated income"
                    value={formatUSD(budgetSummary.est_income)}
                  />
                  <SummaryRow
                    label="Estimated expenses"
                    value={formatUSD(budgetSummary.est_expenses)}
                  />
                  <SummaryRow
                    label="Estimated profit"
                    value={formatUSD(budgetSummary.est_profit)}
                    emphasize
                    positive={budgetSummary.est_profit >= 0}
                  />
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  emphasize,
  positive,
}: {
  label: string
  value: string
  emphasize?: boolean
  positive?: boolean
}) {
  return (
    <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
      <td
        className={
          emphasize
            ? 'px-5 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50'
            : 'px-5 py-2 text-sm text-zinc-700 dark:text-zinc-300'
        }
      >
        {label}
      </td>
      <td
        className={
          emphasize
            ? `px-5 py-3 text-right font-mono text-sm font-semibold tabular-nums ${
                positive
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`
            : 'px-5 py-2 text-right font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-300'
        }
      >
        {value}
      </td>
    </tr>
  )
}
