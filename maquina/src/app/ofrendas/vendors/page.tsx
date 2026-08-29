import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { OfrendasMasthead } from '@/components/ofrendas/masthead'

/**
 * Public Ofrendas vendors list — every approved AND paid vendor,
 * business name linked out to their Instagram. Approved-but-unpaid
 * vendors are deliberately excluded: Chase's call was not to publicly
 * list someone before their 48-hour payment window closes, in case
 * they back out.
 *
 * `ofrendas_vendor_applications` has RLS enabled with zero anon/
 * authenticated policies (0032/0033), so this reads via the
 * service-role client — same pattern as the admin applications page.
 * Only two non-sensitive columns are selected; nothing here should
 * ever pull email/phone/other applicant fields onto a public page.
 *
 * force-dynamic so a newly-approved-and-paid vendor shows up without
 * a redeploy — Next would otherwise be free to statically cache this
 * at build time since there's no auth/cookie access forcing dynamic
 * rendering.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Vendors — Ofrendas',
}

type VendorRow = {
  business_name: string
  instagram_handle: string | null
}

/** Strips a leading "@" — the form's placeholder suggests one, but the
 * field doesn't enforce it, so stored handles are inconsistent. */
function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle.replace(/^@/, '').trim()}`
}

export default async function OfrendasVendorsListPage() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: vendors } = await admin
    .from('ofrendas_vendor_applications')
    .select('business_name, instagram_handle')
    .eq('approved', true)
    .eq('paid', true)
    .order('business_name', { ascending: true })

  const rows = (vendors ?? []) as VendorRow[]

  return (
    <div className="flex flex-1 items-center justify-center bg-black px-3 py-8 sm:px-6 sm:py-16">
      <div className="w-full max-w-2xl space-y-8">
        <OfrendasMasthead />

        <h1 className="text-center text-3xl font-semibold tracking-tight text-zinc-100">
          Vendors
        </h1>

        {rows.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">
            Vendor lineup coming soon.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map((v) => (
              <li key={v.business_name}>
                {v.instagram_handle ? (
                  <a
                    href={instagramUrl(v.instagram_handle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-center text-sm text-zinc-200 underline underline-offset-2 hover:bg-zinc-900 hover:text-zinc-100"
                  >
                    {v.business_name}
                  </a>
                ) : (
                  <span className="block rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-center text-sm text-zinc-400">
                    {v.business_name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
