-- EXP08 A2b P1, #3108/PRRT_kwDOSAAXqM6x0z0D: card-read authority at publication.
-- Extend the existing accepted-token read-context guard, never a second authority path.
-- Original MERIT/CURA/VERA body is byte-identical after removing the marked A2b branch
-- and restoring the original three-agent predicate; original full metadata/ACL guard retained.
-- Forward-only after26020008. No applied migration rewrite, domain writer or provider effect.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $post_required$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure(
  'public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)'))
  IS DISTINCT FROM 'bd0e68f3c3e88976786d716dc4a870a6' THEN
  RAISE EXCEPTION 'Current composed A2b post required'; END IF;
END $post_required$;
DO $e04_read_access$
DECLARE p pg_catalog.pg_proc%ROWTYPE; original_oid oid; before_metadata jsonb;
 original_body text; corrected text; anchor text;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(
  'public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN (
   '1c775f6c3c41b6cd32f01a52238933cb','a75a322d43e4cde08f5142d1eabf6ddb')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
  OR p.prorettype<>'void'::regtype OR p.proretset OR p.pronargs<>1 OR p.pronargdefaults<>0
  OR p.proargnames IS DISTINCT FROM ARRAY['t']::text[]
  OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR p.prokind<>'f'
  OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.proacl IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
    WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
  RAISE EXCEPTION 'Original Team Hub read guard requires reconciliation' USING ERRCODE='23514';
 END IF;
 original_oid:=p.oid; original_body:=p.prosrc;
 before_metadata:=pg_catalog.to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'];
 IF pg_catalog.md5(original_body)='1c775f6c3c41b6cd32f01a52238933cb' THEN
  corrected:=$exp08_body$
DECLARE c public.team_hub_channels; config jsonb; tools jsonb:=t.read_context->'tools'; item jsonb;
BEGIN
 PERFORM public._sales_invoice_actor(t.asker_user_id,t.tenant_id);
 IF NOT EXISTS(SELECT 1 FROM public.tenants n WHERE n.id=t.tenant_id
   AND n.account_type='standalone' AND n.parent_tenant_id IS NULL) THEN
  RAISE EXCEPTION 'Source read workspace unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public._team_hub_visible(t.tenant_id,t.asker_user_id,t.channel_id);
 IF NOT FOUND OR c.kind<>'agent_dm' OR c.agent_key IS DISTINCT FROM t.agent_key OR t.intent<>'dm'
   OR t.agent_key NOT IN ('merit','cura','vera','paige','zion','nexus') THEN
  RAISE EXCEPTION 'Source read requires original private specialist DM' USING ERRCODE='42501'; END IF;
 -- EXP08 A2b card reads START: original token staging and atomic publication guard.
 IF t.agent_key IN ('paige','zion','nexus') THEN
  IF jsonb_typeof(tools) IS DISTINCT FROM 'array' OR jsonb_array_length(tools) NOT BETWEEN 1 AND 3 THEN
   RAISE EXCEPTION 'Card source scope unavailable' USING ERRCODE='42501'; END IF;
  IF t.agent_key<>'paige' THEN
   SELECT s.config INTO config FROM public.paige_subagents s
    WHERE s.tenant_id IS NULL AND s.slug=t.agent_key FOR SHARE;
   IF NOT FOUND OR config->'capability_scope'->>'mode' IS DISTINCT FROM 'allowlist'
    OR coalesce(config->'capability_scope'->>'access','') NOT IN ('read','card')
    OR jsonb_typeof(config->'capability_scope'->'tools') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Card source roster unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(tools) LOOP
   IF jsonb_typeof(item)<>'string' OR NOT (CASE t.agent_key
    WHEN 'paige' THEN item#>>'{}' IN ('crm_list_tasks','crm_get_task','crm_list_team','growth_list')
    WHEN 'zion' THEN item#>>'{}' IN ('crm_list_tasks','crm_get_task','crm_list_team')
    WHEN 'nexus' THEN item#>>'{}'='growth_list' ELSE false END)
    OR (t.agent_key<>'paige' AND NOT (config->'capability_scope'->'tools' @> jsonb_build_array(item))) THEN
    RAISE EXCEPTION 'Card source no longer permitted' USING ERRCODE='42501'; END IF;
  END LOOP;
  IF t.consumed_at IS NULL AND (t.read_context->>'expires_at')::timestamptz<=clock_timestamp() THEN
   RAISE EXCEPTION 'Source read verification expired' USING ERRCODE='42501'; END IF;
  RETURN;
 END IF;
 -- EXP08 A2b card reads END.
 SELECT s.config INTO config FROM public.paige_subagents s
  WHERE s.tenant_id IS NULL AND s.slug=t.agent_key FOR SHARE;
 IF NOT FOUND OR config->'capability_scope'->>'mode' IS DISTINCT FROM 'allowlist'
   OR config->'capability_scope'->>'access' IS DISTINCT FROM 'read'
   OR jsonb_typeof(config->'capability_scope'->'tools') IS DISTINCT FROM 'array'
   OR jsonb_typeof(tools) IS DISTINCT FROM 'array' OR jsonb_array_length(tools) NOT BETWEEN 1 AND 3 THEN
  RAISE EXCEPTION 'Source read scope unavailable' USING ERRCODE='42501'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(tools) LOOP
  IF jsonb_typeof(item)<>'string' OR NOT (config->'capability_scope'->'tools' @> jsonb_build_array(item))
    OR NOT (CASE t.agent_key
      WHEN 'merit' THEN item#>>'{}' IN ('agreement_list','agreement_status','read_client_engagement_status')
      WHEN 'cura' THEN item#>>'{}'='read_client_engagement_status'
      WHEN 'vera' THEN item#>>'{}'='read_business_metric' ELSE false END) THEN
   RAISE EXCEPTION 'Source read no longer permitted' USING ERRCODE='42501'; END IF;
 END LOOP;
 -- A consumed turn's historical reply stays historical. Unconsumed attestations are short lived.
 IF t.consumed_at IS NULL AND (t.read_context->>'expires_at')::timestamptz<=clock_timestamp() THEN
  RAISE EXCEPTION 'Source read verification expired' USING ERRCODE='42501'; END IF;
END $exp08_body$;
  IF pg_catalog.md5(corrected)<>'a75a322d43e4cde08f5142d1eabf6ddb' THEN
   RAISE EXCEPTION 'Card-read correction differs from reviewed source' USING ERRCODE='23514'; END IF;
  EXECUTE pg_catalog.replace(pg_catalog.pg_get_functiondef(original_oid),original_body,corrected);
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=original_oid;
 IF pg_catalog.md5(p.prosrc)<>'a75a322d43e4cde08f5142d1eabf6ddb'
  OR pg_catalog.to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'] IS DISTINCT FROM before_metadata THEN
  RAISE EXCEPTION 'Original private read metadata or correction changed' USING ERRCODE='23514'; END IF;
END $e04_read_access$;
COMMIT;
