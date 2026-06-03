'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Server action that uploads a DJ's W-9 PDF.
 *
 * Why a server action and not a client-side storage upload:
 *   - We validate file type + size on the trusted side (client checks are
 *     hints only — never trust them alone).
 *   - The upload + djs update happen in one place, so a partial failure can
 *     be cleaned up.
 *   - DJs don't need any storage permissions of their own beyond what the
 *     w9_upload_own RLS policy grants. We use the service-role here for the
 *     storage write because it's simpler than juggling the user's storage
 *     session client-side; the user_id we write to is always taken from the
 *     authenticated session, not from the request body.
 *
 * Storage path: w9s/{user_id}/w9.pdf
 *   - RLS w9_upload_own confirms a DJ can only insert into their own folder
 *     when they upload directly. Service-role bypasses RLS, so we *manually*
 *     enforce the same invariant here.
 */

const MAX_W9_BYTES = 10 * 1024 * 1024 // 10 MB

export type UploadW9Result =
  | { ok: true }
  | { ok: false; reason: 'unauth' }
  | { ok: false; reason: 'wrong_role' }
  | { ok: false; reason: 'no_file' }
  | { ok: false; reason: 'wrong_type' }
  | { ok: false; reason: 'too_large' }
  | { ok: false; reason: 'no_dj_row' }
  | { ok: false; reason: 'storage_failed'; message: string }
  | { ok: false; reason: 'db_failed'; message: string }

export async function uploadW9(formData: FormData): Promise<UploadW9Result> {
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
  if (!profile?.roles?.includes('dj')) return { ok: false, reason: 'wrong_role' }

  // The DJ must already exist in the djs table — set up at registration callback.
  const { data: dj } = await supabase
    .from('djs')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!dj) return { ok: false, reason: 'no_dj_row' }

  const file = formData.get('w9') as File | null
  if (!file || file.size === 0) return { ok: false, reason: 'no_file' }

  // Browser-reported MIME types are unreliable, but for PDFs they're stable
  // enough to reject blatant mismatches at the edge. We also enforce on
  // extension as a belt-and-braces check.
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
      upsert: true, // re-uploads replace prior W-9 in place
    })

  if (uploadError) {
    return { ok: false, reason: 'storage_failed', message: uploadError.message }
  }

  // Record the path + flip status. We store the bucket-relative path so the
  // signed-url route can reconstruct it without ambiguity.
  const { error: updateError } = await admin
    .from('djs')
    .update({
      w9_storage_path: path,
      w9_status: 'on_file',
    })
    .eq('user_id', user.id)

  if (updateError) {
    return { ok: false, reason: 'db_failed', message: updateError.message }
  }

  // Stop any pending W-9 reminders for this DJ (best-effort; the cron
  // also filters by w9_status, but this records when reminders ceased).
  await admin
    .from('w9_reminders')
    .update({ stopped_at: new Date().toISOString() })
    .eq('dj_id', dj.id)
    .is('stopped_at', null)

  return { ok: true }
}
