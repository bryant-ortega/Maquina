import type { Metadata } from 'next'
import { ApplicationForm } from './application-form'

/**
 * Public, unlinked vendor-call form for Ofrendas: A Market Event.
 * No nav entry anywhere in the app — Chase sends this URL directly to
 * prospective vendors. No auth required, and nothing here touches the
 * real vendor roster (see actions.ts for details).
 *
 * Root layout already sets robots: noindex/nofollow site-wide, so this
 * page won't get crawled or indexed either.
 */
export const metadata: Metadata = {
  title: 'Ofrendas Vendor Application — LosGothsCo',
}

export default function OfrendasVendorApplicationPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl space-y-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-8 shadow-sm">
        <div className="space-y-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            LosGothsCo presents
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Ofrendas: A Market Event
          </h1>
          <p className="text-sm leading-relaxed text-zinc-400">
            Ofrendas is an immersive market experience by LosGothsCo, born
            from LA&apos;s Latino goth community. We curate vendors whose
            offerings deepen the atmosphere and help us honor community and
            culture — unique gothic, alternative, and Latino-culture-inspired
            products and services, honoring darkness as a form of beauty and
            belonging. We also welcome local food &amp; beverage vendors.
          </p>
        </div>
        <ApplicationForm />
      </div>
    </div>
  )
}
