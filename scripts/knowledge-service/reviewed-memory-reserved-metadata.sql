BEGIN;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.test_denied($q$SELECT public.record_paige_memory('preference','Reserved metadata request',NULL,'{"confirmed_at":"caller value"}',false,'confirmed',NULL,NULL,public.test_memory_review('70000000-0000-4000-8000-000000000007'))$q$,'PAIGE_MEMORY_REVIEW_INVALID');
SELECT public.test_denied($q$SELECT public.record_paige_memory('preference','Reserved metadata request',NULL,'{"confirmed_at":"caller value"}',false,'confirmed',NULL,NULL,public.test_memory_review('70000000-0000-4000-8000-000000000007'))$q$,'PAIGE_MEMORY_REVIEW_INVALID');
RESET ROLE;
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.paige_owner_memory WHERE content='Reserved metadata request'),'reserved metadata is refused before first or repeated effect');
ROLLBACK;
