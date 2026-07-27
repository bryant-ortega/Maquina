'use client'

import { useState, useTransition } from 'react'
import {
  addEventCollaborator,
  removeEventCollaborator,
  type AddCollabResult,
  type RemoveCollabResult,
} from './actions'

/**
 * Collaborators section on the admin event edit page — Phase 13.
 *
 * Lists the current collaborators attached to this event, with a
 * Remove button on each row, and an "Add collaborator" form below. The
 * server actions handle two cases: existing collab user (reattach with
 * no password needed) and brand-new user (password required).
 *
 * The form is intentionally minimal — collaborators only need an email
 * and (for new accounts) a password. Profile fields (display name,
 * etc.) aren't surfaced to collabs anywhere in the app, so we don't
 * collect them.
 */

export type CollaboratorRow = {
  id: string
  email: string
  added_at: string
}

export function CollaboratorsSection({
  eventId,
  initial,
}: {
  eventId: string
  initial: CollaboratorRow[]
}) {
  const [rows, setRows] = useState(initial)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result: AddCollabResult = await addEventCollaborator({
        event_id: eventId,
        email,
        password: password || undefined,
      })
      if (!result.ok) {
        if (result.reason === 'unauthorized') {
          setError('Not authorized.')
        } else if (result.reason === 'invalid') {
          setError(result.message)
        } else if (result.reason === 'create_failed') {
          setError(result.message)
        } else if (result.reason === 'attach_failed') {
          setError(result.message)
        } else {
          setError('Failed to add collaborator.')
        }
        return
      }
      setNotice(
        result.isNewUser
          ? `Account created and attached. Send them ${email} with the password you set.`
          : `Existing collaborator attached.`
      )
      setEmail('')
      setPassword('')
      // Optimistic update — the server action revalidatePath will refresh
      // on the next render, but we want the row to appear immediately.
      // Without the new id we can't render it precisely, so we trigger a
      // soft refresh by calling location.reload after a beat. (Better
      // alternative: have the action return the new row.)
      setTimeout(() => window.location.reload(), 600)
    })
  }

  // Mobile fix (2026-07-26): window.confirm() is silently suppressed
  // inside iOS home-screen (PWA) contexts and most in-app browsers, so
  // `if (!confirm(...)) return` used to no-op the tap on mobile with no
  // dialog ever shown. Two-tap inline confirm (armedId state) works the
  // same everywhere. See view-toolbar.tsx / email-button.tsx for the
  // same fix applied elsewhere.
  function handleRemove(id: string) {
    setArmedId(null)
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result: RemoveCollabResult = await removeEventCollaborator({
        collaborator_id: id,
        event_id: eventId,
      })
      if (!result.ok) {
        setError(
          result.reason === 'unauthorized'
            ? 'Not authorized.'
            : result.reason === 'invalid' || result.reason === 'db_failed'
              ? result.message
              : 'Failed to remove collaborator.'
        )
        return
      }
      setRows((prev) => prev.filter((r) => r.id !== id))
      setNotice('Collaborator removed.')
    })
  }

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">
          Collaborators
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Read-only access for partners on this event. They&apos;ll see
          run-of-show + budget summary; nothing else from LosGothsCo.
        </p>
      </header>

      {rows.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                  {row.email}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-500">
                  Added{' '}
                  {new Date(row.added_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
              {armedId === row.id ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleRemove(row.id)}
                    className="rounded-md border border-rose-200 bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/60 dark:bg-rose-700 dark:hover:bg-rose-600"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setArmedId(null)}
                    className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setArmedId(row.id)}
                  className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          disabled={pending}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="collaborator@example.com"
          className={inputClass}
        />
        <input
          type="password"
          autoComplete="new-password"
          disabled={pending}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Initial password (new accounts)"
          className={inputClass}
        />
        <button
          type="submit"
          disabled={pending || !email}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-50 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {notice && !error && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        Tip: leave password blank when re-attaching an existing
        collaborator. New accounts need an initial password — share it
        with them securely; they can reset it later via &quot;Forgot
        password&quot;.
      </p>
    </section>
  )
}

const inputClass =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-700'
