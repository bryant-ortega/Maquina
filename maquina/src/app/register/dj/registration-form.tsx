'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { registerDj, type RegisterDjResult } from './actions'
import {
  inputClass,
  Field,
  AlreadyRegisteredNotice,
  OrphanWrongPasswordNotice,
  OrphanWrongRoleNotice,
} from '../_shared/form-parts'

/**
 * DJ self-registration form. Mirrors the server-side zod schema in actions.ts
 * so the client gets immediate validation feedback before submitting.
 *
 * On success the server action redirects to /dj/upload-w9 — no magic-link
 * round-trip; the password establishes account ownership immediately.
 * If the email is already on a DJ record, we show a friendly "already
 * registered" message with a link to /login.
 */

const FormSchema = z.object({
  dj_name: z.string().trim().min(1, 'DJ name is required').max(100),
  government_name: z.string().trim().min(1, 'Legal name is required').max(200),
  email: z.string().trim().max(254, 'Enter a valid email').email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be 128 characters or fewer'),
  phone: z.string().trim().min(1, 'Phone is required').max(40),
  region: z.enum(['SoCal', 'NorCal', 'Chicago', 'Arizona', 'Seattle', 'Other', 'New York', 'Portland', 'Texas', 'Central Cal', 'Las Vegas']),
  pay_method: z.enum(['zelle', 'venmo', 'paypal'], { message: 'Pay method is required' }),
  pay_handle: z.string().trim().min(1, 'Pay handle is required').max(120),
})

type FormValues = z.infer<typeof FormSchema>

type ViewState =
  | { kind: 'idle' }
  | { kind: 'already_registered' }
  | { kind: 'orphan_wrong_password' }
  | { kind: 'orphan_wrong_role' }
  | { kind: 'error'; message: string }

const REGIONS = [
  'SoCal',
  'NorCal',
  'Chicago',
  'Arizona',
  'Seattle',
  'Other',
  'New York',
  'Portland',
  'Texas',
  'Central Cal',
  'Las Vegas',
] as const

export function RegistrationForm() {
  const [view, setView] = useState<ViewState>({ kind: 'idle' })
  const [pending, startTransition] = useTransition()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { region: 'SoCal', pay_method: 'zelle' },
  })

  function onSubmit(values: FormValues) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(values)) {
      if (v !== undefined && v !== null) fd.set(k, String(v))
    }

    startTransition(async () => {
      // On success the server action redirects (never returns). Anything
      // we get back here is an error.
      const result = (await registerDj(fd)) as RegisterDjResult | undefined
      if (!result) return
      if (result.reason === 'already_registered') {
        setView({ kind: 'already_registered' })
        return
      }
      if (result.reason === 'orphan_wrong_password') {
        setView({ kind: 'orphan_wrong_password' })
        return
      }
      if (result.reason === 'orphan_wrong_role') {
        setView({ kind: 'orphan_wrong_role' })
        return
      }
      if (result.reason === 'invalid') {
        for (const [field, msgs] of Object.entries(result.fieldErrors)) {
          if (msgs && msgs.length) {
            setError(field as keyof FormValues, { message: msgs[0] })
          }
        }
        setView({ kind: 'error', message: 'Please fix the highlighted fields.' })
        return
      }
      setView({ kind: 'error', message: result.message })
    })
  }

  if (view.kind === 'already_registered') {
    return <AlreadyRegisteredNotice profileLabel="profile" />
  }

  if (view.kind === 'orphan_wrong_password') {
    return (
      <OrphanWrongPasswordNotice onRetry={() => setView({ kind: 'idle' })} />
    )
  }

  if (view.kind === 'orphan_wrong_role') {
    return (
      <OrphanWrongRoleNotice
        roleLabel="DJ"
        onRetry={() => setView({ kind: 'idle' })}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Field
        label="DJ name"
        hint="Stage name as it should appear on lineups."
        error={errors.dj_name?.message}
      >
        <input
          type="text"
          autoComplete="off"
          {...register('dj_name')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field
        label="Legal name"
        hint="For W-9 / payment paperwork. Stays private."
        error={errors.government_name?.message}
      >
        <input
          type="text"
          autoComplete="name"
          {...register('government_name')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field label="Email" error={errors.email?.message}>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          {...register('email')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field
        label="Password"
        hint="At least 8 characters. You'll use this to sign in."
        error={errors.password?.message}
      >
        <input
          type="password"
          autoComplete="new-password"
          {...register('password')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field label="Phone" error={errors.phone?.message}>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          {...register('phone')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field label="Region" error={errors.region?.message}>
        <select
          {...register('region')}
          className={inputClass}
          disabled={pending}
        >
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Pay method" error={errors.pay_method?.message}>
          <select
            {...register('pay_method')}
            className={inputClass}
            disabled={pending}
          >
            <option value="zelle">Zelle</option>
            <option value="venmo">Venmo</option>
            <option value="paypal">PayPal</option>
          </select>
        </Field>

        <Field label="Pay handle (@name, or phone number)" error={errors.pay_handle?.message}>
          <input
            type="text"
            autoComplete="off"
            placeholder="@you / email / phone"
            {...register('pay_handle')}
            className={inputClass}
            disabled={pending}
          />
        </Field>
      </div>

      {view.kind === 'error' && (
        <p className="text-sm text-red-600 dark:text-red-400">{view.message}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {pending ? 'Creating account…' : 'Create account'}
      </button>

      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        Your account is created instantly. Next, we&apos;ll ask you to upload
        your W-9 so we can pay you.
      </p>
    </form>
  )
}
