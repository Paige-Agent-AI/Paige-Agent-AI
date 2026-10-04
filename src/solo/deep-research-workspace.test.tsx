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
 *  - the IA: Research sits in the PAIGE workspace (Chat · Knowledge ·
 *    Research · Helpers · Capabilities) and the canonical route registry.
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
  it("no fabricated step states — the chat shows ONE fixed-vocabulary activity label, never per-step progress", () => {
    const chat = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");
    expect(chat).toContain('"Researching the live web"');
    expect(chat).toContain("// §5 of the R2b ruling: ONE truthful activity state (subject + the tool is running)");
    expect(chat).not.toContain("Reading source");
    expect(chat).not.toContain("Comparing sources");
    expect(chat).not.toContain("Checking contradictions");
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

  it("saved is claimed ONLY from the server's governed readback (§10)", () => {
    const chat = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");
    expect(chat).toContain("// R2b §10 — the governed readback: never claim a saved run without proving");
    expect(chat).toContain('supabaseClient.rpc("get_workspace_research_run"');
    expect(chat).toContain("drSaved = !!drReadback");
  });

  it("the card's saved/not-saved verdict is the readback's, never assumed", () => {
    const card = readFileSync(join(root, "src/components/paige/chat/PaigeResearchCard.tsx"), "utf8");
    expect(card).toContain("Saved to this workspace's research library");
    expect(card).toContain("Not saved — the run could not be confirmed in this workspace");
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

  it("the library exposes NO research form — Chat is the only entry (the reshape)", () => {
    expect(view).not.toContain("Start research");
    expect(view).not.toContain("dr-start");
    expect(view).not.toContain("max searches");
    expect(view).not.toContain("max reads");
  });
});

describe("the truthful empty state (ruling §3/§14)", () => {
  it("no seeded runs — the honest invitation points to Chat", () => {
    expect(view).toContain("No saved research yet");
    expect(view).toContain("Ask PAIGE in Chat");
    expect(view).toContain("research this deeply");
  });

  it("the deliberate error states are distinct (not 'something went wrong')", () => {
    // R2b: the library no longer RUNS research (the start flow and its failure
    // vocabulary — engine_unreachable/search_unconfigured/workspace_changed/
    // not_signed_in — went with it; Chat owns execution now). What remains honest
    // here: the two real read failures (list + detail), each with its own words and
    // a retry, and the engine's own outcome vocabulary on saved runs — an
    // unconfigured run still says so through its stop reason, never a guess.
    expect(view).toContain("Research history could not be loaded.");
    expect(view).toContain("That research could not be opened.");
    expect(view).toContain("Retry");
    expect(view).toContain("Search not configured");
    expect(view).not.toContain("Something went wrong");
    expect(view).not.toContain("engine_unreachable");
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
  it("Research (the library tab, R2b) sits in the PAIGE workspace between Knowledge and Helpers", () => {
    expect(workspace).toContain('{ id: "research", label: "Research", icon: Telescope }');
    const tabLine = workspace.slice(workspace.indexOf("const TABS"), workspace.indexOf("];", workspace.indexOf("const TABS")));
    expect(tabLine.indexOf('"knowledge"')).toBeLessThan(tabLine.indexOf('"research"'));
    expect(tabLine.indexOf('"research"')).toBeLessThan(tabLine.indexOf('"helpers"'));
  });

  it("the canonical route registry carries the research subtab", () => {
    expect(routes).toContain('{ slug: "research", key: "research", label: "Research" }');
  });

  it("the panel mounts with server-derived tenant scope", () => {
    expect(workspace).toContain('<ResearchView activeTenantId={activeTenantId} />');
  });
});
