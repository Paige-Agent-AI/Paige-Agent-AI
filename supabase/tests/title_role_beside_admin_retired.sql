-- ============================================================================
-- The retired title role grants nothing where it sat beside the admin branch.
--
-- Proves: outside the finance tables no policy reads the platform-wide `coach` role; a member holding
-- it, even with an assignment, reads none of the business's messages, threads, conversations or the
-- client's goals, and cannot change or create them or assign staff; an assigned member reads their
-- client's conversations through the assignment plus membership of the business, and only read; goals
-- carry no business, so an assignment reads none.
--
-- Synthetic fixtures only. Asserts counts, catalog facts and refusals, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(13);

-- Production grants `authenticated` these privileges; a schema replayed from migrations does not.
GRANT SELECT, INSERT, UPDATE ON public.messages, public.threads, public.paige_conversations,
  public.client_goals, public.paige_suppressions, public.paige_coach_assignments TO authenticated;
GRANT SELECT ON public.clients, public.coach_clients TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_id(), public.has_role(uuid, public.app_role),
  public.has_any_role(uuid, text[]), public.is_assigned_to_client(uuid, uuid, text),
  public.is_platform_owner(), public.is_platform_owner(uuid), public.is_tenant_member(uuid)
TO authenticated;

DO $$
DECLARE
  _a uuid := 'b7710000-0000-0000-0000-00000000000a';
  _b uuid := 'b7710000-0000-0000-0000-00000000000b';
  _m uuid := 'b7710000-0000-0000-0000-0000000000a1';  -- member of A, assigned to X; no platform role
  _g uuid := 'b7710000-0000-0000-0000-0000000000a2';  -- member of A holding the retired global coach role
  _y uuid := 'b7710000-0000-0000-0000-000000000e01';  -- the person X is, a client of A
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (_m, 'trr-member@example.test'), (_g, 'trr-titled@example.test'),
    (_y, 'trr-client-a@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
    (_a, 'trr-scope-a', 'TRR Scope A', 'active', 'standalone', 'TRA', '{}'),
    (_b, 'trr-scope-b', 'TRR Scope B', 'active', 'standalone', 'TRB', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
    (_a, _m, 'member', 'active', false),
    (_a, _g, 'member', 'active', false);
  INSERT INTO public.user_roles (user_id, role) VALUES (_g, 'coach') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (user_id, active_tenant_id) VALUES (_m, _a), (_g, _a)
  ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
  -- X: a client of A assigned to M. U: a client of A assigned to nobody. W: a client of B assigned to M.
  INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, linked_user_id, assigned_coach_user_id) VALUES
    ('b7710000-0000-0000-0000-00000000c1e1', _a, _m, 'X', 'Client', 'TRX-1', _y, _m),
    ('b7710000-0000-0000-0000-00000000c1e3', _a, _m, 'U', 'Client', 'TRU-1', NULL, NULL),
    ('b7710000-0000-0000-0000-00000000c1e2', _b, _m, 'W', 'Client', 'TRW-1', NULL, _m);
  -- Assigning X to M records M's relationship with Y itself; G's is recorded here.
  INSERT INTO public.coach_clients (coach_user_id, client_user_id, tenant_id, status) VALUES
    (_g, _y, _a, 'active');
  -- G also holds an active assignment to X (as its lead owner), which the retired role used to open.
  INSERT INTO public.paige_coach_assignments (tenant_id, contact_id, rep_user_id, assigned_role, active) VALUES
    (_a, 'b7710000-0000-0000-0000-00000000c1e1', _g, 'lead_owner', true);
  INSERT INTO public.paige_conversations (id, tenant_id, contact_id, channel, direction, body) VALUES
    ('b7710000-0000-0000-0000-00000000c001', _a, 'b7710000-0000-0000-0000-00000000c1e1', 'email', 'inbound', 'TRR x'),
    ('b7710000-0000-0000-0000-00000000c003', _a, 'b7710000-0000-0000-0000-00000000c1e3', 'email', 'inbound', 'TRR u'),
    ('b7710000-0000-0000-0000-00000000c002', _b, 'b7710000-0000-0000-0000-00000000c1e2', 'email', 'inbound', 'TRR w');
  INSERT INTO public.client_goals (id, user_id, goal_category) VALUES
    ('b7710000-0000-0000-0000-00000000f001', _y, 'other');
  -- A message takes its business from the client it concerns, and records its thread itself.
  INSERT INTO public.messages (id, contact_id, thread_key, channel_type, direction) VALUES
    ('b7710000-0000-0000-0000-00000000e001', 'b7710000-0000-0000-0000-00000000c1e1', 'trr-thread', 'email', 'inbound');
END $$;

-- 1. No policy outside the finance tables reads the retired role.
SELECT is((SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
            WHERE c.relname NOT IN ('banking_relationships', 'credit_predictions', 'credit_report_personal_info',
                                    'funding_application_outcomes', 'funding_journey_applications',
                                    'funding_milestones', 'funding_secured', 'lender_research_results',
                                    'outreach_drafts', 'business_certifications')
              AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
                  ~ 'has_role\(auth\.uid\(\), ''coach''::app_role\)|has_any_role\(auth\.uid\(\), ARRAY\[[^]]*''coach''::text'),
  0, 'no policy outside the finance tables reads the retired coach role');

-- Counts are read as each person, stored, then asserted after RESET ROLE.
SELECT set_config('request.jwt.claims', '{"sub":"b7710000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE _n int;
BEGIN
  PERFORM set_config('trr.g_messages', (SELECT count(*) FROM public.messages WHERE id = 'b7710000-0000-0000-0000-00000000e001')::text, true);
  PERFORM set_config('trr.g_threads', (SELECT count(*) FROM public.threads WHERE thread_key = 'trr-thread')::text, true);
  PERFORM set_config('trr.g_conv', (SELECT count(*) FROM public.paige_conversations WHERE id = 'b7710000-0000-0000-0000-00000000c001')::text, true);
  PERFORM set_config('trr.g_goal', (SELECT count(*) FROM public.client_goals WHERE id = 'b7710000-0000-0000-0000-00000000f001')::text, true);
  UPDATE public.paige_conversations SET subject = 'TRR changed' WHERE id = 'b7710000-0000-0000-0000-00000000c001';
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('trr.g_conv_updated', _n::text, true);
  UPDATE public.client_goals SET goal_description = 'TRR changed' WHERE id = 'b7710000-0000-0000-0000-00000000f001';
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('trr.g_goal_updated', _n::text, true);
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"b7710000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('trr.m_conv_x', (SELECT count(*) FROM public.paige_conversations WHERE id = 'b7710000-0000-0000-0000-00000000c001')::text, true);
  PERFORM set_config('trr.m_conv_u', (SELECT count(*) FROM public.paige_conversations WHERE id = 'b7710000-0000-0000-0000-00000000c003')::text, true);
  PERFORM set_config('trr.m_conv_w', (SELECT count(*) FROM public.paige_conversations WHERE id = 'b7710000-0000-0000-0000-00000000c002')::text, true);
  PERFORM set_config('trr.m_goal', (SELECT count(*) FROM public.client_goals WHERE id = 'b7710000-0000-0000-0000-00000000f001')::text, true);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- 2-7. The retired role, even with an assignment to the client, opens and changes nothing.
SELECT is(current_setting('trr.g_messages')::int, 0, 'the retired coach role does not open the business''s messages');
SELECT is(current_setting('trr.g_threads')::int, 0, 'the retired coach role does not open the business''s threads');
SELECT is(current_setting('trr.g_conv')::int, 0, 'the retired coach role does not open an assigned client''s conversations');
SELECT is(current_setting('trr.g_goal')::int, 0, 'the retired coach role does not open an assigned client''s goals');
SELECT is(current_setting('trr.g_conv_updated')::int, 0, 'the retired coach role does not let a person change a client''s conversations');
SELECT is(current_setting('trr.g_goal_updated')::int, 0, 'the retired coach role does not let a person change a client''s goals');

-- 8-9. Nor create a conversation for the client, or assign staff.
SELECT set_config('request.jwt.claims', '{"sub":"b7710000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.paige_conversations (tenant_id, contact_id, channel, direction, body)
    VALUES ('b7710000-0000-0000-0000-00000000000a', 'b7710000-0000-0000-0000-00000000c1e1', 'email', 'outbound', 'TRR new')$$,
  '42501', NULL, 'the retired coach role does not let a person create a conversation for a client');
SELECT throws_ok(
  $$INSERT INTO public.paige_coach_assignments (tenant_id, contact_id, rep_user_id, active)
    VALUES ('b7710000-0000-0000-0000-00000000000a', 'b7710000-0000-0000-0000-00000000c1e3',
            'b7710000-0000-0000-0000-0000000000a2', true)$$,
  '42501', NULL, 'the retired coach role does not let a person assign staff');
RESET ROLE;

-- 10. The assignment plus membership of the business gives read access to the client's conversations.
SELECT is(current_setting('trr.m_conv_x')::int, 1, 'an assigned member reads the conversations of the client they are assigned');

-- 11-13. Regression guards: an unassigned client of the business; an assigned client of a business the
--        person does not belong to; goals, which carry no business and so are not opened by an assignment.
SELECT is(current_setting('trr.m_conv_u')::int, 0, 'an assigned member does not read the conversations of a client they are not assigned');
SELECT is(current_setting('trr.m_conv_w')::int, 0,
  'an assignment to a client of a business the person does not belong to grants nothing');
SELECT is(current_setting('trr.m_goal')::int, 0, 'an assignment does not open a client''s goals, which carry no business');

SELECT * FROM finish();
ROLLBACK;
