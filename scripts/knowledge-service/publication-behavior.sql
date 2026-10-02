-- Publication behavior: drive one real extraction through review save, submit/stage/
-- complete a publication, then prove retrieval truth, the legacy-writer guard, and the
-- delete-reason contract. Driver DO blocks run as the fixture owner (the RPCs are
-- DEFINER-sealed; the authenticated-denial tests prove the caller boundary).
RESET ROLE;
GRANT SELECT ON public.paige_durable_work TO service_role;
SET ROLE service_role;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
DELETE FROM public.extract_test WHERE name='pub';
INSERT INTO public.extract_test VALUES('pub',public.test_extract('70000000-0000-0000-0000-000000000021',NULL,NULL,'Reviewed publication text'),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='pub';
SELECT (public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Reviewed publication text',started->>'input_hash'))->>'phase' FROM public.extract_test WHERE name='pub';
RESET ROLE;
RESET ROLE;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SELECT public.test_assert((SELECT revision=2 FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='pub')),'completion advanced revision to 2');
SET ROLE authenticated;
SELECT public.test_assert(public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='pub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='pub'),2,'Reviewed publication text','{"title":"Reviewed publication","summary":null,"category":null,"tags":["pub"]}')->>'revision'='3','review saved advances CAS to 3');
-- Dormant boundary: submit refuses authenticated callers.
SELECT public.test_denied($q$SELECT public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='pub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='pub'),3,gen_random_uuid(),encode(sha256(convert_to('Reviewed publication text','UTF8')),'hex'))$q$,'permission denied');
RESET ROLE;
DO $sub$
DECLARE ans jsonb;
BEGIN
 ans:=public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='pub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='pub'),3,'60000000-0000-0000-0000-000000000011',encode(sha256(convert_to('Reviewed publication text','UTF8')),'hex'));
END $sub$;
RESET ROLE;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT public.test_denied($q$SELECT public.start_knowledge_publication((SELECT id FROM public.paige_durable_work WHERE work_kind='knowledge_publish'))$q$,'permission denied');
RESET ROLE;
DO $stage$
DECLARE w uuid:=(SELECT id FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'extraction_work_id'=(SELECT result->>'work_id' FROM public.extract_test WHERE name='pub'));
 s jsonb:=public.start_knowledge_publication(w); c jsonb;
BEGIN
 FOR c IN SELECT * FROM jsonb_array_elements(s->'chunks') LOOP
  PERFORM public.stage_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int,
   jsonb_build_array(jsonb_build_object('index',(c->>'index')::int,'sha256',c->>'sha256',
    'embedding',(SELECT jsonb_agg(0.5 ORDER BY g) FROM generate_series(1,1024) g))));
 END LOOP;
 -- Identical re-stage is idempotent.
 PERFORM public.stage_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int,
  jsonb_build_array(jsonb_build_object('index',0,'sha256',s->'chunks'->0->>'sha256','embedding',(SELECT jsonb_agg(0.5 ORDER BY g) FROM generate_series(1,1024) g))));
END $stage$;
SELECT public.test_assert((SELECT count(*)=(SELECT (request_payload->'manifest'->>'chunk_count')::int FROM public.paige_durable_work WHERE work_kind='knowledge_publish') FROM public.tenant_knowledge_chunks WHERE doc_id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='pub') AND generation_id IS NOT NULL),'staged generation count matches manifest');
SELECT public.test_assert((SELECT count(*)=0 FROM public.match_tenant_knowledge('00000000-0000-0000-0000-000000000001',(SELECT ARRAY(SELECT 0.5::double precision FROM generate_series(1,1024))::extensions.vector),20) m JOIN public.tenant_knowledge_chunks c ON c.id=m.chunk_id JOIN public.tenant_knowledge_docs d ON d.id=m.doc_id WHERE c.generation_id IS DISTINCT FROM d.active_generation_id),'staged generation invisible to search before promotion');
DO $complete$
DECLARE w uuid:=(SELECT id FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'extraction_work_id'=(SELECT result->>'work_id' FROM public.extract_test WHERE name='pub'));
 s jsonb:=public.start_knowledge_publication(w); r jsonb;
BEGIN
 r:=public.complete_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int);
END $complete$;
SELECT public.test_assert((SELECT record_state='canonical' AND content='Reviewed publication text' AND active_generation_id IS NOT NULL AND pending_review IS NULL AND chunk_count>0 AND publication_manifest->>'version'='unicode-1000-150-v1' FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='pub')),'atomic promotion switches state+content+generation+manifest together');
SELECT public.test_assert((SELECT count(*)>0 FROM public.match_tenant_knowledge('00000000-0000-0000-0000-000000000001',(SELECT ARRAY(SELECT 0.5::double precision FROM generate_series(1,1024))::extensions.vector),20)),'active generation is searchable');
SET ROLE service_role;
SELECT public.test_denied($q$INSERT INTO public.tenant_knowledge_chunks(id,doc_id,tenant_id,chunk_index,content) VALUES(gen_random_uuid(),(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='pub'),'00000000-0000-0000-0000-000000000001',99,'legacy overwrite attempt')$q$,'KNOWLEDGE_GENERATION_MANAGED');
RESET ROLE;
-- Paste-sourced publication: unbound canonical source keeps the honest unavailable reason.
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT public.test_assert(public.delete_tenant_knowledge('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='pub'),4)->'source_cleanup'->>'reason'='canonical_source_binding_unavailable','unbound paste source keeps the unavailable reason');
RESET ROLE;
-- Bound-source variant: a file-backed extraction published with an uploaded source binding
-- reports retained_by_policy on delete (the compat contract the packet mandates).
RESET ROLE;
SET ROLE service_role;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
DELETE FROM public.extract_test WHERE name='bound';
INSERT INTO public.extract_test VALUES('bound',public.submit_knowledge_extraction('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000022',NULL,NULL,'Bound source',NULL,jsonb_build_object('bucket','tenant-knowledge','object_id','40000000-0000-0000-0000-000000000002','object_name','00000000-0000-0000-0000-000000000001/source.txt','sha256',encode(sha256(convert_to('Bound source publication text','UTF8')),'hex'),'byte_size',28,'mime_type','text/plain','bound_at','2026-10-02T00:00:00Z')),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='bound';
SELECT (public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Bound source publication text',started->>'input_hash'))->>'phase' FROM public.extract_test WHERE name='bound';
RESET ROLE;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT public.test_assert(public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='bound'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='bound'),2,'Bound source publication text','{"title":"Bound","summary":null,"category":null,"tags":[]}')->>'revision'='3','bound review saved');
RESET ROLE;
DO $bsub$
DECLARE ans jsonb;
BEGIN
 ans:=public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='bound'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='bound'),3,'60000000-0000-0000-0000-000000000022',encode(sha256(convert_to('Bound source publication text','UTF8')),'hex'));
END $bsub$;
DO $bdrive$
DECLARE w uuid:=(SELECT id FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'extraction_work_id'=(SELECT result->>'work_id' FROM public.extract_test WHERE name='bound'));
 s jsonb:=public.start_knowledge_publication(w); c jsonb; r jsonb;
BEGIN
 FOR c IN SELECT * FROM jsonb_array_elements(s->'chunks') LOOP
  PERFORM public.stage_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int,jsonb_build_array(jsonb_build_object('index',(c->>'index')::int,'sha256',c->>'sha256','embedding',(SELECT jsonb_agg(0.5 ORDER BY g) FROM generate_series(1,1024) g))));
 END LOOP;
 r:=public.complete_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int);
END $bdrive$;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT public.test_assert(public.delete_tenant_knowledge('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='bound'),4)->'source_cleanup'->>'reason'='retained_by_policy','bound canonical source reports retained_by_policy');
RESET ROLE;
SELECT public.test_assert((SELECT count(*)=1 FROM storage.objects WHERE id='40000000-0000-0000-0000-000000000002'),'uploaded source object retained after delete');
-- P2b: TRUE second publication of an already-published doc; the FIRST generation retires.
RESET ROLE;
GRANT SELECT ON public.paige_durable_work TO service_role;
SET ROLE service_role;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
DELETE FROM public.extract_test WHERE name='repub';
-- First publication.
INSERT INTO public.extract_test VALUES('repub',public.test_extract('70000000-0000-0000-0000-000000000023',NULL,NULL,'Publication text v1'),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='repub';
SELECT (public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Publication text v1',started->>'input_hash'))->>'phase' FROM public.extract_test WHERE name='repub';
RESET ROLE;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT public.test_assert(public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='repub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='repub'),2,'Publication text v1','{"title":"V1","summary":null,"category":null,"tags":[]}')->>'revision'='3','v1 review saved');
RESET ROLE;
DO $sub1$
DECLARE ans jsonb;
BEGIN
 ans:=public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='repub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='repub'),3,'60000000-0000-0000-0000-000000000023',encode(sha256(convert_to('Publication text v1','UTF8')),'hex'));
END $sub1$;
DO $drive1$
DECLARE w uuid:=(SELECT id FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'extraction_work_id'=(SELECT result->>'work_id' FROM public.extract_test WHERE name='repub'));
 s jsonb:=public.start_knowledge_publication(w); c jsonb; r jsonb;
BEGIN
 FOR c IN SELECT * FROM jsonb_array_elements(s->'chunks') LOOP
  PERFORM public.stage_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int,jsonb_build_array(jsonb_build_object('index',(c->>'index')::int,'sha256',c->>'sha256','embedding',(SELECT jsonb_agg(0.5 ORDER BY g) FROM generate_series(1,1024) g))));
 END LOOP;
 r:=public.complete_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int);
END $drive1$;
-- Second publication: replacement extraction on the SAME canonical doc.
SET ROLE service_role;
INSERT INTO public.extract_test VALUES('repub2',public.test_extract('70000000-0000-0000-0000-000000000026',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='repub'),4,'Publication text v2'),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='repub2';
SELECT (public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,(started->>'revision')::int,'Publication text v2',started->>'input_hash'))->>'phase' FROM public.extract_test WHERE name='repub2';
RESET ROLE;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT public.test_assert(public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='repub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='repub2'),6,'Publication text v2','{"title":"V2","summary":null,"category":null,"tags":[]}')->>'revision'='7','v2 review saved');
RESET ROLE;
CREATE TABLE IF NOT EXISTS public.pub_probe(old_generation uuid);
TRUNCATE public.pub_probe;
INSERT INTO public.pub_probe SELECT active_generation_id FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='repub');
SELECT public.test_assert((SELECT old_generation IS NOT NULL FROM public.pub_probe),'first generation captured before republication');
DO $sub2$
DECLARE ans jsonb;
BEGIN
 ans:=public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='repub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='repub2'),7,'60000000-0000-0000-0000-000000000026',encode(sha256(convert_to('Publication text v2','UTF8')),'hex'));
END $sub2$;
DO $drive2$
DECLARE w uuid:=(SELECT id FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'extraction_work_id'=(SELECT result->>'work_id' FROM public.extract_test WHERE name='repub2'));
 s jsonb:=public.start_knowledge_publication(w); c jsonb; r jsonb;
BEGIN
 FOR c IN SELECT * FROM jsonb_array_elements(s->'chunks') LOOP
  PERFORM public.stage_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int,jsonb_build_array(jsonb_build_object('index',(c->>'index')::int,'sha256',c->>'sha256','embedding',(SELECT jsonb_agg(0.5 ORDER BY g) FROM generate_series(1,1024) g))));
 END LOOP;
 r:=public.complete_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int);
END $drive2$;
SELECT public.test_assert((SELECT active_generation_id IS DISTINCT FROM old_generation FROM public.tenant_knowledge_docs,pub_probe WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='repub')),'second publication switched the active generation');
SELECT public.test_assert((SELECT count(*)=0 FROM public.match_tenant_knowledge('00000000-0000-0000-0000-000000000001',(SELECT ARRAY(SELECT 0.5::double precision FROM generate_series(1,1024))::extensions.vector),20) m JOIN public.tenant_knowledge_chunks c ON c.id=m.chunk_id WHERE c.generation_id=(SELECT old_generation FROM public.pub_probe)),'retired generation chunks vanish from search after the second publication');
DROP TABLE IF EXISTS public.pub_probe;
SELECT public.test_assert((SELECT count(*)>0 AND bool_and(content IS NOT NULL AND content<>'') FROM public.tenant_knowledge_chunks WHERE generation_id IS NOT NULL),'published chunk content is materialized and non-empty');
-- P2c: replay, settle-failure, and recover proofs.
RESET ROLE;
SET ROLE service_role;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
DELETE FROM public.extract_test WHERE name='failpub';
INSERT INTO public.extract_test VALUES('failpub',public.test_extract('70000000-0000-0000-0000-000000000024',NULL,NULL,'Failing publication text'),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='failpub';
SELECT (public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Failing publication text',started->>'input_hash'))->>'phase' FROM public.extract_test WHERE name='failpub';
RESET ROLE;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT public.test_assert(public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='failpub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='failpub'),2,'Failing publication text','{"title":"F","summary":null,"category":null,"tags":[]}')->>'revision'='3','failing review saved');
RESET ROLE;
DO $fsub$
DECLARE ans jsonb;
BEGIN
 ans:=public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='failpub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='failpub'),3,'60000000-0000-0000-0000-000000000024',encode(sha256(convert_to('Failing publication text','UTF8')),'hex'));
END $fsub$;
-- Replay: the identical intent + hash returns the SAME work (replayed), never a second one.
DO $freplay$
DECLARE a jsonb; b jsonb;
BEGIN
 a:=public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='failpub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='failpub'),3,'60000000-0000-0000-0000-000000000024',encode(sha256(convert_to('Failing publication text','UTF8')),'hex'));
 b:=public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='failpub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='failpub'),3,'60000000-0000-0000-0000-000000000024',encode(sha256(convert_to('Failing publication text','UTF8')),'hex'));
 IF (b->>'replayed')::boolean IS NOT TRUE OR (b->>'work_id')::uuid IS DISTINCT FROM (a->>'work_id')::uuid THEN RAISE EXCEPTION 'replay assertion failed'; END IF;
 CREATE TABLE IF NOT EXISTS public.pub_probe2(w uuid); INSERT INTO public.pub_probe2 VALUES((a->>'work_id')::uuid);
END $freplay$;
DO $fdrive$
DECLARE w uuid:=(SELECT id FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'extraction_work_id'=(SELECT result->>'work_id' FROM public.extract_test WHERE name='failpub'));
 s jsonb:=public.start_knowledge_publication(w);
BEGIN
 PERFORM public.settle_knowledge_publication_failure(w,s->>'server_key',(s->>'attempt')::int,'embedding_failed',false);
END $fdrive$;
SELECT public.test_assert((SELECT status='failed' FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'extraction_work_id'=(SELECT result->>'work_id' FROM public.extract_test WHERE name='failpub')),'settle-failure marks the work failed');
SELECT public.test_assert((SELECT record_state='draft' AND pending_review IS NOT NULL FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='failpub')),'failed publication preserves the prior state');
-- recover: simulate a lost acknowledgement — the generation committed (owner-side wiring
-- of active_generation_id, as a crashed worker's mid-flight state would leave it) while the
-- work row stays claimed with an expired lease. recover must record terminal truth without
-- re-dispatching.
RESET ROLE;
SET ROLE service_role;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
DELETE FROM public.extract_test WHERE name='recoverpub';
INSERT INTO public.extract_test VALUES('recoverpub',public.test_extract('70000000-0000-0000-0000-000000000025',NULL,NULL,'Recovered publication text'),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='recoverpub';
SELECT (public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Recovered publication text',started->>'input_hash'))->>'phase' FROM public.extract_test WHERE name='recoverpub';
RESET ROLE;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT public.test_assert(public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='recoverpub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='recoverpub'),2,'Recovered publication text','{"title":"R","summary":null,"category":null,"tags":[]}')->>'revision'='3','recover review saved');
RESET ROLE;
DO $covsub$
DECLARE ans jsonb;
BEGIN
 ans:=public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='recoverpub'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='recoverpub'),3,'60000000-0000-0000-0000-000000000025',encode(sha256(convert_to('Recovered publication text','UTF8')),'hex'));
END $covsub$;
DO $covclaim$
DECLARE w uuid:=(SELECT id FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'extraction_work_id'=(SELECT result->>'work_id' FROM public.extract_test WHERE name='recoverpub'));
 s jsonb:=public.start_knowledge_publication(w);
BEGIN
 UPDATE public.paige_durable_work SET lease_until=now()-interval '1 minute' WHERE id=w;
 UPDATE public.tenant_knowledge_docs SET active_generation_id=w,publication_manifest=(SELECT request_payload->'manifest' FROM public.paige_durable_work WHERE id=w) WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='recoverpub');
END $covclaim$;
SELECT public.test_assert((SELECT count(*)>=1 FROM public.recover_knowledge_publication(10)),'recover runs');
SELECT public.test_assert((SELECT status='succeeded' AND terminal_outcome->>'reconciled'='true' FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'extraction_work_id'=(SELECT result->>'work_id' FROM public.extract_test WHERE name='recoverpub')),'recover reconciles a committed generation to succeeded');
SELECT public.test_assert((SELECT count(*)=1 FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND request_payload->>'extraction_work_id'=(SELECT result->>'work_id' FROM public.extract_test WHERE name='recoverpub')),'recover never re-dispatched (still one work)');
