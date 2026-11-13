-- Runs ONLY inside the original EXP08 disposable A2b database, after every incumbent proof/mutant.
-- Real: original native Social/Hub functions, carrier34, caller roles and accepted-turn protocol.
-- Synthetic: Content tables, people, proposals and provider results. No model, provider or customer QA.
\o /dev/null
\ir exp07-social-card-foundation.sql
-- pg_node_tree records parser byte positions; compare the same public default
-- expressions separately, while retaining every other native metadata field.
CREATE TEMP TABLE exp07_native_before AS SELECT oid,to_jsonb(p)-'prosrc'-'proargdefaults' AS metadata,
 pg_get_expr(p.proargdefaults,0) AS defaults FROM pg_proc p WHERE p.oid IN (
 'public.content_publication_bind(uuid,uuid,uuid,text,uuid,uuid,jsonb)'::regprocedure,
 'public.content_publication_list(uuid,uuid)'::regprocedure,
 'public.content_publication_record(uuid,uuid,text,text,text,text,text,jsonb)'::regprocedure,
 'public._team_hub_card_scope_guard()'::regprocedure,
 'public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)'::regprocedure,
 'public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)'::regprocedure,
 'public.team_hub_settle_card(uuid,uuid,uuid,jsonb)'::regprocedure,
 'public.team_hub_card_states(uuid,uuid,uuid[])'::regprocedure);
CREATE TEMP TABLE exp07_roster_before AS SELECT config FROM public.paige_subagents WHERE tenant_id IS NULL AND slug='nexus';
\ir ../../migrations/20271133000034_exp07_media_snapshot_receipt_compatibility.sql
\ir ../../migrations/20271133000034_exp07_media_snapshot_receipt_compatibility.sql
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM exp07_native_before b LEFT JOIN pg_proc p ON p.oid=b.oid
 WHERE p.oid IS NULL OR to_jsonb(p)-'prosrc'-'proargdefaults'<>b.metadata OR pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM b.defaults),
 'EXP07: full carrier applies/replays without changing native signatures/defaults/owners/ACLs/metadata');
SELECT pg_temp.check((SELECT (a.config#-'{capability_scope,tools}')=(b.config#-'{capability_scope,tools}')
 AND a.config#>'{capability_scope,tools}'=(b.config#>'{capability_scope,tools}')||'["read_social_publication","social_post_publish"]'::jsonb
 FROM public.paige_subagents a CROSS JOIN exp07_roster_before b WHERE a.slug='nexus' AND a.tenant_id IS NULL),
 'EXP07: original NEXUS config/other tools preserved, closed pair appended once');

BEGIN;
INSERT INTO public.marketing_content(id,tenant_id,updated_at,status) VALUES
 ('00000000-0000-4000-8000-00000000e071',:'ta','2026-11-13T12:00:00Z','draft');
CREATE FUNCTION pg_temp.exp07_prepare(actor text,tenant text,channel text,agent text,label text,stage boolean DEFAULT true,revision text DEFAULT '2026-11-13T12:00:00Z',future jsonb DEFAULT NULL,original_job uuid DEFAULT NULL,change_operation text DEFAULT NULL,expected_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE q text; accepted jsonb; c uuid; posted jsonb; staged jsonb; token text:=pg_temp.tok(label);
BEGIN
 q:=pg_temp.post(actor,tenant,channel,'Review the original saved Social post')#>>'{message,id}';
 accepted:=pg_temp.accept(tenant,actor,channel,q,agent,'dm',token);
 IF accepted->>'ok' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('phase','accept','result',accepted); END IF;
 IF stage THEN
  staged:=pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
   accepted->>'turn_id',pg_temp.h(token),'["read_social_publication"]','[]'),'service_role');
  IF staged->>'ok' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('phase','stage','result',staged); END IF;
 END IF;
 c:=pg_temp.proposal(actor,tenant,'social.post_publish',label);
 UPDATE public.paige_pending_confirmations SET args=jsonb_build_object('content_id','00000000-0000-4000-8000-00000000e071',
  'content_revision',revision,'caption','Exact fixture caption','platform','threads','account_id','00000000-0000-4000-8000-00000000e072',
  'connection_id','00000000-0000-4000-8000-00000000e073','channel_id',NULL,'channel_label','Fixture destination',
  'provider_account_id','fixture-provider','profile_key','fixture-profile')
  ||CASE WHEN future IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('schedule',future::text,'schedule_version',1,'connection_generation','2026-11-13T12:00:00Z') END
  ||CASE WHEN original_job IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('operation',change_operation,'publication_id',original_job,'publication_version',expected_version,
    'provider_request_id',(SELECT provider_request_id FROM public.content_publications WHERE id=original_job),
    'previous_schedule',(SELECT provider_response->'schedule'->'current' FROM public.content_publications WHERE id=original_job)::text) END WHERE id=c;
 posted:=pg_temp.apost(actor,tenant,channel,agent,'Review the original Social proposal',gen_random_uuid()::text,NULL,q,'dm',token,c::text,'social_publish',NULL,false,
  CASE WHEN future IS NULL THEN 'Publish the saved fixture post to its verified original destination.' ELSE coalesce(change_operation,'Schedule')||' the exact saved fixture post for '||(future->>'scheduled_for') END);
 RETURN jsonb_build_object('phase','post','result',posted,'q',q,'conf',c,'fp',pg_temp.fp(label),'card',posted#>>'{message,id}');
END $$;
SELECT pg_temp.j(:'u1',format('public.team_hub_open_agent_dm(%L::uuid,%L)',:'ta','nexus'))->>'channel_id' AS e07dm \gset
SELECT pg_temp.exp07_prepare(:'u1',:'ta',:'e07dm','nexus','E07 original') AS e07 \gset
SELECT pg_temp.check((:'e07')::jsonb#>>'{result,ok}'='true','EXP07: original native accepted NEXUS DM links exactly one Social proposal');
SELECT pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'e07dm',ARRAY[(:'e07')::jsonb->>'card']),(:'e07')::jsonb->>'card') AS e07read \gset
SELECT pg_temp.check((:'e07read')::jsonb->'social_reference'=jsonb_build_object('schema',1,'tenant_id',:'ta',
 'content_id','00000000-0000-4000-8000-00000000e071','content_revision','2026-11-13T12:00:00Z','publication_id',NULL)
 AND NOT ('args'=ANY(pg_temp.all_keys((:'e07read')::jsonb))) AND NOT ('profile_key'=ANY(pg_temp.all_keys((:'e07read')::jsonb))),
 'EXP07: protected card read carries only exact original IDs/revision and preserves original approval context');
SELECT pg_temp.check(pg_temp.exp07_prepare(:'u1',:'ta',:'e07dm','nexus','E07 no read',false)#>>'{result,ok}' IS DISTINCT FROM 'true'
 AND pg_temp.exp07_prepare(:'u1',:'ta',:'e07dm','nexus','E07 changed',true,'2026-11-12T12:00:00Z')#>>'{result,ok}' IS DISTINCT FROM 'true',
 'EXP07: missing original read and changed content revision cannot post a card');
SELECT pg_temp.j(:'u1',format('public.team_hub_open_agent_dm(%L::uuid,%L)',:'ta','zion'))->>'channel_id' AS e07wrongdm \gset
SELECT pg_temp.check(pg_temp.exp07_prepare(:'u1',:'ta',:'e07wrongdm','zion','E07 wrong agent')#>>'{result,ok}' IS DISTINCT FROM 'true',
 'EXP07: another specialist cannot stage this private Social read/card');
SELECT pg_temp.check(pg_temp.decide(:'u1',:'ta',(:'e07')::jsonb->>'card','approve',(:'e07')::jsonb->>'fp')->>'ok'='true',
 'EXP07: original approver/fingerprint decision remains authoritative');
SELECT pg_temp.check(pg_temp.settle(:'u1',:'ta',(:'e07')::jsonb->>'card','{"state":"done"}')->>'ok'='false',
 'EXP07: no publication cannot become Done');
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp() WHERE id=((:'e07')::jsonb->>'conf')::uuid;
SELECT (public.content_publication_bind(NULL,:'ta','00000000-0000-4000-8000-00000000e071','threads',NULL,
 ((:'e07')::jsonb->>'conf')::uuid,(SELECT args FROM public.paige_pending_confirmations WHERE id=((:'e07')::jsonb->>'conf')::uuid))).id AS e07publication \gset
SELECT public.content_publication_record(:'e07publication',:'ta','publishing');
SELECT public.content_publication_record(:'e07publication',:'ta','outcome_unknown',p_provider_request_id=>'fixture-request');
SELECT pg_temp.check(pg_temp.settle(:'u1',:'ta',(:'e07')::jsonb->>'card','{"state":"failed"}')->>'ok'='false',
 'EXP07: unknown original publication cannot settle as nothing-ran');
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
SELECT public.content_publication_record(:'e07publication',:'ta','published',p_provider_post_id=>'fixture-native-post',
 p_provider_post_url=>'https://www.threads.com/@fixture/post/original',p_provider_request_id=>'fixture-request',p_provider_response=>'{"reconciled":true}');
SELECT pg_temp.check(pg_temp.settle(:'u1',:'ta',(:'e07')::jsonb->>'card','{"state":"done","note":"Original native publication verified."}')->>'ok'='true',
 'EXP07: same original approval/publication readback permits Done');
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
DELETE FROM public.paige_pending_confirmations WHERE id=((:'e07')::jsonb->>'conf')::uuid;
SELECT pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'e07dm',ARRAY[(:'e07')::jsonb->>'card']),(:'e07')::jsonb->>'card') AS e07done \gset
SELECT pg_temp.check((:'e07done')::jsonb#>>'{card,state}'='done'
 AND (:'e07done')::jsonb#>>'{card,actions,0,summary}'='Publish the saved fixture post to its verified original destination.'
 AND (:'e07done')::jsonb#>>'{social_reference,publication_id}'=:'e07publication'
 AND (:'e07done')::jsonb#>>'{social_reference,content_id}'='00000000-0000-4000-8000-00000000e071',
 'EXP07: original receipt identity survives consumed-proposal cleanup without another store');
\ir ../exp07_social_schedules.sql
ROLLBACK;
\o
\echo 'PASS: EXP07 full carrier34 native private Social card/receipt compatibility and replay'
