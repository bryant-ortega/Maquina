'use server'

import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  sendOfrendasVendorApplicationReceipt,
  sendOfrendasVendorApprovalEmail,
} from '@/lib/email'
import {
  checkRateLimit,
  formatRetryAfter,
  getClientIp,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { isOfrendasApplicationClosed } from './deadline'
import { claimOfrendasVendorInvite } from '@/lib/ofrendas-invites'

/**
 * Server action for /ofrendas-vendors — the standalone Ofrendas vendor
 * application form. Not part of the real vendor onboarding flow
 * (register/vendor/actions.ts): no auth account is created, nothing is
 * written to `vendors`. This only writes to the isolated
 * `ofrendas_vendor_applications` table.
 *
 * Field list mirrors Ofrendas_Vendor_Application_Form_Spec.md exactly
 * (15 questions) — see application-form.tsx for the option constants
 * shared with the client-side schema.
 *
 * Uses the service-role key deliberately — that table has RLS enabled
 * with no anon/authenticated policies, so this insert only works
 * server-side, same pattern as register/vendor/actions.ts.
 *
 * To remove this feature entirely, see
 * supabase/teardown/ofrendas_vendor_applications_teardown.sql.
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

const ApplicationInput = z
  .object({
    business_name: z.string().trim().min(1, 'Business name is required').max(200),
    vendor_names: z.string().trim().min(1, 'Vendor name(s) are required').max(300),
    email: z.string().trim().toLowerCase().max(254, 'Enter a valid email').email('Enter a valid email'),
    phone: z.string().trim().min(1, 'Phone is required').max(40),
    instagram_handle: z
      .string()
      .trim()
      .min(1, 'Instagram handle is required')
      .max(100),
    website_url: z.string().trim().max(300).optional(),
    offerings: z
      .array(z.enum(OFFERING_OPTIONS))
      .min(1, 'Select at least one')
      // OFFERING_OPTIONS has 9 entries — a legit submission can't select
      // more than that. Bounds a checkbox-group array against someone
      // replaying the same value thousands of times in a raw POST.
      .max(OFFERING_OPTIONS.length),
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

  // A private invite link (invite/[code]/page.tsx) bypasses the
  // public deadline for this one submission — the code itself still
  // gets validated + atomically claimed below, after field validation
  // passes, so a bad/expired/reused code is rejected either way.
  const inviteCodeRaw = formData.get('invite_code')
  const inviteCode =
    typeof inviteCodeRaw === 'string' && inviteCodeRaw.trim()
      ? inviteCodeRaw.trim()
      : null

  // Belt-and-suspenders: page.tsx already hides the form after the
  // deadline, but this stops a direct POST (cached page, replayed
  // request, dev tools) from sneaking a late application in — unless
  // it's carrying a valid invite code.
  if (!inviteCode && isOfrendasApplicationClosed()) {
    return {
      ok: false,
      reason: 'error',
      message:
        'Applications for Ofrendas are closed. Thanks for your interest — watch our Instagram @Ofrendasmarket for future calls.',
    }
  }

  // Public, unauthenticated form — rate limited to 5 submissions /
  // 15 min per IP as a spam backstop alongside the honeypot above.
  const ip = getClientIp(await headers())
  const limit = await checkRateLimit(
    `ofrendas-apply:ip:${ip}`,
    RATE_LIMITS.PUBLIC_FORM
  )
  if (!limit.allowed) {
    return {
      ok: false,
      reason: 'error',
      message: `Too many submissions from this connection. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`,
    }
  }

  const optionalStr = (key: string) => {
    const v = formData.get(key)
    return typeof v === 'string' && v.trim() ? v : undefined
  }

  const raw = {
    business_name: formData.get('business_name'),
    vendor_names: formData.get('vendor_names'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    instagram_handle: formData.get('instagram_handle'),
    website_url: optionalStr('website_url'),
    offerings: formData.getAll('offerings'),
    offerings_other: optionalStr('offerings_other'),
    best_fit: formData.get('best_fit'),
    best_fit_other: optionalStr('best_fit_other'),
    business_description: formData.get('business_description'),
    space_needed: formData.get('space_needed'),
    food_permit_status: formData.get('food_permit_status'),
    food_permit_other: optionalStr('food_permit_other'),
    menu_description: optionalStr('menu_description'),
    agreement_accepted: formData.get('agreement_accepted') === 'on',
    content_use_consent: formData.get('content_use_consent'),
    booth_decor_plan: optionalStr('booth_decor_plan'),
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

  // Claim the invite now, right before writing the application — a
  // code only gets burned once we know the rest of the form is valid.
  // Atomic (WHERE used_at IS NULL) so two submissions racing on the
  // same link can't both succeed.
  if (inviteCode) {
    const claimed = await claimOfrendasVendorInvite(inviteCode)
    if (!claimed) {
      return {
        ok: false,
        reason: 'error',
        message:
          "This invite link isn't valid anymore — it may have already been used. Reach out to ofrendasmarket@gmail.com for a new one.",
      }
    }
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // A submission that came through a private invite link means an
  // admin already decided this vendor is in — skip the normal review
  // queue and mark it approved immediately, same as manually checking
  // the "Approved" box on the admin page would. approved_email_sent_at
  // is left unset here and only stamped below once the email actually
  // sends (dormant-safe, same convention as the bulk "Email approved
  // vendors" button), so if it fails or RESEND_API_KEY isn't
  // configured, the row stays picked up by that button next time.
  const nowIso = new Date().toISOString()

  const { data: inserted, error } = await admin
    .from('ofrendas_vendor_applications')
    .insert({
      business_name: parsed.data.business_name,
      vendor_names: parsed.data.vendor_names,
      email: parsed.data.email,
      phone: parsed.data.phone,
      instagram_handle: parsed.data.instagram_handle,
      website_url: parsed.data.website_url ?? null,
      offerings: parsed.data.offerings,
      offerings_other: parsed.data.offerings_other ?? null,
      best_fit: parsed.data.best_fit,
      best_fit_other: parsed.data.best_fit_other ?? null,
      business_description: parsed.data.business_description,
      space_needed: parsed.data.space_needed,
      food_permit_status: parsed.data.food_permit_status,
      food_permit_other: parsed.data.food_permit_other ?? null,
      menu_description: parsed.data.menu_description ?? null,
      agreement_accepted: parsed.data.agreement_accepted,
      content_use_consent: parsed.data.content_use_consent,
      booth_decor_plan: parsed.data.booth_decor_plan ?? null,
      invite_code: inviteCode,
      ...(inviteCode ? { approved: true, approved_at: nowIso } : {}),
    })
    .select('id')
    .single()

  if (error) {
    return {
      ok: false,
      reason: 'error',
      message:
        'Something went wrong submitting your application. Please try again in a moment.',
    }
  }

  if (inviteCode) {
    // Invite path: skip the generic "we got your application, we'll
    // review it" receipt — they're already approved, so send that
    // instead. Best-effort, same as the receipt email below: never
    // blocks a successful submission.
    try {
      const result = await sendOfrendasVendorApprovalEmail({
        to: parsed.data.email,
        contactName: parsed.data.vendor_names,
        businessName: parsed.data.business_name,
      })
      if (result.ok) {
        await admin
          .from('ofrendas_vendor_applications')
          .update({ approved_email_sent_at: nowIso })
          .eq('id', inserted.id)
      }
    } catch {
      // ignore — application + approval already saved; the "Email
      // approved vendors" bulk button will pick this row up next time
      // since approved_email_sent_at is still null
    }

    return { ok: true }
  }

  // Best-effort receipt email — dormant-safe (no-op without
  // RESEND_API_KEY) and never blocks a successful submission.
  try {
    await sendOfrendasVendorApplicationReceipt({
      to: parsed.data.email,
      contactName: parsed.data.vendor_names,
      businessName: parsed.data.business_name,
    })
  } catch {
    // ignore — application already saved
  }

  return { ok: true }
}
