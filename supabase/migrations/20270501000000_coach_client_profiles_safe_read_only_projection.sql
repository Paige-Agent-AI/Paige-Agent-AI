-- Staff name resolution reads only what it shows, is read-only, and stays inside the business.
--
-- `coach_client_profiles_safe` is how staff surfaces show another person's name and avatar (team
-- roster, support, audit log, deals, contacts, invitations, the funding pipeline). Every one of
-- those callers selects `user_id` and `full_name`; the roster also reads `avatar_url`,
-- `suspended_at` and `suspended_reason`. Nothing writes through it.
--
-- After this migration:
--   * the view carries only the columns its callers read;
--   * it is read-only: `authenticated` may SELECT it and nothing else; `anon` holds nothing;
--   * an assigned staff member sees an assigned person only for the business the assignment
--     belongs to, and only while working in that business;
--   * every other branch of the gate is unchanged;
--   * the gate is evaluated before any condition a caller adds to their query.
--
-- It remains an owner-run view on purpose: `profiles` lets a person read only their own row, so an
-- invoker view would show every caller nothing but themselves. The gate below is therefore the whole
-- of its access control.
--
-- Record correction: 20260820000000 says this view was created owner-run on purpose in
-- 20260704220640. It omits that 20260705000452 then set it to run as the invoker, and that
-- 20260820000000's own CREATE OR REPLACE (having no WITH clause) returned it to owner-run.

-- Columns cannot be removed with CREATE OR REPLACE. Nothing depends on the view.
DROP VIEW public.coach_client_profiles_safe;

-- security-invoker-exempt: owner-run projection over profiles (self-only RLS); an invoker view would show each staff caller only their own row. Access is the WHERE gate below.
CREATE VIEW public.coach_client_profiles_safe WITH (security_barrier = true) AS
SELECT
  p.id,
  p.user_id,
  p.full_name,
  p.avatar_url,
  p.suspended_at,
  p.suspended_reason
FROM public.profiles p
WHERE
  p.user_id = auth.uid()
  OR public.is_platform_owner()
  OR (
    (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'coach'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    )
    AND p.active_tenant_id IS NOT NULL
    AND p.active_tenant_id = public.current_user_tenant_id()
  )
  OR EXISTS (
    SELECT 1 FROM public.coach_clients cc
    WHERE cc.coach_user_id = auth.uid()
      AND cc.client_user_id = p.user_id
      AND cc.status = 'active'
      AND cc.tenant_id = public.current_user_tenant_id()
  );

REVOKE ALL ON public.coach_client_profiles_safe FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.coach_client_profiles_safe TO authenticated;
GRANT ALL ON public.coach_client_profiles_safe TO service_role;

COMMENT ON VIEW public.coach_client_profiles_safe IS
  'Read-only display projection of profiles (id, user_id, full_name, avatar_url, suspended_at, '
  'suspended_reason) for staff surfaces. Owner-run because profiles RLS is self-only; the WHERE is '
  'the access gate: self, platform owner, tenant staff of the person''s active business, or the '
  'person''s assigned staff member while working in the assignment''s business. SELECT only; '
  'security_barrier, so the gate runs before caller conditions. Never grant a write on it.';
