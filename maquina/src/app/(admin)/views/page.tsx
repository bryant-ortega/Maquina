import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { duplicateViewForm } from './actions'

/**
 * Views index — Phase 17c.
 *
 * Lists every row in the `views` table — the four seeded system views
 * (Month, Year, Posting calendar, DJ analytics) plus any custom views
 * the admin has created. System views are read-only here: clicking
 * one opens its built-in page. Custom views get Edit / Delete actions
 * that land on the editor (17d) and a confirm-and-delete server
 * action.
 *
 * The "+ New view" button takes the admin to /views/new (17d). Until
 * that route is built it'll 404 — that's fine, we ship 17c first.
 *
 * Auth gate is owned by the (admin) layout.
 */
export default async function ViewsIndexPage() {
  const supabase = await createServerSupabaseClient()

  const { data: views } = await supabase
    .from('views')
    .select(
      'id, name, description, audience, is_system, slug, created_at'
    )
    // System views first, then custom — within each group, alphabetic.
    .order('is_system', { ascending: false })
    .order('name', { ascending: true })

  type ViewRow = {
    id: string
    name: string
    description: string | null
    audience: string
    is_system: boolean
    slug: string | null
    created_at: string
  }

  const rows = (views ?? []) as ViewRow[]
  const systemRows = rows.filter((r) => r.is_system)
  const customRows = rows.filter((r) => !r.is_system)

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Views</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Built-in views are read-only. Build custom views to share
              event data with contract users, venues, DJs, or partners
              without exposing internal fields.
            </p>
          </div>
          <Link
            href="/views/new"
            className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            + New view
          </Link>
        </header>

        <Section title="Built-in" subtitle="Read-only — duplicate to customize.">
          {systemRows.length === 0 ? (
            <Empty>
              No built-in views found. Run migration 0010 to seed them.
            </Empty>
          ) : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-900 dark:border-zinc-800 dark:bg-zinc-950">
              {systemRows.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {v.name}
                      </span>
                      <SystemBadge />
                      <AudienceBadge audience={v.audience} />
                    </div>
                    {v.description ? (
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {v.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {systemSlugToHref(v.slug) ? (
                      <Link
                        href={systemSlugToHref(v.slug)!}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      >
                        Open
                      </Link>
                    ) : null}
                    <form action={duplicateViewForm}>
                      <input type="hidden" name="id" value={v.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      >
                        Duplicate
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Custom"
          subtitle={
            customRows.length === 0
              ? 'No custom views yet.'
              : `${customRows.length} custom ${
                  customRows.length === 1 ? 'view' : 'views'
                }.`
          }
        >
          {customRows.length === 0 ? (
            <Empty>
              No custom views yet.{' '}
              <Link
                href="/views/new"
                className="font-medium underline hover:no-underline"
              >
                Create one
              </Link>
              .
            </Empty>
          ) : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-900 dark:border-zinc-800 dark:bg-zinc-950">
              {customRows.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/views/${v.id}`}
                        className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                      >
                        {v.name}
                      </Link>
                      <AudienceBadge audience={v.audience} />
                    </div>
                    {v.description ? (
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {v.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link
                      href={`/views/${v.id}`}
                      className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Open
                    </Link>
                    <Link
                      href={`/views/${v.id}/edit`}
                      className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Edit
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers / sub-components
// ---------------------------------------------------------------------------

/** Maps a system view's stable slug to the URL of its built-in page.
 *  Returns null for unknown slugs (defensive — should never happen
 *  unless someone hand-edits the seed). */
function systemSlugToHref(slug: string | null): string | null {
  switch (slug) {
    case 'system_month':
      return '/views/month'
    case 'system_year':
      return '/views/year'
    case 'system_posting_calendar':
      return '/views/posting-calendar'
    case 'system_dj_analytics':
      return '/views/dj-analytics'
    default:
      return null
  }
}

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
    <section className="space-y-3">
      <header className="space-y-0.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          {title}
        </h2>
        {subtitle ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {subtitle}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
      {children}
    </div>
  )
}

function SystemBadge() {
  return (
    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      Built-in
    </span>
  )
}

function AudienceBadge({ audience }: { audience: string }) {
  // Tinted by audience so it's easy to scan a long list.
  const cls =
    audience === 'contract'
      ? 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200'
      : audience === 'venue'
        ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200'
        : audience === 'dj'
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
          : audience === 'partner'
            ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'
            : audience === 'internal'
              ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
              : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {audience}
    </span>
  )
}
