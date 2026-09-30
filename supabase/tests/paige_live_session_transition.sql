-- INT-104 Hold is playback pause, not loss of the authenticated conversation.
-- Local/CI PostgreSQL fixture only; no provider or production request. Roll back all writes.
BEGIN;
SELECT plan(10);
INSERT INTO auth.users(id,aud,role,email)
VALUES ('fa120000-0000-4000-8000-000000000001','authenticated','authenticated','live-hold@tests.invalid');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand,owner_user_id)
VALUES ('fa120000-0000-4000-8000-000000001111','live-hold-test','Live Hold fixture','active','standalone','LHF',9381211,'{}','{}','fa120000-0000-4000-8000-000000000001');
INSERT INTO public.paige_chat_threads(id,caller_user_id,tenant_id,lens)
VALUES ('fa120000-0000-4000-8000-000000002222','fa120000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000001111','client');
INSERT INTO public.paige_live_sessions(id,tenant_id,actor_user_id,thread_id,context_epoch,entry_mode,state,availability)
VALUES ('fa120000-0000-4000-8000-000000003333','fa120000-0000-4000-8000-000000001111','fa120000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000002222','fixture-epoch','embedded','listening','LIVE');

CREATE FUNCTION pg_temp.live_transition(_action text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.paige_live_session_transition_internal('fa120000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000001111',
    'fa120000-0000-4000-8000-000000002222','fixture-epoch','fa120000-0000-4000-8000-000000003333',_action);
$$;
SELECT ok(NOT has_function_privilege('authenticated','public.paige_live_session_transition_internal(uuid,uuid,uuid,text,uuid,text)','EXECUTE'),'browser role cannot invoke internal transition');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(pg_temp.live_transition('hold')->>'state','held','Hold preserves the live session');
SELECT is(pg_temp.live_transition('resume')->>'state','listening','Resume returns held LIVE session to an admitted state');
SELECT is((SELECT availability FROM public.paige_live_sessions WHERE id='fa120000-0000-4000-8000-000000003333'),'LIVE','Resume does not invent or remove provider availability');
SELECT throws_ok($q$SELECT public.paige_live_session_transition_internal('fa120000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000009999','fa120000-0000-4000-8000-000000002222','fixture-epoch','fa120000-0000-4000-8000-000000003333','hold')$q$,'42501','PAIGE_LIVE_STALE_CONTEXT','wrong tenant still refused');
SELECT is(pg_temp.live_transition('minimize')->>'state','minimized','Minimize unchanged');
SELECT is(pg_temp.live_transition('restore')->>'state','unavailable','Restore still requires new relay ticket before live');
UPDATE public.paige_live_sessions SET state='held',availability='UNAVAILABLE' WHERE id='fa120000-0000-4000-8000-000000003333';
SELECT throws_ok($q$SELECT pg_temp.live_transition('resume')$q$,'22023','PAIGE_LIVE_INVALID_TRANSITION','revoked held session cannot be promoted');
SELECT is(pg_temp.live_transition('end')->>'state','ended','End remains terminal');
SELECT is(pg_temp.live_transition('resume')->>'state','ended','Resume never resurrects ended session');
SELECT * FROM finish();
ROLLBACK;
