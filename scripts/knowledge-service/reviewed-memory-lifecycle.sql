-- Additional native read/forget capability controls, not browser persistence proof.
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
CREATE FUNCTION public.test_memory_lookup(memory uuid DEFAULT NULL,intent uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('schema_version',1,'expected_actor','10000000-0000-0000-0000-000000000001','expected_tenant','00000000-0000-0000-0000-000000000001','memory_id',memory,'intent_id',intent)) $$;
GRANT EXECUTE ON FUNCTION public.test_memory_lookup(uuid,uuid) TO authenticated;
SET ROLE authenticated;
SELECT public.test_assert(public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='correction')))->>'status'='present','exact original Memory item reopens after another connection');
SELECT public.test_assert(public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup(NULL,'70000000-0000-4000-8000-000000000004'))#>>'{memory,id}'=(SELECT id::text FROM public.memory_review_test WHERE name='correction'),'unknown-save inspection resolves original intent to same Memory ID');
SELECT public.test_assert(public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup(NULL,'70000000-0000-4000-8000-000000000099'))->>'status'='absent','native intent lookup reports actual scoped absence');
SELECT public.test_assert(public.forget_paige_memory((SELECT id FROM public.memory_review_test WHERE name='first'),NULL,NULL,
 public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='first'))||jsonb_build_object('expected_updated_at','2000-01-01T00:00:00Z'))->>'effect'='already_retired','first forget of a superseded fact reports observed retirement without claiming its own replay');
SELECT public.test_assert((public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='correction')))->>'eligible_for_context')::boolean,'current approved Memory source is eligible for context');
RESET ROLE;
UPDATE public.tenant_knowledge_docs SET content='The synthetic source has changed.' WHERE id='20000000-0000-4000-8000-000000000099';
SET ROLE authenticated;
SELECT public.test_assert(public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='correction')))->>'source_state'='changed','changed source does not silently refresh approved Memory');
SELECT public.test_assert(NOT(public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='correction')))->>'eligible_for_context')::boolean,'stale source-bound Memory is not current task context');
SELECT public.test_assert(public.forget_paige_memory((SELECT id FROM public.memory_review_test WHERE name='correction'),NULL,NULL,
 public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='correction'))||jsonb_build_object('expected_updated_at',(SELECT updated_at FROM public.get_paige_memory() WHERE id=(SELECT id FROM public.memory_review_test WHERE name='correction'))))->>'status'='retired','original forget retires selected Memory even when its source changed');
SELECT public.test_assert(public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup(NULL,'70000000-0000-4000-8000-000000000004'))->>'status'='retired','forgotten intent is inspectable as retired rather than missing');
SELECT public.test_assert(public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup(NULL,'70000000-0000-4000-8000-000000000004'))#>'{memory,content}'='null'::jsonb,'forgotten content is not returned by recovery inspection');
SELECT public.test_assert(public.forget_paige_memory((SELECT id FROM public.memory_review_test WHERE name='correction'),NULL,NULL,
 public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='correction'))||jsonb_build_object('expected_updated_at','2000-01-01T00:00:00Z'))->>'status'='retired','repeat forget reads retirement without another effect');
RESET ROLE;
SELECT public.test_assert((SELECT is_active FROM public.paige_owner_memory WHERE id=(SELECT id FROM public.memory_review_test WHERE name='other')),'forget preserves unrelated same-type Memory');
