'use client'

import { useState, useTransition } from 'react'

/**
 * "Download all W-9s (ZIP)" button — hits /api/finance/w9-zip, which
 * bundles every on-file DJ + vendor W-9 into one ZIP (DJs/ and Vendors/
 * subfolders). Streams the response as a blob and triggers a browser
 * download; no server-side temp file, nothing cached client-side.
 */
export function DownloadAllW9sButton() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/finance/w9-zip')
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error: string }
            | null
          setError(body?.error ?? `Request failed (${res.status})`)
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `w9s-${new Date().toISOString().slice(0, 10)}.zip`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error')
      }
    })
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {pending ? 'Building ZIP…' : 'Download all W-9s (ZIP)'}
      </button>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  )
}
