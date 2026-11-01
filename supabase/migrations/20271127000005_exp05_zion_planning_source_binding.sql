-- Original EXP05 #3087 forward carrier, after released E08 20271126230008.
-- CLI-created local file safely renumbered before any application.
-- Embedded INERT label describes the original proof file; this is its forward carrier.
-- Exact original reviewed candidate below; no history rewrite or activation.
-- INERT SOURCE CANDIDATE, not a migration or activation. Original EXP05 #3087.
-- Assign a genuinely free forward migration identity only after lower owners'
-- actual release/readback. Never use this file for manual production DDL.
-- Validation-only projections; the data read remains the original caller-JWT
-- plan_list. No public RPC, grant, Work writer, provider or specialist registry.
BEGIN;
SET LOCAL lock_timeout='2s';

CREATE OR REPLACE FUNCTION public._team_hub_planning_read_source(t public.team_hub_agent_turns,a jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE staff boolean; lim integer; p record; rows jsonb; plans jsonb:='[]'; loose jsonb; total integer:=0;
BEGIN
 IF t.agent_key<>'zion' OR jsonb_typeof(a) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM jsonb_object_keys(a))<>8 OR EXISTS(SELECT 1 FROM jsonb_object_keys(a) k
   WHERE k NOT IN ('horizon','plan_id','status','include_cancelled','assigned_to_user_id','from','to','limit'))
  OR jsonb_typeof(a->'include_cancelled') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(a->'limit') IS DISTINCT FROM 'number' OR a->>'limit' !~ '^[0-9]+$'
  OR (a->>'limit')::integer NOT BETWEEN 1 AND 30
  OR EXISTS(SELECT 1 FROM (VALUES('horizon'),('status')) k(key) WHERE jsonb_typeof(a->k.key) NOT IN ('string','null'))
  OR (a->>'horizon' IS NOT NULL AND a->>'horizon' NOT IN ('week','month','quarter','semiannual','year','custom'))
  OR (a->>'status' IS NOT NULL AND length(a->>'status') NOT BETWEEN 1 AND 40)
  OR EXISTS(SELECT 1 FROM (VALUES('plan_id'),('assigned_to_user_id')) k(key)
   WHERE jsonb_typeof(a->k.key) NOT IN ('string','null') OR (a->>k.key IS NOT NULL
    AND a->>k.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  OR EXISTS(SELECT 1 FROM (VALUES('from'),('to')) k(key) WHERE jsonb_typeof(a->k.key) NOT IN ('string','null')
   OR (a->>k.key IS NOT NULL AND a->>k.key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
  -- Original immutable replay400 retains two explanatory comments absent from
  -- live22552. Pin both complete bodies; never normalize an unknown reader.
  OR coalesce((SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(
   'public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean)')),'')
   NOT IN ('702f2b52fc0d4e5c615fde7ec906b840','a8c0a676cdd686bc17d5dbbb7d605ecc') THEN
  RAISE EXCEPTION 'Planning read contract unavailable' USING ERRCODE='42501'; END IF;
 lim:=(a->>'limit')::integer;
 -- Reuse the original domain role helpers, with the accepted original actor.
 -- Never set JWT claims or call the legacy service-role plan_list fallback.
 PERFORM 1 FROM public.user_roles WHERE user_id=t.asker_user_id FOR SHARE;
 staff:=coalesce(public.has_any_role(t.asker_user_id,ARRAY['admin','super_admin'])
  OR public.is_platform_owner(t.asker_user_id),false);
 FOR p IN SELECT r.id,r.updated_at FROM public.plans r
  WHERE r.tenant_id=t.tenant_id AND (staff OR r.owner_user_id=t.asker_user_id OR r.created_by=t.asker_user_id OR r.scope='team')
   AND (a->>'plan_id' IS NULL OR r.id=(a->>'plan_id')::uuid)
   AND (a->>'horizon' IS NULL OR r.horizon=a->>'horizon')
   AND (a->>'status' IS NULL OR r.status=a->>'status' OR ((a->>'include_cancelled')::boolean
    AND a->>'status' IN ('open','in_progress','blocked','done','cancelled')))
   AND (a->>'from' IS NULL OR r.ends_on >= (a->>'from')::date)
   AND (a->>'to' IS NULL OR r.starts_on <= (a->>'to')::date)
  ORDER BY r.starts_on DESC LIMIT lim FOR SHARE OF r
 LOOP
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'updated_at',i.updated_at) ORDER BY i.id),'[]') INTO rows
  FROM (SELECT i.id,i.updated_at FROM public.plan_items i WHERE i.plan_id=p.id AND i.tenant_id=t.tenant_id
   AND (NOT (a->>'include_cancelled')::boolean OR a->>'status' IS NULL
    OR a->>'status' NOT IN ('open','in_progress','blocked','done','cancelled') OR i.status=a->>'status')
   AND (staff OR i.assigned_to_user_id=t.asker_user_id OR i.created_by=t.asker_user_id)
   AND (a->>'assigned_to_user_id' IS NULL OR i.assigned_to_user_id=(a->>'assigned_to_user_id')::uuid)
   AND ((a->>'include_cancelled')::boolean OR i.status<>'cancelled')
   ORDER BY i.id LIMIT 121 FOR SHARE OF i) i;
  total:=total+1+jsonb_array_length(rows);
  IF total>120 THEN RAISE EXCEPTION 'Planning source exceeds bounded review' USING ERRCODE='42501'; END IF;
  plans:=plans||jsonb_build_array(jsonb_build_object('id',p.id,'updated_at',p.updated_at,'items',rows));
 END LOOP;
 -- The incumbent reader aggregates all loose rows before its LIMIT; the host
 -- exposes only the first 30. Match that exact bounded presentation, not a
 -- replacement domain reader or an assertion that all work was reviewed.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'updated_at',i.updated_at) ORDER BY i.id),'[]') INTO loose
 FROM (SELECT i.id,i.updated_at FROM public.plan_items i WHERE i.tenant_id=t.tenant_id AND i.plan_id IS NULL
  AND (staff OR i.assigned_to_user_id=t.asker_user_id OR i.created_by=t.asker_user_id)
  AND (a->>'assigned_to_user_id' IS NULL OR i.assigned_to_user_id=(a->>'assigned_to_user_id')::uuid)
  AND (a->>'status' IS NULL OR i.status=a->>'status')
  AND ((a->>'include_cancelled')::boolean OR i.status<>'cancelled')
  AND (a->>'from' IS NULL OR coalesce(i.due_at::date,i.remind_at::date)>=(a->>'from')::date)
  AND (a->>'to' IS NULL OR coalesce(i.due_at::date,i.remind_at::date)<=(a->>'to')::date)
  ORDER BY i.remind_at NULLS LAST,i.due_at NULLS LAST,i.created_at LIMIT 30 FOR SHARE OF i) i;
 IF total+jsonb_array_length(loose)>120 THEN
  RAISE EXCEPTION 'Planning source exceeds bounded review' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(entry ORDER BY entry->>'id'),'[]') INTO plans FROM jsonb_array_elements(plans) entry;
 RETURN jsonb_build_object('plans',plans,'loose_items',loose);
END $fn$;
REVOKE ALL ON FUNCTION public._team_hub_planning_read_source(public.team_hub_agent_turns,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Only source versions/references are normalized. Extra keys, duplicate IDs,
-- ambiguous timestamp precision and unbounded source vectors are refused.
CREATE OR REPLACE FUNCTION public._team_hub_planning_source_versions(s jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE p jsonb; i jsonb; plans jsonb:='[]'; loose jsonb:='[]'; items jsonb; ids text[]:='{}'; ref text; stamp timestamptz;
BEGIN
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(s))<>2
  OR jsonb_typeof(s->'plans') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'plans')>30
  OR jsonb_typeof(s->'loose_items') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'loose_items')>30 THEN
  RAISE EXCEPTION 'Invalid Planning source' USING ERRCODE='42501'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(s->'plans') UNION ALL SELECT value FROM jsonb_array_elements(s->'loose_items') LOOP
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k
   WHERE k NOT IN ('id','updated_at','items')) OR (p ? 'items' AND jsonb_typeof(p->'items') IS DISTINCT FROM 'array') THEN
   RAISE EXCEPTION 'Invalid Planning source row' USING ERRCODE='42501'; END IF;
  items:='[]';
  FOR i IN SELECT p UNION ALL SELECT value FROM jsonb_array_elements(coalesce(p->'items','[]')) LOOP
   ref:=i->>'id';
   IF jsonb_typeof(i) IS DISTINCT FROM 'object' OR ref IS NULL OR ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR ref=ANY(ids) OR coalesce(array_length(ids,1),0)>=120
    OR i->>'updated_at' IS NULL OR i->>'updated_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR (i IS DISTINCT FROM p AND (SELECT count(*) FROM jsonb_object_keys(i))<>2) THEN
    RAISE EXCEPTION 'Invalid Planning source version' USING ERRCODE='42501'; END IF;
   ids:=array_append(ids,ref); stamp:=(i->>'updated_at')::timestamptz;
   IF i IS DISTINCT FROM p THEN items:=items||jsonb_build_array(jsonb_build_object('id',ref,'updated_at',stamp)); END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') INTO items FROM jsonb_array_elements(items) x;
  IF p ? 'items' THEN
   plans:=plans||jsonb_build_array(jsonb_build_object('id',p->>'id','updated_at',(p->>'updated_at')::timestamptz,'items',items));
  ELSE loose:=loose||jsonb_build_array(jsonb_build_object('id',p->>'id','updated_at',(p->>'updated_at')::timestamptz)); END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') INTO plans FROM jsonb_array_elements(plans) x;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') INTO loose FROM jsonb_array_elements(loose) x;
 RETURN jsonb_build_object('plans',plans,'loose_items',loose);
END $fn$;
REVOKE ALL ON FUNCTION public._team_hub_planning_source_versions(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._team_hub_assert_planning_read(t public.team_hub_agent_turns)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE b jsonb:=t.read_context->'planning'; o jsonb; current_source jsonb; config jsonb; staff boolean; ref jsonb;
BEGIN
 SELECT s.config INTO config FROM public.paige_subagents s WHERE s.tenant_id IS NULL AND s.slug='zion' FOR SHARE;
 IF t.agent_key<>'zion' OR jsonb_typeof(b) IS DISTINCT FROM 'object' OR b->>'version' IS DISTINCT FROM '1'
  OR b->'roster_tools' IS DISTINCT FROM config#>'{capability_scope,tools}'
  OR jsonb_typeof(b->'observations') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'observations') NOT BETWEEN 1 AND 3
  OR jsonb_typeof(b->'plans') IS DISTINCT FROM 'array' OR jsonb_typeof(b->'items') IS DISTINCT FROM 'array'
  OR jsonb_array_length(b->'plans')+jsonb_array_length(b->'items')>120 THEN
  RAISE EXCEPTION 'Original Planning source scope unavailable' USING ERRCODE='42501'; END IF;
 IF t.consumed_at IS NULL THEN
  FOR o IN SELECT value FROM jsonb_array_elements(b->'observations') LOOP
   current_source:=public._team_hub_planning_read_source(t,o->'arguments');
   IF o->>'digest' IS DISTINCT FROM encode(sha256(convert_to(current_source::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Original Planning source changed' USING ERRCODE='42501'; END IF;
  END LOOP;
 ELSE
  -- A historical answer remains historical, even after a legitimate edit.
  -- Recheck CURRENT access to each original source, not old copied text.
  PERFORM 1 FROM public.user_roles WHERE user_id=t.asker_user_id FOR SHARE;
  staff:=coalesce(public.has_any_role(t.asker_user_id,ARRAY['admin','super_admin'])
   OR public.is_platform_owner(t.asker_user_id),false);
  FOR ref IN SELECT value FROM jsonb_array_elements(b->'plans') LOOP
   PERFORM 1 FROM public.plans p WHERE p.id=(ref#>>'{}')::uuid AND p.tenant_id=t.tenant_id
    AND (staff OR p.owner_user_id=t.asker_user_id OR p.created_by=t.asker_user_id OR p.scope='team') FOR SHARE OF p;
   IF NOT FOUND THEN RAISE EXCEPTION 'Original Planning source unavailable' USING ERRCODE='42501'; END IF;
  END LOOP;
  FOR ref IN SELECT value FROM jsonb_array_elements(b->'items') LOOP
   PERFORM 1 FROM public.plan_items i WHERE i.id=(ref#>>'{}')::uuid AND i.tenant_id=t.tenant_id
    AND (staff OR i.assigned_to_user_id=t.asker_user_id OR i.created_by=t.asker_user_id)
    AND (i.plan_id IS NULL OR EXISTS(SELECT 1 FROM public.plans p WHERE p.id=i.plan_id AND p.tenant_id=t.tenant_id
     AND (staff OR p.owner_user_id=t.asker_user_id OR p.created_by=t.asker_user_id OR p.scope='team'))) FOR SHARE OF i;
   IF NOT FOUND THEN RAISE EXCEPTION 'Original Planning item unavailable' USING ERRCODE='42501'; END IF;
  END LOOP;
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION public._team_hub_assert_planning_read(public.team_hub_agent_turns) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._team_hub_stage_planning_read(t public.team_hub_agent_turns,input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE d jsonb; source jsonb; current_source jsonb; b jsonb:=t.read_context->'planning'; obs jsonb; digest text; plans jsonb; items jsonb;
BEGIN
 IF t.read_context->>'token_hash' IS DISTINCT FROM t.token_hash THEN b:=NULL; END IF;
 IF b IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(input) WHERE jsonb_typeof(value)='object') THEN RETURN NULL; END IF;
 PERFORM public._sales_invoice_actor(t.asker_user_id,t.tenant_id);
 IF b IS NOT NULL THEN PERFORM public._team_hub_assert_agent_read_scope(t); END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(input) WHERE jsonb_typeof(value)='object' LOOP
  IF t.agent_key<>'zion' OR d->>'tool' IS DISTINCT FROM 'plan_list' OR d->'version' IS DISTINCT FROM '1'::jsonb
   OR (SELECT count(*) FROM jsonb_object_keys(d))<>5 OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) k
    WHERE k NOT IN ('tool','version','arguments','source','roster_tools'))
   OR jsonb_typeof(d->'roster_tools') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'roster_tools')>64
   OR d->'roster_tools' IS DISTINCT FROM (SELECT s.config#>'{capability_scope,tools}' FROM public.paige_subagents s
     WHERE s.tenant_id IS NULL AND s.slug='zion') THEN
   RAISE EXCEPTION 'Invalid original Planning binding' USING ERRCODE='42501'; END IF;
  source:=public._team_hub_planning_source_versions(d->'source');
  current_source:=public._team_hub_planning_read_source(t,d->'arguments');
  IF source IS DISTINCT FROM current_source THEN RAISE EXCEPTION 'Original Planning source changed' USING ERRCODE='42501'; END IF;
  digest:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
  obs:=coalesce(b->'observations','[]');
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(obs) o WHERE o->'arguments'=d->'arguments' AND o->>'digest'=digest) THEN
   obs:=obs||jsonb_build_array(jsonb_build_object('arguments',d->'arguments','digest',digest)); END IF;
  SELECT coalesce(jsonb_agg(DISTINCT r ORDER BY r),'[]') INTO plans FROM (
   SELECT value r FROM jsonb_array_elements(coalesce(b->'plans','[]')) UNION ALL
   SELECT p->'id' FROM jsonb_array_elements(source->'plans') p) x;
  SELECT coalesce(jsonb_agg(DISTINCT r ORDER BY r),'[]') INTO items FROM (
   SELECT value r FROM jsonb_array_elements(coalesce(b->'items','[]')) UNION ALL
   SELECT i->'id' FROM jsonb_array_elements(source->'plans') p CROSS JOIN LATERAL jsonb_array_elements(p->'items') i UNION ALL
   SELECT i->'id' FROM jsonb_array_elements(source->'loose_items') i) x;
  IF jsonb_array_length(obs)>3 OR jsonb_array_length(plans)+jsonb_array_length(items)>120 THEN
   RAISE EXCEPTION 'Planning source exceeds bounded turn' USING ERRCODE='42501'; END IF;
  b:=jsonb_build_object('version',1,'roster_tools',d->'roster_tools','observations',obs,'plans',plans,'items',items);
 END LOOP;
 RETURN b;
END $fn$;
REVOKE ALL ON FUNCTION public._team_hub_stage_planning_read(public.team_hub_agent_turns,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._team_hub_planning_read_annotations(t public.team_hub_agent_turns)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.uid() IS DISTINCT FROM t.asker_user_id THEN
  RAISE EXCEPTION 'Planning reply requires original reader' USING ERRCODE='42501'; END IF;
 PERFORM public._team_hub_assert_agent_read_scope(t);
 RETURN '{}'::jsonb;
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('body','This Planning reply is unavailable because access to its original records could not be verified. Return to Operations to review the current work.',
  'source_backed_read',false,'paige_record_links','[]'::jsonb,'source_unavailable',true);
END $fn$;
REVOKE ALL ON FUNCTION public._team_hub_planning_read_annotations(public.team_hub_agent_turns) FROM PUBLIC,anon,authenticated,service_role;

-- Exact guarded additive edits to the original guard/stage/history projection.
-- Public post, list, serializer, domain reader and all other cards stay exact.
DO $patch$
DECLARE sig text; old text; src text; replaced text; additions text[]; originals text[]; n integer; i integer; p pg_catalog.pg_proc; metadata jsonb; after_metadata jsonb;
BEGIN
 FOR sig,old,originals,additions IN SELECT * FROM (VALUES
 ('public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)','a75a322d43e4cde08f5142d1eabf6ddb',
 ARRAY[$a$    WHEN 'zion' THEN item#>>'{}' IN ('crm_list_tasks','crm_get_task','crm_list_team')$a$,
 $a$  FOR item IN SELECT value FROM jsonb_array_elements(tools) LOOP$a$],
 ARRAY[$a$    WHEN 'zion' THEN item#>>'{}' IN ('crm_list_tasks','crm_get_task','crm_list_team','plan_list')$a$,
 $a$  -- EXP05 Planning: same accepted token, current versions before publication.
  IF tools ? 'plan_list' OR t.read_context ? 'planning' THEN
   IF t.agent_key<>'zion' OR NOT (tools ? 'plan_list') THEN
    RAISE EXCEPTION 'Planning source requires original ZION DM' USING ERRCODE='42501'; END IF;
   PERFORM public._team_hub_assert_planning_read(t);
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(tools) LOOP$a$]),
 ('public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','a933da55e5f23d33ec62f90f9ec03c73',
 ARRAY[$a$DECLARE t public.team_hub_agent_turns; link jsonb; links jsonb:='[]'::jsonb; dest text; ref uuid;$a$,
 $a$ FOR link IN SELECT value FROM jsonb_array_elements(p_record_links) LOOP$a$,
 $a$    WHERE k NOT IN ('destination','record_id','subject')) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;$a$,
 $a$    WHEN 'sales_invoices' THEN EXISTS(SELECT 1 FROM public.paige_invoices r WHERE r.id=ref AND r.tenant_id=t.tenant_id)$a$,
 $a$  links:=links||jsonb_build_array(jsonb_build_object('destination',dest,'record_id',ref));$a$,
 $a$ t.read_context:=jsonb_build_object('token_hash',p_token_hash,'tools',p_read_tools,'record_links',links,
   'expires_at',clock_timestamp()+interval '2 minutes');$a$],
 ARRAY[$a$DECLARE t public.team_hub_agent_turns; link jsonb; links jsonb:='[]'::jsonb; dest text; ref uuid; planning jsonb; tools jsonb;$a$,
 $a$ -- EXP05 Planning: typed source binding is service-only, never JSON authority.
 planning:=public._team_hub_stage_planning_read(t,p_read_tools);
 IF planning IS NOT NULL THEN
  SELECT jsonb_agg(DISTINCT tool ORDER BY tool) INTO tools FROM (
   SELECT CASE WHEN jsonb_typeof(value)='object' AND value->>'tool'='plan_list' THEN '"plan_list"'::jsonb ELSE value END tool
    FROM jsonb_array_elements(p_read_tools)
   UNION ALL SELECT value FROM jsonb_array_elements(CASE WHEN t.read_context->>'token_hash'=t.token_hash
    THEN coalesce(t.read_context->'tools','[]') ELSE '[]'::jsonb END)) x;
  IF jsonb_array_length(tools)>3 THEN RAISE EXCEPTION 'Private read budget exceeded' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(value),'[]') INTO links FROM jsonb_array_elements(CASE WHEN t.read_context->>'token_hash'=t.token_hash
   THEN coalesce(t.read_context->'record_links','[]') ELSE '[]'::jsonb END)
   WHERE value->>'record_kind'='planning_item';
 ELSE tools:=p_read_tools; END IF;
 FOR link IN SELECT value FROM jsonb_array_elements(p_record_links) LOOP$a$,
 $a$    WHERE k NOT IN ('destination','record_id','subject','record_kind'))
   OR (link ? 'record_kind' AND (link->>'record_kind' IS DISTINCT FROM 'planning_item'
    OR link->>'destination' IS DISTINCT FROM 'operations_work' OR jsonb_typeof(link->'record_id') IS DISTINCT FROM 'string'))
   THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;$a$,
 $a$    WHEN 'sales_invoices' THEN EXISTS(SELECT 1 FROM public.paige_invoices r WHERE r.id=ref AND r.tenant_id=t.tenant_id)
    WHEN 'operations_work' THEN link->>'record_kind'='planning_item' AND planning IS NOT NULL
     AND planning->'items' @> jsonb_build_array(ref)$a$,
 $a$  links:=links||jsonb_build_array(jsonb_build_object('destination',dest,'record_id',ref)
   || CASE WHEN link ? 'record_kind' THEN jsonb_build_object('record_kind','planning_item') ELSE '{}'::jsonb END);$a$,
 $a$ IF planning IS NOT NULL THEN
  SELECT coalesce(jsonb_agg(DISTINCT value ORDER BY value),'[]') INTO links FROM jsonb_array_elements(links);
  IF jsonb_array_length(links)>6 THEN RAISE EXCEPTION 'Private source link budget exceeded' USING ERRCODE='42501'; END IF;
 END IF;
 t.read_context:=jsonb_build_object('token_hash',p_token_hash,'tools',tools,'record_links',links,
   'expires_at',clock_timestamp()+interval '2 minutes');
 IF planning IS NOT NULL THEN t.read_context:=t.read_context||jsonb_build_object('planning',planning); END IF;$a$]),
 ('public._team_hub_agent_read_annotations(uuid)','61bb33a7a92608e3090f25fbd477401d',
 ARRAY[$a$jsonb_build_object('source_backed_read',true,'paige_record_links',t.read_context->'record_links')$a$],
 ARRAY[$a$jsonb_build_object('source_backed_read',true,'paige_record_links',t.read_context->'record_links')
   || CASE WHEN t.read_context ? 'planning' THEN public._team_hub_planning_read_annotations(t) ELSE '{}'::jsonb END$a$]),
 ('public.team_hub_search(uuid,text,integer)','d71b872a84e35d1b6b758006181e15d2',
 ARRAY[$a$  WHERE m.id=ANY(hits)$a$],
 ARRAY[$a$  WHERE m.id=ANY(hits)
   AND NOT coalesce((public._team_hub_agent_read_annotations(m.id)->>'source_unavailable')::boolean,false)$a$])
 ) v(signature,old_md5,from_parts,to_parts)
 LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(sig);
  IF NOT FOUND OR p.proowner<>'postgres'::regrole
   OR p.proconfig IS DISTINCT FROM (CASE WHEN p.proname='team_hub_search'
    THEN ARRAY['search_path=""','plan_cache_mode=force_custom_plan']::text[] ELSE ARRAY['search_path=""']::text[] END)
   OR p.pronargdefaults<>(CASE WHEN p.proname='team_hub_search' THEN 1 ELSE 0 END)
   OR (p.proname='team_hub_search' AND pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM '20')
   OR p.proargnames IS DISTINCT FROM (CASE p.proname
    WHEN 'team_hub_search' THEN ARRAY['p_expected_tenant','p_query','p_limit']
    WHEN 'team_hub_stage_agent_read_context' THEN ARRAY['p_turn_id','p_token_hash','p_read_tools','p_record_links']
    WHEN '_team_hub_assert_agent_read_scope' THEN ARRAY['t'] ELSE ARRAY['p_message'] END)
   OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR p.prokind<>'f' OR p.provariadic<>0 OR p.proacl IS NULL
   OR (p.proname='_team_hub_agent_read_annotations' AND (p.prosecdef OR p.provolatile<>'s'
    OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')))
   OR (p.proname<>'_team_hub_agent_read_annotations' AND (NOT p.prosecdef
    OR p.provolatile<>(CASE WHEN p.proname='team_hub_search' THEN 's' ELSE 'v' END)
    OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')))
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable
    OR (a.grantee<>p.proowner AND NOT (p.proname='team_hub_stage_agent_read_context' AND a.grantee='service_role'::regrole)
     AND NOT (p.proname='team_hub_search' AND a.grantee='authenticated'::regrole)))
   OR (p.proname='team_hub_stage_agent_read_context' AND NOT has_function_privilege('service_role',p.oid,'EXECUTE'))
   OR (p.proname='team_hub_search' AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')) THEN
   RAISE EXCEPTION 'Original Planning dependency metadata drift: %',sig; END IF;
  src:=p.prosrc; metadata:=to_jsonb(p)-'prosrc';
  -- Only parser positions in the existing default's AST may move on re-emission.
  -- Its actual default20, argument names/types and every other field stay exact.
  IF p.proname='team_hub_search' THEN metadata:=jsonb_set(metadata,'{proargdefaults}',
   to_jsonb(regexp_replace(p.proargdefaults::text,':location -?[0-9]+',':location -1','g'))); END IF;
  replaced:=src;
  -- Inverse first: a replay must be the complete exact approved transform.
  FOR i IN REVERSE array_length(originals,1)..1 LOOP replaced:=replace(replaced,additions[i],originals[i]); END LOOP;
  IF md5(replaced)<>old THEN RAISE EXCEPTION 'Original Planning dependency drift: %',sig; END IF;
  FOR i IN 1..array_length(originals,1) LOOP
   IF cardinality(string_to_array(replaced,originals[i]))<>2 THEN RAISE EXCEPTION 'Planning hunk count drift: %',sig; END IF;
   replaced:=replace(replaced,originals[i],additions[i]);
  END LOOP;
  IF src<>replaced THEN
   SELECT pg_get_functiondef(to_regprocedure(sig)) INTO src;
   n:=strpos(src,'AS $function$');
   IF n=0 THEN RAISE EXCEPTION 'Original function delimiter drift'; END IF;
   EXECUTE left(src,n-1)||'AS $function$'||replaced||'$function$';
  END IF;
  SELECT to_jsonb(r)-'prosrc' INTO after_metadata FROM pg_catalog.pg_proc r WHERE r.oid=p.oid;
  IF p.proname='team_hub_search' THEN after_metadata:=jsonb_set(after_metadata,'{proargdefaults}',
   to_jsonb(regexp_replace(after_metadata->>'proargdefaults',':location -?[0-9]+',':location -1','g'))); END IF;
  IF after_metadata IS DISTINCT FROM metadata THEN
   RAISE EXCEPTION 'Original Planning metadata changed: %',sig; END IF;
 END LOOP;
END $patch$;
COMMIT;
