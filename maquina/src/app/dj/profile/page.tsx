import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * DJ's own profile view. Read-only for now — admins edit DJ records via
 * the admin DJs page (Phase 6). This page mostly exists to confirm the
 * registration succeeded and to surface W-9 status.
 *
 * Auth gate: signed-out → /login, admin → /events, anyone else → /login.
 */
export default async function DjProfilePage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('roles, display_name')
    .eq('user_id', user.id)
    .maybeSingle()

  if (profile?.roles?.includes('admin')) redirect('/events')
  if (!profile?.roles?.includes('dj')) redirect('/login')

  const { data: dj } = await supabase
    .from('djs')
    .select(
      'dj_name, government_name, email, phone, region, pay_method, pay_handle, w9_status, w9_storage_path, registered_at'
    )
    .eq('user_id', user.id)
    .maybeSingle()

  // If the trigger ran but the djs row didn't (admin-created DJ profile, edge
  // cases), let the user know. The fix is admin-side; nothing the DJ can do.
  if (!dj) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <h1 className="text-base font-semibold">Profile not found</h1>
          <p>
            Your account exists, but no DJ profile is attached to it yet.
            Contact admin and we&apos;ll get it sorted.
          </p>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-xs underline underline-offset-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    )
  }

  const onFile = dj.w9_status === 'on_file'

  return (
    <div className="flex flex-1 items-start justify-center px-6 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <header className="space-y-1.5">
          <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            DJ Profile
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{dj.dj_name}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Registered{' '}
            {new Date(dj.registered_at as string).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </header>

        {/* W-9 status card — most important info, so it's first. */}
        <div
          className={
            onFile
              ? 'rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/40'
              : 'rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/50 dark:bg-amber-950/40'
          }
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p
                className={
                  onFile
                    ? 'text-sm font-semibold text-emerald-900 dark:text-emerald-200'
                    : 'text-sm font-semibold text-amber-900 dark:text-amber-200'
                }
              >
                W-9: {onFile ? 'On file' : 'Required'}
              </p>
              <p
                className={
                  onFile
                    ? 'mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-200/80'
                    : 'mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80'
                }
              >
                {onFile
                  ? 'You can be booked and paid. Re-upload anytime to update.'
                  : 'Upload a completed W-9 PDF before your first booking.'}
              </p>
            </div>
            <a
              href="/dj/upload-w9"
              className={
                onFile
                  ? 'shrink-0 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900'
                  : 'shrink-0 rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100'
              }
            >
              {onFile ? 'Replace W-9' : 'Upload W-9'}
            </a>
          </div>
        </div>

        {/* Profile detail card. */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Account details
          </h2>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="DJ name" value={dj.dj_name} />
            <Row label="Legal name" value={dj.government_name} />
            <Row label="Email" value={dj.email} />
            <Row label="Phone" value={dj.phone} />
            <Row label="Region" value={dj.region} />
            <Row label="Pay method" value={dj.pay_method} />
            <Row label="Pay handle" value={dj.pay_handle} />
          </dl>
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
            Need to update something? Contact admin — only admins can edit
            roster entries.
          </p>
        </div>

        <div className="flex justify-end">
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="text-zinc-900 dark:text-zinc-100">
        {value && value.length > 0 ? (
          value
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">—</span>
        )}
      </dd>
    </div>
  )
}
