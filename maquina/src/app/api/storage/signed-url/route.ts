import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * POST /api/storage/signed-url
 *
 * Issues a short-lived (60 min) signed download URL for a file in the `w9s`
 * bucket. This is the only path through which W-9 PDFs are ever exposed —
 * the bucket is private, the storage RLS only grants admins SELECT access,
 * and DJs use this route to fetch their own file.
 *
 * Request body:  { storagePath: string }   e.g. "{user_id}/w9.pdf"
 * Response:      { signedUrl: string }     200 on success
 *                { error: string }         4xx/5xx otherwise
 *
 * Authorization:
 *   - Caller must be authenticated.
 *   - Admins can request any path in the w9s bucket.
 *   - DJs can request only paths whose first segment is their own user_id.
 *   - Any other role: 403.
 *
 * The signed URL itself is generated with the service-role key, but the
 * authorization decision above runs first using the request's user session,
 * so the service-role key never grants access we haven't already approved.
 */

const SIGNED_URL_TTL_SECONDS = 60 * 60 // 1 hour

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const storagePath =
    body && typeof body === 'object' && 'storagePath' in body
      ? (body as { storagePath: unknown }).storagePath
      : null

  if (typeof storagePath !== 'string' || storagePath.length === 0) {
    return NextResponse.json(
      { error: 'storagePath is required' },
      { status: 400 }
    )
  }

  // Defensive path normalization — reject obvious traversal attempts. The
  // signed-url SDK itself wouldn't follow `..` but we don't want to feed it
  // anything other than `{uuid}/file.pdf`.
  if (storagePath.includes('..') || storagePath.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('roles')
    .eq('user_id', user.id)
    .maybeSingle()
  const roles: string[] = profile?.roles ?? []

  if (!roles.includes('admin')) {
    // DJ self-access: first path segment must equal user.id.
    const ownerSegment = storagePath.split('/')[0]
    if (!roles.includes('dj') || ownerSegment !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await admin.storage
    .from('w9s')
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? 'Could not generate signed URL' },
      { status: 500 }
    )
  }

  return NextResponse.json({ signedUrl: data.signedUrl })
}
