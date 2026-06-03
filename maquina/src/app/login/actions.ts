'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Server action for the email + password login form.
 *
 * Why a server action and not a client-side `signInWithPassword`:
 *   - Auth cookies need to be set on the SSR side so the very next
 *     navigation already has the session. With client-side login the
 *     cookies land in the browser but the server-side render of /events
 *     still sees the user as anonymous on the first hop.
 *   - Role lookup happens server-side too, so we can route to the right
 *     surface in one redirect.
 */

const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
})

export type LoginResult =
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'auth'; message: string }
// On success we redirect, so there is no `ok: true` case the form needs to handle.

export async function loginUser(formData: FormData): Promise<LoginResult | never> {
  const parsed = LoginInput.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    const first =
      parsed.error.issues[0]?.message ?? 'Please check your email and password.'
    return { ok: false, reason: 'invalid', message: first }
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })
  if (error || !data.user) {
    return {
      ok: false,
      reason: 'auth',
      message: 'Email or password is incorrect.',
    }
  }

  // Look up the role to decide where to land.
  const { data: profile } = await supabase
    .from('profiles')
    .select('roles, roles')
    .eq('user_id', data.user.id)
    .maybeSingle()
  const roles: string[] = profile?.roles ?? ['dj']

  if (roles.includes('admin')) {
    redirect('/events')
  }
  if (roles.includes('viewer')) {
    redirect('/viewer/year')
  }
  if (roles.includes('designer')) {
    redirect('/designer/view')
  }
  if (roles.includes('collab')) {
    redirect('/collab/events')
  }
  if (roles.includes('vendor')) {
    const { data: v } = await supabase
      .from('vendors')
      .select('w9_status')
      .eq('user_id', data.user.id)
      .maybeSingle()
    redirect(v?.w9_status === 'on_file' ? '/vendor/profile' : '/vendor/upload-w9')
  }

  // DJ — destination depends on whether their W-9 is on file.
  const { data: dj } = await supabase
    .from('djs')
    .select('w9_status')
    .eq('user_id', data.user.id)
    .maybeSingle()
  redirect(dj?.w9_status === 'on_file' ? '/dj/profile' : '/dj/upload-w9')
}
