-- Isolated pgTAP contract proof; never run against customer production records.
BEGIN;
SELECT plan(8);
SELECT has_function('public','operator_read_account_details',ARRAY['uuid'],'read seam exists');
SELECT has_function('public','operator_edit_account_details',ARRAY['uuid','text','text','text'],'edit seam exists');
SELECT has_function('public','operator_preview_account_deletion',ARRAY['uuid'],'deletion preview seam exists');
SELECT ok(NOT has_function_privilege('anon','public.operator_read_account_details(uuid)','execute'),'anonymous details denied');
SELECT ok(NOT has_function_privilege('service_role','public.operator_edit_account_details(uuid,text,text,text)','execute'),'service role cannot impersonate operator edit');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.operator_read_account_details('00000000-0000-0000-0000-000000000001')$$,'42501','platform owner only','unauthenticated details denied');
SELECT throws_ok($$SELECT public.operator_edit_account_details('00000000-0000-0000-0000-000000000001','Example','active','v')$$,'42501','platform owner only','unauthenticated edit denied');
SELECT throws_ok($$SELECT public.operator_preview_account_deletion('00000000-0000-0000-0000-000000000001')$$,'42501','platform owner only','unauthenticated preview denied');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
