'use server'

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { sendOfrendasVendorApplicationReceipt } from '@/lib/email'

/**
 * Server action for /ofrendas-vendors — the standalone Ofrendas vendor
 * application form. Not part of the real vendor onboarding flow
 * (register/vendor/actions.ts): no auth account is created, nothing is
 * written to `vendors`. This only writes to the isolated
 * `ofrendas_vendor_applications` table (migration 0032).
 *
 * Uses the service-role key deliberately — that table has RLS enabled
 * with no anon/authenticated policies, so this insert only works
 * server-side, same pattern as register/vendor/actions.ts.
 *
 * To remove this feature entirely, see
 * supabase/teardown/ofrendas_vendor_applications_teardown.sql.
 */

const CATEGORY_OPTIONS = [
  'Clothing & accessories',
  'Occult & oddity collectibles',
  'Arts & artistic creations',
  'Pet-related goods',
  'Food & beverage',
  'Other',
] as const

const ApplicationInput = z.object({
  business_name: z.string().trim().min(1, 'Business name is required').max(200),
  contact_name: z.string().trim().min(1, 'Contact name is required').max(200),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
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

export type SubmitApplicationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid'; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: 'error'; message: string }

export async function submitOfrendasVendorApplication(
  formData: FormData
): Promise<SubmitApplicationResult> {
  // Honeypot: a hidden field real users never see or fill. Bots that
  // blindly fill every input will trip it — silently "succeed" without
  // writing anything.
  if (formData.get('company_url')) {
    return { ok: true }
  }

  const raw = {
    business_name: formData.get('business_name'),
    contact_name: formData.get('contact_name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    instagram_or_website: formData.get('instagram_or_website') || undefined,
    categories: formData.getAll('categories'),
    plant_based_options: formData.get('plant_based_options') === 'on',
    description: formData.get('description'),
    additional_notes: formData.get('additional_notes') || undefined,
  }

  const parsed = ApplicationInput.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    }
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { error } = await admin
    .from('ofrendas_vendor_applications')
    .insert(parsed.data)

  if (error) {
    return {
      ok: false,
      reason: 'error',
      message:
        'Something went wrong submitting your application. Please try again in a moment.',
    }
  }

  // Best-effort receipt email — dormant-safe (no-op without
  // RESEND_API_KEY) and never blocks a successful submission.
  try {
    await sendOfrendasVendorApplicationReceipt({
      to: parsed.data.email,
      contactName: parsed.data.contact_name,
      businessName: parsed.data.business_name,
    })
  } catch {
    // ignore — application already saved
  }

  return { ok: true }
}
