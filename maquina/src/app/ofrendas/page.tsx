import type { Metadata } from 'next'
import { OfrendasHeader } from '@/components/ofrendas/header'
import { OfrendasNav } from '@/components/ofrendas/nav'

/**
 * Public Ofrendas splash page — the landing spot for the whole public
 * Ofrendas surface (this page, /ofrendas/faq, /ofrendas/vendors, and
 * the existing application page at /ofrendas-vendors reused as-is for
 * "About / Submit"). No nav entry anywhere in the app; Chase sends
 * this URL directly.
 *
 * The hero image below is a placeholder — Chase is providing the real
 * image; swap the placeholder <div> for an <Image> once it's in
 * public/ofrendas/.
 *
 * Root layout already sets robots: noindex/nofollow site-wide, so this
 * won't get crawled or indexed either.
 */
export const metadata: Metadata = {
  title: 'Ofrendas: A Community Market — LosGothsCo',
}

export default function OfrendasSplashPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-950 px-3 py-8 sm:px-6 sm:py-16">
      <div className="w-full max-w-3xl space-y-8">
        <OfrendasHeader />
        <OfrendasNav />

        {/* Hero image placeholder — replace with the real <Image> once
            Chase provides it. */}
        <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 text-sm text-zinc-600">
          Hero image coming soon
        </div>

        <div className="space-y-2 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-100">
            Ofrendas: A Community Market
          </h1>
          <p className="text-base text-zinc-500">
            The Regent Theater, LA &middot; Sunday, September 20, 2026
          </p>
        </div>
      </div>
    </div>
  )
}
