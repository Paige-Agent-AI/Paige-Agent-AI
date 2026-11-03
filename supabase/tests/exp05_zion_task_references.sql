-- Original disposable fixture only; no production/real tenant or provider.
RESET ROLE;
DO $$ BEGIN IF current_database()<>'exp08_team_hub_a2b_proof' THEN RAISE EXCEPTION 'Disposable original fixture only'; END IF; END $$;
SELECT config AS e5taskroster FROM public.paige_subagents WHERE tenant_id IS NULL AND slug='zion' \gset
UPDATE public.paige_subagents SET config=jsonb_set(config,'{capability_scope,tools}',config#>'{capability_scope,tools}'||'"read_calendar_agenda"'::jsonb)
 WHERE tenant_id IS NULL AND slug='zion' AND NOT (config#>'{capability_scope,tools}' @> '["read_calendar_agenda"]');
INSERT INTO public.tasks(id,user_id,title,tenant_id) VALUES
 ('e5050000-0000-4000-8000-000000000001',:'u3','Original fixture Task',:'ta'),
 ('e5050000-0000-4000-8000-000000000002',:'u3','Foreign fixture Task',:'tb');
SELECT pg_temp.j(:'u3',format('public.team_hub_open_agent_dm(%L::uuid,''zion'')',:'ta'))->>'channel_id' AS e5taskdm \gset
SELECT pg_temp.post(:'u3',:'ta',:'e5taskdm','Review my original Task, Planning and saved Calendar')#>>'{message,id}' AS e5taskq \gset
SELECT pg_temp.tok('E05-original-task-navigation') AS e5tasktoken \gset
SELECT pg_temp.accept(:'ta',:'u3',:'e5taskdm',:'e5taskq','zion','dm',:'e5tasktoken') AS e5taskturn \gset
SELECT pg_temp.check((:'e5taskturn')::jsonb->>'ok'='true','O01 original native Task turn accepted');
CREATE FUNCTION pg_temp.task_stage(turn text,token text,tools jsonb,links jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
 turn,pg_temp.h(token),tools,links),'service_role') $$;
SELECT '[{"destination":"operations_work","record_id":"e5050000-0000-4000-8000-000000000001"}]' AS e5tasklink \gset
SELECT pg_temp.check(pg_temp.task_stage((:'e5taskturn')::jsonb->>'turn_id',:'e5tasktoken','["crm_list_tasks"]',(:'e5tasklink')::jsonb)->>'ok'='false',
 'O01 baseline: unchanged predecessor refuses exact original Task links');
CREATE TEMP TABLE e5task_before AS SELECT oid,to_jsonb(p)-'prosrc' metadata,prosrc FROM pg_proc p WHERE pronamespace='public'::regnamespace;
\ir ../migrations/20271130030005_exp05_zion_original_task_references.sql
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM e5task_before b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND
 (b.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc' OR b.prosrc IS DISTINCT FROM p.prosrc AND p.proname NOT IN
 ('_team_hub_assert_agent_read_scope','team_hub_stage_agent_read_context','_team_hub_planning_read_annotations','_team_hub_agent_read_annotations'))),
 'O01 Task references preserve all original complete metadata/OIDs/ABI/ACL and outside bodies');
CREATE TEMP TABLE e5task_after AS SELECT oid,to_jsonb(p) metadata FROM pg_proc p WHERE pronamespace='public'::regnamespace;
\ir ../migrations/20271130030005_exp05_zion_original_task_references.sql
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM e5task_after b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.metadata IS DISTINCT FROM to_jsonb(p)),
 'O01 exact candidate replay preserves every whole function and complete metadata');
SELECT pg_temp.check(pg_temp.task_stage((:'e5taskturn')::jsonb->>'turn_id',:'e5tasktoken','["crm_list_team"]',(:'e5tasklink')::jsonb)->>'ok'='false',
 'O01 team read alone cannot admit an original Task reference');
SELECT pg_temp.check(pg_temp.task_stage((:'e5taskturn')::jsonb->>'turn_id',:'e5tasktoken','["crm_list_tasks"]',
 '[{"destination":"operations_work","record_id":"e5050000-0000-4000-8000-000000000002"}]')->>'ok'='false',
 'O01 original native Task references refuse a foreign tenant');
SELECT pg_temp.check(pg_temp.task_stage((:'e5taskturn')::jsonb->>'turn_id',:'e5tasktoken','["crm_list_tasks"]',(:'e5tasklink')::jsonb)->>'ok'='true',
 'O01 original CRM read admits its same-tenant native Task reference');
SELECT pg_temp.task_stage((:'e5taskturn')::jsonb->>'turn_id',:'e5tasktoken','["crm_list_tasks"]','[]') AS e5taskrecheck \gset
SELECT pg_temp.check((:'e5taskrecheck')::jsonb->>'ok'='true'
 AND (SELECT read_context->'record_links' @> (:'e5tasklink')::jsonb FROM public.team_hub_agent_turns
  WHERE id=((:'e5taskturn')::jsonb->>'turn_id')::uuid),
 'O01 actual Task-first empty authority recheck preserves original Task references BEFORE Planning or Calendar');
INSERT INTO public.tasks(id,user_id,title,tenant_id)
 SELECT ('e5050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,:'u3','Original fixture cap Task',:'ta'
 FROM generate_series(100,108) n;
SELECT pg_temp.post(:'u3',:'ta',:'e5taskdm','Review original bounded Task references')#>>'{message,id}' AS e5taskcapq \gset
SELECT pg_temp.tok('E05-original-task-reference-cap') AS e5taskcaptoken \gset
SELECT pg_temp.accept(:'ta',:'u3',:'e5taskdm',:'e5taskcapq','zion','dm',:'e5taskcaptoken') AS e5taskcapturn \gset
SELECT jsonb_agg(jsonb_build_object('destination','operations_work','record_id',id) ORDER BY id) AS e5taskcaplinks
 FROM public.tasks WHERE id BETWEEN 'e5050000-0000-4000-8000-000000000100'::uuid AND 'e5050000-0000-4000-8000-000000000105'::uuid \gset
SELECT pg_temp.task_stage((:'e5taskcapturn')::jsonb->>'turn_id',:'e5taskcaptoken','["crm_list_tasks"]',(:'e5taskcaplinks')::jsonb) AS e5taskcapfirst \gset
SELECT pg_temp.check((:'e5taskcapfirst')::jsonb->>'ok'='true','O01 original Task-only six-reference stage admitted');
SELECT jsonb_agg(jsonb_build_object('destination','operations_work','record_id',id) ORDER BY id) AS e5taskcapmore
 FROM public.tasks WHERE id BETWEEN 'e5050000-0000-4000-8000-000000000106'::uuid AND 'e5050000-0000-4000-8000-000000000108'::uuid \gset
SELECT pg_temp.task_stage((:'e5taskcapturn')::jsonb->>'turn_id',:'e5taskcaptoken','["crm_get_task"]',(:'e5taskcapmore')::jsonb) AS e5taskcapsecond \gset
SELECT pg_temp.check((:'e5taskcapsecond')::jsonb->>'ok'='true' AND
 (SELECT jsonb_array_length(read_context->'record_links')=6 AND read_context->'tools' @> '["crm_list_tasks","crm_get_task"]'
  AND jsonb_array_length(read_context->'tools')=2 FROM public.team_hub_agent_turns WHERE id=((:'e5taskcapturn')::jsonb->>'turn_id')::uuid),
 'O01 accumulated Task-only sources retain the original six-reference bound');
SELECT pg_temp.task_stage((:'e5taskcapturn')::jsonb->>'turn_id',:'e5taskcaptoken','["crm_list_tasks","crm_get_task"]','[]') AS e5taskcaprecheck \gset
SELECT pg_temp.check((:'e5taskcaprecheck')::jsonb->>'ok'='true' AND
 (SELECT read_context->'record_links'=(:'e5taskcaplinks')::jsonb FROM public.team_hub_agent_turns WHERE id=((:'e5taskcapturn')::jsonb->>'turn_id')::uuid),
 'O01 actual empty recheck retains the original bounded Task-only references');
SELECT pg_temp.planning_binding(:'u3',:'ta','{"limit":1}') AS e5taskplan \gset
SELECT pg_temp.check(pg_temp.planning_stage((:'e5taskturn')::jsonb->>'turn_id',:'e5tasktoken',(:'e5taskplan')::jsonb)->>'ok'='true',
 'O01 existing original Planning source shares the SAME turn');
SELECT pg_temp.calendar_binding(:'u3',:'ta',(:'e5calargs')::jsonb,1) AS e5taskcal \gset
SELECT pg_temp.check(pg_temp.planning_stage((:'e5taskturn')::jsonb->>'turn_id',:'e5tasktoken',(:'e5taskcal')::jsonb,
 '[{"destination":"calendar","record_id":null}]')->>'ok'='true','O01 third original Calendar source admitted without raising the budget');
SELECT read_context AS e5taskcontext FROM public.team_hub_agent_turns WHERE id=((:'e5taskturn')::jsonb->>'turn_id')::uuid \gset
SELECT pg_temp.check((:'e5taskcontext')::jsonb->'tools' @> '["crm_list_tasks","plan_list","read_calendar_agenda"]'
 AND jsonb_array_length((:'e5taskcontext')::jsonb->'tools')=3
 AND (:'e5taskcontext')::jsonb->'record_links' @> (:'e5tasklink')::jsonb,
 'O01 three original requested sources retain the original Task link through later staging');
SELECT pg_temp.check(pg_temp.task_stage((:'e5taskturn')::jsonb->>'turn_id',:'e5tasktoken','["crm_get_task"]','[]') ? 'error'
 AND (SELECT read_context=(:'e5taskcontext')::jsonb FROM public.team_hub_agent_turns WHERE id=((:'e5taskturn')::jsonb->>'turn_id')::uuid),
 'O01 fourth-source refusal leaves original context unchanged');
SELECT gen_random_uuid() AS e5taskrequest \gset
UPDATE public.tasks SET tenant_id=:'tb' WHERE id='e5050000-0000-4000-8000-000000000001';
SELECT pg_temp.apost(:'u3',:'ta',:'e5taskdm','zion','Original Task and responsibilities reviewed',:'e5taskrequest',NULL,:'e5taskq','dm',:'e5tasktoken') AS e5taskdenied \gset
SELECT pg_temp.check((:'e5taskdenied')::jsonb->>'error'='Original Task reference unavailable',
 'O01 actual Task scope guard before publication refuses the original post');
UPDATE public.tasks SET tenant_id=:'ta' WHERE id='e5050000-0000-4000-8000-000000000001';
SELECT pg_temp.apost(:'u3',:'ta',:'e5taskdm','zion','Original Task and responsibilities reviewed',:'e5taskrequest',NULL,:'e5taskq','dm',:'e5tasktoken') AS e5taskposted \gset
SELECT pg_temp.check((:'e5taskposted')::jsonb->>'ok'='true' AND (:'e5taskposted')::jsonb#>'{message,paige_record_links}' @> (:'e5tasklink')::jsonb,
 'O01 actual native post returns original Task references');
BEGIN READ ONLY;
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5taskdm')) AS e5taskhistory \gset
SELECT pg_temp.check(EXISTS(SELECT 1 FROM jsonb_array_elements((:'e5taskhistory')::jsonb->'messages') r
 WHERE r->>'id'=(:'e5taskposted')::jsonb#>>'{message,id}' AND r->'paige_record_links' @> (:'e5tasklink')::jsonb),
 'O01 real READ ONLY history reopens SAME original Task-linked reply');
COMMIT;
UPDATE public.tasks SET tenant_id=:'tb' WHERE id='e5050000-0000-4000-8000-000000000001';
BEGIN READ ONLY;
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5taskdm')) AS e5taskhidden \gset
SELECT pg_temp.check(EXISTS(SELECT 1 FROM jsonb_array_elements((:'e5taskhidden')::jsonb->'messages') r
 WHERE r->>'id'=(:'e5taskposted')::jsonb#>>'{message,id}' AND r->>'source_unavailable'='true'
 AND r->'paige_record_links'='[]'::jsonb),'O01 READ ONLY history withholds reply and links after original Task scope changes');
COMMIT;
UPDATE public.tasks SET tenant_id=:'ta' WHERE id='e5050000-0000-4000-8000-000000000001';
BEGIN READ ONLY;
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5taskdm')) AS e5taskrestored \gset
SELECT pg_temp.check(EXISTS(SELECT 1 FROM jsonb_array_elements((:'e5taskrestored')::jsonb->'messages') r
 WHERE r->>'id'=(:'e5taskposted')::jsonb#>>'{message,id}' AND r->'paige_record_links' @> (:'e5tasklink')::jsonb),
 'O01 restored source reveals SAME original reply without a repeated action');
COMMIT;
UPDATE public.paige_subagents SET config=(:'e5taskroster')::jsonb WHERE tenant_id IS NULL AND slug='zion';
\echo 'PASS: O01 original Task reference native proof'
\if :{?exp05_concurrent}
BEGIN;
CREATE FUNCTION pg_temp.task_race_context(actor text,tenant text,foreign_tenant text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE dm text; question text; token text; accepted jsonb; cases jsonb:='[]'; n integer;
BEGIN
 dm:=pg_temp.j(actor,format('public.team_hub_open_agent_dm(%L::uuid,''zion'')',tenant))->>'channel_id';
 FOR n IN 0..3 LOOP
  token:=pg_temp.tok('E5-task-concurrent-'||n);
  question:=pg_temp.post(actor,tenant,dm,'Review original concurrent Task records '||n)#>>'{message,id}';
  accepted:=pg_temp.accept(tenant,actor,dm,question,'zion','dm',token);
  PERFORM pg_temp.check(accepted->>'ok'='true' AND pg_temp.task_stage(accepted->>'turn_id',token,'["crm_list_tasks"]',
   '[{"destination":"operations_work","record_id":"e5050000-0000-4000-8000-000000000001"}]')->>'ok'='true',
   'O01 concurrent Task reference uses the original accepted turn');
  cases:=cases||jsonb_build_array(jsonb_build_object('turn',accepted->>'turn_id','question',question,'token',token,'request',gen_random_uuid()));
 END LOOP;
 RETURN jsonb_build_object('actor',actor,'tenant',tenant,'foreign_tenant',foreign_tenant,'channel',dm,
  'item','e5050000-0000-4000-8000-000000000001','cases',cases);
END $$;
SELECT pg_temp.task_race_context(:'u3',:'ta',:'tb') AS e5taskrace \gset
COMMIT;
\o
\pset format unaligned
\pset tuples_only on
SELECT 'EXP05_TASK_RACE_CONTEXT:'||(:'e5taskrace')::jsonb::text;
\o /dev/null
\endif
\o
\pset format unaligned
\pset tuples_only on
SELECT 'EXP05_TASK_LINK_NATIVE_CONTRACT:'||jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',md5(p.prosrc),
 'metadata',to_jsonb(p)-'prosrc') ORDER BY p.oid::regprocedure::text)::text FROM pg_proc p WHERE p.oid IN (
 'public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)'::regprocedure,
 'public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)'::regprocedure,
 'public._team_hub_planning_read_annotations(public.team_hub_agent_turns)'::regprocedure,
 'public._team_hub_agent_read_annotations(uuid)'::regprocedure);
\o /dev/null
