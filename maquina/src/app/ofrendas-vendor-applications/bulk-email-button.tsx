'use client'

import { useState, useTransition } from 'react'
import {
  sendApprovedVendorEmails,
  sendPaidVendorEmails,
  type SendBulkEmailResult,
} from './actions'

/**
 * "Email approved vendors" / "Email paid vendors" buttons. Each click
 * sends the matching form email to every application whose status
 * flag is on but who hasn't been emailed yet (server-side dedup — see
 * actions.ts). `pendingCount` comes from the server component so the
 * button's label and disabled state reflect the latest data after
 * revalidation.
 */
export function BulkEmailButton({
  kind,
  pendingCount,
}: {
  kind: 'approved' | 'paid'
  pendingCount: number
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const label =
    kind === 'approved' ? 'Email approved vendors' : 'Email paid vendors'

  function onClick() {
    setMessage(null)
    startTransition(async () => {
      const result: SendBulkEmailResult =
        kind === 'approved'
          ? await sendApprovedVendorEmails()
          : await sendPaidVendorEmails()

      if (!result.ok) {
        setMessage(messageFor(result))
        return
      }

      const parts = [`Sent ${result.sent}`]
      if (result.skipped > 0) {
        parts.push(`${result.skipped} skipped (email not configured)`)
      }
      if (result.failed > 0) parts.push(`${result.failed} failed`)
      setMessage(parts.join(' · '))
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending || pendingCount === 0}
        className="whitespace-nowrap rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending
          ? 'Sending…'
          : `${label}${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
      </button>
      {message && (
        <p className="max-w-[16rem] text-right text-xs text-zinc-500 dark:text-zinc-400">
          {message}
        </p>
      )}
    </div>
  )
}

function messageFor(
  result: Exclude<SendBulkEmailResult, { ok: true }>
): string {
  switch (result.reason) {
    case 'unauth':
      return 'Session expired — sign in again.'
    case 'forbidden':
      return 'Not authorized.'
    case 'db_failed':
      return `Couldn't load recipients: ${result.message}`
  }
}
