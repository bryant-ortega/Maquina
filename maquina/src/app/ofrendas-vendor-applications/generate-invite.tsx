'use client'

import { useState, useTransition } from 'react'
import {
  generateOfrendasVendorInvite,
  type GenerateInviteResult,
} from './actions'

/**
 * "Generate invite link" — lets a late vendor still submit the
 * Ofrendas application after the public deadline. Creates a one-time
 * link server-side (see src/lib/ofrendas-invites.ts) and shows it
 * here to copy/paste and send however makes sense (email, IG DM,
 * text) — this app doesn't send it automatically.
 *
 * `note` is just a reminder for whoever's looking at this list later
 * ("Maria's Tamales") — never shown to the vendor, not validated
 * against anything.
 */
export function GenerateInviteLink() {
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onGenerate() {
    setError(null)
    setLink(null)
    setCopied(false)
    startTransition(async () => {
      const result: GenerateInviteResult =
        await generateOfrendasVendorInvite(note)
      if (!result.ok) {
        setError(messageFor(result))
        return
      }
      setLink(result.url)
      setNote('')
    })
  }

  async function onCopy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Who's this for? (optional note)"
          disabled={pending}
          className="w-48 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600"
        />
        <button
          type="button"
          onClick={onGenerate}
          disabled={pending}
          className="whitespace-nowrap rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {pending ? 'Generating…' : 'Generate invite link'}
        </button>
      </div>

      {error && (
        <p className="max-w-[16rem] text-right text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {link && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="w-64 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
          />
          <button
            type="button"
            onClick={onCopy}
            className="whitespace-nowrap rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}

function messageFor(
  result: Exclude<GenerateInviteResult, { ok: true }>
): string {
  switch (result.reason) {
    case 'unauth':
      return 'Session expired — sign in again.'
    case 'forbidden':
      return 'Not authorized.'
    case 'db_failed':
      return `Couldn't create link: ${result.message}`
  }
}
