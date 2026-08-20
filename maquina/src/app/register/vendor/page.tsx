import { RegistrationForm } from './registration-form'

/**
 * Public vendor self-registration. No auth required. Mirrors
 * /register/dj but writes to the `vendors` table and gives the new
 * profile role = 'vendor'. After successful registration the user
 * lands on /vendor/upload-w9.
 */
export default function VendorRegisterPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <div className="w-full max-w-2xl space-y-8 px-2 py-6 sm:p-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Register as a vendor
          </h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Create your vendor account so LosGothsCo can book your services.
            You&apos;ll upload your W-9 right after.
          </p>
        </div>
        <RegistrationForm />
      </div>
    </div>
  )
}
