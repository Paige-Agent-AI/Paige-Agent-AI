-- R5: semantic recall of owner memory matches a NULL tenant. A tenant-less operator recalls their
-- own tenant-less rows; nobody recalls another user's rows; a tenant row is never returned for a
-- NULL tenant, and a NULL-tenant row is never returned for a tenant.
BEGIN;
SELECT plan(8);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('0b570000-0000-4000-8000-000000000001','authenticated','authenticated','recall-operator@tests.invalid'),
  ('0b570000-0000-4000-8000-000000000002','authenticated','authenticated','recall-other-operator@tests.invalid'),
  ('0b570000-0000-4000-8000-000000000003','authenticated','authenticated','recall-owner@tests.invalid');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('0b570000-0000-4000-8000-000000000001','platform_admin'),
  ('0b570000-0000-4000-8000-000000000002','platform_admin'),
  ('0b570000-0000-4000-8000-000000000003','user');
SELECT set_config('request.jwt.claims','',true);

INSERT INTO public.tenants (id, slug, name, owner_user_id, status, account_type, features, brand) VALUES
  ('0b570000-0000-4000-8000-00000000a001','recall-proof-tenant','Recall Proof Tenant',
   '0b570000-0000-4000-8000-000000000003','active','standalone','{}'::jsonb,'{}'::jsonb);
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('0b570000-0000-4000-8000-00000000a001','0b570000-0000-4000-8000-000000000003','owner','active',true,now());
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('0b570000-0000-4000-8000-000000000001',NULL),
  ('0b570000-0000-4000-8000-000000000002',NULL),
  ('0b570000-0000-4000-8000-000000000003',NULL)
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = NULL;

-- One direction in embedding space, so every row is a perfect match and only scope decides.
CREATE TEMP TABLE probe AS
  SELECT ('[' || array_to_string(array_fill(1::real, ARRAY[1024]), ',') || ']')::extensions.vector AS v;
GRANT SELECT ON probe TO authenticated;

INSERT INTO public.paige_owner_memory (id, tenant_id, user_id, memory_type, content, embedding) VALUES
  ('0b570000-0000-4000-8000-0000000000e1', NULL, '0b570000-0000-4000-8000-000000000001', 'preference',
   'operator one, no tenant', (SELECT v FROM probe)),
  ('0b570000-0000-4000-8000-0000000000e2', NULL, '0b570000-0000-4000-8000-000000000002', 'preference',
   'operator two, no tenant', (SELECT v FROM probe)),
  ('0b570000-0000-4000-8000-0000000000e3', '0b570000-0000-4000-8000-00000000a001',
   '0b570000-0000-4000-8000-000000000003', 'preference', 'owner, in tenant', (SELECT v FROM probe));

-- Service caller (the chat's own path), NULL tenant.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT results_eq(
  $$SELECT content FROM public.match_paige_owner_memory((SELECT v FROM probe), NULL,
      '0b570000-0000-4000-8000-000000000001', 0.5, 8)$$,
  $$VALUES ('operator one, no tenant'::text)$$,
  'a tenant-less operator''s own tenant-less memory is recalled');
SELECT is(
  (SELECT count(*)::int FROM public.match_paige_owner_memory((SELECT v FROM probe), NULL,
      '0b570000-0000-4000-8000-000000000001', 0.5, 8) WHERE content LIKE 'operator two%'),
  0, 'another operator''s tenant-less memory is not recalled');
SELECT is(
  (SELECT count(*)::int FROM public.match_paige_owner_memory((SELECT v FROM probe), NULL,
      '0b570000-0000-4000-8000-000000000003', 0.5, 8)),
  0, 'a NULL tenant does not reach a user''s in-tenant memory');
SELECT results_eq(
  $$SELECT content FROM public.match_paige_owner_memory((SELECT v FROM probe),
      '0b570000-0000-4000-8000-00000000a001', '0b570000-0000-4000-8000-000000000003', 0.5, 8)$$,
  $$VALUES ('owner, in tenant'::text)$$,
  'in-tenant recall is unchanged');
SELECT is(
  (SELECT count(*)::int FROM public.match_paige_owner_memory((SELECT v FROM probe),
      '0b570000-0000-4000-8000-00000000a001', '0b570000-0000-4000-8000-000000000001', 0.5, 8)),
  0, 'a tenant does not reach an operator''s tenant-less memory');

-- JWT caller: the operator themself, at rest.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"0b570000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT results_eq(
  $$SELECT content FROM public.match_paige_owner_memory((SELECT v FROM probe), NULL,
      '0b570000-0000-4000-8000-000000000001', 0.5, 8)$$,
  $$VALUES ('operator one, no tenant'::text)$$,
  'a signed-in tenant-less operator recalls their own memory');
SELECT throws_ok(
  $$SELECT * FROM public.match_paige_owner_memory((SELECT v FROM probe), NULL,
      '0b570000-0000-4000-8000-000000000002', 0.5, 8)$$,
  'P0001', 'Unauthorized',
  'a signed-in operator cannot ask for another operator''s memory');
SELECT throws_ok(
  $$SELECT * FROM public.match_paige_owner_memory((SELECT v FROM probe),
      '0b570000-0000-4000-8000-00000000a001', '0b570000-0000-4000-8000-000000000001', 0.5, 8)$$,
  'P0001', 'Unauthorized',
  'a signed-in operator at rest cannot name a tenant to recall from');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
