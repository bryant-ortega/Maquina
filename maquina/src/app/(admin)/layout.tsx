import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { MobileNav, MobileNavTrigger } from './_mobile-nav'

/**
 * Admin shell. Wraps every (admin) route with a sidebar nav and the
 * signed-in user's display info plus a sign-out button.
 *
 * Auth gates (defense in depth):
 *   1. middleware already 404s unauthenticated visits to (admin)/*
 *   2. this layout re-checks the session, in case middleware is misconfigured
 *   3. this layout enforces role === 'admin' — without this check, a logged-in
 *      DJ who typed /events directly would see the admin shell. The data
 *      itself is safe (RLS), but the UX would be confusing.
 *
 * DJs get bounced to /dj/profile; signed-out users to /login.
 */
export default async function AdminLayout({
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

  if (!roles.includes('admin')) {
    if (roles.includes('viewer')) redirect('/viewer/year')
    if (roles.includes('designer')) redirect('/designer/view')
    if (roles.includes('collab')) redirect('/collab/events')
    if (roles.includes('vendor')) redirect('/vendor/profile')
    redirect('/dj/profile')
  }

  const displayName = profile?.display_name ?? user.email ?? 'Admin'
  const role = roles[0] ?? 'unknown'

  // Shared sidebar contents — used by both the desktop aside and the
  // mobile drawer so nav stays in one place.
  const sidebarBody = (
    <>
      {/* Maquina face — sits above the nav on both desktop and mobile.
          Smaller on mobile so all nav items + signout stay visible. */}
      <div className="border-b border-zinc-200 px-5 py-3 md:py-4 dark:border-zinc-800">
        <Image
          src="/brand/maquina-cropped-face.webp"
          alt="Maquina"
          width={180}
          height={290}
          priority
          className="mx-auto h-auto w-full max-w-[110px] object-contain md:max-w-[160px]"
        />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <NavLink href="/events">Events</NavLink>
        <NavLink href="/views">Views</NavLink>
        <NavLink href="/views/month">Month view</NavLink>
        <NavLink href="/views/year">Year view</NavLink>
        <NavLink href="/views/posting-calendar">Posting calendar</NavLink>
        <NavLink href="/views/dj-analytics">DJ analytics</NavLink>
        <NavLink href="/djs">DJs</NavLink>
        <NavLink href="/settings">Settings</NavLink>
      </nav>

      <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {displayName}
        </p>
        <p className="text-xs capitalize text-zinc-500 dark:text-zinc-400">
          {role}
        </p>
        <form action="/auth/sign-out" method="post" className="mt-3">
          <button
            type="submit"
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Sign out
          </button>
        </form>
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 md:flex-row dark:bg-zinc-950">
      {/* Mobile top bar — hamburger + logo + brand. Hidden on md+. */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="flex items-center gap-3">
          <MobileNavTrigger />
          <Image
            src="/brand/losgoths-skull-triangle-transparent.png"
            alt=""
            width={28}
            height={28}
            priority
            className="h-7 w-7 shrink-0 object-contain"
          />
          <p className="text-sm font-semibold tracking-tight">MΛQUIИΛ</p>
        </div>
      </header>

      {/* Desktop sidebar — hidden on mobile. */}
      <aside className="hidden w-60 flex-col border-r border-zinc-200 bg-white md:flex dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <Image
            src="/brand/losgoths-skull-triangle-transparent.png"
            alt=""
            width={40}
            height={40}
            priority
            className="h-10 w-10 shrink-0 object-contain"
          />
          <p className="text-sm font-semibold tracking-tight">MΛQUIИΛ</p>
        </div>
        {sidebarBody}
      </aside>

      {/* Mobile drawer — same nav contents, rendered via portal-style overlay. */}
      <MobileNav>{sidebarBody}</MobileNav>

      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  )
}

function NavLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
    >
      {children}
    </Link>
  )
}
