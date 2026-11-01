-- Failing requirement control for interrupted reviewed-save reconciliation.
-- Metadata intent is DATA; the old native writer does not admit idempotency.
BEGIN;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000001' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.record_paige_memory('operating_preference','Synthetic repeated preference',NULL,
 '{"intent_id":"70000000-0000-4000-8000-000000000002"}',false,'confirmed',NULL,NULL) FROM generate_series(1,2);
RESET ROLE;
SELECT public.test_assert((SELECT count(*)=1 FROM public.paige_owner_memory WHERE metadata->>'intent_id'='70000000-0000-4000-8000-000000000002'),'same reviewed save intent must resolve one original Memory record');
ROLLBACK;
