-- Additive to the ENTIRE original E08/E05 proof. Existing synthetic people and
-- business only. No production database, customer account, model or provider.
RESET ROLE;
SELECT set_config('request.jwt.claims','',false);
DO $$ BEGIN IF current_database()<>'exp08_team_hub_a2b_proof' THEN
 RAISE EXCEPTION 'Original disposable E08 fixture only'; END IF; END $$;
\ir fixtures/exp05-zion-calendar-original.sql
CREATE TEMP TABLE e5cal_before AS SELECT oid,pg_temp.exp05_metadata(p) metadata,prosrc FROM pg_proc p WHERE pronamespace='public'::regnamespace;
\ir ../../scripts/proof/exp05-zion-calendar-read-candidate.sql
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM e5cal_before b LEFT JOIN pg_proc p USING(oid)
 WHERE b.metadata IS DISTINCT FROM pg_temp.exp05_metadata(p) OR (b.prosrc<>p.prosrc AND p.proname NOT IN (
 '_team_hub_assert_agent_read_scope','team_hub_stage_agent_read_context','_team_hub_planning_read_annotations','_team_hub_agent_read_annotations'))),
 'EXP05 Calendar preserves every original ABI/OID/default/ACL/metadata and unrelated body');
CREATE TEMP TABLE e5cal_after AS SELECT oid,to_jsonb(p) metadata FROM pg_proc p WHERE pronamespace='public'::regnamespace;
\ir ../../scripts/proof/exp05-zion-calendar-read-candidate.sql
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM e5cal_after b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.metadata IS DISTINCT FROM to_jsonb(p)),
 'EXP05 Calendar exact replay preserves every function body and complete metadata');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
 WHERE p.proname IN ('_team_hub_calendar_read_source','_team_hub_assert_calendar_read','_team_hub_stage_calendar_read')
 AND a.grantee<>p.proowner),'EXP05 Calendar helpers remain private owner-only');
\echo 'PASS: EXP05 Calendar exact source/ABI/ACL conservation and replay'

CREATE FUNCTION pg_temp.calendar_binding(actor text,tenant text,args jsonb,preview integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE raw jsonb; rows jsonb; ids jsonb; n integer; more boolean; roster jsonb;
BEGIN
 raw:=pg_temp.j(actor,format('(SELECT coalesce(jsonb_agg(r),''[]''::jsonb) FROM public.list_team_bookings(%L::timestamptz,%L::timestamptz,%L::uuid[],%L::uuid,NULL::uuid) r)',
  args->>'from',args->>'to',CASE WHEN args->>'view'='mine' THEN ARRAY[actor]::text ELSE NULL END,tenant));
 SELECT coalesce(jsonb_agg(r ORDER BY (r->>'start_at')::timestamptz,r->>'id'),'[]') INTO raw FROM (
  SELECT value r FROM jsonb_array_elements(raw) WHERE value->>'booking_kind'<>'class_seat'
   AND (value->>'end_at')::timestamptz>(args->>'from')::timestamptz
  ORDER BY (value->>'start_at')::timestamptz,value->>'id' LIMIT 51) q;
 n:=least(jsonb_array_length(raw),50); more:=jsonb_array_length(raw)>50;
 SELECT coalesce(jsonb_agg(value->'id' ORDER BY ordinal),'[]') INTO ids
  FROM jsonb_array_elements(raw) WITH ORDINALITY a(value,ordinal) WHERE ordinal<=50;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r->'id','host_user_id',r->'host_user_id',
  'title_preview',left(r->>'title',120),'title_truncated',length(r->>'title')>120,
  'start_at',r->'start_at','end_at',r->'end_at','timezone',r->'timezone','status',r->'status','booking_kind',r->'booking_kind') ORDER BY ordinal),'[]')
 INTO rows FROM (SELECT value r,ordinal FROM jsonb_array_elements(raw) WITH ORDINALITY a(value,ordinal)
 WHERE ordinal<=least(preview,50)) q;
 SELECT config#>'{capability_scope,tools}' INTO roster FROM public.paige_subagents WHERE tenant_id IS NULL AND slug='zion';
 RETURN jsonb_build_object('tool','read_calendar_agenda','version',1,'arguments',args,'roster_tools',roster,'source',
  jsonb_build_object('bookings',rows,'source_ids',ids,'source_shown_count',n,'source_has_more',more,
   'shown_count',jsonb_array_length(rows),'omitted_from_model',n-jsonb_array_length(rows),'has_more',more OR jsonb_array_length(rows)<n));
END $$;
CREATE FUNCTION pg_temp.calendar_malformed(turn_id text,token text,b jsonb) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE bad jsonb; n integer:=0;
BEGIN
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  b-'source',b||'{"version":2}',b||'{"roster_tools":[]}',
  jsonb_set(b,'{arguments,view}','"foreign"'),jsonb_set(b,'{arguments,from}','"2026-02-30T00:00:00.000Z"'),
  jsonb_set(b,'{arguments}',b->'arguments'||'{"tenant_id":"e5000000-0000-4000-8000-000000000002"}'),
  jsonb_set(b,'{source,source_ids}','[]'),jsonb_set(b,'{source,source_shown_count}','0'),
  jsonb_set(b,'{source,source_has_more}','false'),jsonb_set(b,'{source,shown_count}','50'),
  jsonb_set(b,'{source,omitted_from_model}','0'),jsonb_set(b,'{source,has_more}','false'),
  jsonb_set(b,'{source,bookings,0,title_preview}','"fabricated"'),
  jsonb_set(b,'{source,bookings,0,host_user_id}','"e5000000-0000-4000-8000-000000000002"'),
  jsonb_set(b,'{source,bookings,0,start_at}','"2026-11-04T10:00:00.000001Z"'),
  jsonb_set(b,'{source,bookings,0}',(b#>'{source,bookings,0}')||'{"guest_email":"not-permitted"}')) ) LOOP
  PERFORM pg_temp.check(pg_temp.planning_stage(turn_id,token,bad) ? 'error','EXP05 Calendar closed binding refuses malformed query/source/coverage/roster');
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;

SELECT config AS e5calroster FROM public.paige_subagents WHERE tenant_id IS NULL AND slug='zion' \gset
BEGIN;
UPDATE public.tenant_members SET role='admin',status='active' WHERE tenant_id=:'ta'::uuid AND user_id=:'u3'::uuid;
UPDATE public.paige_subagents SET config=jsonb_set(config,'{capability_scope,tools}',config#>'{capability_scope,tools}'||'"read_calendar_agenda"'::jsonb)
 WHERE tenant_id IS NULL AND slug='zion' AND NOT (config#>'{capability_scope,tools}' @> '["read_calendar_agenda"]');
INSERT INTO public.internal_bookings(id,tenant_id,host_user_id,title,start_at,end_at,timezone,status,booking_kind)
 SELECT ('e5ca0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,:'ta'::uuid,:'u3'::uuid,
 'Original Calendar commitment '||n,'2026-11-03T10:00:00.123456Z','2026-11-03T10:30:00.123456Z','America/New_York','confirmed','single'
 FROM generate_series(1,51) n;
INSERT INTO public.internal_bookings(id,tenant_id,host_user_id,title,start_at,end_at,timezone,status,booking_kind) VALUES
 ('e5ca0000-0000-4000-8000-000000000090',:'tb',:'u3','FOREIGN Calendar','2026-11-03T10:00Z','2026-11-03T11:00Z','UTC','confirmed','single'),
 ('e5ca0000-0000-4000-8000-000000000091',:'ta',:'u3','Seat not an appointment','2026-11-03T10:00Z','2026-11-03T11:00Z','UTC','confirmed','class_seat');
SELECT '{"from":"2026-11-02T05:00:00.000Z","to":"2026-11-09T05:00:00.000Z","view":"mine"}' AS e5calargs \gset
SELECT pg_temp.j(:'u3',format('public.team_hub_open_agent_dm(%L::uuid,''zion'')',:'ta'))->>'channel_id' AS e5caldm \gset
SELECT pg_temp.post(:'u3',:'ta',:'e5caldm','Review Calendar and weekly work')->'message'->>'id' AS e5calq \gset
SELECT pg_temp.accept(:'ta',:'u3',:'e5caldm',:'e5calq','zion','dm',pg_temp.tok('E5-calendar')) AS e5calturn \gset
SELECT pg_temp.calendar_binding(:'u3',:'ta',(:'e5calargs')::jsonb,1) AS e5calbinding \gset
SELECT pg_temp.check(pg_temp.calendar_malformed((:'e5calturn')::jsonb->>'turn_id',pg_temp.tok('E5-calendar'),(:'e5calbinding')::jsonb)=16,
 'EXP05 Calendar sixteen real native malformed/foreign/omission controls');
SAVEPOINT e5cal_original_stage;
DO $inverse$ DECLARE old_body text; current_body text; definition text;
BEGIN
 SELECT prosrc INTO old_body FROM e5cal_before WHERE oid='public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)'::regprocedure;
 SELECT prosrc,pg_get_functiondef(oid) INTO current_body,definition FROM pg_proc
  WHERE oid='public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)'::regprocedure;
 EXECUTE replace(definition,current_body,old_body);
END $inverse$;
SELECT pg_temp.check((SELECT md5(prosrc)='954b3df7f801aaf0d0eb726f0a3b10e5' FROM pg_proc
 WHERE oid='public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)'::regprocedure)
 AND pg_temp.planning_stage((:'e5calturn')::jsonb->>'turn_id',pg_temp.tok('E5-calendar'),(:'e5calbinding')::jsonb) ? 'error',
 'EXP05 actual original pre-integration stage refuses the Calendar descriptor');
ROLLBACK TO e5cal_original_stage;
SAVEPOINT e5cal_capacity;
UPDATE public.paige_subagents s SET config=jsonb_set(config,'{capability_scope,tools}','["plan_list","read_calendar_agenda","crm_list_tasks"]'::jsonb||(
 SELECT jsonb_agg(to_jsonb('reserved_'||repeat('a',83)||lpad(n::text,4,'0')))
 FROM generate_series(1,61) n))
 WHERE tenant_id IS NULL AND slug='zion';
SELECT pg_temp.calendar_binding(:'u3',:'ta',(:'e5calargs')::jsonb,1) AS e5calcapacitybinding \gset
SELECT to_jsonb(t) AS e5calbeforecapacity FROM public.team_hub_agent_turns t WHERE id=((:'e5calturn')::jsonb->>'turn_id')::uuid \gset
SELECT pg_temp.planning_stage((:'e5calturn')::jsonb->>'turn_id',pg_temp.tok('E5-calendar'),(:'e5calcapacitybinding')::jsonb) AS e5calcapacity \gset
SELECT pg_temp.check((:'e5calcapacity')::jsonb='{"ok":false,"code":"context_limit"}'::jsonb
 AND (SELECT to_jsonb(t)=(:'e5calbeforecapacity')::jsonb FROM public.team_hub_agent_turns t WHERE id=((:'e5calturn')::jsonb->>'turn_id')::uuid),
 'EXP05 native byte-capacity refusal proves entire original turn untouched: '||:'e5calcapacity');
ROLLBACK TO e5cal_capacity;
SELECT pg_temp.planning_stage((:'e5calturn')::jsonb->>'turn_id',pg_temp.tok('E5-calendar'),(:'e5calbinding')::jsonb,
 '[{"destination":"calendar","record_id":null}]') AS e5calstaged \gset
SELECT pg_temp.check((:'e5calstaged')::jsonb->>'ok'='true','EXP05 original native Calendar stage succeeds: '||:'e5calstaged');
SELECT read_context AS e5calcontext FROM public.team_hub_agent_turns WHERE id=((:'e5calturn')::jsonb->>'turn_id')::uuid \gset
SELECT pg_temp.check((:'e5calcontext')::jsonb->'tools'='["read_calendar_agenda"]'::jsonb
 AND jsonb_array_length((:'e5calcontext')::jsonb#>'{calendar,ids}')=50
 AND octet_length((:'e5calcontext')::jsonb::text)<=8192
 AND (:'e5calcontext') NOT LIKE '%Original Calendar commitment%',
 'EXP05 compact native observation retains ALL fifty original IDs, no copied private text');
SELECT pg_temp.check(pg_temp.planning_stage((:'e5calturn')::jsonb->>'turn_id',pg_temp.tok('E5-calendar'),(:'e5calbinding')::jsonb)->>'ok'='true'
 AND (SELECT read_context->'calendar'=(:'e5calcontext')::jsonb->'calendar' FROM public.team_hub_agent_turns WHERE id=((:'e5calturn')::jsonb->>'turn_id')::uuid),
 'EXP05 native revalidation retains the same original Calendar observations');
SELECT pg_temp.planning_binding(:'u3',:'ta','{}') AS e5calplanning \gset
SELECT pg_temp.check(pg_temp.planning_stage((:'e5calturn')::jsonb->>'turn_id',pg_temp.tok('E5-calendar'),(:'e5calplanning')::jsonb)->>'ok'='true',
 'EXP05 same native context accepts original Planning after Calendar');
SELECT pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,''["crm_list_tasks"]'',''[]'')',
 (:'e5calturn')::jsonb->>'turn_id',pg_temp.h(pg_temp.tok('E5-calendar'))),'service_role') AS e5calthree \gset
SELECT read_context AS e5calthreecontext FROM public.team_hub_agent_turns WHERE id=((:'e5calturn')::jsonb->>'turn_id')::uuid \gset
SELECT pg_temp.check((:'e5calthree')::jsonb->>'ok'='true'
 AND jsonb_array_length((:'e5calthreecontext')::jsonb->'tools')=3
 AND (:'e5calthreecontext')::jsonb->'calendar'=(:'e5calcontext')::jsonb->'calendar'
 AND (:'e5calthreecontext')::jsonb ? 'planning','EXP05 one total three-source CRM/Planning/Calendar scope retains both original bindings');
SELECT pg_temp.check(pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,''["crm_get_task"]'',''[]'')',
 (:'e5calturn')::jsonb->>'turn_id',pg_temp.h(pg_temp.tok('E5-calendar'))),'service_role') ? 'error'
 AND (SELECT read_context=(:'e5calthreecontext')::jsonb FROM public.team_hub_agent_turns WHERE id=((:'e5calturn')::jsonb->>'turn_id')::uuid),
 'EXP05 fourth distinct private source refuses without losing original valid context');
SAVEPOINT e5cal_changed;
UPDATE public.internal_bookings SET end_at=end_at+interval '1 microsecond' WHERE id='e5ca0000-0000-4000-8000-000000000050';
SELECT pg_temp.check(pg_temp.planning_stage((:'e5calturn')::jsonb->>'turn_id',pg_temp.tok('E5-calendar'),(:'e5calbinding')::jsonb) ? 'error',
 'EXP05 microsecond edit to omitted original Calendar row prevents publication');
ROLLBACK TO e5cal_changed;
SELECT gen_random_uuid()::text AS e5calrequest \gset
SELECT pg_temp.apost(:'u3',:'ta',:'e5caldm','zion','Original Calendar commitments reviewed; this is a bounded preview.',:'e5calrequest',NULL,:'e5calq','dm',pg_temp.tok('E5-calendar')) AS e5calposted \gset
SELECT pg_temp.check((:'e5calposted')::jsonb->>'ok'='true','EXP05 original governed Calendar reply publishes');
SELECT pg_temp.check(pg_temp.apost(:'u3',:'ta',:'e5caldm','zion','Original Calendar commitments reviewed; this is a bounded preview.',:'e5calrequest',NULL,:'e5calq','dm',pg_temp.tok('E5-calendar'))#>>'{message,id}'
 =(:'e5calposted')::jsonb#>>'{message,id}','EXP05 Calendar lost acknowledgment returns original message without duplicate');
COMMIT;
BEGIN READ ONLY;
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5caldm')) AS e5calhistory \gset
SELECT pg_temp.check((:'e5calhistory') LIKE '%Original Calendar commitments reviewed%' AND (:'e5calhistory') NOT LIKE '%source_unavailable%true%',
 'EXP05 actual READ ONLY Calendar history reveals the original permitted answer');
COMMIT;
BEGIN;
SELECT to_jsonb(b) AS e5caldeleted FROM public.internal_bookings b WHERE id='e5ca0000-0000-4000-8000-000000000050' \gset
DELETE FROM public.internal_bookings WHERE id='e5ca0000-0000-4000-8000-000000000050';
COMMIT;
BEGIN READ ONLY;
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5caldm')) AS e5calrevoked \gset
SELECT pg_temp.check((:'e5calrevoked') NOT LIKE '%Original Calendar commitments reviewed%' AND (:'e5calrevoked') LIKE '%source_unavailable%',
 'EXP05 actual READ ONLY deletion beyond visible preview masks the historical answer');
SELECT pg_temp.j(:'u3',format('public.team_hub_search(%L::uuid,''Calendar commitments'')',:'ta')) AS e5calsearch \gset
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements((:'e5calsearch')::jsonb->'results') r
 WHERE r->>'message_id'=(:'e5calposted')::jsonb#>>'{message,id}'),'EXP05 revoked original Calendar source stays out of Search');
COMMIT;
INSERT INTO public.internal_bookings SELECT (jsonb_populate_record(NULL::public.internal_bookings,(:'e5caldeleted')::jsonb)).*;
BEGIN READ ONLY;
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5caldm')) AS e5calrestored \gset
SELECT pg_temp.check(EXISTS(SELECT 1 FROM jsonb_array_elements((:'e5calrestored')::jsonb->'messages') r
 WHERE r->>'id'=(:'e5calposted')::jsonb#>>'{message,id}' AND r->>'body' LIKE 'Original Calendar commitments reviewed%'),
 'EXP05 restoration reveals the SAME original reply without another operation');
COMMIT;
\echo 'PASS: EXP05 Calendar native closed binding, compact full references, microsecond recheck, original publication/replay and real READ ONLY history/Search'
-- Restore the exact original roster before the incumbent Planning publication
-- race and READ ONLY controls run. Their accepted bindings must stay current.
UPDATE public.paige_subagents SET config=(:'e5calroster')::jsonb WHERE tenant_id IS NULL AND slug='zion';
