'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { loginUser } from './actions'

/**
 * Email + password login.
 *
 * The form posts to a server action so the auth cookies are written on
 * the SSR side and the redirect to /events (or /dj/*) is one round-trip.
 * Forgotten passwords are handled at /forgot-password.
 *
 * Recovery hand-off: when Supabase's verify endpoint can't redirect
 * straight to /reset-password (because the redirectTo URL didn't match
 * the project's allow-list), it falls back to Site URL and the browser
 * lands here with a recovery URL fragment. We listen for the
 * PASSWORD_RECOVERY auth event and bounce to /reset-password so the
 * fragment never gets stranded on the wrong page.
 */
export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'PASSWORD_RECOVERY') {
          router.replace('/reset-password')
        }
      }
    )
    return () => subscription.unsubscribe()
  }, [router])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    // Read directly from the form so browser autofill works even when
    // the autofill event doesn't fire React's onChange (common on mobile
    // password managers). The controlled state is still kept in sync for
    // the visible value, but it's not what we submit.
    const fd = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await loginUser(fd)
      // If we got a result back, the action returned an error (success
      // case redirects, never returns).
      if (result && !result.ok) {
        setError(result.message)
      }
    })
  }

  return (
    <div className="flex flex-1 items-center justify-center gap-8 px-6 py-16">
      <div className="grid w-full max-w-5xl grid-cols-1 items-center gap-8 sm:grid-cols-2">
        {/* Maquina — transparent PNG/WebP, sits directly on the page background */}
        <div className="relative mx-auto aspect-[900/1329] w-full max-w-md">
          <Image
            src="/brand/goth-makima.webp"
            alt="Maquina"
            fill
            priority
            sizes="(min-width: 640px) 50vw, 100vw"
            className="object-contain"
          />
        </div>

        <div className="w-full max-w-sm space-y-6 justify-self-center sm:justify-self-start">
        <div className="space-y-1.5">
          <p className="text-2xl text-zinc-500 dark:text-zinc-400">
            MΛQUIИΛ
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Enter your email and password.
          </p>
        </div>

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
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={pending}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="flex items-center justify-between text-xs">
            <Link
              href="/forgot-password"
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Forgot password?
            </Link>
            <Link
              href="/register"
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Register as a DJ or vendor →
            </Link>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

const inputClass =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-700'
