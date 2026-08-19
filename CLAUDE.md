# Maquina — LosGothsCo event operations

Internal tool for running LosGothsCo events: DJ roster, vendors, event budgets,
run-of-show, contracts, and the Ofrendas vendor market.

## Repo layout — read this first

**The git root is this directory, one level ABOVE the Next.js app.**

```
LosGothsCo Enterprise/     <- git root (.git lives here)
├── maquina/               <- the Next.js app
│   ├── src/
│   ├── supabase/migrations/
│   └── package.json
├── handoff.md             <- running build log / decisions
├── BUILD_PLAN.md          <- original phased plan
└── docs/
```

Consequence: stage paths as `maquina/src/...`, not `src/...`. Running
`git add src/lib/email.ts` from the root fails with "pathspec did not match".
All npm commands run from `maquina/`.

## Stack

Next.js 16.3 (App Router) · React 19.2 · TypeScript · Tailwind 4 ·
Supabase (Postgres + Auth + Storage) · Resend (email) · Vercel (hosting) ·
@react-pdf/renderer · zod 4 · react-hook-form

**Next.js 16 and React 19 are newer than most training data.** `maquina/AGENTS.md`
says it plainly: read `maquina/node_modules/next/dist/docs/` before writing code
that touches framework APIs. Do not assume Next 13/14 conventions.

## Commands

Run from `maquina/`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build — **this is the typecheck** |
| `npm run lint` | ESLint |

There is no test suite. Before committing non-trivial changes, run
`npm run build` — it's the only thing that catches type errors.

## Database

Supabase project **Maquina** (`kvlpzveyxfqwvcawmhov`, us-west-1).

**Migrations are applied by hand, not by CLI.** Files live in
`maquina/supabase/migrations/` numbered `NNNN_description.sql`. The workflow is:
write the file, paste it into the Supabase SQL Editor, run it. Every migration
that changes schema ends with:

```sql
NOTIFY pgrst, 'reload schema';
```

Never assume a migration in the repo has been applied — check the live schema.
`handoff.md` tracks which ones have landed.

### Access control

`profiles.roles` is a `text[]`. Roles: `admin`, `dj`, `vendor`, `collab`,
`contract`, `finance`, `viewer`, `ofrendas_partner`. (`finance` has its own route
group and migration but is not currently assigned to any user.) RLS is enabled on
every table and enforced via `has_role()` / `get_my_role()`.

`contract` was formerly named `designer` — migration 0029 renamed it. Older
comments and docs may still say "designer".

Authorization is layered deliberately, and all three layers are expected:

1. Route group layout gates the page on role
2. The server action re-checks role (never trust the layout alone for a write)
3. RLS enforces it again at the database

**The service-role client bypasses RLS.** Where it's used for storage or writes,
the invariant RLS would have enforced must be re-checked in code by hand — see
`src/app/dj/upload-w9/actions.ts` for the pattern and the reasoning in its
header comment.

### UUID validation gotcha

Seed UUIDs like `b1000000-0000-0000-0000-000000000001` are valid Postgres uuids
but fail zod 4's `.uuid()` (it enforces the version nibble). Use the shared
`UUID_LIKE` shape regex instead. FK constraints and RLS catch anything bad.

## Email

Everything routes through `src/lib/email.ts`. Do not call Resend directly from
a route or action.

- `sendEmail()` is the single choke point. It returns a discriminated result
  instead of throwing — callers decide whether a failed send matters. It is
  **dormant-safe**: with no `RESEND_API_KEY` it no-ops and reports `skipped`,
  so registration and cron paths never break in environments without a key.
- `shell()` wraps every message in the shared HTML template. Use it.
- `escapeHtml()` every user-supplied value. Business names, DJ names, and
  contact names all come from public forms.
- Senders: default `Maquina <maquina@losgoths.co>`; Ofrendas mail sends as
  `Ofrendas Team (No-Reply) <maquina@losgoths.co>` with `replyTo`
  `ofrendasmarket@gmail.com`.

`losgoths.co` is verified in Resend with SPF, DKIM, and DMARC (`p=none`).

## Storage

W-9 PDFs live in the `w9s` bucket at `{user_id}/w9.pdf` — keyed by the **auth
user id**, not the DJ or vendor row id. Uploads validate real PDF magic bytes
via `looksLikePdf()`, not the browser-reported MIME type or file extension.

## Scheduled work

`/api/cron/w9-reminders` runs weekly (Monday 09:00 UTC, configured in
`vercel.json`). It emails DJs and vendors whose `w9_status` is still `pending`,
throttled to one reminder per recipient per 7 days via the `w9_reminders` table.
It returns 503 unless `CRON_SECRET` is set, and requires
`Authorization: Bearer $CRON_SECRET`.

Note: the cron filters on `w9_status`, so a W-9 that lands without that column
flipping to `on_file` will keep generating reminders forever. If someone reports
"I uploaded it and still got emailed," check both the column and the storage
object.

## Conventions

**Commits.** Short imperative summary, sentence case, no prefix tags or emoji.
Recent examples:

```
Add waitlist email + bulk-send button for non-approved Ofrendas applicants
Add rate limiting, input validation, and security audit fixes
Update Ofrendas payment email: no-reply notice, explicit logo address; drop shared email footer
```

**Server actions** return discriminated result objects (`{ ok: true }` /
`{ ok: false, reason: '...' }`) rather than throwing. The client component maps
each `reason` to human copy — keep raw enum names out of the UI.

**Comments** in this codebase explain *why*, especially where something deviates
from the obvious approach or from `BUILD_PLAN.md`. Match that when adding code;
don't strip existing explanatory comments.

**`handoff.md`** is the running log of decisions and applied migrations. Update
it for anything structural.
