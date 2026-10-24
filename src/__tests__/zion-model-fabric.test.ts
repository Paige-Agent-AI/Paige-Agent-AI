// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { authorityAdmits } from "../../supabase/functions/_shared/workspace-authority.ts";

const raw = readFileSync(resolve(__dirname, "../../supabase/functions/paige-orchestrator/index.ts"), "utf8");
const ast = ts.createSourceFile("orchestrator.ts", raw, ts.ScriptTarget.Latest, true);
const selected = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ["invokeSoft", "zionProviderAuthority"].includes(n.name?.text ?? ""));
const code = ts.transpileModule(selected.map(n => n.getText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
// Exercise the original pure route decision and taxonomy without provider/env
// imports. The absent Featherless key is an explicit closed fixture port.
const routerAst = ts.createSourceFile("router.ts", readFileSync(resolve(__dirname, "../../supabase/functions/_shared/model-router.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const taxonomy = routerAst.statements.filter(n => ts.isFunctionDeclaration(n) && ["pickRoute"].includes(n.name?.text ?? "")
  || ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ["CHEAP_KINDS", "REASONING_KINDS", "SENSITIVE_KINDS", "JOB_KINDS"].includes(d.name.getText(routerAst))));
const taxonomyJs = ts.transpileModule(taxonomy.map(n => n.getText(routerAst)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const originalRoute = new Function("exports", "featherlessKey", "featherlessModelFor", `${taxonomyJs}; return exports.pickRoute;`)({}, () => undefined, () => "fixture-only");
const actor = "11111111-1111-4111-8111-111111111111", tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const identity = "22222222-2222-4222-8222-222222222222";
const registered = { id: identity, version: 2, slug: "zion", name: "ZION", tenant_id: null as string | null, enabled: true, runtime: "soft", system_prompt: "Fixture: internal planning draft only.", config: { job_kind: "plan" } };
function fixture() {
  let current = { ...registered }, allowed = true, scope = true, failed = false;
  const from = vi.fn(() => {
    const predicates: Array<[string, unknown]> = [];
    let workspace: string | null = null;
    const chain = {
      select: () => chain, eq: (key: string, value: unknown) => { predicates.push([key, value]); return chain; },
      or: (filter: string) => { workspace = /^tenant_id\.is\.null,tenant_id\.eq\.(.+)$/.exec(filter)?.[1] ?? null; return chain; },
      maybeSingle: async () => ({ data: workspace && (current.tenant_id === null || current.tenant_id === workspace)
        && predicates.every(([k, v]) => current[k as keyof typeof current] === v) ? current : null, error: failed ? { message: "PRIVATE_DB_ERROR" } : null }),
    }; return chain;
  });
  const permission = vi.fn(async () => ({ ok: !failed, authority: { workspaceAdmin: allowed, seat: allowed, platformOperator: false } }));
  const legacy = vi.fn(async () => ({ choices: [{ message: { content: "legacy draft" } }] }));
  const fabric = vi.fn(async (_request: unknown, options: { beforeProviderAttempt?: () => Promise<boolean> }) => {
    if (!options.beforeProviderAttempt || !await options.beforeProviderAttempt()) return { ok: false, error: { failure: "caller_refused" } };
    return { ok: true, response: { choices: [{ message: { content: "canonical draft" } }] }, route: { served: { provider: "fixture-only", model: "fixture-only" } } };
  });
  const invoke = new Function("supabase", "resolveWorkspaceAuthorityAs", "authorityAdmits", "fabricCompletion", "routedChatCompletion", "pickRoute", "UUID_RE", `${code}; return invokeSoft;`)(
    { from }, permission, authorityAdmits, fabric, legacy, originalRoute, /^[0-9a-f-]{36}$/i);
  const scopeCheck = vi.fn(async () => scope);
  return { fabric, legacy, from, permission, scopeCheck,
    setAllowed: (value: boolean) => { allowed = value; }, setScope: (value: boolean) => { scope = value; },
    setFailed: () => { failed = true; }, setRow: (patch: Partial<typeof registered>) => { current = { ...current, ...patch }; },
    invoke: (agent = registered, ctx: { user_id?: string } = { user_id: actor }, selectedTenant: string | null = tenant, actorlessService = false) => invoke(agent, { request: "Prepare a weekly plan; execute nothing." }, ctx, selectedTenant, scopeCheck, actorlessService),
  };
}
describe("ZION consumes the original Model Fabric with server-controlled authority", () => {
  it("the versioned factory planning instructions use the existing bounded Fabric route", async () => {
    const migration = readFileSync(resolve(__dirname, "../../supabase/migrations/20271113740005_exp05_zion_planning_instructions.sql"), "utf8");
    const prompt = /\$zion_operations_plan_v1\$([\s\S]*?)\$zion_operations_plan_v1\$/.exec(migration)?.[1] ?? "";
    const f = fixture(), agent = { ...registered, version: 3, system_prompt: prompt, config: { job_kind: "plan" } };
    f.setRow(agent);
    expect(await f.invoke(agent)).toMatchObject({ status: 200, body: { ok: true, answer: "canonical draft" } });
    expect(f.fabric).toHaveBeenCalledOnce(); expect(f.legacy).not.toHaveBeenCalled();
    expect(f.fabric.mock.calls[0][0]).toMatchObject({ cognitive_class: "operational", job: "zion_operations_draft",
      max_tokens: 2048, messages: [{ role: "system", content: prompt }, { role: "user", content: expect.any(String) }] });
    expect(f.fabric.mock.calls[0][0]).not.toHaveProperty("tools");
    expect(f.fabric.mock.calls[0][0]).not.toHaveProperty("model");
    f.setRow({ version: 4 });
    expect(await f.fabric.mock.calls[0][1].beforeProviderAttempt!()).toBe(false);
  });
  it("requests a cognitive class and stable job, with original context and no provider override", async () => {
    const f = fixture(), result = await f.invoke();
    expect(result).toMatchObject({ status: 200, body: { ok: true, answer: "canonical draft" } });
    expect(f.legacy).not.toHaveBeenCalled();
    expect(f.fabric.mock.calls[0][0]).toMatchObject({ cognitive_class: "operational", job: "zion_operations_draft", max_tokens: 2048 });
    expect(f.fabric.mock.calls[0][0]).not.toHaveProperty("model");
    expect(f.fabric.mock.calls[0][1]).toMatchObject({ trace: { tenant_id: tenant, agent_id: "zion", content_policy: "metadata_only" } });
  });
  it("uses the existing classification band for a permitted cheap internal draft", async () => {
    const f = fixture(), agent = { ...registered, config: { job_kind: "summarize" } };
    f.setRow(agent); await f.invoke(agent);
    expect(f.fabric.mock.calls[0][0]).toMatchObject({ cognitive_class: "cheap" });
  });
  it.each(["approval_decision", "outbound_final", "client_copy_final", "action_decision", "legacy_unknown_job", "chat", "propose", "doc_draft"])("preserves the original protected/unported %s route and budget contract", async job => {
    const f = fixture(), agent = { ...registered, config: { job_kind: job } };
    f.setRow(agent); const result = await f.invoke(agent);
    expect(f.fabric).not.toHaveBeenCalled();
    expect(f.legacy).toHaveBeenCalledWith(job, expect.anything(), expect.objectContaining({ agent_id: "zion", tenant_id: tenant }));
    expect(result).toMatchObject({ status: 200, body: { ok: true, answer: "legacy draft" } });
  });
  it("keeps the original default internal draft in the shared cheap class", async () => {
    const f = fixture(), agent = { ...registered, config: {} as typeof registered.config };
    f.setRow(agent); expect((await f.invoke(agent)).body.ok).toBe(true);
    expect(f.fabric.mock.calls[0][0]).toMatchObject({ cognitive_class: "cheap" });
    expect(f.legacy).not.toHaveBeenCalled();
  });
  it.each(["role", "scope", "disabled", "version", "prompt", "config", "foreign", "read"])("%s change refuses the provider instead of using a legacy fallback", async change => {
    const f = fixture();
    if (change === "role") f.setAllowed(false);
    if (change === "scope") f.setScope(false);
    if (change === "disabled") f.setRow({ enabled: false });
    if (change === "version") f.setRow({ version: 3 });
    if (change === "prompt") f.setRow({ system_prompt: "Changed instructions" });
    if (change === "config") f.setRow({ config: { job_kind: "summarize" } });
    if (change === "foreign") f.setRow({ tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    if (change === "read") f.setFailed();
    const result = await f.invoke();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.ok).toBe(false); expect(f.legacy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DB_ERROR");
  });
  it("rechecks current authority and registry each time the existing Fabric invokes its guard", async () => {
    const f = fixture(); await f.invoke();
    const guard = f.fabric.mock.calls[0][1].beforeProviderAttempt!;
    f.setAllowed(false); expect(await guard()).toBe(false);
    f.setAllowed(true); f.setRow({ version: 9 }); expect(await guard()).toBe(false);
    expect(f.permission).toHaveBeenCalledWith(expect.anything(), actor, tenant);
  });
  it("a scope change during the original authority/registry awaits still refuses", async () => {
    const f = fixture(); f.scopeCheck.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await f.invoke()).body.ok).toBe(false); expect(f.legacy).not.toHaveBeenCalled();
  });
  it("a terminal Fabric budget/failure exception never opens a separate legacy route", async () => {
    const f = fixture(); f.fabric.mockRejectedValueOnce(new Error("PRIVATE_BUDGET_DETAIL"));
    const result = await f.invoke(); expect(result.body.ok).toBe(false);
    expect(f.legacy).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain("PRIVATE_BUDGET_DETAIL");
  });
  it.each([{ user_id: undefined }, { user_id: "not-an-actor" }])("missing/malformed original actor cannot start ZION $user_id", async ctx => {
    const f = fixture(), result = await f.invoke(registered, ctx);
    expect(result.status).toBeGreaterThanOrEqual(400); expect(f.fabric).not.toHaveBeenCalled(); expect(f.legacy).not.toHaveBeenCalled();
  });
  it("does not start a tenantless planning model call", async () => {
    const f = fixture(), result = await f.invoke(registered, { user_id: actor }, null);
    expect(result.status).toBeGreaterThanOrEqual(400); expect(f.fabric).not.toHaveBeenCalled(); expect(f.legacy).not.toHaveBeenCalled();
  });
  it("preserves original actorless service drafting without inventing a human role", async () => {
    const f = fixture(), result = await f.invoke(registered, {}, tenant, true);
    expect(result).toMatchObject({ status: 200, body: { ok: true, answer: "canonical draft" } });
    expect(f.permission).not.toHaveBeenCalled(); expect(f.legacy).not.toHaveBeenCalled();
    expect(f.from).toHaveBeenCalledWith("paige_subagents");
  });
  it.each(["scope", "disabled", "version", "foreign"])("actorless service still refuses %s drift", async change => {
    const f = fixture();
    if (change === "scope") f.setScope(false);
    if (change === "disabled") f.setRow({ enabled: false });
    if (change === "version") f.setRow({ version: 4 });
    if (change === "foreign") f.setRow({ tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect((await f.invoke(registered, {}, tenant, true)).body.ok).toBe(false);
    expect(f.legacy).not.toHaveBeenCalled();
  });
  it("service authority does not excuse a malformed or unauthorized named actor", async () => {
    const f = fixture(); expect((await f.invoke(registered, { user_id: "malformed" }, tenant, true)).body.ok).toBe(false);
    f.setAllowed(false); expect((await f.invoke(registered, { user_id: actor }, tenant, true)).body.ok).toBe(false);
    expect(f.legacy).not.toHaveBeenCalled();
  });
  it("preserves the currently missing ZION prompt refusal with no model call", async () => {
    const f = fixture(); await f.invoke({ ...registered, system_prompt: null } as unknown as typeof registered);
    expect(f.fabric).not.toHaveBeenCalled(); expect(f.legacy).not.toHaveBeenCalled();
  });
  it("preserves the original actorless worker and other specialist's existing runtime", async () => {
    const f = fixture(), result = await f.invoke({ ...registered, slug: "existing-drafter" }, {});
    expect(result.status).toBe(200); expect(f.fabric).not.toHaveBeenCalled(); expect(f.legacy).toHaveBeenCalledOnce();
  });
});
