'use client'

import { useState, useTransition } from 'react'
import {
  setVendorContractRole,
  type SetVendorContractRoleResult,
} from './actions'

/**
 * Admin toggle: grant or revoke the 'contract' role on this vendor's
 * account. Contract is a locked, read-only role (renamed from
 * 'designer' in migration 0029) — a vendor with it also sees
 * /contract/view, a single custom view of upcoming events, in
 * addition to their normal /vendor/profile surface.
 *
 * There's no self-registration path for Contract; it only ever gets
 * granted here, on top of an existing vendor account.
 */
export function ContractRoleToggle({
  vendorId,
  initialEnabled,
}: {
  vendorId: string
  initialEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onChange(next: boolean) {
    setError(null)
    // Optimistic — the action is a simple array add/remove with low
    // failure odds; revert on error.
    setEnabled(next)
    startTransition(async () => {
      const result: SetVendorContractRoleResult = await setVendorContractRole(
        vendorId,
        next
      )
      if (!result.ok) {
        setEnabled(!next)
        setError(messageFor(result))
      }
    })
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <input
        type="checkbox"
        id={`contract-role-${vendorId}`}
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        disabled={pending}
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-900"
      />
      <label
        htmlFor={`contract-role-${vendorId}`}
        className="text-sm text-zinc-800 dark:text-zinc-200"
      >
        <span className="font-medium">Contractor access</span>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Lets this vendor sign in to a read-only view of upcoming
          events at /contract/view — no financials, no editing. Use
          for photographers, videographers, or designers who need
          event visibility beyond their own vendor profile.
        </p>
        {pending && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Saving…
          </span>
        )}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </label>
    </div>
  )
}

function messageFor(
  result: Exclude<SetVendorContractRoleResult, { ok: true }>
): string {
  switch (result.reason) {
    case 'unauth':
      return 'Session expired — please sign in again.'
    case 'forbidden':
      return 'Only admins can change roles.'
    case 'invalid_id':
      return 'Invalid vendor id.'
    case 'no_vendor_row':
      return "Couldn't find this vendor."
    case 'no_profile_row':
      return 'This vendor has no linked profile — is their account fully registered?'
    case 'db_failed':
      return `Update failed: ${result.message}`
  }
}
