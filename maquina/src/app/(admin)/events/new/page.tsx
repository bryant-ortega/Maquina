import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NewEventForm } from './new-event-form'

/**
 * Admin event-create page (Phase 7a).
 *
 * Pre-fetches the data the form needs to render its pickers:
 *   - DJ roster (id + dj_name) for slot rows
 *   - All venues (id + name + city + state) for the find-or-create
 *     autocomplete; the client filters this list to whatever city the
 *     admin is typing
 *   - Vendor roster (id + company_name) for the vendor multi-select
 *     (migration 0031) — just a plain checklist, no rate/time/slot
 *     fields like DJs get
 *
 * Auth gate: handled by the (admin) layout.
 */
export default async function NewEventPage() {
  const supabase = await createServerSupabaseClient()

  const [{ data: djs }, { data: venues }, { data: vendors }] =
    await Promise.all([
      supabase
        .from('djs')
        .select('id, dj_name, region')
        .order('dj_name', { ascending: true }),
      supabase
        .from('venues')
        .select('id, name, city, state')
        .order('name', { ascending: true }),
      supabase
        .from('vendors')
        .select('id, company_name')
        .order('company_name', { ascending: true }),
    ])

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <Link
            href="/events"
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← All events
          </Link>
        </div>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New event</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Most fields auto-derive from the date and event type. Tweak as
            needed before saving.
          </p>
        </header>

        <NewEventForm
          djs={djs ?? []}
          venues={venues ?? []}
          vendors={vendors ?? []}
        />
      </div>
    </div>
  )
}
