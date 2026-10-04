-- Signed-in admins of a business may read that business's marketing content library, and no other.
--
-- WHY. Marketing › Content, Email and Ads, Vibe Studio (reopening a saved image, document or copy:
-- src/solo/studio/studio-data.ts loadImage, src/components/admin/studio/studio.ts, useMediaJobs) and
-- paige-ai-chat's document revise path (it reads with the caller's own token) all read
-- public.marketing_content directly. In production the `authenticated` role held no privilege on the
-- table (has_table_privilege('authenticated','public.marketing_content','SELECT') = false on
-- 2026-10-04), so every such read was refused. Owner approved the grant 2026-10-04.
--
-- THE RULE IS NARROWED FIRST. marketing_content_tenant_manage (last set in 20270503000000) admitted
-- `tenant_id = current_user_tenant_id() AND has_any_role(auth.uid(), ARRAY['admin','super_admin'])`.
-- `user_roles` is GLOBAL (§53/§59): every business owner or admin holds 'admin' there, so an admin of
-- business A who is only a plain member of business B could have read B's library by making B
-- active. The rule now asks whether the caller is an admin of THAT row's business
-- (is_tenant_admin, the same test the Marketing briefs read reports as can_manage), or the platform
-- owner. Writes are unaffected: authenticated holds no INSERT/UPDATE/DELETE, and every write goes
-- through save_marketing_content / delete_marketing_content (SECURITY DEFINER). anon gains nothing.
--
-- PROOF (rolled back on production before this file was written): with this rule and grant, an admin
-- of one business sees its 1 row; made a plain member of a second business (14 rows) they see 0 of
-- them; that business's own admin sees all 14; a user with no role sees 0; anon is refused (42501).

ALTER POLICY marketing_content_tenant_manage ON public.marketing_content
  USING (public.is_tenant_admin(tenant_id) OR public.is_platform_owner())
  WITH CHECK (public.is_tenant_admin(tenant_id) OR public.is_platform_owner());

GRANT SELECT ON public.marketing_content TO authenticated;
