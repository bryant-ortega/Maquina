'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { FIELDS, FIELD_BY_KEY, defaultFieldSeed } from '@/lib/view-fields'

/**
 * Server actions for the View Builder (Phase 17d).
 *
 * Three actions:
 *   - createView({ name, description, audience }) — inserts a row in
 *     `views` and seeds `view_fields` with the catalog's defaultOn
 *     fields. Redirects to the editor for the new view.
 *
 *   - saveView({ id, name, description, audience, fields[] }) —
 *     diffs the submitted field list against what's in the DB. Adds
 *     new rows, updates existing ones, deletes any view_field rows
 *     whose field_key isn't in the submitted list. System views
 *     (is_system=true) are immutable; the action returns 'forbidden'.
 *
 *   - deleteView(id) — deletes a custom view. System views are
 *     immutable. ON DELETE CASCADE on view_fields and
 *     event_view_customizations cleans up dependent rows.
 *
 *   - duplicateView(id) — creates a new custom view (is_system=false,
 *     slug=null) cloned from any existing view, including system
 *     ones. Field rows copy verbatim. Redirects to the new editor.
 *
 * Auth: every action re-checks the admin role server-side. RLS would
 * block non-admin writes anyway, but checking here gives us a clean
 * structured response instead of a generic Postgres error.
 */

// ---------------------------------------------------------------------------
// Shared input shapes
// ---------------------------------------------------------------------------

const AUDIENCES = [
  'internal',
  'contract',
  'venue',
  'dj',
  'partner',
  'other',
] as const

const Audience = z.enum(AUDIENCES)

const CreateViewInput = z.object({
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(500).trim().optional().nullable(),
  audience: Audience,
})

const FieldRowInput = z.object({
  field_key: z.string().min(1),
  label: z.string().min(1).max(80).trim(),
  position: z.number().int().min(0),
  visible: z.boolean(),
})

const SaveViewInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(500).trim().optional().nullable(),
  audience: Audience,
  fields: z.array(FieldRowInput).max(FIELDS.length),
})

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'unauth' | 'forbidden' | 'invalid' | 'not_found' | 'db'; message?: string }

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function requireAdmin() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, reason: 'unauth' as const }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, roles')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.roles?.includes('admin')) {
    return { ok: false as const, reason: 'forbidden' as const }
  }
  return { ok: true as const, supabase, profileId: profile.id as string }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createView(input: unknown): Promise<ActionResult> {
  const parsed = CreateViewInput.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', message: parsed.error.message }
  }

  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const { data: view, error: insErr } = await auth.supabase
    .from('views')
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      audience: parsed.data.audience,
      is_system: false,
      slug: null,
      created_by: auth.profileId,
    })
    .select('id')
    .single()
  if (insErr || !view) {
    return { ok: false, reason: 'db', message: insErr?.message }
  }

  // Seed view_fields with the catalog defaults.
  const seed = defaultFieldSeed().map((f) => ({ ...f, view_id: view.id }))
  if (seed.length > 0) {
    const { error: seedErr } = await auth.supabase.from('view_fields').insert(seed)
    if (seedErr) {
      // Best-effort cleanup so we don't leave an orphaned view row.
      await auth.supabase.from('views').delete().eq('id', view.id)
      return { ok: false, reason: 'db', message: seedErr.message }
    }
  }

  revalidatePath('/views')
  return { ok: true, id: view.id }
}

// ---------------------------------------------------------------------------
// Save (edit)
// ---------------------------------------------------------------------------

export async function saveView(input: unknown): Promise<ActionResult> {
  const parsed = SaveViewInput.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', message: parsed.error.message }
  }

  // Reject any field_key that isn't in the catalog — defends against
  // a tampered client posting arbitrary keys.
  for (const f of parsed.data.fields) {
    if (!FIELD_BY_KEY.has(f.field_key)) {
      return {
        ok: false,
        reason: 'invalid',
        message: `Unknown field_key: ${f.field_key}`,
      }
    }
  }

  const auth = await requireAdmin()
  if (!auth.ok) return auth

  // Confirm view exists and isn't a system row.
  const { data: view } = await auth.supabase
    .from('views')
    .select('id, is_system')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!view) return { ok: false, reason: 'not_found' }
  if (view.is_system) return { ok: false, reason: 'forbidden' }

  // Update view metadata.
  const { error: metaErr } = await auth.supabase
    .from('views')
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      audience: parsed.data.audience,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
  if (metaErr) return { ok: false, reason: 'db', message: metaErr.message }

  // Diff field rows. Easiest correct path: nuke + reinsert. The table
  // is small (≤44 rows per view) and view_fields cascades from
  // view_id only — no cross-references — so this is safe.
  const { error: delErr } = await auth.supabase
    .from('view_fields')
    .delete()
    .eq('view_id', parsed.data.id)
  if (delErr) return { ok: false, reason: 'db', message: delErr.message }

  if (parsed.data.fields.length > 0) {
    const rows = parsed.data.fields.map((f) => ({
      view_id: parsed.data.id,
      field_key: f.field_key,
      label: f.label,
      position: f.position,
      visible: f.visible,
    }))
    const { error: insErr } = await auth.supabase.from('view_fields').insert(rows)
    if (insErr) return { ok: false, reason: 'db', message: insErr.message }
  }

  revalidatePath('/views')
  revalidatePath(`/views/${parsed.data.id}`)
  revalidatePath(`/views/${parsed.data.id}/edit`)
  return { ok: true, id: parsed.data.id }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteView(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, reason: 'invalid' }
  }

  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const { data: view } = await auth.supabase
    .from('views')
    .select('id, is_system')
    .eq('id', id)
    .maybeSingle()
  if (!view) return { ok: false, reason: 'not_found' }
  if (view.is_system) return { ok: false, reason: 'forbidden' }

  const { error } = await auth.supabase.from('views').delete().eq('id', id)
  if (error) return { ok: false, reason: 'db', message: error.message }

  revalidatePath('/views')
  redirect('/views')
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

export async function duplicateView(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, reason: 'invalid' }
  }

  const auth = await requireAdmin()
  if (!auth.ok) return auth

  const { data: source } = await auth.supabase
    .from('views')
    .select('id, name, description, audience')
    .eq('id', id)
    .maybeSingle()
  if (!source) return { ok: false, reason: 'not_found' }

  const { data: copy, error: insErr } = await auth.supabase
    .from('views')
    .insert({
      name: `${source.name} (copy)`,
      description: source.description,
      audience: source.audience,
      is_system: false,
      slug: null,
      created_by: auth.profileId,
    })
    .select('id')
    .single()
  if (insErr || !copy) {
    return { ok: false, reason: 'db', message: insErr?.message }
  }

  const { data: srcFields } = await auth.supabase
    .from('view_fields')
    .select('field_key, label, position, visible')
    .eq('view_id', id)
    .order('position', { ascending: true })

  const fieldRows = (srcFields ?? []).map((f) => ({
    view_id: copy.id,
    field_key: f.field_key,
    label: f.label,
    position: f.position,
    visible: f.visible,
  }))

  if (fieldRows.length > 0) {
    const { error: fieldErr } = await auth.supabase
      .from('view_fields')
      .insert(fieldRows)
    if (fieldErr) {
      await auth.supabase.from('views').delete().eq('id', copy.id)
      return { ok: false, reason: 'db', message: fieldErr.message }
    }
  }

  revalidatePath('/views')
  redirect(`/views/${copy.id}/edit`)
}

/**
 * Form-action wrapper for duplicateView. Lets <form action={...}>
 * call it directly without TypeScript balking at the return type
 * (form actions must resolve to void). Reads the view id from a
 * hidden input.
 */
export async function duplicateViewForm(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  await duplicateView(id)
}
