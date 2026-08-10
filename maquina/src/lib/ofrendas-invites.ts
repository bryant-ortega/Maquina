import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { absoluteUrl } from '@/lib/email'

/**
 * Private invite links for the Ofrendas vendor call
 * (migration 0039_ofrendas_vendor_invites.sql).
 *
 * Lets an admin or ofrendas_partner let one specific late vendor
 * submit after the public deadline (src/app/ofrendas-vendors/deadline.ts)
 * without reopening the form for everyone. The link itself is the
 * credential — a long random URL-safe token — so every lookup here is
 * an exact `WHERE code = $1` match, never a listing.
 *
 * Used by:
 *   - src/app/ofrendas-vendor-applications/actions.ts (generate)
 *   - src/app/ofrendas-vendors/invite/[code]/page.tsx (check, read-only)
 *   - src/app/ofrendas-vendors/actions.ts (claim, at submit time)
 */

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/** 24-character URL-safe token — 144 bits of entropy, not guessable. */
function generateInviteCode(): string {
  return crypto.randomBytes(18).toString('base64url')
}

export type CreateInviteResult =
  | { ok: true; code: string; url: string }
  | { ok: false; message: string }

/**
 * Creates a new invite and returns the full link to copy/paste and
 * send to the vendor by whatever channel makes sense (email,
 * Instagram DM, text). `note` is admin-facing only — never shown to
 * the vendor — so the admin list stays legible later.
 */
export async function createOfrendasVendorInvite(
  note: string | null,
  createdByProfileId: string | null
): Promise<CreateInviteResult> {
  const code = generateInviteCode()
  const admin = serviceClient()

  const { error } = await admin.from('ofrendas_vendor_invites').insert({
    code,
    note: note?.trim() || null,
    created_by: createdByProfileId,
  })

  if (error) {
    return { ok: false, message: error.message }
  }

  return { ok: true, code, url: absoluteUrl(`/ofrendas-vendors/invite/${code}`) }
}

export type InviteStatus = 'valid' | 'used' | 'expired' | 'not_found'

/**
 * Read-only check for rendering the invite page — does NOT consume
 * the code. Consumption only happens at successful submit time via
 * claimOfrendasVendorInvite, so refreshing or bookmarking this page
 * doesn't burn the invite.
 */
export async function getOfrendasInviteStatus(
  code: string
): Promise<InviteStatus> {
  if (!code) return 'not_found'

  const admin = serviceClient()
  const { data, error } = await admin
    .from('ofrendas_vendor_invites')
    .select('used_at, expires_at')
    .eq('code', code)
    .maybeSingle()

  if (error || !data) return 'not_found'
  if (data.used_at) return 'used'
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return 'expired'
  }
  return 'valid'
}

/**
 * Atomically marks an invite used. Returns true only if this call is
 * the one that claimed it (used_at was still null) — guards against
 * the same link being redeemed twice from two tabs/devices at once.
 */
export async function claimOfrendasVendorInvite(
  code: string
): Promise<boolean> {
  if (!code) return false

  const admin = serviceClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await admin
    .from('ofrendas_vendor_invites')
    .update({ used_at: nowIso })
    .eq('code', code)
    .is('used_at', null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .select('id')
    .maybeSingle()

  return !error && !!data
}
