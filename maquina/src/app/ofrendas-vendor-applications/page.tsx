import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { BulkEmailButton } from './bulk-email-button'
import { GenerateInviteLink } from './generate-invite'
import {
  ApprovedCheckbox,
  PaidCheckbox,
  LogoReceivedCheckbox,
} from './status-toggles'

/**
 * Admin view of Ofrendas vendor-call submissions.
 *
 * Mirrors the DJs roster page (src/app/(admin)/djs/page.tsx) in shape —
 * count header, an attention banner, filter chips, sortable-by-nothing
 * table with a row link into detail — but reads from the isolated
 * `ofrendas_vendor_applications` table instead of `djs`.
 *
 * That table has RLS enabled with zero policies for anon/authenticated
 * (see migrations 0032/0033), so it can't be read through the normal
 * cookie-bound client even by a signed-in admin. We use the
 * service-role key here instead, same pattern as the admin actions.ts
 * files elsewhere in this app (e.g. djs/[id]/actions.ts). This file has
 * no 'use server' / mutations — it's a read-only Server Component, and
 * Server Components never ship to the client bundle, so the key stays
 * server-side.
 *
 * Route deliberately does NOT reuse /ofrendas-vendors — that path is
 * already the public application form (src/app/ofrendas-vendors/).
 *
 * Sorted newest-first (created_at desc) since this is a submission
 * queue, not an alphabetical roster.
 *
 * Auth: this route's own layout.tsx already enforces role 'admin' or
 * 'ofrendas_partner', so this page doesn't repeat that check.
 */

const BEST_FIT_OPTIONS = [
  'Handmade, independent-designer, thrifted, or vintage goth fashion',
  'Occult, oddities, tarot & altar goods',
  'Dark art, illustration & home decor',
  'Latino-culture-inspired & Latino-goth creations',
  'Pet-related goth goods',
  'Food, treats & beverages',
  'Other',
] as const
type BestFit = (typeof BEST_FIT_OPTIONS)[number]

const BEST_FIT_LABELS: Record<BestFit, string> = {
  'Handmade, independent-designer, thrifted, or vintage goth fashion':
    'Fashion',
  'Occult, oddities, tarot & altar goods': 'Occult / Oddities',
  'Dark art, illustration & home decor': 'Art / Decor',
  'Latino-culture-inspired & Latino-goth creations': 'Latino-Goth',
  'Pet-related goth goods': 'Pet Goods',
  'Food, treats & beverages': 'Food / Bev',
  Other: 'Other',
}

const NEEDS_PERMIT_FOLLOWUP =
  "Not yet, but I'll complete my TFF application at least 30 days before the event."

function isBestFit(value: string | undefined | null): value is BestFit {
  return !!value && (BEST_FIT_OPTIONS as readonly string[]).includes(value)
}

const STATUS_VALUES = ['approved', 'paid'] as const
type Status = (typeof STATUS_VALUES)[number]

function isStatus(value: string | undefined | null): value is Status {
  return !!value && (STATUS_VALUES as readonly string[]).includes(value)
}

/** Builds a page-relative href carrying whichever filters are active. */
function filterHref(params: {
  category?: string | null
  status?: string | null
}): string {
  const sp = new URLSearchParams()
  if (params.category) sp.set('category', params.category)
  if (params.status) sp.set('status', params.status)
  const qs = sp.toString()
  return qs
    ? `/ofrendas-vendor-applications?${qs}`
    : '/ofrendas-vendor-applications'
}

type ApplicationRow = {
  id: string
  business_name: string
  vendor_names: string
  email: string
  phone: string
  best_fit: string
  best_fit_other: string | null
  offerings: string[]
  space_needed: string
  food_permit_status: string
  approved: boolean
  approved_email_sent_at: string | null
  paid: boolean
  paid_email_sent_at: string | null
  waitlist_email_sent_at: string | null
  logo_received: boolean
  logo_reminder_email_sent_at: string | null
  created_at: string
}

export default async function OfrendasVendorApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; status?: string }>
}) {
  const params = await searchParams
  const activeCategory: BestFit | null = isBestFit(params.category)
    ? params.category
    : null
  const activeStatus: Status | null = isStatus(params.status)
    ? params.status
    : null

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: applications, error } = await admin
    .from('ofrendas_vendor_applications')
    .select(
      'id, business_name, vendor_names, email, phone, best_fit, best_fit_other, offerings, space_needed, food_permit_status, approved, approved_email_sent_at, paid, paid_email_sent_at, waitlist_email_sent_at, logo_received, logo_reminder_email_sent_at, created_at'
    )
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl font-semibold tracking-tight">
            Ofrendas Vendor Applications
          </h1>
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            Failed to load applications: {error.message}
          </p>
        </div>
      </div>
    )
  }

  const rows = (applications ?? []) as ApplicationRow[]
  const visible = rows
    .filter((r) => !activeCategory || r.best_fit === activeCategory)
    .filter((r) => {
      if (activeStatus === 'approved') return r.approved
      if (activeStatus === 'paid') return r.paid
      return true
    })
  const permitFollowupCount = rows.filter(
    (r) => r.food_permit_status === NEEDS_PERMIT_FOLLOWUP
  ).length

  const approvedCount = rows.filter((r) => r.approved).length
  const paidCount = rows.filter((r) => r.paid).length
  const approvedPendingEmail = rows.filter(
    (r) => r.approved && !r.approved_email_sent_at
  ).length
  const paidPendingEmail = rows.filter(
    (r) => r.paid && !r.paid_email_sent_at
  ).length
  const waitlistPendingEmail = rows.filter(
    (r) => !r.approved && !r.waitlist_email_sent_at
  ).length
  const logoReminderPendingEmail = rows.filter(
    (r) => r.paid && !r.logo_received && !r.logo_reminder_email_sent_at
  ).length

  // Category counts come from the unfiltered set so chip labels are stable.
  const categoryCounts = BEST_FIT_OPTIONS.reduce<Record<BestFit, number>>(
    (acc, c) => {
      acc[c] = rows.filter((r) => r.best_fit === c).length
      return acc
    },
    {
      'Handmade, independent-designer, thrifted, or vintage goth fashion': 0,
      'Occult, oddities, tarot & altar goods': 0,
      'Dark art, illustration & home decor': 0,
      'Latino-culture-inspired & Latino-goth creations': 0,
      'Pet-related goth goods': 0,
      'Food, treats & beverages': 0,
      Other: 0,
    }
  )

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Ofrendas Vendor Applications
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {rows.length}{' '}
              {rows.length === 1 ? 'application' : 'applications'} submitted
              {(activeCategory || activeStatus) && (
                <>
                  {' · '}
                  showing {visible.length}
                  {activeStatus && ` ${activeStatus}`}
                  {activeCategory && ` in ${BEST_FIT_LABELS[activeCategory]}`}
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <GenerateInviteLink />
            <BulkEmailButton kind="approved" pendingCount={approvedPendingEmail} />
            <BulkEmailButton kind="paid" pendingCount={paidPendingEmail} />
            <BulkEmailButton kind="logo_reminder" pendingCount={logoReminderPendingEmail} />
            <BulkEmailButton kind="waitlist" pendingCount={waitlistPendingEmail} />
          </div>
        </header>

        {permitFollowupCount > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <strong className="font-semibold">
              {permitFollowupCount}{' '}
              {permitFollowupCount === 1
                ? 'food/bev vendor hasn’t'
                : 'food/bev vendors haven’t'}
            </strong>{' '}
            filed a TFF application yet — follow up before the event.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Status:</span>
          <FilterChip
            href={filterHref({ category: activeCategory, status: null })}
            active={!activeStatus}
          >
            All ({rows.length})
          </FilterChip>
          <FilterChip
            href={filterHref({ category: activeCategory, status: 'approved' })}
            active={activeStatus === 'approved'}
          >
            Approved ({approvedCount})
          </FilterChip>
          <FilterChip
            href={filterHref({ category: activeCategory, status: 'paid' })}
            active={activeStatus === 'paid'}
          >
            Paid ({paidCount})
          </FilterChip>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Category:</span>
          <FilterChip
            href={filterHref({ category: null, status: activeStatus })}
            active={!activeCategory}
          >
            All ({rows.length})
          </FilterChip>
          {BEST_FIT_OPTIONS.map((c) => (
            <FilterChip
              key={c}
              href={filterHref({ category: c, status: activeStatus })}
              active={activeCategory === c}
            >
              {BEST_FIT_LABELS[c]} ({categoryCounts[c]})
            </FilterChip>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">Business</th>
                <th className="px-4 py-2.5 font-medium">Contact</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Space</th>
                <th className="px-4 py-2.5 font-medium">Submitted</th>
                <th className="px-4 py-2.5 font-medium">Approved</th>
                <th className="px-4 py-2.5 font-medium">Paid</th>
                <th className="px-4 py-2.5 font-medium">Logo</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-zinc-500 dark:text-zinc-400"
                  >
                    {activeStatus || activeCategory
                      ? 'No applications match this filter yet.'
                      : 'No applications submitted yet.'}
                  </td>
                </tr>
              ) : (
                visible.map((app) => (
                  <tr
                    key={app.id}
                    className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/ofrendas-vendor-applications/${app.id}`}
                        className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                      >
                        {app.business_name}
                      </Link>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {app.vendor_names}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      <p>{app.email}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {app.phone}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {isBestFit(app.best_fit)
                        ? BEST_FIT_LABELS[app.best_fit]
                        : app.best_fit}
                      {app.best_fit === 'Other' && app.best_fit_other && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {app.best_fit_other}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {app.space_needed}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {new Date(app.created_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <ApprovedCheckbox
                        id={app.id}
                        initialApproved={app.approved}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <PaidCheckbox id={app.id} initialPaid={app.paid} />
                    </td>
                    <td className="px-4 py-3">
                      <LogoReceivedCheckbox
                        id={app.id}
                        initialLogoReceived={app.logo_received}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/ofrendas-vendor-applications/${app.id}`}
                        className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900'
      }
    >
      {children}
    </Link>
  )
}
