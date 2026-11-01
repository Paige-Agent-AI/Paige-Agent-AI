-- Full replayed schema, original functions/triggers/RLS. Synthetic identities only.
-- Every write rolls back; this is engineering evidence, not customer authentication.
BEGIN;
SELECT plan(28);

SELECT ok(has_function_privilege('authenticated','public.platform_owner_recovery(uuid,text,uuid,text,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.platform_owner_recovery(uuid,text,uuid,text,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.platform_owner_recovery(uuid,text,uuid,text,uuid)','EXECUTE'),
 'original recovery door admits authenticated body checks only');
SELECT ok(has_function_privilege('service_role','public.get_owner_recovery_delivery_event(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.get_owner_recovery_delivery_event(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.get_owner_recovery_delivery_event(uuid,uuid)','EXECUTE'),
 'delivery event has the separate original service principal ACL');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE '\_exp08\_%' ESCAPE '\'
 AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
  OR has_function_privilege('service_role',p.oid,'EXECUTE'))),
 'all private recovery kernels/helpers exclude direct client and service execution');

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('e8b00000-0000-4000-8000-000000000001','authenticated','authenticated','e8-recovery-operator@tests.invalid'),
 ('e8b00000-0000-4000-8000-000000000002','authenticated','authenticated','e8-recovery-owner@tests.invalid'),
 ('e8b00000-0000-4000-8000-000000000003','authenticated','authenticated','e8-recovery-target@tests.invalid'),
 ('e8b00000-0000-4000-8000-000000000004','authenticated','authenticated','e8-recovery-former@tests.invalid');
INSERT INTO public.user_roles(user_id,role) VALUES('e8b00000-0000-4000-8000-000000000001','super_admin') ON CONFLICT DO NOTHING;
INSERT INTO public.tenants(id,name,slug,account_type,owner_user_id) VALUES
 ('e8b00000-0000-4000-8000-000000000010','Recovery native probe','test-exp08-recovery-native-probe','standalone','e8b00000-0000-4000-8000-000000000004');
INSERT INTO public.tenant_members(tenant_id,user_id,status,role,is_owner) VALUES
 ('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000002','active','owner',true),
 ('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000003','active','owner',true);
INSERT INTO public.profiles(user_id,active_tenant_id)
 SELECT id,'e8b00000-0000-4000-8000-000000000010'::uuid FROM auth.users
 WHERE id IN('e8b00000-0000-4000-8000-000000000001','e8b00000-0000-4000-8000-000000000002','e8b00000-0000-4000-8000-000000000003')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
UPDATE public.profiles SET active_tenant_id=NULL WHERE user_id='e8b00000-0000-4000-8000-000000000004';
CREATE TEMP TABLE exp08_recovery_probe_ids(k text PRIMARY KEY,v uuid NOT NULL);
GRANT SELECT ON exp08_recovery_probe_ids TO authenticated,service_role;

SELECT set_config('request.jwt.claim.sub','e8b00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.platform_owner_recovery('e8b00000-0000-4000-8000-000000000010','set_account_holder',
 'e8b00000-0000-4000-8000-000000000003','Synthetic native recovery reason','e8b00000-0000-4000-8000-000000000020')->>'audit_id',
 'e8b00000-0000-4000-8000-000000000020','original authenticated recovery executes with stable native audit identity');
SELECT is(public.platform_owner_recovery('e8b00000-0000-4000-8000-000000000010','set_account_holder',
 'e8b00000-0000-4000-8000-000000000003','Synthetic native recovery reason','e8b00000-0000-4000-8000-000000000020')->>'audit_id',
 'e8b00000-0000-4000-8000-000000000020','same request reconciles original result after holder becomes working');
SELECT is(public.platform_owner_recovery_receipt('e8b00000-0000-4000-8000-000000000010',
 'e8b00000-0000-4000-8000-000000000020')->>'status','found','original operator reopens durable receipt without another effect');
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE id='e8b00000-0000-4000-8000-000000000020'),0::bigint,
 'even authenticated operator cannot read protected native audit row directly');
SELECT throws_ok($$SELECT public.platform_owner_recovery('e8b00000-0000-4000-8000-000000000010','set_account_holder',
 'e8b00000-0000-4000-8000-000000000003','Synthetic native recovery reason','e8b00000-0000-4000-8000-000000000021')$$,
 '42501','OWNER_RECOVERY_FORBIDDEN','new recovery refuses a now-working holder');
RESET ROLE;
SELECT is((SELECT owner_user_id FROM public.tenants WHERE id='e8b00000-0000-4000-8000-000000000010'),
 'e8b00000-0000-4000-8000-000000000003'::uuid,'actual original tenant pointer reflects verified recovery');
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE action='tenant:owner_recovery.set_account_holder'
 AND tenant_id='e8b00000-0000-4000-8000-000000000010'),1::bigint,'retry has one original committed recovery event');
INSERT INTO exp08_recovery_probe_ids SELECT x->>'user_id',(x->>'notification_id')::uuid
 FROM public.paige_audit_log a CROSS JOIN LATERAL jsonb_array_elements(a.payload->'notices') x
 WHERE a.id='e8b00000-0000-4000-8000-000000000020';
SELECT is((SELECT count(*) FROM exp08_recovery_probe_ids),3::bigint,'actual native audience contains both owners and the former holder without a seat');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.notifications n JOIN exp08_recovery_probe_ids p ON p.v=n.id
 WHERE n.action_url IS NOT NULL OR n.title<>'Team ownership update' OR n.message<>'A team ownership change is available to review.'
 OR n.metadata<>jsonb_build_object('kind','exp08_owner_recovery','audit_id','e8b00000-0000-4000-8000-000000000020')),
 'native notification rows contain generic presentation and opaque binding only');

SELECT set_config('request.jwt.claim.sub','e8b00000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"e8b00000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.get_my_owner_recovery_notice((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'))->>'reason',
 'Synthetic native recovery reason','former holder reopens its own bounded event without a workspace or seat');
SELECT throws_ok($$SELECT public.get_my_owner_recovery_notice((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000002'))$$,
 '42501','OWNER_RECOVERY_NOTICE_UNAVAILABLE','personal context does not disclose another original recipient notice');
SELECT throws_ok($$SELECT public.get_owner_recovery_notice('e8b00000-0000-4000-8000-000000000010',
 (SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'))$$,
 '42501','OWNER_RECOVERY_NOTICE_UNAVAILABLE','the original workspace-scoped reader still requires current workspace');
SELECT throws_ok($$SELECT public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')$$,
 '42501','permission denied for function get_owner_recovery_delivery_event','ordinary recipient cannot use the service event reader');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id='e8b00000-0000-4000-8000-000000000004')
 AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id='e8b00000-0000-4000-8000-000000000004' AND active_tenant_id IS NOT NULL),
 'personal event read does not grant membership or select a workspace');

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
DELETE FROM public.user_roles WHERE user_id='e8b00000-0000-4000-8000-000000000001' AND role='super_admin';
SET LOCAL ROLE service_role;
SELECT is(public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')->>'event',
 'owner_recovery','service reads already-committed event after operator role loss without impersonation');
SELECT is(jsonb_array_length(public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')->'recipients'),
 3,'service returns only the three original recipient-notice bindings');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_object_keys(public.get_owner_recovery_delivery_event(
 'e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')) k
 WHERE k NOT IN('event','version','audit_id','tenant_id','action','recorded_at','recipients')),
 'service event excludes private reason, addresses, target and raw audit context');
SELECT throws_ok($$SELECT public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000099','e8b00000-0000-4000-8000-000000000020')$$,
 '42501','OWNER_RECOVERY_DELIVERY_UNAVAILABLE','service cannot substitute another business');
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='e8b00000-0000-4000-8000-000000000004';
SET LOCAL ROLE service_role;
SELECT ok(EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_owner_recovery_delivery_event(
 'e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')->'recipients') x
 WHERE x->>'user_id'='e8b00000-0000-4000-8000-000000000004' AND x->>'eligible'='false'),
 'current Auth ban preserves only original identity for receipt reconciliation and denies eligibility');
RESET ROLE;
UPDATE auth.users SET banned_until=NULL WHERE id='e8b00000-0000-4000-8000-000000000004';
INSERT INTO public.tenant_members(tenant_id,user_id,status,role,is_owner) VALUES
 ('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000004','active','member',false);
SELECT set_config('request.jwt.claim.sub','e8b00000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"e8b00000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.get_my_owner_recovery_notice((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'))$$,
 '42501','OWNER_RECOVERY_NOTICE_UNAVAILABLE','changed reentry membership does not resurrect a stale former-holder grant');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.tenants SET archived_at=now() WHERE id='e8b00000-0000-4000-8000-000000000010';
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')$$,
 '42501','OWNER_RECOVERY_DELIVERY_UNAVAILABLE','archived native business refuses delivery-event access');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE action='tenant:owner_recovery.set_account_holder'
 AND tenant_id='e8b00000-0000-4000-8000-000000000010'),1::bigint,'all read/refusal/reentry checks leave one original recovery event');
SELECT is((SELECT count(*) FROM public.notifications WHERE id IN(SELECT v FROM exp08_recovery_probe_ids)),3::bigint,
 'event reads create no duplicate original in-app notices');
SELECT is((SELECT payload->>'email_status' FROM public.paige_audit_log WHERE id='e8b00000-0000-4000-8000-000000000020'),
 'not_requested','native recovery and event reads never claim an email send');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.paige_audit_log WHERE id='e8b00000-0000-4000-8000-000000000021'),
 'refused new recovery leaves no partial receipt');
SELECT * FROM finish();
ROLLBACK;
