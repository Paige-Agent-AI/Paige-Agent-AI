SELECT public.test_assert((SELECT source_coverage='unknown' AND record_state='canonical' AND pending_review IS NULL AND source_binding IS NULL FROM public.tenant_knowledge_docs LIMIT 1),'legacy truth defaults');
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SELECT set_config('test.owner','false',false);
SELECT set_config('test.operator','false',false);
SELECT public.test_denied($q$UPDATE public.tenant_knowledge_docs SET record_state='draft',content='' WHERE title='A'$q$,'KNOWLEDGE_LIFECYCLE_UNAVAILABLE');
SELECT public.test_denied($q$UPDATE public.tenant_knowledge_docs SET source_coverage='complete' WHERE title='A'$q$,'KNOWLEDGE_LIFECYCLE_UNAVAILABLE');
-- Administrator seeds adversarial future-state rows, explicitly disabling ONLY the
-- global activation guard. No product caller/session setting can perform this bypass.
ALTER TABLE public.tenant_knowledge_docs DISABLE TRIGGER knowledge_lifecycle_frozen;
UPDATE public.tenant_knowledge_docs SET pending_review='{"schema_version":1,"extracted_content":"PENDING SECRET","reviewed_content":null,"extraction_version":"test-v1","coverage":"partial"}' WHERE title='A';
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,record_state,pending_review)
 VALUES('20000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','draft','', 'draft','{"schema_version":1,"extracted_content":"DRAFT SECRET","reviewed_content":null,"extraction_version":"test-v1","coverage":"unknown"}');
ALTER TABLE public.tenant_knowledge_docs ENABLE TRIGGER knowledge_lifecycle_frozen;
INSERT INTO public.tenant_knowledge_chunks(id,tenant_id,doc_id,chunk_index,content) VALUES
 ('30000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',0,'DRAFT CHUNK'),
 ('30000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',0,'WRONG TENANT CHUNK');
SET ROLE authenticated;
SELECT public.test_assert((SELECT count(*)=1 FROM public.tenant_knowledge_docs WHERE tenant_id='00000000-0000-0000-0000-000000000001'),'direct select excludes draft');
SELECT public.test_assert((SELECT content='private A' AND share_to_network=false AND network_review_status='none' FROM public.tenant_knowledge_docs WHERE title='A'),'legacy explicit canonical columns preserved');
SELECT public.test_denied('SELECT pending_review FROM public.tenant_knowledge_docs','permission denied');
SELECT public.test_denied('SELECT source_binding FROM public.tenant_knowledge_docs','permission denied');
SELECT public.test_denied('SELECT * FROM public.tenant_knowledge_docs','permission denied');
SELECT public.test_assert((SELECT count(*)=1 FROM public.tenant_knowledge_chunks WHERE tenant_id='00000000-0000-0000-0000-000000000001'),'direct chunks exclude draft and tenant mismatch');
SELECT public.test_assert(jsonb_array_length(public.read_tenant_knowledge('00000000-0000-0000-0000-000000000001')->'documents')=1,'ordinary RPC excludes draft');
SELECT public.test_assert(NOT ((public.read_tenant_knowledge('00000000-0000-0000-0000-000000000001')->'documents'->0) ?| ARRAY['pending_review','source_binding','record_state','source_coverage','content']),'list projection hides internal and content');
SELECT public.test_assert(public.read_tenant_knowledge('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')->'documents'->0->>'content'='private A','detail preserves canonical content');
SELECT public.test_assert(public.read_tenant_knowledge('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004')->'documents'='[]'::jsonb,'detail hides draft');
SELECT public.test_assert(public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004')->'pending_review'->>'extracted_content'='DRAFT SECRET','scoped review sees pending draft');
SELECT public.test_assert(public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')->'pending_review'->>'extracted_content'='PENDING SECRET','review sees replacement while ordinary content stays old');
SELECT public.test_denied($q$SELECT public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002')$q$,'KNOWLEDGE_SCOPE_CHANGED');
SELECT public.test_denied($q$SELECT public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002')$q$,'KNOWLEDGE_NOT_FOUND');
SELECT public.test_denied($q$SELECT public.update_tenant_knowledge_metadata('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',1,'{"title":"cannot edit draft"}')$q$,'KNOWLEDGE_NOT_FOUND');
SELECT public.test_assert(NOT ((public.update_tenant_knowledge_metadata('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',2,'{"title":"changed"}')->'document') ?| ARRAY['pending_review','source_binding','record_state','source_coverage','content']),'metadata projection hides pending fields');
SELECT public.test_assert((SELECT count(*)=1 FROM public.match_tenant_knowledge('00000000-0000-0000-0000-000000000001',ARRAY[1.0]::extensions.vector,20)),'definer search excludes draft and mismatched tenants');
SELECT public.test_denied($q$SELECT public.match_tenant_knowledge('00000000-0000-0000-0000-000000000002',ARRAY[1.0]::extensions.vector,20)$q$,'KB_FORBIDDEN');
SELECT public.test_denied($q$UPDATE public.tenant_knowledge_docs SET source_coverage='complete' WHERE title='changed'$q$,'KNOWLEDGE_LIFECYCLE_UNAVAILABLE');
-- Legacy metadata writes remain allowed and revision still advances.
UPDATE public.tenant_knowledge_docs SET summary='legacy update' WHERE title='changed';
SELECT public.test_assert((SELECT revision=4 AND summary='legacy update' FROM public.tenant_knowledge_docs WHERE title='changed'),'legacy updates and revision preserved');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id=NULL;
SET ROLE authenticated;
SELECT public.test_denied($q$SELECT public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')$q$,'KNOWLEDGE_SCOPE_CHANGED');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000003';
SELECT set_config('test.operator','true',false);
SET ROLE authenticated;
SELECT public.test_assert(public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003')->>'record_state'='canonical','company operator scoped review');
SELECT public.test_assert((SELECT count(*)=1 FROM public.tenant_knowledge_docs WHERE title='Company'),'company operator legacy direct read');
SELECT set_config('test.operator','false',false);
SELECT public.test_denied($q$SELECT public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003')$q$,'KNOWLEDGE_FORBIDDEN');
SELECT set_config('test.owner','true',false);
SELECT public.test_assert(public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003')->>'record_state'='canonical','platform owner scoped review');
SELECT set_config('test.owner','false',false);
SELECT set_config('test.actor','',false);
SELECT public.test_denied($q$SELECT public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003')$q$,'KNOWLEDGE_UNAUTHENTICATED');
RESET ROLE;
SET ROLE anon;
SELECT public.test_denied($q$SELECT public.read_tenant_knowledge_review(NULL,NULL)$q$,'permission denied');
RESET ROLE;
SET ROLE service_role;
SELECT public.test_denied($q$SELECT public.read_tenant_knowledge_review(NULL,NULL)$q$,'permission denied');
SELECT public.test_denied($q$UPDATE public.tenant_knowledge_docs SET source_coverage='complete' WHERE title='changed'$q$,'KNOWLEDGE_LIFECYCLE_UNAVAILABLE');
SELECT public.test_denied($q$INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,record_state) VALUES('20000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','forbidden draft','','draft')$q$,'KNOWLEDGE_LIFECYCLE_UNAVAILABLE');
RESET ROLE;
SELECT public.test_assert((SELECT count(*)=1 FROM public.match_tenant_knowledge('00000000-0000-0000-0000-000000000001',ARRAY[1.0]::extensions.vector,20)),'no-JWT privileged search still hides drafts');
-- Validation is independent of the activation freeze.
SELECT public.test_assert(NOT public.knowledge_pending_review_valid('{"schema_version":1}') AND NOT public.knowledge_pending_review_valid('[]'),'pending shape refuses missing fields');
SELECT public.test_assert(NOT public.knowledge_pending_review_valid(jsonb_build_object('schema_version',1,'extracted_content',repeat('x',480001),'reviewed_content',NULL,'extraction_version','v1','coverage','unknown')),'pending content bounded');
SELECT public.test_assert(NOT public.knowledge_pending_review_valid('{"schema_version":1,"extracted_content":"text","reviewed_content":null,"extraction_version":"v1","coverage":"unknown","approved":true}'),'pending cannot smuggle approval');
SELECT public.test_assert(NOT public.knowledge_source_binding_valid('{"bucket":"tenant-knowledge"}','00000000-0000-0000-0000-000000000001'),'binding all or none');
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.test_assert(public.delete_tenant_knowledge('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',1)->>'document_absent'='true','delete removes draft and pending state');
SELECT public.test_assert(public.delete_tenant_knowledge('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',4)->>'document_absent'='true','delete removes canonical and pending replacement');
RESET ROLE;
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.tenant_knowledge_docs WHERE id IN ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004')),'deleted pending data absent');

-- Binding is a bounded shape, not proof that an object exists or is immutable.
DO $$ DECLARE b jsonb:=jsonb_build_object('bucket','tenant-knowledge','object_id','40000000-0000-0000-0000-000000000001','object_name','00000000-0000-0000-0000-000000000001/file.pdf','sha256',repeat('a',64),'byte_size',1024,'mime_type','application/pdf','bound_at','2026-10-01T00:00:00Z'); t uuid:='00000000-0000-0000-0000-000000000001'; BEGIN
 PERFORM public.test_assert(public.knowledge_source_binding_valid(b,t),'valid complete binding shape');
 PERFORM public.test_assert(NOT public.knowledge_source_binding_valid(b,'00000000-0000-0000-0000-000000000002'),'binding rejects other tenant prefix');
 PERFORM public.test_assert(NOT public.knowledge_source_binding_valid(b||jsonb_build_object('object_name',t::text||'/../secret'),t),'binding rejects traversal');
 PERFORM public.test_assert(NOT public.knowledge_source_binding_valid(b||'{"byte_size":26214401}'::jsonb,t),'binding upload size bounded');
 PERFORM public.test_assert(NOT public.knowledge_source_binding_valid(b||'{"byte_size":1.5}'::jsonb,t),'binding byte size integral');
 PERFORM public.test_assert(NOT public.knowledge_source_binding_valid(b||'{"sha256":"wrong"}'::jsonb,t),'binding checksum bounded');
 PERFORM public.test_assert(NOT public.knowledge_source_binding_valid(b||'{"extra":"secret"}'::jsonb,t),'binding rejects arbitrary fields');
END $$;
