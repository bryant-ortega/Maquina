import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { RootRedirect } from './_root-redirect'

/**
 * Root landing.
 *
 * If we're already signed in (cookie session present), bounce straight
 * to the role-appropriate landing surface. Otherwise we hand off to the
 * client component RootRedirect, which inspects window.location.hash
 * for a Supabase recovery fragment (#access_token=...&type=recovery)
 * and forwards to /reset-password if found, /login otherwise.
 *
 * Why a client redirect for the unauthed branch: Supabase's recovery
 * email can fall back to Site URL when the redirectTo URL doesn't
 * match the allow-list. The recovery token then arrives at this URL,
 * and a server-side redirect would drop the hash before the client
 * gets a chance to see it.
 */
export default async function Home() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('roles')
      .eq('user_id', user.id)
      .maybeSingle()
    const roles: string[] = profile?.roles ?? ['dj']
    if (roles.includes('admin')) redirect('/events')
    if (roles.includes('collab')) redirect('/collab/events')
    if (roles.includes('viewer')) redirect('/viewer/year')
    if (roles.includes('contract')) redirect('/contract/view')
    if (roles.includes('finance')) redirect('/finance/events')
    if (roles.includes('ofrendas_partner'))
      redirect('/ofrendas-vendor-applications')
    if (roles.includes('vendor')) redirect('/vendor/profile')
    redirect('/dj/profile')
  }
  return <RootRedirect />
}
