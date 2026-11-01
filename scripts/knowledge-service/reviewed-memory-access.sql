-- Synthetic native permission/currentness controls, not real customer-role QA.
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
INSERT INTO public.paige_owner_memory(id,tenant_id,user_id,memory_type,content,metadata,created_by) VALUES
 ('80000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000099','preference','Foreign synthetic personal Memory','{"confirmation_state":"confirmed"}','10000000-0000-0000-0000-000000000099'),
 ('80000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','preference','Other workspace synthetic Memory','{"confirmation_state":"confirmed"}','10000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT public.test_assert(public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup('80000000-0000-4000-8000-000000000001'))->>'status'='absent','foreign user Memory remains unavailable');
SELECT public.test_assert(public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup('80000000-0000-4000-8000-000000000002'))->>'status'='absent','same user other-workspace Memory remains unavailable');
SELECT public.test_assert(public.forget_paige_memory('80000000-0000-4000-8000-000000000001',NULL,NULL,public.test_memory_lookup('80000000-0000-4000-8000-000000000001')||jsonb_build_object('expected_updated_at','2000-01-01T00:00:00Z'))->>'status'='absent','foreign selected Memory cannot be forgotten');
SELECT public.test_denied($q$SELECT public.get_paige_memory(NULL,1,NULL,NULL,jsonb_set(public.test_memory_lookup('80000000-0000-4000-8000-000000000001'),'{expected_actor}','"10000000-0000-0000-0000-000000000099"'))$q$,'PAIGE_MEMORY_REVIEW_SCOPE_CHANGED');
RESET ROLE;
SELECT public.test_assert((SELECT count(*)=2 FROM public.paige_owner_memory WHERE id IN ('80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002') AND is_active),'foreign and other-workspace records unchanged');
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.test_denied($q$SELECT public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='other')))$q$,'PAIGE_MEMORY_REVIEW_SCOPE_CHANGED');
SELECT public.test_denied($q$SELECT public.forget_paige_memory((SELECT id FROM public.memory_review_test WHERE name='other'),NULL,NULL,public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='other'))||jsonb_build_object('expected_updated_at','2000-01-01T00:00:00Z'))$q$,'PAIGE_MEMORY_REVIEW_SCOPE_CHANGED');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000001' WHERE user_id='10000000-0000-0000-0000-000000000001';
UPDATE auth.users SET deleted_at=now() WHERE id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.test_denied($q$SELECT public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='other')))$q$,'PAIGE_MEMORY_REVIEW_ACTOR_UNAVAILABLE');
RESET ROLE;
UPDATE auth.users SET deleted_at=NULL,banned_until=now()+interval '1 day' WHERE id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.test_denied($q$SELECT public.forget_paige_memory((SELECT id FROM public.memory_review_test WHERE name='other'),NULL,NULL,public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='other'))||jsonb_build_object('expected_updated_at','2000-01-01T00:00:00Z'))$q$,'PAIGE_MEMORY_REVIEW_ACTOR_UNAVAILABLE');
RESET ROLE;
UPDATE auth.users SET banned_until=NULL WHERE id='10000000-0000-0000-0000-000000000001';
UPDATE public.test_members SET active=false WHERE user_id='10000000-0000-0000-0000-000000000001' AND tenant_id='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.test_denied($q$SELECT public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='other')))$q$,'PAIGE_MEMORY_REVIEW_FORBIDDEN');
RESET ROLE;
UPDATE public.test_members SET active=true WHERE user_id='10000000-0000-0000-0000-000000000001' AND tenant_id='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.test_assert(public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup((SELECT id FROM public.memory_review_test WHERE name='other')))->>'status'='present','legitimate own-scope Memory returns after restoration');
RESET ROLE;
