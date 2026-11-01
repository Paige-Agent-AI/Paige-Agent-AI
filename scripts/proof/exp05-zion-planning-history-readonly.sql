-- Original EXP05 Planning history correction. Not a standalone production apply.
-- The original publication/stage guard keeps its locks. Historical inspection
-- runs through the existing read-only Team doors with the same authority.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE p pg_catalog.pg_proc; before_metadata jsonb; after_metadata jsonb;
 source text:=$history$
DECLARE b jsonb:=t.read_context->'planning'; tools jsonb:=t.read_context->'tools';
 config jsonb; ch public.team_hub_channels; item jsonb; staff boolean;
BEGIN
 -- Exact original native policies underpin this projection. Unknown changes
 -- fail closed rather than silently retaining an obsolete authority predicate.
 IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proowner='postgres'::regrole AND (
   (p.oid=to_regprocedure('public._sales_invoice_actor(uuid,uuid)') AND md5(p.prosrc)='27202521ef9750d3246ee5e5e11018aa') OR
   (p.oid=to_regprocedure('public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)') AND md5(p.prosrc)='b92f4236bb2ef1e4bb01c584d0645ba7') OR
   (p.oid=to_regprocedure('public._team_hub_assert_planning_read(public.team_hub_agent_turns)') AND md5(p.prosrc)='06e75ab8306ecb1434727f2fca152e74')))<>3 THEN
  RAISE EXCEPTION 'Original Planning history policy unavailable' USING ERRCODE='42501'; END IF;
 IF t.consumed_at IS NULL OR auth.uid() IS DISTINCT FROM t.asker_user_id
  OR t.read_context->>'token_hash' IS DISTINCT FROM t.token_hash
  OR public._team_hub_refusal(t.tenant_id) IS NOT NULL THEN
  RAISE EXCEPTION 'Planning history requires original current reader' USING ERRCODE='42501'; END IF;
 -- Preserve every original actor-helper condition without requesting its
 -- mutation locks in a read-only transaction. The whole helper is pinned above.
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=t.asker_user_id AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now()))
  OR NOT EXISTS(SELECT 1 FROM public.tenants n WHERE n.id=t.tenant_id AND n.status IN ('trial','active','past_due')
    AND n.account_type='standalone' AND n.parent_tenant_id IS NULL)
  OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=t.asker_user_id AND p.active_tenant_id=t.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.user_id=t.asker_user_id AND m.tenant_id=t.tenant_id
    AND m.status='active' AND m.role IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Original Planning history authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO ch FROM public._team_hub_visible(t.tenant_id,t.asker_user_id,t.channel_id);
 IF NOT FOUND OR ch.kind<>'agent_dm' OR ch.agent_key IS DISTINCT FROM t.agent_key
  OR t.agent_key<>'zion' OR t.intent<>'dm' THEN
  RAISE EXCEPTION 'Planning history requires original private DM' USING ERRCODE='42501'; END IF;
 SELECT s.config INTO config FROM public.paige_subagents s WHERE s.tenant_id IS NULL AND s.slug='zion';
 IF NOT FOUND OR config#>>'{capability_scope,mode}' IS DISTINCT FROM 'allowlist'
  OR jsonb_typeof(config#>'{capability_scope,tools}') IS DISTINCT FROM 'array'
  OR jsonb_typeof(tools) IS DISTINCT FROM 'array' OR jsonb_array_length(tools) NOT BETWEEN 1 AND 3
  OR NOT (tools ? 'plan_list') OR jsonb_typeof(b) IS DISTINCT FROM 'object'
  OR b->>'version' IS DISTINCT FROM '1' OR b->'roster_tools' IS DISTINCT FROM config#>'{capability_scope,tools}'
  OR jsonb_typeof(b->'observations') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'observations') NOT BETWEEN 1 AND 3
  OR jsonb_typeof(b->'plans') IS DISTINCT FROM 'array' OR jsonb_typeof(b->'items') IS DISTINCT FROM 'array'
  OR jsonb_array_length(b->'plans')+jsonb_array_length(b->'items')>120 THEN
  RAISE EXCEPTION 'Original Planning history source unavailable' USING ERRCODE='42501'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(tools) LOOP
  IF jsonb_typeof(item)<>'string' OR NOT (config#>'{capability_scope,tools}' @> jsonb_build_array(item))
   OR item#>>'{}' NOT IN ('crm_list_tasks','crm_get_task','crm_list_team','plan_list') THEN
   RAISE EXCEPTION 'Original Planning history tool unavailable' USING ERRCODE='42501'; END IF;
 END LOOP;
 -- Historical answers keep legitimate later edits. Recheck current original
 -- source access with the same canonical role predicates, not old copied text.
 staff:=coalesce(public.has_any_role(t.asker_user_id,ARRAY['admin','super_admin'])
  OR public.is_platform_owner(t.asker_user_id),false);
 FOR item IN SELECT value FROM jsonb_array_elements(b->'plans') LOOP
  IF NOT EXISTS(SELECT 1 FROM public.plans p WHERE p.id=(item#>>'{}')::uuid AND p.tenant_id=t.tenant_id
   AND (staff OR p.owner_user_id=t.asker_user_id OR p.created_by=t.asker_user_id OR p.scope='team')) THEN
   RAISE EXCEPTION 'Original Planning source unavailable' USING ERRCODE='42501'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(b->'items') LOOP
  IF NOT EXISTS(SELECT 1 FROM public.plan_items i WHERE i.id=(item#>>'{}')::uuid AND i.tenant_id=t.tenant_id
   AND (staff OR i.assigned_to_user_id=t.asker_user_id OR i.created_by=t.asker_user_id)
   AND (i.plan_id IS NULL OR EXISTS(SELECT 1 FROM public.plans p WHERE p.id=i.plan_id AND p.tenant_id=t.tenant_id
    AND (staff OR p.owner_user_id=t.asker_user_id OR p.created_by=t.asker_user_id OR p.scope='team')))) THEN
   RAISE EXCEPTION 'Original Planning item unavailable' USING ERRCODE='42501'; END IF;
 END LOOP;
 RETURN '{}'::jsonb;
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('body','This Planning reply is unavailable because access to its original records could not be verified. Return to Operations to review the current work.',
  'source_backed_read',false,'paige_record_links','[]'::jsonb,'source_unavailable',true);
END $history$;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(
  'public._team_hub_planning_read_annotations(public.team_hub_agent_turns)');
 IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR p.proargnames IS DISTINCT FROM ARRAY['t']
  OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
  OR p.prokind<>'f' OR p.provariadic<>0 OR p.pronargdefaults<>0
  OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee<>p.proowner OR a.is_grantable
    OR a.privilege_type<>'EXECUTE')
  OR NOT ((md5(p.prosrc)='c6cdad338235bb39ac2d0b8609a45aa3' AND p.provolatile='v')
    OR (p.prosrc=source AND p.provolatile='s')) THEN
  RAISE EXCEPTION 'Original Planning history source or metadata drift'; END IF;
 before_metadata:=to_jsonb(p)-'prosrc'-'provolatile';
 IF p.prosrc<>source OR p.provolatile<>'s' THEN
  EXECUTE 'CREATE OR REPLACE FUNCTION public._team_hub_planning_read_annotations(t public.team_hub_agent_turns)
   RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''''
   AS $function$'||source||'$function$';
 END IF;
 SELECT to_jsonb(r)-'prosrc'-'provolatile' INTO after_metadata FROM pg_catalog.pg_proc r WHERE r.oid=p.oid;
 IF after_metadata IS DISTINCT FROM before_metadata OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc r
   WHERE r.oid=p.oid AND r.prosrc=source AND r.provolatile='s') THEN
  RAISE EXCEPTION 'Original Planning history source or metadata changed'; END IF;
END $patch$;
COMMIT;
