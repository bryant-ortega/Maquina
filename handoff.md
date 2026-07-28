# Handoff — LosGothsCo Enterprise / Maquina

Hand this file to a fresh Claude conversation so it can pick up where this
one left off without re-discovering the codebase.

## Who & what

- **User**: Chase Ortega — `chase@monarca.systems`, also `kalicorose@gmail.com`.
  On macOS.
- **Company**: LosGothsCo — event/DJ operations.
- **App**: **Maquina** — internal Next.js + Supabase tool that's slowly
  replacing the user's Google Sheets-based workflow (Vendors sheet →
  Master Event Model → Events Budget 2026, glued together with Apps Script).
  Long-term goals: DJ/vendor self-registration, W-9 collection,
  multi-view event management, automated email comms with PDF attachments.
- **Live repo**: <https://github.com/bryant-ortega/Maquina.git>
  Repo root is `~/Documents/Claude/Projects/LosGothsCo Enterprise/`; the
  Next.js app sits inside it at `maquina/`. The `.git` is at the repo root,
  not inside `maquina/` — every `git` command runs from the repo root.

## Stack

- Next.js (App Router, TypeScript, Tailwind v4) inside `maquina/`.
- Supabase: Postgres + Auth + Storage (`w9s` bucket, private). RLS is on
  for every table; admin actions bypass via service-role client.
- DB migrations in `maquina/supabase/migrations/` (currently `0001`
  through `0031`, `0014` deleted — see prior entries below for
  0001–0019). **0029, 0030, 0031 are written but NOT YET applied to
  the live DB** as of this handoff — apply in that order via the
  Supabase SQL Editor, deploying matching code alongside each one (see
  "What's done" #1 below for the full rundown). Recent additions:
  - `0029_rename_designer_to_contract.sql` — renames the `'designer'`
    role to `'contract'` (profiles.roles values, views.audience +
    CHECK constraint, every RLS policy, the RPC). `0030_finance_
    role.sql` — new read-only `finance` role (budgets, DJs, vendors).
    `0031_event_vendors.sql` — new `event_vendors` junction table
    (admin CRUD, finance/contract read-only). See "What's done" #1.
  - `0026_fix_handle_new_user_roles_bug.sql` / `0027_catchup_roles_
    array_and_has_role.sql` / `0028_designer_dj_names_rpc.sql` — see
    "What's done" #2–4 below. 0026 is a real bug fix (broken signup
    role assignment); 0027 is pure migration-history catch-up, a no-op
    against the current live DB; 0028 tightens the designer RLS gap
    (revokes row-level `djs` access, adds a narrow RPC instead).
  - `0020_phase_17i_designer_role.sql` — adds `'designer'` role +
    read-only RLS on `events`, `event_dj_slots`, `djs`, and
    `views`/`view_fields` scoped to `audience='designer'`. **No**
    designer RLS on budget tables — that's the actual security
    boundary, not the UI.
  - `0021_phase_20_w9_reminders.sql` — `w9_reminders` table (one row
    per `dj_id` **or** `vendor_id`, XOR-constrained, partial unique
    indexes), admin-only RLS. Cron uses the service-role client so it
    doesn't need a policy.
  - `0022_run_of_show_load_in_overrides.sql` — nullable
    `events.losgoths_load_in_time` / `events.dj_load_in_time` (both
    `time`) to override the auto-computed load-in rows on the Run of
    Show. NULL = old computed-default behavior.
  - `0023_ticket_tax_deduction.sql` — `event_budgets.tix_tax numeric`
    (flat $ deducted from gross ticket revenue before LosGothsCo's
    split % is applied).
  - `0024_partner_profit_split.sql` — `event_budgets.{chase,elvis}
    _payment_status` (unpaid/paid) + `_payment_method` (freeform),
    same inline-editable shape as expense rows, only rendered on Final.
  - `0025_partner_share_pct.sql` — `event_budgets.chase_share_pct` /
    `elvis_share_pct numeric` (0–1, default 0.4/0.6), editable per
    Final budget — supersedes the fixed 40/60 constants 0024 shipped
    with.
  - **Known gap:** `profiles.roles` (a `text[]` column, now the
    authoritative source for role-based routing — see item below) was
    added to the live DB but **no migration file documents it**. If
    you ever need to stand up a fresh DB from the migrations folder,
    you'll be missing this column. Worth writing a migration for it
    before that becomes a real problem.
  Schema highlights:
  - `profiles` — one row per auth user. **Correction from an earlier
    version of this doc:** `role` (singular) is **not** still around
    as a legacy fallback — verified directly against the live DB on
    2026-07-27 (see "What's done" #3 below), it was fully **dropped**.
    Only `roles text[]` (default `'{}'`) exists. RLS was updated to
    match: `get_my_role()` (read `profiles.role`) was replaced by
    `has_role(check_role text)` (`check_role = ANY(roles)`), and every
    admin/collab/designer/viewer policy across every table now calls
    `has_role(...)`. None of this — the column drop, the `roles`
    column, the new function, or the ~36 redefined policies — exists
    in any migration file; migrations 0026/0027 (added 2026-07-27)
    catch the history up. A user can hold multiple roles at once (e.g.
    `['viewer','collab']`); landing page on login is decided by an
    if-chain priority order (admin > viewer > designer > collab >
    vendor > dj fallback), and `src/components/role-nav.tsx` renders a
    "Switch to:" pill nav on every role-gated layout so a multi-role
    user can jump between their other surfaces without re-logging in.
  - `djs` — DJ-specific columns, FK to `auth.users.id` via `user_id`
    (ON DELETE CASCADE). Has `w9_status` (`pending` | `on_file`) and
    `w9_storage_path` (relative path inside the `w9s` bucket).
  - `events`, `event_stages`, `event_dj_slots`, `event_budgets`, `venues`.
    `events` also has `losgoths_load_in_time` / `dj_load_in_time`
    (0022, see above).
  - `event_budget_expenses` — per-line items on a budget. Includes
    `payment_status varchar` CHECK IN (`unpaid`,`paid`) (binary, set
    by 0013/0015) and `payment_method varchar` (freeform text after
    0011 dropped the original CHECK). Both editable inline on the
    Final budget only.
  - `event_budgets` — also now has `tix_tax` (0023) and the
    Chase/Elvis payout columns (0024/0025, see above).
  - `w9_reminders` — new (0021), tracks reminder throttling for the
    weekly cron. See "What's done" #11 below for the throttle/stop logic.
  - Trigger `handle_new_user` auto-creates a `profiles` row when an auth
    user is inserted. As of migration 0026, it reads `user_metadata.roles`
    (array, what the app actually sends) first, falls back to legacy
    `user_metadata.role` (singular), then falls back to `['dj']`. Before
    0026 it only ever read the singular key — see "What's done" #2.
- Hosting auto-deploys from `main` (likely Vercel).

## Key paths to know

```
maquina/
  src/app/
    layout.tsx                      # root html/body, dark-mode-aware bg
    globals.css                     # Tailwind + a few global tweaks
    login/page.tsx                  # /login (image + form)
    register/dj/                    # public DJ self-registration
      page.tsx
      registration-form.tsx
      actions.ts                    # has orphan-account reclaim path
    dj/upload-w9/                   # DJ uploads their own W-9
    (admin)/                        # admin route group, gated in layout
      layout.tsx                    # sidebar / mobile drawer / brand
      _mobile-nav.tsx
      djs/[id]/                     # admin DJ detail page
        page.tsx
        edit-form.tsx               # form for djs row fields
        actions.ts                  # updateDj + uploadDjW9
        w9-download.tsx
        w9-upload.tsx               # admin uploads W-9 on DJ's behalf
      events/page.tsx               # event list (sorted asc by date)
      events/[id]/edit/             # event edit form
      events/[id]/budget/           # budget page (estimated/final/compare)
        page.tsx                    # routes by ?view=, passes isFinal
        budget-form.tsx             # editable form, paid+method inline
        budget-compare.tsx          # read-only side-by-side
        actions.ts                  # updateBudget + actualizeEvent
        view-toolbar.tsx
    api/storage/signed-url/route.ts # POST { storagePath } -> { signedUrl }
    (admin)/views/[id]/page.tsx         # Phase 17f custom-view renderer
    register/vendor/                     # public vendor self-registration
      page.tsx
      registration-form.tsx
      actions.ts
    vendor/                              # post-registration vendor surface
      upload-w9/
      profile/
    viewer/                              # Phase 17g viewer-role chrome
      layout.tsx                         # minimal shell, no admin nav
      year/page.tsx                      # only page a viewer can see
    designer/                            # Phase 17i designer-role chrome
      layout.tsx                         # minimal shell, gates on 'designer'/'admin'
      view/page.tsx                      # only page a designer can see; renders
                                          # the most-recently-updated
                                          # audience='designer' custom view,
                                          # every financial field hardcoded null
    api/cron/w9-reminders/route.ts       # Vercel cron, Mondays 9am UTC, CRON_SECRET-gated
  vercel.json                            # cron schedule config
  src/components/role-nav.tsx            # "Switch to:" pill nav for multi-role users
  src/lib/email.ts                       # Resend wrapper; no-ops without RESEND_API_KEY
  src/lib/run-of-show.ts                 # buildSchedule() + load-in override resolution
  src/lib/budget.ts                      # computeBudget() — tix tax, sponsor/vendor income
  public/brand/
    losgoths-skull-triangle-transparent.png   # main logo (no-spaces copy)
    goth-makima.webp                          # login screen image
    maquina-cropped-face.webp                 # sidebar character image
    inverted-losgoths-logo.png
    losgoths-wordmark-nowhite.png
    gothicumbia-logo.png
  supabase/migrations/*.sql         # source of truth for schema + RLS
```

## What's done (newest first)

> Everything below was shipped across several sessions, not just "this
> conversation" — the file has been handed off and re-picked-up multiple
> times. Item 1 is the newest addition (calendar invites on event
> confirm). Item 2 is a real, long-standing 404 bug fix on emailed
> DJ/vendor W-9 links. Item 3 is the contract/finance-role +
> vendor-event-assignment batch (migrations 0029/0030/0031, all
> applied + deployed). Items 4-7 are from the live session on
> 2026-07-27 (vendor admin UI, a live-DB audit that turned up a real
> signup bug, and a designer RLS tightening). Items 8-16 are new since
> the last handoff refresh before that (commit `34d851c`) and were
> reconstructed from `git log`/`git show`, not witnessed directly.
> Items 17+ (DJ-fraction column down through the MΛQUIИΛ wordmark) are
> from the session before that.

1. **Calendar invite emailed to Chase + Elvis when an event is marked
   confirmed.** New `src/lib/calendar-invite.ts`, built on the `ics`
   npm package (new dependency). When an event's `status` flips to
   `'confirmed'` — checked in both `createEvent` (create-straight-into-
   confirmed) and `updateEvent` (the normal path: `existing.status !==
   'confirmed' && data.status === 'confirmed'`, so it fires once per
   transition, not on every subsequent edit of an already-confirmed
   event) — Chase and Elvis get one email with a single `.ics`
   attachment bundling: the show itself (timed, doors_time → end_time,
   same wrap-past-midnight convention as `run-of-show.ts`) plus one
   all-day entry per production milestone that's actually set (begin
   art, art due, announce, on sale). Recipients come from
   `CALENDAR_INVITE_RECIPIENTS` (comma-separated env var), defaulting
   to `kalicorose@gmail.com,elvis@losgoths.co` if unset.
   Chose email-delivered `.ics` over direct CalDAV push to iCloud —
   discussed with Chase — because it reuses the already-working Resend
   pipeline with zero new credentials, versus CalDAV needing an Apple
   ID app-specific password from both Chase and Elvis stored as a
   standing server secret for a feature that fires roughly weekly.
   Trade-off: one tap to "Add All" from the Mail attachment, not
   fully automatic — an email with an `.ics` attachment shows a rich
   preview card in Mail on open, but does **not** silently write into
   Calendar.app without that tap.
   **Real bug caught during build, worth flagging if this code is ever
   touched again:** the `ics` package's default `start`/`end` handling
   silently converts through whatever OS timezone the Node process
   happens to run in. Verified empirically in this sandbox
   (`America/Los_Angeles`) — passing `[2026,10,31,21,0]` came back as
   `20261101T040000Z`, i.e. it treated the array as Pacific local time
   and converted to UTC. Vercel's default runtime is UTC, so the exact
   same input would have shipped every confirmed-event calendar
   invite 7-8 hours off with no error, no test failure, nothing — it
   would only have shown up when Chase actually opened one on his
   phone. Fixed by explicitly setting
   `startInputType/startOutputType/endInputType/endOutputType:
   'local'` on the show VEVENT, which writes the doors/end numbers as
   a floating local time (no `Z`, no `TZID`) — correct here because
   `doors_time`/`end_time` are already venue-local wall-clock strings
   and the schema has no per-venue IANA timezone data to convert with
   anyway. The four milestone all-day entries were never at risk —
   `VALUE=DATE` fields have no timezone component in iCal.
   `existing` in `updateEvent`'s pre-fetch now also selects `status`
   (previously only `id, event_id, date, city, state`) so the
   transition can be detected.

2. **Fixed a real, long-standing bug: emailed DJ/vendor W-9 links
   404'd for anyone not already logged in.** `src/middleware.ts`
   404'd unauthenticated visits to `/dj/*` and `/vendor/*` — same
   "invisible to scanners" treatment as the genuinely admin-only
   routes. But `/dj` and `/vendor` are public self-registration flows:
   the registration-confirmation and weekly W-9-reminder emails
   (`src/lib/email.ts`) link straight into `/dj/upload-w9` and
   `/vendor/upload-w9`, and every page under those two prefixes
   already has its own `redirect('/login')` for signed-out visitors
   (verified: `dj/profile`, `dj/upload-w9`, `vendor/profile`,
   `vendor/upload-w9` all do this correctly). The middleware's blanket
   404 fired first and pre-empted that page-level redirect, so anyone
   clicking the link cold from their inbox got a dead page instead of
   a login prompt. Fix: dropped `/dj` and `/vendor` from the
   404-on-unauth block; left `/collab`, `/viewer`, `/contract` alone
   (those are admin-invited, not self-registered, so hiding them from
   signed-out visitors is still the right call). Caught by Chase
   testing a real registration email end-to-end — this bug predates
   this session and likely affected every DJ/vendor W-9 reminder ever
   sent once `RESEND_API_KEY` was configured. Minor known gap left
   open: `/login` doesn't carry a `redirectTo`/`next` param yet, so a
   user bounced through `/login` lands on their role's default page
   (e.g. `/vendor/profile`), not back on the exact page they clicked
   into (e.g. `/vendor/upload-w9`) — fine for now, worth revisiting if
   it becomes a friction point.
   Also renamed the stray `views` row still titled "Designer" (data,
   not code — the 0029 migration only renames the role/RLS, not
   admin-authored view names) to "Contract" via direct SQL against the
   live DB; it's the view shown at the top of `/contract/view`.

3. **Contract role (renamed from designer), Finance role, and vendor
   event assignments (migrations 0029/0030/0031 — written this
   session, NOT YET applied to the live DB as of this handoff).**
   Chase's product decisions: combine designer + videographer into one
   **Contract** role, grantable to an existing vendor account (not a
   standalone self-registration) so a contracted vendor can view
   upcoming events; add a **Finance** role — read-only, no edit
   rights, scoped to budgets + DJ roster + vendor roster + W-9
   downloads; let admins attach specific vendors to an event (plain
   checklist, no rate/time/slot fields like DJ slots get) and auto-add
   their emails to the Run of Show recipient list.
   - **0029** renames `'designer'` → `'contract'` everywhere: the
     `profiles.roles` values, `views.audience` (+ its CHECK
     constraint), every RLS policy (`events_select_designer` →
     `..._contract`, same for `event_dj_slots`, `views`,
     `view_fields`), and the RPC (`designer_dj_names` →
     `contract_dj_names`, same SECURITY DEFINER shape from 0028).
     `src/app/designer/` was moved to `src/app/contract/`
     (`ContractLayout`, `ContractViewPage`) with every doc comment,
     UI copy, and role check updated to match. Old `src/app/designer/`
     and `src/app/designer/view/` are now empty stub directories (git
     doesn't track empty dirs; harmless, but Chase can delete them in
     Finder if he wants a clean tree).
   - Added a **Contract access** toggle to
     `/(admin)/vendors/[id]` (new `setVendorContractRole` action +
     `contract-role-toggle.tsx`) — flips `'contract'` in/out of the
     linked `profiles.roles` array for that vendor's `user_id`. This
     is the only way into the contract role; there's no
     self-registration path for it.
   - **0030** adds the **finance** role: read-only RLS (`SELECT` only,
     additive — can't weaken existing admin-only write policies) on
     `events`, `event_budgets`, `event_budget_expenses`,
     `event_budget_income`, `event_tix_tiers`, `djs`, `vendors`. New
     `/finance` route group with its own small nav (Events / DJs /
     Vendors — unlike the single-page viewer/contract shells, finance
     needs three surfaces): `/finance/events` (read-only list),
     `/finance/events/[id]` (reuses the admin `BudgetCompare`
     component when a final budget exists — it's pure/presentational,
     no writes — else a lean read-only summary via `computeBudget()`),
     `/finance/djs` and `/finance/vendors` (read-only rosters with
     per-row W-9 download buttons). `/api/storage/signed-url` now also
     authorizes `roles.includes('finance')` alongside admin. Added a
     `finance` branch to every role-redirect chain (`src/app/page.tsx`,
     `login/actions.ts`, `(admin)/layout.tsx`, `viewer/layout.tsx`,
     `contract/layout.tsx`) and to `role-nav.tsx`'s `ROLE_ROUTES` map.
   - **Bulk W-9 ZIP download**: new `GET /api/finance/w9-zip` (admin or
     finance only) bundles every on-file DJ + vendor W-9 into one ZIP
     (`DJs/` and `Vendors/` subfolders, sanitized/deduped filenames),
     fetched via the service-role client and streamed back with
     `jszip` (newly added to `package.json`). `DownloadAllW9sButton`
     on `/finance/vendors` triggers it client-side as a blob download.
     Chase's original ask was unqualified ("download all W9s"), so
     both DJs and vendors are included, not just vendors.
   - **0031** adds `event_vendors` (plain many-to-many: `event_id`,
     `vendor_id`, unique pair) — admin full CRUD, finance and contract
     get read-only SELECT. New/Edit Event forms got a "Vendors"
     section (checkbox grid, mirrors the DJ slots section's visual
     style but with none of its rate/time/slot fields, per Chase: "i
     just need to add vendor names from dropdown so that maquina knows
     who to send ROS to"). `createEvent` inserts the selected
     `vendor_ids`; `updateEvent` replaces the set wholesale on every
     save (delete-all-then-reinsert — simpler than a three-way diff
     for a table with no per-row fields to preserve). `sendRunOfShowEmail`
     (`runofshow/actions.ts`) now also fetches `event_vendors` joined
     to `vendors(email, company_name)` and adds each vendor's email to
     the recipient list as `Vendor: {company_name}`, same dedup/label
     pattern as the existing DJ and advance-contact recipients.
   - **Apply order matters**: 0029 → 0030 → 0031 (0031's RLS
     references `has_role('contract')` and `has_role('finance')`,
     both defined by the earlier two). Deploy the code alongside each
     migration the way 0028 was handled — don't let `has_role('contract')`
     checks go live in the DB before the `/contract` routes exist, or
     vice versa. `tsc --noEmit` and `npm run lint` are both clean as
     of this handoff (the only tsc errors are the pre-existing stale
     `.next/dev/types/validator.ts` references to the old
     `src/app/designer/*` paths — self-resolving on the next `next
     dev`/`next build`, same category as the sandboxed-build font-fetch
     caveat below).

4. **Designer RLS tightening (migration 0028).** Closed the gap flagged
   in migration 0020's own comment and re-flagged in this doc's last
   refresh: `djs_select_designer` was a row-level policy, so a
   designer's session could query any column on `djs` — pay_method,
   phone, email, w9_status, government_name — via the REST API
   directly, even though the UI only ever shows `dj_name`. Dropped that
   policy; added `designer_dj_names(uuid[])` (SECURITY DEFINER,
   returns only `id, dj_name`, gated to `has_role('designer') OR
   has_role('admin')` inside the function body) as the replacement.
   `src/app/designer/view/page.tsx`'s lineup loader no longer embeds
   `djs(dj_name)` on its `event_dj_slots` query (that embed would now
   silently return null) — it fetches slots without the embed, collects
   the distinct `dj_id`s, and calls the RPC once to resolve names. Same
   output, narrower access. Apply 0028 after 0026 and 0027.

5. **Admin vendor index/detail pages.** New `/(admin)/vendors` (roster,
   region filter chips, pending-W9 banner — mirrors `/djs`) and
   `/(admin)/vendors/[id]` (editable profile form + admin W-9
   upload/download — mirrors `/djs/[id]`). No booking-history section:
   vendors aren't linked to events by any FK. Added `/vendors` to the
   sidebar nav and to `src/middleware.ts`'s admin-route gate (it was
   missing — signed-out visits to `/vendors` would have 200'd instead
   of 404'ing like every other admin route). Also fixed two pre-existing
   `as any` lint errors in `vendor/profile/page.tsx` and
   `viewer/layout.tsx` left over from the roles-array migration (the
   `profiles.roles` select already types the array; the cast was dead
   weight). Closes the "Admin index/detail for vendors" open item.

6. **Live-DB audit — found and fixed a real signup bug (migrations
   0026, 0027).** While investigating the "roles has no migration
   file" gap, connected the (correct) Maquina Supabase project via MCP
   and queried the live schema directly, since migration files had
   already proven unreliable as a source of truth once before. Found:
   `profiles.role` doesn't just coexist with `roles` (as an earlier
   version of this doc claimed) — it's fully **dropped**. `get_my_role()`
   doesn't exist either — it was replaced by `has_role(check_role text)`
   (`check_role = ANY(roles)`), and ~36 RLS policies across every table
   were redefined to call it. None of that is in any migration file.

   More importantly: `handle_new_user()` (the trigger that creates each
   `profiles` row on signup) was **never updated** to match — it still
   read `raw_user_meta_data->>'role'` (singular), while
   `register/dj/actions.ts` and `register/vendor/actions.ts` have written
   `user_metadata.roles` (a plural array) since commit `da4ea02`. Since
   the singular key doesn't exist in that metadata shape, the trigger's
   `COALESCE(..., 'dj')` fallback always fired — meaning **every
   self-registration since June 2, 2026 got `profiles.roles = ['dj']`,
   regardless of what they actually registered as.** DJ signups looked
   fine only by coincidence (the fallback default happens to be `'dj'`).
   No vendor has registered since then to trigger it for real, but the
   next one would've been silently bounced to `/dj/profile` right after
   registering, with no UI path back to their own `/vendor/upload-w9`.
   Confirmed via `auth.users.raw_user_meta_data` on the one existing
   vendor (registered May 29, pre-dates the bug) vs. recent DJ signups
   (Jul 10, Jul 16 — both show `{"roles":["dj"],...}` in metadata but
   only got `roles=['dj']` in `profiles` via the lucky fallback).

   `0026_fix_handle_new_user_roles_bug.sql` — redefines the trigger to
   read `roles` (array) first, fall back to legacy `role` (string), fall
   back to `'dj'`. Apply this one **soon** — it's an active bug, not
   just cleanup. `0027_catchup_roles_array_and_has_role.sql` — documents
   the already-live `roles`/`has_role()`/dropped-`role` state so a fresh
   DB stand-up wouldn't diverge from production; every statement is
   idempotent and a no-op against the current live DB. Apply 0026 before
   0027. Also checked `w9_reminders.stopped_at` while in there: it
   genuinely is written (by every W-9 upload action, admin and
   self-serve alike) but never read by anything — informational/audit
   value only, not wired into cron logic. Left as-is; not worth churn.

7. **Corrected this handoff's own claims about `profiles.role`.** An
   earlier refresh of this doc (same day, prior turn) said `role` and
   `roles` coexist on `profiles` and that `get_my_role()` was still in
   use. Both were wrong per the live-DB audit in #2 — written from
   migration-file inference without checking the actual database, which
   is exactly the kind of drift this file exists to prevent. Lesson for
   next time: since this project already has a track record of
   real-schema-diverges-from-migrations (the `roles` column itself, now
   this), treat migration files as a lower-confidence source than a
   direct query when the two might disagree and it matters (auth/RLS
   especially) — the Supabase MCP connector needs to be pointed at the
   `Maquina` project (id `kvlpzveyxfqwvcawmhov`) specifically, not
   whatever project happens to be connected; this session found it
   initially connected to an unrelated project ("bryant-ortega's
   Project" / Monarca Services org) and had to be redirected.

8. **Partner profit-split, made editable (commits `b0f5f53`, `9f324d6`).**
   Final budget gets a new "Profit split" section: Chase / Elvis shares
   of final profit, each with the same Paid/Method inline controls as
   expense rows. Split % started as fixed 40/60 constants (0024), then
   became per-budget editable inputs (0025,
   `chase_share_pct`/`elvis_share_pct`, default 0.4/0.6) — the payout
   $ amount recomputes live from whatever % is typed. `computeBudget()`
   itself doesn't touch the split; it's applied in
   `budget-form.tsx` on top of `summary.est_profit`. Also relabeled
   summary stats to "Est. X" (estimated) vs "Final X" (actualized) for
   income/expenses/profit/walkout.

9. **Mobile `confirm()` fixes + batched budget save (commit `60a937c`).**
   `window.confirm()`/`alert()` are silently suppressed in iOS
   home-screen PWAs and most in-app browsers (return `undefined`, no
   dialog shown), so taps gated behind `if (!confirm(...)) return`
   were silently no-op'ing on mobile. Fix pattern — **"inline two-tap
   confirm"**: a boolean `armed` state; first tap swaps the button for
   inline Confirm/Cancel buttons rendered in place, second tap runs the
   real action. Applied to budget actualize (`view-toolbar.tsx`),
   collaborator remove (`collaborators-section.tsx`), event delete
   (`edit-event-form.tsx`), view delete (`views/[id]/edit/edit-form.tsx`)
   — same shape as the earlier run-of-show email button fix (`f7c3919`).
   Reuse this pattern for any future destructive-action button instead
   of reaching for `confirm()`. Same commit also rewrote
   `updateBudget`'s per-row sequential writes into 3 parallel waves
   (scalar update + diff selects → deletes → batched upsert/insert) —
   same validation/writes, just concurrent; fixes slow saves on budgets
   with many line items.

10. **Run-of-show DJ slot sort fix (commit `3754833`).** A same-evening
   pre-doors `start_time` override (e.g. 9:00 PM start, 9:30 PM doors)
   was wrongly getting the same "+1440 min, treat as after-midnight"
   normalization meant for genuinely-after-midnight overrides, so it
   sorted to the very end of the schedule instead of near the top.
   Fixed in `lib/run-of-show.ts` by additionally requiring
   `customMin <= end - 1440` before applying the shift.

11. **Run of Show + budget polish (commits `1aa9887`, `ffa27ad`,
   `f7c3919`, `5d86758`, `04ad467`).** Venue name + address added to
   the Run of Show PDF (joins `venues`, omitted cleanly if no
   `venue_id`). Sponsor/vendor income broken out as their own budget
   line items (previously folded silently into `est_income`) across
   the budget form, compare view, and PDF. Run of Show email button's
   `confirm()` mobile bug fixed (see #2 — this was the first instance
   of the pattern). Ticket tax deduction added ahead of LosGothsCo's
   split — `event_budgets.tix_tax` (0023), `net_tix_total = max(0,
   gross_tix_total - tix_tax)`, split % applied to the net figure, not
   gross. Run of Show test-send now accepts multiple recipients with
   friendlier validation errors.

12. **Manual load-in time overrides (commit `2da174d`).**
   `losgoths_load_in_time` / `dj_load_in_time` (0022) let an admin
   override either auto-computed load-in row (doors−180min /
   doors−90min) per event from the edit form. NULL (default on every
   existing row) preserves the old computed behavior.

13. **Roles migrated to an array; multi-role support (commits `da4ea02`,
   `772d591`, `b8b6fec`, `5a6cbf8`).** `profiles.roles text[]` is now
   the single source of truth for auth/routing (see schema highlights
   above for the gap: this column has no migration file). New
   `src/components/role-nav.tsx` renders a "Switch to:" pill nav
   wherever a role-gated layout is shown, listing the user's other
   accessible surfaces (deduped, current page filtered out) — so e.g.
   a `['viewer','collab']` user can hop between `/viewer/year` and
   `/collab/events` without re-logging in.

14. **Phase 20 — automated emails + W-9 reminder cron (commit
   `bed5f7d`).** `src/lib/email.ts` wraps **Resend**
   (`RESEND_API_KEY` env var — if unset, `sendEmail()` no-ops with a
   logged warning instead of throwing; "dormant-safe by design," and
   confirmed **not** set in local `.env.local` today, so check the
   Vercel dashboard for the prod value). Sends DJ + vendor registration
   confirmations and W-9 reminders. `api/cron/w9-reminders/route.ts`
   runs every Monday 9am UTC (`vercel.json`), gated by a `CRON_SECRET`
   bearer token (also not in local `.env.local` — Vercel-only), queries
   `djs`/`vendors` with `w9_status='pending'` (TBD placeholder DJ
   excluded), throttles to one reminder per 7 days via
   `w9_reminders.last_sent_at`, and — because the query filters on
   `w9_status='pending'` — reminders stop implicitly once the W-9 is
   marked on file. Note: `w9_reminders.stopped_at` is selected but
   never written/read by the cron — vestigial from the original spec,
   flag for cleanup or wiring up.

15. **Status badges + past-row fade (commits `d2ba509`, `35c4136`,
   `f357ecb`, `1fc0ae5`).** Event status renders as a colored pill
   (green=confirmed, amber=tentative) on the designer view and the
   custom view renderer, matching the existing admin events page.
   Past events fade to 45% opacity across every list view (events,
   month, year, custom views, designer, collab, viewer) via a shared
   `isPastDate` helper in `lib/utils.ts`.

16. **Phase 17i — designer role (commits `c2ff693`, `32f8a82`).** New
   `'designer'` role for outside flyer designers: signs in, sees
   exactly one read-only page (`/designer/view`, most-recently-updated
   `audience='designer'` custom view), no event detail page, no admin
   chrome. Gated by RLS (migration 0020) on `events`,
   `event_dj_slots`, `djs`, `views`/`view_fields` — **budget tables
   have no designer policy at all**, so even a misconfigured view
   returns nothing for financial fields (the page also hardcodes those
   fields to `null` client-side as defense in depth). **Known RLS
   gap** (flagged in the migration's own comment): the `djs` SELECT
   policy is row-level, not column-level, so a designer's JWT could in
   theory query `pay_method`/`phone`/`email`/`w9_status` directly via
   the REST API even though the UI only ever shows `dj_name`. If that
   becomes a real concern, tighten by revoking the broad policy and
   exposing a `SECURITY DEFINER` RPC that returns only `(id, dj_name)`.
   View builder also gained a DJ-lineup field option for building
   Designer-audience views.

17. **DJ-fraction column on events / month / year.** New
   `src/components/dj-fraction.tsx` exports `fetchSlotCounts(supabase,
   eventIds)` (one round-trip join `event_dj_slots → djs(dj_name)`,
   rolls up to `Map<event_id, { filled, total }>`) and a
   `<DjFractionBadge filled total />` pill — yellow when `filled <
   total`, green when `filled === total > 0`, gray `—` when no slots.
   Column appended to the *right* of the desktop tables on `/events`,
   `/views/month`, `/views/year`; mobile cards on `/events` and
   `/views/month` get a stacked badge next to the Status pill. Year
   view has no separate mobile card path (the table just scrolls).
   `colSpan` on empty-state rows bumped from 7 to 8 in each file.

18. **TBD placeholder DJ.** Migration 0019 drops NOT NULL on
   `djs.user_id` (UNIQUE stays — Postgres NULLs are distinct under
   standard UNIQUE) and inserts one row with `dj_name='TBD'`,
   `email='tbd@maquina.local'`, region `'Other'`, `w9_status='on_file'`.
   `new-event-form.tsx` and `edit-event-form.tsx` both compute
   `const tbdDjId = djs.find((d) => d.dj_name === 'TBD')?.id ?? ''` and
   use it as the default `dj_id` for every newly-added slot. Existing
   client validation `if (slots.some((s) => !s.dj_id))` still fires,
   but it now passes because TBD is a real id. Events with all-TBD
   lineups save cleanly and the DJ-fraction column shows them as 0/N
   yellow.

19. **Five new regions.** Migration 0018 drops + re-adds the region
   CHECK constraint on both `djs` and `vendors` to include `'New York'`,
   `'Portland'`, `'Texas'`, `'Central Cal'`, `'Las Vegas'` (existing
   six unchanged). Every region zod enum + dropdown array updated in
   DJ registration, vendor registration, admin DJ edit form, admin DJ
   index. New entries appended after the existing six so existing rows
   don't get reshuffled in the admin UI.

20. **Required fields on registration.** Phone, pay method, and pay
   handle are required on both DJ and vendor registration. The
   `pay_method` dropdown defaults to Zelle on form mount (no more
   "—" placeholder option). Pay handle label reads "Pay handle
   (@name, or phone number)". Client + server zod schemas both
   enforce. DB columns remain nullable for back-compat with older
   rows; new registrations can't write nulls.

21. **Phase 17h — vendor self-registration.** New `vendors` table
   (mirrors `djs` — `company_name`, `contact_name`, `region`,
   `pay_method`, `pay_handle`, `phone`, `email`, W-9 fields). Public
   form at `/register/vendor`, post-registration flow:
   `/vendor/upload-w9` → `/vendor/profile`. Same orphan-account /
   wrong-role / wrong-password recovery branches as the DJ flow.
   Reuses the existing `w9s` storage bucket — paths are
   `{vendor_user_id}/w9.pdf`, and migration 0004's `w9_upload_own`
   policy already allows any authenticated user to write to their own
   folder. Vendors get role `'vendor'` in `profiles`; login + root +
   admin layout + middleware all route them to `/vendor/profile`
   (or `/vendor/upload-w9` if W-9 isn't on file). No admin index
   page for vendors yet — RLS gives admins full read but there's no
   UI to manage the roster yet.

22. **Phase 17g — viewer role.** Migration 0016 adds `'viewer'` to the
   profiles role CHECK and an `events_select_viewer` RLS policy so a
   viewer's SSR client can read events. New route group at
   `src/app/viewer/` with a slim layout (brand row + sign-out, no
   admin sidebar). `/viewer/year` renders the same data as
   `(admin)/views/year` but strips per-row links to `/events/[id]/edit`
   (viewers can't see that). Login + root + `(admin)` layout +
   middleware route the `viewer` role to `/viewer/year`. Creating a
   viewer: Supabase Studio → Auth → Add user (auto-confirm on), then
   Table Editor → profiles → change `role` to `'viewer'`. Note the
   admin layout used to bounce all non-admins to `/dj/profile`; it
   now role-routes correctly (viewer→/viewer/year, collab→/collab/events,
   vendor→/vendor/profile, default→/dj/profile).

23. **Phase 17f — custom view renderer.** `/views/[id]/page.tsx`
   loads the view + its visible `view_fields` in `position` order.
   Conditionally pulls `event_dj_slots` (with `djs(dj_name)`) only if
   `dj_count` or `headliner_name` is visible; conditionally pulls
   estimated budgets + expenses + tiers (then runs `computeBudget` from
   `lib/budget.ts`) only if any financial field is visible. Renders a
   table per the view's visible fields formatted by each field's
   `kind` (currency via `formatUSD`, dates as `Mar 15, 2026`, times as
   `9:00 PM`, booleans as ✓/—, etc.). The `title` column links to
   `/events/[id]/edit`. System views (`is_system=true`) render the
   same way but skip the "Edit fields" button. Per-event customization
   (Phase 17 spec) and CSV export were deliberately skipped from this
   slice — flag for future work.

24. **MΛQUIИΛ wordmark.** Replaced every visible "Maquina" header text
   with the stylized `MΛQUIИΛ` across `(admin)/layout.tsx` (desktop
   sidebar + mobile drawer), `(admin)/_mobile-nav.tsx`,
   `collab/layout.tsx`, and `viewer/layout.tsx`. Login page wordmark
   was already MΛQUIИΛ; just bumped its size from `text-xs` to
   `text-2xl` (literal 2×) per Chase's request. `alt="Maquina"`
   attributes on brand images stay plain ASCII for screen readers.

25. **PostgREST schema-cache gotcha (recurring).** Every time you paste
   a migration into the Supabase SQL Editor that creates or alters a
   table, follow it with `NOTIFY pgrst, 'reload schema';` in the same
   editor. Without that, PostgREST keeps serving "Could not find the
   table 'public.X' in the schema cache" errors for a few minutes
   until it auto-refreshes. We hit this twice in this session — once
   on `views` (Phase 17d's tables that were never actually applied),
   once on `vendors`. Add the NOTIFY line to your migration apply
   checklist.

26. **Phase 18 (slim) — inline payment tracking on Final budget.** The
   actualized (final) budget's expense table now exposes a `Paid`
   dropdown (binary `unpaid` / `paid` — no `partial`) and a freeform
   `Method` text input on each row. Estimated budget UI is unchanged.
   The `Method` field is disabled while `Paid` = unpaid, and gets
   cleared when you flip back to unpaid. Each category header in the
   Final view shows "$X paid / $Y total" so progress is scannable.
   See `src/app/(admin)/events/[id]/budget/budget-form.tsx`
   (`PaymentStatus`, `selectClass`, the Paid + Method `<td>`s),
   `actions.ts` (`payment_status`, `payment_method` in the Zod schema
   and update/insert), and `page.tsx` (selects + passes both columns).

   *Detour we backed out of:* a heavier ledger architecture
   (`expense_payments` table + separate `/events/[id]/payments` page +
   `addExpensePayment`/`deleteExpensePayment` actions + overage
   validation + `lib/expense-payments.ts` helpers) was built and then
   reverted because the inline approach matches Chase's actual
   workflow ("when I actualize a budget I am making payments and
   marking them as paid"). Migration `0015_revert_phase_18_ledger.sql`
   drops the `expense_payments` table and re-asserts the
   `unpaid`/`paid` CHECK on `event_budget_expenses.payment_status`.
   If a future task genuinely needs a multi-payment-per-line ledger
   with history, that experiment is in the git log — don't re-invent
   it from scratch.

27. **qty=0 → "remove on save" in the budget form.** Setting an
   expense row's qty to 0 (or blank) marks it for deletion: the row
   instantly fades + strikes-through with a "Will be removed on save"
   tooltip; the actual delete happens on Save. Existing rows get
   diffed-deleted server-side; new rows are filtered out before
   payload build. The Zod validator also rejects `qty <= 0` as a
   defense-in-depth — it shouldn't fire from the UI but catches
   bypasses with a clean inline error instead of the raw Postgres
   constraint message. See `budget-form.tsx` (`keptExpenses`,
   `willBeRemoved`) and `actions.ts` (`z.number().positive(...)`).

28. **Events index polish.**
   - Sort: strict ascending by date (soonest → latest). The previous
     past-vs-future bucketing is gone — status / past / future have
     no effect on order.
   - Replaced the `Event ID` column with a `Day` column showing the
     full weekday name (Saturday, Friday, etc.) derived from
     `events.date`. `event_id` is still in the DB and used elsewhere,
     just hidden from the list.
   - Removed the `Type` and `Stages` columns. SELECT trimmed too.
   - Mobile card swaps the event_id chip for the day-of-week.
   See `src/app/(admin)/events/page.tsx`.

29. **`payment_method` is now freeform text.** Migration `0011`
   dropped the original `('paypal','zelle','venmo','other')` CHECK
   constraint. Cash, check #1234, ACH, etc. all work. Column stays
   nullable — empty stored as NULL.

30. **DJ registration — orphan-account recovery (commit `5ad1096`).**
   When an auth user exists for an email but the `djs` row was deleted,
   re-submitting the registration form with the matching password now
   reclaims the account (re-inserts the `djs` row + fixes the `profiles`
   row). Wrong password → friendly amber error with reset/different-email
   options. Wrong role (e.g. existing admin user) → red error refusing to
   overwrite. See `src/app/register/dj/actions.ts` (`reclaimOrphanAccount`,
   `isEmailExistsError`) and the matching UI states in `registration-form.tsx`.

31. **Register page copy (commit `45498f5`).** Removed stale "we'll email a
   magic link" line — flow has been password-based for a while.

32. **Admin W-9 upload (commit `44b0c8b`).** New `uploadDjW9` server
   action + `<W9UploadButton>` client component, wired into the admin DJ
   detail page header. Writes to `w9s/{dj_user_id}/w9.pdf`, sets
   `w9_storage_path` + flips `w9_status` to `on_file`. Shows as "Upload W-9"
   when pending, "Replace W-9" when on file. Handles wrong type / too
   large / no linked user_id / etc.

33. **Admin nav polish (commits `248b232`, `34f7156`).** Desktop sidebar:
   skull-triangle logo + "Maquina" header, character face image above
   the nav, no "LosGothsCo Enterprise" subtext. Mobile top bar: hamburger
   + small logo + "Maquina". Mobile drawer: face image above nav (smaller
   than desktop), `overflow-y-auto` on nav so signout stays anchored.

34. **Login page.** Two-column layout on `sm+` (`goth-makima.webp` on the
   left, sign-in form on the right) and stacked on mobile. Wordmark says
   just "Maquina". Login form now reads from FormData(form) at submit time
   so autofill works without the "type a space then backspace" dance, and
   the button only disables while a submit is in-flight (native `required`
   handles empty values).

## Conventions / quirks learned

- **Image filenames with spaces.** User sometimes drops in files with
  spaces; we keep a no-spaces copy alongside the original and reference
  the clean name (`maquina-cropped-face.webp`,
  `losgoths-skull-triangle-transparent.png`). Originals usually still
  sit in `public/brand/` — they're cosmetic-only and can be deleted any
  time.
- **Image optimization.** The `goth-makima.webp` is a 900×1329 WebP at
  quality 90 (~241 KB), down from a 3.97 MB PNG. Use the same approach
  for any new large images: resize to ~2× display size, WebP, q90.
- **macOS `.DS_Store` files** show up in `public/brand/` — harmless,
  already in or could go in `.gitignore` if not.
- **Service-role client pattern.** Admin writes that touch Storage and
  multiple tables use `createClient(URL, SERVICE_ROLE_KEY, ...)` directly
  instead of the SSR client. RLS is bypassed, so the action manually
  enforces invariants (role check, user_id match) on the server.
- **Two-layer auth check on admin actions.** Every admin server action
  re-checks `profile.role === 'admin'` server-side, even though the
  `(admin)` layout already gates the route — defence in depth, also
  flagged inline in JSDoc on each action.
- **W-9 storage path is always `{dj_user_id}/w9.pdf`** in the `w9s`
  bucket. Both the DJ self-upload and the new admin upload agree on this.
- **DJ delete leaves an orphan auth user.** Now handled by the
  reclaim flow above; if it ever needs a true cleanup, the user does it
  manually in Supabase Studio → Authentication → Users (permanent
  deletions of accounts aren't something Claude is allowed to automate).
- **Migrations run manually in Supabase SQL Editor.** Chase pastes the
  SQL from each new migration file into the dashboard's SQL Editor and
  clicks Run. There's no `supabase db push` workflow in use. Always
  give him the exact SQL to paste alongside the file commit, and call
  out the order if multiple migrations need to apply in sequence.
- **Budget form quirks.** (a) qty is stored as a string in form state
  and coerced at compute/save time to dodge `<input type=number>` →
  NaN bugs. (b) qty=0 means "delete this row" — the row stays visible
  (faded + strikethrough) until save, then gets diffed-deleted. (c)
  the DB CHECK is `qty > 0` strict, so the Zod validator matches with
  `.positive()`. (d) `payment_method` is disabled while `payment_status
  = 'unpaid'` and gets cleared when flipping back to unpaid so we
  don't carry stale text.
- **Phase 18 ledger experiment was reverted.** Migrations 0012, 0013,
  0014 (backfill, deleted) were the heavier ledger approach. 0013 is
  still in the tree because it's harmless (it just tightens the
  payment_status CHECK to binary, which the slim approach also wants).
  0015 drops the `expense_payments` table and re-asserts the same
  binary CHECK. Net effect on the live DB after running everything:
  same as if only 0011 + 0015 had ever existed.
- **Mobile `confirm()`/`alert()`/`prompt()` are unreliable — don't use
  them for anything that gates an action.** iOS home-screen PWAs and
  most in-app browsers silently suppress native dialogs (return
  `undefined`, no dialog ever shown), so `if (!confirm(...)) return`
  just no-ops on mobile with zero feedback. Standard fix now used
  throughout the app: **inline two-tap confirm** — a boolean `armed`
  state, first tap swaps the trigger button for inline Confirm/Cancel
  buttons, second tap runs the real action. Reach for this pattern
  (see `run-of-show/email-button.tsx`, `budget/view-toolbar.tsx`,
  `collaborators-section.tsx`, `edit-form.tsx`) instead of `confirm()`
  for any new destructive-action button.
- **`profiles.roles` (array) is the only role column — `profiles.role`
  (scalar) doesn't exist anymore.** Confirmed against the live DB
  2026-07-27; an earlier version of this doc incorrectly said both
  coexist. Check `roles.includes('admin')`-style everywhere. RLS uses
  `has_role(check_role text)` (`check_role = ANY(roles)`), not the old
  `get_my_role()` (which also no longer exists). See schema highlights
  above and "What's done" #2 for the full story, including a real
  signup bug this drift caused (fixed in migration 0026).
- **Resend integration is dormant-safe.** `lib/email.ts`'s
  `sendEmail()` no-ops with a logged warning (doesn't throw) if
  `RESEND_API_KEY` is unset — safe to run locally without the key
  configured. Local `.env.local` does **not** have `RESEND_API_KEY` or
  `CRON_SECRET` today; both are Vercel-only env vars if they're set at
  all — verify in the Vercel dashboard before assuming Phase 20 emails
  are actually firing in prod.

## Open / likely-next items

- **BUILD_PLAN status.** Phases 0–18 (slim), 17f/g/h/i, Phase 20
  (emails + W-9 cron), the roles-array migration, and a string of
  Run of Show / budget refinements (ticket tax, sponsor/vendor income,
  load-in overrides, Chase/Elvis profit split) have all shipped.
  Nothing in BUILD_PLAN.md is flagged as the "next" phase right now —
  confirm with Chase what he wants to tackle before assuming any item
  below is next.
- **Apply migrations 0029, 0030, 0031 — NOT done yet.** Written and
  `tsc`/`lint` clean this session, but still sitting unapplied on the
  live DB (verified via direct query: `profiles.roles` still has 1 row
  with `'designer'`, no `event_vendors` table exists yet). Apply via
  the Supabase SQL Editor **in order** — 0031's RLS calls
  `has_role('contract')` and `has_role('finance')`, both defined by
  0029/0030 — and commit + deploy the matching code alongside each one
  the way 0028 was handled, so there's no window where a role check in
  the DB references a route that doesn't exist yet (or vice versa).
  Full rundown of what these three ship: contract role (renamed from
  designer, grantable to an existing vendor account), finance role
  (read-only budgets/DJs/vendors/W-9s, new `/finance` route group,
  bulk W-9 ZIP download), and vendor-event assignments (checklist on
  the event form, vendor emails auto-added to Run of Show sends). See
  "What's done" #1.
- **Commit this session's work.** Nothing from this batch (contract
  rename, finance role, `event_vendors`, vendor multi-select, ROS
  vendor emails) has been committed yet — same `.git/index.lock`
  caveat as always applies (see "Things to be careful of" below); run
  `rm -f .git/index.lock` from Chase's own Terminal first if a commit
  hangs or errors.
- ~~Apply migrations 0026, 0027, 0028~~ — **done**, 2026-07-27. All
  three ran clean; verified directly against the live DB afterward
  (`djs_select_designer` gone, `designer_dj_names()` exists with
  `authenticated` EXECUTE granted, code deployed on `main` first so
  there was no window where the designer view's lineup could break).
- **`w9_reminders.stopped_at` is write-only, not vestigial exactly.**
  Corrected from an earlier version of this doc: it genuinely gets set
  by every W-9 upload path (admin and self-serve). It's just never
  *read* — the cron's "stop reminding" effect happens implicitly via
  the `w9_status='pending'` filter instead. Fine to leave as an audit
  trail; not worth churn unless you want it to drive real cron logic.
- **Single registration form covering DJs + vendors.** Right now
  they're two parallel pages (`/register/dj`, `/register/vendor`).
  Long-standing handoff item, still open.
- **Per-event customization + CSV export on custom view renderer
  (Phase 17 spec leftovers).** Renderer at `/views/[id]/page.tsx`
  deliberately ships without these. The data model in 0010
  (`event_view_customizations`) already supports it; just need the UI.
- **Per-user view sharing.** Path A (viewer role locked to one page)
  and now designer role (locked to one page) are both built. Path B
  (per-view, per-recipient access via a `view_shares` table) is still
  just sketched — punt to a future phase, ideally bundled with Resend
  so email invites work for non-account recipients.
- **Hide TBD from DJ listings / DJ analytics?** The placeholder row
  currently shows up in `/djs`, `/views/dj-analytics`, etc. like a
  real DJ. Either filter it out per-page or add a `kind = 'system'`
  column on `djs`. Worth doing once you see it in the UI.
- **`(collab)` route group** has only had incidental touches (past-row
  fade, ticket-tax display) — no dedicated phase work on it yet.
- **Migration consolidation / cleanup.** 31 migration files in the
  tree (0001–0031, `0014` deleted). 0026/0027/0028 close the biggest
  known gaps (roles array + has_role(), designer RLS), but treat the
  migration folder as a
  lossy record of live schema state generally — verify against the
  live DB (via the Supabase MCP, pointed at project `Maquina` /
  `kvlpzveyxfqwvcawmhov`) before trusting migration files alone for
  anything auth- or RLS-related.

## Operational details

- **Push flow** (from repo root):
  ```
  git add <files>
  git commit -m "..."
  git push
  ```
- **Local dev**: from `maquina/`, `npm run dev`. Env vars in
  `.env.local` — confirmed present: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
  `RESEND_API_KEY` / `CRON_SECRET` are **not** in local `.env.local` —
  check Vercel's env vars if you need to test email/cron behavior
  against real sends.
- **Type check**: from `maquina/`, `npx tsc --noEmit`.
- **Lint**: from `maquina/`, `npm run lint` (eslint, no args).
- **Production build sanity**: `npm run build` from `maquina/` works
  when the network can reach `fonts.googleapis.com` (Geist + Geist
  Mono via `next/font/google`). Don't be alarmed if a sandboxed
  build step fails on the font fetch — Vercel can reach Google so
  the deployed build is fine.
- **Build deploys** on push to `main`. Live URL not stated by the user
  in this chat — check the hosting dashboard if needed.
- **Cron**: `vercel.json` schedules `GET /api/cron/w9-reminders` for
  every Monday 9am UTC. Vercel sends `Authorization: Bearer
  $CRON_SECRET` automatically; the route 401s without a matching
  header and 503s if `CRON_SECRET` isn't set at all.
- **Supabase MCP connector**: if you have live-DB query access in this
  session, double check `list_projects` shows project `Maquina`
  (id `kvlpzveyxfqwvcawmhov`) before trusting any result — Chase has a
  second, unrelated Supabase project/org ("bryant-ortega's Project" /
  Monarca Services) and the connector has landed on the wrong one
  before. If it's wrong, Chase needs to reconnect the connector via
  Claude's Customize → Connectors settings and pick the right Supabase
  account/org during the OAuth step — not something fixable from
  inside a chat.

## Things to be careful of

- Don't push automatically without explicit user consent. The user
  has run all the `git push` commands themselves in this session except
  one (which they explicitly authorized).
- Don't delete files / DB rows / auth users without explicit user
  consent — Claude isn't supposed to do permanent deletions even with
  permission, but cleanup actions (like removing the duplicate
  `maquina cropped face.webp` with the space) are fine when explicitly
  asked.
- The repo is named `Maquina` on GitHub but the org/user is
  `bryant-ortega`. The local working tree is on `main` and tracks
  `origin/main`. The user pushes to `main` directly — no PR review flow
  in use yet.
- **Always remind Chase to `git push` after `git commit`.** This came
  up in the current session — he committed, asked why the change
  wasn't visible, and the answer was "Vercel only deploys what's on
  origin." If you give him an `add/commit/push` block, keep all three
  commands together.
- **Always pair migrations with `NOTIFY pgrst, 'reload schema';`.**
  Without it, PostgREST's schema cache stays stale and `supabase.from('newtable')` calls fail with "Could not find the table in the schema
  cache" — confusing because the table actually exists. We hit this on
  views (Phase 17d) and again on vendors (Phase 17h).

*Last refreshed 2026-07-27, end of session, on top of commit `890054e`
("Fix signup role bug, catch up roles/has_role migrations, tighten
designer RLS on djs") — pushed, live on `origin/main`. Migrations
0026–0028 are all applied and verified against the live DB. If you're
reading this much later and the "What's done" numbering feels dated,
check `git log --oneline` for anything past `890054e`, and
independently verify anything auth/RLS-related against the live DB
rather than trusting migration files alone — this session found real
drift between the two more than once, so it's a habit worth keeping.*

— end of handoff
