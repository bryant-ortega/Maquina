'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  FIELDS,
  FIELD_BY_KEY,
  FIELD_CATEGORIES,
  type FieldCategoryKey,
} from '@/lib/view-fields'
import { saveView, deleteView } from '../../actions'

/**
 * Edit-view client component (Phase 17d + 17e drag-to-reorder).
 *
 * State is local: every interaction (toggle, rename, drag, add,
 * remove) mutates the in-memory `selected` list. The Save button
 * posts the whole list to the saveView server action.
 *
 * Drag is wired with @dnd-kit/core + sortable. Each row has a grip
 * handle on the left; drag from there to reorder. The KeyboardSensor
 * gives full keyboard accessibility — Tab to the handle, Space to pick
 * up, Arrow keys to move, Space to drop.
 */
export function EditViewForm({
  view,
  initialFields,
}: {
  view: {
    id: string
    name: string
    description: string
    audience:
      | 'internal'
      | 'contract'
      | 'venue'
      | 'dj'
      | 'partner'
      | 'other'
  }
  initialFields: SelectedField[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [deleting, startDelete] = useTransition()
  const [deleteArmed, setDeleteArmed] = useState(false)

  const [name, setName] = useState(view.name)
  const [description, setDescription] = useState(view.description)
  const [audience, setAudience] = useState(view.audience)
  const [selected, setSelected] = useState<SelectedField[]>(
    [...initialFields].sort((a, b) => a.position - b.position)
  )
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const selectedKeys = useMemo(
    () => new Set(selected.map((f) => f.field_key)),
    [selected]
  )

  // Available = catalog fields not currently in `selected`, grouped
  // by category. Keeps catalog order within each group.
  const available = useMemo(() => {
    const groups = new Map<
      FieldCategoryKey,
      { key: string; label: string }[]
    >()
    for (const c of FIELD_CATEGORIES) groups.set(c.key, [])
    for (const f of FIELDS) {
      if (selectedKeys.has(f.key)) continue
      groups.get(f.category)!.push({ key: f.key, label: f.label })
    }
    return groups
  }, [selectedKeys])

  // Drag sensors: pointer needs a small movement threshold so click
  // events on the inner inputs/buttons aren't intercepted as drag
  // starts. Keyboard sensor uses dnd-kit's standard coordinates.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setSelected((cur) => {
      const oldIdx = cur.findIndex((f) => f.field_key === active.id)
      const newIdx = cur.findIndex((f) => f.field_key === over.id)
      if (oldIdx === -1 || newIdx === -1) return cur
      return arrayMove(cur, oldIdx, newIdx)
    })
  }

  function addField(key: string) {
    const def = FIELD_BY_KEY.get(key)
    if (!def) return
    setSelected((cur) => [
      ...cur,
      {
        field_key: key,
        label: def.label,
        position: cur.length,
        visible: true,
      },
    ])
  }

  function removeField(key: string) {
    setSelected((cur) => cur.filter((f) => f.field_key !== key))
  }

  function updateField(key: string, patch: Partial<SelectedField>) {
    setSelected((cur) =>
      cur.map((f) => (f.field_key === key ? { ...f, ...patch } : f))
    )
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const payload = {
      id: view.id,
      name: name.trim(),
      description: description.trim() || null,
      audience,
      // Renumber positions 0..N-1 — the user's reorder operations
      // produce gaps otherwise.
      fields: selected.map((f, i) => ({
        field_key: f.field_key,
        label:
          f.label.trim() ||
          FIELD_BY_KEY.get(f.field_key)?.label ||
          f.field_key,
        position: i,
        visible: f.visible,
      })),
    }

    startTransition(async () => {
      const result = await saveView(payload)
      if (result.ok) {
        setSavedAt(new Date())
        router.refresh()
      } else {
        setError(messageFor(result))
      }
    })
  }

  // Mobile fix (2026-07-26): window.confirm() is silently suppressed
  // inside iOS home-screen (PWA) contexts and most in-app browsers, so
  // `if (!confirm(...)) return` used to no-op the tap on mobile with no
  // dialog ever shown. Two-tap inline confirm (armed state) works the
  // same everywhere. See view-toolbar.tsx / email-button.tsx for the
  // same fix applied elsewhere.
  function onDelete() {
    setDeleteArmed(false)
    startDelete(async () => {
      const result = await deleteView(view.id)
      // deleteView calls redirect() on success — control should never
      // return here in the success path. If it does, it's an error.
      if (!result?.ok) {
        setError(messageFor(result))
      }
    })
  }

  return (
    <form onSubmit={onSave} className="space-y-6">
      {/* Metadata block */}
      <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <Field label="Name" htmlFor="view-name">
          <input
            id="view-name"
            type="text"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            disabled={pending || deleting}
          />
        </Field>

        <Field
          label="Description"
          htmlFor="view-desc"
          hint="Optional. What's this view for?"
        >
          <input
            id="view-desc"
            type="text"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
            disabled={pending || deleting}
          />
        </Field>

        <Field label="Audience" htmlFor="view-aud">
          <select
            id="view-aud"
            value={audience}
            onChange={(e) =>
              setAudience(e.target.value as typeof audience)
            }
            className={inputClass}
            disabled={pending || deleting}
          >
            <option value="internal">Internal</option>
            <option value="contract">Contract</option>
            <option value="venue">Venue</option>
            <option value="dj">DJ</option>
            <option value="partner">Partner</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </section>

      {/* Selected fields */}
      <section className="space-y-3">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
            Selected fields
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {selected.length} field{selected.length === 1 ? '' : 's'}{' '}
            · drag the grip to reorder
          </p>
        </header>

        {selected.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            No fields yet. Add some from the list below.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={selected.map((f) => f.field_key)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                {selected.map((f) => (
                  <SortableRow
                    key={f.field_key}
                    field={f}
                    onUpdate={updateField}
                    onRemove={removeField}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {/* Available fields, grouped by category */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          Add fields
        </h2>
        <div className="space-y-3">
          {FIELD_CATEGORIES.map((c) => {
            const items = available.get(c.key) ?? []
            if (items.length === 0) return null
            return (
              <div
                key={c.key}
                className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              >
                <header className="border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  {c.label}
                </header>
                <ul className="flex flex-wrap gap-2 p-3">
                  {items.map((f) => (
                    <li key={f.key}>
                      <button
                        type="button"
                        onClick={() => addField(f.key)}
                        className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                      >
                        + {f.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          {Array.from(available.values()).every((g) => g.length === 0) ? (
            <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
              All catalog fields are already in this view.
            </div>
          ) : null}
        </div>
      </section>

      {/* Footer: status + save / delete */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {error ? (
            <span className="font-medium text-rose-700 dark:text-rose-300">
              {error}
            </span>
          ) : savedAt ? (
            <span>Saved {savedAt.toLocaleTimeString()}.</span>
          ) : (
            <span>
              Unsaved changes won&apos;t persist until you hit Save.
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {deleteArmed ? (
            <>
              <span className="text-xs text-rose-700 dark:text-rose-300">
                Delete &quot;{name}&quot;? Per-event customizations go too.
              </span>
              <button
                type="button"
                onClick={onDelete}
                disabled={pending || deleting}
                className="rounded-md border border-rose-200 bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-700 dark:hover:bg-rose-600"
              >
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteArmed(false)}
                disabled={pending || deleting}
                className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteArmed(true)}
              disabled={pending || deleting}
              className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:bg-zinc-950 dark:text-rose-300 dark:hover:bg-rose-950/40"
            >
              Delete view
            </button>
          )}
          <button
            type="submit"
            disabled={pending || deleting || !name.trim()}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// SortableRow — one row in the selected fields list, wired to dnd-kit.
// ---------------------------------------------------------------------------

function SortableRow({
  field,
  onUpdate,
  onRemove,
}: {
  field: SelectedField
  onUpdate: (key: string, patch: Partial<SelectedField>) => void
  onRemove: (key: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.field_key })

  const def = FIELD_BY_KEY.get(field.field_key)

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // While dragging, lift the row visually so it's clearly "picked up".
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-100 bg-white px-3 py-2.5 last:border-b-0 dark:border-zinc-900 dark:bg-zinc-950"
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="grid h-7 w-7 cursor-grab place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 active:cursor-grabbing dark:text-zinc-500 dark:hover:bg-zinc-900"
      >
        <GripIcon />
      </button>

      <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={field.visible}
          onChange={(e) =>
            onUpdate(field.field_key, { visible: e.target.checked })
          }
          className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-900"
        />
        Show
      </label>

      <div className="min-w-0">
        <input
          type="text"
          value={field.label}
          onChange={(e) =>
            onUpdate(field.field_key, { label: e.target.value })
          }
          maxLength={80}
          placeholder={def?.label ?? field.field_key}
          className={`${inputClass} text-sm`}
        />
        <p className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          {def?.category} · {def?.kind} · {field.field_key}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onRemove(field.field_key)}
        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-rose-400 dark:hover:bg-rose-950/40"
      >
        Remove
      </button>
    </li>
  )
}

function GripIcon() {
  // 6-dot grip — small, monochrome, no extra dep.
  return (
    <svg
      viewBox="0 0 12 16"
      width="12"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="3" cy="3" r="1.25" />
      <circle cx="9" cy="3" r="1.25" />
      <circle cx="3" cy="8" r="1.25" />
      <circle cx="9" cy="8" r="1.25" />
      <circle cx="3" cy="13" r="1.25" />
      <circle cx="9" cy="13" r="1.25" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SelectedField = {
  field_key: string
  label: string
  position: number
  visible: boolean
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  )
}

const inputClass =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'

function messageFor(
  result?:
    | { ok: false; reason: string; message?: string }
    | { ok: true; id: string }
): string {
  if (!result) return 'Action failed.'
  if (result.ok) return 'OK'
  switch (result.reason) {
    case 'unauth':
      return 'You must be signed in.'
    case 'forbidden':
      return 'Only admins can edit views (system views are read-only).'
    case 'invalid':
      return result.message ?? 'Invalid input.'
    case 'not_found':
      return 'View not found.'
    case 'db':
      return result.message ?? 'Database error. Try again.'
    default:
      return 'Something went wrong.'
  }
}
