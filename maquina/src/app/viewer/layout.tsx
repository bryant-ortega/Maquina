import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { RoleNav } from '@/components/role-nav'

/**
 * Viewer shell — Phase 17g.
 *
 * Wraps every /viewer/* route with minimal chrome: a Maquina brand row
 * at the top and a sign-out button. No sidebar, no admin links, no
 * "Events" / "DJs" / "Settings". Viewers see the year view and
 * nothing else.
 *
 * Auth gates:
 *   1. Must be signed in.
 *   2. profiles.role must be 'viewer' or 'admin'.
 *      - Admins can preview /viewer/* without losing their session.
 *      - DJs / collabs / partners get routed to their own surfaces.
 *
 * Hard guarantee: even if the UI gates fail, RLS keeps viewers from
 * touching anything outside what `events_select_viewer` (migration
 * 0016) and the pre-existing `venues_select_authenticated` policies
 * allow.
 */
export default async function ViewerLayout({
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
    .select('display_name, role, roles')
    .eq('user_id', user.id)
    .maybeSingle()

  const role = profile?.role
  const roles: string[] = (profile as any)?.roles ?? []
  const hasViewerRole = role === 'viewer' || roles.includes('viewer')
  if (!hasViewerRole && role !== 'admin') {
    // DJ / collab / unknown — punt to /dj/profile, the existing
    // catch-all for non-admin non-collab non-viewer sessions.
    if (role === 'collab') redirect('/collab/events')
    redirect('/dj/profile')
  }

  const displayName = profile?.display_name ?? user.email ?? 'Viewer'

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="text-sm font-semibold tracking-tight">MΛQUIИΛ</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              LosGothsCo · Viewer
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RoleNav roles={roles} primaryRole={role} currentPath="/viewer/year" />
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
