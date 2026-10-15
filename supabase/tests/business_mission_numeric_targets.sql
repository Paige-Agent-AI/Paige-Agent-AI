\set ON_ERROR_STOP on
-- Isolated migrated database only. Real target RPCs and the canonical metric issuer/resolver.
-- Synthetic identities and records; the enclosing transaction is always rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert_target(p_ok boolean,p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TARGET_PROOF_FAILED: %',p_label; END IF; RAISE NOTICE 'PASS: %',p_label; END $$;
CREATE FUNCTION pg_temp.target_throws(p_sql text,p_message text,p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text; BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN actual:=SQLERRM; END;
  IF actual IS DISTINCT FROM p_message THEN RAISE EXCEPTION 'TARGET_PROOF_FAILED: % (expected %, got %)',p_label,p_message,actual; END IF;
  RAISE NOTICE 'PASS: %',p_label;
END $$;
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('11111111-1111-4111-8111-111111111111','authenticated','authenticated','target-owner-a@tests.invalid'),
 ('44444444-4444-4444-8444-444444444444','authenticated','authenticated','target-owner-b@tests.invalid'),
 ('55555555-5555-4555-8555-555555555555','authenticated','authenticated','target-member-a@tests.invalid');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand,owner_user_id,parent_tenant_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test-tenant-target-a','Test target tenant A','active','standalone','TTA',9383001,'{}','{}','11111111-1111-4111-8111-111111111111',NULL),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','test-tenant-target-b','Test target tenant B','active','standalone','TTB',9383002,'{}','{}','44444444-4444-4444-8444-444444444444',NULL);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner','active',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444','owner','active',true),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','55555555-5555-4555-8555-555555555555','member','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
CREATE TEMP TABLE target_mission AS SELECT (public.create_business_mission(
 '10000000-0000-4000-8000-000000000001','Grow client base','Reach a reviewed customer goal',NULL,'Current state','Approved strategy','{}',
 'An issued actual reaches target','Owner-authored private direction','{}','{}',NULL,'owner_ui',NULL)->>'mission_id')::uuid id;
CREATE TEMP TABLE target_definition AS SELECT
 '{"title":"Active client goal","metric":{"key":"business.active_clients_current","version":"1.0.0","unit":"count","value_kind":"count","currency":null,"dimensions":{},"range_key":"quarter","semantics":"current_snapshot","business_time_zone":null},"period":{"start":"2026-10-01T00:00:00Z","end":"2027-01-01T00:00:00Z","time_zone":"America/New_York"},"comparison":"at_least","desired_value":"10","upper_value":null}'::jsonb value;
CREATE TEMP TABLE target_evidence(token text,bundle jsonb);
GRANT SELECT,INSERT ON target_evidence TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO target_evidence SELECT bundle->>'evidence_ref',bundle FROM (SELECT public.issue_analytics_evidence_bundle(
 'business.active_clients_current','1.0.0','{}','quarter',now()-interval '10 days',now(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') bundle) q;
RESET ROLE;
GRANT SELECT ON target_mission,target_definition TO authenticated;
SELECT pg_temp.assert_target(NOT has_table_privilege('authenticated','public.business_mission_targets','SELECT,INSERT,UPDATE,DELETE'),'no raw target table browser grant');
SELECT pg_temp.assert_target(NOT has_table_privilege('authenticated','public.business_mission_target_versions','SELECT,INSERT,UPDATE,DELETE'),'no raw version table browser grant');
SELECT pg_temp.assert_target(NOT has_function_privilege('anon','public.save_business_mission_target(uuid,uuid,integer,uuid,integer,jsonb,text,text)','EXECUTE'),'anonymous mutation entry refused');
SELECT pg_temp.assert_target(NOT has_function_privilege('service_role','public.save_business_mission_target(uuid,uuid,integer,uuid,integer,jsonb,text,text)','EXECUTE'),'no service-role mutation fallback');
SELECT pg_temp.assert_target((SELECT relrowsecurity FROM pg_class WHERE oid='public.business_mission_targets'::regclass),'targets use RLS');
SELECT pg_temp.assert_target((SELECT relrowsecurity FROM pg_class WHERE oid='public.business_mission_target_versions'::regclass),'immutable versions use RLS');

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE target_created AS SELECT public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000001',(SELECT id FROM target_mission),1,NULL,NULL,
 (SELECT value FROM target_definition),(SELECT token FROM target_evidence),'Initial owner-defined target') result;
SELECT pg_temp.assert_target((SELECT result->>'revision'='1' AND result->>'replayed'='false' FROM target_created),'authorized target created once');
SELECT pg_temp.assert_target(public.get_business_mission_target((SELECT (result->>'target_id')::uuid FROM target_created))->>'desired_value'='10','readback is the canonical target definition');
SELECT pg_temp.assert_target(public.get_business_mission_target_receipt('20000000-0000-4000-8000-000000000001')->>'id'=
 (SELECT result->>'receipt_id' FROM target_created),'persisted receipt id readback matches the mutation result');
SELECT pg_temp.assert_target(public.get_business_mission_target_receipt('20000000-0000-4000-8000-000000000001')->>'operation'='target_create',
 'receipt projection preserves the canonical domain operation');
SELECT pg_temp.assert_target(public.list_business_mission_targets((SELECT id FROM target_mission),1,0)->>'total_count'='1','exact total independent of bounded list');
SELECT pg_temp.assert_target(public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000001',(SELECT id FROM target_mission),1,NULL,NULL,
 (SELECT value FROM target_definition),(SELECT token FROM target_evidence),'Initial owner-defined target')->>'replayed'='true','same request replays its domain receipt');
SELECT pg_temp.target_throws(format($q$SELECT public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000001','%s',1,NULL,NULL,%L::jsonb,%L,'Initial owner-defined target')$q$,
 (SELECT id FROM target_mission),(SELECT jsonb_set(value,'{desired_value}','"11"')::text FROM target_definition),(SELECT token FROM target_evidence)),
 'MISSION_IDEMPOTENCY_CONFLICT','same key different definition is refused');
RESET ROLE;
UPDATE public.analytics_evidence_reference SET expires_at=clock_timestamp()-interval '1 second',issued_at=clock_timestamp()-interval '1 hour'
 WHERE token_digest=encode(extensions.digest(convert_to((SELECT token FROM target_evidence),'UTF8'),'sha256'),'hex');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_target(public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000001',(SELECT id FROM target_mission),1,NULL,NULL,
 (SELECT value FROM target_definition),(SELECT token FROM target_evidence),'Initial owner-defined target')->>'replayed'='true','committed replay works after temporary evidence expiry');
SELECT pg_temp.target_throws(format($q$SELECT public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000002','%s',1,NULL,NULL,%L::jsonb,%L,'New request')$q$,
 (SELECT id FROM target_mission),(SELECT value::text FROM target_definition),(SELECT token FROM target_evidence)),
 'ANALYTICS_EVIDENCE_UNAVAILABLE','new mutation cannot reuse expired evidence');
RESET ROLE;
UPDATE public.analytics_evidence_reference SET expires_at=clock_timestamp()+interval '15 minutes',
 issued_at=(SELECT (bundle->>'as_of')::timestamptz FROM target_evidence)
 WHERE token_digest=encode(extensions.digest(convert_to((SELECT token FROM target_evidence),'UTF8'),'sha256'),'hex');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_target(public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000003',(SELECT id FROM target_mission),1,
 (SELECT (result->>'target_id')::uuid FROM target_created),1,
 (SELECT jsonb_set(value,'{desired_value}','"12"') FROM target_definition),(SELECT token FROM target_evidence),'Reviewed target revision')->>'revision'='2','revision uses expected target revision');
SELECT pg_temp.assert_target(public.get_business_mission_target((SELECT (result->>'target_id')::uuid FROM target_created))->>'desired_value'='12','later read returns same target latest revision');
SELECT pg_temp.target_throws(format($q$SELECT public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000004','%s',1,'%s',1,%L::jsonb,%L,'Stale target')$q$,
 (SELECT id FROM target_mission),(SELECT result->>'target_id' FROM target_created),(SELECT value::text FROM target_definition),(SELECT token FROM target_evidence)),
 'MISSION_TARGET_REVISION_CONFLICT','stale revision cannot overwrite newer target');
RESET ROLE;
GRANT SELECT ON target_created TO authenticated;
SELECT pg_temp.assert_target((SELECT count(*)=1 FROM public.business_mission_targets),'replay/stale paths create no duplicate target');
SELECT pg_temp.assert_target((SELECT count(*)=2 FROM public.business_mission_target_versions),'both definitions remain immutable versions');
SELECT pg_temp.assert_target((SELECT count(*)=2 FROM public.business_mission_mutation_receipts WHERE operation LIKE 'target_%'),'only successful target mutations have receipts');
SELECT pg_temp.target_throws($q$UPDATE public.business_mission_target_versions SET definition='{}'$q$,'MISSION_BRIEF_IMMUTABLE','direct history mutation refused');
SELECT pg_temp.assert_target(NOT public._business_mission_target_definition_valid(
 (SELECT jsonb_set(value,'{metric,key}','null') FROM target_definition)),'null metric key fails closed');
SELECT pg_temp.assert_target(NOT public._business_mission_target_definition_valid(
 (SELECT jsonb_set(value,'{metric,unit}','null') FROM target_definition)),'null unit fails closed');
SELECT pg_temp.assert_target(NOT public._business_mission_target_definition_valid(
 (SELECT value||'{"tenant_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}'::jsonb FROM target_definition)),'client-supplied tenant field refused');
SET LOCAL ROLE authenticated;
SELECT pg_temp.target_throws(format($q$SELECT public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000005','%s',1,NULL,NULL,%L::jsonb,%L,'Missing issuer identity')$q$,
 (SELECT id FROM target_mission),(SELECT jsonb_set(value,'{metric,unit}','"percent"')::text FROM target_definition),(SELECT token FROM target_evidence)),
 'MISSION_TARGET_METRIC_MISMATCH','target unit cannot bypass the canonical issued binding');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_target(public.get_business_mission_target_revision((SELECT (result->>'target_id')::uuid FROM target_created),1)->>'desired_value'='10',
 'immutable original definition remains readable after revision');
SELECT pg_temp.assert_target(public.transition_business_mission_target(
 '30000000-0000-4000-8000-000000000001',(SELECT id FROM target_mission),1,(SELECT (result->>'target_id')::uuid FROM target_created),2,'paused','Review strategy')->>'revision'='3',
 'pause creates a new state version');
SELECT pg_temp.assert_target(public.transition_business_mission_target(
 '30000000-0000-4000-8000-000000000001',(SELECT id FROM target_mission),1,(SELECT (result->>'target_id')::uuid FROM target_created),2,'paused','Review strategy')->>'replayed'='true',
 'same pause request replays exactly');
SELECT pg_temp.assert_target(public.get_business_mission_target((SELECT (result->>'target_id')::uuid FROM target_created))->>'state'='paused',
 'pause state survives independent canonical read');
SELECT pg_temp.assert_target(public.transition_business_mission_target(
 '30000000-0000-4000-8000-000000000002',(SELECT id FROM target_mission),1,(SELECT (result->>'target_id')::uuid FROM target_created),3,'active','Resume reviewed goal')->>'revision'='4',
 'resume preserves identity and definition');
SELECT pg_temp.assert_target(public.transition_business_mission_target(
 '30000000-0000-4000-8000-000000000003',(SELECT id FROM target_mission),1,(SELECT (result->>'target_id')::uuid FROM target_created),4,'retired','Superseded goal')->>'revision'='5',
 'retire preserves historical record');
SELECT pg_temp.assert_target(public.list_business_mission_target_versions((SELECT (result->>'target_id')::uuid FROM target_created),2,0)->>'total_count'='5'
 AND public.list_business_mission_target_versions((SELECT (result->>'target_id')::uuid FROM target_created),2,0)->>'has_more'='true',
 'history pagination preserves exact total and more state');
SELECT pg_temp.target_throws(format($q$SELECT public.transition_business_mission_target(
 '30000000-0000-4000-8000-000000000004','%s',1,'%s',5,'active','Attempt revival')$q$,
 (SELECT id FROM target_mission),(SELECT result->>'target_id' FROM target_created)),
 'MISSION_TARGET_INVALID_TRANSITION','retired target cannot be silently revived');
SELECT pg_temp.target_throws(format($q$SELECT public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000006','%s',1,'%s',5,%L::jsonb,%L,'Attempt rewrite')$q$,
 (SELECT id FROM target_mission),(SELECT result->>'target_id' FROM target_created),(SELECT value::text FROM target_definition),(SELECT token FROM target_evidence)),
 'MISSION_TARGET_RETIRED','retired definition cannot be overwritten');
-- Native consumer continuation: history and receipts use independent canonical
-- reads after all five revisions. No browser recovery state supplies this proof.
SELECT pg_temp.assert_target(public.list_business_mission_target_versions((SELECT (result->>'target_id')::uuid FROM target_created),20,0)#>>'{versions,0,receipt,revision}'='5',
 'latest history receipt binds the exact immutable revision');
SELECT pg_temp.assert_target(public.list_business_mission_target_versions((SELECT (result->>'target_id')::uuid FROM target_created),20,0)#>>'{versions,0,receipt,operation}'='target_transition',
 'historical receipt preserves the operation');
SELECT pg_temp.assert_target(public.list_business_mission_target_versions((SELECT (result->>'target_id')::uuid FROM target_created),20,0)#>>'{versions,4,receipt,id}'=(SELECT result->>'receipt_id' FROM target_created),
 'original creation receipt remains retrievable after later revisions');
SELECT pg_temp.assert_target((SELECT count(*)=5 FROM jsonb_array_elements(public.list_business_mission_target_versions((SELECT (result->>'target_id')::uuid FROM target_created),20,0)->'versions') v
 WHERE v->'receipt' IS DISTINCT FROM 'null'::jsonb),'every saved revision resolves its matching canonical receipt');
SELECT pg_temp.assert_target((SELECT bool_and(NOT (v->'receipt' ? 'payload_hash') AND NOT (v->'receipt' ? 'metric_evidence_ref') AND NOT (v->'receipt' ? 'result'))
 FROM jsonb_array_elements(public.list_business_mission_target_versions((SELECT (result->>'target_id')::uuid FROM target_created),20,0)->'versions') v),
 'history receipt projection excludes private hashes bearer references and raw result');
SELECT pg_temp.assert_target(public.list_business_mission_target_versions((SELECT (result->>'target_id')::uuid FROM target_created),20,0)
 = public.list_business_mission_target_versions((SELECT (result->>'target_id')::uuid FROM target_created),20,0),'independent reread returns the same immutable history and receipts');
RESET ROLE;
SELECT pg_temp.assert_target(NOT has_function_privilege('anon','public.list_business_mission_target_versions(uuid,integer,integer)','EXECUTE'),'history remains denied to anonymous callers');
SELECT pg_temp.assert_target(NOT has_function_privilege('service_role','public.list_business_mission_target_versions(uuid,integer,integer)','EXECUTE'),'history has no privileged service fallback');
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
SELECT set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.target_throws(format('SELECT public.get_business_mission_target(%L::uuid)',(SELECT result->>'target_id' FROM target_created)),
 'MISSION_TARGET_NOT_FOUND','foreign owner cannot read target');
SELECT pg_temp.target_throws(format('SELECT public.list_business_mission_target_versions(%L::uuid)',(SELECT result->>'target_id' FROM target_created)),
 'MISSION_TARGET_NOT_FOUND','foreign owner cannot read target history or receipts');
SELECT pg_temp.target_throws($q$SELECT public.get_business_mission_target_receipt('20000000-0000-4000-8000-000000000001')$q$,
 'MISSION_TARGET_RECEIPT_NOT_FOUND','foreign owner cannot read another actor receipt');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
SELECT set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.target_throws(format('SELECT public.get_business_mission_target(%L::uuid)',(SELECT result->>'target_id' FROM target_created)),
 'MISSION_OWNER_REQUIRED','same-tenant member cannot use owner-only target port');
SELECT pg_temp.target_throws(format('SELECT public.list_business_mission_target_versions(%L::uuid)',(SELECT result->>'target_id' FROM target_created)),
 'MISSION_OWNER_REQUIRED','same-tenant member cannot read owner history receipts');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
UPDATE public.tenant_members SET status='inactive' WHERE user_id='11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT pg_temp.target_throws(format('SELECT public.list_business_mission_target_versions(%L::uuid)',(SELECT result->>'target_id' FROM target_created)),
 'MISSION_OWNER_REQUIRED','revoked owner cannot read formerly authorized history receipts');
SELECT pg_temp.target_throws(format($q$SELECT public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000001','%s',1,NULL,NULL,%L::jsonb,%L,'Initial owner-defined target')$q$,
 (SELECT id FROM target_mission),(SELECT value::text FROM target_definition),(SELECT token FROM target_evidence)),
 'MISSION_OWNER_REQUIRED','revoked membership cannot replay a previously committed result');
RESET ROLE;
ROLLBACK;
