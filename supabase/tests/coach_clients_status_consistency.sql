-- ============================================================================
-- S11 · coach_clients status consistency — behavioural proof for migration
-- 20270426000000_coach_clients_status_consistency.
--
-- For the six policies that migration aligns, an assignment whose status is not
-- 'active' grants nothing, exactly like the other coach_clients-dependent policies;
-- an active assignment still grants what it did. Also proves that reactivating an
-- assignment restores access, which is what lets S2 deactivate instead of delete.
--
-- Synthetic fixtures only (one coach, one active client, one inactive client);
-- asserts counts and refusals, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(9);

-- Production's API-role grants are reproduced in the rebuilt database by the database-contract job
-- (scripts/ci/reproduce-production-grants.mjs), so this proof exercises the policies as production
-- would, with no grants of its own.

DO $$
DECLARE
  _t uuid := 'a1100000-0000-0000-0000-000000000001';
  _coach uuid := 'a1100000-0000-0000-0000-0000000000c1';
  _act uuid := 'a1100000-0000-0000-0000-0000000000a1';
  _inact uuid := 'a1100000-0000-0000-0000-0000000000b1';
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (_coach, 's11-coach@example.test'),
    (_act,   's11-active@example.test'),
    (_inact, 's11-inactive@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features)
  VALUES (_t, 's11-probe', 'S11 Probe', 'active', 'standalone', 'S11', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner)
  VALUES (_t, _coach, 'coach', 'active', false);
  INSERT INTO public.user_roles (user_id, role) VALUES (_coach, 'coach')
  ON CONFLICT DO NOTHING;

  -- A relationship belongs to the tenant that holds the client, so each client is linked there.
  INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, linked_user_id) VALUES
    ('a1100000-0000-0000-0000-00000000c1e1', _t, _coach, 'Active', 'Client', 'S11A-1', _act),
    ('a1100000-0000-0000-0000-00000000c1e2', _t, _coach, 'Inactive', 'Client', 'S11I-1', _inact);
  INSERT INTO public.coach_clients (tenant_id, coach_user_id, client_user_id, status) VALUES
    (_t, _coach, _act, 'active'),
    (_t, _coach, _inact, 'inactive');

  INSERT INTO public.client_goals (user_id, goal_category) VALUES
    (_act, 'other'), (_inact, 'other');
  INSERT INTO public.credit_predictions (user_id, prediction_type, title, description) VALUES
    (_act,   'inquiry_strategy', 's11', 's11'),
    (_inact, 'inquiry_strategy', 's11', 's11');
  INSERT INTO public.funding_application_outcomes
    (user_id, lender_name, product_type, application_date, amount_requested, outcome, recorded_by) VALUES
    (_act,   's11', 's11', current_date, 1, 'pending', _coach),
    (_inact, 's11', 's11', current_date, 1, 'pending', _coach);
  INSERT INTO public.outreach_drafts (client_user_id, outreach_type, generated_content, created_by) VALUES
    (_act,   'client_progress_update', 's11', _coach),
    (_inact, 'client_progress_update', 's11', _coach);
END $$;

-- Assertions: each block runs as the coach; each ok() runs after RESET ROLE.
SELECT set_config('request.jwt.claims',
  '{"sub":"a1100000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);

-- 1. client_goals SELECT
SET LOCAL ROLE authenticated;
DO $$
DECLARE _a int; _i int;
BEGIN
  SELECT count(*) INTO _a FROM public.client_goals WHERE user_id = 'a1100000-0000-0000-0000-0000000000a1';
  SELECT count(*) INTO _i FROM public.client_goals WHERE user_id = 'a1100000-0000-0000-0000-0000000000b1';
  IF _a <> 0 OR _i <> 0 THEN RAISE EXCEPTION 'S11 client_goals SELECT: active=% inactive=% (want 0,0)', _a, _i; END IF;
END $$;
RESET ROLE;
-- Goals carry no business, so no assignment opens them (20270503000000).
SELECT ok(true, 'client_goals SELECT: no assignment opens goals, active or inactive');

-- 2. client_goals UPDATE
SET LOCAL ROLE authenticated;
DO $$
DECLARE _n int;
BEGIN
  UPDATE public.client_goals SET progress_notes = 's11' WHERE user_id = 'a1100000-0000-0000-0000-0000000000b1';
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 0 THEN RAISE EXCEPTION 'S11 client_goals UPDATE: inactive rows updated=% (want 0)', _n; END IF;
  UPDATE public.client_goals SET progress_notes = 's11' WHERE user_id = 'a1100000-0000-0000-0000-0000000000a1';
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 0 THEN RAISE EXCEPTION 'S11 client_goals UPDATE: active rows updated=% (want 0)', _n; END IF;
END $$;
RESET ROLE;
SELECT ok(true, 'client_goals UPDATE: no assignment changes goals, active or inactive');

-- 3. credit_predictions SELECT
SET LOCAL ROLE authenticated;
DO $$
DECLARE _a int; _i int;
BEGIN
  SELECT count(*) INTO _a FROM public.credit_predictions WHERE user_id = 'a1100000-0000-0000-0000-0000000000a1';
  SELECT count(*) INTO _i FROM public.credit_predictions WHERE user_id = 'a1100000-0000-0000-0000-0000000000b1';
  IF _a <> 1 OR _i <> 0 THEN RAISE EXCEPTION 'S11 credit_predictions SELECT: active=% inactive=% (want 1,0)', _a, _i; END IF;
END $$;
RESET ROLE;
SELECT ok(true, 'credit_predictions SELECT: active assignment visible, inactive not');

-- 4. funding_application_outcomes SELECT
SET LOCAL ROLE authenticated;
DO $$
DECLARE _a int; _i int;
BEGIN
  SELECT count(*) INTO _a FROM public.funding_application_outcomes WHERE user_id = 'a1100000-0000-0000-0000-0000000000a1';
  SELECT count(*) INTO _i FROM public.funding_application_outcomes WHERE user_id = 'a1100000-0000-0000-0000-0000000000b1';
  IF _a <> 1 OR _i <> 0 THEN RAISE EXCEPTION 'S11 funding_application_outcomes SELECT: active=% inactive=% (want 1,0)', _a, _i; END IF;
END $$;
RESET ROLE;
SELECT ok(true, 'funding_application_outcomes SELECT: active assignment visible, inactive not');

-- 5. funding_application_outcomes INSERT
SET LOCAL ROLE authenticated;
DO $$
DECLARE _refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.funding_application_outcomes
      (user_id, lender_name, product_type, application_date, amount_requested, outcome, recorded_by)
    VALUES ('a1100000-0000-0000-0000-0000000000b1', 's11', 's11', current_date, 1, 'pending', 'a1100000-0000-0000-0000-0000000000c1');
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'S11 funding_application_outcomes INSERT: inactive assignment was not refused'; END IF;
  INSERT INTO public.funding_application_outcomes
    (user_id, lender_name, product_type, application_date, amount_requested, outcome, recorded_by)
  VALUES ('a1100000-0000-0000-0000-0000000000a1', 's11', 's11', current_date, 1, 'pending', 'a1100000-0000-0000-0000-0000000000c1');
END $$;
RESET ROLE;
SELECT ok(true, 'funding_application_outcomes INSERT: active assignment allowed, inactive refused');

-- 6. outreach_drafts SELECT
SET LOCAL ROLE authenticated;
DO $$
DECLARE _a int; _i int;
BEGIN
  SELECT count(*) INTO _a FROM public.outreach_drafts WHERE client_user_id = 'a1100000-0000-0000-0000-0000000000a1';
  SELECT count(*) INTO _i FROM public.outreach_drafts WHERE client_user_id = 'a1100000-0000-0000-0000-0000000000b1';
  IF _a <> 1 OR _i <> 0 THEN RAISE EXCEPTION 'S11 outreach_drafts SELECT: active=% inactive=% (want 1,0)', _a, _i; END IF;
END $$;
RESET ROLE;
SELECT ok(true, 'outreach_drafts SELECT: active assignment visible, inactive not');

-- 7. outreach_drafts INSERT
SET LOCAL ROLE authenticated;
DO $$
DECLARE _refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.outreach_drafts (client_user_id, outreach_type, generated_content, created_by)
    VALUES ('a1100000-0000-0000-0000-0000000000b1', 'client_progress_update', 's11', 'a1100000-0000-0000-0000-0000000000c1');
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'S11 outreach_drafts INSERT: inactive assignment was not refused'; END IF;
  INSERT INTO public.outreach_drafts (client_user_id, outreach_type, generated_content, created_by)
  VALUES ('a1100000-0000-0000-0000-0000000000a1', 'client_progress_update', 's11', 'a1100000-0000-0000-0000-0000000000c1');
END $$;
RESET ROLE;
SELECT ok(true, 'outreach_drafts INSERT: active assignment allowed, inactive refused');

-- 8–9. Reactivation restores access (the property S2's lifecycle trigger relies on).
UPDATE public.coach_clients SET status = 'active'
 WHERE coach_user_id = 'a1100000-0000-0000-0000-0000000000c1'
   AND client_user_id = 'a1100000-0000-0000-0000-0000000000b1';

SET LOCAL ROLE authenticated;
DO $$
DECLARE _i int;
BEGIN
  SELECT count(*) INTO _i FROM public.credit_predictions WHERE user_id = 'a1100000-0000-0000-0000-0000000000b1';
  IF _i <> 1 THEN RAISE EXCEPTION 'S11 reactivation: credit_predictions visible=% (want 1)', _i; END IF;
END $$;
RESET ROLE;
SELECT ok(true, 'reactivating an assignment restores credit_predictions visibility');

SET LOCAL ROLE authenticated;
DO $$
DECLARE _i int;
BEGIN
  SELECT count(*) INTO _i FROM public.outreach_drafts WHERE client_user_id = 'a1100000-0000-0000-0000-0000000000b1';
  IF _i <> 1 THEN RAISE EXCEPTION 'S11 reactivation: outreach_drafts visible=% (want 1)', _i; END IF;
END $$;
RESET ROLE;
SELECT ok(true, 'reactivating an assignment restores outreach_drafts visibility');

SELECT * FROM finish();
ROLLBACK;
