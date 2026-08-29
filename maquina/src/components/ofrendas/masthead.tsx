'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Combined header + nav for the public Ofrendas surface — the splash
 * page (/ofrendas), its FAQ and Vendors List sub-pages, and the
 * existing vendor application page (/ofrendas-vendors, reused as-is
 * for "Submit" rather than duplicated). Replaces the earlier separate
 * OfrendasHeader/OfrendasNav split: the skull image needs to
 * span the full height of the wordmark-row + nav-row column next to
 * it (top of wordmark to bottom of the nav links), which only a
 * shared flex row with `items-stretch` can do — it can't be sized
 * independently of that text the way it could as its own component.
 *
 * Client component so it can highlight the active nav link via
 * usePathname.
 */

const LINKS = [
  { href: '/ofrendas/faq', label: 'FAQ' },
  { href: '/ofrendas/vendors', label: 'Vendors List' },
  { href: '/ofrendas-vendors', label: 'Submit' },
] as const

export function OfrendasMasthead() {
  const pathname = usePathname()

  return (
    <div className="border-b border-zinc-800 pb-6">
      <div className="flex items-stretch justify-center gap-4">
        <div className="relative w-20 shrink-0 overflow-hidden rounded-lg sm:w-24">
          <Image
            src="/ofrendas/aztec-sun-skull.jpeg"
            alt=""
            fill
            sizes="96px"
            className="object-cover"
          />
        </div>

        <div className="flex flex-col justify-between gap-3">
          <Link href="/ofrendas" className="flex items-center gap-2">
            <Image
              src="/ofrendas/losgothsco-wordmark.png"
              alt="LosGothsCo"
              width={107}
              height={24}
              priority
              className="h-6 w-auto object-contain"
            />
            <span className="text-xs font-semibold uppercase tracking-widest leading-none text-zinc-500">
              Presents
            </span>
          </Link>

          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold uppercase tracking-widest">
            {LINKS.map((link) => {
              const active = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    active
                      ? 'text-zinc-100 underline underline-offset-4'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </div>
  )
}
