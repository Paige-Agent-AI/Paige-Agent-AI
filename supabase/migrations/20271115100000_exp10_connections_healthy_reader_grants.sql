-- EXP10 PR13 — connections_healthy runner read grants (the §32.c class, found by the live
-- scheduled run 2026-10-26).
--
-- ROOT CAUSE (production evidence, not a staging guess): since the runner shipped (#2707), every
-- scheduled tenant sweep has filed a `connections_healthy` finding with status 'error' and
-- where 'mcp_connections(error)' — the fleet sweep at 2026-10-26 09:00 UTC did so for EVERY
-- tenant. The runner reads three stores through the service-role edge client; two of them —
-- public.mcp_connections and public.tenant_n8n_connections — carry NO service_role grant, so
-- PostgREST refuses the read (an empty-message refusal: the error the runner persisted carried
-- message '' and code null). The local Deno suite mocked the admin client, so the gap was
-- invisible until the first real scheduled execution — the exact defect class §32.c exists to
-- catch: a green proof is not a working runtime.
--
-- This is the SAME defect class and the SAME fix as 20260816160000_systems_check_service_role_grants.sql
-- (L2 hotfix 2026-08-10), whose comment set the rule this migration restores: the grant set must
-- cover EVERY table the runner modules `.from()`. That hotfix enumerated the then-complete set;
-- PR7 added two new read targets without extending the grants. The pin test added beside this
-- migration (supabase/tests/systems_check_runner_read_grants.sql) asserts the complete enumerated
-- set so the NEXT new runner read target fails CI instead of failing the fleet.
--
-- §9/§51 UNCHANGED, PROVABLY: service_role is the trusted server reader the runner core already
-- scopes by tenant_id; it bypasses RLS but still needs table-level GRANTs. Read-only SELECT is
-- minimal privilege — the runner performs head-counts only. authenticated gets NOTHING here (the
-- test asserts authenticated still has no table-level SELECT on either table): customer- and
-- tenant-facing access to these stores continues to flow exclusively through the SECURITY
-- DEFINER doors (list_integration_surface, the gateway actions) exactly as before. No boundary
-- is weakened; a scheduled monitor is made able to read what it was always meant to read.
--
-- Idempotent: GRANT is a no-op if the privilege already exists.

begin;

grant select on public.mcp_connections       to service_role;
grant select on public.tenant_n8n_connections to service_role;

commit;
