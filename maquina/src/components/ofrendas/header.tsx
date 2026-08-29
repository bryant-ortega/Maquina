import Image from 'next/image'
import Link from 'next/link'

/**
 * Compact brand header for the lightweight Ofrendas pages (splash, FAQ,
 * Vendors List). The full promotional header — skull photo, event
 * details, house rules, etc — lives on the application page
 * (src/app/ofrendas-vendors/vendor-call-shell.tsx) and isn't repeated
 * here; these pages only need the logo and a way back to the splash
 * page.
 */
export function OfrendasHeader() {
  return (
    <Link
      href="/ofrendas"
      className="flex items-center justify-center gap-2"
    >
      <Image
        src="/ofrendas/losgothsco-wordmark.png"
        alt="LosGothsCo"
        width={107}
        height={24}
        priority
        className="h-6 w-auto object-contain"
      />
      <span className="text-base font-semibold uppercase tracking-widest leading-none text-zinc-500">
        Presents
      </span>
    </Link>
  )
}
