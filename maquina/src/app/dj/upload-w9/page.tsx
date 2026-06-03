import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { UploadForm } from './upload-form'

/**
 * DJ-only W-9 upload page. Auth-gated: signed-out users land on /login,
 * non-DJ users get bounced to /events (admins) or /login (anything else).
 */
export default async function UploadW9Page() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('roles')
    .eq('user_id', user.id)
    .maybeSingle()

  if (profile?.roles?.includes('admin')) redirect('/events')
  if (!profile?.roles?.includes('dj')) redirect('/login')

  const { data: dj } = await supabase
    .from('djs')
    .select('dj_name, w9_status, w9_storage_path')
    .eq('user_id', user.id)
    .maybeSingle()

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            Upload your W-9
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Hi {dj?.dj_name ?? 'there'} — upload your completed W-9 PDF below.
            We need this on file before you can be paid for a booking.
          </p>
        </div>

        {dj?.w9_status === 'on_file' && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
            ✓ A W-9 is already on file. You can replace it by uploading a new
            PDF below.
          </div>
        )}

        <UploadForm hasExisting={!!dj?.w9_storage_path} />

        <div className="flex items-center justify-between text-xs">
          <a
            href="/dj/profile"
            className="text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            Back to profile
          </a>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
