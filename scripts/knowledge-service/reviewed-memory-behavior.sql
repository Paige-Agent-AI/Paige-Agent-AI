-- Local native candidate controls. Synthetic source and original Memory only.
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000001' WHERE user_id='10000000-0000-0000-0000-000000000001';
UPDATE public.test_members SET active=true;
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,record_state)
 VALUES('20000000-0000-4000-8000-000000000099','00000000-0000-0000-0000-000000000001','Synthetic source','Send weekly status updates.','canonical');
CREATE FUNCTION public.test_memory_review(intent uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('schema_version',1,'expected_actor','10000000-0000-0000-0000-000000000001','expected_tenant','00000000-0000-0000-0000-000000000001','intent_id',intent,
 'source_reference',jsonb_build_object('contractVersion',1,'tenantId',d.tenant_id,'documentId',d.id,'revision',d.revision,'contentSha256',encode(sha256(convert_to(d.content,'UTF8')),'hex')),'source_quote','weekly status updates')
 FROM public.tenant_knowledge_docs d WHERE id='20000000-0000-4000-8000-000000000099' $$;
GRANT EXECUTE ON FUNCTION public.test_memory_review(uuid) TO authenticated;
CREATE TABLE public.memory_review_test(name text PRIMARY KEY,id uuid);
GRANT ALL ON public.memory_review_test TO authenticated;
SET ROLE authenticated;
INSERT INTO public.memory_review_test VALUES('first',public.record_paige_memory('operating_preference','Send a weekly update',NULL,'{}',false,'confirmed',NULL,NULL,public.test_memory_review('70000000-0000-4000-8000-000000000001')));
SELECT public.test_assert(public.record_paige_memory('operating_preference','Send a weekly update',NULL,'{}',false,'confirmed',NULL,NULL,public.test_memory_review('70000000-0000-4000-8000-000000000001'))=(SELECT id FROM public.memory_review_test WHERE name='first'),'same reviewed intent returns same original Memory ID');
SELECT public.test_denied($q$SELECT public.record_paige_memory('operating_preference','Changed intent content',NULL,'{}',false,'confirmed',NULL,NULL,public.test_memory_review('70000000-0000-4000-8000-000000000001'))$q$,'PAIGE_MEMORY_REVIEW_INTENT_CONFLICT');
SELECT public.test_denied($q$SELECT public.record_paige_memory('operating_preference','Unapproved',NULL,'{}',false,'proposed',NULL,NULL,public.test_memory_review('70000000-0000-4000-8000-000000000002'))$q$,'PAIGE_MEMORY_REVIEW_INVALID');
SELECT public.test_denied($q$SELECT public.record_paige_memory('operating_preference','No type-wide retirement',NULL,'{}',true,'confirmed',NULL,NULL)$q$,'PAIGE_MEMORY_SELECTED_REVIEW_REQUIRED');
RESET ROLE;
SELECT public.test_assert((SELECT count(*)=1 FROM public.paige_owner_memory WHERE metadata#>>'{reviewed_save,intent_id}'='70000000-0000-4000-8000-000000000001'),'one stored effect for reviewed replay');
SELECT public.test_assert(EXISTS(SELECT 1 FROM public.get_paige_memory() WHERE id=(SELECT id FROM public.memory_review_test WHERE name='first') AND metadata->>'confirmation_state'='confirmed'),'original authoritative Memory read returns approved result');
CREATE TABLE public.memory_review_scope AS SELECT public.test_memory_review('70000000-0000-4000-8000-000000000003') AS review;
GRANT SELECT ON public.memory_review_scope TO authenticated;
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.test_denied($q$SELECT public.record_paige_memory('operating_preference','Wrong workspace',NULL,'{}',false,'confirmed',NULL,NULL,(SELECT review FROM public.memory_review_scope))$q$,'KNOWLEDGE_SCOPE_CHANGED');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000001' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
INSERT INTO public.memory_review_test VALUES('other',public.record_paige_memory('operating_preference','Unrelated preference',NULL,'{}',false,'confirmed',NULL,NULL));
INSERT INTO public.memory_review_test VALUES('correction',public.record_paige_memory('operating_preference','Corrected weekly update',NULL,'{}',true,'confirmed',NULL,NULL,
 public.test_memory_review('70000000-0000-4000-8000-000000000004')||jsonb_build_object('supersedes',jsonb_build_object('memory_id',(SELECT id FROM public.memory_review_test WHERE name='first'),'updated_at',(SELECT updated_at FROM public.get_paige_memory() WHERE id=(SELECT id FROM public.memory_review_test WHERE name='first'))))));
RESET ROLE;
SELECT public.test_assert((SELECT is_active FROM public.paige_owner_memory WHERE id=(SELECT id FROM public.memory_review_test WHERE name='other')),'selected correction preserves unrelated same-type Memory');
SELECT public.test_assert(NOT(SELECT is_active FROM public.paige_owner_memory WHERE id=(SELECT id FROM public.memory_review_test WHERE name='first')),'only selected prior Memory is retired');
SELECT public.test_assert((SELECT count(*)=3 FROM public.paige_owner_memory),'no refused call or replay creates another Memory');
