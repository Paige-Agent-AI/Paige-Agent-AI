-- Nothing in the database reads the retired title role any longer.
--
-- 1. The staff name projection.
--
-- "Coach" is a title a business gives its people, never a role. `coach_client_profiles_safe` let a
-- holder of the retired platform-wide role see the names of everyone whose active business matched
-- their own, beside admins and super admins. That branch is removed. Every other branch of the gate
-- is unchanged: self; the platform owner; an admin or super admin of the person's active business;
-- and the person's assigned staff member while working in the assignment's business — which is how
-- anyone who serves a client still sees that client's name.
--
-- Columns, options (security_barrier), grants and the comment are unchanged; CREATE OR REPLACE keeps
-- the grants and the comment.
--
-- 2. map_tenant_role_to_app_role loses its branch for the retired seat. No membership can hold that
-- seat (20270508000000), so the branch could never run; the other seats map as before. Name,
-- signature, volatility, settings and grants are unchanged.
--
-- No row is changed. Applied as one statement, so production takes all of it or none of it, with a
-- short lock wait so a blocked attempt fails the deploy instead of holding up other queries.
SET lock_timeout = '10s';

DO $migration$
BEGIN

-- security-invoker-exempt: owner-run projection over profiles (self-only RLS); an invoker view would show each staff caller only their own row. Access is the WHERE gate below.
CREATE OR REPLACE VIEW public.coach_client_profiles_safe WITH (security_barrier = true) AS
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

CREATE OR REPLACE FUNCTION public.map_tenant_role_to_app_role(_tenant_role public.tenant_role)
 RETURNS public.app_role
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
    SELECT CASE _tenant_role
      WHEN 'owner'  THEN 'admin'::app_role
      WHEN 'admin'  THEN 'admin'::app_role
      WHEN 'member' THEN 'user'::app_role
    END
  $function$;
END
$migration$;

RESET lock_timeout;
