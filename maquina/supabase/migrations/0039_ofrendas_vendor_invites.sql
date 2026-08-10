-- Migration 0039 — private invite links for the Ofrendas vendor call.
--
-- Public applications close at a hardcoded deadline (see
-- src/app/ofrendas-vendors/deadline.ts). After that, an admin or
-- ofrendas_partner can generate a one-time invite link from the
-- Ofrendas admin page (/ofrendas-vendor-applications) that lets one
-- specific late vendor still submit — bypassing the public deadline
-- only. Everything else about the submission is unchanged: same zod
-- validation, same rate limiting, same RLS-locked insert into
-- ofrendas_vendor_applications via the service-role key.
--
-- Same isolation pattern as ofrendas_vendor_applications: RLS
-- enabled, zero anon/authenticated policies — service-role only, both
-- for creating an invite (admin action) and redeeming one (public
-- submit action). `code` is a long random URL-safe token generated in
-- src/lib/ofrendas-invites.ts; the link itself is the credential, so
-- lookups are always an exact-match WHERE code = $1, never a listing
-- or prefix search that could leak which codes exist.
--
-- Single-use is enforced with `used_at`: redemption is an atomic
-- `UPDATE ... SET used_at = now() WHERE code = $1 AND used_at IS NULL`
-- (see claimOfrendasVendorInvite), so two concurrent submissions with
-- the same code can't both succeed.

CREATE TABLE ofrendas_vendor_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  -- Free-text note for whoever generated the link, e.g. "Maria's
  -- Tamales, texted 8/12" — never shown to the vendor, purely so the
  -- admin list is legible later. Not used for any validation.
  note         text,
  created_by   uuid REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  used_at      timestamptz
);

ALTER TABLE ofrendas_vendor_invites ENABLE ROW LEVEL SECURITY;
-- No policies added — deliberate default-deny for anon/authenticated,
-- same as ofrendas_vendor_applications. All access via service-role.

CREATE UNIQUE INDEX ofrendas_vendor_invites_code_idx
  ON ofrendas_vendor_invites(code);

-- Audit trail: which invite (if any) a submitted application came
-- through. Nullable — the vast majority of applications go through
-- the public form with no invite code at all.
ALTER TABLE ofrendas_vendor_applications
  ADD COLUMN invite_code text;

NOTIFY pgrst, 'reload schema';
