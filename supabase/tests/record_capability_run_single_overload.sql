-- =============================================================================
-- There must be exactly ONE public.record_capability_run.
--
-- WHY THIS TEST EXISTS. 20270107000000 added four optional trailing parameters
-- to `record_capability_run` and described the change as "backward compatible —
-- existing grants and callers unchanged." It was not. `create or replace
-- function` cannot replace across a differing argument list, so it created a
-- SECOND function, and no DROP was ever issued. Both have defaults past the
-- fifth parameter, so a five-argument call satisfies both and Postgres refuses
-- it: 42725, "function is not unique".
--
-- That is not a theoretical hazard. All three service-role PostgREST callers
-- send exactly five named arguments — `_shared/mcp-gateway/rail-receipt.ts:66`,
-- `_shared/mcp-outcome.ts:851`, `_shared/n8n-management.ts:145` — and each one
-- swallows the failure into a `console.error`, because a Rail write is
-- best-effort and must never turn a completed action into a reported failure.
-- Correct instinct; it is also what kept a total filing failure invisible for
-- months. 20270411090000 dropped the six-argument overload.
--
-- WHAT THIS GUARDS, AND WHY IT IS A COUNT. A future field will be wanted on
-- this function, and the tempting way to add one is another `create or replace`
-- with a longer signature — which silently recreates the exact defect. Counting
-- the overloads catches that on the next migration rather than on the next
-- outage. A new field belongs on the SURVIVING signature, as one more trailing
-- default.
--
-- It also asserts the call ITSELF resolves, not merely that one function
-- exists: `PREPARE` parses and plans without executing, so the assertion runs
-- the real resolution the edge callers depend on, and writes nothing.
-- =============================================================================

DO $$
DECLARE
  _n int;
  _sigs text;
BEGIN
  SELECT count(*), string_agg(p.oid::regprocedure::text, ' | ' ORDER BY p.pronargs)
    INTO _n, _sigs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_capability_run';

  IF _n <> 1 THEN
    RAISE EXCEPTION
      'record_capability_run has % definitions, not 1. Every five-argument call — which is what all three service-role edge callers send — becomes 42725 "function is not unique" and is swallowed into a console.error, so the Rail silently files nothing. Add a new field as a trailing DEFAULT on the existing signature; never as a second overload. Found: %',
      _n, _sigs;
  END IF;
END $$;

-- The five named arguments `rail-receipt.ts`, `mcp-outcome.ts` and
-- `n8n-management.ts` actually send. PREPARE plans it; nothing is executed and
-- no Rail row is written.
DO $$
BEGIN
  EXECUTE 'PREPARE _rcr_five_named AS SELECT public.record_capability_run('
       || '_tenant_id => $1::uuid, _actor_id => $2::uuid, _capability_key => $3::text, '
       || '_outcome => $4::text, _run_id => $5::uuid)';
  EXECUTE 'DEALLOCATE _rcr_five_named';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION
    'the five-named-argument call every service-role caller makes does not resolve: % %', SQLSTATE, SQLERRM;
END $$;

-- The two in-database callers (execute_crm_command, execute_crm_command_reversible)
-- pass TEN positional arguments. They resolved before the drop and must still.
DO $$
BEGIN
  EXECUTE 'PREPARE _rcr_ten_positional AS SELECT public.record_capability_run('
       || '$1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,null,null,null,null,$6::jsonb)';
  EXECUTE 'DEALLOCATE _rcr_ten_positional';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION
    'the ten-positional call execute_crm_command makes no longer resolves: % %', SQLSTATE, SQLERRM;
END $$;

-- Still service-role only, still SECURITY DEFINER. The drop removed a duplicate;
-- it must not have widened who may file a Rail receipt (§9/§59).
DO $$
DECLARE _acl text; _secdef boolean;
BEGIN
  SELECT coalesce(array_to_string(p.proacl::text[], ' | '), '(default)'), p.prosecdef
    INTO _acl, _secdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_capability_run';

  IF NOT _secdef THEN
    RAISE EXCEPTION 'record_capability_run is no longer SECURITY DEFINER';
  END IF;
  IF _acl ~ '\manon=' OR _acl ~ 'authenticated=' THEN
    RAISE EXCEPTION '§9: record_capability_run is reachable by anon/authenticated: %', _acl;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'RECORD_CAPABILITY_RUN_SINGLE_OVERLOAD_PROVEN'; END $$;
