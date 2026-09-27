-- ============================================================================
-- The retired title role grants nothing on the consumer-finance records.
--
-- Proves: no policy anywhere reads the platform-wide `coach` role; a person holding it, even with an
-- active assignment to the client, reads none of the client's funding secured, journey applications or
-- outreach drafts, cannot change a journey application, cannot create an outreach draft, and cannot
-- delete a credit report upload; the business's owner still reads the client's funding secured (a guard
-- that the fixture reaches the row at all).
--
-- Synthetic fixtures only. Asserts counts, catalog facts and refusals, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(8);

-- Production grants `authenticated` these privileges; a schema replayed from migrations does not.
GRANT SELECT, INSERT, UPDATE ON public.funding_secured, public.funding_journey_applications,
  public.outreach_drafts TO authenticated;
GRANT SELECT ON public.clients, public.coach_clients, public.tenant_members TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role), public.tenant_staff_owns_user(uuid, uuid),
  public.delete_credit_report_upload(uuid, uuid) TO authenticated;

DO $$
DECLARE
  _a uuid := 'c9930000-0000-0000-0000-00000000000a';
  _o uuid := 'c9930000-0000-0000-0000-0000000000a1';  -- owner of A
  _g uuid := 'c9930000-0000-0000-0000-0000000000a2';  -- member of A holding the retired global coach role
  _y uuid := 'c9930000-0000-0000-0000-000000000e01';  -- the person client X is, a client of A
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (_o, 'trf-owner@example.test'), (_g, 'trf-titled@example.test'), (_y, 'trf-client@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
    (_a, 'trf-scope-a', 'TRF Scope A', 'active', 'standalone', 'TFA', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
    (_a, _o, 'owner', 'active', true),
    (_a, _g, 'member', 'active', false);
  INSERT INTO public.user_roles (user_id, role) VALUES (_g, 'coach') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (user_id, active_tenant_id) VALUES (_o, _a), (_g, _a)
  ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
  INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, linked_user_id) VALUES
    ('c9930000-0000-0000-0000-00000000c1e1', _a, _o, 'X', 'Client', 'TFX-1', _y);
  -- G's active assignment to the client, which the retired role used to open.
  INSERT INTO public.coach_clients (coach_user_id, client_user_id, tenant_id, status) VALUES
    (_g, _y, _a, 'active');
  INSERT INTO public.funding_secured (id, user_id, client_user_id, lender_name, product_type) VALUES
    ('c9930000-0000-0000-0000-00000000f501', _y, _y, 'TRF lender', 'line');
  INSERT INTO public.funding_journey_applications (id, user_id, lender_name) VALUES
    ('c9930000-0000-0000-0000-00000000f601', _y, 'TRF lender');
  INSERT INTO public.outreach_drafts (id, client_user_id, outreach_type, generated_content, created_by) VALUES
    ('c9930000-0000-0000-0000-00000000f701', _y, 'client_progress_update', 'TRF draft', _o);
END $$;

-- 1. No policy anywhere reads the retired role.
SELECT is((SELECT coalesce(string_agg(c.relnamespace::regnamespace::text || '.' || c.relname || ': ' || p.polname, '; ' ORDER BY 1), '')
            FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
            WHERE (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
                  ~ 'has_role\(auth\.uid\(\), ''coach''::(public\.)?app_role\)|has_any_role\(auth\.uid\(\), ARRAY\[[^]]*''coach''::text'),
  '', 'no policy reads the retired coach role');

-- Counts are read as each person, stored, then asserted after RESET ROLE.
SELECT set_config('request.jwt.claims', '{"sub":"c9930000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE _n int;
BEGIN
  PERFORM set_config('trf.g_secured', (SELECT count(*) FROM public.funding_secured WHERE id = 'c9930000-0000-0000-0000-00000000f501')::text, true);
  PERFORM set_config('trf.g_journey', (SELECT count(*) FROM public.funding_journey_applications WHERE id = 'c9930000-0000-0000-0000-00000000f601')::text, true);
  PERFORM set_config('trf.g_drafts', (SELECT count(*) FROM public.outreach_drafts WHERE id = 'c9930000-0000-0000-0000-00000000f701')::text, true);
  UPDATE public.funding_journey_applications SET lender_name = 'TRF changed' WHERE id = 'c9930000-0000-0000-0000-00000000f601';
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('trf.g_journey_updated', _n::text, true);
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"c9930000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('trf.o_secured', (SELECT count(*) FROM public.funding_secured WHERE id = 'c9930000-0000-0000-0000-00000000f501')::text, true);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- 2-5. The retired role, even with an assignment to the client, opens and changes nothing.
SELECT is(current_setting('trf.g_secured')::int, 0, 'the retired coach role does not open an assigned client''s funding secured');
SELECT is(current_setting('trf.g_journey')::int, 0, 'the retired coach role does not open an assigned client''s journey applications');
SELECT is(current_setting('trf.g_drafts')::int, 0, 'the retired coach role does not open an assigned client''s outreach drafts');
SELECT is(current_setting('trf.g_journey_updated')::int, 0, 'the retired coach role does not let a person change a journey application');

-- 6-7. Nor create an outreach draft, or delete a credit report upload.
SELECT set_config('request.jwt.claims', '{"sub":"c9930000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.outreach_drafts (client_user_id, outreach_type, generated_content, created_by)
    VALUES ('c9930000-0000-0000-0000-000000000e01', 'client_progress_update', 'TRF new', 'c9930000-0000-0000-0000-0000000000a2')$$,
  '42501', NULL, 'the retired coach role does not let a person create an outreach draft for a client');
SELECT throws_ok(
  $$SELECT public.delete_credit_report_upload('c9930000-0000-0000-0000-00000000f801', 'c9930000-0000-0000-0000-0000000000a2')$$,
  '42501', NULL, 'the retired coach role does not let a person delete a credit report upload');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- 8. Guard: the business's owner reads the client's funding secured, so the fixture reaches the row.
SELECT is(current_setting('trf.o_secured')::int, 1, 'the business owner reads the client''s funding secured');

SELECT * FROM finish();
ROLLBACK;
