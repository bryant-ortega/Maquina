'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  submitOfrendasVendorApplication,
  type SubmitApplicationResult,
} from './actions'

/**
 * Standalone application form for the Ofrendas vendor call. Kept
 * self-contained (own schema, own styles, no imports from
 * register/_shared) so this whole feature can be deleted by removing
 * this directory — nothing else depends on it.
 */

const CATEGORY_OPTIONS = [
  'Clothing & accessories',
  'Occult & oddity collectibles',
  'Arts & artistic creations',
  'Pet-related goods',
  'Food & beverage',
  'Other',
] as const

const FormSchema = z.object({
  business_name: z.string().trim().min(1, 'Business name is required').max(200),
  contact_name: z.string().trim().min(1, 'Contact name is required').max(200),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.string().trim().min(1, 'Phone is required').max(40),
  instagram_or_website: z.string().trim().max(200).optional(),
  categories: z
    .array(z.enum(CATEGORY_OPTIONS))
    .min(1, 'Select at least one category'),
  plant_based_options: z.boolean().optional(),
  description: z
    .string()
    .trim()
    .min(1, "Tell us a bit about what you'd be selling")
    .max(2000),
  additional_notes: z.string().trim().max(2000).optional(),
})

type FormValues = z.infer<typeof FormSchema>

const inputClass =
  'block w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 shadow-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-700 disabled:opacity-60'

function Field({
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
      <label className="block text-sm font-medium text-zinc-200">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

export function ApplicationForm() {
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [honeypot, setHoneypot] = useState('')
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { categories: [], plant_based_options: false },
  })

  function onSubmit(values: FormValues) {
    setServerError(null)
    const fd = new FormData()
    if (honeypot) fd.set('company_url', honeypot)
    fd.set('business_name', values.business_name)
    fd.set('contact_name', values.contact_name)
    fd.set('email', values.email)
    fd.set('phone', values.phone)
    if (values.instagram_or_website)
      fd.set('instagram_or_website', values.instagram_or_website)
    values.categories.forEach((c) => fd.append('categories', c))
    if (values.plant_based_options) fd.set('plant_based_options', 'on')
    fd.set('description', values.description)
    if (values.additional_notes)
      fd.set('additional_notes', values.additional_notes)

    startTransition(async () => {
      const result: SubmitApplicationResult =
        await submitOfrendasVendorApplication(fd)

      if (result.ok) {
        setSubmitted(true)
        return
      }
      if (result.reason === 'invalid') {
        for (const [field, msgs] of Object.entries(result.fieldErrors)) {
          if (msgs?.length) {
            setError(field as keyof FormValues, { message: msgs[0] })
          }
        }
        setServerError('Please fix the highlighted fields.')
        return
      }
      setServerError(result.message)
    })
  }

  if (submitted) {
    return (
      <div className="space-y-2 rounded-md border border-zinc-700 bg-zinc-900 p-5 text-center">
        <p className="text-base font-medium text-zinc-100">
          Thanks — your application is in. 🖤
        </p>
        <p className="text-sm text-zinc-400">
          We review vendor applications on a rolling basis and will reach
          out by email if it&apos;s a fit for Ofrendas.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/*
        Honeypot — plain controlled input, not part of the zod schema or
        react-hook-form state. Hidden from real visitors via CSS; bots
        that blindly fill every input trip it.
      */}
      <input
        type="text"
        name="company_url"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <Field label="Business / vendor name" error={errors.business_name?.message}>
        <input
          type="text"
          autoComplete="organization"
          {...register('business_name')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field label="Contact name" error={errors.contact_name?.message}>
        <input
          type="text"
          autoComplete="name"
          {...register('contact_name')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Email" error={errors.email?.message}>
          <input
            type="email"
            autoComplete="email"
            {...register('email')}
            className={inputClass}
            disabled={pending}
          />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <input
            type="tel"
            autoComplete="tel"
            {...register('phone')}
            className={inputClass}
            disabled={pending}
          />
        </Field>
      </div>

      <Field
        label="Instagram or website"
        hint="Optional, but it helps us see your work."
        error={errors.instagram_or_website?.message}
      >
        <input
          type="text"
          placeholder="@yourshop or yoursite.com"
          {...register('instagram_or_website')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field label="What would you be selling?" error={errors.categories?.message}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATEGORY_OPTIONS.map((cat) => (
            <label
              key={cat}
              className="flex items-center gap-2 text-sm text-zinc-300"
            >
              <input
                type="checkbox"
                value={cat}
                {...register('categories')}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-zinc-100"
                disabled={pending}
              />
              {cat}
            </label>
          ))}
        </div>
      </Field>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          {...register('plant_based_options')}
          className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-zinc-100"
          disabled={pending}
        />
        We can offer plant-based options
      </label>

      <Field
        label="Tell us about your products or services"
        error={errors.description?.message}
      >
        <textarea
          rows={4}
          {...register('description')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field
        label="Anything else? Links to photos, past markets, etc."
        error={errors.additional_notes?.message}
      >
        <textarea
          rows={3}
          {...register('additional_notes')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      {serverError && <p className="text-sm text-red-400">{serverError}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Submitting…' : 'Submit application'}
      </button>
    </form>
  )
}
