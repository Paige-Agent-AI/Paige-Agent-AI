-- Extend the SAME disposable native Planning/Task/Calendar proof, after its controls.
RESET ROLE;
DO $$ BEGIN IF current_database()<>'exp08_team_hub_a2b_proof' THEN RAISE EXCEPTION 'Original disposable fixture only'; END IF; END $$;
SELECT pg_temp.j(:'u3',format('public.team_hub_open_agent_dm(%L::uuid,''zion'')',:'ta'))->>'channel_id' AS weekdm \gset
SELECT pg_temp.post(:'u3',:'ta',:'weekdm','Reopen the original saved weekly plan')#>>'{message,id}' AS weekq \gset
SELECT pg_temp.tok('E05-weekly-plan-references') AS weektoken \gset
SELECT pg_temp.accept(:'ta',:'u3',:'weekdm',:'weekq','zion','dm',:'weektoken') AS weekturn \gset
SELECT pg_temp.check((:'weekturn')::jsonb->>'ok'='true','O02 same registered ZION accepts original bounded read');
SELECT pg_temp.planning_binding(:'u3',:'ta','{"plan_id":"e5000000-0000-4000-8000-000000000100"}') AS weekbinding \gset
SELECT '[{"destination":"operations_work","record_id":"e5000000-0000-4000-8000-000000000100","record_kind":"planning_plan"},{"destination":"operations_weekly_plan","record_id":null}]' AS weeklinks \gset
SELECT pg_temp.check(pg_temp.planning_stage((:'weekturn')::jsonb->>'turn_id',:'weektoken',(:'weekbinding')::jsonb,(:'weeklinks')::jsonb)->>'ok'='false',
 'O02 causal predecessor refuses Plan-container references');
CREATE TEMP TABLE week_before AS SELECT oid,to_jsonb(p)-'prosrc' metadata,prosrc FROM pg_proc p WHERE pronamespace='public'::regnamespace;
\ir ../../scripts/proof/exp05-weekly-plan-navigation.sql
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM week_before b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND
 (b.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc' OR b.prosrc IS DISTINCT FROM p.prosrc AND p.proname<>'team_hub_stage_agent_read_context')),
 'O02 ONLY original stage body changes; every OID/ABI/owner/ACL/config and outside body is preserved');
SELECT pg_temp.planning_stage((:'weekturn')::jsonb->>'turn_id',:'weektoken',(:'weekbinding')::jsonb,(:'weeklinks')::jsonb) AS weekstage \gset
SELECT pg_temp.check((:'weekstage')::jsonb->>'ok'='true',
 'O02 exact same-source Plan and non-writing review reference admitted: '||:'weekstage'||' binding='||:'weekbinding');
SELECT pg_temp.check(pg_temp.task_stage((:'weekturn')::jsonb->>'turn_id',:'weektoken','["plan_list"]','[]')->>'ok'='true'
 AND (SELECT read_context->'record_links' @> (:'weeklinks')::jsonb FROM public.team_hub_agent_turns WHERE id=((:'weekturn')::jsonb->>'turn_id')::uuid),
 'O02 empty before-publication authority recheck retains SAME original Plan/review references');
CREATE TEMP TABLE week_staged AS SELECT read_context FROM public.team_hub_agent_turns WHERE id=((:'weekturn')::jsonb->>'turn_id')::uuid;
SELECT pg_temp.check(pg_temp.planning_stage((:'weekturn')::jsonb->>'turn_id',:'weektoken',(:'weekbinding')::jsonb,
 '[{"destination":"operations_work","record_id":"e5000000-0000-4000-8000-000000000002","record_kind":"planning_plan"}]')->>'ok'='false',
 'O02 foreign Plan reference refused');
SELECT pg_temp.check(pg_temp.planning_stage((:'weekturn')::jsonb->>'turn_id',:'weektoken',(:'weekbinding')::jsonb,
 '[{"destination":"operations_work","record_id":"e5000000-0000-4000-8000-000000000101","record_kind":"planning_plan"}]')->>'ok'='false',
 'O02 Work item cannot masquerade as Plan container');
SELECT pg_temp.check(pg_temp.planning_stage((:'weekturn')::jsonb->>'turn_id',:'weektoken',(:'weekbinding')::jsonb,
 '[{"destination":"operations_weekly_plan","record_id":"e5000000-0000-4000-8000-000000000100"}]')->>'ok'='false',
 'O02 static review cannot carry an arbitrary record locator');
SELECT pg_temp.check(pg_temp.planning_stage((:'weekturn')::jsonb->>'turn_id',:'weektoken',(:'weekbinding')::jsonb,
 '[{"destination":"operations_work","record_id":"e5000000-0000-4000-8000-000000000100","record_kind":"other"}]')->>'ok'='false',
 'O02 unknown record kind remains closed');
SELECT pg_temp.check((SELECT read_context=(SELECT read_context FROM week_staged) FROM public.team_hub_agent_turns WHERE id=((:'weekturn')::jsonb->>'turn_id')::uuid),
 'O02 all rejected references leave staged original identity unchanged');
SELECT pg_temp.apost(:'u3',:'ta',:'weekdm','zion','Original saved plan is ready to inspect; no work was executed.',gen_random_uuid()::text,NULL,:'weekq','dm',:'weektoken') AS weekposted \gset
SELECT pg_temp.check((:'weekposted')::jsonb->>'ok'='true','O02 original native post publishes with original source recheck');
SELECT pg_temp.post(:'u3',:'ta',:'weekdm','Review weekly Planning after my six original Task references')#>>'{message,id}' AS weekmixedq \gset
SELECT pg_temp.tok('E05-weekly-mixed-navigation') AS weekmixedtoken \gset
SELECT pg_temp.accept(:'ta',:'u3',:'weekdm',:'weekmixedq','zion','dm',:'weekmixedtoken') AS weekmixedturn \gset
SELECT pg_temp.check(pg_temp.task_stage((:'weekmixedturn')::jsonb->>'turn_id',:'weekmixedtoken','["crm_list_tasks"]',(:'e5taskcaplinks')::jsonb)->>'ok'='true',
 'O02 populated mixed turn starts with its original six Task references');
SELECT pg_temp.planning_stage((:'weekmixedturn')::jsonb->>'turn_id',:'weekmixedtoken',(:'weekbinding')::jsonb,(:'weeklinks')::jsonb) AS weekmixedstage \gset
SELECT read_context AS weekmixedcontext FROM public.team_hub_agent_turns WHERE id=((:'weekmixedturn')::jsonb->>'turn_id')::uuid \gset
SELECT pg_temp.check((:'weekmixedstage')::jsonb->>'ok'='true'
 AND (SELECT jsonb_array_length(read_context->'record_links')=6 AND read_context->'record_links' @> (:'weeklinks')::jsonb
 FROM public.team_hub_agent_turns WHERE id=((:'weekmixedturn')::jsonb->>'turn_id')::uuid),
 'O02 populated Task-first native stage retains original review/Plan without increasing SIX: '||:'weekmixedstage'||' context='||:'weekmixedcontext');
BEGIN READ ONLY;
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'weekdm')) AS weekreopened \gset
SELECT pg_temp.check(EXISTS(SELECT 1 FROM jsonb_array_elements((:'weekreopened')::jsonb->'messages') r
 WHERE r->>'id'=(:'weekposted')::jsonb#>>'{message,id}' AND r->'paige_record_links' @> (:'weeklinks')::jsonb),
 'O02 read-only history restores SAME reply and original Plan/review references');
COMMIT;
BEGIN;
UPDATE public.plans SET tenant_id=:'tb' WHERE id='e5000000-0000-4000-8000-000000000100';
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'weekdm')) AS weekrevoked \gset
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements((:'weekrevoked')::jsonb->'messages') r
 WHERE r->>'id'=(:'weekposted')::jsonb#>>'{message,id}' AND r->'paige_record_links' @> (:'weeklinks')::jsonb),
 'O02 source permission loss masks historical references without rewriting history');
ROLLBACK;
\echo 'PASS: O02 original Plan references, refusal, publication and reload controls'
