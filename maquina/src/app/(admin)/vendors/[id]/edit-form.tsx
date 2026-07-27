'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { updateVendor, type UpdateVendorResult } from './actions'

/**
 * Admin vendor edit form. Mirrors src/app/(admin)/djs/[id]/edit-form.tsx
 * (see that file for design notes) with the vendor field set — company
 * name / contact name instead of DJ name / legal name, no rank field.
 */

const REGIONS = ['SoCal', 'NorCal', 'Chicago', 'Arizona', 'Seattle', 'Other', 'New York', 'Portland', 'Texas', 'Central Cal', 'Las Vegas'] as const

const FormSchema = z.object({
  company_name: z.string().trim().min(1, 'Company name is required').max(200),
  contact_name: z.string().trim().min(1, 'Contact name is required').max(200),
  email: z.string().trim().email('Invalid email'),
  phone: z.string().trim().max(40).optional(),
  region: z.enum(REGIONS),
  pay_method: z.enum(['', 'zelle', 'venmo', 'paypal']).optional(),
  pay_handle: z.string().trim().max(120).optional(),
  w9_status: z.enum(['pending', 'on_file']),
})

type FormValues = z.infer<typeof FormSchema>

export function EditVendorForm({
  vendorId,
  initial,
}: {
  vendorId: string
  initial: FormValues
}) {
  const [pending, startTransition] = useTransition()
  const [view, setView] = useState<
    | { kind: 'idle' }
    | { kind: 'saved' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: initial,
  })

  function onSubmit(values: FormValues) {
    const fd = new FormData()
    fd.set('id', vendorId)
    for (const [k, v] of Object.entries(values)) {
      if (v !== undefined && v !== null) fd.set(k, String(v))
    }

    startTransition(async () => {
      const result: UpdateVendorResult = await updateVendor(fd)
      if (result.ok) {
        setView({ kind: 'saved' })
        reset(values) // marks form clean again
        setTimeout(() => setView({ kind: 'idle' }), 2000)
        return
      }
      if (result.reason === 'invalid') {
        const FORM_FIELDS = new Set<keyof FormValues>([
          'company_name',
          'contact_name',
          'email',
          'phone',
          'region',
          'pay_method',
          'pay_handle',
          'w9_status',
        ])
        let highlightedAny = false
        const stray: string[] = []
        for (const issue of result.issues) {
          const head = issue.path.split('.')[0] as keyof FormValues
          if (FORM_FIELDS.has(head)) {
            setError(head, { message: issue.message })
            highlightedAny = true
          } else {
            stray.push(`${issue.path}: ${issue.message}`)
          }
        }
        setView({
          kind: 'error',
          message: highlightedAny
            ? 'Please fix the highlighted fields.'
            : stray.length
              ? `Validation failed — ${stray.join('; ')}`
              : 'Validation failed (no detail returned).',
        })
        return
      }
      if (result.reason === 'forbidden' || result.reason === 'unauth') {
        setView({
          kind: 'error',
          message: 'You are not authorized to edit vendors.',
        })
        return
      }
      setView({ kind: 'error', message: result.message })
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Company name" error={errors.company_name?.message}>
          <input
            type="text"
            {...register('company_name')}
            className={inputClass}
            disabled={pending}
          />
        </Field>

        <Field label="Contact name" error={errors.contact_name?.message}>
          <input
            type="text"
            {...register('contact_name')}
            className={inputClass}
            disabled={pending}
          />
        </Field>

        <Field label="Email" error={errors.email?.message}>
          <input
            type="email"
            {...register('email')}
            className={inputClass}
            disabled={pending}
          />
        </Field>

        <Field label="Phone" error={errors.phone?.message}>
          <input
            type="tel"
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

        <Field label="Pay method" error={errors.pay_method?.message}>
          <select
            {...register('pay_method')}
            className={inputClass}
            disabled={pending}
          >
            <option value="">—</option>
            <option value="zelle">Zelle</option>
            <option value="venmo">Venmo</option>
            <option value="paypal">PayPal</option>
          </select>
        </Field>

        <Field label="Pay handle" error={errors.pay_handle?.message}>
          <input
            type="text"
            {...register('pay_handle')}
            className={inputClass}
            disabled={pending}
          />
        </Field>

        <Field label="W-9 status" error={errors.w9_status?.message}>
          <select
            {...register('w9_status')}
            className={inputClass}
            disabled={pending}
          >
            <option value="pending">Pending</option>
            <option value="on_file">On file</option>
          </select>
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={pending || !isDirty}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>

        {view.kind === 'saved' && (
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            ✓ Saved
          </span>
        )}
        {view.kind === 'error' && (
          <span className="text-xs text-red-600 dark:text-red-400">
            {view.message}
          </span>
        )}
      </div>
    </form>
  )
}

const inputClass =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-700'

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
