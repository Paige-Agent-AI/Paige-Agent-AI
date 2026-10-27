-- EXP09: discover the selected business's original published calendars.
-- This is a read, not availability, admission, a booking writer or a provider grant.
BEGIN;

DO $lease$
DECLARE actual jsonb;
BEGIN
 SELECT pg_catalog.jsonb_build_object(
  'body',pg_catalog.md5(p.prosrc),'owner',pg_catalog.pg_get_userbyid(p.proowner),
  'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,
  'args',pg_catalog.pg_get_function_identity_arguments(p.oid),
  'result',pg_catalog.pg_get_function_result(p.oid),
  'acl',(SELECT pg_catalog.jsonb_agg(
   CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END
   ||':'||a.privilege_type||':'||a.is_grantable::text
   ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END)
   FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a))
 INTO actual FROM pg_catalog.pg_proc p
 WHERE p.oid=pg_catalog.to_regprocedure('public.client_portal_relationship_id(uuid)');
 IF actual IS DISTINCT FROM $contract${
  "body":"ff84ba24689e5043d7d15ed3d9150268","owner":"postgres","definer":true,
  "volatility":"s","config":["search_path=public, pg_temp"],"args":"p_tenant_id uuid",
  "result":"uuid","acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"]
 }$contract$::jsonb THEN
  RAISE EXCEPTION 'Original customer relationship contract changed; reconcile' USING ERRCODE='42501';
 END IF;
END $lease$;

CREATE FUNCTION public.client_portal_booking_calendars(
 p_tenant_id uuid,p_expected_client_id uuid,p_after_slug text DEFAULT NULL,p_limit integer DEFAULT 20
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $discovery$
DECLARE customer uuid; page jsonb; next_slug text; more boolean;
BEGIN
 -- Supplied business/client identifiers only narrow real, current Auth membership.
 -- No email, route, staff role, cached preference or service-role fallback.
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_expected_client_id IS NULL THEN
  RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501';
 END IF;
 customer:=public.client_portal_relationship_id(p_tenant_id);
 IF customer IS DISTINCT FROM p_expected_client_id THEN
  RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501';
 END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>50
   OR (p_after_slug IS NOT NULL AND pg_catalog.length(p_after_slug)>240) THEN
  RAISE EXCEPTION 'invalid calendar page' USING ERRCODE='22023';
 END IF;

 -- Native calendar publication remains authoritative. A roster must exist and
 -- every offered host must still be an active member of this same business.
 -- Availability/time windows, service/intake rules and final admission remain
 -- the original booking engine's job. Discovery cannot promise an open slot.
 WITH candidates AS (
  SELECT c.id,c.slug,c.title,c.description,c.duration_min,c.timezone
  FROM public.calendars c
  WHERE c.tenant_id=p_tenant_id AND c.enabled IS TRUE
   AND (p_after_slug IS NULL OR c.slug COLLATE "C">p_after_slug COLLATE "C")
   AND EXISTS(SELECT 1 FROM public.calendar_hosts h WHERE h.calendar_id=c.id)
   AND NOT EXISTS(
    SELECT 1 FROM public.calendar_hosts h WHERE h.calendar_id=c.id
     AND NOT EXISTS(SELECT 1 FROM public.tenant_members m
      WHERE m.tenant_id=c.tenant_id AND m.user_id=h.user_id AND m.status='active'))
  ORDER BY c.slug COLLATE "C" LIMIT p_limit+1
 ), ranked AS (
  SELECT c.*,pg_catalog.row_number() OVER(ORDER BY c.slug COLLATE "C") AS rn FROM candidates c
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',r.id,'slug',r.slug,'title',coalesce(nullif(pg_catalog.btrim(r.title),''),'Appointment'),
   'description',pg_catalog.left(r.description,1200),
   'duration_min',greatest(5,coalesce(r.duration_min,30)),
   'timezone',coalesce(nullif(r.timezone,''),'America/New_York')
  ) ORDER BY r.slug COLLATE "C") FILTER(WHERE r.rn<=p_limit),'[]'::jsonb),
  max(r.slug COLLATE "C") FILTER(WHERE r.rn=p_limit),
  coalesce(pg_catalog.bool_or(r.rn>p_limit),false)
 INTO page,next_slug,more FROM ranked r;

 RETURN pg_catalog.jsonb_build_object('tenant_id',p_tenant_id,'client_id',customer,
  'calendars',page,'has_more',more,'next_after_slug',CASE WHEN more THEN next_slug ELSE NULL END);
END $discovery$;
REVOKE ALL ON FUNCTION public.client_portal_booking_calendars(uuid,uuid,text,integer)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_booking_calendars(uuid,uuid,text,integer) TO authenticated;
COMMENT ON FUNCTION public.client_portal_booking_calendars(uuid,uuid,text,integer) IS
 'Auth-bound selected-business customer read of original published calendars with active native rosters. Exact relationship intent; bounded keyset page and allowlisted presentation. No availability, booking or provider execution authority.';

COMMIT;
