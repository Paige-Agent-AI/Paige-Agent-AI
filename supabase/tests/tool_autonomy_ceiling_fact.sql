-- ============================================================================
-- Migration A (Vibe Studio V0) — repeatable proof for
--   20270539000000_tool_autonomy_ceiling_fact.sql
--
-- What it proves, against the REAL migration applied with \ir (twice: clean + replay):
--   1. EQUIVALENCE — resolve_tool_autonomy returns exactly what the previous canonical body
--      returned (copied verbatim below as _ref_previous_resolve) for every rung × tenant setting ×
--      caller × tool combination. The refactor moved the logic; it changed no answer.
--   2. THE NEW FACT — resolve_tool_autonomy_detail.mode always equals resolve_tool_autonomy, and
--      ceiling_allows_auto is true ONLY at effective rung 2+ for a resolved tenant and a normal
--      tool; rung 0/1, an unresolved tenant, a null tool and social_post all answer false (fail
--      closed). This is the fact the Studio lift requires; at rung 1 it must be false even when the
--      tenant's own setting is a plain `confirm` (the clamp branch never fires there — the bypass).
--   3. TENANT SCOPE — a signed-in non-operator who names another tenant still resolves their own.
--   4. GRANTS — the internal resolver is executable by no API role; the two readers by
--      authenticated + service_role only (never anon); trust_effective_rung gains no grant.
--
-- IDIOM: supabase/tests/calendar_link_shareable.sql — isolated database, synthetic fixtures only
-- (§63), stubs for the platform helpers the function reads, controlled through session settings.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'tool_autonomy_ceiling_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated tool_autonomy_ceiling_contract database (got %)', current_database();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

-- ── Faithful minimal schema + helper stubs (driven by session settings) ──────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS public.tenant_tool_autonomy (
  tenant_id uuid NOT NULL, tool_key text NOT NULL, mode text NOT NULL,
  updated_at timestamptz DEFAULT now(), PRIMARY KEY (tenant_id, tool_key));

CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.owner', true), ''), 'false')::boolean $$;
CREATE OR REPLACE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.caller_tenant', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.trust_effective_rung() RETURNS int LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.rung', true), '')::int $$;
REVOKE ALL ON FUNCTION public.trust_effective_rung() FROM PUBLIC, anon, authenticated, service_role;

-- The previous canonical body (20270122000000_social_foundation_tenant_recovery.sql), verbatim,
-- under a reference name. It exists only so equivalence is measured, not asserted.
CREATE OR REPLACE FUNCTION public._ref_previous_resolve(_tenant_id uuid, _tool_key text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  _caller uuid:=auth.uid();
  _tenant uuid:=_tenant_id;
  _mode text;
  _rung int;
begin
  if _tool_key='social_post' then return 'off'; end if;
  if _caller is not null and not public.is_platform_owner() then
    _tenant:=public.current_user_tenant_id();
  end if;
  if _caller is not null and public.is_platform_owner() and _tenant_id is not null then
    _tenant:=_tenant_id;
  end if;
  if _tenant is null or _tool_key is null then return 'confirm'; end if;
  select mode into _mode from public.tenant_tool_autonomy
  where tenant_id=_tenant and tool_key=_tool_key;
  _mode:=coalesce(_mode,'confirm');
  _rung:=public.trust_effective_rung();
  if _rung <= 0 then return 'off'; end if;
  if _rung <= 1 and _mode='auto' then return 'confirm'; end if;
  return _mode;
end $$;

-- ── The REAL migration, twice (clean application + replay) ───────────────────────────────────────
\ir ../migrations/20270539000000_tool_autonomy_ceiling_fact.sql
\ir ../migrations/20270539000000_tool_autonomy_ceiling_fact.sql

-- ── Synthetic tenants: T_AUTO set auto, T_CONF set confirm, T_OFF set off, T_NONE no row ──────────
INSERT INTO public.tenant_tool_autonomy (tenant_id, tool_key, mode) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'growth_page_save', 'auto'),
  ('00000000-0000-4000-8000-0000000000a2', 'growth_page_save', 'confirm'),
  ('00000000-0000-4000-8000-0000000000a3', 'growth_page_save', 'off')
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE _checks (n serial, ok boolean, what text);

-- ── 1 + 2 + 3: the full matrix ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  _rung text; _tenant uuid; _tool text; _caller text;
  _ref text; _new text; _detail jsonb; _resolved boolean; _expect_allow boolean;
  _tenants uuid[] := ARRAY[
    '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2',
    '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4', NULL]::uuid[];
BEGIN
  FOREACH _rung IN ARRAY ARRAY['0','1','2','3',''] LOOP
    FOREACH _caller IN ARRAY ARRAY['service','owner','member_other','member_null'] LOOP
      FOREACH _tool IN ARRAY ARRAY['growth_page_save','social_post',NULL] LOOP
        FOR i IN 1..array_length(_tenants, 1) LOOP
          _tenant := _tenants[i];
          PERFORM set_config('test.rung', _rung, true);
          -- service: no auth.uid(); owner: signed-in operator; member_*: signed-in member of a1.
          PERFORM set_config('test.uid', CASE WHEN _caller = 'service' THEN '' ELSE '00000000-0000-4000-8000-00000000beef' END, true);
          PERFORM set_config('test.owner', CASE WHEN _caller = 'owner' THEN 'true' ELSE 'false' END, true);
          PERFORM set_config('test.caller_tenant',
            CASE WHEN _caller = 'member_other' THEN '00000000-0000-4000-8000-0000000000a1'
                 WHEN _caller = 'member_null' THEN '' ELSE '' END, true);
          _ref := public._ref_previous_resolve(_tenant, _tool);
          _new := public.resolve_tool_autonomy(_tenant, _tool);
          _detail := public.resolve_tool_autonomy_detail(_tenant, _tool);
          INSERT INTO _checks (ok, what) VALUES
            (_ref IS NOT DISTINCT FROM _new, format('equivalence rung=%s caller=%s tool=%s tenant=%s ref=%s new=%s', _rung, _caller, _tool, _tenant, _ref, _new)),
            (_detail->>'mode' IS NOT DISTINCT FROM _new, format('detail.mode = mode rung=%s caller=%s tool=%s tenant=%s', _rung, _caller, _tool, _tenant)),
            (jsonb_typeof(_detail->'ceiling_allows_auto') = 'boolean', 'ceiling_allows_auto is a boolean');
          -- Which tenant did the canonical path resolve? (service/owner: the one passed; member: their own.)
          _resolved := CASE
            WHEN _caller IN ('service','owner') THEN _tenant IS NOT NULL
            WHEN _caller = 'member_other' THEN true
            ELSE false END;
          _expect_allow := _tool = 'growth_page_save' AND _resolved AND _rung IN ('2','3');
          INSERT INTO _checks (ok, what) VALUES
            ((_detail->>'ceiling_allows_auto')::boolean = coalesce(_expect_allow, false),
             format('ceiling_allows_auto rung=%s caller=%s tool=%s tenant=%s got=%s', _rung, _caller, _tool, _tenant, _detail->>'ceiling_allows_auto'));
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- The bypass case, named: rung 1, a tenant whose own setting is plain confirm. The mode is confirm
-- either way; the only thing that may stop a lift to auto is the new fact, and it must be false.
DO $$ BEGIN
  PERFORM set_config('test.rung', '1', true);
  PERFORM set_config('test.uid', '', true);
  INSERT INTO _checks (ok, what) VALUES
    ((public.resolve_tool_autonomy_detail('00000000-0000-4000-8000-0000000000a2', 'growth_page_save')->>'ceiling_allows_auto')::boolean = false,
     'rung 1 + tenant confirm: the ceiling does not allow auto'),
    ((public.resolve_tool_autonomy_detail('00000000-0000-4000-8000-0000000000a4', 'growth_page_save')->>'ceiling_allows_auto')::boolean = false,
     'rung 1 + no tenant row (default confirm): the ceiling does not allow auto');
  PERFORM set_config('test.rung', '2', true);
  INSERT INTO _checks (ok, what) VALUES
    ((public.resolve_tool_autonomy_detail('00000000-0000-4000-8000-0000000000a2', 'growth_page_save')->>'ceiling_allows_auto')::boolean = true,
     'rung 2 + tenant confirm: the ceiling allows auto (the lift may apply)');
  -- Tenant scope: a member of a1 naming a3 (off) still resolves a1 (auto).
  PERFORM set_config('test.uid', '00000000-0000-4000-8000-00000000beef', true);
  PERFORM set_config('test.owner', 'false', true);
  PERFORM set_config('test.caller_tenant', '00000000-0000-4000-8000-0000000000a1', true);
  INSERT INTO _checks (ok, what) VALUES
    (public.resolve_tool_autonomy_detail('00000000-0000-4000-8000-0000000000a3', 'growth_page_save')->>'mode' = 'auto',
     'a member naming another tenant resolves their own tenant');
END $$;

-- ── 4: grants ─────────────────────────────────────────────────────────────────────────────────────
INSERT INTO _checks (ok, what) VALUES
  (NOT has_function_privilege('anon',          'public._tool_autonomy_resolution(uuid,text)', 'EXECUTE'), 'internal resolver: anon denied'),
  (NOT has_function_privilege('authenticated', 'public._tool_autonomy_resolution(uuid,text)', 'EXECUTE'), 'internal resolver: authenticated denied'),
  (NOT has_function_privilege('service_role',  'public._tool_autonomy_resolution(uuid,text)', 'EXECUTE'), 'internal resolver: service_role denied'),
  (NOT has_function_privilege('anon',          'public.resolve_tool_autonomy_detail(uuid,text)', 'EXECUTE'), 'detail: anon denied'),
  (    has_function_privilege('authenticated', 'public.resolve_tool_autonomy_detail(uuid,text)', 'EXECUTE'), 'detail: authenticated allowed'),
  (    has_function_privilege('service_role',  'public.resolve_tool_autonomy_detail(uuid,text)', 'EXECUTE'), 'detail: service_role allowed'),
  (NOT has_function_privilege('anon',          'public.resolve_tool_autonomy(uuid,text)', 'EXECUTE'), 'mode: anon denied'),
  (    has_function_privilege('authenticated', 'public.resolve_tool_autonomy(uuid,text)', 'EXECUTE'), 'mode: authenticated allowed'),
  (    has_function_privilege('service_role',  'public.resolve_tool_autonomy(uuid,text)', 'EXECUTE'), 'mode: service_role allowed'),
  (NOT has_function_privilege('service_role',  'public.trust_effective_rung()', 'EXECUTE'), 'trust_effective_rung: still no service_role grant'),
  (NOT has_function_privilege('authenticated', 'public.trust_effective_rung()', 'EXECUTE'), 'trust_effective_rung: still no authenticated grant');

-- A live refusal, not only the catalogue: anon cannot call the detail reader.
DO $$ BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.resolve_tool_autonomy_detail(NULL, 'growth_page_save');
    RESET ROLE;
    INSERT INTO _checks (ok, what) VALUES (false, 'anon call to the detail reader was not refused');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _checks (ok, what) VALUES (true, 'anon call to the detail reader refused (42501)');
  END;
END $$;

-- ── Verdict: every check must pass, and the matrix must actually have run ─────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT what INTO _first FROM _checks WHERE NOT ok ORDER BY n LIMIT 1;
  IF _total < 1200 THEN RAISE EXCEPTION 'only % checks ran — the matrix did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION '% of % checks failed; first: %', _bad, _total, _first; END IF;
  RAISE NOTICE 'tool_autonomy_ceiling_fact: % checks passed', _total;
END $$;
