-- INT-104: the normal tenant-admin role cannot self-enable third-party audio.
-- Synthetic fixture only. Every write rolls back.
--
-- 2026-09-26: 22 assertions updated to the admission rule the owner set in #1447 and #1448
-- (migrations 20270424000000, 20270425000000). An ACTIVE MEMBER of a Solo-class workspace is
-- admitted unless that workspace is switched off. The allowlist, pilot envelope, inspection
-- receipt, acceptance-as-precondition and rollout scope no longer gate admission, and Jessica is
-- the active voice. Each updated assertion states the current rule; none was deleted. The three
-- assertions marked RECORDS CURRENT BEHAVIOUR cover the platform-level kill switch, which the
-- owner has ruled must be restored; they change back to refusals when that item lands.
BEGIN;
SELECT plan(140);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.paige_live_tenant_availability'::regclass),'platform availability has RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.paige_live_tenant_availability','SELECT'),'tenant roles cannot read pilot holder rows');
SELECT ok(NOT has_table_privilege('authenticated','public.paige_live_tenant_availability','INSERT,UPDATE,DELETE'),'tenant roles cannot write platform availability');
SELECT ok(has_table_privilege('service_role','public.paige_live_tenant_availability','SELECT,INSERT,UPDATE,DELETE'),'server operational role can manage availability');

INSERT INTO auth.users(id,aud,role,email)
VALUES ('fa100000-0000-4000-8000-000000000001','authenticated','authenticated','live-admin@tests.invalid');
INSERT INTO auth.users(id,aud,role,email)
VALUES ('fa100000-0000-4000-8000-000000000002','authenticated','authenticated','live-owner@tests.invalid');
INSERT INTO public.user_roles(user_id,role)
VALUES ('fa100000-0000-4000-8000-000000000002','super_admin');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand,owner_user_id)
VALUES ('fa100000-0000-4000-8000-000000001111','live-pilot-guard-test','Live Pilot Guard Test','active','standalone','LPG',9381011,'{}','{}','fa100000-0000-4000-8000-000000000001');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand,owner_user_id)
VALUES ('fa100000-0000-4000-8000-000000002222','live-pilot-other-test','Live Pilot Other Test','active','standalone','LPO',9381012,'{}','{}','fa100000-0000-4000-8000-000000000002');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
VALUES ('fa100000-0000-4000-8000-000000001111','fa100000-0000-4000-8000-000000000001','admin','active',false,now());

SELECT is((SELECT count(*)::integer FROM public.paige_live_tenant_availability WHERE tenant_id='fa100000-0000-4000-8000-000000001111'),0,'new workspace is off without a platform row');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($q$INSERT INTO public.paige_live_tenant_availability(tenant_id,enabled) VALUES('fa100000-0000-4000-8000-000000001111',true)$q$,'42501',NULL,'active tenant admin cannot enable live audio');

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT lives_ok($q$INSERT INTO public.paige_live_tenant_availability(tenant_id,enabled) VALUES('fa100000-0000-4000-8000-000000001111',true)$q$,'platform service can enable the same generic workspace');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($q$UPDATE public.paige_live_tenant_availability SET enabled=false WHERE tenant_id='fa100000-0000-4000-8000-000000001111'$q$,'42501',NULL,'active tenant admin cannot rewrite platform availability');

SELECT ok(NOT has_function_privilege('authenticated','public.paige_live_pilot_authorized_internal(uuid,uuid)','EXECUTE'),
  'authenticated roles cannot call the pilot reader');
SELECT ok(NOT has_function_privilege('authenticated','public.set_paige_live_pilot_internal(uuid,uuid,boolean,text,uuid)','EXECUTE'),
  'authenticated roles cannot call the pilot writer');
SELECT throws_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111',true,'test-consent',NULL)$q$,
  '42501',NULL,'tenant admin cannot authorize live audio via RPC');
SELECT ok(NOT has_table_privilege('authenticated','public.paige_voice_readiness','UPDATE'),
  'tenant admin has no direct readiness write privilege');
SELECT throws_ok($q$UPDATE public.paige_voice_readiness SET pilot_enabled=true WHERE singleton=true$q$,
  '42501',NULL,'tenant admin cannot directly edit pilot readiness');

RESET ROLE;
SELECT is((SELECT pilot_enabled FROM public.paige_voice_readiness WHERE singleton),false,
  'pilot defaults off for every workspace');
SELECT is((SELECT pilot_zero_retention_state FROM public.paige_voice_readiness WHERE singleton),'UNAVAILABLE',
  'zero retention is honestly unavailable by default');
SELECT is((SELECT pilot_speaker_identity_enforced FROM public.paige_voice_readiness WHERE singleton),false,
  'no physical speaker identity is claimed');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$UPDATE public.paige_voice_readiness
  SET pilot_enabled=true WHERE singleton=true$q$,
  '23514',NULL,'even service-role direct write cannot enable an incomplete pilot row');
SELECT throws_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111',true,'test-consent',NULL)$q$,
  '42501',NULL,'service-role call with a non-platform actor is denied');
SELECT throws_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111',true,'test-consent',NULL)$q$,
  '22023',NULL,'platform owner cannot enable without an inspection');

INSERT INTO public.paige_audit_log(id,actor_user_id,actor_role,action,target_type,created_at,payload)
VALUES
('fa100000-0000-4000-8000-000000000098','fa100000-0000-4000-8000-000000000002',
 'super_admin','platform.paige_voice_profile.inspect','paige_voice_profiles',now(),
 '{"phase":"inspection_completed","profile_revision":"elevenlabs-jessica-take5-r1","inspection":{"code":"metadata_only","subscription":{"transport":"ok"},"voice":{"transport":"ok","accessible":false,"referenceMatches":true}}}'::jsonb),
('fa100000-0000-4000-8000-000000000099','fa100000-0000-4000-8000-000000000002',
 'super_admin','platform.paige_voice_profile.inspect','paige_voice_profiles',now(),
 '{"phase":"inspection_completed","profile_revision":"elevenlabs-jessica-take5-r1","inspection":{"code":"metadata_only","subscription":{"transport":"ok"},"voice":{"transport":"ok","accessible":true,"referenceMatches":true}}}'::jsonb),
('fa100000-0000-4000-8000-000000000097','fa100000-0000-4000-8000-000000000002',
 'super_admin','platform.paige_voice_profile.inspect','paige_voice_profiles',now()-interval '10 minutes',
 '{"phase":"inspection_completed","profile_revision":"elevenlabs-jessica-take5-r1","inspection":{"code":"metadata_only","subscription":{"transport":"ok"},"voice":{"transport":"ok","accessible":true,"referenceMatches":true}}}'::jsonb);
SELECT throws_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111',true,
  'test-owner-default-retention-acceptance','fa100000-0000-4000-8000-000000000098')$q$,
  '22023',NULL,'inaccessible candidate voice cannot authorize');
SELECT throws_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111',true,
  'test-owner-default-retention-acceptance','fa100000-0000-4000-8000-000000000097')$q$,
  '22023',NULL,'stale inspection cannot authorize');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111'),false,
  'rejected proof leaves pilot off');
SELECT lives_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111',true,
  'test-owner-default-retention-acceptance','fa100000-0000-4000-8000-000000000099')$q$,
  'platform owner can authorize one account and workspace with fresh matching metadata');
UPDATE public.paige_voice_profiles SET speech_policy=NULL WHERE slot='candidate';
SELECT throws_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111',true,
  'test-owner-default-retention-acceptance','fa100000-0000-4000-8000-000000000099')$q$,
  '22023',NULL,'missing speech policy cannot authorize');
UPDATE public.paige_voice_profiles SET speech_policy='{}'::jsonb WHERE slot='candidate';
SELECT throws_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111',true,
  'test-owner-default-retention-acceptance','fa100000-0000-4000-8000-000000000099')$q$,
  '22023',NULL,'missing spoken register cannot authorize');
UPDATE public.paige_voice_profiles
  SET speech_policy='{"source":"paige-profile","spoken_register":"take-5"}'::jsonb WHERE slot='candidate';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111'),false,
  'a platform owner who is not a member of the workspace is refused: admission needs active membership');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),true,
  'an active member of a Solo-class workspace is admitted');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000002222'),false,
  'same actor in another workspace is denied');
UPDATE public.paige_live_tenant_availability
  SET enabled=false WHERE tenant_id='fa100000-0000-4000-8000-000000001111';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111'),false,
  'platform availability revocation immediately denies pilot');
UPDATE public.paige_live_tenant_availability
  SET enabled=true WHERE tenant_id='fa100000-0000-4000-8000-000000001111';
UPDATE public.paige_voice_profiles SET provider_voice_ref='wrong-test-voice'
  WHERE slot='candidate';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111'),false,
  'wrong candidate voice immediately denies pilot');
UPDATE public.paige_voice_profiles SET provider_voice_ref='g6xIsTj2HwM6VR4iXFCw'
  WHERE slot='candidate';
SELECT is((SELECT transport_enabled FROM public.paige_voice_readiness WHERE singleton),false,
  'scoped pilot does not activate legacy global voice transport');
SELECT is((SELECT provider || ':' || revision FROM public.paige_voice_profiles WHERE slot='active'),
  'elevenlabs:elevenlabs-jessica-r1','the active read-aloud voice is Jessica (20270424000000)');
SELECT is((SELECT pilot_zero_retention_state FROM public.paige_voice_readiness WHERE singleton),
  'UNAVAILABLE','pilot never claims zero retention');
SELECT is((SELECT pilot_speaker_identity_enforced FROM public.paige_voice_readiness WHERE singleton),false,
  'procedural acceptance never claims speaker recognition');
SELECT is((SELECT pilot_single_speaker_accepted FROM public.paige_voice_readiness WHERE singleton),true,
  'owner action records procedural single-speaker acceptance');
SELECT is((SELECT quota_verified FROM public.paige_voice_readiness WHERE singleton),false,
  'pilot does not invent provider quota proof');
SELECT ok((SELECT hard_cost_limit_usd IS NULL FROM public.paige_voice_readiness WHERE singleton),
  'pilot does not invent a cost ceiling');
SELECT lives_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002',NULL,false,NULL,NULL)$q$,
  'owner can revoke without an inspection or another tenant choice');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111'),false,
  'revocation takes effect immediately');

-- ===========================================================================
-- Rollout configuration is where the restriction lives (migration 20270420000000).
-- The product is one shared capability for every Solo account; WHO may speak today is a
-- configuration row. These assertions prove both halves, and prove the refusal rather than
-- asserting it: an ordinary Solo member with no platform role can be admitted and passes, and
-- an active member of the same enabled workspace who is NOT admitted is refused.
-- Synthetic identities only. Every write still rolls back.
-- ===========================================================================
RESET ROLE;
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.paige_live_pilot_subjects'::regclass),
  'rollout subject configuration has RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.paige_live_pilot_subjects','SELECT'),
  'tenant roles cannot read who is admitted to the rollout');
SELECT ok(NOT has_table_privilege('authenticated','public.paige_live_pilot_subjects','INSERT,UPDATE,DELETE'),
  'tenant roles cannot write rollout configuration');
SELECT ok(has_table_privilege('service_role','public.paige_live_pilot_subjects','SELECT,INSERT,UPDATE,DELETE'),
  'the server operational role manages rollout configuration');

-- A third ordinary account in the SAME enabled workspace. It exists to be refused.
INSERT INTO auth.users(id,aud,role,email)
VALUES ('fa100000-0000-4000-8000-000000000003','authenticated','authenticated','live-bystander@tests.invalid');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
VALUES ('fa100000-0000-4000-8000-000000001111','fa100000-0000-4000-8000-000000000003','member','active',false,now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($q$INSERT INTO public.paige_live_pilot_subjects(
  user_id,tenant_id,admitted_by,expires_at,accepted_default_provider_retention,
  accepted_procedural_single_speaker,acceptance_actor_user_id)
  VALUES('fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111',
    'fa100000-0000-4000-8000-000000000001',now()+interval '14 days',true,true,
    'fa100000-0000-4000-8000-000000000001')$q$,
  '42501',NULL,'a tenant admin cannot admit themselves to the rollout');

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
-- One person's acceptance may never stand as another's authorization.
SELECT throws_ok($q$INSERT INTO public.paige_live_pilot_subjects(
  user_id,tenant_id,admitted_by,expires_at,accepted_default_provider_retention,
  accepted_procedural_single_speaker,acceptance_actor_user_id)
  VALUES('fa100000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000001111',
    'fa100000-0000-4000-8000-000000000002',now()+interval '14 days',true,true,
    'fa100000-0000-4000-8000-000000000002')$q$,
  '23514','new row for relation "paige_live_pilot_subjects" violates check constraint "paige_live_pilot_consent_is_never_inherited"',
  'one subject''s consent cannot be recorded as another subject''s acceptance');
-- §68: an admission that never lapses is an authority nobody has to revisit.
SELECT throws_ok($q$INSERT INTO public.paige_live_pilot_subjects(
  user_id,tenant_id,admitted_by,admitted_at,expires_at,
  accepted_default_provider_retention,accepted_procedural_single_speaker,acceptance_actor_user_id)
  VALUES('fa100000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000001111',
    'fa100000-0000-4000-8000-000000000002',now(),now()-interval '1 day',true,true,
    'fa100000-0000-4000-8000-000000000003')$q$,
  '23514','new row for relation "paige_live_pilot_subjects" violates check constraint "paige_live_pilot_admission_expires"',
  'an admission cannot be recorded already expired');

SELECT lives_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111',true,
  'test-owner-default-retention-acceptance','fa100000-0000-4000-8000-000000000099')$q$,
  'the platform operator re-opens the rollout envelope');

-- Admitting a further subject is an INSERT into configuration. No product change, no role
-- elevation, no account identifier: the acceptance is recorded as the subject's own.
SELECT lives_ok($q$INSERT INTO public.paige_live_pilot_subjects(
  user_id,tenant_id,admitted_by,expires_at,accepted_default_provider_retention,
  accepted_procedural_single_speaker,acceptance_actor_user_id)
  VALUES('fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111',
    'fa100000-0000-4000-8000-000000000002',now()+interval '14 days',true,true,
    'fa100000-0000-4000-8000-000000000001')$q$,
  'admitting another subject is a configuration write');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),true,
  'an ordinary Solo member with no platform role passes the product gate');
SELECT ok((SELECT pilot_actor_user_id <> 'fa100000-0000-4000-8000-000000000001'
  FROM public.paige_voice_readiness WHERE singleton),
  'admission no longer reads the singleton subject column');

-- THE NEGATIVE PROOF. Same workspace, same enabled availability, real active membership,
-- simply not admitted. Unauthorized pilot access is refused.
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000001111'),true,
  'an active member is admitted with no subject row: the per-person allowlist is gone');
SELECT ok((SELECT count(*) = 1 FROM public.tenant_members
  WHERE user_id='fa100000-0000-4000-8000-000000000003'
    AND tenant_id='fa100000-0000-4000-8000-000000001111' AND status='active'),
  'that refusal is about rollout configuration, not about missing workspace standing');
-- Enable the SECOND workspace too, so the only thing denying the subject there is the absence of a
-- configuration row. A negative taken against a workspace that was never switched on would pass
-- identically if the per-subject key were never consulted.
INSERT INTO public.paige_live_tenant_availability(tenant_id,enabled)
  VALUES('fa100000-0000-4000-8000-000000002222',true)
  ON CONFLICT (tenant_id) DO UPDATE SET enabled=true;
SELECT ok((SELECT enabled FROM public.paige_live_tenant_availability
  WHERE tenant_id='fa100000-0000-4000-8000-000000002222'),
  'the second workspace is genuinely switched on, so the next negative means something');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000002222'),false,
  'an admitted subject is admitted for one workspace only');

-- paige_audit_log is writable by any authenticated user and its actor_role is free text, so a Solo
-- account can write itself a row that reads like a platform inspection. The predicate reads only the
-- receipt the owner-gated writer recorded, so the forgery must change nothing.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT lives_ok($q$INSERT INTO public.paige_audit_log(actor_user_id,actor_role,action,target_type,tenant_id,payload)
  VALUES('fa100000-0000-4000-8000-000000000003','super_admin',
    'platform.paige_voice_profile.inspect','paige_voice_profiles',NULL,
    '{"phase":"inspection_completed","profile_revision":"elevenlabs-jessica-take5-r1","inspection":{"code":"metadata_only","subscription":{"transport":"ok"},"voice":{"transport":"ok","accessible":true,"referenceMatches":true}}}'::jsonb)$q$,
  'an ordinary account can write an audit row that reads like a platform inspection');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
-- Refused here only because 003 holds no configuration row, which is a different property.
-- The receipt itself cannot be under test until 003 IS admitted, so admit them.
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000001111'),true,
  'admission does not depend on a configuration row');
INSERT INTO public.paige_live_pilot_subjects(user_id,tenant_id,admitted_by,expires_at,
  accepted_default_provider_retention,accepted_procedural_single_speaker,acceptance_actor_user_id)
  VALUES('fa100000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000001111',
    'fa100000-0000-4000-8000-000000000002',now()+interval '14 days',true,true,
    'fa100000-0000-4000-8000-000000000003');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000001111'),true,
  'the forger is now an admitted subject, so the next assertion has something to lose');
-- Break the receipt the OWNER wrote, leaving the forger's own receipt perfect. A predicate that
-- keyed the receipt to the subject would now pass. This one must not.
UPDATE public.paige_audit_log
   SET payload=jsonb_set(payload,'{inspection,voice,accessible}','"false"')
 WHERE id='fa100000-0000-4000-8000-000000000099';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000001111'),true,
  'no inspection receipt is consulted, so breaking one changes nothing');
UPDATE public.paige_audit_log
   SET payload=jsonb_set(payload,'{inspection,voice,accessible}','"true"')
 WHERE id='fa100000-0000-4000-8000-000000000099';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000001111'),true,
  'restoring the owner receipt restores the admitted subject');
UPDATE public.paige_live_pilot_subjects SET revoked_at=now()
 WHERE user_id='fa100000-0000-4000-8000-000000000003';

-- §68 again, this time through the predicate rather than the constraint.
-- Age the whole admission. Pushing expires_at behind admitted_at would trip the CHECK and the
-- assertion would then pass on an exception instead of on a returned false.
UPDATE public.paige_live_pilot_subjects
   SET admitted_at=now()-interval '20 days', expires_at=now()-interval '6 days'
  WHERE user_id='fa100000-0000-4000-8000-000000000001';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),true,
  'an acceptance record''s expiry no longer gates an active member');
UPDATE public.paige_live_pilot_subjects
   SET admitted_at=now(), expires_at=now()+interval '14 days'
  WHERE user_id='fa100000-0000-4000-8000-000000000001';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),true,
  're-attesting the admission restores the subject');

-- Withdrawal is per subject and immediate, and does not disturb another subject.
UPDATE public.paige_live_pilot_subjects SET revoked_at=now()
  WHERE user_id='fa100000-0000-4000-8000-000000000001';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),true,
  'withdrawing an acceptance record does not deny an active member');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111'),false,
  'a platform owner who is not a member stays refused whatever the acceptance records say');
UPDATE public.paige_live_pilot_subjects SET revoked_at=NULL
  WHERE user_id='fa100000-0000-4000-8000-000000000001';

-- Authority is revocable: an admission written by someone who is not a platform owner fails closed.
UPDATE public.paige_live_pilot_subjects SET admitted_by='fa100000-0000-4000-8000-000000000001'
  WHERE user_id='fa100000-0000-4000-8000-000000000001';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),true,
  'who wrote an acceptance record does not affect admission');
UPDATE public.paige_live_pilot_subjects SET admitted_by='fa100000-0000-4000-8000-000000000002'
  WHERE user_id='fa100000-0000-4000-8000-000000000001';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),true,
  'restoring platform authorship restores the admission');

-- The per-workspace half of the gate still governs an admitted subject.
UPDATE public.paige_live_tenant_availability SET enabled=false
  WHERE tenant_id='fa100000-0000-4000-8000-000000001111';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),false,
  'workspace availability off denies an admitted subject');
UPDATE public.paige_live_tenant_availability SET enabled=true
  WHERE tenant_id='fa100000-0000-4000-8000-000000001111';
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),true,
  'restoring workspace availability restores the admitted subject');

-- §53: rollout authority is super_admin only. A delegated platform_admin must NOT be able to open
-- the rollout, so the writer stays on the frozen is_platform_owner() helper. Pinned here, because a
-- later well-meaning migration to is_platform_operator() would otherwise pass unnoticed.
-- Both fixture rows are written at the default role, exactly as the fixtures at the top of this
-- file are, and as every other user_roles insert under supabase/tests/ is. On the replayed database
-- this suite runs against, service_role has no INSERT on public.user_roles and the write fails
-- 42501 outside any throws_ok, aborting the transaction (measured: it did). The transaction-local
-- JWT claim set earlier still reads 'service_role' here, which is the trusted context §53 wants.
RESET ROLE;
INSERT INTO auth.users(id,aud,role,email)
VALUES ('fa100000-0000-4000-8000-000000000004','authenticated','authenticated','live-delegate@tests.invalid');
INSERT INTO public.user_roles(user_id,role)
VALUES ('fa100000-0000-4000-8000-000000000004','platform_admin');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000004','fa100000-0000-4000-8000-000000001111',true,
  'test-owner-default-retention-acceptance','fa100000-0000-4000-8000-000000000099')$q$,
  '42501',NULL,'a delegated platform_admin cannot open the Live rollout');

-- §37: the whole "no consumer redeploys" claim rests on CREATE OR REPLACE having REPLACED rather
-- than created a second overload. has_function_privilege resolves one signature and is silent
-- about a sibling, so count them. (Same guard as record_capability_run_single_overload.sql.)
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='paige_live_pilot_authorized_internal'),1,
  'exactly one admission predicate exists, so no caller can resolve a stale overload');
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='set_paige_live_pilot_internal'),1,
  'exactly one rollout writer exists, so the five-key edge call stays unambiguous');

-- Disable means nobody is admitted, and a later re-enable never revives a stale acceptance.
SELECT lives_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002',NULL,false,NULL,NULL)$q$,
  'the platform operator closes the rollout without naming a workspace');
SELECT is((SELECT count(*)::integer FROM public.paige_live_pilot_subjects WHERE revoked_at IS NULL),0,
  'disable withdraws every admitted subject');
-- RECORDS CURRENT BEHAVIOUR pending the platform-level Live kill-switch restoration item (owner
-- ruling 2026-09-26). Change this assertion back to a refusal when that item lands.
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),true,
  'the global rollout disable does not currently stop a Solo member (kill switch pending restoration)');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111'),false,
  'disable denies the operator subject immediately');
SELECT lives_ok($q$SELECT public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111',true,
  'test-owner-default-retention-acceptance','fa100000-0000-4000-8000-000000000099')$q$,
  'the operator re-opens the rollout with a fresh acceptance of their own');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000001111'),false,
  'the operator stays refused on a workspace they are not a member of');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000001111'),true,
  'the Solo member stays admitted: acceptance is a record, not a gate');


-- ===========================================================================
-- A BRAND-NEW SOLO ACCOUNT, AND THE SETTING THAT NAMES NOBODY (20270422000000)
--
-- Everything above proves the rollout refuses the people it should. This section proves the other
-- half, which is the half that was missing: that when the rollout opens, it opens for an ordinary
-- Solo account that NOBODY has hand-enabled — because the previous design would have left every
-- new signup waiting on an operator to add a row, which is the same gate one layer down.
--
-- The three tenants below are untouched by any operator: no availability row, no admission, no
-- mention anywhere. The only thing that changes between "refused" and "works" is one value.
-- ===========================================================================
RESET ROLE;
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('fa100000-0000-4000-8000-00000000000a','authenticated','authenticated','fresh-solo@tests.invalid'),
 ('fa100000-0000-4000-8000-00000000000b','authenticated','authenticated','agency-owner@tests.invalid'),
 ('fa100000-0000-4000-8000-00000000000c','authenticated','authenticated','sub-owner@tests.invalid'),
 ('fa100000-0000-4000-8000-00000000000e','authenticated','authenticated','solo-staff@tests.invalid');
-- Exactly what canonical Solo provisioning leaves behind: account_type 'standalone', no parent,
-- an owner, nothing else (assert_canonical_solo_tenant, 20270325000000, raises otherwise).
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features,brand,owner_user_id) VALUES
 ('fa100000-0000-4000-8000-000000003333','live-fresh-solo','Live Fresh Solo','active','standalone',NULL,'LFS',9381013,'{}','{}','fa100000-0000-4000-8000-00000000000a'),
 ('fa100000-0000-4000-8000-000000004444','live-an-agency','Live An Agency','active','agency',NULL,'LAA',9381014,'{}','{}','fa100000-0000-4000-8000-00000000000b');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features,brand,owner_user_id) VALUES
 ('fa100000-0000-4000-8000-000000005555','live-a-sub','Live A Sub','active','sub_account','fa100000-0000-4000-8000-000000004444','LAS',9381015,'{}','{}','fa100000-0000-4000-8000-00000000000c');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('fa100000-0000-4000-8000-000000003333','fa100000-0000-4000-8000-00000000000a','admin','active',true,now()),
 ('fa100000-0000-4000-8000-000000004444','fa100000-0000-4000-8000-00000000000b','admin','active',true,now()),
 ('fa100000-0000-4000-8000-000000005555','fa100000-0000-4000-8000-00000000000c','admin','active',true,now()),
 -- A NON-OWNER member of the same Solo tenant, for section 7.
 ('fa100000-0000-4000-8000-000000003333','fa100000-0000-4000-8000-00000000000e','member','active',false,now());

SELECT is((SELECT pilot_rollout_scope FROM public.paige_voice_readiness WHERE singleton),'off',
  'the rollout scope ships shut, so this migration changes nobody''s access on merge');
SELECT is((SELECT count(*)::integer FROM public.paige_live_tenant_availability
            WHERE tenant_id='fa100000-0000-4000-8000-000000003333'),0,
  'no operator has hand-enabled the brand-new Solo workspace');

-- 1. Scope off: the fresh Solo owner is refused, and cannot bank an acceptance in advance.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-00000000000a","role":"authenticated"}',true);
SELECT is(public.paige_live_accept_terms() ->> 'code',NULL::text,
  'a brand-new Solo owner is not refused: the rollout scope no longer gates Live');
SELECT is((public.paige_live_accept_terms() ->> 'accepted')::boolean,true,
  'and their acknowledgement is recorded as accepted');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.paige_live_pilot_subjects
            WHERE tenant_id='fa100000-0000-4000-8000-000000003333'),1,
  'exactly one acknowledgement is on file for that workspace');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000a','fa100000-0000-4000-8000-000000003333'),true,
  'and the admission predicate admits them');

-- 2. Opening it is one value, and only the platform owner may turn it (§53: NOT a platform_admin).
SELECT throws_ok($q$SELECT public.set_paige_live_rollout_scope_internal(
  'fa100000-0000-4000-8000-000000000004','solo_tier')$q$,
  '42501',NULL,'a delegated platform_admin cannot open the rollout scope');
SELECT throws_ok($q$SELECT public.set_paige_live_rollout_scope_internal(
  'fa100000-0000-4000-8000-000000000002','everyone')$q$,
  '22023',NULL,'an unrecognised scope is refused rather than quietly stored');
RESET ROLE;
SELECT throws_ok($q$UPDATE public.paige_voice_readiness SET pilot_rollout_scope='everyone' WHERE singleton$q$,
  '23514',NULL,'and the column CHECK refuses it on the direct write path too');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.set_paige_live_rollout_scope_internal(
  'fa100000-0000-4000-8000-000000000002','solo_tier') ->> 'scope','solo_tier',
  'the platform owner opens Live to the Solo tier by changing one value');

-- 3. THE POINT. The same untouched account now works, with zero operator action on it.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-00000000000a","role":"authenticated"}',true);
SELECT is((public.paige_live_accept_terms() ->> 'accepted')::boolean,true,
  'the brand-new Solo owner accepts for THEMSELVES, supplying no account identifier');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000a','fa100000-0000-4000-8000-000000003333'),true,
  'and is admitted immediately, without waiting for anyone');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.paige_live_tenant_availability
            WHERE tenant_id='fa100000-0000-4000-8000-000000003333'),0,
  'with STILL no row naming their workspace: eligibility came from their tier, not a roster');
SELECT is((SELECT acceptance_actor_user_id FROM public.paige_live_pilot_subjects
            WHERE tenant_id='fa100000-0000-4000-8000-000000003333'),
  'fa100000-0000-4000-8000-00000000000a'::uuid,
  'and the acceptance on file is their own, which no operator could have given for them');

-- 4. The tier question genuinely discriminates. Mutation-checked locally: replacing the predicate
--    body with SELECT true DOES admit the agency owner, so these refusals come from the tier and
--    not from some other clause that would have refused them anyway.
SELECT ok(public.live_conversation_tier_allows('fa100000-0000-4000-8000-000000003333'),
  'a top-level standalone tenant is Solo-class');
SELECT ok(NOT public.live_conversation_tier_allows('fa100000-0000-4000-8000-000000004444'),
  'an agency is not');
SELECT ok(NOT public.live_conversation_tier_allows('fa100000-0000-4000-8000-000000005555'),
  'nor is a sub-account, whose release is deferred until the owner says so');
SELECT ok(NOT public.live_conversation_tier_allows('fa100000-0000-4000-8000-0000000fffff'),
  'nor is a tenant that does not exist');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-00000000000b","role":"authenticated"}',true);
SELECT is(public.paige_live_accept_terms() ->> 'code','live_audio_not_enabled',
  'the agency owner is refused under the very same open scope');
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-00000000000c","role":"authenticated"}',true);
SELECT is(public.paige_live_accept_terms() ->> 'code','live_audio_not_enabled',
  'and so is the sub-account owner');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000b','fa100000-0000-4000-8000-000000004444'),false,
  'the admission predicate refuses the agency');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000c','fa100000-0000-4000-8000-000000005555'),false,
  'and refuses the sub-account');

-- 5. The availability row keeps BOTH of its older meanings (§58: nothing shipped is removed), and
--    this is stated as the claim it actually is. An EARLIER draft of this block enabled the SOLO
--    tenant outright and asserted it was still admitted "regardless of tier" — which passed because
--    that tenant is Solo under an open scope, so BOTH disjuncts were true and deleting the
--    enabled-outright branch entirely would have left it green. An adversarial read caught it. The
--    claim under test is that enabled = true admits a workspace THE TIER WOULD REFUSE, so the test
--    now uses the AGENCY, which the tier refuses one assertion above.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-00000000000b","role":"authenticated"}',true);
SELECT is(public.paige_live_accept_terms() ->> 'code','live_audio_not_enabled',
  'the agency owner cannot accept through the tier scope (the negative this depends on)');
RESET ROLE;
SELECT lives_ok($q$INSERT INTO public.paige_live_tenant_availability(tenant_id,enabled)
  VALUES('fa100000-0000-4000-8000-000000004444',true)$q$,
  'the operator switches the agency workspace on outright, the pre-existing path');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-00000000000b","role":"authenticated"}',true);
SELECT is((public.paige_live_accept_terms() ->> 'accepted')::boolean,false,
  'an availability row set to true does not let an agency owner accept: Live is Solo-only');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000b','fa100000-0000-4000-8000-000000004444'),false,
  'enabled = true does not admit a workspace the tier refuses: Live is Solo-only');

-- The kill switch, on a workspace the tier WOULD admit.
RESET ROLE;
SELECT lives_ok($q$INSERT INTO public.paige_live_tenant_availability(tenant_id,enabled)
  VALUES('fa100000-0000-4000-8000-000000003333',false)$q$,
  'a Solo workspace can still be switched off individually');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000a','fa100000-0000-4000-8000-000000003333'),false,
  'and that kill switch overrides an open tier scope');
RESET ROLE;
SELECT lives_ok($q$DELETE FROM public.paige_live_tenant_availability
  WHERE tenant_id='fa100000-0000-4000-8000-000000003333'$q$,
  'and the row can be removed again');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000a','fa100000-0000-4000-8000-000000003333'),true,
  'leaving the account back under the scope, which still admits it: a MISSING row is not a refusal');

-- 6. ACT-AS IS NOT MEMBERSHIP. current_user_tenant_id() hands a platform_admin any tenant they
--    point active_tenant_id at, with no membership, which is correct for READS under §51 Tier 1 and
--    would be a §53 escalation here: the only prior writer of this table required is_platform_owner,
--    which §53 freezes as super_admin-only. The door is proven open first, so the refusal below
--    cannot pass for the wrong reason.
RESET ROLE;
SELECT lives_ok($q$INSERT INTO public.profiles(user_id,active_tenant_id)
  VALUES('fa100000-0000-4000-8000-000000000004','fa100000-0000-4000-8000-000000003333')
  ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id$q$,
  'a delegated platform_admin points their active workspace at a customer Solo tenant');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT is(public.current_user_tenant_id(),'fa100000-0000-4000-8000-000000003333'::uuid,
  'the resolver DOES hand them that tenant, so the door being closed below is a real closure');
SELECT is(public.paige_live_accept_terms() ->> 'code','live_audio_not_enabled',
  'and acceptance refuses them anyway: act-as is not membership');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.paige_live_pilot_subjects
            WHERE user_id='fa100000-0000-4000-8000-000000000004'),0,
  'no subject row was written for a platform_admin on a book that is not theirs');

-- 7. Every ACTIVE MEMBER of a Solo account is eligible, not only its owner. Deliberate: the owner
--    asked for this for "all of my users", and Live is a MODALITY over a book a member already
--    reaches in chat, not new access to it. Stated out loud because the pre-existing suite treated
--    the opposite as a property, back when admission was a per-person allowlist.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-00000000000e","role":"authenticated"}',true);
SELECT is((public.paige_live_accept_terms() ->> 'accepted')::boolean,true,
  'a NON-OWNER active member of the Solo tenant accepts for themselves');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000e','fa100000-0000-4000-8000-000000003333'),true,
  'and is admitted');

-- 8. Acceptance is idempotent, so the platform audit log cannot be looped by an authenticated
--    member, and re-calling cannot silently restart anyone's expiry clock.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-00000000000e","role":"authenticated"}',true);
SELECT is((public.paige_live_accept_terms() ->> 'unchanged')::boolean,true,
  'a second call on a live acceptance reports unchanged');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.paige_audit_log
            WHERE action='paige_live.accept_terms'
              AND actor_user_id='fa100000-0000-4000-8000-00000000000e'),1,
  'exactly one acceptance audit row exists for that member after two calls');

-- 9. Closing the scope withdraws only what THE SCOPE carried. Its first draft revoked every
--    unrevoked subject in the table, which would have destroyed the admission held by the
--    enabled-outright operator path — on production, the only row that exists — and made the
--    rollback documented at the top of the migration a destructive act needing a fresh inspection
--    receipt to undo. A lever must not destroy what it did not create.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT ok((public.set_paige_live_rollout_scope_internal(
  'fa100000-0000-4000-8000-000000000002','off') ->> 'subjects_withdrawn')::integer >= 1,
  'closing the scope withdraws the subjects it was carrying');
-- RECORDS CURRENT BEHAVIOUR pending the platform-level Live kill-switch restoration item (owner
-- ruling 2026-09-26). Change this assertion back to a refusal when that item lands.
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000a','fa100000-0000-4000-8000-000000003333'),true,
  'closing the rollout scope does not currently stop a Solo member (kill switch pending restoration)');
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000b','fa100000-0000-4000-8000-000000004444'),false,
  'and the agency owner stays refused: Live is Solo-only');
SELECT is(public.set_paige_live_rollout_scope_internal(
  'fa100000-0000-4000-8000-000000000002','solo_tier') ->> 'scope','solo_tier',
  'the owner re-opens it');
-- RECORDS CURRENT BEHAVIOUR pending the platform-level Live kill-switch restoration item (owner
-- ruling 2026-09-26). Change this assertion back to a refusal when that item lands.
SELECT is(public.paige_live_pilot_authorized_internal(
  'fa100000-0000-4000-8000-00000000000a','fa100000-0000-4000-8000-000000003333'),true,
  'and the Solo member is still admitted after the scope is reopened');

-- 10. The global disable CLOSES the audience too. Two switches that compose in one direction and
--     not the other are a trap: leaving the scope open means the next authorization silently
--     re-opens Live to every Solo account with no fresh decision about who it is for.
SELECT is(public.set_paige_live_pilot_internal(
  'fa100000-0000-4000-8000-000000000002',NULL,false,NULL,NULL) ->> 'scope','off',
  'disabling reports the audience closed');
RESET ROLE;
SELECT is((SELECT pilot_rollout_scope FROM public.paige_voice_readiness WHERE singleton),'off',
  'and the stored scope really is off, so a re-enable cannot silently re-open the tier');

-- 11. One of each function, and the grants that keep the setting out of a browser's reach.
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='paige_live_accept_terms'),1,
  'exactly one acceptance function exists');
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='set_paige_live_rollout_scope_internal'),1,
  'exactly one scope writer exists');
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='live_conversation_tier_allows'),1,
  'exactly one tier predicate exists');
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='set_paige_live_pilot_internal'),1,
  'the rollout writer was REPLACED, not forked into a second overload');
SELECT ok(has_function_privilege('authenticated','public.paige_live_accept_terms()','EXECUTE'),
  'a signed-in Solo member CAN accept for themselves — the capability is theirs, not an operator''s');
SELECT ok(NOT has_function_privilege('anon','public.paige_live_accept_terms()','EXECUTE'),
  'an unauthenticated caller cannot');
SELECT ok(NOT has_function_privilege('authenticated','public.set_paige_live_rollout_scope_internal(uuid,text)','EXECUTE'),
  'and no browser caller can set the rollout scope');
SELECT ok(NOT has_function_privilege('authenticated','public.live_conversation_tier_allows(uuid)','EXECUTE'),
  'nor read the tier predicate directly');


-- ===========================================================================
-- THE OPERATOR CAN SEE IT (20270423000000)
--
-- The setting existed with no way to read it, which is half of why it also had no way to turn it.
-- This projection is platform-owner-only in its BODY, not by its grant (§59), and it reports counts
-- rather than people (§13) — an operator needs to know that four accounts are admitted, never which
-- four; that is the tenants' business, not the platform's.
-- ===========================================================================
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-00000000000a","role":"authenticated"}',true);
SELECT throws_ok($q$SELECT public.paige_live_rollout_status()$q$,'42501',NULL,
  'an ordinary Solo member is refused the rollout status despite holding EXECUTE on it');
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT throws_ok($q$SELECT public.paige_live_rollout_status()$q$,'42501',NULL,
  'and so is a delegated platform_admin — this is is_platform_owner, which §53 freezes');
SELECT set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT lives_ok($q$SELECT public.paige_live_rollout_status()$q$,
  'the platform owner is answered');
SELECT is((public.paige_live_rollout_status() ->> 'zero_retention_state'),'UNAVAILABLE',
  'and the projection surfaces verified zero retention as UNAVAILABLE beside the switch');
SELECT is((public.paige_live_rollout_status() ->> 'speaker_identity_enforced')::boolean,false,
  'and surfaces that physical speaker identity is not enforced');
SELECT ok((public.paige_live_rollout_status() ->> 'solo_class_tenants')::integer >= 1,
  'it counts the Solo-class accounts the scope would reach, so the decision is sized not guessed');
-- §13: the payload is counts. A user id appearing here would leak one tenant's subject to the
-- operator surface, which is the §9 seam this projection must not cross.
SELECT ok(public.paige_live_rollout_status()::text NOT LIKE '%fa100000-0000-4000-8000-00000000000a%',
  'no subject identity appears in the payload');
SELECT ok(NOT (public.paige_live_rollout_status() ?| array['user_id','tenant_id','email','evidence_ref','provider_voice_ref']),
  'and no key exists that could carry an identity or a provider reference');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='paige_live_rollout_status'),1,
  'exactly one rollout projection exists');
SELECT ok(NOT has_function_privilege('anon','public.paige_live_rollout_status()','EXECUTE'),
  'an unauthenticated caller cannot reach it at all');

SELECT * FROM finish();
ROLLBACK;
