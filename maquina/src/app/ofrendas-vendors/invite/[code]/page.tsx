import type { Metadata } from 'next'
import { ApplicationForm } from '../../application-form'
import { getOfrendasInviteStatus } from '@/lib/ofrendas-invites'
import { OfrendasVendorCallShell } from '../../vendor-call-shell'

// Same reasoning as the public page: force fresh rendering on every
// request so an invite that just got redeemed (or generated) shows up
// immediately, never a stale cached copy.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ofrendas Vendor Application — Private Invite',
  robots: { index: false, follow: false },
}

/**
 * Private invite route — lets one specific late vendor submit the
 * Ofrendas application after the public deadline
 * (src/app/ofrendas-vendors/deadline.ts), via a link an admin or
 * ofrendas_partner generated from /ofrendas-vendor-applications (see
 * generate-invite.tsx). The code in the URL is the only credential;
 * there's nothing to type in.
 *
 * This page only *checks* the code (read-only, via
 * getOfrendasInviteStatus) so reloading or bookmarking it doesn't
 * consume it — the code is actually claimed inside
 * submitOfrendasVendorApplication at the moment of a successful
 * submit (../../actions.ts), atomically, so it can't be redeemed
 * twice.
 *
 * Deliberately vague on failure ("this link isn't valid") rather than
 * distinguishing used/expired/not-found to a visitor — no reason to
 * help someone probing for valid-looking codes.
 */
export default async function OfrendasVendorInvitePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const status = await getOfrendasInviteStatus(code)
  const valid = status === 'valid'

  return (
    <OfrendasVendorCallShell
      badge={
        <p className="inline-block rounded-full border border-zinc-700 bg-zinc-900 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-zinc-400">
          {valid ? 'Private invite' : 'Invite link not valid'}
        </p>
      }
      formSlot={
        valid ? (
          <ApplicationForm inviteCode={code} />
        ) : (
          <InvalidInviteNotice />
        )
      }
    />
  )
}

function InvalidInviteNotice() {
  return (
    <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        This link isn&apos;t valid
      </p>
      <p className="text-base leading-relaxed text-zinc-400">
        It may have already been used or has expired. Reach out to{' '}
        <a
          href="mailto:ofrendasmarket@gmail.com"
          className="text-zinc-300 underline underline-offset-2 hover:text-zinc-100"
        >
          ofrendasmarket@gmail.com
        </a>{' '}
        if you think this is a mistake.
      </p>
    </div>
  )
}
