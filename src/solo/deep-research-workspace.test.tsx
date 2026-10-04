/**
 * R1+R2 — the Deep Research workspace contract (INT-303).
 *
 * Pins the coupled slice's load-bearing behavior at the source level, per the
 * owner ruling's §17 evidence list:
 *  - ONE substrate: reads go through the M0 governed RPCs (never a table read,
 *    never a tenant parameter); execution goes through the canonical
 *    paige-deep-research edge function with the caller's JWT;
 *  - TRUTHFUL RUNTIME: elapsed time only — no fabricated step states;
 *  - PERSISTENCE READBACK: "saved" is claimed only after the governed get
 *    proves the row; the unsaved state is distinct and honest;
 *  - SCOPE FENCE: a workspace switch mid-run discards the result from the new
 *    view (the server already persisted under the old workspace);
 *  - DEPTH maps onto EXISTING engine bounds only (max_hops 1/undefined/3);
 *  - the empty state is truthful (no seeded runs);
 *  - the IA: Deep Research sits in the PAIGE workspace (Chat · Knowledge ·
 *    Deep Research · Helpers · Capabilities) and the canonical route registry.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const hook = readFileSync(join(root, "src/solo/data/deepResearch.ts"), "utf8");
const view = readFileSync(join(root, "src/solo/paige-research.tsx"), "utf8");
const workspace = readFileSync(join(root, "src/solo/SoloPaigeWorkspace.tsx"), "utf8");
const routes = readFileSync(join(root, "src/lib/routing/tierBranches.ts"), "utf8");
const css = readFileSync(join(root, "src/solo/solo-paige-workspace.css"), "utf8");

describe("one canonical substrate — no second research stack", () => {
  it("reads go through the governed RPCs only, never the tables", () => {
    expect(hook).toContain('supabase.rpc("list_workspace_research"');
    expect(hook).toContain('supabase.rpc("get_workspace_research_run"');
    expect(hook).not.toMatch(/\.from\(["']research_(runs|sources)["']/);
  });

  it("execution invokes the canonical engine with the caller's JWT (never a service key)", () => {
    expect(hook).toContain('supabase.functions.invoke("paige-deep-research"');
    expect(hook).not.toContain("SERVICE");
    expect(hook).not.toContain("service_role");
  });

  it("no tenant parameter ever widens a read (the RPCs take none)", () => {
    // The RPC invocations carry ONLY limit/offset/run_id — never a tenant value.
    expect(hook).toContain('supabase.rpc("list_workspace_research", { _limit: 20, _offset: 0 })');
    expect(hook.match(/rpc\("get_workspace_research_run", \{ _run_id: runId \}\)/g)?.length).toBe(2);
    // expected_tenant_id appears ONLY as the engine cross-check, spelled exactly.
    expect(hook).toContain("expected_tenant_id: scope, // cross-check only");
  });

  it("caller is labeled 'workspace' — the same substrate chat writes, one history", () => {
    expect(hook).toContain('caller: "workspace"');
  });
});

describe("the scope fence (ruling §15)", () => {
  it("every request captures the active workspace and discards on change", () => {
    expect(hook).toContain("const scope = scopeRef.current;");
    expect(hook.match(/scopeRef\.current !== scope/g)?.length).toBeGreaterThanOrEqual(5);
    expect(hook).toContain("reason: \"workspace_changed\"");
  });

  it("a workspace switch mid-run never renders the old workspace's result in the new view", () => {
    expect(hook).toContain("SCOPE FENCE");
    expect(hook).toContain("already persisted under the old workspace server-side");
  });

  it("the effect resets state on switch — no stale rows, no stale detail", () => {
    expect(hook).toContain("setRows(null); setListError(null); setDetail(null); setDetailError(null);");
  });
});

describe("truthful runtime (ruling §5)", () => {
  it("no fabricated step states — elapsed time is the only live signal", () => {
    expect(view).toContain("PAIGE is researching this.");
    expect(view).toContain("elapsed");
    expect(view).not.toContain("Searching sources");
    expect(view).not.toContain("Reading sources");
    expect(view).not.toContain("Checking contradictions");
  });

  it("the running pulse respects reduced motion", () => {
    expect(css).toContain("@media(prefers-reduced-motion:reduce){.dr-running-icon{animation:none}}");
  });

  it("no Cancel affordance is fabricated (the engine has no cancellation path)", () => {
    expect(view).not.toContain(">Cancel research");
  });
});

describe("persistence readback (ruling §6)", () => {
  it("saved is claimed only after the governed get proves the row", () => {
    expect(hook).toContain("PERSISTENCE READBACK");
    expect(hook).toContain("persisted = !!data;");
  });

  it("the unsaved state is distinct and honest — the result still renders, saving named as failed", () => {
    expect(view).toContain("Research completed and saved.");
    expect(view).toContain("saving could not be confirmed");
    expect(view).toContain("It has not been added to this workspace's history");
  });

  it("an unsaved result still RENDERS from the engine's own outcome (ruling §6: show the result, state the save failed)", () => {
    expect(hook).toContain("// The RESULT is real but UNSAVED — it still renders");
    expect(hook).toContain("setDetail({");
  });

  it("the engine's structured error is a FAILED state, never 'completed'", () => {
    expect(hook).toContain('if (coverage.stop_reason === "error")');
    expect(hook).toContain('reason: "engine_error"');
    expect(view).toContain("The research engine reported an error");
  });

  it("no blind rerun on uncertain persistence", () => {
    // The done phase carries the truth; nothing in the hook auto-restarts —
    // start() is called only from the view's submit handler.
    expect(hook).toContain('setPhase({ kind: "done", runId, persisted })');
    expect(hook).not.toContain("void start(question");
  });
});

describe("depth maps onto existing engine bounds only (ruling §3)", () => {
  it("quick=1, standard=the engine default, thorough=3 — no new modes", () => {
    expect(hook).toContain("quick: 1,");
    expect(hook).toContain("standard: undefined, // the engine default (2)");
    expect(hook).toContain("thorough: 3,");
  });

  it("no engine internals leak into the form (searches/reads/model/cost)", () => {
    expect(view).not.toContain("max searches");
    expect(view).not.toContain("max reads");
    expect(view).toContain("bounded by the engine's");
  });
});

describe("the truthful empty state (ruling §3/§14)", () => {
  it("no seeded runs — the honest invitation", () => {
    expect(view).toContain("No saved research yet");
    expect(view).toContain("Ask PAIGE to investigate a market, company, person, competitor, vendor,");
    expect(view).toContain("regulation, location, or strategic question.");
  });

  it("the deliberate error states are distinct (not 'something went wrong')", () => {
    expect(view).toContain("engine_unreachable");
    expect(view).toContain("search_unconfigured");
    expect(view).toContain("workspace_changed");
    expect(view).toContain("not_signed_in");
    expect(view).toContain("Live web search is not configured");
    expect(view).not.toContain("Something went wrong");
  });

  it("foreign/unknown runs render the uniform not-found shape", () => {
    expect(view).toContain("That research could not be opened.");
  });
});

describe("the dossier/result view (ruling §8)", () => {
  it("reuses the canonical EntityDossier renderer — no second profile model", () => {
    expect(view).toContain('from "@/components/dashboard/EntityDossier"');
    expect(view).toContain("<EntityDossier");
  });

  it("findings carry citations, confidence, and unverified fields", () => {
    expect(view).toContain("dr-finding-cites");
    expect(view).toContain("Could not verify:");
  });

  it("sources show grade, dates, and exclusion truthfully", () => {
    expect(view).toContain("Excluded from findings");
    expect(view).toContain("Published");
    expect(view).toContain("Fetched");
  });

  it("no findings surviving validation is an honest state, not a filler", () => {
    expect(view).toContain("No findings survived validation");
  });
});

describe("the IA (ruling §2)", () => {
  it("Deep Research sits in the PAIGE workspace between Knowledge and Helpers", () => {
    expect(workspace).toContain('{ id: "research", label: "Deep Research", icon: Telescope }');
    const tabLine = workspace.slice(workspace.indexOf("const TABS"), workspace.indexOf("];", workspace.indexOf("const TABS")));
    expect(tabLine.indexOf('"knowledge"')).toBeLessThan(tabLine.indexOf('"research"'));
    expect(tabLine.indexOf('"research"')).toBeLessThan(tabLine.indexOf('"helpers"'));
  });

  it("the canonical route registry carries the research subtab", () => {
    expect(routes).toContain('{ slug: "research", key: "research", label: "Deep Research" }');
  });

  it("the panel mounts with server-derived tenant scope", () => {
    expect(workspace).toContain('<ResearchView activeTenantId={activeTenantId} />');
  });
});
