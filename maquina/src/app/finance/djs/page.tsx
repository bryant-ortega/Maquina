import { createServerSupabaseClient } from '@/lib/supabase/server'
import { W9DownloadButton } from './w9-download'

/**
 * Finance DJ roster — read-only (migration 0030). Mirrors (admin)/djs
 * visually but drops region filtering, the pending-W9 alert banner, and
 * the per-DJ detail link (no edit page in finance's scope) — keeps a
 * per-row W-9 download button since "download all W-9s" was Chase's
 * original, unqualified ask.
 */
export default async function FinanceDjRosterPage() {
  const supabase = await createServerSupabaseClient()
  const { data: djs, error } = await supabase
    .from('djs')
    .select('id, dj_name, government_name, region, w9_status, w9_storage_path')
    .order('dj_name', { ascending: true })

  if (error) {
    return (
      <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-semibold tracking-tight">DJs</h1>
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            Failed to load roster: {error.message}
          </p>
        </div>
      </div>
    )
  }

  const rows = djs ?? []

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">DJs</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {rows.length} {rows.length === 1 ? 'DJ' : 'DJs'} on roster. Read-only.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">DJ name</th>
                <th className="px-4 py-2.5 font-medium">Region</th>
                <th className="px-4 py-2.5 font-medium">W-9</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-zinc-500 dark:text-zinc-400"
                  >
                    No DJs on roster yet.
                  </td>
                </tr>
              ) : (
                rows.map((dj) => (
                  <tr key={dj.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        {dj.dj_name}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {dj.government_name}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {dj.region}
                    </td>
                    <td className="px-4 py-3">
                      <W9Badge status={dj.w9_status as 'pending' | 'on_file'} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {dj.w9_status === 'on_file' && dj.w9_storage_path ? (
                        <W9DownloadButton
                          storagePath={dj.w9_storage_path}
                          fileName="Download"
                        />
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function W9Badge({ status }: { status: 'pending' | 'on_file' }) {
  if (status === 'on_file') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
        <span aria-hidden>✓</span>
        On file
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      <span aria-hidden>⚠</span>
      Pending
    </span>
  )
}
