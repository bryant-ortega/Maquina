'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Admin updates a vendor row by id.
 *
 * Mirrors src/app/(admin)/djs/[id]/actions.ts (updateDj) — see that file
 * for the design notes on the three-layer authorization approach. Same
 * pattern here, just targeting `vendors` and its slightly different
 * field set (company_name/contact_name instead of dj_name/government_name,
 * no rank column).
 *
 * After a successful write we revalidate both /vendors (roster pills
 * could change) and /vendors/[id] (the form re-renders with fresh data).
 */

const REGIONS = ['SoCal', 'NorCal', 'Chicago', 'Arizona', 'Seattle', 'Other', 'New York', 'Portland', 'Texas', 'Central Cal', 'Las Vegas'] as const

// Postgres' uuid type accepts any 8-4-4-4-12 hex pattern. Zod 4's .uuid()
// is stricter (version nibble must be 1-5), which rejects our seed UUIDs.
// Relax to a shape check — the FK + RLS catch any actual bad value.
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const UpdateVendorInput = z.object({
  id: z.string().regex(UUID_LIKE, 'Invalid id'),
  company_name: z.string().trim().min(1, 'Company name is required').max(200),
  contact_name: z.string().trim().min(1, 'Contact name is required').max(200),
  email: z.string().trim().toLowerCase().email('Invalid email'),
  phone: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(40).optional()
  ),
  region: z.enum(REGIONS),
  pay_method: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['zelle', 'venmo', 'paypal']).optional()
  ),
  pay_handle: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(120).optional()
  ),
  w9_status: z.enum(['pending', 'on_file']),
})

export type ValidationIssue = { path: string; message: string }

export type UpdateVendorResult =
  | { ok: true }
  | { ok: false; reason: 'unauth' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'invalid'; issues: ValidationIssue[] }
  | { ok: false; reason: 'db_failed'; message: string }

export async function updateVendor(
  formData: FormData
): Promise<UpdateVendorResult> {
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
  if (!profile?.roles?.includes('admin')) return { ok: false, reason: 'forbidden' }

  const raw = {
    id: formData.get('id'),
    company_name: formData.get('company_name'),
    contact_name: formData.get('contact_name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    region: formData.get('region'),
    pay_method: formData.get('pay_method'),
    pay_handle: formData.get('pay_handle'),
    w9_status: formData.get('w9_status'),
  }
  const parsed = UpdateVendorInput.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.map(String).join('.') || '(form)',
        message: i.message,
      })),
    }
  }

  const { id, ...patch } = parsed.data

  const { error } = await supabase
    .from('vendors')
    .update({
      company_name: patch.company_name,
      contact_name: patch.contact_name,
      email: patch.email,
      phone: patch.phone ?? null,
      region: patch.region,
      pay_method: patch.pay_method ?? null,
      pay_handle: patch.pay_handle ?? null,
      w9_status: patch.w9_status,
    })
    .eq('id', id)

  if (error) {
    return { ok: false, reason: 'db_failed', message: error.message }
  }

  revalidatePath('/vendors')
  revalidatePath(`/vendors/${id}`)
  return { ok: true }
}

/**
 * Admin uploads a W-9 PDF on behalf of a vendor.
 *
 * Mirrors src/app/(admin)/djs/[id]/actions.ts (uploadDjW9) — the target
 * vendor is identified by `vendor_id`, and the storage path uses the
 * vendor's `user_id` so it matches the existing scheme:
 *   w9s/{vendor_user_id}/w9.pdf
 *
 * Authorization layers (same as updateVendor above):
 *   1. (admin) layout gates the page on role === 'admin'
 *   2. This action re-checks role on the server
 *   3. Service-role client bypasses RLS for the storage write; we manually
 *      enforce the user_id invariant by looking it up from the vendor row.
 */

const MAX_W9_BYTES = 10 * 1024 * 1024 // 10 MB — matches the dj/vendor-side limit

export type UploadVendorW9Result =
  | { ok: true }
  | { ok: false; reason: 'unauth' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'invalid_id' }
  | { ok: false; reason: 'no_vendor_row' }
  | { ok: false; reason: 'no_file' }
  | { ok: false; reason: 'wrong_type' }
  | { ok: false; reason: 'too_large' }
  | { ok: false; reason: 'storage_failed'; message: string }
  | { ok: false; reason: 'db_failed'; message: string }

export async function uploadVendorW9(
  formData: FormData
): Promise<UploadVendorW9Result> {
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
  if (!profile?.roles?.includes('admin')) return { ok: false, reason: 'forbidden' }

  const vendorId = formData.get('vendor_id')
  if (typeof vendorId !== 'string' || !UUID_LIKE.test(vendorId)) {
    return { ok: false, reason: 'invalid_id' }
  }

  // Look up the vendor's user_id — this is what the storage path keys
  // off, and the only authoritative source is the vendors row itself.
  // Unlike djs, vendors.user_id is NOT NULL, so there's no "no linked
  // user" branch to handle here.
  const { data: vendor } = await supabase
    .from('vendors')
    .select('user_id')
    .eq('id', vendorId)
    .maybeSingle()
  if (!vendor) return { ok: false, reason: 'no_vendor_row' }

  const file = formData.get('w9') as File | null
  if (!file || file.size === 0) return { ok: false, reason: 'no_file' }

  const isPdfMime = file.type === 'application/pdf'
  const isPdfName = file.name.toLowerCase().endsWith('.pdf')
  if (!isPdfMime || !isPdfName) return { ok: false, reason: 'wrong_type' }

  if (file.size > MAX_W9_BYTES) return { ok: false, reason: 'too_large' }

  const path = `${vendor.user_id}/w9.pdf`

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadError } = await admin.storage
    .from('w9s')
    .upload(path, arrayBuffer, {
      contentType: 'application/pdf',
      upsert: true, // re-uploads replace prior W-9 in place
    })

  if (uploadError) {
    return { ok: false, reason: 'storage_failed', message: uploadError.message }
  }

  const { error: updateError } = await admin
    .from('vendors')
    .update({ w9_storage_path: path, w9_status: 'on_file' })
    .eq('id', vendorId)

  if (updateError) {
    return { ok: false, reason: 'db_failed', message: updateError.message }
  }

  // Stop any pending W-9 reminders for this vendor (best-effort).
  await admin
    .from('w9_reminders')
    .update({ stopped_at: new Date().toISOString() })
    .eq('vendor_id', vendorId)
    .is('stopped_at', null)

  revalidatePath('/vendors')
  revalidatePath(`/vendors/${vendorId}`)
  return { ok: true }
}

/**
 * Admin grants or revokes the 'contract' role on a vendor's linked
 * profiles row.
 *
 * Contract (renamed from 'designer' in migration 0029) is a locked,
 * read-only role that shows one custom view of upcoming events —
 * meant for photographers, videographers, and flyer designers who are
 * already in the `vendors` table. It's additive: a vendor keeps their
 * normal 'vendor' role and everything that comes with it (W-9 upload,
 * profile page), and just gains a second landing surface at
 * /contract/view. There's no self-registration path for this — it's
 * always granted here, by an admin, on top of an existing account.
 *
 * `profiles.roles` has no CHECK constraint (see migration 0027's
 * notes — it was tied to the now-dropped singular `role` column), so
 * this is a plain array add/remove, not an enum-validated write.
 */
export type SetVendorContractRoleResult =
  | { ok: true; enabled: boolean }
  | { ok: false; reason: 'unauth' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'invalid_id' }
  | { ok: false; reason: 'no_vendor_row' }
  | { ok: false; reason: 'no_profile_row' }
  | { ok: false; reason: 'db_failed'; message: string }

export async function setVendorContractRole(
  vendorId: string,
  enabled: boolean
): Promise<SetVendorContractRoleResult> {
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
  if (!profile?.roles?.includes('admin')) return { ok: false, reason: 'forbidden' }

  if (!UUID_LIKE.test(vendorId)) return { ok: false, reason: 'invalid_id' }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: vendor } = await admin
    .from('vendors')
    .select('user_id')
    .eq('id', vendorId)
    .maybeSingle()
  if (!vendor) return { ok: false, reason: 'no_vendor_row' }

  const { data: targetProfile } = await admin
    .from('profiles')
    .select('id, roles')
    .eq('user_id', vendor.user_id)
    .maybeSingle()
  if (!targetProfile) return { ok: false, reason: 'no_profile_row' }

  const current: string[] = targetProfile.roles ?? []
  const nextRoles = enabled
    ? Array.from(new Set([...current, 'contract']))
    : current.filter((r) => r !== 'contract')

  const { error } = await admin
    .from('profiles')
    .update({ roles: nextRoles })
    .eq('id', targetProfile.id)

  if (error) {
    return { ok: false, reason: 'db_failed', message: error.message }
  }

  revalidatePath(`/vendors/${vendorId}`)
  return { ok: true, enabled }
}
