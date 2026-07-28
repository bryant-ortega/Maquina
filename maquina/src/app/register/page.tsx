import Link from 'next/link'

/**
 * /register — chooser landing page. No form here; just picks which
 * self-registration flow to send someone into. The real forms stay at
 * their own URLs (/register/dj, /register/vendor) exactly as before —
 * this page only adds a front door so people don't have to already
 * know which sub-path to type in, and gives login page / marketing
 * links one shareable "register" URL to point at instead of guessing
 * DJ vs vendor up front.
 */
export default function RegisterChooserPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            Register with LosGothsCo
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            How would you like to register?
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/register/dj"
            className="group flex flex-col gap-1.5 rounded-2xl border border-zinc-200 bg-white p-6 text-left shadow-sm transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
          >
            <span className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Register as a DJ
            </span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Get added to the LosGothsCo roster and booked for events.
            </span>
            <span className="mt-2 text-sm font-medium text-zinc-700 group-hover:underline dark:text-zinc-300">
              Continue →
            </span>
          </Link>

          <Link
            href="/register/vendor"
            className="group flex flex-col gap-1.5 rounded-2xl border border-zinc-200 bg-white p-6 text-left shadow-sm transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
          >
            <span className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Register as a vendor
            </span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Set up your business so LosGothsCo can book your services.
            </span>
            <span className="mt-2 text-sm font-medium text-zinc-700 group-hover:underline dark:text-zinc-300">
              Continue →
            </span>
          </Link>
        </div>

        <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
          Already have an account?{' '}
          <Link
            href="/login"
            className="text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
