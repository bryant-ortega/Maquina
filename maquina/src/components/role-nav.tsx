/**
 * RoleNav — shows links to every view the current user has access to.
 *
 * Pass in the user's `roles` array (and their primary `role`) from the
 * profiles table. The component maps each role to its home route and
 * renders a small pill-style nav, hiding the link for the current page.
 *
 * Usage:
 *   <RoleNav roles={roles} primaryRole={role} currentPath="/vendor/profile" />
 */

import Link from 'next/link'

const ROLE_ROUTES: Record<string, { label: string; href: string }> = {
  admin: { label: 'Admin', href: '/events' },
  viewer: { label: 'Year View', href: '/viewer/year' },
  contract: { label: 'Contractor', href: '/contract/view' },
  finance: { label: 'Finance', href: '/finance/events' },
  collab: { label: 'Collab', href: '/collab/events' },
  vendor: { label: 'Vendor Profile', href: '/vendor/profile' },
  dj: { label: 'DJ Profile', href: '/dj/profile' },
  partner: { label: 'Partner', href: '/events' },
}

interface RoleNavProps {
  roles: string[]
  primaryRole: string | null | undefined
  currentPath: string
}

export function RoleNav({ roles, primaryRole, currentPath }: RoleNavProps) {
  // Combine primary role + roles array, dedupe
  const allRoles = Array.from(new Set([...(primaryRole ? [primaryRole] : []), ...roles]))

  // Only show the nav if the user has more than one unique routable destination
  const links = allRoles
    .map((r) => ROLE_ROUTES[r])
    .filter((entry): entry is { label: string; href: string } => !!entry)
    .filter((entry) => entry.href !== currentPath)
    // dedupe by href
    .filter((entry, i, arr) => arr.findIndex((e) => e.href === entry.href) === i)

  if (links.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-400 dark:text-zinc-500">Switch to:</span>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {link.label}
        </Link>
      ))}
    </div>
  )
}
