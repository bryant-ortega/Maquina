'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Admin updates a DJ row by id.
 *
 * Authorization layers:
 *   1. The (admin) layout already enforced role===admin before any page in
 *      this group rendered. Forms posting here go through the admin shell,
 *      so the request was implicitly admin-authorized at navigation time.
 *   2. We re-check on the server (defence in depth) — never trust a layout
 *      check alone for a write.
 *   3. RLS policy `djs_update_admin` enforces it a third time at the DB.
 *
 * Validation: zod schema matches the djs CHECK constraints exactly so a
 * client-side bypass can't slip a bad value through.
 *
 * After a successful write we revalidate both /djs (roster pills could
 * change) and /djs/[id] (the form re-renders with fresh data).
 */

const REGIONS = ['SoCal', 'NorCal', 'Chicago', 'Arizona', 'Seattle', 'Other', 'New York', 'Portland', 'Texas', 'Central Cal', 'Las Vegas'] as const

// Postgres' uuid type accepts any 8-4-4-4-12 hex pattern. Zod 4's .uuid()
// is stricter (version nibble must be 1-5), which rejects our seed UUIDs
// like b1000000-0000-0000-0000-000000000001. Relax to a shape check —
// the FK + RLS catch any actual bad value before it touches a row.
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const UpdateDjInput = z.object({
  id: z.string().regex(UUID_LIKE, 'Invalid id'),
  dj_name: z.string().trim().min(1, 'DJ name is required').max(100),
  government_name: z.string().trim().min(1, 'Legal name is required').max(200),
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
  rank: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(40).optional()
  ),
  w9_status: z.enum(['pending', 'on_file']),
})

export type ValidationIssue = { path: string; message: string }

export type UpdateDjResult =
  | { ok: true }
  | { ok: false; reason: 'unauth' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'invalid'; issues: ValidationIssue[] }
  | { ok: false; reason: 'db_failed'; message: string }

export async function updateDj(formData: FormData): Promise<UpdateDjResult> {
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
    dj_name: formData.get('dj_name'),
    government_name: formData.get('government_name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    region: formData.get('region'),
    pay_method: formData.get('pay_method'),
    pay_handle: formData.get('pay_handle'),
    rank: formData.get('rank'),
    w9_status: formData.get('w9_status'),
  }
  const parsed = UpdateDjInput.safeParse(raw)
  if (!parsed.success) {
    // Use `issues` directly instead of `flatten()` — across zod versions
    // it's the most reliable way to get path + message for every problem.
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
    .from('djs')
    .update({
      dj_name: patch.dj_name,
      government_name: patch.government_name,
      email: patch.email,
      phone: patch.phone ?? null,
      region: patch.region,
      pay_method: patch.pay_method ?? null,
      pay_handle: patch.pay_handle ?? null,
      rank: patch.rank ?? null,
      w9_status: patch.w9_status,
    })
    .eq('id', id)

  if (error) {
    return { ok: false, reason: 'db_failed', message: error.message }
  }

  revalidatePath('/djs')
  revalidatePath(`/djs/${id}`)
  return { ok: true }
}

/**
 * Admin uploads a W-9 PDF on behalf of a DJ.
 *
 * Mirrors src/app/dj/upload-w9/actions.ts but the target DJ is identified
 * by `dj_id` rather than the caller's session, and the storage path uses
 * the DJ's `user_id` (not the admin's) so it matches the existing scheme:
 *   w9s/{dj_user_id}/w9.pdf
 *
 * Authorization layers (same as updateDj above):
 *   1. (admin) layout gates the page on role === 'admin'
 *   2. This action re-checks role on the server
 *   3. Service-role client bypasses RLS for the storage write; we manually
 *      enforce the user_id invariant by looking it up from the dj row.
 */

const MAX_W9_BYTES = 10 * 1024 * 1024 // 10 MB — matches dj-side limit

export type UploadDjW9Result =
  | { ok: true }
  | { ok: false; reason: 'unauth' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'invalid_id' }
  | { ok: false; reason: 'no_dj_row' }
  | { ok: false; reason: 'no_user_id'; message: string }
  | { ok: false; reason: 'no_file' }
  | { ok: false; reason: 'wrong_type' }
  | { ok: false; reason: 'too_large' }
  | { ok: false; reason: 'storage_failed'; message: string }
  | { ok: false; reason: 'db_failed'; message: string }

export async function uploadDjW9(
  formData: FormData
): Promise<UploadDjW9Result> {
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

  const djId = formData.get('dj_id')
  if (typeof djId !== 'string' || !UUID_LIKE.test(djId)) {
    return { ok: false, reason: 'invalid_id' }
  }

  // Look up the DJ's user_id — this is what the storage path keys off,
  // and the only authoritative source is the djs row itself.
  const { data: dj } = await supabase
    .from('djs')
    .select('user_id')
    .eq('id', djId)
    .maybeSingle()
  if (!dj) return { ok: false, reason: 'no_dj_row' }
  if (!dj.user_id) {
    return {
      ok: false,
      reason: 'no_user_id',
      message:
        'This DJ has no linked auth user yet. Have them finish registration before uploading a W-9 for them.',
    }
  }

  const file = formData.get('w9') as File | null
  if (!file || file.size === 0) return { ok: false, reason: 'no_file' }

  const isPdfMime = file.type === 'application/pdf'
  const isPdfName = file.name.toLowerCase().endsWith('.pdf')
  if (!isPdfMime || !isPdfName) return { ok: false, reason: 'wrong_type' }

  if (file.size > MAX_W9_BYTES) return { ok: false, reason: 'too_large' }

  const path = `${dj.user_id}/w9.pdf`

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
    .from('djs')
    .update({ w9_storage_path: path, w9_status: 'on_file' })
    .eq('id', djId)

  if (updateError) {
    return { ok: false, reason: 'db_failed', message: updateError.message }
  }

  // Stop any pending W-9 reminders for this DJ (best-effort).
  await admin
    .from('w9_reminders')
    .update({ stopped_at: new Date().toISOString() })
    .eq('dj_id', djId)
    .is('stopped_at', null)

  revalidatePath('/djs')
  revalidatePath(`/djs/${djId}`)
  return { ok: true }
}
