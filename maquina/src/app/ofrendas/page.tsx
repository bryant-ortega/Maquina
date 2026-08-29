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
 * Hero image is the same aztec-sun-skull photo already used (small,
 * circular) on the application page — Chase pointed at that page's
 * image rather than supplying a new one.
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

        <div className="relative mx-auto aspect-square w-full max-w-xl overflow-hidden rounded-lg">
          <Image
            src="/ofrendas/aztec-sun-skull.jpeg"
            alt="Aztec sun-skull carving"
            fill
            sizes="(min-width: 640px) 576px, 100vw"
            priority
            className="object-cover"
          />
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
