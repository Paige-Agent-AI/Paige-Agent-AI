-- E09 F2: the customer's portal read carries its business's finance entitlement.
--
-- One restatement. No table, column, policy, index, trigger or grant is added or widened, and no data
-- changes.
--
-- get_client_portal_config() — the customer's read (and, through client_portal_frame(), the frame's
-- `config`) — additionally returns
--     'entitlements', {'finance': public._tenant_finance_entitled(<the customer's business>)}
-- so the portal can hide funding/credit surfaces for a business that never chose them, from the ONE
-- canonical per-business predicate (F1a, 20271111030000). The body is otherwise the 20271110060000 body
-- verbatim. `entitlements` is concatenated LAST, after `_catalog`, so a key a business once stored under
-- that name in portal_config can never shadow the server's answer.
--
-- _tenant_finance_entitled is granted to service_role only. It is called here inside a SECURITY DEFINER
-- function owned by postgres that has already resolved the caller's own business through
-- client_portal_relationship_id() (open access only; several open relationships refuse), so no caller can
-- name another business (§59): the function takes no parameter.
--
-- get_paige_persona_context() is NOT replaced: its funding_enabled expression is the canonical one
-- (supabase/tests/e09_finance_portal_entitlement.sql pins it).
--
-- Leased against the exact source it replaces (production and the replayed schema agree:
-- md5(prosrc) 442cb01b581349c31910af38db6ddb1b, read 2026-10-19), so a concurrent restatement fails this
-- migration loudly instead of being overwritten.
BEGIN;
DO $source_lease$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.get_client_portal_config()')
      AND md5(p.prosrc)='442cb01b581349c31910af38db6ddb1b'
      AND pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef AND p.provolatile='s'
      AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Customer portal configuration read changed; review before composition'
      USING ERRCODE='42501';
  END IF;
  IF to_regprocedure('public._tenant_finance_entitled(uuid)') IS NULL THEN
    RAISE EXCEPTION 'The canonical finance entitlement (20271111030000) is missing'
      USING ERRCODE='42883';
  END IF;
END $source_lease$;

CREATE OR REPLACE FUNCTION public.get_client_portal_config()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT c.tenant_id AS tid
    FROM public.clients c
    WHERE c.id = public.client_portal_relationship_id()
  )
  SELECT COALESCE(
    (SELECT
       -- Stored presentation first; the server's `_catalog` and `entitlements` LAST, so they always win.
       (CASE WHEN jsonb_typeof(t.features->'portal_config')='object'
             THEN t.features->'portal_config' ELSE '{}'::jsonb END)
       || jsonb_build_object('_catalog', public.portal_menu_catalog(t.features))
       || jsonb_build_object('entitlements', jsonb_build_object('finance', public._tenant_finance_entitled(t.id)))
     FROM public.tenants t
     JOIN me ON me.tid = t.id),
    '{}'::jsonb
  );
$$;
REVOKE ALL ON FUNCTION public.get_client_portal_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_portal_config() TO authenticated;
COMMENT ON FUNCTION public.get_client_portal_config() IS
  'Presentation-only overlay from the canonical active client relationship, plus a server-authored _catalog (starter slug, authored-Playbook usability, portal module key/label list; nothing else from the Playbook) and entitlements.finance (_tenant_finance_entitled of that business). Ambiguous relationships refuse; this overlay never grants module/record authority.';
COMMIT;
