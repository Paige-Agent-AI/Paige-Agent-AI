-- Signed-in readers may SELECT the marketing content library; rows stay scoped by the existing policy.
--
-- WHY. Marketing › Content, Email and Ads, and Vibe Studio's reopen of a saved piece
-- (src/solo/studio/studio-data.ts loadImage), read public.marketing_content directly. In production
-- the `authenticated` role holds no privilege on the table (only `postgres` does;
-- has_table_privilege('authenticated','public.marketing_content','SELECT') = false on 2026-10-04),
-- so every such read is refused and the panels show "could not load". Owner approved the grant
-- 2026-10-04.
--
-- WHAT IT DOES NOT CHANGE. Rows are still limited by marketing_content_tenant_manage (20260711014952):
-- the active workspace for its admins, or the platform owner. Writes still go only through
-- save_marketing_content / delete_marketing_content (SECURITY DEFINER); no INSERT, UPDATE or DELETE
-- is granted here. anon gains nothing.
--
-- PROOF (rolled back on production before this file was written): with this grant, an admin of a
-- workspace holding 1 of 17 rows sees exactly 1 and 0 foreign rows; a user with no role sees 0;
-- anon is still refused (42501).

GRANT SELECT ON public.marketing_content TO authenticated;
