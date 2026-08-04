import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Ofrendas Partner shell — moved out of (admin) so it can be granted to
 * the 2 outside partners working the Ofrendas vendor-call queue without
 * giving them full admin (migration 0038).
 *
 * Wraps every /ofrendas-vendor-applications/* route with minimal
 * chrome: a Maquina brand row + sign-out button. No sidebar, no admin
 * links — an Ofrendas Partner sees the applications list + detail
 * pages and nothing else. URL is unchanged from when this route lived
 * under (admin) (route groups don't affect the path), so any existing
 * links/bookmarks still work.
 *
 * Auth gates:
 *   1. Must be signed in.
 *   2. profiles.roles must include 'ofrendas_partner' or 'admin'.
 *      - Admins can still reach this page from their own sidebar link
 *        without losing their session.
 *      - Everyone else gets routed to their own surface.
 *
 * Hard guarantee: even if this gate is somehow bypassed, migration
 * 0038's RLS policies keep an ofrendas_partner session from reading or
 * writing anything outside ofrendas_vendor_applications — no other
 * table has a policy for this role at all.
 */
export default async function OfrendasVendorApplicationsLayout({
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
  if (!roles.includes('ofrendas_partner') && !roles.includes('admin')) {
    if (roles.includes('viewer')) redirect('/viewer/year')
    if (roles.includes('contract')) redirect('/contract/view')
    if (roles.includes('finance')) redirect('/finance/events')
    if (roles.includes('collab')) redirect('/collab/events')
    if (roles.includes('vendor')) redirect('/vendor/profile')
    redirect('/dj/profile')
  }

  const displayName = profile?.display_name ?? user.email ?? 'Partner'

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="text-sm font-semibold tracking-tight">MΛQUIИΛ</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              LosGothsCo · Ofrendas
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
