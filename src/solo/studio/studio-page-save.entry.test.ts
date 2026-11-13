// Execute actual production generation/save/common-linkage AST branches. Auth,
// edge and database ports are doubles; transactions are proved by native tests.
// This starts after original tool admission/approval governance, never bypasses it.
// STUDIO_PAGE_ENTRY_SOURCE selects an immutable local Git source for the SAME
// assertions' pre-integration red control, never overwriting production source.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parseStudioPageSaveSource, type StudioPageSaveSource } from "../../../supabase/functions/_shared/growth/studio-page-source";
import { createStudioPageSave } from "../../../supabase/functions/_shared/growth/studio-page-save";
import { artifactProduced, ARTIFACT_ABSENT_ERROR } from "../../../supabase/functions/_shared/artifact-receipt";

const revision = process.env.STUDIO_PAGE_ENTRY_SOURCE;
if (revision && !/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid immutable entry source");
const source = revision ? execFileSync("git", ["show", `${revision}:supabase/functions/paige-ai-chat/index.ts`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  : readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true), nodes: ts.Node[] = [];
function visit(node: ts.Node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(ast);
function one<T>(matches: T[], label: string): T { if (matches.length !== 1) throw Error(`Original ${label} missing/ambiguous: ${matches.length}`); return matches[0]; }
function variable(name: string) { return one(nodes.filter(ts.isVariableDeclaration).filter(node => node.name.getText(ast) === name), name); }
function branch(name: string) { return one(nodes.filter(ts.isIfStatement).filter(node => node.expression.getText(ast) === `tc.function.name === "${name}"` && ts.isBlock(node.thenStatement)), name).thenStatement as ts.Block; }
const generate = branch("growth_page_generate").statements.map(node => node.getText(ast)).join("\n");
const save = branch("growth_page_save").statements.map(node => node.getText(ast)).join("\n");
const common = one(nodes.filter(ts.isIfStatement).filter(node => ts.isBlock(node.parent)
  && node.expression.getText(ast).includes("studioSessionId") && node.getText(ast).includes('tc.function.name === "growth_page_save"')
  && node.getText(ast).includes('rpc("link_session_artifact"')), "common Studio linkage").getText(ast);
const dispatchHelpers = ["asToolRecord", "readInvokeBody", "workspaceRefusal"].map(name => `const ${variable(name).getText(ast)};`).join("\n");
const linked = variable("studioLinked").parent.parent;
const preview = variable("studioPreview").parent.parent;
if (!ts.isVariableStatement(linked) || !ts.isVariableStatement(preview) || !ts.isBlock(linked.parent) || linked.parent !== preview.parent) throw Error("Original owning Studio declaration block missing");
const siblings = linked.parent.statements;
const ownership = siblings.slice(siblings.indexOf(linked) + 1, siblings.indexOf(preview)).map(node => node.getText(ast)).join("\n");
const hasIntegration = nodes.filter(ts.isVariableDeclaration).some(node => node.name.getText(ast) === "studioPageSaves");

const TENANT = "11111111-1111-4111-8111-111111111111", SESSION = "22222222-2222-4222-8222-222222222222";
const PAGE = "33333333-3333-4333-8333-333333333333", FORM = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555", OTHER = "66666666-6666-4666-8666-666666666666";
const DATE = "2026-11-13T17:05:06.123456+00:00";
const conversion = () => ({ type: "conversion", title: "Discuss the project", destination: { kind: "native_booking", slug: "intro-call" } });
const nativeSource = (page: string | null = PAGE): StudioPageSaveSource => ({ ok: true, tenant_id: TENANT, session_id: SESSION,
  artifact_refs: page ? [{ kind: "page", id: page, title: "Original page", added_at: DATE }] : [],
  project_context: { target: { kind: "workspace" }, values: { publicName: "Neutral studio", offers: "Editorial services", primaryColor: "" }, template_id: "nexus-editorial-landing-v1" },
  page_id: page, updated_at: page ? DATE : null, conversion: page ? conversion() as StudioPageSaveSource["conversion"] : null });
const generated = (raw: unknown = nativeSource()) => ({ blocks: [{ type: "hero", title: "A practical next step" }], theme_json: { primary_color: "#123456" }, seo_json: { title: "Original draft" }, studio_source: raw });
const input = () => ({ page_id: PAGE, slug: "model-proposed-address", title: "Reviewed page", blocks: [{ type: "hero", title: "Reviewed design" }, conversion()], theme: { primary_color: "#123456" }, seo: { title: "Reviewed page" } });
type Tool = { id: string; function: { name: string; arguments: string } };
const tool = (name = "growth_page_save", id = "original-call"): Tool => ({ id, function: { name, arguments: "{}" } });
type Row = Record<string, unknown>;
type NativeReply = { data: unknown; error: unknown };
type Runtime = {
  generate(tc: Tool, args: Row): Promise<Row>; save(tc: Tool, args: Row): Promise<Row>; link(tc: Tool, result: Row): Promise<Row>;
  patch(change: Row): void; current(): boolean;
  snapshot(): { studioPageSaves: Map<string, { source: StudioPageSaveSource }>; studioPageSavedCalls: Set<object>; canvasArtifact: Row | null; studioLinked: Row[]; needsReview: boolean };
};
type Options = { studio?: boolean; page?: string | null; gd?: unknown; generationError?: unknown;
  write?: (name: string, args: Row) => NativeReply | Promise<NativeReply>; afterGenerate?: (runtime: Runtime) => void;
  beforeWrite?: (runtime: Runtime) => void; taken?: string[]; missingSlug?: boolean };
async function world(options: Options = {}) {
  const rpcCalls: Array<{ channel: string; name: string; args: Row }> = [], reads: Array<{ table: string; filters: unknown[][]; columns: string }> = [], invokes: Array<{ name: string; args: Row }> = [];
  const stop = new AbortController(); let runtime!: Runtime;
  const page = { id: options.page ?? PAGE, tenant_id: TENANT, slug: "existing-public-address", title: "Newer saved page", status: "draft" };
  const nativeSaved = (change: Row = {}) => ({ ok: true, page: { ...page, id: PAGE, title: "Native saved title" }, version_id: VERSION, forms: [{ id: FORM, slug: "original-intake" }], changed: true, reconciled: false, ...change });
  const caller = {
    functions: { invoke: async (name: string, args: Row) => { invokes.push({ name, args }); options.afterGenerate?.(runtime); return { data: options.gd === undefined ? generated(options.page === null ? nativeSource(null) : nativeSource()) : options.gd, error: options.generationError ?? null }; } },
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ channel: "caller", name, args });
      if (name === "studio_save_page" || name === "studio_page_save_state") { options.beforeWrite?.(runtime); return options.write ? options.write(name, args) : { data: nativeSaved(), error: null }; }
      if (name === "growth_page_upsert") return { data: { ...page }, error: null };
      if (name === "link_session_artifact" || name === "save_artifact_version") return { data: VERSION, error: null };
      throw Error(`Unexpected native operation: ${name}`);
    },
    from: (table: string) => {
      const read = { table, filters: [] as unknown[][], columns: "" }; reads.push(read);
      const data = () => table === "growth_forms" ? [{ id: FORM, slug: "original-intake" }] : (options.taken ?? []).map(slug => ({ slug }));
      const query = { select: (columns: string) => { read.columns = columns; return query; },
        eq: (key: string, value: unknown) => { read.filters.push(["eq", key, value]); return query; },
        like: (key: string, value: unknown) => { read.filters.push(["like", key, value]); return query; },
        in: (key: string, value: unknown) => { read.filters.push(["in", key, value]); return query; },
        maybeSingle: async () => ({ data: options.missingSlug ? null : { ...page }, error: null }),
        then: (resolve: (value: NativeReply) => unknown) => Promise.resolve({ data: data(), error: null }).then(resolve),
      }; return query;
    },
  };
  const environment: Row = {
    req: { signal: stop.signal }, proposalScopeInvalidated: false, tenantKnowledgeScopeRevoked: false,
    interactive: { superseded: false }, interactiveRecoveryReadOnly: false, interactiveConversational: false,
    studioSessionId: options.studio === false ? null : SESSION, personaCtx: { tenant_id: TENANT }, turnScopeTenantId: TENANT,
    canvasArtifact: options.page === null ? null : { kind: "page", id: options.page ?? PAGE },
    studioLinked: [], studioPreview: null, requestExecutionState: { needsReview: false },
    supabaseClient: caller, admin: { rpc: (name: string, args: Row) => { rpcCalls.push({ channel: "service", name, args }); throw Error("Service writer forbidden"); } },
    parseStudioPageSaveSource, createStudioPageSave, artifactProduced, ARTIFACT_ABSENT_ERROR,
    // Only the immutable pre-integration source uses these empty ports. Its real
    // branches still execute and fail the SAME source-capture/native-save tests.
    ...(!hasIntegration ? { studioPageSaves: new Map(), studioPageSavedCalls: new Set(), studioPageSaveCurrent: () => true } : {}),
  };
  const code = `${ownership}\n${dispatchHelpers}
    return {
      async generate(tc, args) { let result; for (const once of [true]) { ${generate} } ${common} return result; },
      async save(tc, args) { let result; for (const once of [true]) { ${save} } ${common} return result; },
      async link(tc, result) { ${common} return result; },
      patch(change) { for (const [key,value] of Object.entries(change)) {
        if (key === 'studioSessionId') studioSessionId=value;
        else if (key === 'canvasArtifact') canvasArtifact=value;
        else if (key === 'proposalScopeInvalidated') proposalScopeInvalidated=value;
        else if (key === 'tenantKnowledgeScopeRevoked') tenantKnowledgeScopeRevoked=value;
        else if (key === 'interactiveRecoveryReadOnly') interactiveRecoveryReadOnly=value;
        else if (key === 'interactiveConversational') interactiveConversational=value;
        else if (key === 'interactive') interactive=value;
        else if (key === 'personaCtx') personaCtx=value;
      } },
      current: () => studioPageSaveCurrent(),
      snapshot: () => ({studioPageSaves,studioPageSavedCalls,canvasArtifact,studioLinked,needsReview:requestExecutionState.needsReview})
    };`;
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runtime = new Function(...Object.keys(environment), `return (async()=>{${js}})();`)(...Object.values(environment)) as Runtime;
  runtime = await runtime;
  return { runtime, rpcCalls, reads, invokes, stop, page, nativeSaved };
}
const nativeCalls = (w: Awaited<ReturnType<typeof world>>) => w.rpcCalls.filter(call => call.name === "studio_save_page" || call.name === "studio_page_save_state");
const extras = (w: Awaited<ReturnType<typeof world>>) => w.rpcCalls.filter(call => call.name === "link_session_artifact" || call.name === "save_artifact_version");

describe("actual Studio generation → owning invocation source → native save", () => {
  it("captures a detached native source keyed by the actual canvas, without exposing it to the model", async () => {
    const raw = nativeSource(), gd = generated(raw), w = await world({ gd });
    const result = await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page", studio_page_id: OTHER });
    expect(result.success).toBe(true); expect(result).not.toHaveProperty("studio_source"); expect(JSON.stringify(result)).not.toContain("project_context");
    expect(w.runtime.snapshot().studioPageSaves.get(PAGE)?.source).toEqual(raw);
    raw.project_context.values!.publicName = "Changed after generation";
    raw.artifact_refs[0].title = "Changed after generation";
    expect(w.runtime.snapshot().studioPageSaves.get(PAGE)?.source.project_context.values?.publicName).toBe("Neutral studio");
    expect(w.runtime.snapshot().studioPageSaves.get(PAGE)?.source.artifact_refs[0].title).toBe("Original page");
    expect(w.invokes[0].args.body).toMatchObject({ studio_session_id: SESSION, studio_page_id: PAGE });
  });
  it("saves through caller JWT with exactly the original 13 native arguments and no extra link/version", async () => {
    const w = await world(); await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" });
    const tc = tool(), args = input(), result = await w.runtime.save(tc, { ...args, studio_source: nativeSource(OTHER), tenant_id: OTHER, session_id: OTHER });
    expect(result).toMatchObject({ success: true, page_id: PAGE, version_id: VERSION, title: "Native saved title", form_ids: [FORM] });
    expect(nativeCalls(w)).toEqual([{ channel: "caller", name: "studio_save_page", args: {
      p_expected_tenant: TENANT, p_session_id: SESSION, p_expected_artifact_refs: nativeSource().artifact_refs,
      p_expected_project_context: nativeSource().project_context, p_page_id: PAGE, p_expected_updated_at: DATE,
      p_expected_conversion: nativeSource().conversion, p_slug: "existing-public-address", p_title: args.title,
      p_blocks_json: args.blocks, p_theme_json: args.theme, p_seo_json: args.seo, p_form_schema_json: null,
    } }]);
    expect(Object.keys(nativeCalls(w)[0].args)).toHaveLength(13); expect(extras(w)).toEqual([]);
    expect(w.rpcCalls.some(call => call.name === "growth_page_upsert" || call.channel === "service")).toBe(false);
    expect(w.runtime.snapshot().studioPageSavedCalls.has(tc)).toBe(true);
    expect(w.runtime.snapshot().studioLinked).toEqual([expect.objectContaining({ kind: "page", id: PAGE, url: null })]);
  });
  it.each([undefined, null, { ...nativeSource(), tenant_id: OTHER }, { ...nativeSource(), session_id: OTHER }, { ...nativeSource(), page_id: OTHER }, { ...nativeSource(), updated_at: null }])("refuses absent/malformed/foreign generation source before any legacy writer %#", async raw => {
    const gd = generated(raw); if (raw === undefined) delete (gd as Partial<typeof gd>).studio_source;
    const w = await world({ gd }); await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" });
    const result = await w.runtime.save(tool(), { ...input(), studio_source: nativeSource() });
    expect(result.success).toBe(false); expect(w.runtime.snapshot().studioPageSaves.size).toBe(0); expect(w.rpcCalls).toEqual([]); expect(w.reads).toEqual([]);
  });
  it("approval resume or a fresh invocation cannot manufacture the missing generation source", async () => {
    const w = await world(); const result = await w.runtime.save(tool("growth_page_save", "approved-original-call"), { ...input(), approved: true, studio_source: nativeSource() });
    expect(result).toMatchObject({ success: false, not_applied: true }); expect(w.rpcCalls).toEqual([]); expect(w.reads).toEqual([]);
  });
  it("keeps a newer page unchanged after native SQLSTATE 40001 and never falls back", async () => {
    const w = await world({ write: async () => ({ data: null, error: { code: "40001", message: "private native detail" } }) });
    await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" }); const before = { ...w.page };
    const result = await w.runtime.save(tool(), input());
    expect(result).toMatchObject({ success: false, not_applied: true }); expect(JSON.stringify(result)).not.toContain("private native detail");
    expect(w.page).toEqual(before); expect(w.rpcCalls.map(call => call.name)).toEqual(["studio_save_page"]); expect(extras(w)).toEqual([]);
  });
  it("lost ACK takes only read-only state lookup, sets sticky needsReview, and never blindly replays", async () => {
    const w = await world({ write: async name => name === "studio_save_page" ? { data: null, error: { message: "response lost" } } : { data: { ok: false, code: "unknown" }, error: null } });
    await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" });
    expect(await w.runtime.save(tool(), input())).toMatchObject({ success: false, outcome_unknown: true });
    expect(w.runtime.snapshot().needsReview).toBe(true); await w.runtime.save(tool("growth_page_save", "later-call"), input());
    expect(w.runtime.snapshot().needsReview).toBe(true); expect(w.rpcCalls.filter(call => call.name === "studio_save_page")).toHaveLength(1);
    expect(w.rpcCalls.every(call => call.name === "studio_save_page" || call.name === "studio_page_save_state")).toBe(true); expect(extras(w)).toEqual([]);
    expect(w.rpcCalls[1].name).toBe("studio_page_save_state"); expect(w.rpcCalls[1].args).toEqual(w.rpcCalls[0].args);
  });
  it("a model-selected different page is refused before even a slug lookup", async () => {
    const w = await world(); await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" });
    expect(await w.runtime.save(tool(), { ...input(), page_id: OTHER })).toMatchObject({ success: false, not_applied: true });
    expect(w.rpcCalls).toEqual([]); expect(w.reads).toEqual([]);
  });
  it("new-page source uses its server-owned key, null CAS fields and collision-safe slug, then follows the native saved canvas", async () => {
    const w = await world({ page: null, taken: ["model-proposed-address"] });
    await w.runtime.generate(tool("growth_page_generate"), { brief: "New public page", studio_page_id: OTHER });
    expect(w.runtime.snapshot().studioPageSaves.get("new")?.source.page_id).toBeNull();
    expect(w.invokes[0].args.body).not.toHaveProperty("studio_page_id");
    const args = { ...input(), page_id: null }; expect((await w.runtime.save(tool(), args)).success).toBe(true);
    expect(nativeCalls(w)[0].args).toMatchObject({ p_page_id: null, p_expected_updated_at: null, p_expected_conversion: null, p_expected_artifact_refs: [], p_slug: "model-proposed-address-2" });
    expect(w.runtime.snapshot().canvasArtifact).toEqual({ kind: "page", id: PAGE }); expect(extras(w)).toEqual([]);
    await w.runtime.generate(tool("growth_page_generate", "fresh-generation"), { brief: "Refine the actual saved page" });
    expect(w.invokes[1].args.body).toMatchObject({ studio_session_id: SESSION, studio_page_id: PAGE });
  });
  it("a failed later generation clears its selected source rather than reusing a prior snapshot", async () => {
    const options: Options = {}, w = await world(options);
    await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" }); expect(w.runtime.snapshot().studioPageSaves.size).toBe(1);
    options.gd = generated(null); expect((await w.runtime.generate(tool("growth_page_generate", "second"), { brief: "Revise" })).success).toBe(false);
    expect(w.runtime.snapshot().studioPageSaves.size).toBe(0);
    expect((await w.runtime.save(tool(), input())).success).toBe(false); expect(w.rpcCalls).toEqual([]);
  });
  it("does not admit an old page source when the actual canvas changes while generation is in flight", async () => {
    const w = await world({ afterGenerate: runtime => runtime.patch({ canvasArtifact: { kind: "page", id: OTHER } }) });
    const result = await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" });
    expect(result.success).toBe(false); expect(w.runtime.snapshot().studioPageSaves.size).toBe(0);
    expect((await w.runtime.save(tool(), input())).success).toBe(false); expect(w.rpcCalls).toEqual([]);
  });
  it("does not admit a source after the original session changed during generation", async () => {
    const w = await world({ afterGenerate: runtime => runtime.patch({ studioSessionId: OTHER }) });
    expect((await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" })).success).toBe(false);
    expect(w.runtime.snapshot().studioPageSaves.size).toBe(0); expect(w.rpcCalls).toEqual([]);
  });
  it.each([
    ["proposal", { proposalScopeInvalidated: true }, { proposalScopeInvalidated: false }],
    ["Knowledge revocation", { tenantKnowledgeScopeRevoked: true }, { tenantKnowledgeScopeRevoked: false }],
    ["superseded", { interactive: { superseded: true } }, { interactive: { superseded: false } }],
    ["recovery", { interactiveRecoveryReadOnly: true }, { interactiveRecoveryReadOnly: false }],
    ["conversational", { interactiveConversational: true }, { interactiveConversational: false }],
    ["tenant", { personaCtx: { tenant_id: OTHER } }, { personaCtx: { tenant_id: TENANT } }],
    ["missing Studio", { studioSessionId: null }, { studioSessionId: SESSION }],
  ])("actual source callback withdraws permanently on %s A-B-A", async (_name, changed, reset) => {
    const w = await world(); await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" });
    expect(w.runtime.current()).toBe(true); w.runtime.patch(changed); expect(w.runtime.current()).toBe(false);
    w.runtime.patch(reset); expect(w.runtime.current()).toBe(false);
    expect((await w.runtime.save(tool(), input())).success).toBe(false); expect(w.rpcCalls).toEqual([]);
  });
  it("Stop before dispatch refuses, and a late native success after Stop cannot be promoted or linked", async () => {
    const early = await world(); await early.runtime.generate(tool("growth_page_generate"), { brief: "Public page" }); early.stop.abort();
    expect((await early.runtime.save(tool(), input())).success).toBe(false); expect(early.rpcCalls).toEqual([]);
    let late!: Awaited<ReturnType<typeof world>>;
    late = await world({ beforeWrite: () => late.stop.abort() }); await late.runtime.generate(tool("growth_page_generate"), { brief: "Public page" });
    expect(await late.runtime.save(tool(), input())).toMatchObject({ success: false, outcome_unknown: true });
    expect(late.runtime.snapshot().needsReview).toBe(true); expect(late.rpcCalls.map(call => call.name)).toEqual(["studio_save_page"]); expect(extras(late)).toEqual([]);
  });
  it("a lost ACK recovered by the same read-only state projects only native IDs and does not append a second version", async () => {
    let w!: Awaited<ReturnType<typeof world>>;
    w = await world({ write: async name => name === "studio_save_page" ? { data: null, error: { message: "lost" } }
      : { data: w.nativeSaved({ changed: false, reconciled: true }), error: null } });
    await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" }); const tc = tool();
    expect(await w.runtime.save(tc, input())).toMatchObject({ success: true, page_id: PAGE, version_id: VERSION });
    expect(w.rpcCalls.map(call => call.name)).toEqual(["studio_save_page", "studio_page_save_state"]); expect(extras(w)).toEqual([]);
    expect(w.runtime.snapshot().studioPageSavedCalls.has(tc)).toBe(true);
  });
});

describe("owning common linkage identity and original paths", () => {
  it("only the exact actual tc object can skip the original common linkage", async () => {
    const w = await world(); await w.runtime.generate(tool("growth_page_generate"), { brief: "Public page" });
    const tc = tool(), result = await w.runtime.save(tc, input()); expect(extras(w)).toEqual([]);
    const cloned = structuredClone(tc); expect(w.runtime.snapshot().studioPageSavedCalls.has(cloned)).toBe(false);
    await w.runtime.link(cloned, { ...result, studio_native_saved: true, studio_page_saved: true, studio_session_id: SESSION });
    expect(extras(w).map(call => call.name)).toEqual(["link_session_artifact", "save_artifact_version", "link_session_artifact", "save_artifact_version"]);
  });
  it("non-Studio save keeps the exact original writer, address clamp and zero Studio linkage", async () => {
    const w = await world({ studio: false }); const args = { ...input(), blocks: [{ type: "embedded_form", form_slug: "original-intake" }] };
    const result = await w.runtime.save(tool(), args);
    expect(result).toMatchObject({ success: true, page_id: PAGE, forms_on_page: ["original-intake"], form_ids: [FORM] });
    expect(w.rpcCalls).toEqual([{ channel: "caller", name: "growth_page_upsert", args: { p_tenant_id: TENANT, p_slug: "existing-public-address", p_title: args.title,
      p_blocks_json: args.blocks, p_theme_json: args.theme, p_seo_json: args.seo, p_id: PAGE } }]);
    expect(w.runtime.snapshot().studioLinked).toEqual([]); expect(nativeCalls(w)).toEqual([]);
  });
  it("the original non-page Studio form linkage still links and versions once", async () => {
    const w = await world(); await w.runtime.link(tool("growth_form_save"), { success: true, form_id: FORM, title: "Original form" });
    expect(extras(w).map(call => call.name)).toEqual(["link_session_artifact", "save_artifact_version"]);
    expect(w.runtime.snapshot().studioLinked).toEqual([{ kind: "form", id: FORM, title: "Original form", url: null }]);
  });
  it("non-Studio generation still accepts an ordinary draft without Studio source", async () => {
    const w = await world({ studio: false, gd: generated(null) });
    expect(await w.runtime.generate(tool("growth_page_generate"), { brief: "Ordinary public draft" })).toMatchObject({ success: true, blocks: expect.any(Array) });
    expect(w.runtime.snapshot().studioPageSaves.size).toBe(0); expect(w.rpcCalls).toEqual([]);
  });
});
