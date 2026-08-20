import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import {
  ApprovedCheckbox,
  PaidCheckbox,
  LogoReceivedCheckbox,
} from '../status-toggles'

/**
 * Admin detail view of a single Ofrendas vendor application.
 *
 * Mostly read-only — unlike the DJs/[id] detail page, there's no full
 * edit form. Applications aren't a managed roster; they're leads Chase
 * reads and follows up on by email/phone. All 15 spec questions are
 * laid out in the same section grouping as the public form
 * (src/app/ofrendas-vendors/application-form.tsx) and the DB comments
 * in supabase/migrations/0033_ofrendas_vendor_applications_full_spec.sql.
 * The one interactive bit is the Approved/Paid status toggles — same
 * component as the list page, so either surface stays in sync.
 *
 * Same service-role read as the list page — RLS on this table has no
 * anon/authenticated policies.
 *
 * Auth: this route's own layout.tsx already enforces role 'admin' or
 * 'ofrendas_partner'.
 */

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Application = {
  id: string
  business_name: string
  vendor_names: string
  email: string
  phone: string
  instagram_handle: string
  website_url: string | null
  offerings: string[]
  offerings_other: string | null
  best_fit: string
  best_fit_other: string | null
  business_description: string
  space_needed: string
  food_permit_status: string
  food_permit_other: string | null
  menu_description: string | null
  agreement_accepted: boolean
  content_use_consent: string
  booth_decor_plan: string | null
  approved: boolean
  approved_at: string | null
  approved_email_sent_at: string | null
  paid: boolean
  paid_at: string | null
  paid_email_sent_at: string | null
  logo_received: boolean
  created_at: string
}

export default async function OfrendasVendorApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID_LIKE.test(id)) notFound()

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: app, error } = await admin
    .from('ofrendas_vendor_applications')
    .select(
      'id, business_name, vendor_names, email, phone, instagram_handle, website_url, offerings, offerings_other, best_fit, best_fit_other, business_description, space_needed, food_permit_status, food_permit_other, menu_description, agreement_accepted, content_use_consent, booth_decor_plan, approved, approved_at, approved_email_sent_at, paid, paid_at, paid_email_sent_at, logo_received, created_at'
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !app) notFound()

  const application = app as Application

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <Link
            href="/ofrendas-vendor-applications"
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← All applications
          </Link>
        </div>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {application.business_name}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {application.vendor_names}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Submitted{' '}
            {new Date(application.created_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </header>

        <section className="flex flex-wrap items-center gap-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <ApprovedCheckbox
              id={application.id}
              initialApproved={application.approved}
            />
            Approved
            {application.approved_email_sent_at && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                — emailed{' '}
                {new Date(
                  application.approved_email_sent_at
                ).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <PaidCheckbox id={application.id} initialPaid={application.paid} />
            Paid
            {application.paid_email_sent_at && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                — emailed{' '}
                {new Date(application.paid_email_sent_at).toLocaleDateString(
                  undefined,
                  { month: 'short', day: 'numeric' }
                )}
              </span>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <LogoReceivedCheckbox
              id={application.id}
              initialLogoReceived={application.logo_received}
            />
            Logo received
          </label>
        </section>

        <Section title="Vendor & business info">
          <Field label="Business name" value={application.business_name} />
          <Field label="Vendor name(s)" value={application.vendor_names} />
          <Field
            label="Email"
            value={
              <a
                href={`mailto:${application.email}`}
                className="text-zinc-900 hover:underline dark:text-zinc-100"
              >
                {application.email}
              </a>
            }
          />
          <Field
            label="Phone"
            value={
              <a
                href={`tel:${application.phone}`}
                className="text-zinc-900 hover:underline dark:text-zinc-100"
              >
                {application.phone}
              </a>
            }
          />
          <Field label="Instagram" value={application.instagram_handle} />
          {application.website_url && (
            <Field label="Website" value={application.website_url} />
          )}
        </Section>

        <Section title="What they're bringing">
          <Field
            label="Offerings"
            value={application.offerings.join(', ')}
          />
          {application.offerings_other && (
            <Field
              label="Offerings — other"
              value={application.offerings_other}
            />
          )}
          <Field label="Best fit" value={application.best_fit} />
          {application.best_fit_other && (
            <Field
              label="Best fit — other"
              value={application.best_fit_other}
            />
          )}
          <Field
            label="Business description"
            value={application.business_description}
            multiline
          />
        </Section>

        <Section title="Space needed">
          <Field label="Space" value={application.space_needed} />
        </Section>

        <Section title="Food & beverage">
          <Field
            label="Permit status"
            value={application.food_permit_status}
          />
          {application.food_permit_other && (
            <Field
              label="Permit status — other"
              value={application.food_permit_other}
            />
          )}
          {application.menu_description && (
            <Field
              label="Menu"
              value={application.menu_description}
              multiline
            />
          )}
        </Section>

        <Section title="Agreement & extras">
          <Field
            label="Vendor agreement accepted"
            value={application.agreement_accepted ? 'Yes' : 'No'}
          />
          <Field
            label="Content-use consent"
            value={application.content_use_consent}
          />
          {application.booth_decor_plan && (
            <Field
              label="Booth decor plan"
              value={application.booth_decor_plan}
            />
          )}
        </Section>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-4 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {title}
      </h2>
      <dl className="space-y-3">{children}</dl>
    </section>
  )
}

function Field({
  label,
  value,
  multiline,
}: {
  label: string
  value: React.ReactNode
  multiline?: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd
        className={
          multiline
            ? 'whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300'
            : 'text-sm text-zinc-700 dark:text-zinc-300'
        }
      >
        {value}
      </dd>
    </div>
  )
}
