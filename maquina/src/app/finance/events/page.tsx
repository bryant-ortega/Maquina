import Link from 'next/link'
import { isPastDate } from '@/lib/utils'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Finance events index — read-only. Mirrors (admin)/events/page.tsx's
 * layout and sort order (strict ascending by date) but links into
 * /finance/events/[id] (budget view only, no edit form) and drops the
 * "+ New event" action and the DJ-fraction column, which aren't part of
 * finance's scope (migration 0030: budgets + DJ roster + vendor roster +
 * W-9 downloads, no edit rights).
 */
export default async function FinanceEventsPage() {
  const supabase = await createServerSupabaseClient()

  const { data: rawEvents } = await supabase
    .from('events')
    .select('id, date, event_id, title, status, city, state, venues(name)')

  type RawEvent = {
    id: string
    date: string
    event_id: string
    title: string
    status: string
    city: string
    state: string
    venues: { name: string } | { name: string }[] | null
  }

  const events = ((rawEvents ?? []) as RawEvent[])
    .map((e) => ({
      ...e,
      venueName: Array.isArray(e.venues) ? e.venues[0]?.name : e.venues?.name,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {events.length} {events.length === 1 ? 'event' : 'events'} total.
            Upcoming first. Read-only.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Venue</th>
                <th className="px-4 py-2.5 font-medium">City</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {events.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-zinc-500 dark:text-zinc-400"
                  >
                    No events yet.
                  </td>
                </tr>
              ) : (
                events.map((e) => (
                  <tr
                    key={e.id}
                    className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${
                      isPastDate(e.date) ? 'opacity-45' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      <Link href={`/finance/events/${e.id}`} className="block">
                        {new Date(`${e.date}T00:00:00`).toLocaleDateString(
                          undefined,
                          { year: 'numeric', month: 'short', day: 'numeric' }
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/finance/events/${e.id}`}
                        className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                      >
                        {e.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      <Link href={`/finance/events/${e.id}`} className="block">
                        {e.venueName ?? '—'}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      <Link href={`/finance/events/${e.id}`} className="block">
                        {e.city}, {e.state}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/finance/events/${e.id}`} className="block">
                        <StatusBadge status={e.status} />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const isConfirmed = status === 'confirmed'
  return (
    <span
      className={
        isConfirmed
          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'
          : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
      }
    >
      {status}
    </span>
  )
}
