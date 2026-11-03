-- Forward-only EXP05 Calendar source binding; original E13 lower release precedes this file.
-- Exact candidate source is verified by the owning full-schema proof.
-- INERT EXP05 Calendar admission preparation, not a production migration.
-- Original caller-JWT Calendar remains the only data reader. These private
-- validators bind its result to the SAME accepted Team Hub turn before model
-- disclosure. No public RPC, registry, provider, scheduler or writer is added.
BEGIN;
SET LOCAL lock_timeout='2s';

DO $private$
DECLARE sig text; expected text; p pg_catalog.pg_proc;
BEGIN
 FOR sig,expected IN SELECT * FROM (VALUES
 ('public._team_hub_calendar_read_source(public.team_hub_agent_turns,jsonb)','ee9d36e80dc82a9007c378cfddaed3e0'),
 ('public._team_hub_assert_calendar_read(public.team_hub_agent_turns)','29c6b183c83a818f66f77f0de39e67a8'),
 ('public._team_hub_stage_calendar_read(public.team_hub_agent_turns,jsonb)','37e421cc443037fa0c46e5069e0175cb')) v(sig,expected) LOOP
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(sig);
 IF FOUND AND (md5(p.prosrc)<>expected OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.provolatile<>'v' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR p.proacl IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee<>p.proowner
     OR a.is_grantable OR a.privilege_type<>'EXECUTE')) THEN
  RAISE EXCEPTION 'Original Calendar private dependency drift: %',sig; END IF;
 END LOOP;
END $private$;

CREATE OR REPLACE FUNCTION public._team_hub_calendar_read_source(t public.team_hub_agent_turns,a jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE f timestamptz; z timestamptz; r record; rows jsonb:='[]'; ids jsonb:='[]'; n integer:=0;
BEGIN
 IF t.agent_key<>'zion' OR jsonb_typeof(a) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM jsonb_object_keys(a))<>3
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(a) k WHERE k NOT IN ('from','to','view'))
  OR a->>'view' NOT IN ('mine','team') OR jsonb_typeof(a->'view') IS DISTINCT FROM 'string'
  OR EXISTS(SELECT 1 FROM (VALUES('from'),('to')) k(key) WHERE jsonb_typeof(a->k.key) IS DISTINCT FROM 'string'
    OR a->>k.key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
  OR coalesce((SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(
    'public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid)')),'')<>'6ec4ba377abfe348192cdf17bb973869'
  OR NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.user_id=t.asker_user_id AND m.tenant_id=t.tenant_id
    AND m.status='active' AND m.role IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Original Calendar source scope unavailable' USING ERRCODE='42501'; END IF;
 f:=(a->>'from')::timestamptz; z:=(a->>'to')::timestamptz;
 IF z<=f OR z-f>interval '32 days'
  OR to_char(f AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>a->>'from'
  OR to_char(z AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>a->>'to' THEN
  RAISE EXCEPTION 'Invalid Calendar window' USING ERRCODE='42501'; END IF;
 -- The original SOLO owner/admin admission makes the original reader's _team
 -- predicate true. Keep its tenant/window/host filters and the original host
 -- projector's class-seat/end-bound/order/51-row probe. Never set JWT claims.
 FOR r IN SELECT b.* FROM public.internal_bookings b WHERE b.tenant_id=t.tenant_id
   AND b.start_at<z AND b.end_at>f AND b.booking_kind<>'class_seat'
   AND (a->>'view'='team' OR b.host_user_id=t.asker_user_id)
   ORDER BY b.start_at,b.id LIMIT 51 FOR SHARE OF b
 LOOP
  n:=n+1; IF n>50 THEN EXIT; END IF;
  IF r.host_user_id IS NULL OR r.title IS NULL OR length(r.title)>2048 OR r.start_at IS NULL OR r.end_at<=r.start_at
   OR r.timezone IS NULL OR length(r.timezone) NOT BETWEEN 1 AND 128
   OR r.status IS NULL OR length(r.status) NOT BETWEEN 1 AND 64
   OR r.booking_kind NOT IN ('single','collective','class_session') THEN
   RAISE EXCEPTION 'Original Calendar source invalid' USING ERRCODE='42501'; END IF;
  ids:=ids||jsonb_build_array(r.id);
  rows:=rows||jsonb_build_array(jsonb_build_object('id',r.id,'host_user_id',r.host_user_id,
   'title_preview',left(r.title,120),'title_truncated',length(r.title)>120,
   'start_at',to_char(r.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'end_at',to_char(r.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'timezone',r.timezone,'status',r.status,'booking_kind',r.booking_kind));
 END LOOP;
 RETURN jsonb_build_object('bookings',rows,'source_ids',ids,'source_shown_count',least(n,50),'source_has_more',n>50);
END $fn$;
REVOKE ALL ON FUNCTION public._team_hub_calendar_read_source(public.team_hub_agent_turns,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._team_hub_assert_calendar_read(t public.team_hub_agent_turns)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE b jsonb:=t.read_context->'calendar'; o jsonb; source jsonb; ref jsonb; config jsonb;
BEGIN
 SELECT s.config INTO config FROM public.paige_subagents s WHERE s.tenant_id IS NULL AND s.slug='zion' FOR SHARE;
 IF t.agent_key<>'zion' OR jsonb_typeof(b) IS DISTINCT FROM 'object' OR b->'version' IS DISTINCT FROM '1'::jsonb
  OR b->'roster_tools' IS DISTINCT FROM config#>'{capability_scope,tools}'
  OR jsonb_typeof(b->'observations') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'observations') NOT BETWEEN 1 AND 3
  OR jsonb_typeof(b->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'ids')>150 THEN
  RAISE EXCEPTION 'Original Calendar binding unavailable' USING ERRCODE='42501'; END IF;
 IF t.consumed_at IS NULL THEN
  FOR o IN SELECT value FROM jsonb_array_elements(b->'observations') LOOP
   source:=public._team_hub_calendar_read_source(t,o->'arguments');
   IF o->>'digest' IS DISTINCT FROM encode(sha256(convert_to(source::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Original Calendar source changed' USING ERRCODE='42501'; END IF;
  END LOOP;
 ELSE
  -- Historical text may reflect a legitimate later edit. It remains visible
  -- only while the original actor can inspect every referenced native record.
  FOR ref IN SELECT value FROM jsonb_array_elements(b->'ids') LOOP
   PERFORM 1 FROM public.internal_bookings b WHERE b.id=(ref#>>'{}')::uuid AND b.tenant_id=t.tenant_id
    AND b.booking_kind<>'class_seat' FOR SHARE OF b;
   IF NOT FOUND THEN RAISE EXCEPTION 'Original Calendar record unavailable' USING ERRCODE='42501'; END IF;
  END LOOP;
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION public._team_hub_assert_calendar_read(public.team_hub_agent_turns) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._team_hub_stage_calendar_read(t public.team_hub_agent_turns,input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE d jsonb; source jsonb; supplied jsonb; b jsonb:=t.read_context->'calendar'; o jsonb; obs jsonb; digest text; ids jsonb; row_index integer;
BEGIN
 IF t.read_context->>'token_hash' IS DISTINCT FROM t.token_hash THEN b:=NULL; END IF;
 IF b IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(input) WHERE value->>'tool'='read_calendar_agenda') THEN RETURN NULL; END IF;
 PERFORM public._sales_invoice_actor(t.asker_user_id,t.tenant_id);
 IF b IS NOT NULL THEN PERFORM public._team_hub_assert_agent_read_scope(t); END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(input) WHERE value->>'tool'='read_calendar_agenda' LOOP
  IF t.agent_key<>'zion' OR (SELECT count(*) FROM jsonb_object_keys(d))<>5
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('tool','version','arguments','source','roster_tools'))
   OR d->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(d->'roster_tools') IS DISTINCT FROM 'array'
   OR jsonb_array_length(d->'roster_tools')>64 OR d->'roster_tools' IS DISTINCT FROM (
    SELECT s.config#>'{capability_scope,tools}' FROM public.paige_subagents s WHERE s.tenant_id IS NULL AND s.slug='zion') THEN
   RAISE EXCEPTION 'Invalid original Calendar binding' USING ERRCODE='42501'; END IF;
  source:=public._team_hub_calendar_read_source(t,d->'arguments'); supplied:=d->'source';
  IF jsonb_typeof(supplied) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(supplied))<>7
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(supplied) k WHERE k NOT IN ('bookings','source_ids','source_shown_count',
    'source_has_more','shown_count','omitted_from_model','has_more'))
   OR supplied->'source_ids' IS DISTINCT FROM source->'source_ids'
   OR supplied->'source_shown_count' IS DISTINCT FROM source->'source_shown_count'
   OR supplied->'source_has_more' IS DISTINCT FROM source->'source_has_more'
   OR jsonb_typeof(supplied->'bookings') IS DISTINCT FROM 'array'
   OR jsonb_array_length(supplied->'bookings')>jsonb_array_length(source->'bookings') THEN
   RAISE EXCEPTION 'Original Calendar source changed' USING ERRCODE='42501'; END IF;
  row_index:=0;
  FOR o IN SELECT value FROM jsonb_array_elements(supplied->'bookings') LOOP
   IF jsonb_typeof(o) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(o))<>9
    OR jsonb_typeof(o->'start_at') IS DISTINCT FROM 'string' OR jsonb_typeof(o->'end_at') IS DISTINCT FROM 'string'
    OR o->>'start_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' OR o->>'end_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    OR (o||jsonb_build_object('start_at',to_char((o->>'start_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'end_at',to_char((o->>'end_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) IS DISTINCT FROM source->'bookings'->row_index THEN
    RAISE EXCEPTION 'Original Calendar preview changed' USING ERRCODE='42501'; END IF;
   row_index:=row_index+1;
  END LOOP;
  IF supplied->'shown_count' IS DISTINCT FROM to_jsonb(row_index)
   OR supplied->'omitted_from_model' IS DISTINCT FROM to_jsonb(jsonb_array_length(source->'bookings')-row_index)
   OR supplied->'has_more' IS DISTINCT FROM to_jsonb((source->>'source_has_more')::boolean OR row_index<jsonb_array_length(source->'bookings')) THEN
   RAISE EXCEPTION 'Original Calendar coverage changed' USING ERRCODE='42501'; END IF;
  digest:=encode(sha256(convert_to(source::text,'UTF8')),'hex'); obs:=coalesce(b->'observations','[]');
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(obs) known WHERE known->'arguments'=d->'arguments' AND known->>'digest'=digest) THEN
   obs:=obs||jsonb_build_array(jsonb_build_object('arguments',d->'arguments','digest',digest)); END IF;
  SELECT coalesce(jsonb_agg(DISTINCT r ORDER BY r),'[]') INTO ids FROM (
   SELECT value r FROM jsonb_array_elements(coalesce(b->'ids','[]')) UNION ALL
   SELECT value FROM jsonb_array_elements(source->'source_ids')) x;
  IF jsonb_array_length(obs)>3 OR jsonb_array_length(ids)>150 THEN
   RAISE EXCEPTION 'Calendar source exceeds bounded turn' USING ERRCODE='42501'; END IF;
  b:=jsonb_build_object('version',1,'roster_tools',d->'roster_tools','observations',obs,'ids',ids);
 END LOOP;
 RETURN b;
END $fn$;
REVOKE ALL ON FUNCTION public._team_hub_stage_calendar_read(public.team_hub_agent_turns,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE sig text; old text; replacement text; p pg_catalog.pg_proc; before_metadata jsonb; after_metadata jsonb; definition text;
BEGIN
 FOR sig,old,replacement IN SELECT * FROM (VALUES
 ('public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)','b92f4236bb2ef1e4bb01c584d0645ba7',$source$
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
  -- EXP05 Planning: same accepted token, current versions before publication.
  IF tools ? 'plan_list' OR t.read_context ? 'planning' THEN
   IF t.agent_key<>'zion' OR NOT (tools ? 'plan_list') THEN
    RAISE EXCEPTION 'Planning source requires original ZION DM' USING ERRCODE='42501'; END IF;
   PERFORM public._team_hub_assert_planning_read(t);
  END IF;
  -- EXP05 Calendar: original native records, same accepted turn and total budget.
  IF tools ? 'read_calendar_agenda' OR t.read_context ? 'calendar' THEN
   IF t.agent_key<>'zion' OR NOT (tools ? 'read_calendar_agenda') THEN
    RAISE EXCEPTION 'Calendar source requires original ZION DM' USING ERRCODE='42501'; END IF;
   PERFORM public._team_hub_assert_calendar_read(t);
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(tools) LOOP
   IF jsonb_typeof(item)<>'string' OR NOT (CASE t.agent_key
    WHEN 'paige' THEN item#>>'{}' IN ('crm_list_tasks','crm_get_task','crm_list_team','growth_list')
    WHEN 'zion' THEN item#>>'{}' IN ('crm_list_tasks','crm_get_task','crm_list_team','plan_list','read_calendar_agenda')
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
END $source$),
 ('public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','954b3df7f801aaf0d0eb726f0a3b10e5',$source$
DECLARE t public.team_hub_agent_turns; link jsonb; links jsonb:='[]'::jsonb; dest text; ref uuid; planning jsonb; tools jsonb; calendar jsonb; planning_input jsonb;
BEGIN
 IF p_turn_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
   OR jsonb_typeof(p_read_tools) IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_read_tools) NOT BETWEEN 1 AND 3
   OR jsonb_typeof(p_record_links) IS DISTINCT FROM 'array' OR jsonb_array_length(p_record_links)>6 THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO t FROM public.team_hub_agent_turns a WHERE a.id=p_turn_id
  AND a.token_hash=p_token_hash AND a.consumed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 -- EXP05 Planning: typed source binding is service-only, never JSON authority.
 calendar:=public._team_hub_stage_calendar_read(t,p_read_tools);
 SELECT coalesce(jsonb_agg(value),'[]') INTO planning_input FROM jsonb_array_elements(p_read_tools)
  WHERE jsonb_typeof(value)<>'object' OR value->>'tool' IS DISTINCT FROM 'read_calendar_agenda';
 planning:=public._team_hub_stage_planning_read(t,planning_input);
 IF planning IS NOT NULL OR calendar IS NOT NULL THEN
  SELECT jsonb_agg(DISTINCT tool ORDER BY tool) INTO tools FROM (
   SELECT CASE WHEN jsonb_typeof(value)='object' AND value->>'tool' IN ('plan_list','read_calendar_agenda') THEN value->'tool' ELSE value END tool
    FROM jsonb_array_elements(p_read_tools)
   UNION ALL SELECT value FROM jsonb_array_elements(CASE WHEN t.read_context->>'token_hash'=t.token_hash
    THEN coalesce(t.read_context->'tools','[]') ELSE '[]'::jsonb END)) x;
  IF jsonb_array_length(tools)>3 THEN RAISE EXCEPTION 'Private read budget exceeded' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(value),'[]') INTO links FROM jsonb_array_elements(CASE WHEN t.read_context->>'token_hash'=t.token_hash
   THEN coalesce(t.read_context->'record_links','[]') ELSE '[]'::jsonb END)
   WHERE value->>'record_kind'='planning_item' OR value->>'destination'='calendar';
 ELSE tools:=p_read_tools; END IF;
 FOR link IN SELECT value FROM jsonb_array_elements(p_record_links) LOOP
  IF jsonb_typeof(link) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(link) k
    WHERE k NOT IN ('destination','record_id','subject','record_kind'))
   OR (link ? 'record_kind' AND (link->>'record_kind' IS DISTINCT FROM 'planning_item'
    OR link->>'destination' IS DISTINCT FROM 'operations_work' OR jsonb_typeof(link->'record_id') IS DISTINCT FROM 'string'))
   THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  dest:=link->>'destination'; ref:=NULL;
  IF dest IS NULL OR dest NOT IN ('contacts','sales_agreements','sales_invoices','sales_collections','operations_work','business_time_zone','executive','calendar')
    OR NOT (link ? 'record_id') OR jsonb_typeof(link->'record_id') NOT IN ('string','null') THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  IF dest='calendar' AND (calendar IS NULL OR jsonb_typeof(link->'record_id') IS DISTINCT FROM 'null') THEN
   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  IF jsonb_typeof(link->'record_id')='string' THEN
   IF link->>'record_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
   ref:=(link->>'record_id')::uuid;
   IF NOT (CASE dest
    WHEN 'contacts' THEN EXISTS(SELECT 1 FROM public.clients r WHERE r.id=ref AND r.tenant_id=t.tenant_id)
    WHEN 'sales_agreements' THEN EXISTS(SELECT 1 FROM public.paige_agreements r WHERE r.id=ref AND r.tenant_id=t.tenant_id)
    WHEN 'sales_invoices' THEN EXISTS(SELECT 1 FROM public.paige_invoices r WHERE r.id=ref AND r.tenant_id=t.tenant_id)
    WHEN 'operations_work' THEN link->>'record_kind'='planning_item' AND planning IS NOT NULL
     AND planning->'items' @> jsonb_build_array(ref)
    ELSE false END) THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  END IF;
  -- Labels are built by the existing UI. Store only references, never copied customer text/URLs.
  links:=links||jsonb_build_array(jsonb_build_object('destination',dest,'record_id',ref)
   || CASE WHEN link ? 'record_kind' THEN jsonb_build_object('record_kind','planning_item') ELSE '{}'::jsonb END);
 END LOOP;
 IF planning IS NOT NULL OR calendar IS NOT NULL THEN
  SELECT coalesce(jsonb_agg(value ORDER BY value),'[]') INTO links FROM (
   SELECT DISTINCT value FROM jsonb_array_elements(links) ORDER BY value LIMIT 6) bounded;
 END IF;
 t.read_context:=jsonb_build_object('token_hash',p_token_hash,'tools',tools,'record_links',links,
   'expires_at',clock_timestamp()+interval '2 minutes');
 IF planning IS NOT NULL THEN t.read_context:=t.read_context||jsonb_build_object('planning',planning); END IF;
 IF calendar IS NOT NULL THEN t.read_context:=t.read_context||jsonb_build_object('calendar',calendar); END IF;
 PERFORM public._team_hub_assert_agent_read_scope(t);
 -- Known pre-update capacity refusal: the original stored context is untouched.
 -- All proposed bindings/authority were checked; unknown errors still raise.
 IF octet_length(t.read_context::text)>8192 THEN
  RETURN jsonb_build_object('ok',false,'code','context_limit'); END IF;
 UPDATE public.team_hub_agent_turns a SET read_context=t.read_context WHERE a.id=t.id;
 RETURN jsonb_build_object('ok',true);
END $source$),
 ('public._team_hub_planning_read_annotations(public.team_hub_agent_turns)','4e6ea1c3dfc9355d366e10e88807f019',$source$
DECLARE b jsonb:=t.read_context->'planning'; tools jsonb:=t.read_context->'tools';
 config jsonb; ch public.team_hub_channels; item jsonb; staff boolean; calendar jsonb:=t.read_context->'calendar';
BEGIN
 -- Exact original native policies underpin this projection. Unknown changes
 -- fail closed rather than silently retaining an obsolete authority predicate.
 IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proowner='postgres'::regrole AND (
   (p.oid=to_regprocedure('public._sales_invoice_actor(uuid,uuid)') AND md5(p.prosrc)='27202521ef9750d3246ee5e5e11018aa') OR
   (p.oid=to_regprocedure('public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)') AND md5(p.prosrc)='b5f07681ee7e96548b77e61d71106639') OR
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
  OR coalesce(config#>>'{capability_scope,access}','') NOT IN ('read','card')
  OR jsonb_typeof(config#>'{capability_scope,tools}') IS DISTINCT FROM 'array'
  OR jsonb_typeof(tools) IS DISTINCT FROM 'array' OR jsonb_array_length(tools) NOT BETWEEN 1 AND 3
  OR ((tools ? 'plan_list') IS DISTINCT FROM (b IS NOT NULL))
  OR (b IS NOT NULL AND (jsonb_typeof(b) IS DISTINCT FROM 'object'
  OR b->>'version' IS DISTINCT FROM '1' OR b->'roster_tools' IS DISTINCT FROM config#>'{capability_scope,tools}'
  OR jsonb_typeof(b->'observations') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'observations') NOT BETWEEN 1 AND 3
  OR jsonb_typeof(b->'plans') IS DISTINCT FROM 'array' OR jsonb_typeof(b->'items') IS DISTINCT FROM 'array'
  OR jsonb_array_length(b->'plans')+jsonb_array_length(b->'items')>120))
  OR ((tools ? 'read_calendar_agenda') IS DISTINCT FROM (calendar IS NOT NULL))
  OR (calendar IS NOT NULL AND (jsonb_typeof(calendar) IS DISTINCT FROM 'object' OR calendar->'version' IS DISTINCT FROM '1'::jsonb
    OR calendar->'roster_tools' IS DISTINCT FROM config#>'{capability_scope,tools}'
    OR jsonb_typeof(calendar->'observations') IS DISTINCT FROM 'array' OR jsonb_array_length(calendar->'observations') NOT BETWEEN 1 AND 3
    OR jsonb_typeof(calendar->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(calendar->'ids')>150
    OR coalesce((SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(
     'public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid)')),'')<>'6ec4ba377abfe348192cdf17bb973869')) THEN
  RAISE EXCEPTION 'Original Planning history source unavailable' USING ERRCODE='42501'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(tools) LOOP
  IF jsonb_typeof(item)<>'string' OR NOT (config#>'{capability_scope,tools}' @> jsonb_build_array(item))
   OR item#>>'{}' NOT IN ('crm_list_tasks','crm_get_task','crm_list_team','plan_list','read_calendar_agenda') THEN
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
 -- Read-only history: no mutation lock, original owner/admin scope was checked
 -- above; all original Calendar references remain in the same tenant.
 FOR item IN SELECT value FROM jsonb_array_elements(calendar->'ids') LOOP
  IF NOT EXISTS(SELECT 1 FROM public.internal_bookings b WHERE b.id=(item#>>'{}')::uuid AND b.tenant_id=t.tenant_id
    AND b.booking_kind<>'class_seat') THEN
   RAISE EXCEPTION 'Original Calendar record unavailable' USING ERRCODE='42501'; END IF;
 END LOOP;
 RETURN '{}'::jsonb;
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('body','This Operations reply is unavailable because access to its original records could not be verified. Return to Operations to review the current records.',
  'source_backed_read',false,'paige_record_links','[]'::jsonb,'source_unavailable',true);
END $source$),
 ('public._team_hub_agent_read_annotations(uuid)','c0f1fc1451a8bc871b3c0b11c54b6091',$source$
 SELECT coalesce((SELECT jsonb_build_object('source_backed_read',true,'paige_record_links',t.read_context->'record_links')
   || CASE WHEN t.read_context ? 'planning' OR t.read_context ? 'calendar' THEN public._team_hub_planning_read_annotations(t) ELSE '{}'::jsonb END
  FROM public.team_hub_agent_turns t WHERE t.posted_message_id=p_message AND t.consumed_at IS NOT NULL
   AND t.read_context->>'token_hash'=t.token_hash LIMIT 1),'{}'::jsonb)
$source$)) v(sig,old,replacement) LOOP
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(sig);
 IF p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.proargmodes IS NOT NULL OR p.prorettype NOT IN ('void'::regtype,'jsonb'::regtype)
  OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
  OR p.provariadic<>0 OR p.pronargdefaults<>0 OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language
   WHERE lanname=CASE WHEN p.proname='_team_hub_agent_read_annotations' THEN 'sql' ELSE 'plpgsql' END)
  OR (sig LIKE '%_agent_read_annotations(uuid)' AND (p.prosecdef OR p.provolatile<>'s'))
  OR (sig LIKE '%_planning_read_annotations(%' AND (NOT p.prosecdef OR p.provolatile<>'s'))
  OR (sig NOT LIKE '%annotations(%' AND (NOT p.prosecdef OR p.provolatile<>'v'))
  OR p.proacl IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
   WHERE a.is_grantable OR a.privilege_type<>'EXECUTE' OR (a.grantee<>p.proowner AND
    NOT (p.proname='team_hub_stage_agent_read_context' AND a.grantee='service_role'::regrole))) THEN
  RAISE EXCEPTION 'Original Calendar dependency metadata drift: %',sig; END IF;
 IF p.proname='team_hub_stage_agent_read_context' AND NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN
  RAISE EXCEPTION 'Original Calendar stage unavailable'; END IF;
 IF md5(p.prosrc)<>old AND p.prosrc<>replacement THEN RAISE EXCEPTION 'Original Calendar dependency source drift: %',sig; END IF;
 before_metadata:=to_jsonb(p)-'prosrc';
 IF p.prosrc<>replacement THEN
  definition:=pg_catalog.pg_get_functiondef(p.oid);
  IF length(definition)-length(replace(definition,p.prosrc,''))<>length(p.prosrc) THEN
   RAISE EXCEPTION 'Original Calendar body occurrence drift'; END IF;
  EXECUTE replace(definition,p.prosrc,replacement);
 END IF;
 SELECT to_jsonb(r)-'prosrc' INTO after_metadata FROM pg_catalog.pg_proc r WHERE r.oid=p.oid;
 IF before_metadata IS DISTINCT FROM after_metadata OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc r WHERE r.oid=p.oid AND r.prosrc=replacement) THEN
  RAISE EXCEPTION 'Original Calendar metadata changed: %',sig; END IF;
 END LOOP;
END $patch$;
COMMIT;
