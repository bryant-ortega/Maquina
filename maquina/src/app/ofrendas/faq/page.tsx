import type { Metadata } from 'next'
import { OfrendasHeader } from '@/components/ofrendas/header'
import { OfrendasNav } from '@/components/ofrendas/nav'

/**
 * Ofrendas FAQ page. Content is a placeholder — Chase is providing the
 * real FAQ copy; swap the placeholder paragraph below for it once
 * received.
 */
export const metadata: Metadata = {
  title: 'FAQ — Ofrendas',
}

export default function OfrendasFaqPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-950 px-3 py-8 sm:px-6 sm:py-16">
      <div className="w-full max-w-2xl space-y-8">
        <OfrendasHeader />
        <OfrendasNav />

        <h1 className="text-center text-3xl font-semibold tracking-tight text-zinc-100">
          FAQ
        </h1>

        <p className="text-center text-sm text-zinc-500">
          FAQ content coming soon — check back shortly.
        </p>
      </div>
    </div>
  )
}
