import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Refreshes the Supabase session on every request and gates protected routes.
 * Per BUILD_PLAN: unauthenticated visits to admin routes (and the
 * invite-only collab/viewer/contract roles) return 404, not 401 or a
 * login redirect, to keep those surfaces invisible to scanners. /dj
 * and /vendor are the exception — they're public self-registration
 * flows with links emailed automatically, so they redirect to /login
 * at the page level instead (see the /dj and /vendor comments below).
 *
 * Also applies a general rate-limit backstop (60 req/min per IP) to
 * every /api/* route — see src/lib/rate-limit.ts. Login/register/
 * password-reset get their own stricter 5-per-15-min limit inside
 * their own server actions instead (those aren't distinct API routes
 * — they're POSTs to the page URL — so gating them here would mean
 * parsing the request body just to tell them apart from other actions
 * on the same page). Scoped to path.startsWith('/api/') specifically
 * so ordinary page navigation never pays for the extra DB round trip.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname

  if (path.startsWith('/api/')) {
    const ip = getClientIp(request.headers)
    const limit = await checkRateLimit(`api:${ip}`, RATE_LIMITS.API)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        }
      )
    }
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // (admin) is a route group — its URL prefix is empty, so we can't match it
  // by pathname. The admin pages live under top-level paths like /events,
  // /djs, /settings. Gate those explicitly. (`path` itself is declared up
  // top now, for the /api/* rate-limit check.)
  const isAdminRoute =
    path.startsWith('/events') ||
    path.startsWith('/djs') ||
    path.startsWith('/vendors') ||
    path.startsWith('/settings')

  if (isAdminRoute && !user) {
    return NextResponse.rewrite(new URL('/not-found', request.url))
  }

  // /dj/* does NOT 404 unauthenticated visits, unlike the admin routes
  // above. Every /dj page already redirect()s signed-out users to
  // /login itself (see dj/profile, dj/upload-w9). That page-level
  // redirect is the real gate — DJs get emailed links straight into
  // these routes (registration confirmation, W-9 reminders), and those
  // links have to work when clicked cold from an inbox, not 404 just
  // because the click landed in a browser with no session yet. Bug
  // found 2026-07-27: this route used to be in the 404-on-unauth list
  // above, which silently broke every emailed W-9 link for anyone not
  // already logged in.

  // /collab/* requires a session. Role enforcement (must be 'collab')
  // happens in the collab layout — middleware only ensures someone is
  // signed in before any /collab page renders.
  if (path.startsWith('/collab') && !user) {
    return NextResponse.rewrite(new URL('/not-found', request.url))
  }

  // /viewer/* requires a session. Role enforcement (must be 'viewer'
  // or 'admin') happens in the viewer layout — middleware only ensures
  // someone is signed in before any /viewer page renders.
  if (path.startsWith('/viewer') && !user) {
    return NextResponse.rewrite(new URL('/not-found', request.url))
  }

  // /contract/* requires a session. Role enforcement (must be
  // 'contract' or 'admin') happens in the contract layout — middleware
  // only ensures someone is signed in before any /contract page renders.
  if (path.startsWith('/contract') && !user) {
    return NextResponse.rewrite(new URL('/not-found', request.url))
  }

  // /ofrendas-vendor-applications/* requires a session. Role
  // enforcement (must be 'ofrendas_partner' or 'admin') happens in that
  // route's own layout — middleware only ensures someone is signed in.
  // Invite-only role (migration 0038), same invisible-to-scanners
  // treatment as /contract, /viewer, /collab above — this page shows
  // applicant contact info (email, phone), so it doesn't get the
  // /dj-style "public link, redirect at the page level" treatment.
  if (path.startsWith('/ofrendas-vendor-applications') && !user) {
    return NextResponse.rewrite(new URL('/not-found', request.url))
  }

  // /vendor/* — same reasoning as /dj/* above: no 404-on-unauth here.
  // Page-level redirect('/login') (vendor/profile, vendor/upload-w9)
  // is what actually gates it, and the registration-confirmation +
  // W-9-reminder emails link straight into these routes.

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
