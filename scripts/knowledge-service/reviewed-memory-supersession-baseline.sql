-- Requirement control: selecting ONE correction must preserve unrelated facts.
-- Original type-wide supersession exists; this is not a new production incident.
BEGIN;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000001' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.record_paige_memory('operating_preference','Synthetic unrelated preference',NULL,'{}',false,'confirmed',NULL,NULL);
SELECT public.record_paige_memory('operating_preference','Synthetic selected preference',NULL,'{}',false,'confirmed',NULL,NULL);
SELECT public.record_paige_memory('operating_preference','Synthetic selected correction',NULL,'{}',true,'confirmed',NULL,NULL);
RESET ROLE;
SELECT public.test_assert(EXISTS(SELECT 1 FROM public.paige_owner_memory WHERE content='Synthetic unrelated preference' AND is_active),'selected correction must preserve unrelated same-type active Memory');
ROLLBACK;
