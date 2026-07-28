'use client'

import { useState, useTransition } from 'react'

/**
 * "Download W-9" button. Identical to (admin)/vendors/[id]/w9-download.tsx
 * — duplicated per the existing colocated-per-route-group convention.
 * Calls /api/storage/signed-url, which now also authorizes the
 * 'finance' role (migration 0030 gave finance storage-adjacent SELECT
 * access; the API route itself checks roles.includes('finance')).
 */
export function W9DownloadButton({
  storagePath,
  fileName,
}: {
  storagePath: string
  fileName?: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/storage/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        })
        const body = (await res.json()) as
          | { signedUrl: string }
          | { error: string }
        if (!res.ok || !('signedUrl' in body)) {
          setError(
            'error' in body ? body.error : `Request failed (${res.status})`
          )
          return
        }
        window.open(body.signedUrl, '_blank', 'noopener,noreferrer')
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
        className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        {pending ? 'Generating link…' : (fileName ?? 'Download W-9')}
      </button>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  )
}
