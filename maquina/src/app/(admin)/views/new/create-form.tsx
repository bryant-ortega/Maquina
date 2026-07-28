'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createView } from '../actions'

/**
 * Create-view form. Posts to the createView server action; on success
 * navigates to the editor for the new view.
 */
export function CreateViewForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [audience, setAudience] = useState<
    'internal' | 'contract' | 'venue' | 'dj' | 'partner' | 'other'
  >('internal')
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createView({
        name,
        description: description.trim() || null,
        audience,
      })
      if (result.ok) {
        router.push(`/views/${result.id}/edit`)
        router.refresh()
      } else {
        setError(messageFor(result))
      }
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <Field label="Name" htmlFor="view-name">
        <input
          id="view-name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Contractor brief"
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field
        label="Description"
        htmlFor="view-desc"
        hint="Optional. What's this view for?"
      >
        <input
          id="view-desc"
          type="text"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Fields the design team needs for posting"
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field label="Audience" htmlFor="view-audience">
        <select
          id="view-audience"
          value={audience}
          onChange={(e) =>
            setAudience(e.target.value as typeof audience)
          }
          className={inputClass}
          disabled={pending}
        >
          <option value="internal">Internal</option>
          <option value="contract">Contractor</option>
          <option value="venue">Venue</option>
          <option value="dj">DJ</option>
          <option value="partner">Partner</option>
          <option value="other">Other</option>
        </select>
      </Field>

      {error ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => router.push('/views')}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? 'Creating…' : 'Create & edit fields'}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  )
}

const inputClass =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'

function messageFor(
  result:
    | { ok: false; reason: string; message?: string }
): string {
  switch (result.reason) {
    case 'unauth':
      return 'You must be signed in.'
    case 'forbidden':
      return 'Only admins can create views.'
    case 'invalid':
      return result.message ?? 'Invalid input.'
    case 'db':
      return result.message ?? 'Database error. Try again.'
    default:
      return 'Something went wrong.'
  }
}
