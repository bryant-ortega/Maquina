import { RegistrationForm } from './registration-form'

/**
 * Public DJ self-registration. No auth required. The form posts to a server
 * action that pre-checks for duplicates, then sends a magic-link email. No
 * row is committed to `djs` until the link is clicked — the auth callback
 * drains the form fields out of user_metadata into the djs table.
 */
export default function DjRegisterPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <div className="w-full max-w-2xl space-y-8 px-2 py-6 sm:p-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Register as a DJ</h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Create your account to get added to the LosGothsCo roster.
            You&apos;ll upload your W-9 right after.
          </p>
        </div>
        <RegistrationForm />
      </div>
    </div>
  )
}
