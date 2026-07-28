import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Contract shell — Phase 17i, renamed from 'designer' in migration 0029.
 *
 * Wraps every /contract/* route with minimal chrome: a Maquina brand
 * row at the top and a sign-out button. No sidebar, no admin links,
 * no Events / DJs / Settings. A Contract-role user sees one read-only
 * page — /contract/view — and nothing else. Contract is typically
 * layered on top of an existing vendor account (photographer,
 * videographer, flyer designer) via a toggle on the admin vendor
 * detail page — see src/app/(admin)/vendors/[id]/edit-form.tsx.
 *
 * Auth gates:
 *   1. Must be signed in.
 *   2. profiles.roles must include 'contract' or 'admin'.
 *      - Admins can preview /contract/* without losing their session.
 *      - Everyone else gets routed to their own surface.
 *
 * Hard guarantee: even if the UI gates fail, RLS keeps Contract users
 * out of every table that wasn't explicitly opened up (migration
 * 0020, renamed in 0029). Notably: budgets, expenses, ticket tiers,
 * and any view with audience != 'contract' are unreadable.
 */
export default async function ContractLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, roles')
    .eq('user_id', user.id)
    .maybeSingle()

  const roles: string[] = profile?.roles ?? []
  if (!roles.includes('contract') && !roles.includes('admin')) {
    if (roles.includes('viewer')) redirect('/viewer/year')
    if (roles.includes('finance')) redirect('/finance/events')
    if (roles.includes('collab')) redirect('/collab/events')
    if (roles.includes('vendor')) redirect('/vendor/profile')
    redirect('/dj/profile')
  }

  const displayName = profile?.display_name ?? user.email ?? 'Contractor'

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="text-sm font-semibold tracking-tight">MΛQUIИΛ</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              LosGothsCo · Contractor
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-zinc-500 dark:text-zinc-400 sm:inline">
              {displayName}
            </span>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  )
}
