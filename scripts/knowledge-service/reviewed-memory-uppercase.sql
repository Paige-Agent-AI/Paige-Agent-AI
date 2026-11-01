BEGIN;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.record_paige_memory('preference','Uppercase reviewed intent',NULL,'{}',false,'confirmed',NULL,NULL,
 jsonb_set(public.test_memory_review('70000000-abcd-4000-8000-000000000005'),'{intent_id}','"70000000-ABCD-4000-8000-000000000005"')) FROM generate_series(1,2);
RESET ROLE;
SELECT public.test_assert((SELECT count(*)=1 FROM public.paige_owner_memory WHERE content='Uppercase reviewed intent'),'uppercase UUID spelling must resolve the same reviewed intent once');
ROLLBACK;
