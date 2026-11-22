-- Original A2b disposable transaction only. Native writer/CAS/card procedures are
-- REAL; exact proposals, provider readbacks and fixture actors are synthetic.
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
SELECT jsonb_build_object('scheduled_for',to_char(date_trunc('minute',clock_timestamp()+interval '2 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'timezone','UTC','civil_time',to_char(date_trunc('minute',clock_timestamp()+interval '2 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI'),
 'offset_minutes',0,'disambiguation','unique') AS e07time \gset
SELECT pg_temp.exp07_prepare(:'u1',:'ta',:'e07dm','nexus','E07 schedule',future=>(:'e07time')::jsonb) AS e07schedule \gset
SELECT pg_temp.check((:'e07schedule')::jsonb#>>'{result,ok}'='true','EXP07 schedule: exact future proposal uses the original private NEXUS card');
SELECT pg_temp.decide(:'u1',:'ta',(:'e07schedule')::jsonb->>'card','approve',(:'e07schedule')::jsonb->>'fp');
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp() WHERE id=((:'e07schedule')::jsonb->>'conf')::uuid;
SELECT (public.content_publication_bind(NULL,:'ta','00000000-0000-4000-8000-00000000e071','threads',NULL,
 ((:'e07schedule')::jsonb->>'conf')::uuid,(SELECT args FROM public.paige_pending_confirmations WHERE id=((:'e07schedule')::jsonb->>'conf')::uuid))).id AS e07job \gset
SELECT public.content_publication_record(:'e07job',:'ta','publishing');
SELECT public.content_publication_record(:'e07job',:'ta','scheduled',p_provider_request_id=>'fixture-scheduled-job',p_provider_response=>
 jsonb_build_object('schedule',jsonb_build_object('current',(:'e07time')::jsonb,'version',1,'state','scheduled')));
SELECT pg_temp.check((SELECT status='scheduled' AND provider_post_id IS NULL AND provider_post_url IS NULL FROM public.content_publications WHERE id=:'e07job'),
 'EXP07 schedule: provider acceptance is scheduled, never fabricated publication');
SELECT pg_temp.check(pg_temp.settle(:'u1',:'ta',(:'e07schedule')::jsonb->>'card','{"state":"done","note":"The exact future instruction was accepted. Publication is not confirmed."}')->>'ok'='true',
 'EXP07 schedule: exact native future instruction can settle the original card without claiming publication');
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
CREATE TEMP TABLE e07_schedule_ids AS SELECT :'ta'::uuid AS tenant,:'u1'::uuid AS actor,:'e07job'::uuid AS publication;
DO $schedule$
DECLARE r public.content_publications; original_args jsonb; previous jsonb; next_time jsonb; proposal uuid; mutation jsonb; response jsonb; old_approval text;
BEGIN
 SELECT * INTO r FROM public.content_publications WHERE id=(SELECT publication FROM e07_schedule_ids);
 original_args:=r.request_args; old_approval:=r.confirmation_id::text; previous:=r.provider_response->'schedule'->'current';
 next_time:=previous||jsonb_build_object('scheduled_for',to_char(((previous->>'scheduled_for')::timestamptz+interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'civil_time',to_char(((previous->>'scheduled_for')::timestamptz+interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI'));
 BEGIN
  PERFORM public.content_publication_bind(NULL,r.tenant_id,r.content_id,r.platform,r.connection_id,gen_random_uuid(),r.request_args);
  RAISE EXCEPTION 'Scheduled job was admitted as another post';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 proposal:=pg_temp.proposal((SELECT actor::text FROM e07_schedule_ids),r.tenant_id::text,'social.post_publish','E07 native reschedule');
 UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp(),args=original_args||jsonb_build_object('operation','reschedule','publication_id',r.id,
   'publication_version',1,'previous_schedule',previous::text,'schedule',next_time::text,'provider_request_id',r.provider_request_id) WHERE id=proposal;
 mutation:=jsonb_build_object('confirmation_id',proposal,'expected_version',1,'operation','reschedule','previous_schedule',previous,'next_schedule',next_time,'approved_by',(SELECT actor FROM e07_schedule_ids));
 BEGIN
  PERFORM public.content_publication_record(r.id,r.tenant_id,'schedule_changing',p_provider_request_id=>r.provider_request_id,p_provider_response=>jsonb_build_object('schedule_claim',mutation-'expected_version'));
  RAISE EXCEPTION 'Missing version claimed a schedule';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 PERFORM public.content_publication_record(r.id,r.tenant_id,'schedule_changing',p_provider_request_id=>r.provider_request_id,p_provider_response=>jsonb_build_object('schedule_claim',mutation));
 BEGIN
  PERFORM public.content_publication_record(r.id,r.tenant_id,'schedule_changing',p_provider_request_id=>r.provider_request_id,p_provider_response=>jsonb_build_object('schedule_claim',mutation));
  RAISE EXCEPTION 'One native schedule version was claimed twice';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 response:=jsonb_build_object('schedule',jsonb_build_object('current',next_time,'version',2,'state','scheduled','mutation',mutation));
 BEGIN
  PERFORM public.content_publication_record(r.id,r.tenant_id,'scheduled',p_provider_request_id=>'another-job',p_provider_response=>response);
  RAISE EXCEPTION 'A change switched the provider job';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 r:=public.content_publication_record(r.id,r.tenant_id,'scheduled',p_provider_request_id=>r.provider_request_id,p_provider_response=>response);
 IF r.request_args<>original_args OR r.provider_response->'schedule'->>'version'<>'2'
  OR r.provider_response->'schedule'->'approvals'->old_approval->>'state'<>'scheduled' THEN RAISE EXCEPTION 'Rescheduling rewrote original approval/source/history'; END IF;
 -- Same-ID reconciliation is idempotent; a fresh consumed approval is mandatory for cancellation.
 PERFORM public.content_publication_record(r.id,r.tenant_id,'scheduled',p_provider_request_id=>r.provider_request_id,p_provider_response=>response||'{"reconciled":true}');
 previous:=next_time;
 proposal:=pg_temp.proposal((SELECT actor::text FROM e07_schedule_ids),r.tenant_id::text,'social.post_publish','E07 native cancel');
 UPDATE public.paige_pending_confirmations SET args=original_args||jsonb_build_object('operation','cancel_schedule','publication_id',r.id,
   'publication_version',2,'previous_schedule',previous::text,'schedule',previous::text,'provider_request_id',r.provider_request_id) WHERE id=proposal;
 mutation:=jsonb_build_object('confirmation_id',proposal,'expected_version',2,'operation','cancel_schedule','previous_schedule',previous,'next_schedule',previous,'approved_by',(SELECT actor FROM e07_schedule_ids));
 BEGIN
  PERFORM public.content_publication_record(r.id,r.tenant_id,'schedule_changing',p_provider_request_id=>r.provider_request_id,p_provider_response=>jsonb_build_object('schedule_claim',mutation));
  RAISE EXCEPTION 'An unconsumed cancellation was accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp() WHERE id=proposal;
 PERFORM public.content_publication_record(r.id,r.tenant_id,'schedule_changing',p_provider_request_id=>r.provider_request_id,p_provider_response=>jsonb_build_object('schedule_claim',mutation));
 response:=jsonb_build_object('schedule',jsonb_build_object('current',previous,'version',3,'state','outcome_unknown','mutation',mutation));
 PERFORM public.content_publication_record(r.id,r.tenant_id,'outcome_unknown',p_provider_request_id=>r.provider_request_id,p_provider_response=>response);
 r:=public.content_publication_record(r.id,r.tenant_id,'cancelled',p_provider_request_id=>r.provider_request_id,p_provider_response=>
   jsonb_set(response||'{"reconciled":true}','{schedule,state}','"cancelled"'));
 IF r.status<>'cancelled' OR r.provider_request_id<>'fixture-scheduled-job' OR r.request_args<>original_args
  OR r.provider_post_id IS NOT NULL OR r.provider_post_url IS NOT NULL THEN RAISE EXCEPTION 'Cancellation changed identity or claimed a live post'; END IF;
 RAISE NOTICE 'PASS: EXP07 native same-job schedule/edit/CAS/unknown/cancel/original-history contract';
END $schedule$;
DELETE FROM public.paige_pending_confirmations WHERE id=((:'e07schedule')::jsonb->>'conf')::uuid;
SELECT pg_temp.check(pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'e07dm',ARRAY[(:'e07schedule')::jsonb->>'card']),(:'e07schedule')::jsonb->>'card')#>>'{social_reference,publication_id}'=:'e07job',
 'EXP07 schedule: original private card reopens the same receipt after schedule edits and proposal cleanup');
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
SELECT pg_temp.exp07_prepare(:'u1',:'ta',:'e07dm','nexus','E07 publication race',future=>(:'e07time')::jsonb) AS e07race \gset
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp() WHERE id=((:'e07race')::jsonb->>'conf')::uuid;
SELECT (public.content_publication_bind(NULL,:'ta','00000000-0000-4000-8000-00000000e071','threads',NULL,((:'e07race')::jsonb->>'conf')::uuid,
 (SELECT args FROM public.paige_pending_confirmations WHERE id=((:'e07race')::jsonb->>'conf')::uuid))).id AS e07racejob \gset
SELECT public.content_publication_record(:'e07racejob',:'ta','publishing');
SELECT public.content_publication_record(:'e07racejob',:'ta','scheduled',p_provider_request_id=>'fixture-race-job',p_provider_response=>jsonb_build_object('schedule',
 jsonb_build_object('current',(:'e07time')::jsonb,'version',1,'state','scheduled')));
-- A newer saved draft must not replace the queued caption/media or prevent its
-- approver from controlling the SAME original receipt.
UPDATE public.marketing_content SET updated_at='2026-11-14T12:00:00Z' WHERE id='00000000-0000-4000-8000-00000000e071';
SELECT pg_temp.exp07_prepare(:'u1',:'ta',:'e07dm','nexus','E07 late cancel',future=>(:'e07time')::jsonb,original_job=>:'e07racejob',change_operation=>'cancel_schedule',expected_version=>1) AS e07cancelrace \gset
SELECT pg_temp.check((:'e07cancelrace')::jsonb#>>'{result,ok}'='true','EXP07 schedule: private change card binds original receipt even after saved draft revision changes');
SELECT pg_temp.decide(:'u1',:'ta',(:'e07cancelrace')::jsonb->>'card','approve',(:'e07cancelrace')::jsonb->>'fp');
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp() WHERE id=((:'e07cancelrace')::jsonb->>'conf')::uuid;
SELECT jsonb_build_object('confirmation_id',(:'e07cancelrace')::jsonb->>'conf','expected_version',1,'operation','cancel_schedule','previous_schedule',(:'e07time')::jsonb,
 'next_schedule',(:'e07time')::jsonb,'approved_by',:'u1') AS e07racemutation \gset
SELECT public.content_publication_record(:'e07racejob',:'ta','schedule_changing',p_provider_request_id=>'fixture-race-job',p_provider_response=>jsonb_build_object('schedule_claim',(:'e07racemutation')::jsonb));
SELECT public.content_publication_record(:'e07racejob',:'ta','published',p_provider_request_id=>'fixture-race-job',p_provider_post_id=>'fixture-already-live',p_provider_post_url=>'https://www.threads.com/@fixture/post/already-live',
 p_provider_response=>jsonb_build_object('schedule',jsonb_build_object('current',(:'e07time')::jsonb,'version',2,'state','published','mutation',(:'e07racemutation')::jsonb)));
SELECT pg_temp.check(pg_temp.settle(:'u1',:'ta',(:'e07cancelrace')::jsonb->>'card','{"state":"done"}')->>'ok'='false',
 'EXP07 schedule: publication race cannot become a successful cancellation');
SELECT pg_temp.check(pg_temp.settle(:'u1',:'ta',(:'e07cancelrace')::jsonb->>'card','{"state":"unconfirmed","note":"The original post is already live; cancellation was not confirmed."}')->>'ok'='true',
 'EXP07 schedule: late-cancel card truthfully retains unconfirmed change outcome');
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
DELETE FROM public.paige_pending_confirmations WHERE id=((:'e07cancelrace')::jsonb->>'conf')::uuid;
SELECT pg_temp.check(pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'e07dm',ARRAY[(:'e07cancelrace')::jsonb->>'card']),(:'e07cancelrace')::jsonb->>'card')#>>'{social_reference,publication_id}'=:'e07racejob',
 'EXP07 schedule: a consumed change card preserves its original publication reference after proposal cleanup');
RESET ROLE;
SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.sub','',false);
