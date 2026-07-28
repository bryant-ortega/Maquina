import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * GET /api/finance/w9-zip
 *
 * Bundles every on-file W-9 (DJs + vendors) into a single ZIP, organized
 * into DJs/ and Vendors/ folders. Built for the finance role's bulk
 * download button (migration 0030) — per Chase: "download all W9s",
 * with the per-row download buttons on /finance/djs and /finance/vendors
 * covering the single-file case.
 *
 * Authorization: same rule as /api/storage/signed-url — admin or
 * finance role only. Files are fetched with the service-role key
 * (bypasses storage RLS) only after that check passes.
 *
 * Skips silently (does not fail the whole request) if an individual
 * file download errors — partial ZIPs are more useful than a hard
 * failure when one row has a stale/missing storage object.
 */
export async function GET() {
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
  if (!roles.includes('admin') && !roles.includes('finance')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const [{ data: djs }, { data: vendors }] = await Promise.all([
    admin
      .from('djs')
      .select('dj_name, w9_storage_path')
      .eq('w9_status', 'on_file')
      .not('w9_storage_path', 'is', null),
    admin
      .from('vendors')
      .select('company_name, w9_storage_path')
      .eq('w9_status', 'on_file')
      .not('w9_storage_path', 'is', null),
  ])

  const zip = new JSZip()
  const djsFolder = zip.folder('DJs')!
  const vendorsFolder = zip.folder('Vendors')!
  const usedNames = new Set<string>()

  function uniqueName(folder: 'DJs' | 'Vendors', label: string): string {
    const base = sanitizeFilename(label) || 'unnamed'
    let candidate = `${folder}/${base}.pdf`
    let n = 2
    while (usedNames.has(candidate)) {
      candidate = `${folder}/${base}-${n}.pdf`
      n++
    }
    usedNames.add(candidate)
    return candidate
  }

  async function addFile(
    folder: JSZip,
    folderLabel: 'DJs' | 'Vendors',
    label: string,
    storagePath: string
  ) {
    const { data, error } = await admin.storage
      .from('w9s')
      .download(storagePath)
    if (error || !data) return
    const filePath = uniqueName(folderLabel, label)
    const arrayBuffer = await data.arrayBuffer()
    folder.file(filePath.split('/').slice(1).join('/'), arrayBuffer)
  }

  await Promise.all([
    ...(djs ?? []).map((d) =>
      addFile(djsFolder, 'DJs', d.dj_name as string, d.w9_storage_path as string)
    ),
    ...(vendors ?? []).map((v) =>
      addFile(
        vendorsFolder,
        'Vendors',
        v.company_name as string,
        v.w9_storage_path as string
      )
    ),
  ])

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  const dateStamp = new Date().toISOString().slice(0, 10)

  // Node's Buffer<ArrayBufferLike> generic doesn't line up cleanly with
  // DOM's BlobPart typing (TS 5.7+); a plain Uint8Array copy sidesteps it.
  const zipBytes = new Uint8Array(zipBuffer)

  return new NextResponse(new Blob([zipBytes]), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="w9s-${dateStamp}.zip"`,
    },
  })
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, ' ')
}
