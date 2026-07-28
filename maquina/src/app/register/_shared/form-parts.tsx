'use client'

/**
 * Shared UI pieces for the DJ and vendor registration forms
 * (register/dj/registration-form.tsx, register/vendor/registration-form.tsx).
 *
 * The two forms diverge on their identity fields (dj_name/government_name
 * vs company_name/contact_name), their zod schema, and which server action
 * they call — different enough that keeping them as two separate
 * `<form>` components (rather than one form with a runtime type switch)
 * is the simpler, lower-risk shape. But the error-state screens
 * (already-registered / orphan-account recovery) and the basic input
 * styling are byte-for-byte identical or near enough, so they live here
 * instead of being copy-pasted twice.
 */

export const inputClass =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-700'

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="text-xs text-zinc-500 dark:text-zinc-500">{hint}</p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

/** Shown when the submitted email already has a fully-registered account. */
export function AlreadyRegisteredNotice({
  profileLabel,
}: {
  /** e.g. "profile" (DJ) or "vendor profile" (vendor). */
  profileLabel: string
}) {
  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
      <p>
        That email is already registered. Sign in instead to access your{' '}
        {profileLabel}.
      </p>
      <a
        href="/login"
        className="inline-block rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
      >
        Go to sign in
      </a>
    </div>
  )
}

/**
 * Shown when the email belongs to an orphaned auth account (created but
 * never fully claimed) and the password the user typed doesn't match.
 * Identical copy across DJ/vendor — the recovery options aren't
 * role-specific.
 */
export function OrphanWrongPasswordNotice({
  onRetry,
}: {
  onRetry: () => void
}) {
  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
      <p>
        An account already exists for this email, but the password you
        entered doesn&apos;t match. You can:
      </p>
      <ul className="ml-5 list-disc space-y-1 text-xs">
        <li>Re-submit the form with your existing password to reclaim the profile.</li>
        <li>Reset your password if you don&apos;t remember it.</li>
        <li>Use a different email address.</li>
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
        >
          Try again
        </button>
        <a
          href="/forgot-password"
          className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
        >
          Reset password
        </a>
      </div>
    </div>
  )
}

/** Shown when the email is already registered under the *other* role. */
export function OrphanWrongRoleNotice({
  roleLabel,
  onRetry,
}: {
  /** e.g. "DJ" or "vendor". */
  roleLabel: string
  onRetry: () => void
}) {
  return (
    <div className="space-y-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
      <p>
        This email is already registered with a different role and
        can&apos;t be used to register as a {roleLabel}. Please use a
        different email, or contact an admin if you think this is a
        mistake.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-red-900 px-3 py-1.5 text-xs font-medium text-red-50 hover:bg-red-800 dark:bg-red-200 dark:text-red-950 dark:hover:bg-red-100"
      >
        Use a different email
      </button>
    </div>
  )
}
