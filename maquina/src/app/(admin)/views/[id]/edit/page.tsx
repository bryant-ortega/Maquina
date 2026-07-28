import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { EditViewForm } from './edit-form'

/**
 * /views/[id]/edit — Phase 17d.
 *
 * Loads the view + its current view_fields rows. System views are
 * immutable here — we redirect them back to the index. Custom views
 * render the editor client component, which manages its own state
 * and posts to the saveView server action.
 */
export default async function EditViewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: view } = await supabase
    .from('views')
    .select('id, name, description, audience, is_system, slug')
    .eq('id', id)
    .maybeSingle()

  if (!view) notFound()
  if (view.is_system) redirect('/views')

  const { data: rawFields } = await supabase
    .from('view_fields')
    .select('field_key, label, position, visible')
    .eq('view_id', id)
    .order('position', { ascending: true })

  const fields = (rawFields ?? []).map((f) => ({
    field_key: f.field_key as string,
    label: f.label as string,
    position: f.position as number,
    visible: f.visible as boolean,
  }))

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs">
            <Link
              href="/views"
              className="text-zinc-500 hover:underline dark:text-zinc-400"
            >
              ← Back to views
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Edit view
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Choose which fields appear, rename labels, and set the
            order. Visibility / labels / order — never values.
          </p>
        </header>

        <EditViewForm
          view={{
            id: view.id as string,
            name: view.name as string,
            description: (view.description as string | null) ?? '',
            audience: view.audience as
              | 'internal'
              | 'contract'
              | 'venue'
              | 'dj'
              | 'partner'
              | 'other',
          }}
          initialFields={fields}
        />
      </div>
    </div>
  )
}
