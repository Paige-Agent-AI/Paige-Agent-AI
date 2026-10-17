-- Native read-association proof. This disposable fixture uses actual Knowledge
-- submit/save/stage/promotion/read functions. Auth/pg_net/vector/Rail dependencies
-- remain the incumbent local stand-ins; no provider call or hosted identity proof.
RESET ROLE;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SET ROLE service_role;
INSERT INTO public.extract_test VALUES('association',public.test_extract('70000000-0000-0000-0000-000000000040',NULL,NULL,'Recoverable reviewed text'),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='association';
SELECT public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Recoverable reviewed text',started->>'input_hash') FROM public.extract_test WHERE name='association';
RESET ROLE;
CREATE FUNCTION public.test_publication_review() RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
 SELECT public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',
   (SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='association')) $$;
CREATE FUNCTION public.test_publication_ref() RETURNS uuid LANGUAGE sql SECURITY INVOKER AS $$
 SELECT (started#>>'{publication,work_id}')::uuid FROM public.extract_test WHERE name='association' $$;
GRANT EXECUTE ON FUNCTION public.test_publication_review() TO authenticated;
SET ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='unavailable','unsaved extraction is never a saved publication intent');
SELECT public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(result->>'document_id')::uuid,(result->>'work_id')::uuid,2,'Recoverable reviewed text','{"title":"Neutral recovery source","summary":null,"category":null,"tags":[]}') FROM public.extract_test WHERE name='association';
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='not_submitted','saved review with zero matching AND zero unresolved publications is explicitly not submitted');
SELECT public.test_assert(public.test_publication_review()->'publication'=jsonb_build_object('contract_version',1,'association','not_submitted','work_id',NULL,'work_status',NULL,'generation_id',NULL,'outcome',NULL),'no guessed intent, reference, receipt or prior generation in not-submitted response');
SELECT public.test_assert((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(public.test_publication_review()-'publication') key)=ARRAY['document_id','extraction_source_binding','extraction_work_id','pending_review','record_state','revision','source_binding','source_coverage','tenant_id'],'all nine original projection fields preserved');
RESET ROLE;
SELECT public.test_assert((SELECT revision=3 AND pending_review->>'reviewed_content'='Recoverable reviewed text' FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='association')),'reading recovery did not mutate saved review');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'document_id'=(SELECT result->>'document_id' FROM public.extract_test WHERE name='association')),'reading no publication creates no work');
SET ROLE authenticated;
UPDATE public.extract_test SET started=started||jsonb_build_object('publication',public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(result->>'document_id')::uuid,(result->>'work_id')::uuid,3,'60000000-0000-0000-0000-000000000040',encode(sha256(convert_to('Recoverable reviewed text','UTF8')),'hex'))) WHERE name='association';
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='matched' AND public.test_publication_review()#>>'{publication,work_id}'=public.test_publication_ref()::text AND public.test_publication_review()#>>'{publication,work_status}'='claimed','reload discovers original claimed publication without its volatile acknowledgement');
SELECT public.test_assert(public.test_publication_review()#>'{publication,generation_id}'='null'::jsonb AND public.test_publication_review()#>'{publication,outcome}'='null'::jsonb,'pending publication never borrows a generation or receipt');
SELECT public.test_assert((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(public.test_publication_review()->'publication') key)=ARRAY['association','contract_version','generation_id','outcome','work_id','work_status'],'association excludes raw request, provider, intent and authority payloads');
SELECT public.test_denied($q$SELECT public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(result->>'document_id')::uuid,(result->>'work_id')::uuid,3,'60000000-0000-0000-0000-000000000041',encode(sha256(convert_to('Recoverable reviewed text','UTF8')),'hex')) FROM public.extract_test WHERE name='association'$q$,'KNOWLEDGE_PUBLICATION_PENDING');
RESET ROLE;
-- Real native start/settle, no provider dispatch. Rollback restores the held work.
BEGIN;
DO $$ DECLARE s jsonb:=public.start_knowledge_publication(public.test_publication_ref()); BEGIN
 PERFORM public.settle_knowledge_publication_failure(public.test_publication_ref(),s->>'server_key',(s->>'attempt')::int,'completion_unknown',true); END $$;
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='matched' AND public.test_publication_review()#>>'{publication,work_status}'='outcome_unknown','uncertain native execution remains exact original work, never not submitted');
ROLLBACK;
BEGIN;
DO $$ DECLARE s jsonb:=public.start_knowledge_publication(public.test_publication_ref()); BEGIN
 PERFORM public.settle_knowledge_publication_failure(public.test_publication_ref(),s->>'server_key',(s->>'attempt')::int,'embedding_failed',false); END $$;
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='matched' AND public.test_publication_review()#>>'{publication,work_status}'='failed' AND public.test_publication_review()#>'{publication,generation_id}'='null'::jsonb,'known native failure preserves saved review and no promoted generation');
ROLLBACK;
BEGIN;
UPDATE public.paige_durable_work SET status='cancelled',terminal_outcome='{"reason":"cancelled"}',settled_at=now() WHERE id=public.test_publication_ref();
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='matched' AND public.test_publication_review()#>>'{publication,work_status}'='cancelled','cancelled nonpromoted native envelope is not absence or success');
ROLLBACK;
BEGIN;
UPDATE public.paige_durable_work SET status='blocked',blocked_reason='authority_changed' WHERE id=public.test_publication_ref();
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='matched' AND public.test_publication_review()#>>'{publication,work_status}'='blocked','blocked native publication remains linked');
ROLLBACK;
BEGIN;
UPDATE public.paige_durable_work SET status='expired' WHERE id=public.test_publication_ref();
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,work_status}'='expired','expired native publication remains linked for incumbent recovery');
ROLLBACK;
-- Unrelated initiator read remains governed by get_paige_durable_work.
BEGIN;
INSERT INTO public.test_members VALUES('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001',true);
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='unavailable' AND public.test_publication_review()#>'{publication,work_id}'='null'::jsonb,'member may read original review but cannot discover another initiator private work');
RESET ROLE;
UPDATE public.tenant_members SET role='owner',is_owner=true WHERE user_id='10000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,work_id}'=public.test_publication_ref()::text,'ordinary active owner with no global admin uses incumbent owner visibility');
ROLLBACK;
BEGIN;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='unavailable','current actor revocation never appears as no submitted work');
ROLLBACK;
BEGIN;
UPDATE public.tenant_members SET status='inactive' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='unavailable','current native membership drift blocks association');
ROLLBACK;
BEGIN;
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.test_denied($q$SELECT public.test_publication_review()$q$,'KNOWLEDGE_SCOPE_CHANGED');
ROLLBACK;
SET ROLE authenticated;
SELECT public.test_denied($q$SELECT public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002')$q$,'KNOWLEDGE_NOT_FOUND');
RESET ROLE;
-- Malformed stored-envelope controls deliberately bypass only the fixture's
-- immutable-identity trigger within rollback transactions. No production writer
-- or privilege is changed; normal authenticated callers cannot perform this.
CREATE FUNCTION public.test_corrupt_publication(patch jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE 'ALTER TABLE public.paige_durable_work DISABLE TRIGGER trg_paige_durable_work_identity';
 UPDATE public.paige_durable_work SET request_payload=request_payload||patch WHERE id=public.test_publication_ref();
 EXECUTE 'ALTER TABLE public.paige_durable_work ENABLE TRIGGER trg_paige_durable_work_identity';
END $$;
DO $$ DECLARE patch jsonb; BEGIN
 FOR patch IN SELECT value FROM jsonb_array_elements('[
 {"review_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
 {"request_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
 {"extraction_work_id":"70000000-0000-0000-0000-000000000099"},
 {"revision":2},{"revision":"not-an-integer"},{"manifest":{}},{"source":{"unexpected":true}},{"version":2}
 ]'::jsonb) LOOP
  BEGIN
   PERFORM public.test_corrupt_publication(patch);
   PERFORM public.test_assert(public.test_publication_review()#>>'{publication,association}'='unavailable'
     AND public.test_publication_review()#>'{publication,work_id}'='null'::jsonb,'malformed or stale publication association fails closed: '||(SELECT string_agg(key,',') FROM jsonb_object_keys(patch) key));
   RAISE EXCEPTION 'rollback_fixture_case' USING errcode='P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; END;
 END LOOP;
END $$;
BEGIN;
INSERT INTO public.paige_durable_work SELECT (jsonb_populate_record(NULL::public.paige_durable_work,to_jsonb(w)||jsonb_build_object('id',gen_random_uuid(),'intent_id',gen_random_uuid(),'idempotency_key',gen_random_uuid()::text))).* FROM public.paige_durable_work w WHERE id=public.test_publication_ref();
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='unavailable','duplicate unresolved companion is ambiguous, never choose newest');
ROLLBACK;
BEGIN;
UPDATE public.paige_durable_work SET status='failed',terminal_outcome='{"reason":"embedding_failed"}',settled_at=now() WHERE id=public.test_publication_ref();
INSERT INTO public.paige_durable_work SELECT (jsonb_populate_record(NULL::public.paige_durable_work,to_jsonb(w)||jsonb_build_object('id',gen_random_uuid(),'intent_id',gen_random_uuid(),'idempotency_key',gen_random_uuid()::text))).* FROM public.paige_durable_work w WHERE id=public.test_publication_ref();
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='unavailable','ambiguous terminal attempts do not invent a latest intent');
ROLLBACK;
BEGIN;
ALTER TABLE public.paige_durable_work DISABLE TRIGGER trg_paige_durable_work_identity;
UPDATE public.paige_durable_work SET tenant_id='00000000-0000-0000-0000-000000000002' WHERE id=public.test_publication_ref();
ALTER TABLE public.paige_durable_work ENABLE TRIGGER trg_paige_durable_work_identity;
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='not_submitted' AND public.test_publication_review()#>'{publication,work_id}'='null'::jsonb,'foreign-tenant work is neither returned nor treated as local authority');
ROLLBACK;
-- Publish through the actual canonical writer with synthetic vectors; no provider.
DO $$ DECLARE s jsonb:=public.start_knowledge_publication(public.test_publication_ref()); c jsonb; BEGIN
 FOR c IN SELECT * FROM jsonb_array_elements(s->'chunks') LOOP
  PERFORM public.stage_knowledge_publication(public.test_publication_ref(),s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int,jsonb_build_array(jsonb_build_object('index',(c->>'index')::int,'sha256',c->>'sha256','embedding',(SELECT jsonb_agg(0.5 ORDER BY g) FROM generate_series(1,1024) g))));
 END LOOP;
 PERFORM public.complete_knowledge_publication(public.test_publication_ref(),s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int);
END $$;
SET ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='matched' AND public.test_publication_review()#>>'{publication,work_status}'='succeeded' AND public.test_publication_review()#>>'{publication,generation_id}'=public.test_publication_ref()::text AND public.test_publication_review()#>>'{publication,outcome}'='capability_succeeded','cleared review reload recovers actual promoted generation and native outcome');
SELECT public.test_assert(public.test_publication_review()->'pending_review'='null'::jsonb AND public.test_publication_review()->'extraction_work_id'='null'::jsonb,'all original reader null fields survive promotion');
RESET ROLE;
BEGIN;
UPDATE public.tenant_knowledge_docs SET summary='Later legitimate metadata edit' WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='association');
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,generation_id}'=public.test_publication_ref()::text,'later metadata revision does not erase valid original publication');
ROLLBACK;
BEGIN;
UPDATE public.paige_durable_work SET terminal_outcome=terminal_outcome-'outcome' WHERE id=public.test_publication_ref();
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='unavailable' AND public.test_publication_review()#>'{publication,work_id}'='null'::jsonb,'missing terminal outcome never fabricates a recorded receipt');
ROLLBACK;
BEGIN;
UPDATE public.paige_durable_work SET terminal_outcome=jsonb_set(terminal_outcome,'{outcome}','"capability_completed_unrecorded"') WHERE id=public.test_publication_ref();
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,outcome}'='capability_completed_unrecorded','completed-unrecorded remains explicitly unrecorded');
ROLLBACK;
BEGIN;
UPDATE public.tenant_knowledge_docs SET active_generation_id='70000000-0000-0000-0000-000000000099' WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='association');
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='unavailable','missing active generation companion is unavailable');
ROLLBACK;
BEGIN;
ALTER TABLE public.paige_durable_work DISABLE TRIGGER trg_paige_durable_work_identity;
UPDATE public.paige_durable_work SET tenant_id='00000000-0000-0000-0000-000000000002' WHERE id=public.test_publication_ref();
ALTER TABLE public.paige_durable_work ENABLE TRIGGER trg_paige_durable_work_identity;
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='unavailable' AND public.test_publication_review()#>'{publication,work_id}'='null'::jsonb,'foreign active-generation companion is refused without leaking a reference');
ROLLBACK;
-- Start a second genuine extraction against the same published document.
SET ROLE service_role;
INSERT INTO public.extract_test SELECT 'replacement-association',public.test_extract('70000000-0000-0000-0000-000000000042',(result->>'document_id')::uuid,4,'Replacement not yet published'),NULL FROM public.extract_test WHERE name='association';
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='replacement-association';
SELECT public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,5,'Replacement not yet published',started->>'input_hash') FROM public.extract_test WHERE name='replacement-association';
RESET ROLE;
SET ROLE authenticated;
SELECT public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(result->>'document_id')::uuid,(result->>'work_id')::uuid,6,'Replacement not yet published','{"title":"Neutral replacement","summary":null,"category":null,"tags":[]}') FROM public.extract_test WHERE name='replacement-association';
SELECT public.test_assert(public.test_publication_review()#>>'{publication,association}'='not_submitted' AND public.test_publication_review()#>'{publication,generation_id}'='null'::jsonb AND public.test_publication_review()#>'{publication,outcome}'='null'::jsonb,'prior published generation never counts as the pending replacement');
RESET ROLE;
SET ROLE anon;
SELECT public.test_denied($q$SELECT public.read_tenant_knowledge_review(NULL,NULL)$q$,'permission denied');
RESET ROLE;
SELECT public.test_assert(NOT has_function_privilege('service_role','public.read_tenant_knowledge_review(uuid,uuid)','EXECUTE') AND has_function_privilege('authenticated','public.read_tenant_knowledge_review(uuid,uuid)','EXECUTE'),'existing review reader ACL unchanged');
SELECT public.test_assert((SELECT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.read_tenant_knowledge_review(uuid,uuid)'::regprocedure),'existing empty search path and definer contract retained');

-- Successor: a proven legacy idle document may enter explicit correction input,
-- but cannot Publish without a saved review. Any local publication history holds.
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by)
VALUES('20000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001','Neutral legacy source','Existing canonical source','10000000-0000-0000-0000-000000000001');
CREATE FUNCTION public.test_idle_publication_review() RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
 SELECT public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000040')->'publication' $$;
SET ROLE authenticated;
SELECT public.test_assert(public.test_idle_publication_review()->>'association'='not_submitted'
 AND public.test_idle_publication_review()->'work_id'='null'::jsonb,'canonical legacy idle with zero local publication work can enter explicit correction input');
RESET ROLE;
CREATE FUNCTION public.test_idle_work(patch jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.paige_durable_work SELECT (jsonb_populate_record(NULL::public.paige_durable_work,to_jsonb(w)||
  jsonb_build_object('id',gen_random_uuid(),'intent_id',gen_random_uuid(),'idempotency_key',gen_random_uuid()::text,
  'request_payload',jsonb_set(w.request_payload,'{document_id}','"20000000-0000-0000-0000-000000000040"'))||patch)).*
 FROM public.paige_durable_work w WHERE id=public.test_publication_ref();
END $$;
BEGIN;
SELECT public.test_idle_work('{"status":"outcome_unknown","terminal_outcome":null,"settled_at":null}');
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_idle_publication_review()->>'association'='unavailable','legacy idle with unknown publication cannot become fresh');
ROLLBACK;
BEGIN;
SELECT public.test_idle_work('{"request_payload":{"document_id":"20000000-0000-0000-0000-000000000040","version":"malformed"}}');
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_idle_publication_review()->>'association'='unavailable','legacy idle with malformed publication cannot become fresh');
ROLLBACK;
BEGIN;
SELECT public.test_idle_work('{}');
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_idle_publication_review()->>'association'='unavailable','legacy idle with prior terminal publication cannot become fresh');
ROLLBACK;
BEGIN;
SELECT public.test_idle_work('{"work_kind":"document_generate"}');
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_idle_publication_review()->>'association'='unavailable','publication capability alone still blocks legacy idle');
ROLLBACK;
BEGIN;
UPDATE public.tenant_knowledge_docs SET record_state='draft',content='' WHERE id='20000000-0000-0000-0000-000000000040';
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_idle_publication_review()->>'association'='unavailable','noncanonical both-null record is never legacy idle');
ROLLBACK;
BEGIN;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_idle_publication_review()->>'association'='unavailable','legacy idle requires current authorized actor');
ROLLBACK;
BEGIN;
UPDATE public.tenant_members SET status='inactive' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.test_assert(public.test_idle_publication_review()->>'association'='unavailable','legacy idle refuses inactive native membership');
ROLLBACK;
BEGIN;
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.test_denied($q$SELECT public.test_idle_publication_review()$q$,'KNOWLEDGE_SCOPE_CHANGED');
ROLLBACK;
