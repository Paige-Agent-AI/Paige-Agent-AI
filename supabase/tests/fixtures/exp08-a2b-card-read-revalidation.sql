-- Included after all original A2b assertions/mutants, before the disposable database is dropped.
-- Synthetic role/roster changes only; no authenticated customer evidence or production action.
RESET ROLE;
\ir ../../migrations/20271126030008_exp08_team_hub_card_read_revalidation.sql
\ir ../../migrations/20271126030008_exp08_team_hub_card_read_revalidation.sql
SELECT pg_temp.check((SELECT md5(prosrc)='a75a322d43e4cde08f5142d1eabf6ddb' FROM pg_proc
 WHERE oid='public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)'::regprocedure),
 'P1: forward native scope guard applies and replays without changing metadata');
SELECT pg_temp.check((SELECT md5(replace(regexp_replace(prosrc,
 E' -- EXP08 A2b card reads START:[\\s\\S]*? -- EXP08 A2b card reads END.\n',''),
 't.agent_key NOT IN (''merit'',''cura'',''vera'',''paige'',''zion'',''nexus'')',
 't.agent_key NOT IN (''merit'',''cura'',''vera'')'))='1c775f6c3c41b6cd32f01a52238933cb' FROM pg_proc
 WHERE oid='public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)'::regprocedure),
 'P1: whole original E04 private-read body inverse remains exact');

BEGIN;
UPDATE public.tenant_members SET role='admin',status='active' WHERE tenant_id=:'ta'::uuid AND user_id=:'u3'::uuid;
SELECT pg_temp.j(:'u3',format('public.team_hub_open_agent_dm(%L::uuid,%L)',:'ta','zion'))->>'channel_id' AS p1dm \gset
SELECT pg_temp.post(:'u3',:'ta',:'p1dm','Show my tasks')->'message'->>'id' AS p1q \gset
SELECT pg_temp.accept(:'ta',:'u3',:'p1dm',:'p1q','zion','dm',pg_temp.tok('P1')) AS p1accept \gset
SELECT pg_temp.check((:'p1accept')::jsonb->>'ok'='true','P1: original admin turn accepted') ;
SELECT pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
 (:'p1accept')::jsonb->>'turn_id',pg_temp.h(pg_temp.tok('P1')),'["crm_list_tasks"]','[]'),'service_role') AS p1stage \gset
SELECT pg_temp.check((:'p1stage')::jsonb->>'ok'='true','P1: current admin task read staged on original token');

-- The same accepted context is intentionally revalidated before each private continuation.
SELECT pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
 (:'p1accept')::jsonb->>'turn_id',pg_temp.h(pg_temp.tok('P1')),'["crm_list_tasks"]','[]'),'service_role') AS p1repeat \gset
SELECT pg_temp.check((:'p1repeat')::jsonb->>'ok'='true','P1: same authorized token can revalidate before continuation');
SAVEPOINT p1_ban;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=:'u3'::uuid;
SELECT pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
 (:'p1accept')::jsonb->>'turn_id',pg_temp.h(pg_temp.tok('P1')),'["crm_list_tasks"]','[]'),'service_role') AS p1ban \gset
SELECT pg_temp.check((:'p1ban')::jsonb ? 'error' AND EXISTS(SELECT 1 FROM public.tenant_members
 WHERE tenant_id=:'ta'::uuid AND user_id=:'u3'::uuid AND role='admin' AND status='active'),
 'P1: trusted ban refuses staging despite unchanged active admin membership');
ROLLBACK TO SAVEPOINT p1_ban;
SAVEPOINT p1_deleted;
UPDATE auth.users SET deleted_at=now() WHERE id=:'u3'::uuid;
SELECT pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
 (:'p1accept')::jsonb->>'turn_id',pg_temp.h(pg_temp.tok('P1')),'["crm_list_tasks"]','[]'),'service_role') AS p1deleted \gset
SELECT pg_temp.check((:'p1deleted')::jsonb ? 'error','P1: trusted actor deletion refuses staging');
ROLLBACK TO SAVEPOINT p1_deleted;

-- Demotion keeps the seat and DM active: the ordinary Team Hub seat gate alone would still post.
UPDATE public.tenant_members SET role='member' WHERE tenant_id=:'ta'::uuid AND user_id=:'u3'::uuid;
SAVEPOINT p1_native_mutant;
DO $mutant$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)'::regprocedure) INTO d;
 IF strpos(d,' PERFORM public._sales_invoice_actor(t.asker_user_id,t.tenant_id);')=0 THEN
  RAISE EXCEPTION 'P1 mutation anchor missing'; END IF;
 EXECUTE replace(d,' PERFORM public._sales_invoice_actor(t.asker_user_id,t.tenant_id);','');
END $mutant$;
SELECT pg_temp.apost(:'u3',:'ta',:'p1dm','zion','PRIVATE TASK DATA',gen_random_uuid()::text,NULL,:'p1q','dm',pg_temp.tok('P1')) AS p1mutant \gset
SELECT pg_temp.check((:'p1mutant')::jsonb->>'ok'='true' AND EXISTS(
 SELECT 1 FROM public.team_hub_messages WHERE channel_id=:'p1dm'::uuid AND body='PRIVATE TASK DATA'),
 'P1 mutation: removing native authority guard breaks the private-publication property');
ROLLBACK TO SAVEPOINT p1_native_mutant;
SELECT pg_temp.apost(:'u3',:'ta',:'p1dm','zion','PRIVATE TASK DATA',gen_random_uuid()::text,NULL,:'p1q','dm',pg_temp.tok('P1')) AS p1post \gset
SELECT pg_temp.check((:'p1post')::jsonb ? 'error' AND NOT EXISTS(
 SELECT 1 FROM public.team_hub_messages WHERE channel_id=:'p1dm'::uuid AND body='PRIVATE TASK DATA'),
 'P1: role lost after staging prevents native publication; no private message stored');
SELECT pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
 (:'p1accept')::jsonb->>'turn_id',pg_temp.h(pg_temp.tok('P1')),'["crm_list_tasks"]','[]'),'service_role') AS p1restage \gset
SELECT pg_temp.check((:'p1restage')::jsonb ? 'error','P1: demoted caller cannot stage again');

UPDATE public.tenant_members SET role='admin' WHERE tenant_id=:'ta'::uuid AND user_id=:'u3'::uuid;
SAVEPOINT p1_roster;
UPDATE public.paige_subagents SET config=jsonb_set(config,'{capability_scope,tools}',
 (config#>'{capability_scope,tools}')-'crm_list_tasks') WHERE tenant_id IS NULL AND slug='zion';
SELECT pg_temp.apost(:'u3',:'ta',:'p1dm','zion','PRIVATE TASK DATA',gen_random_uuid()::text,NULL,:'p1q','dm',pg_temp.tok('P1')) AS p1roster \gset
SELECT pg_temp.check((:'p1roster')::jsonb ? 'error','P1: revoked stored tool scope prevents native publication');
ROLLBACK TO SAVEPOINT p1_roster;
SAVEPOINT p1_account;
UPDATE public.profiles SET active_tenant_id=:'tb'::uuid WHERE user_id=:'u3'::uuid;
SELECT pg_temp.apost(:'u3',:'ta',:'p1dm','zion','PRIVATE TASK DATA',gen_random_uuid()::text,NULL,:'p1q','dm',pg_temp.tok('P1')) AS p1account \gset
SELECT pg_temp.check((:'p1account')::jsonb->>'ok' IS DISTINCT FROM 'true','P1: changed active workspace refuses original private publication');
ROLLBACK TO SAVEPOINT p1_account;
SELECT pg_temp.j(:'u3',format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
 (:'p1accept')::jsonb->>'turn_id',pg_temp.h(pg_temp.tok('P1')),'["crm_list_tasks"]','[]')) AS p1browser \gset
SELECT pg_temp.check((:'p1browser')::jsonb ? 'error','P1: browser cannot mint a private-read attestation');

CREATE FUNCTION pg_temp.card_read_post(actor text,tenant text,agent text,tools jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE dm text; q text; token text:=pg_temp.tok(gen_random_uuid()::text); accepted jsonb; staged jsonb;
BEGIN
 dm:=pg_temp.j(actor,format('public.team_hub_open_agent_dm(%L::uuid,%L)',tenant,agent))->>'channel_id';
 q:=pg_temp.post(actor,tenant,dm,'Read the original source')->'message'->>'id';
 accepted:=pg_temp.accept(tenant,actor,dm,q,agent,'dm',token);
 IF accepted->>'ok' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('accept',accepted); END IF;
 staged:=pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
  accepted->>'turn_id',pg_temp.h(token),tools,'[]'),'service_role');
 IF staged->>'ok' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('stage',staged); END IF;
 RETURN jsonb_build_object('stage',staged,'post',pg_temp.apost(actor,tenant,dm,agent,
  'Verified private answer',gen_random_uuid()::text,NULL,q,'dm',token));
END $$;
SELECT pg_temp.check(pg_temp.card_read_post(:'u3',:'ta','zion','["crm_list_tasks"]')->'post'->>'ok'='true',
 'P1: authorized ZION task read still publishes');
SELECT pg_temp.check(pg_temp.card_read_post(:'u3',:'ta','nexus','["growth_list"]')->'post'->>'ok'='true',
 'P1: authorized NEXUS original growth read still publishes');
SELECT pg_temp.check(pg_temp.card_read_post(:'u3',:'ta','paige','["crm_list_tasks","growth_list"]')->'post'->>'ok'='true',
 'P1: authorized PAIGE closed original read set still publishes');
SELECT pg_temp.check(pg_temp.card_read_post(:'u3',:'ta','nexus','["crm_list_tasks"]')->'stage' ? 'error',
 'P1: NEXUS cannot stage a task read outside its original scope');
SELECT pg_temp.check(pg_temp.card_read_post(:'u3',:'ta','paige','["agreement_list"]')->'stage' ? 'error',
 'P1: PAIGE cannot widen the closed A2b attestation set');
ROLLBACK;
-- P2: original UI cannot recover the approved/unsettled/unclaimed card, even after reload.
SELECT pg_temp.j(:'u3',format('public.team_hub_open_agent_dm(%L::uuid,%L)',:'ta','zion'))->>'channel_id' AS resumedm \gset
SELECT pg_temp.make_card(:'u3',:'ta',:'resumedm','zion','crm_cancel_task','task_cancel','P2 stranded resume') AS resumecard \gset
UPDATE public.team_hub_message_cards SET decision='approved',decided_at=now()-interval '15 seconds'
 WHERE message_id=((:'resumecard')::jsonb->>'card')::uuid;
SELECT pg_temp.cs(pg_temp.cstates(:'u3',:'ta',:'resumedm',ARRAY[(:'resumecard')::jsonb->>'card']),(:'resumecard')::jsonb->>'card')->'card' AS oldresume \gset
SELECT pg_temp.check((:'oldresume')::jsonb->>'state'='working' AND NOT ((:'oldresume')::jsonb ? 'can_resume')
 AND NOT ((:'oldresume')::jsonb#>'{actions,0}' ? 'fingerprint'),
 'P2 reproduction: approved unclaimed card has no reachable recovery binding');
\ir ../../migrations/20271126035008_exp08_team_hub_stranded_card_resume.sql
\ir ../../migrations/20271126035008_exp08_team_hub_stranded_card_resume.sql
BEGIN;
SELECT pg_temp.cs(pg_temp.cstates(:'u3',:'ta',:'resumedm',ARRAY[(:'resumecard')::jsonb->>'card']),(:'resumecard')::jsonb->>'card')->'card' AS newresume \gset
SELECT pg_temp.check((:'newresume')::jsonb->>'can_resume'='true'
 AND (:'newresume')::jsonb#>>'{actions,0,fingerprint}'=(:'resumecard')::jsonb->>'fp',
 'P2: exact approved unclaimed proposal recoverable by its original asker');
SAVEPOINT resume_other_reader;
SELECT pg_temp.peek(:'resumedm',:'ta',:'u2');
SELECT pg_temp.cs(pg_temp.cstates(:'u2',:'ta',:'resumedm',ARRAY[(:'resumecard')::jsonb->>'card']),(:'resumecard')::jsonb->>'card')->'card' AS otherresume \gset
SELECT pg_temp.check((:'otherresume')::jsonb->>'can_resume'='false'
 AND NOT ((:'otherresume')::jsonb#>'{actions,0}' ? 'fingerprint'),
 'P2: even a hostile visible non-approver cannot receive a resume binding');
ROLLBACK TO SAVEPOINT resume_other_reader;
SAVEPOINT resume_settled;
UPDATE public.team_hub_message_cards SET outcome='unconfirmed',settled_at=now() WHERE message_id=((:'resumecard')::jsonb->>'card')::uuid;
SELECT pg_temp.cs(pg_temp.cstates(:'u3',:'ta',:'resumedm',ARRAY[(:'resumecard')::jsonb->>'card']),(:'resumecard')::jsonb->>'card')->'card' AS settledresume \gset
SELECT pg_temp.check((:'settledresume')::jsonb->>'can_resume'='false','P2: settled unknown outcome never permits a retry');
ROLLBACK TO SAVEPOINT resume_settled;
SAVEPOINT resume_claimed;
UPDATE public.paige_pending_confirmations SET consumed_at=now() WHERE id=((:'resumecard')::jsonb->>'conf')::uuid;
SELECT pg_temp.cs(pg_temp.cstates(:'u3',:'ta',:'resumedm',ARRAY[(:'resumecard')::jsonb->>'card']),(:'resumecard')::jsonb->>'card')->'card' AS claimedresume \gset
SELECT pg_temp.check((:'claimedresume')::jsonb->>'can_resume'='false'
 AND NOT ((:'claimedresume')::jsonb#>'{actions,0}' ? 'fingerprint'),
 'P2: claimed/unknown execution cannot be resumed or duplicate an effect');
ROLLBACK TO SAVEPOINT resume_claimed;
SAVEPOINT resume_recent;
UPDATE public.team_hub_message_cards SET decided_at=now() WHERE message_id=((:'resumecard')::jsonb->>'card')::uuid;
SELECT pg_temp.cs(pg_temp.cstates(:'u3',:'ta',:'resumedm',ARRAY[(:'resumecard')::jsonb->>'card']),(:'resumecard')::jsonb->>'card')->'card' AS recentresume \gset
SELECT pg_temp.check((:'recentresume')::jsonb->>'can_resume'='false','P2: first request retains its10second bounded attempt window');
ROLLBACK TO SAVEPOINT resume_recent;
SAVEPOINT resume_expired;
UPDATE public.paige_pending_confirmations SET expires_at=now()-interval '1 second' WHERE id=((:'resumecard')::jsonb->>'conf')::uuid;
SELECT pg_temp.cs(pg_temp.cstates(:'u3',:'ta',:'resumedm',ARRAY[(:'resumecard')::jsonb->>'card']),(:'resumecard')::jsonb->>'card')->'card' AS expiredresume \gset
SELECT pg_temp.check((:'expiredresume')::jsonb->>'can_resume'='false','P2: expired proposal cannot resume');
ROLLBACK TO SAVEPOINT resume_expired;
ROLLBACK;
\ir ../exp10_nexus_team_hub_connection_read.sql
\echo 'PASS: P1 card-read guard replay, original peer body inverse, staged admin read, demotion and roster revocation'
