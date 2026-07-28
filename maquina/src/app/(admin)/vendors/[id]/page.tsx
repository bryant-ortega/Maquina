import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { EditVendorForm } from './edit-form'
import { W9DownloadButton } from './w9-download'
import { W9UploadButton } from './w9-upload'
import { ContractRoleToggle } from './contract-role-toggle'

/**
 * Admin vendor profile. Editable form for every field on the vendors
 * row, plus a W-9 download button (when one is on file).
 *
 * Unlike the DJ profile page, there's no booking-history section here —
 * vendors aren't linked to events by a foreign key anywhere yet (budget
 * sponsor/vendor income is a flat dollar figure per event, not tied to
 * a specific vendors row). If that linkage gets added later, mirror the
 * event_dj_slots join pattern from djs/[id]/page.tsx.
 *
 * Auth gate: handled by the (admin) layout (admin role required).
 */
export default async function AdminVendorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: vendor, error } = await supabase
    .from('vendors')
    .select(
      'id, user_id, company_name, contact_name, email, phone, region, pay_method, pay_handle, w9_status, w9_storage_path, registered_at'
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !vendor) notFound()

  // Contract role is stored on the vendor's linked profiles row, not
  // on vendors itself — see setVendorContractRole in actions.ts.
  const { data: linkedProfile } = await supabase
    .from('profiles')
    .select('roles')
    .eq('user_id', vendor.user_id)
    .maybeSingle()
  const hasContractRole = linkedProfile?.roles?.includes('contract') ?? false

  return (
    <div className="flex-1 px-8 py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <Link
            href="/vendors"
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← All vendors
          </Link>
        </div>

        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {vendor.company_name}
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {vendor.contact_name} · {vendor.region}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Registered{' '}
              {new Date(vendor.registered_at as string).toLocaleDateString(
                undefined,
                { year: 'numeric', month: 'short', day: 'numeric' }
              )}
            </p>
          </div>

          {vendor.w9_status === 'on_file' && vendor.w9_storage_path ? (
            <div className="flex flex-col items-end gap-2">
              <W9DownloadButton
                storagePath={vendor.w9_storage_path}
                fileName="Download W-9"
              />
              <W9UploadButton vendorId={vendor.id} variant="replace" />
            </div>
          ) : (
            <div className="flex flex-col items-end gap-2">
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                ⚠ W-9 pending
              </span>
              <W9UploadButton vendorId={vendor.id} variant="upload" />
            </div>
          )}
        </header>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-5 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Edit profile
          </h2>
          <EditVendorForm
            vendorId={vendor.id}
            initial={{
              company_name: vendor.company_name,
              contact_name: vendor.contact_name,
              email: vendor.email,
              phone: vendor.phone ?? '',
              region: vendor.region as
                | 'SoCal'
                | 'NorCal'
                | 'Chicago'
                | 'Arizona'
                | 'Seattle'
                | 'Other'
                | 'New York'
                | 'Portland'
                | 'Texas'
                | 'Central Cal'
                | 'Las Vegas',
              pay_method: (vendor.pay_method ?? '') as
                | ''
                | 'zelle'
                | 'venmo'
                | 'paypal',
              pay_handle: vendor.pay_handle ?? '',
              w9_status: vendor.w9_status as 'pending' | 'on_file',
            }}
          />
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-5 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Roles
          </h2>
          <ContractRoleToggle
            vendorId={vendor.id}
            initialEnabled={hasContractRole}
          />
        </section>
      </div>
    </div>
  )
}
