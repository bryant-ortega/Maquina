'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Server action that uploads a vendor's W-9 PDF.
 *
 * Mirrors the DJ upload action — see /dj/upload-w9/actions.ts for the
 * design notes. Storage path: w9s/{user_id}/w9.pdf, same bucket as
 * DJs. Migration 0004's w9_upload_own and w9_update_own policies
 * already allow any authenticated user to write to their own folder,
 * so no storage RLS change was needed for vendors.
 */

const MAX_W9_BYTES = 10 * 1024 * 1024 // 10 MB

export type UploadVendorW9Result =
  | { ok: true }
  | { ok: false; reason: 'unauth' }
  | { ok: false; reason: 'wrong_role' }
  | { ok: false; reason: 'no_file' }
  | { ok: false; reason: 'wrong_type' }
  | { ok: false; reason: 'too_large' }
  | { ok: false; reason: 'no_vendor_row' }
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
  if (!profile?.roles?.includes('vendor')) return { ok: false, reason: 'wrong_role' }

  const { data: vendor } = await supabase
    .from('vendors')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!vendor) return { ok: false, reason: 'no_vendor_row' }

  const file = formData.get('w9') as File | null
  if (!file || file.size === 0) return { ok: false, reason: 'no_file' }

  const isPdfMime = file.type === 'application/pdf'
  const isPdfName = file.name.toLowerCase().endsWith('.pdf')
  if (!isPdfMime || !isPdfName) return { ok: false, reason: 'wrong_type' }

  if (file.size > MAX_W9_BYTES) return { ok: false, reason: 'too_large' }

  const path = `${user.id}/w9.pdf`

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
      upsert: true,
    })

  if (uploadError) {
    return { ok: false, reason: 'storage_failed', message: uploadError.message }
  }

  const { error: updateError } = await admin
    .from('vendors')
    .update({
      w9_storage_path: path,
      w9_status: 'on_file',
    })
    .eq('user_id', user.id)

  if (updateError) {
    return { ok: false, reason: 'db_failed', message: updateError.message }
  }

  // Stop any pending W-9 reminders for this vendor (best-effort).
  await admin
    .from('w9_reminders')
    .update({ stopped_at: new Date().toISOString() })
    .eq('vendor_id', vendor.id)
    .is('stopped_at', null)

  return { ok: true }
}
