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
