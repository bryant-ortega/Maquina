import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { RoleNav } from '@/components/role-nav'

/**
 * Finance shell — read-only bookkeeper/accountant role (migration
 * 0030).
 *
 * Unlike viewer/contract (locked to one page each), finance has three
 * distinct surfaces — event budgets, the DJ roster, and the vendor
 * roster — so this layout gets its own small nav instead of being a
 * single-page shell. No event editing, no run of show, no view
 * builder, no W-9 upload — read + download only, enforced both here
 * (no edit forms rendered) and at the RLS layer (migration 0030 only
 * grants SELECT).
 *
 * Auth gates:
 *   1. Must be signed in.
 *   2. profiles.roles must include 'finance' or 'admin'.
 *      - Admins can preview /finance/* without losing their session.
 *      - Everyone else gets routed to their own surface.
 */
export default async function FinanceLayout({
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
  if (!roles.includes('finance') && !roles.includes('admin')) {
    if (roles.includes('viewer')) redirect('/viewer/year')
    if (roles.includes('contract')) redirect('/contract/view')
    if (roles.includes('ofrendas_partner'))
      redirect('/ofrendas-vendor-applications')
    if (roles.includes('collab')) redirect('/collab/events')
    if (roles.includes('vendor')) redirect('/vendor/profile')
    redirect('/dj/profile')
  }

  const displayName = profile?.display_name ?? user.email ?? 'Finance'

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-sm font-semibold tracking-tight">MΛQUIИΛ</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                LosGothsCo · Finance
              </p>
            </div>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/finance/events"
                className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                Events
              </Link>
              <Link
                href="/finance/djs"
                className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                DJs
              </Link>
              <Link
                href="/finance/vendors"
                className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                Vendors
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <RoleNav roles={roles} primaryRole={roles[0]} currentPath="/finance/events" />
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
