-- Option B (owner ruling, 2026-09-29): a platform operator acting inside a company-owned system
-- workspace has owner authority there, recorded under their own identity; never in a customer's
-- workspace; and only the platform owner decides which workspaces are the company's.
-- Synthetic fixtures; always rolled back.
BEGIN;
SELECT plan(50);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('0b0b0000-0000-4000-8000-000000000001','authenticated','authenticated','cw-super@tests.invalid'),
  ('0b0b0000-0000-4000-8000-000000000002','authenticated','authenticated','cw-platform@tests.invalid'),
  ('0b0b0000-0000-4000-8000-000000000003','authenticated','authenticated','cw-customer-owner@tests.invalid'),
  ('0b0b0000-0000-4000-8000-000000000004','authenticated','authenticated','cw-global-admin@tests.invalid');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
-- The outsider carries a GLOBAL admin role on purpose (§59): it is not the operator role.
INSERT INTO public.user_roles (user_id, role) VALUES
  ('0b0b0000-0000-4000-8000-000000000001','super_admin'),
  ('0b0b0000-0000-4000-8000-000000000002','platform_admin'),
  ('0b0b0000-0000-4000-8000-000000000003','admin'),
  ('0b0b0000-0000-4000-8000-000000000004','admin')
ON CONFLICT DO NOTHING;
SELECT set_config('request.jwt.claims','',true);

-- Written with no signed-in user (a migration or server context), which may set the flag.
INSERT INTO public.tenants (id, slug, name, status, account_type, features, brand) VALUES
  ('0b0b0000-0000-4000-8000-00000000c001','cw-company','Company Workspace','trial','standalone','{"system_workspace":true}'::jsonb,'{}'::jsonb),
  ('0b0b0000-0000-4000-8000-00000000c002','cw-customer','Customer Workspace','active','standalone','{}'::jsonb,'{}'::jsonb),
  ('0b0b0000-0000-4000-8000-00000000c004','cw-customer-two','Second Customer','active','standalone','{}'::jsonb,'{}'::jsonb);
INSERT INTO public.tenants (id, slug, name, status, account_type, parent_tenant_id, features, brand) VALUES
  ('0b0b0000-0000-4000-8000-00000000c003','cw-child','Flagged Child','active','sub_account',
   '0b0b0000-0000-4000-8000-00000000c002','{"system_workspace":true}'::jsonb,'{}'::jsonb);
-- The outsider is an active member of the second customer workspace and works there, as any real
-- user does; granting them a role elsewhere then leaves their active workspace alone.
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('0b0b0000-0000-4000-8000-00000000c002','0b0b0000-0000-4000-8000-000000000003','owner','active',true,now()),
  ('0b0b0000-0000-4000-8000-00000000c004','0b0b0000-0000-4000-8000-000000000004','member','active',false,now());
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('0b0b0000-0000-4000-8000-000000000001',NULL),
  ('0b0b0000-0000-4000-8000-000000000002','0b0b0000-0000-4000-8000-00000000c001'),
  ('0b0b0000-0000-4000-8000-000000000003','0b0b0000-0000-4000-8000-00000000c002'),
  ('0b0b0000-0000-4000-8000-000000000004','0b0b0000-0000-4000-8000-00000000c004')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
INSERT INTO public.growth_forms (id, tenant_id, slug, name, status, schema_json) VALUES
  ('0b0b0000-0000-4000-8000-00000000f001','0b0b0000-0000-4000-8000-00000000c001','cw-form','Company form','active','{"sections":[]}'::jsonb),
  ('0b0b0000-0000-4000-8000-00000000f002','0b0b0000-0000-4000-8000-00000000c002','cw-form','Customer form','active','{"sections":[]}'::jsonb);

CREATE FUNCTION pg_temp.as_caller(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
END $$;

-- ── What counts as a company workspace ──
SELECT ok(public.is_company_workspace('0b0b0000-0000-4000-8000-00000000c001'), 'a flagged top-level standalone workspace is the company''s');
SELECT ok(NOT public.is_company_workspace('0b0b0000-0000-4000-8000-00000000c002'), 'a customer workspace is not');
SELECT ok(NOT public.is_company_workspace('0b0b0000-0000-4000-8000-00000000c003'), 'a flagged sub-account is never a company workspace');

-- ── Explicit-actor predicates (service context) ──
SELECT ok(public.is_tenant_admin_as('0b0b0000-0000-4000-8000-000000000002','0b0b0000-0000-4000-8000-00000000c001'), 'a platform_admin is an admin of a company workspace');
SELECT ok(public.is_tenant_admin_as('0b0b0000-0000-4000-8000-000000000001','0b0b0000-0000-4000-8000-00000000c001'), 'a super_admin is an admin of a company workspace');
SELECT ok(NOT public.is_tenant_admin_as('0b0b0000-0000-4000-8000-000000000002','0b0b0000-0000-4000-8000-00000000c002'), 'a platform_admin is NOT an admin of a customer workspace');
SELECT ok(NOT public.is_tenant_admin_as('0b0b0000-0000-4000-8000-000000000004','0b0b0000-0000-4000-8000-00000000c001'), 'a global admin role is not the operator role');
SELECT ok(public.is_tenant_admin_as('0b0b0000-0000-4000-8000-000000000003','0b0b0000-0000-4000-8000-00000000c002'), 'the customer''s own owner is unchanged');
SELECT ok(NOT public.is_tenant_admin_as(NULL,'0b0b0000-0000-4000-8000-00000000c001'), 'no actor is never an admin');
SELECT ok(public.is_tenant_owner('0b0b0000-0000-4000-8000-000000000002','0b0b0000-0000-4000-8000-00000000c001'), 'an operator owns a named company workspace');
SELECT ok(NOT public.is_tenant_owner('0b0b0000-0000-4000-8000-000000000002', NULL), '"owner of any workspace" is never widened');
SELECT ok(NOT public.is_tenant_owner('0b0b0000-0000-4000-8000-000000000002','0b0b0000-0000-4000-8000-00000000c002'), 'an operator does not own a customer workspace');

-- ── The service path the form processor uses: the operator is the recorded creator ──
SELECT is((SELECT count(*)::int FROM public.create_contact_v2(p_first_name => 'Visitor', p_email => 'visitor-one@tests.invalid',
  p_tenant_id => '0b0b0000-0000-4000-8000-00000000c001', p_created_by => '0b0b0000-0000-4000-8000-000000000002', p_source => 'paige_form')), 1,
  'a submission in a company workspace creates the contact with the operator as creator');
SELECT is((SELECT created_by FROM public.clients WHERE tenant_id = '0b0b0000-0000-4000-8000-00000000c001' AND first_name = 'Visitor'),
  '0b0b0000-0000-4000-8000-000000000002'::uuid, 'the contact is recorded under the operator''s own identity');
SELECT is((SELECT user_id FROM public.audit_logs WHERE entity = 'client' AND action = 'create_contact'
             AND (data ->> 'tenant_id') = '0b0b0000-0000-4000-8000-00000000c001' ORDER BY created_at DESC LIMIT 1),
  '0b0b0000-0000-4000-8000-000000000002'::uuid, 'and so is the audit entry');
SELECT throws_ok($$SELECT * FROM public.create_contact_v2(p_first_name => 'Visitor', p_email => 'visitor-two@tests.invalid',
  p_tenant_id => '0b0b0000-0000-4000-8000-00000000c002', p_created_by => '0b0b0000-0000-4000-8000-000000000002')$$,
  '42501', 'CONTACT_CREATOR_NOT_IN_TENANT', 'an operator cannot create contacts in a customer workspace');
SELECT is((SELECT count(*)::int FROM public.create_contact_v2(p_first_name => 'Visitor', p_email => 'visitor-three@tests.invalid',
  p_tenant_id => '0b0b0000-0000-4000-8000-00000000c002', p_created_by => '0b0b0000-0000-4000-8000-000000000003')), 1,
  'the customer''s owner still creates contacts in their workspace');

SET LOCAL ROLE authenticated;

-- ── Signed-in predicates ──
SELECT pg_temp.as_caller('0b0b0000-0000-4000-8000-000000000002');
SELECT ok(public.is_tenant_admin('0b0b0000-0000-4000-8000-00000000c001'), 'a signed-in platform_admin is an admin of the company workspace');
SELECT ok(public.is_tenant_member('0b0b0000-0000-4000-8000-00000000c001'), 'and a member of it');
SELECT ok(NOT public.is_tenant_admin('0b0b0000-0000-4000-8000-00000000c002'), 'but not an admin of a customer workspace');
SELECT ok(NOT public.is_tenant_member('0b0b0000-0000-4000-8000-00000000c002'), 'nor a member of it');
SELECT lives_ok($$SELECT public.growth_form_set_intake('0b0b0000-0000-4000-8000-00000000f001', false, NULL, NULL, 'alerts@company.tests.invalid')$$,
  'the operator sets a company form''s alert address');
SELECT throws_ok($$SELECT public.growth_form_set_intake('0b0b0000-0000-4000-8000-00000000f002', false, NULL, NULL, 'alerts@company.tests.invalid')$$,
  '42501', NULL, 'the operator cannot set a customer form''s intake');
SELECT is((SELECT count(*)::int FROM public.create_contact_v2(p_first_name => 'Direct', p_email => 'direct@tests.invalid')), 1,
  'signed in and acting in the company workspace, the operator creates a contact');

SELECT pg_temp.as_caller('0b0b0000-0000-4000-8000-000000000004');
SELECT ok(NOT public.is_tenant_admin('0b0b0000-0000-4000-8000-00000000c001'), 'a global admin role gains nothing in a company workspace');

SELECT pg_temp.as_caller('0b0b0000-0000-4000-8000-000000000003');
SELECT ok(public.is_tenant_admin('0b0b0000-0000-4000-8000-00000000c002'), 'the customer owner is still an admin of their own workspace');
SELECT ok(NOT public.is_tenant_admin('0b0b0000-0000-4000-8000-00000000c001'), 'and nothing in the company workspace');

-- ── Only the platform owner decides which workspaces are the company's ──
SELECT throws_ok($$UPDATE public.tenants SET features = features || '{"system_workspace":true}'::jsonb WHERE id = '0b0b0000-0000-4000-8000-00000000c002'$$,
  '42501', 'TENANT_FORBIDDEN: only the platform owner can mark a workspace as company-owned',
  'a customer owner cannot mark their own workspace as the company''s');
SELECT lives_ok($$UPDATE public.tenants SET features = features || '{"cw_test_flag":true}'::jsonb WHERE id = '0b0b0000-0000-4000-8000-00000000c002'$$,
  'the customer owner can still change other feature settings');
SELECT is((SELECT features ->> 'cw_test_flag' FROM public.tenants WHERE id = '0b0b0000-0000-4000-8000-00000000c002'), 'true',
  'and the change is saved');

SELECT pg_temp.as_caller('0b0b0000-0000-4000-8000-000000000002');
SELECT throws_ok($$UPDATE public.tenants SET features = features || '{"system_workspace":true}'::jsonb WHERE id = '0b0b0000-0000-4000-8000-00000000c002'$$,
  '42501', 'TENANT_FORBIDDEN: only the platform owner can mark a workspace as company-owned',
  'a platform_admin cannot mark a customer workspace as the company''s');
SELECT throws_ok($$UPDATE public.tenants SET features = features - 'system_workspace' WHERE id = '0b0b0000-0000-4000-8000-00000000c001'$$,
  '42501', 'TENANT_FORBIDDEN: only the platform owner can mark a workspace as company-owned',
  'nor clear the mark on a company workspace');

-- ── A service-role session is not trusted to mark a workspace (review B1) ──
-- Edge functions act for signed-in people as service_role with no auth.uid(); paige-mcp's
-- update_tenant_features is one. Trusting that session would let a delegated operator mark a
-- customer's workspace as the company's.
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE public.tenants SET features = features || '{"system_workspace":true}'::jsonb WHERE id = '0b0b0000-0000-4000-8000-00000000c004'$$,
  '42501', 'TENANT_FORBIDDEN: only the platform owner can mark a workspace as company-owned',
  'a service-role session cannot mark a customer workspace as the company''s');
SELECT lives_ok($$UPDATE public.tenants SET features = features || '{"cw_service_flag":true}'::jsonb WHERE id = '0b0b0000-0000-4000-8000-00000000c004'$$,
  'a service-role session still changes other feature settings');
SELECT throws_ok($$INSERT INTO public.tenant_members (tenant_id, user_id, role, status) VALUES ('0b0b0000-0000-4000-8000-00000000c001','0b0b0000-0000-4000-8000-000000000004','admin','active')$$,
  '42501', 'TENANT_FORBIDDEN: membership of a company workspace is managed by the platform owner; operators act there through their role',
  'a service-role session cannot seat anyone in a company workspace (so an invite cannot become a lasting seat)');

-- ── A malformed stored value never breaks the workspace (review N1) ──
RESET ROLE;
SELECT set_config('request.jwt.claims','',true);
SELECT lives_ok($$UPDATE public.tenants SET features = features || '{"system_workspace":"yes"}'::jsonb WHERE id = '0b0b0000-0000-4000-8000-00000000c004'$$,
  'a non-boolean flag value is stored without error');
SELECT ok(NOT public.is_company_workspace('0b0b0000-0000-4000-8000-00000000c004'), 'and does not make the workspace the company''s');

-- ── Nobody learns whether another user holds the operator role (review S4) ──
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SET LOCAL ROLE anon;
SELECT ok(NOT public.is_tenant_owner('0b0b0000-0000-4000-8000-000000000002','0b0b0000-0000-4000-8000-00000000c001'),
  'an anonymous caller cannot probe whether a user id is an operator');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_caller('0b0b0000-0000-4000-8000-000000000003');
SELECT ok(NOT public.is_tenant_owner('0b0b0000-0000-4000-8000-000000000002','0b0b0000-0000-4000-8000-00000000c001'),
  'nor can a signed-in customer');
SELECT lives_ok($$SELECT public.grant_tenant_member_role('0b0b0000-0000-4000-8000-000000000004'::uuid, 'client'::public.app_role, '0b0b0000-0000-4000-8000-00000000c002'::uuid)$$,
  'a customer owner still adds people to their own workspace');
SELECT lives_ok($$SELECT public.create_tenant_invite_token('0b0b0000-0000-4000-8000-00000000c002'::uuid, 'team')$$,
  'and still invites people to it');
SELECT pg_temp.as_caller('0b0b0000-0000-4000-8000-000000000002');
SELECT ok(public.is_tenant_owner('0b0b0000-0000-4000-8000-000000000002','0b0b0000-0000-4000-8000-00000000c001'),
  'an operator asking about themselves owns the company workspace');

-- ── Authority there is the role's, never a lasting seat (review S1; Option A stays rejected) ──
SELECT throws_ok($$SELECT public.grant_tenant_member_role('0b0b0000-0000-4000-8000-000000000002'::uuid, 'client'::public.app_role, '0b0b0000-0000-4000-8000-00000000c001'::uuid)$$,
  '42501', 'TENANT_FORBIDDEN: membership of a company workspace is managed by the platform owner; operators act there through their role',
  'an operator cannot seat anyone, themselves included, in a company workspace');
SELECT throws_ok($$SELECT public.create_tenant_invite_token('0b0b0000-0000-4000-8000-00000000c001'::uuid, 'team', 'owner'::public.tenant_role)$$,
  '42501', 'TENANT_FORBIDDEN: a company workspace does not take invitations; the platform owner adds people to it directly',
  'nor mint an invitation into it for an account they control');
SELECT throws_ok($$INSERT INTO public.invitations (email, invited_by) VALUES ('seat@tests.invalid','0b0b0000-0000-4000-8000-000000000002')$$,
  '42501', 'TENANT_FORBIDDEN: a company workspace does not take invitations; the platform owner adds people to it directly',
  'nor a staff invitation that names no workspace and would be stamped with the company''s');
SELECT lives_ok($$SELECT public.create_tenant_invite_token('0b0b0000-0000-4000-8000-00000000c001'::uuid, 'consumer')$$,
  'a client portal invite, which creates no seat, is still allowed in a company workspace');

-- Role sync, fired by a role granted while the operator's active workspace is the company's,
-- keeps skipping it instead of trying (and failing) to seat someone there.
RESET ROLE;
SELECT lives_ok($$INSERT INTO public.user_roles (user_id, role) VALUES ('0b0b0000-0000-4000-8000-000000000003','client')$$,
  'a role granted in an operator''s company-workspace context does not try to seat anyone there');
SET LOCAL ROLE authenticated;

SELECT pg_temp.as_caller('0b0b0000-0000-4000-8000-000000000001');
SELECT lives_ok($$SELECT public.grant_tenant_member_role('0b0b0000-0000-4000-8000-000000000004'::uuid, 'client'::public.app_role, '0b0b0000-0000-4000-8000-00000000c001'::uuid)$$,
  'the platform owner seats people in a company workspace directly');

SELECT pg_temp.as_caller('0b0b0000-0000-4000-8000-000000000001');
SELECT lives_ok($$UPDATE public.tenants SET features = features || '{"system_workspace":true}'::jsonb WHERE id = '0b0b0000-0000-4000-8000-00000000c002'$$,
  'the platform owner can mark a workspace as the company''s');
SELECT ok((SELECT (features ->> 'system_workspace')::boolean FROM public.tenants WHERE id = '0b0b0000-0000-4000-8000-00000000c002'),
  'and the mark is saved');

SELECT * FROM finish();
ROLLBACK;
