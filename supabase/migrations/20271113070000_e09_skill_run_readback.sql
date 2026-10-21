-- Original skill results through the existing inbound MCP door. Read-only delegated
-- actor identity is admitted by that door, never a client-supplied user/tenant claim.
-- No table, run writer, RLS policy, skill execution or provider activation changes.
BEGIN;

-- The native authority read and original staff predicate are protected dependencies.
-- A changed incumbent must be reconciled rather than silently redefining its rules.
DO $lease$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_actor_access(uuid)'::regprocedure)
       IS DISTINCT FROM '574bad191b12f518da0a720fbb210369'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.tenant_staff_owns_contact(uuid,uuid)'::regprocedure)
       IS DISTINCT FROM '53c6729219f292f9ce1f6688cb0d1376'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.is_platform_owner(uuid)'::regprocedure)
       IS DISTINCT FROM 'dc789c98cf26f96d52c5138754c0f131' THEN
    RAISE EXCEPTION 'Original skill-result authority changed; reconcile before applying' USING ERRCODE='55000';
  END IF;
END;
$lease$;

CREATE FUNCTION public.read_mcp_skill_run(_actor uuid,_expected_tenant uuid,_run_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $function$
 SELECT jsonb_build_object(
   'id',r.id,'skill_id',r.skill_id,'skill_slug',r.skill_slug,'contact_id',r.contact_id,
   'invoker_kind',r.invoker_kind,'invoker_user_id',r.invoker_user_id,
   'inputs',r.inputs,'outputs',r.outputs,'status',r.status,'error',r.error,
   'steps',r.steps_log,'latency_ms',r.duration_ms,'created_at',r.created_at,'completed_at',r.completed_at)
 FROM public.paige_skill_runs r
 LEFT JOIN public.clients c ON c.id=r.contact_id
 WHERE r.id=_run_id AND _actor IS NOT NULL AND _expected_tenant IS NOT NULL
   AND (
     -- Exact original run-RLS exception, not the broader tier=god classification.
     public.is_platform_owner(_actor)
     OR (
       c.tenant_id=_expected_tenant
       AND (public.get_actor_access(_actor)->>'account_id')=_expected_tenant::text
       AND (
         public.tenant_staff_owns_contact(_actor,r.contact_id)
         OR (c.assigned_coach_user_id=_actor AND EXISTS (
           SELECT 1 FROM public.tenant_members m WHERE m.user_id=_actor
             AND m.tenant_id=c.tenant_id AND m.status='active'))
       )
     )
   );
$function$;
ALTER FUNCTION public.read_mcp_skill_run(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_mcp_skill_run(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_mcp_skill_run(uuid,uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.read_mcp_skill_run(uuid,uuid,uuid) IS
 'Service-only original MCP run projection. Validated actor plus current native workspace and original run staff authority; no own-invoker/contactless ordinary grant. Missing and denied return NULL.';
COMMIT;
