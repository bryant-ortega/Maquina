import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Designer shell — Phase 17i.
 *
 * Wraps every /designer/* route with minimal chrome: a Maquina brand
 * row at the top and a sign-out button. No sidebar, no admin links,
 * no Events / DJs / Settings. Designers see one read-only page —
 * /designer/view — and nothing else.
 *
 * Auth gates:
 *   1. Must be signed in.
 *   2. profiles.role must be 'designer' or 'admin'.
 *      - Admins can preview /designer/* without losing their session.
 *      - Everyone else gets routed to their own surface.
 *
 * Hard guarantee: even if the UI gates fail, RLS keeps designers out
 * of every table that wasn't explicitly opened up in migration 0020.
 * Notably: budgets, expenses, ticket tiers, and any view with
 * audience != 'designer' are unreadable.
 */
export default async function DesignerLayout({
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
  if (!roles.includes('designer') && !roles.includes('admin')) {
    if (roles.includes('viewer')) redirect('/viewer/year')
    if (roles.includes('collab')) redirect('/collab/events')
    if (roles.includes('vendor')) redirect('/vendor/profile')
    redirect('/dj/profile')
  }

  const displayName = profile?.display_name ?? user.email ?? 'Designer'

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="text-sm font-semibold tracking-tight">MΛQUIИΛ</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              LosGothsCo · Designer
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
