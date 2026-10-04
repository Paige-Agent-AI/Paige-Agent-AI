-- M0 — RESEARCH TENANT LINEAGE (Deep Research R0 ruling, owner-authorized 2026-10-03
-- WITH THE LINEAGE CORRECTIONS: explicit lineage at creation time; NO historical backfill —
-- production holds ZERO rows in research_runs/research_sources, so there is nothing to
-- backfill and no ownership is ever inferred from "first membership").
--
-- WHAT THIS CHANGES (and deliberately does not):
--   ADDs    tenant/workspace lineage to research records: research_runs.tenant_id and
--           research_sources.tenant_id, both NOT NULL with canonical FK lineage. The ENGINE
--           resolves the exact acting tenant server-side and persists it; sources inherit the
--           parent run's tenant (never independently resolved again).
--   REPLACES the legacy cross-tenant 'has_role(admin)' policies with tenant-BOUND policies:
--           authority follows the CANONICAL tenant model (current_user_tenant_id() active-
--           workspace resolver + has_tenant_role owner/admin/member semantics) — the platform's
--           Owner/Admin/Member taxonomy is INHERITED, not redesigned (owner correction #2).
--   ADDs    the minimum governed read RPCs R1 needs (list/get) — SECURITY DEFINER, tenant
--           derived inside the function from the caller's identity, never a parameter.
--   KEEPS   the service-role policies (the engine's write boundary) and the client-self-view
--           SELECT policies (a portal client sees only runs saved to their own profile —
--           self-only, no cross-tenant reach).
--
-- NOT NULL DEPLOY-ORDER NOTE (the fail-closed sequence the ruling requires): production has
-- 0 rows, so ADD COLUMN ... NOT NULL applies cleanly. The currently-DEPLOYED engine inserts
-- WITHOUT tenant_id; between this migration's apply and the engine update's deploy (both in
-- the same merge cycle: deploy-migrations then deploy-edge-functions), any persisted run is
-- REFUSED by the NOT NULL constraint — exactly the ruling's required behavior: "the platform
-- must not persist a run under guessed tenant ownership." Research execution itself is
-- unaffected; only persistence fails closed. No nullable tenant_id is introduced permanently.
--
-- STALE-COMMENT CORRECTION (ruling §7): paige-deep-research's header says persistence is
-- "RLS declared for direct client reads" — production grants prove direct client reads were
-- never usable (table grants are owner-only). The engine's comment is corrected in the same
-- PR as this migration; history is not rewritten.

-- ── 1. Lineage columns ──────────────────────────────────────────────────────────────────
ALTER TABLE public.research_runs
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES public.tenants(id);

ALTER TABLE public.research_sources
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES public.tenants(id);

CREATE INDEX IF NOT EXISTS research_runs_tenant_idx
  ON public.research_runs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_sources_tenant_idx
  ON public.research_sources(tenant_id, run_id);

COMMENT ON COLUMN public.research_runs.tenant_id IS
 'The exact workspace this research run belongs to, resolved SERVER-SIDE by the engine at creation (user JWT → current_user_tenant_id; service-role caller → profiles.active_tenant_id of the validated acting user). Ambiguous lineage refuses persistence (fail-closed) — never a guessed membership. Sources inherit this value verbatim.';
COMMENT ON COLUMN public.research_sources.tenant_id IS
 'Inherited VERBATIM from the parent run''s tenant_id — never independently resolved (one lineage per run).';

-- ── 2. Policies: replace the legacy cross-tenant admin-all shape with tenant-bound shape ──
-- Defense-in-depth: authenticated holds NO table grants (the read path is the governed RPC
-- below), so these policies are the correct shape should grants ever be added — the old
-- cross-tenant 'has_role(admin)' policies are gone regardless (ruling: do not leave them
-- effective).
DROP POLICY IF EXISTS "Admins can manage all research runs" ON public.research_runs;
DROP POLICY IF EXISTS "Admins can manage all research sources" ON public.research_sources;

-- Active-workspace members can VIEW their workspace's research (canonical resolver pins the
-- tenant: a user operating workspace B never sees workspace A's rows, and switching the
-- active workspace switches the scope).
CREATE POLICY "Workspace members can view research runs" ON public.research_runs
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id());
CREATE POLICY "Workspace members can view research sources" ON public.research_sources
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id());

-- Workspace OWNERS and ADMINS manage their own workspace's research — the canonical
-- Owner/Admin/Member semantics, bound to the tenant (a tenant-A admin is not a tenant-B
-- admin; multiple owners remain valid by has_tenant_role's owner semantics).
CREATE POLICY "Workspace owners and admins can manage research runs" ON public.research_runs
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND (
      public.has_tenant_role(auth.uid(), public.current_user_tenant_id(), 'owner')
      OR public.has_tenant_role(auth.uid(), public.current_user_tenant_id(), 'admin')
    )
  );
CREATE POLICY "Workspace owners and admins can manage research sources" ON public.research_sources
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND (
      public.has_tenant_role(auth.uid(), public.current_user_tenant_id(), 'owner')
      OR public.has_tenant_role(auth.uid(), public.current_user_tenant_id(), 'admin')
    )
  );

-- ── 3. Governed read RPCs (R1's canonical path; the base tables stay un-granted) ────────
CREATE OR REPLACE FUNCTION public.list_workspace_research(
  _limit int DEFAULT 20,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  question text,
  domain text,
  caller text,
  stop_reason text,
  configured boolean,
  is_dossier boolean,
  source_count bigint,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  WITH caller_tenant AS (
    SELECT public.current_user_tenant_id() AS tenant_id
  )
  SELECT r.id, r.question, r.domain, r.caller, r.stop_reason, r.configured,
         (r.entity_profile IS NOT NULL) AS is_dossier,
         (SELECT count(*) FROM public.research_sources s WHERE s.run_id = r.id) AS source_count,
         r.created_at
  FROM public.research_runs r, caller_tenant c
  WHERE c.tenant_id IS NOT NULL
    AND r.tenant_id = c.tenant_id
  ORDER BY r.created_at DESC
  OFFSET GREATEST(COALESCE(_offset, 0), 0)
  LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50)
$$;

-- One run + its sources, or a uniform NULL for anything the caller cannot see (unknown and
-- foreign are indistinguishable — no cross-tenant oracle). A caller-supplied tenant id is
-- not a parameter of this function and cannot widen it.
CREATE OR REPLACE FUNCTION public.get_workspace_research_run(
  _run_id uuid
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT CASE WHEN r.id IS NULL THEN NULL ELSE
    jsonb_build_object(
      'id', r.id,
      'question', r.question,
      'domain', r.domain,
      'caller', r.caller,
      'stop_reason', r.stop_reason,
      'configured', r.configured,
      'findings', r.findings,
      'coverage', r.coverage,
      'entity_profile', r.entity_profile,
      'created_at', r.created_at,
      'sources', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'index', s.source_index, 'url', s.url, 'title', s.title, 'snippet', s.snippet,
          'reliability_score', s.reliability_score, 'tier', s.tier, 'reliability', s.reliability,
          'published_at', s.published_at, 'fetched_at', s.fetched_at, 'excluded', s.excluded
        ) ORDER BY s.source_index)
        FROM public.research_sources s WHERE s.run_id = r.id
      ), '[]'::jsonb)
    )
  END
  FROM public.research_runs r
  WHERE r.id = _run_id
    AND r.tenant_id = public.current_user_tenant_id()
$$;

REVOKE ALL ON FUNCTION public.list_workspace_research(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_workspace_research(int, int) TO authenticated;
REVOKE ALL ON FUNCTION public.get_workspace_research_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_research_run(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_workspace_research(int, int) IS
 'R1 read path: the ACTIVE workspace''s research runs, newest first, bounded 1..50. Tenant scope derives from the caller inside the function (current_user_tenant_id) — never a parameter. No base-table grants accompany it.';
COMMENT ON FUNCTION public.get_workspace_research_run(uuid) IS
 'One research run with its sources, visible only inside the run''s own workspace (uniform NULL otherwise — unknown and foreign are indistinguishable). Sources carry the run''s inherited tenant lineage.';
