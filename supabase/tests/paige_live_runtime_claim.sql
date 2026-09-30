-- Real PostgreSQL one-use claim on the existing service-only slot. Fixtures roll back.
BEGIN;
SELECT plan(5);
INSERT INTO auth.users(id,aud,role,email)
VALUES ('fa110000-0000-4000-8000-000000000001','authenticated','authenticated','live-runtime@tests.invalid');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand,owner_user_id)
VALUES ('fa110000-0000-4000-8000-000000001111','live-runtime-claim-test','Runtime claim fixture','active','standalone','LRC',9381111,'{}','{}','fa110000-0000-4000-8000-000000000001');
INSERT INTO public.paige_chat_threads(id,caller_user_id,tenant_id,lens)
VALUES ('fa110000-0000-4000-8000-000000002222','fa110000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000001111','client');
INSERT INTO public.paige_live_sessions(id,tenant_id,actor_user_id,thread_id,context_epoch,entry_mode,state,availability,provider_session_ref)
VALUES ('fa110000-0000-4000-8000-000000003333','fa110000-0000-4000-8000-000000001111','fa110000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000002222','fixture-epoch','embedded','listening','LIVE','runtime:fixture-digest');
SELECT ok(NOT has_table_privilege('authenticated','public.paige_live_sessions','UPDATE'),'authenticated clients cannot mint or reset runtime challenges');
WITH claimed AS (
  UPDATE public.paige_live_sessions SET provider_session_ref=NULL
  WHERE id='fa110000-0000-4000-8000-000000003333' AND actor_user_id='fa110000-0000-4000-8000-000000000099'
    AND provider_session_ref='runtime:fixture-digest' RETURNING id
) SELECT is((SELECT count(*)::integer FROM claimed),0,'wrong actor cannot consume challenge');
WITH claimed AS (
  UPDATE public.paige_live_sessions SET provider_session_ref=NULL
  WHERE id='fa110000-0000-4000-8000-000000003333' AND tenant_id='fa110000-0000-4000-8000-000000009999'
    AND provider_session_ref='runtime:fixture-digest' RETURNING id
) SELECT is((SELECT count(*)::integer FROM claimed),0,'wrong tenant cannot consume challenge');
WITH claimed AS (
  UPDATE public.paige_live_sessions SET provider_session_ref=NULL
  WHERE id='fa110000-0000-4000-8000-000000003333' AND tenant_id='fa110000-0000-4000-8000-000000001111'
    AND actor_user_id='fa110000-0000-4000-8000-000000000001' AND thread_id='fa110000-0000-4000-8000-000000002222'
    AND context_epoch='fixture-epoch' AND availability='LIVE' AND state IN ('listening','thinking','speaking','interrupted')
    AND provider_session_ref='runtime:fixture-digest' RETURNING id
) SELECT is((SELECT count(*)::integer FROM claimed),1,'exact scoped atomic claim succeeds once');
WITH claimed AS (
  UPDATE public.paige_live_sessions SET provider_session_ref=NULL
  WHERE id='fa110000-0000-4000-8000-000000003333' AND tenant_id='fa110000-0000-4000-8000-000000001111'
    AND actor_user_id='fa110000-0000-4000-8000-000000000001' AND thread_id='fa110000-0000-4000-8000-000000002222'
    AND context_epoch='fixture-epoch' AND availability='LIVE' AND state IN ('listening','thinking','speaking','interrupted')
    AND provider_session_ref='runtime:fixture-digest' RETURNING id
) SELECT is((SELECT count(*)::integer FROM claimed),0,'replayed challenge cannot dispatch a second runtime call');
SELECT * FROM finish();
ROLLBACK;
