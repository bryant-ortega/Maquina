'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  sendOfrendasVendorApprovalEmail,
  sendOfrendasVendorPaymentConfirmationEmail,
} from '@/lib/email'

/**
 * Admin actions for the Ofrendas vendor applications view:
 *   - setApplicationApproved / setApplicationPaid — the per-row
 *     checkbox toggles in status-toggles.tsx.
 *   - sendApprovedVendorEmails / sendPaidVendorEmails — the two bulk
 *     "send a form email" buttons in bulk-email-button.tsx.
 *
 * Same authorization + client pattern as djs/[id]/actions.ts:
 *   1. Re-check the caller is signed in and has role===admin using the
 *      cookie-bound client (the (admin) layout already gates the page,
 *      this is defense in depth for the action itself).
 *   2. Do the actual read/write with a service-role client, because
 *      ofrendas_vendor_applications has RLS enabled with zero policies
 *      for anon/authenticated (see migrations 0032/0033) — even a
 *      signed-in admin can't touch this table through the normal
 *      cookie-bound client.
 */

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function requireAdmin(): Promise<
  { ok: true } | { ok: false; reason: 'unauth' | 'forbidden' }
> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauth' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('roles')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.roles?.includes('admin')) {
    return { ok: false, reason: 'forbidden' }
  }
  return { ok: true }
}

export type ToggleResult =
  | { ok: true }
  | { ok: false; reason: 'unauth' | 'forbidden' | 'invalid_id' }
  | { ok: false; reason: 'db_failed'; message: string }

/**
 * Toggle the `approved` flag on one application. Unchecking clears
 * `approved_email_sent_at` so a later re-approval is eligible for the
 * bulk approval email again (see 0035's migration header comment).
 */
export async function setApplicationApproved(
  id: string,
  approved: boolean
): Promise<ToggleResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  if (!UUID_LIKE.test(id)) return { ok: false, reason: 'invalid_id' }

  const admin = serviceClient()
  const { error } = await admin
    .from('ofrendas_vendor_applications')
    .update({
      approved,
      approved_at: approved ? new Date().toISOString() : null,
      ...(approved ? {} : { approved_email_sent_at: null }),
    })
    .eq('id', id)

  if (error) return { ok: false, reason: 'db_failed', message: error.message }

  revalidatePath('/ofrendas-vendor-applications')
  revalidatePath(`/ofrendas-vendor-applications/${id}`)
  return { ok: true }
}

/**
 * Toggle the `paid` flag on one application. Same "clear the sent
 * timestamp on uncheck" behavior as approval, for the same reason.
 */
export async function setApplicationPaid(
  id: string,
  paid: boolean
): Promise<ToggleResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  if (!UUID_LIKE.test(id)) return { ok: false, reason: 'invalid_id' }

  const admin = serviceClient()
  const { error } = await admin
    .from('ofrendas_vendor_applications')
    .update({
      paid,
      paid_at: paid ? new Date().toISOString() : null,
      ...(paid ? {} : { paid_email_sent_at: null }),
    })
    .eq('id', id)

  if (error) return { ok: false, reason: 'db_failed', message: error.message }

  revalidatePath('/ofrendas-vendor-applications')
  revalidatePath(`/ofrendas-vendor-applications/${id}`)
  return { ok: true }
}

export type SendBulkEmailResult =
  | { ok: true; sent: number; skipped: number; failed: number }
  | { ok: false; reason: 'unauth' | 'forbidden' }
  | { ok: false; reason: 'db_failed'; message: string }

/**
 * Sends the approval email to every approved application that hasn't
 * been emailed yet (approved_email_sent_at IS NULL), one send per
 * vendor. Marks approved_email_sent_at only for sends that actually go
 * out — if RESEND_API_KEY isn't configured, sendEmail no-ops and we
 * deliberately leave those rows unmarked so they're picked up once
 * email is live (dormant-safe, same as the rest of lib/email.ts).
 */
export async function sendApprovedVendorEmails(): Promise<SendBulkEmailResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const admin = serviceClient()
  const { data: rows, error } = await admin
    .from('ofrendas_vendor_applications')
    .select('id, email, vendor_names, business_name')
    .eq('approved', true)
    .is('approved_email_sent_at', null)

  if (error) return { ok: false, reason: 'db_failed', message: error.message }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const row of rows ?? []) {
    const result = await sendOfrendasVendorApprovalEmail({
      to: row.email,
      contactName: row.vendor_names,
      businessName: row.business_name,
    })
    if (result.ok) {
      sent++
      await admin
        .from('ofrendas_vendor_applications')
        .update({ approved_email_sent_at: new Date().toISOString() })
        .eq('id', row.id)
    } else if (result.skipped) {
      skipped++
    } else {
      failed++
    }
  }

  revalidatePath('/ofrendas-vendor-applications')
  return { ok: true, sent, skipped, failed }
}

/**
 * Same as sendApprovedVendorEmails but for the "Email paid vendors"
 * button — every paid application with paid_email_sent_at still null.
 */
export async function sendPaidVendorEmails(): Promise<SendBulkEmailResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const admin = serviceClient()
  const { data: rows, error } = await admin
    .from('ofrendas_vendor_applications')
    .select('id, email, vendor_names, business_name')
    .eq('paid', true)
    .is('paid_email_sent_at', null)

  if (error) return { ok: false, reason: 'db_failed', message: error.message }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const row of rows ?? []) {
    const result = await sendOfrendasVendorPaymentConfirmationEmail({
      to: row.email,
      contactName: row.vendor_names,
      businessName: row.business_name,
    })
    if (result.ok) {
      sent++
      await admin
        .from('ofrendas_vendor_applications')
        .update({ paid_email_sent_at: new Date().toISOString() })
        .eq('id', row.id)
    } else if (result.skipped) {
      skipped++
    } else {
      failed++
    }
  }

  revalidatePath('/ofrendas-vendor-applications')
  return { ok: true, sent, skipped, failed }
}
