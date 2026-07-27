import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Refreshes the Supabase session on every request and gates protected routes.
 * Per BUILD_PLAN: unauthenticated visits to admin/dj routes return 404, not
 * 401 or a login redirect, to keep the admin portal invisible to scanners.
 */
export async function middleware(request: NextRequest) {
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
  // /djs, /settings. Gate those explicitly.
  const path = request.nextUrl.pathname
  const isAdminRoute =
    path.startsWith('/events') ||
    path.startsWith('/djs') ||
    path.startsWith('/vendors') ||
    path.startsWith('/settings')

  if (isAdminRoute && !user) {
    return NextResponse.rewrite(new URL('/not-found', request.url))
  }

  if (path.startsWith('/dj') && !user) {
    return NextResponse.rewrite(new URL('/not-found', request.url))
  }

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

  // /designer/* requires a session. Role enforcement (must be
  // 'designer' or 'admin') happens in the designer layout — middleware
  // only ensures someone is signed in before any /designer page renders.
  if (path.startsWith('/designer') && !user) {
    return NextResponse.rewrite(new URL('/not-found', request.url))
  }

  // /vendor/* requires a session. Role enforcement happens at the
  // page level (each vendor page redirects non-vendors). Middleware
  // only ensures someone is signed in first.
  if (path.startsWith('/vendor') && !user) {
    return NextResponse.rewrite(new URL('/not-found', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
