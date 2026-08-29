import type { Metadata } from 'next'
import Image from 'next/image'
import { OfrendasHeader } from '@/components/ofrendas/header'
import { OfrendasNav } from '@/components/ofrendas/nav'

/**
 * Public Ofrendas splash page — the landing spot for the whole public
 * Ofrendas surface (this page, /ofrendas/faq, /ofrendas/vendors, and
 * the existing application page at /ofrendas-vendors reused as-is for
 * "About / Submit"). No nav entry anywhere in the app; Chase sends
 * this URL directly.
 *
 * Hero image is the event flyer (public/ofrendas/Ofrendas_Flyer.JPG) —
 * it already carries the date/venue/address, so there's no separate
 * title/subtitle text under it; that would just repeat what the flyer
 * already says.
 *
 * Root layout already sets robots: noindex/nofollow site-wide, so this
 * won't get crawled or indexed either.
 */
export const metadata: Metadata = {
  title: 'Ofrendas: A Community Market — LosGothsCo',
}

export default function OfrendasSplashPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-black px-3 py-8 sm:px-6 sm:py-16">
      <div className="w-full max-w-3xl space-y-8">
        <OfrendasHeader />
        <OfrendasNav />

        <div className="relative mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-lg">
          <Image
            src="/ofrendas/Ofrendas_Flyer.JPG"
            alt="Ofrendas: A Community Market — Sunday, September 20, 2026, The Regent Theater, 448 S Main St, Los Angeles, CA 90013, 12pm to 6pm, all ages, free entrance"
            fill
            sizes="(min-width: 640px) 448px, 100vw"
            priority
            className="object-cover"
          />
        </div>
      </div>
    </div>
  )
}
