-- Failing requirement control, not a claim the legacy current-workspace API
-- promised an expected-workspace input. Every synthetic row is rolled back.
BEGIN;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.record_paige_memory('operating_preference','Synthetic reviewed preference',NULL,
 '{"reviewed_tenant_id":"00000000-0000-0000-0000-000000000001","intent_id":"70000000-0000-4000-8000-000000000001"}',false,'confirmed',NULL,'00000000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.paige_owner_memory WHERE tenant_id='00000000-0000-0000-0000-000000000002' AND content='Synthetic reviewed preference'),'reviewed-workspace mismatch must not persist in a later workspace');
ROLLBACK;
