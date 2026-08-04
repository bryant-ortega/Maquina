'use client'

import { useState, useTransition } from 'react'
import {
  setApplicationApproved,
  setApplicationPaid,
  type ToggleResult,
} from './actions'

/**
 * Per-row Approved/Paid checkboxes used on both the list and detail
 * views. Optimistic like ContractRoleToggle
 * (src/app/(admin)/vendors/[id]/contract-role-toggle.tsx) — flip
 * immediately, revert + show an error if the server action fails.
 *
 * Unchecking clears the matching "email sent" timestamp server-side
 * (see actions.ts), so no UI-side messaging is needed here about
 * that — it just quietly re-arms the bulk email for next time.
 */

type ToggleAction = (id: string, next: boolean) => Promise<ToggleResult>

function StatusCheckbox({
  id,
  initial,
  action,
  label,
}: {
  id: string
  initial: boolean
  action: ToggleAction
  label: string
}) {
  const [checked, setChecked] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onChange(next: boolean) {
    setError(null)
    setChecked(next)
    startTransition(async () => {
      const result = await action(id, next)
      if (!result.ok) {
        setChecked(!next)
        setError(messageFor(result))
      }
    })
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={pending}
        aria-label={label}
        className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-900"
      />
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  )
}

export function ApprovedCheckbox({
  id,
  initialApproved,
}: {
  id: string
  initialApproved: boolean
}) {
  return (
    <StatusCheckbox
      id={id}
      initial={initialApproved}
      action={setApplicationApproved}
      label="Approved"
    />
  )
}

export function PaidCheckbox({
  id,
  initialPaid,
}: {
  id: string
  initialPaid: boolean
}) {
  return (
    <StatusCheckbox
      id={id}
      initial={initialPaid}
      action={setApplicationPaid}
      label="Paid"
    />
  )
}

function messageFor(result: Exclude<ToggleResult, { ok: true }>): string {
  switch (result.reason) {
    case 'unauth':
      return 'Session expired — sign in again.'
    case 'forbidden':
      return 'Admins only.'
    case 'invalid_id':
      return 'Invalid id.'
    case 'db_failed':
      return `Failed: ${result.message}`
  }
}
