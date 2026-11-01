-- Runs AFTER every assertion/mutant in original E08 A2b proof, never production.
RESET ROLE;
SELECT set_config('request.jwt.claims','',false);
DO $$ BEGIN IF current_database()<>'exp08_team_hub_a2b_proof' THEN
 RAISE EXCEPTION 'Original disposable E08 fixture only'; END IF; END $$;
\ir fixtures/exp05-zion-planning-original.sql
\if :{?exp05_native_red}
SELECT pg_temp.check(to_regprocedure('public._team_hub_planning_read_source(public.team_hub_agent_turns,jsonb)') IS NOT NULL,
 'EXP05 missing original native Planning source contract');
\endif
CREATE FUNCTION pg_temp.exp05_metadata(p pg_proc) RETURNS jsonb LANGUAGE sql AS $$
 SELECT CASE WHEN p.proname='team_hub_search' THEN jsonb_set(to_jsonb(p)-'prosrc','{proargdefaults}',
  to_jsonb(regexp_replace(p.proargdefaults::text,':location -?[0-9]+',':location -1','g'))) ELSE to_jsonb(p)-'prosrc' END $$;
CREATE TEMP TABLE exp05_before AS SELECT oid,pg_temp.exp05_metadata(p) AS metadata,prosrc FROM pg_proc p WHERE pronamespace='public'::regnamespace;
\ir ../../scripts/proof/exp05-zion-planning-read-candidate.sql
CREATE TEMP TABLE exp05_after AS SELECT oid,to_jsonb(p) AS full FROM pg_proc p WHERE pronamespace='public'::regnamespace;
\ir ../../scripts/proof/exp05-zion-planning-read-candidate.sql
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM exp05_after b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.full IS DISTINCT FROM to_jsonb(p)),
 'EXP05 exact replay retains every public function body, OID, ABI, owner, ACL and metadata');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM exp05_before b LEFT JOIN pg_proc p USING(oid)
 WHERE b.metadata IS DISTINCT FROM pg_temp.exp05_metadata(p) OR (b.prosrc<>p.prosrc AND p.proname NOT IN (
 '_team_hub_assert_agent_read_scope','team_hub_stage_agent_read_context','_team_hub_agent_read_annotations','team_hub_search'))),
 'EXP05 every incumbent metadata and outside-owned body remains exact');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
 WHERE p.proname IN ('_team_hub_planning_read_source','_team_hub_planning_source_versions','_team_hub_assert_planning_read',
 '_team_hub_stage_planning_read','_team_hub_planning_read_annotations') AND a.grantee<>p.proowner)
 AND NOT has_function_privilege('authenticated','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE')
 AND has_function_privilege('service_role','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE'),
 'EXP05 validation helpers private, original stage service-only; no browser grant');
\echo 'PASS: EXP05 native additive source, metadata, private ACL and exact replay'
\set exp05patch `sed -n '/^DO \$patch\$/,/^END \$patch\$;/p' scripts/proof/exp05-zion-planning-read-candidate.sql`
BEGIN;
GRANT EXECUTE ON FUNCTION public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb) TO authenticated;
SELECT pg_temp.check(pg_temp.try(:'exp05patch') LIKE 'Original Planning dependency metadata drift:%',
 'EXP05 widened stage ACL refuses candidate replay');
ROLLBACK;
BEGIN;
SELECT pg_temp.mutate('public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)','BEGIN',E'BEGIN\n -- unknown drift');
SELECT pg_temp.check(pg_temp.try(:'exp05patch') LIKE 'Original Planning dependency drift:%',
 'EXP05 unknown guard source refuses candidate replay');
ROLLBACK;

BEGIN;
UPDATE public.tenant_members SET role='admin',status='active' WHERE tenant_id=:'ta'::uuid AND user_id=:'u3'::uuid;
INSERT INTO public.plans(id,tenant_id,created_by,owner_user_id,title) VALUES
 ('e5000000-0000-4000-8000-000000000001',:'ta',:'u3',:'u3','PRIVATE original plan'),
 ('e5000000-0000-4000-8000-000000000002',:'tb',:'u3',:'u3','FOREIGN plan'),
 ('e5000000-0000-4000-8000-000000000003',:'ta',:'u2',:'u2','Other owner private plan');
INSERT INTO public.plan_items(id,tenant_id,plan_id,item_type,created_by,assigned_to_user_id,title,updated_at) VALUES
 ('e5000000-0000-4000-8000-000000000011',:'ta','e5000000-0000-4000-8000-000000000001','task',:'u3',:'u3','PRIVATE original item','2026-11-01T00:00:00.123456Z'),
 ('e5000000-0000-4000-8000-000000000012',:'tb','e5000000-0000-4000-8000-000000000002','task',:'u3',:'u3','FOREIGN item',now()),
 ('e5000000-0000-4000-8000-000000000013',:'ta',NULL,'task',:'u3',:'u3','PRIVATE loose item',now());
SELECT pg_temp.j(:'u3',format('public.team_hub_open_agent_dm(%L::uuid,''zion'')',:'ta'))->>'channel_id' AS e5dm \gset
SELECT pg_temp.post(:'u3',:'ta',:'e5dm','Review my original weekly work')->'message'->>'id' AS e5q \gset
SELECT pg_temp.accept(:'ta',:'u3',:'e5dm',:'e5q','zion','dm',pg_temp.tok('E5')) AS e5accepted \gset
SELECT pg_temp.check((:'e5accepted')::jsonb->>'ok'='true','EXP05 original accepted ZION turn');
CREATE FUNCTION pg_temp.planning_binding(actor text,tenant text,args jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE a jsonb; raw jsonb; source jsonb;
BEGIN
 a:=jsonb_build_object('horizon',NULL,'plan_id',NULL,'status',NULL,'include_cancelled',false,
  'assigned_to_user_id',NULL,'from',NULL,'to',NULL,'limit',30)||args;
 raw:=pg_temp.j(actor,format('public.plan_list(%L,%L::uuid,%L,%L::uuid,%L::date,%L::date,%L::integer,%L::uuid,NULL,false,%L::boolean)',
  a->>'horizon',a->>'plan_id',a->>'status',a->>'assigned_to_user_id',a->>'from',a->>'to',a->>'limit',tenant,a->>'include_cancelled'));
 SELECT jsonb_build_object('plans',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p->'id','updated_at',p->'updated_at',
  'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i->'id','updated_at',i->'updated_at')),'[]') FROM jsonb_array_elements(p->'items') i)))
  FROM jsonb_array_elements(raw->'plans') p),'[]'),'loose_items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i->'id','updated_at',i->'updated_at'))
   FROM (SELECT value i FROM jsonb_array_elements(raw->'loose_items') WITH ORDINALITY AS e(value,n) WHERE n<=30) x),'[]')) INTO source;
 RETURN jsonb_build_object('tool','plan_list','version',1,'arguments',a,'source',source,'roster_tools',
  (SELECT config#>'{capability_scope,tools}' FROM public.paige_subagents WHERE tenant_id IS NULL AND slug='zion'));
END $$;
CREATE FUNCTION pg_temp.planning_filter_parity(actor text,tenant text,turn_id text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE args jsonb; binding jsonb; t public.team_hub_agent_turns; n integer:=0;
BEGIN
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE id=turn_id::uuid;
 FOR args IN SELECT value FROM jsonb_array_elements('[{}, {"limit":1}, {"limit":2}, {"limit":30},
  {"horizon":"week"},{"horizon":"month"},{"horizon":"quarter"},{"horizon":"semiannual"},{"horizon":"year"},{"horizon":"custom"},
  {"status":"active"},{"status":"open"},{"status":"done"},{"status":"cancelled","include_cancelled":true},
  {"include_cancelled":true},{"from":"2026-11-02"},{"to":"2026-10-31"},{"from":"2026-11-01","to":"2026-11-07"},
  {"plan_id":"e5000000-0000-4000-8000-000000000002"},
  {"plan_id":"e5000000-0000-4000-8000-000000000001"}]'::jsonb) LOOP
  binding:=pg_temp.planning_binding(actor,tenant,args);
  PERFORM pg_temp.check(public._team_hub_planning_read_source(t,binding->'arguments')=
   public._team_hub_planning_source_versions(binding->'source'),'EXP05 validation projection matches original caller query: '||args::text);
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
CREATE FUNCTION pg_temp.planning_stage(turn text,token text,binding jsonb,links jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
 turn,pg_temp.h(token),jsonb_build_array(binding),links),'service_role') $$;
SELECT pg_temp.check(pg_temp.planning_filter_parity(:'u3',:'ta',(:'e5accepted')::jsonb->>'turn_id')=20,
 'EXP05 twenty bounded filter/version projections match the actual original caller-JWT reader');
SELECT pg_temp.planning_binding(:'u3',:'ta') AS e5binding \gset
SELECT pg_temp.planning_stage((:'e5accepted')::jsonb->>'turn_id',pg_temp.tok('E5'),(:'e5binding')::jsonb,
 '[{"destination":"operations_work","record_id":"e5000000-0000-4000-8000-000000000011","record_kind":"planning_item"}]') AS e5staged \gset
SELECT pg_temp.check((:'e5staged')::jsonb->>'ok'='true','EXP05 native stage accepts exact caller-JWT original versions: '||:'e5staged');
SELECT pg_temp.check((SELECT read_context#>>'{planning,version}'='1' AND jsonb_array_length(read_context#>'{planning,observations}')=1
 AND octet_length(read_context::text)<=8192 AND read_context::text NOT LIKE '%PRIVATE%'
 FROM public.team_hub_agent_turns WHERE id=((:'e5accepted')::jsonb->>'turn_id')::uuid),
 'EXP05 same original turn stores bounded source references, no copied text');
SELECT pg_temp.check(pg_temp.planning_stage((:'e5accepted')::jsonb->>'turn_id',pg_temp.tok('E5'),(:'e5binding')::jsonb)->>'ok'='true'
 AND (SELECT jsonb_array_length(read_context#>'{planning,observations}')=1 FROM public.team_hub_agent_turns
 WHERE id=((:'e5accepted')::jsonb->>'turn_id')::uuid),'EXP05 same source revalidation is deduplicated');
SELECT pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,''["crm_list_tasks"]'',''[]'')',
 (:'e5accepted')::jsonb->>'turn_id',pg_temp.h(pg_temp.tok('E5'))),'service_role') AS e5mixed \gset
SELECT pg_temp.check((:'e5mixed')::jsonb->>'ok'='true'
 AND (SELECT read_context ? 'planning' AND read_context->'tools' @> '["plan_list","crm_list_tasks"]'
 AND read_context->'record_links' @> '[{"destination":"operations_work","record_id":"e5000000-0000-4000-8000-000000000011","record_kind":"planning_item"}]'
 FROM public.team_hub_agent_turns WHERE id=((:'e5accepted')::jsonb->>'turn_id')::uuid),
 'EXP05 later incumbent CRM stage retains original Planning source context');

-- Each failed boundary leaves the original staged turn unchanged.
CREATE TEMP TABLE exp05_staged AS SELECT * FROM public.team_hub_agent_turns WHERE id=((:'e5accepted')::jsonb->>'turn_id')::uuid;
SAVEPOINT e5_rearm;
UPDATE public.team_hub_agent_turns SET read_context=jsonb_set(read_context,'{expires_at}',to_jsonb(clock_timestamp()-interval '1 second'))
 WHERE id=((:'e5accepted')::jsonb->>'turn_id')::uuid;
SELECT pg_temp.j(NULL,format('public.team_hub_end_agent_turn(%L::uuid,%L)',
 (:'e5accepted')::jsonb->>'turn_id',pg_temp.h(pg_temp.tok('E5'))),'service_role') AS e5ended \gset
SELECT pg_temp.accept(:'ta',:'u3',:'e5dm',:'e5q','zion','dm',pg_temp.tok('E5-rearm')) AS e5rearmed \gset
UPDATE public.plan_items SET updated_at=clock_timestamp() WHERE id='e5000000-0000-4000-8000-000000000011';
SELECT pg_temp.planning_binding(:'u3',:'ta') AS e5freshbinding \gset
SELECT pg_temp.check((:'e5ended')::jsonb->>'ok'='true' AND (:'e5rearmed')::jsonb->>'rearmed'='true'
 AND (:'e5rearmed')::jsonb->>'turn_id'=(:'e5accepted')::jsonb->>'turn_id'
 AND pg_temp.planning_stage((:'e5rearmed')::jsonb->>'turn_id',pg_temp.tok('E5-rearm'),(:'e5freshbinding')::jsonb)->>'ok'='true',
 'EXP05 original same-operation rearm binds fresh source, never old expired token context');
SELECT pg_temp.check((SELECT read_context->'tools'='["plan_list"]' AND jsonb_array_length(read_context#>'{planning,observations}')=1
 FROM public.team_hub_agent_turns WHERE id=((:'e5rearmed')::jsonb->>'turn_id')::uuid),
 'EXP05 rearmed invocation does not inherit old CRM tools or observations');
ROLLBACK TO e5_rearm;
SAVEPOINT e5_version;
UPDATE public.plan_items SET updated_at='2026-11-01T00:00:00.123457Z' WHERE id='e5000000-0000-4000-8000-000000000011';
SELECT pg_temp.check(pg_temp.apost(:'u3',:'ta',:'e5dm','zion','PRIVATE stale answer',gen_random_uuid()::text,NULL,:'e5q','dm',pg_temp.tok('E5')) ? 'error',
 'EXP05 microsecond version change after staging refuses publication');
ROLLBACK TO e5_version;
SAVEPOINT e5_insert;
INSERT INTO public.plan_items(tenant_id,item_type,created_by,title) VALUES(:'ta','task',:'u3','New visible work');
SELECT pg_temp.check(pg_temp.apost(:'u3',:'ta',:'e5dm','zion','PRIVATE incomplete answer',gen_random_uuid()::text,NULL,:'e5q','dm',pg_temp.tok('E5')) ? 'error',
 'EXP05 newly visible source after staging requires a fresh observation');
ROLLBACK TO e5_insert;
SAVEPOINT e5_role;
UPDATE public.tenant_members SET role='member' WHERE user_id=:'u3'::uuid AND tenant_id=:'ta'::uuid;
SELECT pg_temp.check(pg_temp.apost(:'u3',:'ta',:'e5dm','zion','PRIVATE unauthorized answer',gen_random_uuid()::text,NULL,:'e5q','dm',pg_temp.tok('E5')) ? 'error',
 'EXP05 demotion before publication refuses original answer');
ROLLBACK TO e5_role;
SAVEPOINT e5_scope;
UPDATE public.profiles SET active_tenant_id=:'tb' WHERE user_id=:'u3';
SELECT pg_temp.check(pg_temp.planning_stage((:'e5accepted')::jsonb->>'turn_id',pg_temp.tok('E5'),(:'e5binding')::jsonb) ? 'error',
 'EXP05 account switching refuses original source continuation');
ROLLBACK TO e5_scope;
SELECT pg_temp.check(pg_temp.planning_stage((:'e5accepted')::jsonb->>'turn_id',pg_temp.tok('WRONG'),(:'e5binding')::jsonb)->>'ok'='false',
 'EXP05 wrong accepted token refuses staging');
SELECT pg_temp.check(pg_temp.planning_stage((:'e5accepted')::jsonb->>'turn_id',pg_temp.tok('E5'),
 jsonb_set((:'e5binding')::jsonb,'{source,plans,0,id}','"e5000000-0000-4000-8000-000000000002"')) ? 'error',
 'EXP05 foreign source identity refuses staging');
SELECT pg_temp.check(pg_temp.planning_stage((:'e5accepted')::jsonb->>'turn_id',pg_temp.tok('E5'),
 (:'e5binding')::jsonb||'{"actor_id":"10000000-0000-4000-8000-000000000001"}') ? 'error',
 'EXP05 generic JSON actor authority is rejected');
CREATE FUNCTION pg_temp.planning_malformed(turn_id text,token text,b jsonb) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE bad jsonb; n integer:=0;
BEGIN
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  b-'source',b||'{"version":2}',b||'{"roster_tools":[]}',
  jsonb_set(b,'{arguments,limit}','31'),jsonb_set(b,'{arguments,limit}','1.5'),
  jsonb_set(b,'{arguments,status}','["open"]'),jsonb_set(b,'{arguments,from}','"2026-02-30"'),
  jsonb_set(b,'{arguments}',b->'arguments'||'{"tenant_id":"e5000000-0000-4000-8000-000000000002"}'),
  jsonb_set(b,'{source}','{"plans":[],"loose_items":[]}'),
  b#-'{source,plans,0,updated_at}',
  jsonb_set(b,'{source,plans,0,updated_at}','"2026-11-01T00:00:00.1234567Z"'),
  jsonb_set(b,'{source,plans,0,items}',(b#>'{source,plans,0,items}')||(b#>'{source,plans,0,items}')))) LOOP
  PERFORM pg_temp.check(pg_temp.planning_stage(turn_id,token,bad) ? 'error','EXP05 closed native binding refuses malformed source/query/roster');
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
SELECT pg_temp.check(pg_temp.planning_malformed((:'e5accepted')::jsonb->>'turn_id',pg_temp.tok('E5'),(:'e5binding')::jsonb)=12,
 'EXP05 twelve malformed native source/query/roster envelopes refuse without widening');
SELECT pg_temp.check(pg_temp.planning_stage((:'e5accepted')::jsonb->>'turn_id',pg_temp.tok('E5'),(:'e5binding')::jsonb,
 '[{"destination":"operations_work","record_id":"e5000000-0000-4000-8000-000000000012","record_kind":"planning_item"}]')->>'ok'='false',
 'EXP05 typed foreign Work link refuses staging');
SELECT pg_temp.check(pg_temp.planning_stage((:'e5accepted')::jsonb->>'turn_id',pg_temp.tok('E5'),(:'e5binding')::jsonb,
 '[{"destination":"operations_work","record_id":"e5000000-0000-4000-8000-000000000001","record_kind":"planning_item"}]')->>'ok'='false',
 'EXP05 Plan container cannot masquerade as a Work item');
SAVEPOINT e5_roster;
UPDATE public.paige_subagents SET config=jsonb_set(config,'{capability_scope,tools}',(config#>'{capability_scope,tools}')-'plan_list')
 WHERE tenant_id IS NULL AND slug='zion';
SELECT pg_temp.check(pg_temp.apost(:'u3',:'ta',:'e5dm','zion','PRIVATE roster revoked',gen_random_uuid()::text,NULL,:'e5q','dm',pg_temp.tok('E5')) ? 'error',
 'EXP05 revoked original roster refuses publication');
ROLLBACK TO e5_roster;
SAVEPOINT e5_expired;
UPDATE public.team_hub_agent_turns SET read_context=jsonb_set(read_context,'{expires_at}',to_jsonb(clock_timestamp()-interval '1 second'))
 WHERE id=((:'e5accepted')::jsonb->>'turn_id')::uuid;
SELECT pg_temp.check(pg_temp.apost(:'u3',:'ta',:'e5dm','zion','PRIVATE expired',gen_random_uuid()::text,NULL,:'e5q','dm',pg_temp.tok('E5')) ? 'error',
 'EXP05 expired original observation refuses publication');
ROLLBACK TO e5_expired;
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_messages WHERE channel_id=:'e5dm'::uuid AND body LIKE 'PRIVATE%')
 AND (SELECT t.read_context=b.read_context FROM public.team_hub_agent_turns t JOIN exp05_staged b USING(id)),
 'EXP05 refused continuations persist neither an answer nor changed original source context');
SELECT gen_random_uuid()::text AS e5request \gset
SELECT pg_temp.apost(:'u3',:'ta',:'e5dm','zion','Original weekly review. Nothing was changed.',:'e5request',NULL,:'e5q','dm',pg_temp.tok('E5')) AS e5posted \gset
SELECT pg_temp.check((:'e5posted')::jsonb->>'ok'='true','EXP05 original authorized native reply publishes');
SELECT pg_temp.check(pg_temp.apost(:'u3',:'ta',:'e5dm','zion','Original weekly review. Nothing was changed.',:'e5request',NULL,:'e5q','dm',pg_temp.tok('E5'))#>>'{message,id}'
 =(:'e5posted')::jsonb#>>'{message,id}','EXP05 lost post acknowledgment returns the same original message');
SELECT pg_temp.check(pg_temp.j(:'u3',format('public._team_hub_agent_read_annotations(%L::uuid)',(:'e5posted')::jsonb#>>'{message,id}')) ? 'error',
 'EXP05 browser cannot call private history helper directly');
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5dm')) AS e5history \gset
SELECT pg_temp.check((:'e5history')::jsonb->>'ok'='true' AND (:'e5history') LIKE '%Original weekly review%',
 'EXP05 original authenticated history door returns the same persisted answer');
SAVEPOINT e5_history_edit;
UPDATE public.plan_items SET updated_at=clock_timestamp(),status='done' WHERE id='e5000000-0000-4000-8000-000000000011';
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5dm')) AS e5editedhistory \gset
SELECT pg_temp.check((:'e5editedhistory') LIKE '%Original weekly review%',
 'EXP05 legitimate later completion retains its authorized historical answer');
ROLLBACK TO e5_history_edit;
SAVEPOINT e5_history_revoke;
UPDATE public.plan_items SET created_by=:'u2',assigned_to_user_id=:'u2' WHERE id='e5000000-0000-4000-8000-000000000011';
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5dm')) AS e5revokedhistory \gset
SELECT pg_temp.check((:'e5revokedhistory') NOT LIKE '%Original weekly review%' AND (:'e5revokedhistory') LIKE '%source_unavailable%',
 'EXP05 original history masks the answer after source access is revoked');
\if :{?exp05_search_red}
-- Causal inverse only in this disposable proof: restore the exact original
-- Search body and require the new privacy property to fail, preserving its ABI.
DO $$ DECLARE d text; src text; BEGIN
 SELECT prosrc INTO src FROM exp05_before WHERE oid='public.team_hub_search(uuid,text,integer)'::regprocedure;
 SELECT pg_get_functiondef('public.team_hub_search(uuid,text,integer)'::regprocedure) INTO d;
 EXECUTE left(d,strpos(d,'AS $function$')-1)||'AS $function$'||src||'$function$';
END $$;
SELECT pg_temp.check((SELECT md5(prosrc)='d71b872a84e35d1b6b758006181e15d2' FROM pg_proc
 WHERE oid='public.team_hub_search(uuid,text,integer)'::regprocedure),'EXP05 Search reproduction uses exact current original source');
\endif
SELECT pg_temp.j(:'u3',format('public.team_hub_search(%L::uuid,''weekly'')',:'ta')) AS e5revokedsearch \gset
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements((:'e5revokedsearch')::jsonb->'results') r
 WHERE r->>'message_id'=(:'e5posted')::jsonb#>>'{message,id}'),
 'EXP05 revoked Planning source must not remain in original Search');
ROLLBACK TO e5_history_revoke;
ROLLBACK;
\o
\pset format unaligned
\pset tuples_only on
SELECT 'EXP05_NATIVE_CONTRACT:'||jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',md5(p.prosrc),
 'owner',p.proowner::regrole::text,'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl)
 ORDER BY p.oid::regprocedure::text)::text FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN (
 '_team_hub_planning_read_source','_team_hub_planning_source_versions','_team_hub_assert_planning_read',
 '_team_hub_stage_planning_read','_team_hub_planning_read_annotations','_team_hub_assert_agent_read_scope',
 'team_hub_stage_agent_read_context','_team_hub_agent_read_annotations','team_hub_post_agent_message',
 'team_hub_list_messages','_team_hub_message_json','plan_list','_sales_invoice_actor','team_hub_search');
\o /dev/null
\echo 'PASS: EXP05 caller-JWT version parity, native stage-before-publication, mixed CRM reads, refusal, replay and history revocation'
