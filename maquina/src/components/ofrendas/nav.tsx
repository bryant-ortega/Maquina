'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Shared nav for the public Ofrendas surface — the splash page
 * (/ofrendas), its FAQ and Vendors List sub-pages, and the existing
 * vendor application page (/ofrendas-vendors, reused as-is for
 * "About / Submit" per Chase's request rather than duplicated).
 *
 * Client component so it can highlight the active link via usePathname
 * — everything else here is static, but this is the one place that
 * needs it.
 */

const LINKS = [
  { href: '/ofrendas/faq', label: 'FAQ' },
  { href: '/ofrendas/vendors', label: 'Vendors List' },
  { href: '/ofrendas-vendors', label: 'About / Submit' },
] as const

export function OfrendasNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 border-b border-zinc-800 pb-6 text-xs font-semibold uppercase tracking-widest">
      <Image
        src="/ofrendas/aztec-sun-skull.jpeg"
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
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
  )
}
