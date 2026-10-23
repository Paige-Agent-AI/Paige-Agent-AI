-- One canonical Metric predicate for the caller wrapper and future native work.
-- No public actor impersonation seam or delayed report is activated here.
BEGIN;

CREATE FUNCTION public._analytics_metric_actor_authorized(p_actor uuid,p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT p_actor IS NOT NULL AND p_tenant IS NOT NULL
 AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_actor AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until <= now()))
 AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=p_actor AND p.active_tenant_id=p_tenant)
 AND EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id=p_actor AND m.tenant_id=p_tenant
   AND m.status='active' AND m.role::text IN ('owner','admin'))
 AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=p_tenant AND t.status::text IN ('active','trial','past_due'))
$$;
REVOKE ALL ON FUNCTION public._analytics_metric_actor_authorized(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- CREATE OR REPLACE preserves the original wrapper's owner, ABI and private ACL.
-- Its JWT/current-workspace condition remains mandatory for ordinary Metric reads.
CREATE OR REPLACE FUNCTION public._analytics_metric_authorized(p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT public.current_user_tenant_id() = p_tenant
 AND public._analytics_metric_actor_authorized(auth.uid(),p_tenant)
$$;

COMMIT;
