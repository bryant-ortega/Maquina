import type { Metadata } from 'next'
import { ApplicationForm } from './application-form'
import { isOfrendasApplicationClosed } from './deadline'
import { OfrendasVendorCallShell, ClosedNotice } from './vendor-call-shell'

// Forces this page to render fresh on every request instead of being
// statically cached at build time. Needed so the closed/open state
// below actually flips automatically at the deadline — without this,
// Next would bake in whichever state was true the last time this page
// was built and it wouldn't change until the next deploy.
export const dynamic = 'force-dynamic'

/**
 * Public, unlinked vendor-call form for Ofrendas: A Market Event.
 * No nav entry anywhere in the app — Chase sends this URL directly to
 * prospective vendors. No auth required, and nothing here touches the
 * real vendor roster (see actions.ts for details).
 *
 * Shell (header, intro copy, Event Snapshot / rules / Investment
 * sections) lives in vendor-call-shell.tsx, shared with the private
 * invite route at invite/[code]/page.tsx so the two pages can't drift
 * out of sync — this file only decides what goes in the badge and the
 * form slot based on the public deadline.
 *
 * Root layout already sets robots: noindex/nofollow site-wide, so this
 * page won't get crawled or indexed either.
 */
export const metadata: Metadata = {
  title:
    'Ofrendas Vendor Application — The Regent Theater, LA — Sep 20, 2026',
}

export default function OfrendasVendorApplicationPage() {
  const applicationsClosed = isOfrendasApplicationClosed()

  return (
    <OfrendasVendorCallShell
      badge={
        applicationsClosed && (
          <p className="inline-block rounded-full border border-zinc-700 bg-zinc-900 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-zinc-400">
            ¡Gracias! Vendor applications closed
          </p>
        )
      }
      formSlot={applicationsClosed ? <ClosedNotice /> : <ApplicationForm />}
    />
  )
}
