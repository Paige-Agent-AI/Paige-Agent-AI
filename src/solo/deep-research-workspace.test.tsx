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
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const port = vi.hoisted(() => ({
  tenant: "test-tenant-a" as string | null, actor: "test-owner-a" as string | null,
  ready: true, rpc: vi.fn(), invoke: vi.fn(), auth: vi.fn(), requests: [] as Array<{ signal?: AbortSignal }>,
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({
  activeTenantId: port.tenant, activeUserId: port.actor, loading: !port.ready,
  accountContextLoading: !port.ready, accountContextStatus: port.ready ? "ready" : "resolving",
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...args: unknown[]) => {
    const request: { signal?: AbortSignal } = {}; port.requests.push(request);
    const builder = {
      abortSignal: (signal: AbortSignal) => { request.signal = signal; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(() => port.rpc(...args)).then(resolve, reject),
    };
    return builder;
  },
  auth: { getUser: (...args: unknown[]) => port.auth(...args) },
  functions: { invoke: (...args: unknown[]) => port.invoke(...args) },
} }));
import { ResearchView } from "./paige-research";
import { useDeepResearch } from "./data/deepResearch";
import { projectResearchHistoryRun, readResearchHistoryRun } from "@/lib/paigeResearchReadback";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const historyRow = (id = "run-a", question = "Earlier investigation") => ({ id, question, domain: "general", caller: "chat", stop_reason: "max_hops", configured: true, is_dossier: false, source_count: 2, created_at: "2026-01-01T00:00:00Z" });
const completeRun = (id = "run-a", question = "Earlier investigation") => ({
  ...historyRow(id, question), entity_profile: null,
  findings: [{ text: "Grounded historical claim", citations: [7, 2], confidence: "high" }],
  coverage: { note: "Verified one finding", unverified_notes: ["Historic context"], hops_used: 3 },
  sources: [
    { index: 2, url: "https://example.org/two", title: null, snippet: null, reliability_score: 0.8, reliability: null, tier: null, published_at: null, fetched_at: "2026-01-01T00:00:00Z", excluded: false },
    { index: 7, url: "https://example.org/seven", title: "Seventh source", snippet: null, reliability_score: 0.8, reliability: "high", tier: "A", published_at: null, fetched_at: "2026-01-01T00:00:00Z", excluded: false },
  ],
});

describe("actual Research Home governed history projection and display fences", () => {
  let host: HTMLDivElement; let root: Root; let api: ReturnType<typeof useDeepResearch>;
  const render = async (probe = false) => { await act(async () => { root.render(probe ? <Probe /> : <ResearchView activeTenantId={port.tenant} />); await flush(); }); };
  function Probe() { api = useDeepResearch(port.tenant); return <div>{JSON.stringify({ rows: api.rows, detail: api.detail, detailError: api.detailError, listError: api.listError })}</div>; }
  const open = async (id = "run-a") => { await act(async () => { if (api) void api.open(id); else (host.querySelector(`button[aria-label="Open research: Earlier investigation"]`) as HTMLButtonElement).click(); await flush(); }); };
  beforeEach(() => {
    port.tenant = "test-tenant-a"; port.actor = "test-owner-a"; port.ready = true; port.requests = [];
    port.rpc.mockReset().mockImplementation(async (name: string, args: { _run_id?: string }) => ({ data: name === "list_workspace_research" ? [historyRow()] : completeRun(args._run_id), error: null }));
    port.invoke.mockReset(); port.auth.mockReset().mockImplementation(async () => ({ data: { user: { id: port.actor } }, error: null })); api = undefined as unknown as typeof api;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

  it("withholds the observed ten unsupported claims and contradictory coverage while retaining original history metadata", async () => {
    const value = { ...completeRun(), findings: Array.from({ length: 10 }, (_, i) => ({ text: `Unsupported claim ${i}`, citations: [1, 5, 6, 11], confidence: "high" })), sources: [], coverage: { note: "Verified 10 findings from 23 citable sources", hops_used: 3 } };
    port.rpc.mockImplementation(async (name: string) => ({ data: name === "list_workspace_research" ? [historyRow()] : value, error: null }));
    await render(); await open();
    expect(host.textContent).toContain("Earlier investigation");
    expect(host.textContent).toContain("Incomplete evidence");
    expect(host.textContent).not.toContain("Unsupported claim 0");
    expect(host.textContent).not.toContain("Verified 10");
    expect(port.rpc.mock.calls.filter(([name]) => name === "get_workspace_research_run")).toHaveLength(1);
    expect(port.invoke).not.toHaveBeenCalled();
  });
  it("preserves complete citations, nullable public source fields and max_hops without renumbering", async () => {
    await render(); await open();
    expect(host.textContent).toContain("Grounded historical claim");
    expect(host.querySelector(".dr-finding-cites")?.textContent).toContain("[7] Seventh source");
    expect(host.querySelector(".dr-finding-cites")?.textContent).toContain("[2] example.org");
    expect(host.textContent).toContain("Depth reached");
    expect(host.textContent).not.toContain("Incomplete evidence");
    expect(port.invoke).not.toHaveBeenCalled();
  });
  it.each(["missing", "duplicate", "excluded", "malformed", "empty citations"])("withholds incomplete %s evidence instead of claiming validation", async kind => {
    const value = completeRun();
    if (kind === "missing") value.sources.pop();
    if (kind === "duplicate") value.sources[1].index = 2;
    if (kind === "excluded") value.sources[1].excluded = true;
    if (kind === "malformed") value.sources[1].url = "https://";
    if (kind === "empty citations") value.findings[0].citations = [];
    port.rpc.mockImplementation(async (name: string) => ({ data: name === "list_workspace_research" ? [historyRow()] : value, error: null }));
    await render(); await open();
    expect(host.textContent).toContain("Incomplete evidence");
    expect(host.textContent).not.toContain("Grounded historical claim");
    expect(host.textContent).not.toContain("Verified one finding");
    expect(port.invoke).not.toHaveBeenCalled();
  });
  it.each(["null", "foreign id", "error", "throw"])("settles %s without leaking diagnostics or stale detail", async kind => {
    port.rpc.mockImplementation(async (name: string) => {
      if (name === "list_workspace_research") return { data: [historyRow()], error: null };
      if (kind === "throw") throw Error("PRIVATE diagnostic");
      return { data: kind === "null" ? null : completeRun(kind === "foreign id" ? "foreign-run" : "run-a"), error: kind === "error" ? { message: "PRIVATE diagnostic" } : null };
    });
    await render(); await open();
    expect(host.textContent).toContain("That research could not be opened.");
    expect(host.textContent).not.toMatch(/PRIVATE|Grounded historical claim/);
  });
  it.each(["tenant", "actor"])("rejects old %s A→B→A list and detail responses", async boundary => {
    const old = deferred<unknown>();
    await render(true);
    port.rpc.mockReturnValueOnce(old.promise);
    await open();
    const request = port.requests[port.requests.length - 1]!;
    if (boundary === "tenant") port.tenant = "test-tenant-b"; else port.actor = "test-owner-b";
    await render(true);
    port.tenant = "test-tenant-a"; port.actor = "test-owner-a"; await render(true);
    await act(async () => { old.resolve({ data: completeRun("run-a", "FOREIGN delayed result"), error: null }); await flush(); });
    expect(host.textContent).not.toContain("FOREIGN delayed result");
    expect(request.signal?.aborted).toBe(true);
  });
  it("latest selection and close invalidate pending detail reads", async () => {
    const old = deferred<unknown>(); await render(true); port.rpc.mockReturnValueOnce(old.promise); await open();
    const first = port.requests[port.requests.length - 1]!; await open("run-b");
    expect(api.detail?.id).toBe("run-b");
    await act(async () => { old.resolve({ data: completeRun(), error: null }); await flush(); });
    expect(api.detail?.id).toBe("run-b"); expect(first.signal?.aborted).toBe(true);
    const late = deferred<unknown>(); port.rpc.mockReturnValueOnce(late.promise); await open();
    const last = port.requests[port.requests.length - 1]!; await act(async () => { api.close(); late.resolve({ data: completeRun(), error: null }); await flush(); });
    expect(api.detail).toBeNull(); expect(last.signal?.aborted).toBe(true);
  });
  it("bounds hung reads and ignores a late success without an automatic retry", async () => {
    vi.useFakeTimers(); const old = deferred<unknown>(); await render(true); port.rpc.mockReturnValueOnce(old.promise); await open();
    const request = port.requests[port.requests.length - 1]!; const calls = port.rpc.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(8_001); await flush(); });
    expect(api.detailError).toBeTruthy(); expect(request.signal?.aborted).toBe(true);
    await act(async () => { old.resolve({ data: completeRun(), error: null }); await flush(); });
    expect(api.detail).toBeNull(); expect(port.rpc).toHaveBeenCalledTimes(calls); expect(port.invoke).not.toHaveBeenCalled();
  });
  it("aborts on unmount and makes no read while identity is unresolved", async () => {
    port.ready = false; await render(true); expect(port.rpc).not.toHaveBeenCalled();
    port.ready = true; const old = deferred<unknown>(); port.rpc.mockReturnValue(old.promise); await render(true);
    const request = port.requests[port.requests.length - 1]!; await act(async () => root.unmount()); root = createRoot(host);
    expect(request.signal?.aborted).toBe(true);
    await act(async () => { old.resolve({ data: [historyRow("old", "UNMOUNTED")], error: null }); await flush(); });
    expect(host.textContent).not.toContain("UNMOUNTED");
  });
  it.each(["tenant", "actor"])("rejects a late %s list after A→B→A", async boundary => {
    const old = deferred<unknown>(); port.rpc.mockReturnValueOnce(old.promise); await render(true);
    const request = port.requests[0];
    if (boundary === "tenant") port.tenant = "test-tenant-b"; else port.actor = "test-owner-b";
    await render(true); port.tenant = "test-tenant-a"; port.actor = "test-owner-a"; await render(true);
    await act(async () => { old.resolve({ data: [historyRow("foreign", "FOREIGN list")], error: null }); await flush(); });
    expect(host.textContent).not.toContain("FOREIGN list"); expect(api.rows?.[0].id).toBe("run-a");
    expect(request.signal?.aborted).toBe(true);
  });
  it("refuses an expired detail even before its deadline timer is delivered", async () => {
    vi.useFakeTimers(); const old = deferred<unknown>(); await render(true); port.rpc.mockReturnValueOnce(old.promise); await open();
    vi.setSystemTime(Date.now() + 8_001);
    await act(async () => { old.resolve({ data: completeRun(), error: null }); await flush(); });
    expect(api.detail).toBeNull(); expect(api.detailError).toBeTruthy(); expect(port.invoke).not.toHaveBeenCalled();
  });
  it("settles a failed history list without exposing diagnostics or inventing an empty history", async () => {
    port.rpc.mockRejectedValue(Error("PRIVATE list diagnostic")); await render();
    expect(host.textContent).toContain("Research history could not be loaded.");
    expect(host.textContent).not.toMatch(/PRIVATE|No saved research yet/); expect(port.invoke).not.toHaveBeenCalled();
  });
  it("only a manual refresh reads again after timeout and no late request overwrites it", async () => {
    vi.useFakeTimers(); const old = deferred<unknown>(); port.rpc.mockReturnValueOnce(old.promise); await render(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(8_001); await flush(); });
    expect(api.listError).toBeTruthy(); expect(port.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { void api.refresh(); await flush(); });
    expect(api.rows?.[0].id).toBe("run-a"); expect(port.rpc).toHaveBeenCalledTimes(2);
    await act(async () => { old.resolve({ data: [historyRow("expired", "Expired")], error: null }); await flush(); });
    expect(api.rows?.[0].id).toBe("run-a"); expect(port.invoke).not.toHaveBeenCalled();
  });
  it("preserves the dormant explicit start contract and confirms persistence only from complete canonical readback", async () => {
    await render(true);
    port.invoke.mockResolvedValue({ data: { ...completeRun(), run_id: "run-a" }, error: null });
    await act(async () => { await api.start("Earlier investigation", "thorough"); await flush(); });
    expect(port.invoke).toHaveBeenCalledTimes(1);
    expect(port.invoke.mock.calls[0]).toEqual(["paige-deep-research", { body: {
      question: "Earlier investigation", max_hops: 3, user_id: "test-owner-a", caller: "workspace", persist: true, expected_tenant_id: "test-tenant-a",
    } }]);
    expect(api.phase).toEqual({ kind: "done", runId: "run-a", persisted: true });
    expect(api.detail?.findings[0].citations).toEqual([7, 2]);
  });
  it("never treats a visible incomplete parent as saved after an explicit start", async () => {
    await render(true); port.invoke.mockResolvedValue({ data: { ...completeRun(), run_id: "run-a" }, error: null });
    port.rpc.mockImplementation(async (name: string) => ({ data: name === "list_workspace_research" ? [historyRow()] : { ...completeRun(), sources: [] }, error: null }));
    await act(async () => { await api.start("Earlier investigation", "standard"); await flush(); });
    expect(api.phase).toEqual({ kind: "done", runId: "run-a", persisted: false });
    expect(api.detail?.findings).toEqual([]); expect(port.invoke).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch a dormant start after actor preflight changes and never retries it", async () => {
    const old = deferred<unknown>(); await render(true); port.auth.mockReturnValueOnce(old.promise);
    await act(async () => { void api.start("Earlier investigation", "quick"); await flush(); });
    port.actor = "test-owner-b"; await render(true); port.actor = "test-owner-a"; await render(true);
    await act(async () => { old.resolve({ data: { user: { id: "test-owner-a" } }, error: null }); await flush(); });
    expect(port.invoke).not.toHaveBeenCalled(); expect(api.phase.kind).toBe("idle");
  });
});

describe("one pure public Research projection shared by Home and Chat", () => {
  it("imports the actual same decoder into Chat and Home without a local shadow implementation", () => {
    const chat = readFileSync(join(root, "src/components/dashboard/PaigeAIChat.tsx"), "utf8");
    for (const [source, name] of [[chat, "readResearchHistoryRun"], [hook, "projectResearchHistoryRun"]]) {
      const ast = ts.createSourceFile("consumer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const imports = ast.statements.filter(ts.isImportDeclaration).filter(node => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "@/lib/paigeResearchReadback");
      expect(imports).toHaveLength(1);
      const bindings = imports[0].importClause?.namedBindings;
      expect(bindings && ts.isNamedImports(bindings) && bindings.elements.some(element => element.name.text === name)).toBe(true);
      expect(ast.statements.filter(ts.isFunctionDeclaration).some(node => node.name?.text === name)).toBe(false);
    }
    const incomplete = { ...completeRun(), sources: [] };
    expect(readResearchHistoryRun(incomplete, incomplete.id)).toBeNull();
    expect(projectResearchHistoryRun(incomplete, incomplete.id)?.evidenceComplete).toBe(false);
  });
  it("preserves canonical indices/nullability and member-visible history without a creator predicate", () => {
    const input = { ...completeRun(), user_id: "another-author" }; const original = structuredClone(input);
    const detail = projectResearchHistoryRun(input, input.id)!;
    expect(detail.evidenceComplete).toBe(true); expect(detail.sources[0]).toMatchObject({ index: 2, title: null, tier: null, reliability: null, published_at: null, excluded: false });
    expect(detail.findings[0].citations).toEqual([7, 2]); expect(readResearchHistoryRun(input, input.id)?.sources).toEqual(detail.sources);
    expect(input).toEqual(original); expect(detail).not.toHaveProperty("saved");
  });
  it.each(["missing source", "duplicate index", "excluded", "null excluded", "empty cites", "duplicate cites", "string cite", "malformed URL", "malformed source", "malformed findings", "malformed notes"])("never supplies Chat a complete result for %s", kind => {
    const input = completeRun();
    if (kind === "missing source") input.sources.pop();
    if (kind === "duplicate index") input.sources[1].index = 2;
    if (kind === "excluded") input.sources[1].excluded = true;
    if (kind === "null excluded") Object.assign(input.sources[1], { excluded: null });
    if (kind === "empty cites") input.findings[0].citations = [];
    if (kind === "duplicate cites") input.findings[0].citations = [7, 7];
    if (kind === "string cite") Object.assign(input.findings[0], { citations: ["7"] });
    if (kind === "malformed URL") input.sources[1].url = "https://";
    if (kind === "malformed source") Object.assign(input.sources[1], { title: {} });
    if (kind === "malformed findings") Object.assign(input, { findings: null });
    if (kind === "malformed notes") Object.assign(input.coverage, { unverified_notes: [42] });
    const original = structuredClone(input); const detail = projectResearchHistoryRun(input, input.id)!;
    expect(detail.evidenceComplete).toBe(false); expect(detail.findings).toEqual([]); expect(detail.coverage.note).toBeUndefined();
    expect(detail.question).toBe(input.question); expect(readResearchHistoryRun(input, input.id)).toBeNull(); expect(input).toEqual(original);
  });
  it("retains an honestly empty no-results run without inventing findings", () => {
    const input = { ...completeRun(), stop_reason: "no_results", findings: [], sources: [], coverage: {} };
    expect(projectResearchHistoryRun(input, input.id)).toMatchObject({ evidenceComplete: true, stop_reason: "no_results", findings: [], sources: [] });
    expect(readResearchHistoryRun(input, input.id)?.stop_reason).toBe("no_results");
  });
  it("retains the existing dossier renderer's valid section contract and withholds malformed dossier containers", () => {
    const section = { status: "not_found", note: "Not found", items: [] };
    const profile = { kind: "organization", name: "Example organization", summary: "Historical dossier", headline: "Earlier investigation",
      people: section, divisions: section, offerings: section, locations: section, unverified_notes: [],
      coverage: { people_found: 0, people_with_verified_contact: 0, divisions_found: 0, locations_found: 0 } };
    const input = { ...completeRun(), entity_profile: profile };
    expect(projectResearchHistoryRun(input, input.id)?.entity_profile).toEqual(profile);
    expect(readResearchHistoryRun(input, input.id)?.is_dossier).toBe(true);
    const malformed = { ...input, entity_profile: { ...profile, people: { ...section, items: [null] } } };
    expect(projectResearchHistoryRun(malformed, input.id)).toMatchObject({ evidenceComplete: false, entity_profile: null, findings: [] });
    expect(readResearchHistoryRun(malformed, input.id)).toBeNull();
  });
  it("rejects an unknown or wrong run without a foreign metadata oracle", () => {
    expect(projectResearchHistoryRun(null, "run-a")).toBeNull(); expect(projectResearchHistoryRun(completeRun("foreign"), "run-a")).toBeNull();
    expect(readResearchHistoryRun(completeRun("foreign"), "run-a")).toBeNull();
  });
});

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
    const ast = ts.createSourceFile("deepResearch.ts", hook, ts.ScriptTarget.Latest, true);
    const contexts: string[] = []; const aborted: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useTenantContext") contexts.push(node.expression.text);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "abortSignal") aborted.push(node.expression.getText(ast));
      ts.forEachChild(node, visit);
    };
    visit(ast);
    expect(contexts).toHaveLength(1);
    expect(aborted).toHaveLength(3); // list, selected detail, explicit-start readback
  });

  it("a workspace switch mid-run never renders the old workspace's result in the new view", () => {
    expect(hook).toContain("SCOPE FENCE");
    expect(hook).toContain("already persisted under the old workspace server-side");
  });

  it("the effect resets state on switch — no stale rows, no stale detail", () => {
    // Existing real mounted tests above assert the display, including A→B→A,
    // actor/readiness transitions and unmount; this AST assertion pins their
    // dependency on one epoch-scoped view rather than independent stale fields.
    const ast = ts.createSourceFile("deepResearch.ts", hook, ts.ScriptTarget.Latest, true);
    const declarations: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.push(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    expect(declarations).toContain("identity");
    expect(declarations).toContain("visible");
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
    const complete = completeRun();
    expect(readResearchHistoryRun(complete, complete.id)?.findings).toHaveLength(1);
    complete.sources = [];
    expect(readResearchHistoryRun(complete, complete.id)).toBeNull();
    const incomplete = projectResearchHistoryRun(complete, complete.id);
    expect(incomplete?.question).toBe(complete.question);
    expect(incomplete?.evidenceComplete).toBe(false);
    expect(incomplete?.findings).toEqual([]);
    expect(incomplete?.coverage.note).toBeUndefined();
  });

  it("saved is claimed ONLY from the server's governed readback (§10)", () => {
    const chat = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");
    expect(chat).toContain("// R2b §10 — the governed readback: never claim a saved run without proving");
    expect(chat).toContain('supabaseClient.rpc("get_workspace_research_run"');
    // A truthy row is insufficient: Chat must reject a read error and prove
    // that the governed record is the complete run returned by the engine.
    expect(chat).not.toContain("drSaved = !!drReadback");
    expect(chat).toContain("drSaved = !drReadError && !!drReadback");
    expect(chat).toContain("drReadback.id === drRunId");
    expect(chat).toContain("canonicalResearchJson(drReadback.findings) === canonicalResearchJson(findings)");
    expect(chat).toContain("drReadback.sources.length === sources.length");
  });

  it("the card's saved/not-saved verdict is the readback's, never assumed", () => {
    const card = readFileSync(join(root, "src/components/paige/chat/PaigeResearchCard.tsx"), "utf8");
    expect(card).toContain("Saved to this workspace's research library");
    expect(card).toContain("Not saved — the run could not be confirmed in this workspace");
  });

  it("no blind rerun on uncertain persistence", () => {
    // The done phase carries the truth; nothing in the hook auto-restarts —
    // start() is called only from the view's submit handler.
    expect(hook).toContain('phase: { kind: "done", runId, persisted }');
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
