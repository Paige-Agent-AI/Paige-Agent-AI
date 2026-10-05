/**
 * M0 — the Deep Research tenant-lineage contract (owner ruling 2026-10-03, with the lineage
 * corrections). The SQL-side proof (matrix A–J's database halves) lives in
 * supabase/tests/research_tenant_lineage.sql; THIS suite pins the ENGINE-side lineage logic
 * and the migration's load-bearing shape against the real source:
 *  - persistence lineage is STRICT: the JWT path pins via current_user_tenant_id; the
 *    service-role path uses profiles.active_tenant_id ONLY for lineage (the first-membership
 *    fallback remains for strategize CONTEXT but NEVER persists);
 *  - ambiguous lineage FAILS CLOSED FOR PERSISTENCE (the run's result still returns);
 *  - the optional expected_tenant_id is a CROSS-CHECK (a mismatch skips persistence) — never
 *    the persisted value, never authority;
 *  - sources inherit the parent run's lineage VERBATIM;
 *  - the stale "RLS declared for direct client reads" comment is corrected, not rewritten;
 *  - the migration: tenant_id NOT NULL on both tables (no nullable-by-convenience escape),
 *    the legacy cross-tenant admin-all policies replaced by tenant-bound shapes, the
 *    service-role write boundary preserved, and the governed read RPCs take no tenant
 *    parameter.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const engine = readFileSync(join(root, "supabase/functions/paige-deep-research/index.ts"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20270545000000_research_tenant_lineage.sql"), "utf8");
const pgTAP = readFileSync(join(root, "supabase/tests/research_tenant_lineage.sql"), "utf8");

describe("the engine's persistence lineage is strict (fail-closed)", () => {
  it("two resolutions with different strictness are declared", () => {
    expect(engine).toContain("// TWO resolutions with different strictness (M0):");
    expect(engine).toContain("let lineageTenantId: string | null = null;");
  });

  it("the service path derives lineage from active_tenant_id ONLY — no first-membership fallback", () => {
    expect(engine).toContain("const activeTid = (prof?.active_tenant_id as string | null) ?? null;");
    expect(engine).toContain("lineageTenantId = activeTid && UUID_RE.test(activeTid) ? activeTid : null;");
    // The first-membership fallback follows the lineage assignment and feeds ONLY the
    // strategize/tracing resolution, never persistence.
    const lineageIdx = engine.indexOf("lineageTenantId = activeTid && UUID_RE.test(activeTid)");
    const fallbackIdx = engine.indexOf("if (!tid) {", lineageIdx);
    expect(fallbackIdx).toBeGreaterThan(lineageIdx);
    expect(engine).toContain("AMBIGUOUS ownership and the run is NOT persisted");
  });

  it("persistRun refuses ambiguous lineage — the honest skip, result still returned", () => {
    expect(engine).toContain("M0 FAIL-CLOSED FOR PERSISTENCE: without unambiguous tenant lineage the run is NOT");
    expect(engine).toContain("persistence skipped: tenant lineage unresolved/ambiguous (M0 fail-closed; the run's result is still returned)");
  });

  it("persistRun writes tenant_id on the run and sources inherit it VERBATIM", () => {
    // Exactly two writes carry the lineage: the run insert AND the sources insert.
    expect(engine.match(/tenant_id: tenantId,/g)?.length).toBe(2);
    expect(engine).toContain("// Sources inherit the parent run's lineage VERBATIM — never independently resolved.");
  });

  it("all three persist call sites carry the lineage argument", () => {
    // R3: the trailing dossier arg is optional diagnostics — the lineage contract is the 6 required args.
    expect(engine.match(/persistRun\(SUPABASE_URL, SERVICE_KEY, runId, body, result, lineageTenantId(?:, dossier)?\)/g)?.length).toBe(3);
    expect(engine).not.toContain("persistRun(SUPABASE_URL, SERVICE_KEY, runId, body, result);");
  });

  it("the JWT path is exact by construction (lineage = the RLS-pinned resolver)", () => {
    expect(engine).toContain("// The JWT path is exact by construction (RLS-pinned resolver) — lineage = resolved.");
  });
});

describe("the expected_tenant_id cross-check never grants authority", () => {
  it("a disagreement is treated as ambiguity — persistence skipped, never resolved in the caller's favor", () => {
    expect(engine).toContain("M0 CROSS-CHECK: an upstream expected_tenant_id is honored only when it AGREES");
    expect(engine).toContain("persistence skipped: upstream expected_tenant_id disagrees with the server-resolved lineage");
    expect(engine).toContain("the persisted value and never authority");
  });

  it("the field is optional and documented as a cross-check only", () => {
    expect(engine).toContain("expected_tenant_id?: string;");
    expect(engine).toContain("CROSS-CHECK (never authority)");
  });
});

describe("the migration carries the load-bearing shape", () => {
  it("tenant_id is NOT NULL on both tables — no nullable-by-convenience escape", () => {
    expect(migration.match(/ADD COLUMN tenant_id uuid NOT NULL REFERENCES public\.tenants\(id\);/g)?.length).toBe(2);
  });

  it("the legacy cross-tenant admin-all policies are dropped, tenant-bound shapes replace them", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Admins can manage all research runs"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Admins can manage all research sources"');
    expect(migration).toContain('"Workspace members can view research runs"');
    expect(migration).toContain("tenant_id = public.current_user_tenant_id()");
    expect(migration).toContain("public.has_tenant_role(auth.uid(), public.current_user_tenant_id(), 'owner')");
  });

  it("the service-role write boundary is preserved (not redesigned)", () => {
    expect(migration).not.toContain('DROP POLICY IF EXISTS "Service role can manage all research runs"');
    expect(migration).not.toContain('DROP POLICY IF EXISTS "Service role can manage all research sources"');
  });

  it("the deploy-order fail-closed sequence is documented, and zero rows mean no backfill", () => {
    expect(migration).toContain("NOT NULL DEPLOY-ORDER NOTE");
    expect(migration).toContain("REFUSED by the NOT NULL constraint");
    expect(migration).toContain("No nullable tenant_id is introduced permanently");
    expect(migration).toContain("NO historical backfill");
    expect(migration).not.toContain("UPDATE public.research_runs SET tenant_id");
  });

  it("the governed read RPCs take NO tenant parameter and grant to authenticated only", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.list_workspace_research(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_workspace_research_run(");
    expect(migration).not.toContain("_tenant_id uuid");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.list_workspace_research(int, int) FROM PUBLIC, anon;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.list_workspace_research(int, int) TO authenticated;");
  });

  it("the stale engine comment is corrected in-place, history preserved", () => {
    expect(engine).toContain("CORRECTION 2026-10-03, M0");
    expect(engine).toContain("direct client reads were never usable");
  });
});

describe("the pgTAP matrix is wired into the spine contract workflow", () => {
  it("the test file asserts the ruling's scenarios", () => {
    expect(pgTAP).toContain("B: tenant-B member lists ONLY tenant B''s own run");
    expect(pgTAP).toContain("C: tenant-B ADMIN still gets NULL for tenant A''s run");
    expect(pgTAP).toContain("D: the dual member (active=B) reads B''s run");
    expect(pgTAP).toContain("E: after switching the active workspace to A");
    expect(pgTAP).toContain("G: an insert WITHOUT tenant lineage is refused");
    expect(pgTAP).toContain("H: neither read RPC accepts a tenant parameter");
  });

  it("the workflow runs it (both the paths filter and the run list)", () => {
    const wf = readFileSync(join(root, ".github/workflows/paige-spine-contract.yml"), "utf8");
    expect(wf).toContain("supabase/tests/research_tenant_lineage.sql");
    expect(wf.match(/supabase test db supabase\/tests\/research_tenant_lineage\.sql/g)?.length).toBeGreaterThanOrEqual(1);
  });
});
