-- EXP08 Team Hub: every NEW Solo account gets the same Team Hub, whichever door created it.
--
-- Owner ruling (2026-10-28, ANT-161): every Solo account, existing and future, has the same Team Hub
-- experience. ANT-21 holds the same rule for the whole Solo product. Team Hub keeps no per-account
-- copy of anything, so parity comes from three structural facts, and this proof pins each one:
--   1. Every Solo producer (public signup, the paid-path primitive, the operator console and the
--      platform promotional grant) leaves an owner who passes every Team Hub door: list, a DM with
--      PAIGE and each of the six specialists, a new channel and a first message.
--   2. Team conversations is on by default for a seat (tenant_members.team_hub_access DEFAULT true).
--   3. The six specialists are platform rows (tenant_id IS NULL) with a stored personality, which is
--      the only row the agent turn reads (_shared/team-hub/agent-turn.ts: .is("tenant_id", null)).
-- The negative cases prove the doors are not vacuous: a seat with Team conversations off, an archived
-- seat and a non-Solo account are each refused with their own code.
--
-- Runs in the database-contract job against the schema `db reset` replayed from zero, beside
-- canonical_solo_provisioning.sql. Synthetic people and ids only; always rolled back.
BEGIN;
SELECT plan(21);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('e8a00000-0000-4000-8000-000000000001','authenticated','authenticated','e8-public@tests.invalid'),
  ('e8a00000-0000-4000-8000-000000000002','authenticated','authenticated','e8-paid@tests.invalid'),
  ('e8a00000-0000-4000-8000-000000000003','authenticated','authenticated','e8-operator@tests.invalid'),
  ('e8a00000-0000-4000-8000-000000000004','authenticated','authenticated','e8-op-owner@tests.invalid'),
  ('e8a00000-0000-4000-8000-000000000005','authenticated','authenticated','e8-promo@tests.invalid'),
  ('e8a00000-0000-4000-8000-000000000006','authenticated','authenticated','e8-agency@tests.invalid');
-- No JWT yet, so this is the trusted setup context the §53 operator-role trigger allows.
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e8a00000-0000-4000-8000-000000000003','super_admin'),
  ('e8a00000-0000-4000-8000-000000000005','user');
INSERT INTO public.legal_documents (slug, version, title, body_md, is_current)
VALUES ('saas-standalone', 1, 'EXP08 parity probe agreement', '# Probe agreement body', true)
ON CONFLICT DO NOTHING;

-- Which door made which account. A schema of its own (rolled back with everything else), so the
-- checks below can read it under the authenticated role.
CREATE SCHEMA e8_probe;
GRANT USAGE ON SCHEMA e8_probe TO authenticated;
CREATE TABLE e8_probe.made(door text PRIMARY KEY, owner_id uuid NOT NULL, tenant_id uuid);
GRANT SELECT ON e8_probe.made TO authenticated;

-- Door 1: public signup (provision_tenant), under the new owner's own JWT.
DO $$
DECLARE _u uuid := 'e8a00000-0000-4000-8000-000000000001'; _t public.tenants;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  INSERT INTO public.legal_acceptances (user_id, document_slug, document_version, context)
  VALUES (_u, 'saas-standalone', 1, jsonb_build_object('via', 'exp08-parity-probe')) ON CONFLICT DO NOTHING;
  SELECT * INTO _t FROM public.provision_tenant('E8 Public Co', NULL, NULL, NULL, 'standalone', 'saas-standalone', 1);
  INSERT INTO e8_probe.made VALUES ('public', _u, _t.id);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- Door 2: the paid-path primitive (provision_tenant_as).
DO $$
DECLARE _u uuid := 'e8a00000-0000-4000-8000-000000000002'; _t public.tenants;
BEGIN
  SELECT * INTO _t FROM public.provision_tenant_as(_u, 'E8 Paid Co', 'standalone');
  INSERT INTO e8_probe.made VALUES ('paid', _u, _t.id);
END $$;

-- Door 3: the operator console (operator_provision_tenant), called by a super_admin for a named owner.
DO $$
DECLARE _op uuid := 'e8a00000-0000-4000-8000-000000000003'; _u uuid := 'e8a00000-0000-4000-8000-000000000004';
  _t public.tenants;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _op, 'role', 'authenticated')::text, true);
  SELECT * INTO _t FROM public.operator_provision_tenant('E8 Operator Co', NULL, _u);
  INSERT INTO e8_probe.made VALUES ('operator', _u, _t.id);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- Door 4: the platform promotional grant, entered by the service role for a proven platform owner.
CREATE TABLE e8_probe.promo(tenant_id uuid);
GRANT USAGE ON SCHEMA e8_probe TO service_role;
GRANT INSERT ON e8_probe.promo TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO e8_probe.promo SELECT tenant_id FROM public.platform_grant_promotional_solo(
  'e8a00000-0000-4000-8000-000000000003', 'e8a00000-0000-4000-8000-000000000005',
  'E8 Promotional Co', 'Promo Proof', 'exp08 parity probe');
RESET ROLE;
INSERT INTO e8_probe.made SELECT 'promotional', 'e8a00000-0000-4000-8000-000000000005', tenant_id FROM e8_probe.promo;

SELECT is((SELECT count(*)::int FROM e8_probe.made m JOIN public.tenants t ON t.id = m.tenant_id
            WHERE t.account_type = 'standalone' AND t.parent_tenant_id IS NULL), 4,
  'all four Solo doors made a top-level standalone account');

-- The checks, run as each new owner exactly as the browser calls them.
CREATE FUNCTION e8_probe.act_as(p_door text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT owner_id FROM e8_probe.made WHERE door = p_door), 'role', 'authenticated')::text, true);
END $$;
CREATE FUNCTION e8_probe.tenant(p_door text) RETURNS uuid LANGUAGE sql AS $$
  SELECT tenant_id FROM e8_probe.made WHERE door = p_door $$;
CREATE FUNCTION e8_probe.agent_dms_ok(p_door text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM unnest(ARRAY['paige','vera','nexus','cura','mentor','merit','zion']) k
   WHERE (public.team_hub_open_agent_dm(e8_probe.tenant(p_door), k) ->> 'ok')::boolean $$;
CREATE FUNCTION e8_probe.first_message_ok(p_door text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE ch jsonb;
BEGIN
  ch := public.team_hub_create_channel(e8_probe.tenant(p_door), 'daily-management', 'team', '{}'::uuid[], gen_random_uuid());
  IF NOT coalesce((ch ->> 'ok')::boolean, false) THEN RETURN false; END IF;
  RETURN coalesce((public.team_hub_post_message(e8_probe.tenant(p_door), (ch ->> 'channel_id')::uuid,
    'Good morning, team', gen_random_uuid()) ->> 'ok')::boolean, false);
END $$;

SELECT e8_probe.act_as('public');
SET LOCAL ROLE authenticated;
SELECT is(public.team_hub_list_conversations(e8_probe.tenant('public')) ->> 'ok', 'true', 'public signup: Team Hub opens');
SELECT is(e8_probe.agent_dms_ok('public'), 7, 'public signup: a DM opens with PAIGE and each of the six specialists');
SELECT ok(e8_probe.first_message_ok('public'), 'public signup: a channel is created and the first message posts');
RESET ROLE;

SELECT e8_probe.act_as('paid');
SET LOCAL ROLE authenticated;
SELECT is(public.team_hub_list_conversations(e8_probe.tenant('paid')) ->> 'ok', 'true', 'paid path: Team Hub opens');
SELECT is(e8_probe.agent_dms_ok('paid'), 7, 'paid path: a DM opens with PAIGE and each of the six specialists');
SELECT ok(e8_probe.first_message_ok('paid'), 'paid path: a channel is created and the first message posts');
RESET ROLE;

SELECT e8_probe.act_as('operator');
SET LOCAL ROLE authenticated;
SELECT is(public.team_hub_list_conversations(e8_probe.tenant('operator')) ->> 'ok', 'true', 'operator console: Team Hub opens for the named owner');
SELECT is(e8_probe.agent_dms_ok('operator'), 7, 'operator console: a DM opens with PAIGE and each of the six specialists');
SELECT ok(e8_probe.first_message_ok('operator'), 'operator console: a channel is created and the first message posts');
RESET ROLE;

SELECT e8_probe.act_as('promotional');
SET LOCAL ROLE authenticated;
SELECT is(public.team_hub_list_conversations(e8_probe.tenant('promotional')) ->> 'ok', 'true', 'promotional grant: Team Hub opens');
SELECT is(e8_probe.agent_dms_ok('promotional'), 7, 'promotional grant: a DM opens with PAIGE and each of the six specialists');
SELECT ok(e8_probe.first_message_ok('promotional'), 'promotional grant: a channel is created and the first message posts');
RESET ROLE;

-- Structural facts the experience depends on.
SELECT is((SELECT column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tenant_members' AND column_name = 'team_hub_access'),
  'true', 'Team conversations is on by default for every new seat');
SELECT is((SELECT count(*)::int FROM e8_probe.made m JOIN public.tenant_members tm
             ON tm.tenant_id = m.tenant_id AND tm.user_id = m.owner_id
            WHERE tm.status = 'active' AND tm.team_hub_access AND tm.is_owner), 4,
  'every door left an active owner seat with Team conversations on');
SELECT is((SELECT count(*)::int FROM public.paige_subagents
            WHERE tenant_id IS NULL AND slug IN ('vera','nexus','cura','mentor','merit','zion')
              AND config ? 'personality'), 6,
  'the six specialists are platform rows with a stored personality, shared by every account');
SELECT is((SELECT count(*)::int FROM public.paige_subagents
            WHERE tenant_id IS NOT NULL AND slug IN ('vera','nexus','cura','mentor','merit','zion')), 0,
  'no account carries its own copy of a specialist');

-- The doors are not vacuous: each refusal names its own reason.
UPDATE public.tenant_members SET team_hub_access = false
 WHERE tenant_id = e8_probe.tenant('paid') AND user_id = 'e8a00000-0000-4000-8000-000000000002';
SELECT e8_probe.act_as('paid');
SET LOCAL ROLE authenticated;
SELECT is(public.team_hub_list_conversations(e8_probe.tenant('paid')) ->> 'code', 'conversations_off',
  'negative: a seat with Team conversations off is refused');
SELECT is(public.team_hub_open_agent_dm(e8_probe.tenant('paid'), 'paige') ->> 'code', 'conversations_off',
  'negative: and cannot open an agent DM');
RESET ROLE;

UPDATE public.tenant_members SET status = 'archived'
 WHERE tenant_id = e8_probe.tenant('operator') AND user_id = 'e8a00000-0000-4000-8000-000000000004';
SELECT e8_probe.act_as('operator');
SET LOCAL ROLE authenticated;
SELECT is(public.team_hub_list_conversations(e8_probe.tenant('operator')) ->> 'code', 'not_member',
  'negative: an archived seat is refused');
RESET ROLE;

-- A non-Solo account is outside this experience by rule (§61), so its owner is refused as unavailable.
DO $$
DECLARE _u uuid := 'e8a00000-0000-4000-8000-000000000006'; _t public.tenants;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);  -- setup, not the previous owner's session
  INSERT INTO public.tenants (slug, name, account_type) VALUES ('e8-agency-probe', 'E8 Agency Probe', 'agency') RETURNING * INTO _t;
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES (_t.id, _u, 'owner', 'active', true, now());
  INSERT INTO e8_probe.made VALUES ('agency', _u, _t.id);
END $$;
SELECT e8_probe.act_as('agency');
SET LOCAL ROLE authenticated;
SELECT is(public.team_hub_list_conversations(e8_probe.tenant('agency')) ->> 'code', 'unavailable',
  'negative: an Agency account is not given the Solo Team Hub');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
