'use client'

import { useState, useTransition } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  submitOfrendasVendorApplication,
  type SubmitApplicationResult,
} from './actions'

/**
 * Full application form for the Ofrendas vendor call — 15 questions,
 * matching Ofrendas_Vendor_Application_Form_Spec.md exactly (option
 * text, required/optional-ness, section grouping). Kept self-contained
 * (own schema, own styles, no imports from register/_shared) so this
 * whole feature can be deleted by removing this directory — nothing
 * else depends on it.
 */

const OFFERING_OPTIONS = [
  'Apparel & Accessories',
  'Jewelry',
  'Occult / Oddities / Altar Goods',
  'Art & Home Decor',
  'Pet Goods',
  'Food',
  'Beverages',
  'Services',
  'Other',
] as const

const BEST_FIT_OPTIONS = [
  'Handmade, independent-designer, thrifted, or vintage goth fashion',
  'Occult, oddities, tarot & altar goods',
  'Dark art, illustration & home decor',
  'Latino-culture-inspired & Latino-goth creations',
  'Pet-related goth goods',
  'Food, treats & beverages',
  'Other',
] as const

const SPACE_OPTIONS = [
  '1 space (6ft x 6ft)',
  '2 spaces (up to 10x10 footprint)',
] as const

const FOOD_PERMIT_OPTIONS = [
  "Yes, I'll send a copy once my space is secured.",
  'I hold an active Food Truck/Trailer/Cart permit and will send a copy once my space is secured.',
  "Not yet, but I'll complete my TFF application at least 30 days before the event.",
  'N/A — not a food or beverage vendor.',
  'Other',
] as const

const CONTENT_CONSENT_OPTIONS = ['Yes, happy to!', 'No'] as const

const BOOTH_DECOR_OPTIONS = [
  'Yes, already planning something!',
  'Not this time.',
] as const

const AGREEMENT_TERMS = [
  "I'll feature gothic, alternative, and/or Latino-culture-inspired items as my main display, with anything else kept secondary and on-theme.",
  "I'm responsible for my own setup, my own TFF/permits (if applicable), and my own booth — no sharing spaces.",
  "I'll show up ready to be warm, welcoming, and easy to work with — for guests and the Ofrendas team alike.",
  "I'll help keep the energy positive and drama-free.",
  "I'll talk up Ofrendas within my own community and help spread the word.",
  "I'll check my Instagram DMs and email for event updates, and I'm fine receiving emails about marketing, invoices, and receipts.",
  "I understand Ofrendas / LosGothsCo and The Regent Theater aren't liable for my business or outcomes beyond their control (including weather).",
  "I won't smoke, vape, bring outside alcohol, or use open flame at the venue, and I won't play my own music or use outside speakers.",
  'I understand not following these terms may get me removed from the market.',
  "I agree there are no refunds, and I'll pay my vendor fee within 48 hours of approval.",
]

const FormSchema = z
  .object({
    business_name: z.string().trim().min(1, 'Business name is required').max(200),
    vendor_names: z.string().trim().min(1, 'Vendor name(s) are required').max(300),
    email: z.string().trim().email('Enter a valid email'),
    phone: z.string().trim().min(1, 'Phone is required').max(40),
    instagram_handle: z
      .string()
      .trim()
      .min(1, 'Instagram handle is required')
      .max(100),
    website_url: z.string().trim().max(300).optional(),
    offerings: z
      .array(z.enum(OFFERING_OPTIONS))
      .min(1, 'Select at least one'),
    offerings_other: z.string().trim().max(200).optional(),
    best_fit: z.enum(BEST_FIT_OPTIONS, { message: 'Please select one' }),
    best_fit_other: z.string().trim().max(200).optional(),
    business_description: z
      .string()
      .trim()
      .min(1, 'Tell us about your business')
      .max(3000),
    space_needed: z.enum(SPACE_OPTIONS, { message: 'Please select one' }),
    food_permit_status: z.enum(FOOD_PERMIT_OPTIONS, {
      message: 'Please select one',
    }),
    food_permit_other: z.string().trim().max(200).optional(),
    menu_description: z.string().trim().max(2000).optional(),
    agreement_accepted: z.boolean(),
    content_use_consent: z.enum(CONTENT_CONSENT_OPTIONS, {
      message: 'Please select one',
    }),
    booth_decor_plan: z.enum(BOOTH_DECOR_OPTIONS).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.offerings.includes('Other') && !data.offerings_other) {
      ctx.addIssue({
        code: 'custom',
        path: ['offerings_other'],
        message: 'Please describe what you offer.',
      })
    }
    if (data.best_fit === 'Other' && !data.best_fit_other) {
      ctx.addIssue({
        code: 'custom',
        path: ['best_fit_other'],
        message: 'Please describe where your work fits.',
      })
    }
    if (data.food_permit_status === 'Other' && !data.food_permit_other) {
      ctx.addIssue({
        code: 'custom',
        path: ['food_permit_other'],
        message: 'Please provide details.',
      })
    }
    if (!data.agreement_accepted) {
      ctx.addIssue({
        code: 'custom',
        path: ['agreement_accepted'],
        message: 'You must agree to the Ofrendas Vendor Agreement to submit.',
      })
    }
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

function SectionHeading({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  return (
    <div className="border-t border-zinc-800 pt-6 first:mt-0 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>}
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
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { offerings: [], agreement_accepted: false },
  })

  const offerings = useWatch({ control, name: 'offerings' })
  const bestFit = useWatch({ control, name: 'best_fit' })
  const foodPermitStatus = useWatch({ control, name: 'food_permit_status' })

  function onSubmit(values: FormValues) {
    setServerError(null)
    const fd = new FormData()
    if (honeypot) fd.set('company_url', honeypot)
    fd.set('business_name', values.business_name)
    fd.set('vendor_names', values.vendor_names)
    fd.set('email', values.email)
    fd.set('phone', values.phone)
    fd.set('instagram_handle', values.instagram_handle)
    if (values.website_url) fd.set('website_url', values.website_url)
    values.offerings.forEach((o) => fd.append('offerings', o))
    if (values.offerings_other)
      fd.set('offerings_other', values.offerings_other)
    fd.set('best_fit', values.best_fit)
    if (values.best_fit_other) fd.set('best_fit_other', values.best_fit_other)
    fd.set('business_description', values.business_description)
    fd.set('space_needed', values.space_needed)
    fd.set('food_permit_status', values.food_permit_status)
    if (values.food_permit_other)
      fd.set('food_permit_other', values.food_permit_other)
    if (values.menu_description)
      fd.set('menu_description', values.menu_description)
    if (values.agreement_accepted) fd.set('agreement_accepted', 'on')
    fd.set('content_use_consent', values.content_use_consent)
    if (values.booth_decor_plan)
      fd.set('booth_decor_plan', values.booth_decor_plan)

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
          Applying doesn&apos;t guarantee a spot — we review every submission
          against our curation criteria. Watch your email; if you haven&apos;t
          heard back, assume you&apos;re on the waitlist and sit tight.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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

      <SectionHeading title="Vendor & business info" />

      <Field label="Business name *" error={errors.business_name?.message}>
        <input
          type="text"
          autoComplete="organization"
          {...register('business_name')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field label="Vendor name(s) *" error={errors.vendor_names?.message}>
        <input
          type="text"
          autoComplete="name"
          {...register('vendor_names')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Contact email *" error={errors.email?.message}>
          <input
            type="email"
            autoComplete="email"
            {...register('email')}
            className={inputClass}
            disabled={pending}
          />
        </Field>
        <Field label="Contact phone number *" error={errors.phone?.message}>
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
        label="Instagram handle *"
        hint="ex: @Ofrendasmarket — double-check for typos, this is how we'll reach you."
        error={errors.instagram_handle?.message}
      >
        <input
          type="text"
          placeholder="@yourshop"
          {...register('instagram_handle')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <Field
        label="Website or online shop link"
        hint="If you have one."
        error={errors.website_url?.message}
      >
        <input
          type="text"
          placeholder="yoursite.com"
          {...register('website_url')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <SectionHeading title="What you're bringing" />

      <Field
        label="Which of these describe what you sell or offer? *"
        hint="Select all that apply."
        error={errors.offerings?.message}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {OFFERING_OPTIONS.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 text-sm text-zinc-300"
            >
              <input
                type="checkbox"
                value={opt}
                {...register('offerings')}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-zinc-100"
                disabled={pending}
              />
              {opt}
            </label>
          ))}
        </div>
        {offerings?.includes('Other') && (
          <input
            type="text"
            placeholder="Tell us what you offer"
            {...register('offerings_other')}
            className={`${inputClass} mt-2`}
            disabled={pending}
          />
        )}
        {errors.offerings_other && (
          <p className="text-xs text-red-400">
            {errors.offerings_other.message}
          </p>
        )}
      </Field>

      <Field
        label="Where does your work fit best in the Ofrendas world? *"
        error={errors.best_fit?.message}
      >
        <div className="space-y-2">
          {BEST_FIT_OPTIONS.map((opt) => (
            <label
              key={opt}
              className="flex items-start gap-2 text-sm text-zinc-300"
            >
              <input
                type="radio"
                value={opt}
                {...register('best_fit')}
                className="mt-0.5 h-4 w-4 border-zinc-700 bg-zinc-900 text-zinc-100"
                disabled={pending}
              />
              {opt}
            </label>
          ))}
        </div>
        {bestFit === 'Other' && (
          <input
            type="text"
            placeholder="Tell us where your work fits"
            {...register('best_fit_other')}
            className={`${inputClass} mt-2`}
            disabled={pending}
          />
        )}
        {errors.best_fit_other && (
          <p className="text-xs text-red-400">
            {errors.best_fit_other.message}
          </p>
        )}
      </Field>

      <Field
        label="Tell us about your business and how it fits the Ofrendas atmosphere. *"
        hint="Be descriptive — we want guests to feel the mood before they even reach your booth."
        error={errors.business_description?.message}
      >
        <textarea
          rows={4}
          {...register('business_description')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <SectionHeading title="Space needed" />

      <Field label="How much space do you need? *" error={errors.space_needed?.message}>
        <div className="space-y-2">
          {SPACE_OPTIONS.map((opt) => (
            <label
              key={opt}
              className="flex items-start gap-2 text-sm text-zinc-300"
            >
              <input
                type="radio"
                value={opt}
                {...register('space_needed')}
                className="mt-0.5 h-4 w-4 border-zinc-700 bg-zinc-900 text-zinc-100"
                disabled={pending}
              />
              {opt}
            </label>
          ))}
        </div>
      </Field>

      <SectionHeading
        title="Food & beverage vendors only"
        subtitle="Everyone answers this — select N/A if it doesn't apply to you."
      />

      <Field
        label="Are you fully permitted and insured? A TFF (Temporary Food Facility permit) is required. *"
        error={errors.food_permit_status?.message}
      >
        <div className="space-y-2">
          {FOOD_PERMIT_OPTIONS.map((opt) => (
            <label
              key={opt}
              className="flex items-start gap-2 text-sm text-zinc-300"
            >
              <input
                type="radio"
                value={opt}
                {...register('food_permit_status')}
                className="mt-0.5 h-4 w-4 border-zinc-700 bg-zinc-900 text-zinc-100"
                disabled={pending}
              />
              {opt}
            </label>
          ))}
        </div>
        {foodPermitStatus === 'Other' && (
          <input
            type="text"
            placeholder="Tell us more"
            {...register('food_permit_other')}
            className={`${inputClass} mt-2`}
            disabled={pending}
          />
        )}
        {errors.food_permit_other && (
          <p className="text-xs text-red-400">
            {errors.food_permit_other.message}
          </p>
        )}
      </Field>

      <Field
        label="What will be on your menu?"
        hint="Include plant-based options if you have them."
        error={errors.menu_description?.message}
      >
        <textarea
          rows={3}
          {...register('menu_description')}
          className={inputClass}
          disabled={pending}
        />
      </Field>

      <SectionHeading title="A few things we ask" />

      <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-4">
        <p className="text-sm font-medium text-zinc-200">
          Ofrendas Vendor Agreement — by checking below, you agree to the
          following:
        </p>
        <ul className="ml-4 list-disc space-y-1.5 text-xs leading-relaxed text-zinc-400">
          {AGREEMENT_TERMS.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-sm font-medium text-zinc-200">
          <input
            type="checkbox"
            {...register('agreement_accepted')}
            className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-zinc-100"
            disabled={pending}
          />
          I AGREE TO THE OFRENDAS VENDOR AGREEMENT *
        </label>
        {errors.agreement_accepted && (
          <p className="text-xs text-red-400">
            {errors.agreement_accepted.message}
          </p>
        )}
      </div>

      <Field
        label="Can we use your content? *"
        hint="Share at least 6 product photos and 2 short video clips before the event, plus anything captured at the event, for Ofrendas marketing."
        error={errors.content_use_consent?.message}
      >
        <div className="space-y-2">
          {CONTENT_CONSENT_OPTIONS.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 text-sm text-zinc-300"
            >
              <input
                type="radio"
                value={opt}
                {...register('content_use_consent')}
                className="h-4 w-4 border-zinc-700 bg-zinc-900 text-zinc-100"
                disabled={pending}
              />
              {opt}
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="Thinking about extra decor for your booth to level up the vibe?"
        hint="Totally optional — just curious!"
        error={errors.booth_decor_plan?.message}
      >
        <div className="space-y-2">
          {BOOTH_DECOR_OPTIONS.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 text-sm text-zinc-300"
            >
              <input
                type="radio"
                value={opt}
                {...register('booth_decor_plan')}
                className="h-4 w-4 border-zinc-700 bg-zinc-900 text-zinc-100"
                disabled={pending}
              />
              {opt}
            </label>
          ))}
        </div>
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
