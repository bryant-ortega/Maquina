'use client'

import Link from 'next/link'
import { useState } from 'react'
import { requestPasswordReset } from './actions'

/**
 * Forgot-password.
 *
 * Submits to a server action (requestPasswordReset in ./actions.ts)
 * rather than calling Supabase's `resetPasswordForEmail` directly from
 * the browser — rate limiting (5 attempts / 15 min) has to happen
 * server-side. The action sends a recovery email containing a link to
 * /auth/callback?code=...&type=recovery. The callback exchanges the
 * code for a recovery session and redirects the user to
 * /reset-password to set a new password.
 *
 * We always show a "check your email" success state, even when the
 * email isn't on file — leaks of "this email is registered" are a
 * standard footgun on auth surfaces. The one exception is being rate
 * limited, which gets its own message (that's not an email-existence
 * leak — it just means this IP/email is being hammered).
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email) return
    setStatus('sending')
    setErrorMessage(null)

    const fd = new FormData()
    fd.set('email', email)
    const result = await requestPasswordReset(fd)
    if (!result.ok) {
      setStatus('error')
      setErrorMessage(
        result.reason === 'rate_limited'
          ? result.message
          : 'Enter a valid email address.'
      )
      return
    }
    setStatus('sent')
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            Reset password
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Enter your email and we&apos;ll send you a link to set a new password.
          </p>
        </div>

        {status === 'sent' ? (
          <div className="space-y-4">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
              If an account exists for <strong>{email}</strong>, a reset link
              is on its way. The link works once and expires after a short
              while.
            </div>
            <Link
              href="/login"
              className="inline-block text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                disabled={status === 'sending'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>

            {errorMessage && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'sending' || !email}
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {status === 'sending' ? 'Sending…' : 'Send reset link'}
            </button>

            <Link
              href="/login"
              className="inline-block text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              ← Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}

const inputClass =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-700'
