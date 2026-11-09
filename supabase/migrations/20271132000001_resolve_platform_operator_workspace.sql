-- ============================================================================
-- resolve_platform_operator_workspace() — the missing resolver (incident fix)
-- ============================================================================
-- WHAT
--   Creates the ONE platform-owner workspace resolver that
--   20271131000002_social_platform_grant_ops.sql (and the paige-social
--   platform-owner fallback) call — but which that migration never created.
--   Every caller failed at runtime with "function ... does not exist", which
--   the console rendered as "Workspace grants could not be read. Try again."
--   and the edge surfaced as SOCIAL_TENANT_UNRESOLVED.
--
-- WHY THIS SHAPE (aligns with the platform's existing convention, §10 config-as-data)
--   The designated operator workspace is a DATA WRITE, not a constant: the
--   `admin_app_settings` key `platform_operator_tenant_id` (provisioned by
--   20260913000000_platform_operator_workspace_tenant.sql and read by
--   supabase/functions/_shared/platform-operator-tenant.ts). This SQL resolver
--   reads the SAME key so the console's direct PostgREST calls resolve exactly
--   like the edge helper: format-validated, never an implicit cast, fail closed.
--
-- FAIL CLOSED, ALWAYS (§9)
--   Zero rows unless ALL hold:
--     * the caller is the platform owner (is_super_admin() — auth.uid()-based;
--       anon, service-role and every other signed-in account get zero rows), and
--     * the setting exists, is a well-formed UUID, and matches a tenant row.
--   Never throws on a malformed setting: the regex gate drops the row instead.
--
-- NOTE ON WHY CI DID NOT CATCH THE ORIGINAL GAP
--   Supabase applies migrations with plpgsql body checking off, so a CREATE
--   FUNCTION whose body references a missing function commits cleanly and only
--   fails at first CALL. The contract test pins this resolver's CREATE
--   (src/__tests__/social-connection-security-contract.test.ts) so a
--   reference-without-create can never ship again.

create or replace function public.resolve_platform_operator_workspace()
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path to ''
as $fn$
  select t.id, t.name, t.slug
  from public.tenants t
  join public.admin_app_settings s
    on s.key = 'platform_operator_tenant_id'
   and lower(s.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and t.id::text = lower(s.value #>> '{}')
  where public.is_super_admin()
$fn$;

comment on function public.resolve_platform_operator_workspace() is
  'Platform-owner-only resolver for the ONE designated operator workspace (admin_app_settings key platform_operator_tenant_id). Zero rows for every other caller; fail closed.';

-- Tight execute surface: the console's authenticated callers only. God-path
-- service callers keep using _shared/platform-operator-tenant.ts.
revoke execute on function public.resolve_platform_operator_workspace() from public, anon;
grant execute on function public.resolve_platform_operator_workspace() to authenticated;
