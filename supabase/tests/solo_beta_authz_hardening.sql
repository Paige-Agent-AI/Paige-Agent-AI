-- Solo beta authorization hardening proof.
-- Synthetic fixtures only; every mutation rolls back.
BEGIN;

SELECT plan(20);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.provision_tenant(text,text,text,text,text,text,integer)', 'EXECUTE'),
  'authenticated callers cannot execute generic tenant provisioning'
);
SELECT ok(
  has_function_privilege('service_role', 'public.provision_tenant(text,text,text,text,text,text,integer)', 'EXECUTE'),
  'service role retains generic tenant provisioning for audited internal fulfillment'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.provision_tenant(text,text,text,text,text,text,integer)', 'EXECUTE'),
  'anonymous callers cannot execute generic tenant provisioning'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.is_signup_complete(uuid)', 'EXECUTE'),
  'authenticated callers cannot inspect another user through the uuid overload'
);
SELECT ok(
  has_function_privilege('service_role', 'public.is_signup_complete(uuid)', 'EXECUTE'),
  'service role retains the actor-explicit signup completion check'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.is_signup_complete(uuid)', 'EXECUTE'),
  'anonymous callers cannot execute the uuid signup completion check'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.is_signup_complete()', 'EXECUTE'),
  'authenticated callers retain the caller-pinned zero-argument signup check'
);
SELECT ok(
  has_function_privilege('service_role', 'public.is_signup_complete()', 'EXECUTE'),
  'service role retains the zero-argument signup check'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.create_contact(text,text,text,text,text,text,text,text,text[],text,text,uuid,uuid,uuid,text)', 'EXECUTE'),
  'authenticated contact creation remains available through its tenant-pinned path'
);
SELECT ok(
  has_function_privilege('service_role', 'public.create_contact(text,text,text,text,text,text,text,text,text[],text,text,uuid,uuid,uuid,text)', 'EXECUTE'),
  'service contact creation remains available for validated internal callers'
);

INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, created_at) VALUES
  (
    'b1900000-0000-0000-0000-000000000099', 'authenticated', 'authenticated',
    'solo-consent-proof@tests.invalid',
    '{"signup_offer_code":"paige-solo-beta-monthly-v1","consent_agreements":true,"consent_data_usage":true,"consent_marketing":false,"sms_consent":false}'::jsonb,
    now()
  );

SELECT ok(
  (SELECT consent_privacy_policy AND consent_data_usage AND consent_timestamp IS NOT NULL
   FROM public.profiles WHERE user_id='b1900000-0000-0000-0000-000000000099'),
  'Solo identity creation persists required profile consent in the auth transaction'
);
SELECT is(
  (SELECT count(*)::integer FROM public.legal_acceptances
   WHERE user_id='b1900000-0000-0000-0000-000000000099'),
  (SELECT count(*)::integer FROM public.legal_documents WHERE is_current=true AND required_at_signup=true),
  'Solo identity creation records every current required signup document'
);
SELECT throws_ok(
  $$INSERT INTO auth.users (id,aud,role,email,raw_user_meta_data,created_at) VALUES
    ('b1900000-0000-0000-0000-000000000098','authenticated','authenticated','solo-consent-denied@tests.invalid',
     '{"signup_offer_code":"paige-solo-beta-monthly-v1","consent_agreements":false,"consent_data_usage":true}'::jsonb,now())$$,
  'P0001', 'solo_beta_signup_consent_required',
  'Solo identity creation fails closed when required consent is absent'
);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('b1900000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'solo-authz-creator-a@tests.invalid'),
  ('b1900000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'solo-authz-coach-a@tests.invalid'),
  ('b1900000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'solo-authz-creator-b@tests.invalid'),
  ('b1900000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'solo-authz-revoked-a@tests.invalid');

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features, brand)
VALUES
  ('b1900000-0000-0000-0000-00000000aaaa', 'solo-authz-workspace-a', 'Solo Authz Workspace A', 'active', 'standalone', 'SAA', 8919001, '{}'::jsonb, '{}'::jsonb),
  ('b1900000-0000-0000-0000-00000000bbbb', 'solo-authz-workspace-b', 'Solo Authz Workspace B', 'active', 'standalone', 'SAB', 8919002, '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('b1900000-0000-0000-0000-00000000aaaa', 'b1900000-0000-0000-0000-000000000001', 'owner',  'active',  true,  now()),
  ('b1900000-0000-0000-0000-00000000aaaa', 'b1900000-0000-0000-0000-000000000002', 'member',  'active',  false, now()),
  ('b1900000-0000-0000-0000-00000000bbbb', 'b1900000-0000-0000-0000-000000000003', 'owner',  'active',  true,  now()),
  ('b1900000-0000-0000-0000-00000000aaaa', 'b1900000-0000-0000-0000-000000000004', 'member',  'revoked', false, now());

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('b1900000-0000-0000-0000-000000000001', 'b1900000-0000-0000-0000-00000000aaaa'),
  ('b1900000-0000-0000-0000-000000000002', 'b1900000-0000-0000-0000-00000000aaaa'),
  ('b1900000-0000-0000-0000-000000000003', 'b1900000-0000-0000-0000-00000000bbbb')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- The revoked coach deliberately has no active workspace. Giving a revoked
-- membership an active_tenant_id would violate the existing profile guard and
-- would make the fixture less realistic than the boundary it is proving.

INSERT INTO public.user_roles (user_id, role) VALUES
  ('b1900000-0000-0000-0000-000000000001', 'user'),
  ('b1900000-0000-0000-0000-000000000002', 'user'),
  ('b1900000-0000-0000-0000-000000000003', 'admin'),
  ('b1900000-0000-0000-0000-000000000004', 'user')
ON CONFLICT DO NOTHING;

-- A fresh Solo provisioner grants only the base global role. Tenant-scoped
-- owner membership, not a fabricated global admin role, authorizes creation.
DELETE FROM public.user_roles
WHERE user_id = 'b1900000-0000-0000-0000-000000000001'
  AND role <> 'user';

SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$SELECT public.create_contact('Valid', 'Service', 'solo-authz-valid@tests.invalid', NULL, NULL, NULL, 'new_lead', 'proof', '{}', NULL, NULL, 'b1900000-0000-0000-0000-000000000002', 'b1900000-0000-0000-0000-00000000aaaa', 'b1900000-0000-0000-0000-000000000001', 'api')$$,
  'service creation succeeds when creator and assigned coach are active members of the supplied tenant'
);
RESET ROLE;
SELECT is(
  (SELECT tenant_id FROM public.clients WHERE email = 'solo-authz-valid@tests.invalid'),
  'b1900000-0000-0000-0000-00000000aaaa'::uuid,
  'valid service creation writes only to the supplied tenant'
);
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT public.create_contact('Wrong', 'Creator', 'solo-authz-wrong-creator@tests.invalid', NULL, NULL, NULL, 'new_lead', 'proof', '{}', NULL, NULL, NULL, 'b1900000-0000-0000-0000-00000000aaaa', 'b1900000-0000-0000-0000-000000000003', 'api')$$,
  '42501', 'CONTACT_CREATOR_NOT_IN_TENANT',
  'service creation rejects a creator who is not active in the supplied tenant'
);
SELECT throws_ok(
  $$SELECT public.create_contact('Wrong', 'Coach', 'solo-authz-wrong-coach@tests.invalid', NULL, NULL, NULL, 'new_lead', 'proof', '{}', NULL, NULL, 'b1900000-0000-0000-0000-000000000003', 'b1900000-0000-0000-0000-00000000aaaa', 'b1900000-0000-0000-0000-000000000001', 'api')$$,
  '42501', 'CONTACT_COACH_NOT_IN_TENANT',
  'service creation rejects an assigned coach active only in another tenant'
);
SELECT throws_ok(
  $$SELECT public.create_contact('Revoked', 'Coach', 'solo-authz-revoked-coach@tests.invalid', NULL, NULL, NULL, 'new_lead', 'proof', '{}', NULL, NULL, 'b1900000-0000-0000-0000-000000000004', 'b1900000-0000-0000-0000-00000000aaaa', 'b1900000-0000-0000-0000-000000000001', 'api')$$,
  '42501', 'CONTACT_COACH_NOT_IN_TENANT',
  'service creation rejects a revoked assigned coach in the supplied tenant'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b1900000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.create_contact('Pinned', 'Caller', 'solo-authz-pinned@tests.invalid', NULL, NULL, NULL, 'new_lead', 'proof', '{}', NULL, NULL, NULL, 'b1900000-0000-0000-0000-00000000bbbb', 'b1900000-0000-0000-0000-000000000003', 'api')$$,
  'authenticated Solo owner with only the base user role can create and remains pinned despite caller-supplied tenant/creator'
);
RESET ROLE;
SELECT is(
  (SELECT tenant_id FROM public.clients WHERE email = 'solo-authz-pinned@tests.invalid'),
  'b1900000-0000-0000-0000-00000000aaaa'::uuid,
  'authenticated contact creation remains pinned to the caller active tenant'
);

SELECT * FROM finish();
ROLLBACK;
