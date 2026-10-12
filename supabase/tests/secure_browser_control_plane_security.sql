-- Paige Secure Browser control-plane security and lifecycle proof.
-- Synthetic fixtures only; the transaction is always rolled back.
BEGIN;
SELECT plan(42);

SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.secure_browser_sessions'::regclass),'sessions force RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.secure_browser_sessions','SELECT,INSERT,UPDATE,DELETE'),'authenticated has no direct session access');
SELECT ok(NOT has_table_privilege('service_role','public.secure_browser_sessions','SELECT,INSERT,UPDATE,DELETE'),'service role has no direct session access');
SELECT ok(has_function_privilege('service_role','public.secure_browser_request_unavailable(uuid,uuid,text,uuid,text,text,text,jsonb,uuid)','EXECUTE'),'service request boundary is reachable');
SELECT ok(NOT has_function_privilege('authenticated','public.secure_browser_request_unavailable(uuid,uuid,text,uuid,text,text,text,jsonb,uuid)','EXECUTE'),'browser cannot call service request boundary');
SELECT ok(NOT public._secure_browser_safe_text('password: hunter123'),'database rejects a labeled password value');
SELECT ok(NOT public._secure_browser_safe_text('use bearer abcdefghijklmnop'),'database rejects a bearer value');
SELECT ok(NOT public._secure_browser_safe_json('{"notes":["token: abcdefghijk"]}'),'database recursively rejects a generic token value');
SELECT ok(public._secure_browser_safe_text('Review quarterly filing status'),'ordinary business purpose remains valid');

INSERT INTO auth.users(id,aud,role,email) VALUES
 ('5a000000-0000-4000-8000-000000000001','authenticated','authenticated','sb-owner-a@tests.invalid'),
 ('5a000000-0000-4000-8000-000000000002','authenticated','authenticated','sb-admin-a@tests.invalid'),
 ('5b000000-0000-4000-8000-000000000001','authenticated','authenticated','sb-owner-b@tests.invalid');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,owner_user_id) VALUES
 ('5a000000-0000-4000-8000-00000000aaaa','secure-browser-a','Secure Browser A','active','standalone','SBA',9395001,'{"secure_browser":true}','5a000000-0000-4000-8000-000000000001'),
 ('5b000000-0000-4000-8000-00000000bbbb','secure-browser-b','Secure Browser B','active','standalone','SBB',9395002,'{"secure_browser":true}','5b000000-0000-4000-8000-000000000001');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('5a000000-0000-4000-8000-00000000aaaa','5a000000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('5a000000-0000-4000-8000-00000000aaaa','5a000000-0000-4000-8000-000000000002','admin','active',false,now()),
 ('5b000000-0000-4000-8000-00000000bbbb','5b000000-0000-4000-8000-000000000001','owner','active',true,now());
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('5a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-00000000aaaa'),
 ('5a000000-0000-4000-8000-000000000002','5a000000-0000-4000-8000-00000000aaaa'),
 ('5b000000-0000-4000-8000-000000000001','5b000000-0000-4000-8000-00000000bbbb')
ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;
INSERT INTO public.paige_chat_threads(id,caller_user_id,tenant_id,lens,title) VALUES
 ('5a000000-0000-4000-8000-000000009901','5a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-00000000aaaa','coach','Secure Browser owner'),
 ('5a000000-0000-4000-8000-000000009902','5a000000-0000-4000-8000-000000000002','5a000000-0000-4000-8000-00000000aaaa','coach','Secure Browser admin');
INSERT INTO public.secure_browser_tenant_limits(tenant_id,enabled,worker_available,max_active_sessions,max_session_seconds,max_daily_session_seconds,max_monthly_cost_microusd,configured_by)
VALUES('5a000000-0000-4000-8000-00000000aaaa',true,true,1,900,1800,1000,'5a000000-0000-4000-8000-000000000001');

SELECT is(public._secure_browser_actor_kind('5a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-00000000aaaa'),'owner','database resolves owner exactly');
SELECT is(public._secure_browser_actor_kind('5a000000-0000-4000-8000-000000000002','5a000000-0000-4000-8000-00000000aaaa'),'admin','database resolves admin exactly');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$SELECT public.secure_browser_request_unavailable('5a000000-0000-4000-8000-00000000aaaa','5a000000-0000-4000-8000-000000000001','owner','5a000000-0000-4000-8000-000000009901','password: hunter123','https://example.com','example.com','{"mode":"read_only","allowedOrigins":["https://example.com"],"allowedReadKinds":["status"],"downloads":"disabled","consequentialActions":"disabled"}','5a000000-0000-4000-8000-000000008001')$q$,'22023','SECURE_BROWSER_REQUEST_INVALID','secret-looking purpose never persists');
SELECT throws_ok($q$SELECT public.secure_browser_request_unavailable('5a000000-0000-4000-8000-00000000aaaa','5a000000-0000-4000-8000-000000000001','owner','5a000000-0000-4000-8000-000000009901','client secret: abcdefghijk','https://example.com','example.com','{"mode":"read_only","allowedOrigins":["https://example.com"],"allowedReadKinds":["status"],"downloads":"disabled","consequentialActions":"disabled"}','5a000000-0000-4000-8000-000000008005')$q$,'22023','SECURE_BROWSER_REQUEST_INVALID','generic client secret purpose never persists');
SELECT throws_ok($q$SELECT public.secure_browser_request_unavailable('5a000000-0000-4000-8000-00000000aaaa','5a000000-0000-4000-8000-000000000001','admin','5a000000-0000-4000-8000-000000009901','Review filing status','https://example.com','example.com','{"mode":"read_only","allowedOrigins":["https://example.com"],"allowedReadKinds":["status"],"downloads":"disabled","consequentialActions":"disabled"}','5a000000-0000-4000-8000-000000008002')$q$,'22023','SECURE_BROWSER_ACTOR_KIND_INVALID','caller cannot relabel an owner as admin');
CREATE TEMP TABLE sb_owner_request AS SELECT public.secure_browser_request_unavailable(
 '5a000000-0000-4000-8000-00000000aaaa','5a000000-0000-4000-8000-000000000001','owner','5a000000-0000-4000-8000-000000009901','Review filing status','https://example.com','example.com',
 '{"mode":"read_only","allowedOrigins":["https://example.com"],"allowedReadKinds":["status"],"downloads":"disabled","consequentialActions":"disabled"}','5a000000-0000-4000-8000-000000008003') result;
SELECT is((SELECT result->'session'->>'state' FROM sb_owner_request),'unavailable','owner request records truthful unavailability');
CREATE TEMP TABLE sb_reservation AS SELECT public.secure_browser_reserve_session(
 '5a000000-0000-4000-8000-00000000aaaa','5a000000-0000-4000-8000-000000000002','admin','5a000000-0000-4000-8000-000000009902','Review filing status','https://example.com','example.com',
 '{"mode":"read_only","allowedOrigins":["https://example.com"],"allowedReadKinds":["status"],"downloads":"disabled","consequentialActions":"disabled"}','5a000000-0000-4000-8000-000000008004',120,100) result;
SELECT is((SELECT result->>'state' FROM sb_reservation),'opening','one bounded reservation opens');
CREATE TEMP TABLE sb_settlement AS SELECT public.secure_browser_settle_session_usage('5a000000-0000-4000-8000-00000000aaaa',(SELECT (result->>'sessionId')::uuid FROM sb_reservation),30,40) result;
SELECT ok((SELECT (result->>'settled')::boolean FROM sb_settlement),'first settlement succeeds');
SELECT ok(NOT (public.secure_browser_settle_session_usage('5a000000-0000-4000-8000-00000000aaaa',(SELECT (result->>'sessionId')::uuid FROM sb_reservation),30,40)->>'settled')::boolean,'settlement replay is idempotent');
RESET ROLE;
SELECT is((SELECT reserved_seconds::integer FROM public.secure_browser_usage_windows WHERE tenant_id='5a000000-0000-4000-8000-00000000aaaa' AND window_kind='day'),0,'settlement releases reserved seconds');
SELECT is((SELECT consumed_seconds::integer FROM public.secure_browser_usage_windows WHERE tenant_id='5a000000-0000-4000-8000-00000000aaaa' AND window_kind='day'),30,'settlement records consumed seconds once');

INSERT INTO public.business_vault_quarantine_uploads(id,tenant_id,requested_by,title,section,record_type,handling_mode,visibility,storage_path,original_filename,declared_mime,declared_size,adapter_key,inspection_state)
VALUES
 ('5a000000-0000-4000-8000-000000007001','5a000000-0000-4000-8000-00000000aaaa','5a000000-0000-4000-8000-000000000001','A file','library','document','store_only','owner_only','5a000000-0000-4000-8000-00000000aaaa/q-a','a.pdf','application/pdf',10,'disabled','reserved'),
 ('5b000000-0000-4000-8000-000000007002','5b000000-0000-4000-8000-00000000bbbb','5b000000-0000-4000-8000-000000000001','B file','library','document','store_only','owner_only','5b000000-0000-4000-8000-00000000bbbb/q-b','b.pdf','application/pdf',10,'disabled','reserved');
SELECT throws_ok($q$INSERT INTO public.secure_browser_download_intakes(tenant_id,session_id,requested_by,state,quarantine_id,safe_reason) VALUES('5a000000-0000-4000-8000-00000000aaaa',(SELECT (result->'session'->>'id')::uuid FROM sb_owner_request),'5a000000-0000-4000-8000-000000000001','quarantine_reserved','5b000000-0000-4000-8000-000000007002','test')$q$,'23503',NULL,'cross-tenant quarantine link fails');
SELECT throws_ok($q$INSERT INTO public.secure_browser_download_intakes(tenant_id,session_id,requested_by,state,quarantine_id,safe_reason) VALUES('5a000000-0000-4000-8000-00000000aaaa',(SELECT (result->'session'->>'id')::uuid FROM sb_owner_request),'5a000000-0000-4000-8000-000000000001','passed','5a000000-0000-4000-8000-000000007001','test')$q$,'23514','SECURE_BROWSER_QUARANTINE_STATE_INVALID','intake cannot claim passed before canonical inspection');
UPDATE public.business_vault_quarantine_uploads SET inspection_state='passed' WHERE id='5a000000-0000-4000-8000-000000007001';
SELECT lives_ok($q$INSERT INTO public.secure_browser_download_intakes(tenant_id,session_id,requested_by,state,quarantine_id,safe_reason) VALUES('5a000000-0000-4000-8000-00000000aaaa',(SELECT (result->'session'->>'id')::uuid FROM sb_owner_request),'5a000000-0000-4000-8000-000000000001','passed','5a000000-0000-4000-8000-000000007001','inspection_passed')$q$,'passed intake requires matching tenant and canonical passed inspection');

INSERT INTO public.secure_browser_connected_accounts(tenant_id,created_by,label,target_origin,target_display_host,state,expires_at)
VALUES('5a000000-0000-4000-8000-00000000aaaa','5a000000-0000-4000-8000-000000000001','Expired metadata','https://example.com','example.com','active',now()-interval '1 minute');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"5a000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is((public.list_secure_browser_connected_accounts()->0->>'state'),'expired','expired account is never presented as active');
SELECT throws_ok($q$SELECT public.control_secure_browser_connected_account((SELECT id FROM public.secure_browser_connected_accounts WHERE label='Expired metadata'),'pause')$q$,'42501',NULL,'direct hidden-table lookup remains unavailable to authenticated caller');
RESET ROLE;
SELECT is((SELECT state FROM public.secure_browser_connected_accounts WHERE label='Expired metadata'),'expired','expiry is persisted canonically');
SELECT is((SELECT count(*)::integer FROM public.secure_browser_receipts WHERE action_kind='account.expire'),1,'account expiry writes one detailed receipt with Rail identity');
SELECT is((SELECT count(*)::integer FROM public.secure_browser_receipts WHERE action_kind='usage.settle'),1,'settlement writes one detailed receipt');


-- ── PC-1 browse budget gate + settle (#2003 coordinator P1+P2) ────────────────────────────────────
-- Real PostgreSQL permissions under the executing role: the gate/settle pair is the ONLY authorized
-- service-role door to the limits; direct table reads stay revoked (proven above for sessions; same
-- REVOKE covers the limits + windows tables in 20270419000000). Tenant B has NO limits row here —
-- the missing-row fail-closed proof. Atomicity of concurrent reservations is proven separately by
-- scripts/proof/secure-browser-browse-budget-concurrency.mjs (12 racing callers, budget admits 4).
SELECT ok(has_function_privilege('service_role','public.secure_browser_browse_budget_gate(uuid,integer)','EXECUTE'),'browse budget gate is service-role reachable');
SELECT ok(NOT has_function_privilege('authenticated','public.secure_browser_browse_budget_gate(uuid,integer)','EXECUTE'),'browser cannot call the browse budget gate');
SELECT ok(has_function_privilege('service_role','public.secure_browser_browse_budget_settle(uuid,integer,integer)','EXECUTE'),'browse budget settle is service-role reachable');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is((SELECT public.secure_browser_browse_budget_gate('5b000000-0000-4000-8000-00000000bbbb',45)->>'reason'),'control_plane:not_configured','MISSING limits row fails closed (P2)');
SELECT is((SELECT public.secure_browser_browse_budget_gate('5a000000-0000-4000-8000-00000000aaaa',45)->>'allowed'),'true','configured tenant reserves atomically');
RESET ROLE;
SELECT is((SELECT reserved_seconds::integer FROM public.secure_browser_usage_windows WHERE tenant_id='5a000000-0000-4000-8000-00000000aaaa' AND window_kind='day'),45,'gate reserved worst-case seconds in the day window');

UPDATE public.secure_browser_tenant_limits SET enabled=false WHERE tenant_id='5a000000-0000-4000-8000-00000000aaaa';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is((SELECT public.secure_browser_browse_budget_gate('5a000000-0000-4000-8000-00000000aaaa',45)->>'reason'),'control_plane:disabled','disabled limits row refuses');
RESET ROLE;
UPDATE public.secure_browser_tenant_limits SET enabled=true WHERE tenant_id='5a000000-0000-4000-8000-00000000aaaa';

UPDATE public.secure_browser_usage_windows SET consumed_seconds=1770 WHERE tenant_id='5a000000-0000-4000-8000-00000000aaaa' AND window_kind='day';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is((SELECT public.secure_browser_browse_budget_gate('5a000000-0000-4000-8000-00000000aaaa',45)->>'reason'),'control_plane:daily_budget','exhausted daily budget refuses (45 reserved + 1770 consumed > 1800)');
SELECT is((SELECT public.secure_browser_browse_budget_settle('5a000000-0000-4000-8000-00000000aaaa',45,5)->>'settled'),'true','settle releases the reservation and records actual seconds');
RESET ROLE;
SELECT is((SELECT reserved_seconds::integer FROM public.secure_browser_usage_windows WHERE tenant_id='5a000000-0000-4000-8000-00000000aaaa' AND window_kind='day'),0,'settle released the reserved seconds');
SELECT is((SELECT consumed_seconds::integer FROM public.secure_browser_usage_windows WHERE tenant_id='5a000000-0000-4000-8000-00000000aaaa' AND window_kind='day'),1775,'settle recorded actual seconds once');

UPDATE public.tenants SET features=features-'secure_browser' WHERE id='5a000000-0000-4000-8000-00000000aaaa';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is((SELECT public.secure_browser_browse_budget_gate('5a000000-0000-4000-8000-00000000aaaa',45)->>'reason'),'control_plane:feature_disabled','feature-off tenant refuses even with limits configured');
RESET ROLE;
UPDATE public.tenants SET features=jsonb_set(features,'{secure_browser}','true') WHERE id='5a000000-0000-4000-8000-00000000aaaa';

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$SELECT public.secure_browser_browse_budget_settle('5a000000-0000-4000-8000-00000000aaaa',45,46)$q$,'22023',NULL,'settle cannot consume more than it reserved');
SELECT throws_ok($q$SELECT public.secure_browser_browse_budget_gate('5a000000-0000-4000-8000-00000000aaaa',0)$q$,'22023',NULL,'gate rejects a zero reservation');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
