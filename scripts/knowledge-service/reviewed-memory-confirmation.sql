-- Source currentness is not confirmation. Legacy candidate/retired states stay
-- inspectable by the original read, and downstream C6 owns their framing.
BEGIN;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.record_paige_memory('preference','Current-source proposed candidate',NULL,
 jsonb_build_object('reviewed_save',public.test_memory_review('70000000-0000-4000-8000-000000000021')),false,'proposed',NULL,NULL);
SELECT public.record_paige_memory('preference','Current-source retired candidate',NULL,
 jsonb_build_object('reviewed_save',public.test_memory_review('70000000-0000-4000-8000-000000000022')),false,'retired',NULL,NULL);
SELECT public.test_assert(EXISTS(SELECT 1 FROM public.get_paige_memory() WHERE content='Current-source proposed candidate' AND metadata->>'confirmation_state'='proposed'),'original source filter does not rewrite proposed confirmation');
SELECT public.test_assert(NOT(public.get_paige_memory(NULL,1,NULL,NULL,jsonb_build_object('schema_version',1,'expected_actor','10000000-0000-0000-0000-000000000001','expected_tenant','00000000-0000-0000-0000-000000000001','intent_id','70000000-0000-4000-8000-000000000021'))->>'eligible_for_context')::boolean,'current source alone does not make a proposed fact approved');
SELECT public.test_assert(NOT(public.get_paige_memory(NULL,1,NULL,NULL,jsonb_build_object('schema_version',1,'expected_actor','10000000-0000-0000-0000-000000000001','expected_tenant','00000000-0000-0000-0000-000000000001','intent_id','70000000-0000-4000-8000-000000000022'))->>'eligible_for_context')::boolean,'retired confirmation is never current task knowledge');
ROLLBACK;
