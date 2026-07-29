-- Full teardown for the Ofrendas vendor-call feature.
--
-- Run this in the Supabase SQL editor (or via an MCP execute_sql /
-- apply_migration call) whenever Chase decides to retire the Ofrendas
-- vendor-application form. It removes the table completely, as if it
-- was never incorporated.
--
-- After running this SQL, also delete these files to finish the job:
--   src/app/ofrendas-vendors/                                                  (the page, form, and server action)
--   supabase/migrations/0032_ofrendas_vendor_applications.sql                  (original migration)
--   supabase/migrations/0033_ofrendas_vendor_applications_full_spec.sql        (rebuild to the full 15-question spec)
--   supabase/teardown/ofrendas_vendor_applications_teardown.sql                (this file)
--   the sendOfrendasVendorApplicationReceipt function in src/lib/email.ts
--
-- Nothing else in the app references this table or route, so that's
-- the entire cleanup — no other migrations or code need to change.

DROP TABLE IF EXISTS ofrendas_vendor_applications CASCADE;

NOTIFY pgrst, 'reload schema';
