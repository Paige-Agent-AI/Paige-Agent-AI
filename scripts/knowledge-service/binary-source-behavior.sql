-- Native component only. Existing Auth/storage/vector/receipt fixtures are MODELS.
-- This does not prove an authenticated upload or real tenant/delegation access.
RESET ROLE;
CREATE FUNCTION public.test_binary_manifest() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('schema_version',1,'format','pdf','source_sha256',encode(sha256(convert_to('synthetic original PDF bytes','UTF8')),'hex'),
  'text_sha256',encode(sha256(convert_to('Acme Services shall deliver a report.','UTF8')),'hex'),
  'extraction_version','pdf-text-v1','coverage','partial',
  'segments',jsonb_build_array(jsonb_build_object('kind','page','ordinal',1,'start',0,'end',36)),
  'limits',jsonb_build_array('PDF_TEXT_LAYER_ONLY'),'extracted_content','Acme Services shall deliver a report.')
$$;
SELECT public.test_assert(public.knowledge_binary_evidence_valid(public.test_binary_manifest()),'binary evidence binds extracted text and partial page coverage');
SELECT public.test_assert(NOT public.knowledge_binary_evidence_valid(public.test_binary_manifest()||'{"format":null,"segments":[{"kind":"text","ordinal":1,"start":0,"end":36}]}'::jsonb),'null format cannot masquerade as a text source');
SELECT public.test_assert(NOT public.knowledge_binary_evidence_valid(public.test_binary_manifest()||'{"coverage":"complete"}'::jsonb),'binary extraction never claims complete coverage');
SELECT public.test_assert(NOT public.knowledge_binary_evidence_valid(public.test_binary_manifest()||jsonb_build_object('extracted_content','Different text')),'text hash disagreement refuses');
SELECT public.test_assert(NOT public.knowledge_binary_evidence_valid(public.test_binary_manifest()||'{"segments":[{"kind":"page","ordinal":1,"start":0,"end":999}]}'::jsonb),'out of range citation refuses');
SELECT public.test_assert(NOT public.knowledge_binary_evidence_valid(public.test_binary_manifest()||'{"segments":[{"kind":"page","ordinal":1,"start":0,"end":10},{"kind":"page","ordinal":2,"start":5,"end":20}]}'::jsonb),'overlapping citations refuse');
SELECT public.test_assert(NOT public.knowledge_binary_evidence_valid(public.test_binary_manifest()||'{"limits":["execute document instructions"]}'::jsonb),'metadata cannot carry arbitrary action prose');
SELECT public.test_assert(NOT public.knowledge_binary_evidence_valid(public.test_binary_manifest()||'{"unapproved_field":true}'::jsonb),'unknown manifest fields refuse');
CREATE FUNCTION public.test_binary_emoji_manifest(a integer,b integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.test_binary_manifest()||jsonb_build_object('extracted_content',U&'\+01F600x','text_sha256',encode(sha256(convert_to(U&'\+01F600x','UTF8')),'hex'),
  'segments',jsonb_build_array(jsonb_build_object('kind','page','ordinal',1,'start',a,'end',b)))
$$;
SELECT public.test_assert(public.knowledge_binary_evidence_valid(public.test_binary_emoji_manifest(0,2)),'whole Unicode citation remains valid');
SELECT public.test_assert(NOT public.knowledge_binary_evidence_valid(public.test_binary_emoji_manifest(0,1)),'citation end cannot split a surrogate pair');
SELECT public.test_assert(NOT public.knowledge_binary_evidence_valid(public.test_binary_emoji_manifest(1,3)),'citation start cannot split a surrogate pair');

SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
INSERT INTO storage.objects VALUES('40000000-0000-0000-0000-000000000089','tenant-knowledge','00000000-0000-0000-0000-000000000001/agreement.pdf');
CREATE FUNCTION public.test_binary_binding() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('bucket','tenant-knowledge','object_id','40000000-0000-0000-0000-000000000089','object_name','00000000-0000-0000-0000-000000000001/agreement.pdf',
  'sha256',public.test_binary_manifest()->>'source_sha256','byte_size',27,'mime_type','application/pdf','bound_at','2026-10-30T18:00:00Z')
$$;
SET ROLE authenticated;
SELECT public.test_denied($q$SELECT public.complete_knowledge_extraction(NULL,NULL,NULL,NULL,NULL,NULL,NULL::jsonb)$q$,'permission denied');
SET ROLE service_role;
INSERT INTO public.extract_test VALUES('binary',public.submit_knowledge_extraction('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000089',NULL,NULL,'Synthetic agreement',NULL,public.test_binary_binding()),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='binary';
SELECT public.test_denied(format('SELECT public.complete_knowledge_extraction(%L,%L,1,1,%L,%L)',(SELECT result->>'work_id' FROM public.extract_test WHERE name='binary'),(SELECT started->>'server_key' FROM public.extract_test WHERE name='binary'),'Acme Services shall deliver a report.',public.test_binary_manifest()->>'source_sha256'),'KNOWLEDGE_OUTPUT_INVALID');
SELECT public.test_denied(format('SELECT public.complete_knowledge_extraction(%L,%L,1,1,%L,%L,%L::jsonb)',(SELECT result->>'work_id' FROM public.extract_test WHERE name='binary'),(SELECT started->>'server_key' FROM public.extract_test WHERE name='binary'),'Changed extracted text',public.test_binary_manifest()->>'source_sha256',(public.test_binary_manifest()-'extracted_content')::text),'KNOWLEDGE_OUTPUT_INVALID');
SELECT public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Acme Services shall deliver a report.',started->>'input_hash',public.test_binary_manifest()-'extracted_content') FROM public.extract_test WHERE name='binary';
RESET ROLE;
SELECT public.test_assert((SELECT extraction_evidence=public.test_binary_manifest() AND pending_review->>'coverage'='partial' AND source_evidence IS NULL AND source_binding IS NULL FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='binary')),'extraction evidence remains proposed and is not a published source or approved fact');
SET ROLE authenticated;
SELECT public.test_assert(public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='binary'),true)->'extraction_evidence'=public.test_binary_manifest(),'original authoritative review opt-in readback retains exact evidence');
SELECT public.test_denied(format('UPDATE public.tenant_knowledge_docs SET source_evidence=%L::jsonb WHERE id=%L',public.test_binary_manifest()::text,(SELECT result->>'document_id' FROM public.extract_test WHERE name='binary')),'permission denied');
SELECT public.test_assert(public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='binary'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='binary'),2,'Acme Services shall deliver a reviewed report.','{"title":"Reviewed synthetic agreement","summary":null,"category":null,"tags":[]}')->>'revision'='3','original review remains editable and CAS guarded');
RESET ROLE;
SELECT public.test_assert((SELECT extraction_evidence->>'extracted_content'='Acme Services shall deliver a report.' AND pending_review->>'reviewed_content'='Acme Services shall deliver a reviewed report.' FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='binary')),'review edits never rewrite the original extracted quotation');

-- Original publication work/generation/receipt only. Embeddings are fixture data,
-- not a provider call or retrieval relevance/quality proof.
SET ROLE authenticated;
UPDATE public.extract_test SET started=started||jsonb_build_object('publication',public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(result->>'document_id')::uuid,(result->>'work_id')::uuid,3,'60000000-0000-0000-0000-000000000089',encode(sha256(convert_to('Acme Services shall deliver a reviewed report.','UTF8')),'hex'))) WHERE name='binary';
RESET ROLE;
DO $publish_binary$
DECLARE w uuid:=(SELECT (started#>>'{publication,work_id}')::uuid FROM public.extract_test WHERE name='binary');
 s jsonb:=public.start_knowledge_publication(w); c jsonb; r jsonb;
BEGIN
 FOR c IN SELECT * FROM jsonb_array_elements(s->'chunks') LOOP
  PERFORM public.stage_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int,
   jsonb_build_array(jsonb_build_object('index',(c->>'index')::int,'sha256',c->>'sha256','embedding',(SELECT jsonb_agg(0.5 ORDER BY g) FROM generate_series(1,1024) g))));
 END LOOP;
 r:=public.complete_knowledge_publication(w,s->>'server_key',(s->>'attempt')::int,(s->>'revision')::int);
 PERFORM public.test_assert(r->>'verified_readback'='true','original binary publication authoritative result');
END $publish_binary$;
SELECT public.test_assert((SELECT record_state='canonical' AND revision=4 AND pending_review IS NULL AND extraction_evidence IS NULL
 AND source_evidence=public.test_binary_manifest() AND source_binding=public.test_binary_binding() AND source_coverage='partial'
 AND content='Acme Services shall deliver a reviewed report.' AND active_generation_id IS NOT NULL
 FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='binary')),'same publication atomically promotes original file evidence while retaining separately reviewed text');
SET ROLE authenticated;
SELECT public.test_assert(public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='binary'),true)->'source_evidence'=public.test_binary_manifest(),'later canonical source reopen retains original quotation hash and page evidence');
SELECT public.test_denied(format('SELECT source_evidence FROM public.tenant_knowledge_docs WHERE id=%L',(SELECT result->>'document_id' FROM public.extract_test WHERE name='binary')),'permission denied');
SELECT public.test_assert(NOT(public.read_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='binary'))?'source_evidence'),'closed legacy review response never changes without opt-in');
SELECT public.test_denied(format('SELECT public.read_tenant_knowledge_review(%L,%L,true)','00000000-0000-0000-0000-000000000002',(SELECT result->>'document_id' FROM public.extract_test WHERE name='binary')),'KNOWLEDGE_SCOPE_CHANGED');
RESET ROLE;

-- A source replacement is a proposed new reading, not automatic current facts
-- or new authority for existing tasks. Discard preserves prior canonical source.
INSERT INTO storage.objects VALUES('40000000-0000-0000-0000-000000000090','tenant-knowledge','00000000-0000-0000-0000-000000000001/agreement-v2.pdf');
CREATE FUNCTION public.test_binary_second_binding() RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.test_binary_binding()||jsonb_build_object('object_id','40000000-0000-0000-0000-000000000090','object_name','00000000-0000-0000-0000-000000000001/agreement-v2.pdf','sha256',encode(sha256(convert_to('different synthetic PDF bytes','UTF8')),'hex'))
$$;
SET ROLE service_role;
INSERT INTO public.extract_test SELECT 'binary-correction',public.submit_knowledge_extraction('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000090',(result->>'document_id')::uuid,4,'Changed source',NULL,public.test_binary_second_binding()),NULL FROM public.extract_test WHERE name='binary';
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='binary-correction';
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT public.test_denied(format('SELECT public.complete_knowledge_extraction(%L,%L,1,5,%L,%L,%L::jsonb)',(SELECT result->>'work_id' FROM public.extract_test WHERE name='binary-correction'),(SELECT started->>'server_key' FROM public.extract_test WHERE name='binary-correction'),'Acme Services shall deliver a report.',public.test_binary_second_binding()->>'sha256',((public.test_binary_manifest()-'extracted_content')||jsonb_build_object('source_sha256',public.test_binary_second_binding()->>'sha256'))::text),'KNOWLEDGE_SCOPE_CHANGED');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000001' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,5,'Acme Services shall deliver a report.',started->>'input_hash',(public.test_binary_manifest()-'extracted_content')||jsonb_build_object('source_sha256',public.test_binary_second_binding()->>'sha256')) FROM public.extract_test WHERE name='binary-correction';
SELECT public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,5,'Acme Services shall deliver a report.',started->>'input_hash',(public.test_binary_manifest()-'extracted_content')||jsonb_build_object('source_sha256',public.test_binary_second_binding()->>'sha256')) FROM public.extract_test WHERE name='binary-correction';
RESET ROLE;
SELECT public.test_assert((SELECT revision=6 AND source_evidence=public.test_binary_manifest() AND source_binding=public.test_binary_binding()
 AND extraction_evidence->>'source_sha256'=public.test_binary_second_binding()->>'sha256'
 FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='binary')),'correction and identical completion replay retain old canonical source and only one new pending revision');
SELECT public.test_assert((SELECT count(*)=1 FROM public.test_receipts WHERE run_id=(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='binary-correction')),'binary completion replay records fixture receipt once');
SET ROLE authenticated;
SELECT public.test_assert(public.discard_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='binary-correction'),(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='binary-correction'),6)->>'verified_readback'='true','original review discard authoritative result');
RESET ROLE;
SELECT public.test_assert((SELECT extraction_evidence IS NULL AND pending_review IS NULL AND source_evidence=public.test_binary_manifest()
 AND content='Acme Services shall deliver a reviewed report.' AND source_binding=public.test_binary_binding()
 FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='binary')),'discard removes only candidate evidence and preserves published source and text');
SET ROLE service_role;
INSERT INTO public.extract_test VALUES('binary-refused',public.test_extract('70000000-0000-0000-0000-000000000091'),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='binary-refused';
SELECT public.settle_knowledge_extraction_failure((result->>'work_id')::uuid,started->>'server_key',1,'file_encrypted',false) FROM public.extract_test WHERE name='binary-refused';
RESET ROLE;
SELECT public.test_assert((SELECT status='failed' AND error_code='file_encrypted' FROM public.paige_durable_work WHERE id=(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='binary-refused')),'original work preserves safe parser refusal reason without pretending source absence or replay');
