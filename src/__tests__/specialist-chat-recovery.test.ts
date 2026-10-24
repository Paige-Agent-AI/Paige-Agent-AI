// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(__dirname, "../../supabase/functions/paige-ai-chat/index.ts"), "utf8");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
let specialist = "", hold = "";
function find(node: ts.Node) {
  if (ts.isIfStatement(node)) {
    const condition = node.expression.getText(ast);
    if (condition === 'tc.function.name === "list_subagents" || tc.function.name === "delegate_to_subagent"') specialist = node.thenStatement.getText(ast);
    if (condition.startsWith("MUTATING_TOOLS.has(tc.function.name) && (requestExecutionState.needsReview")) hold = node.getText(ast);
  }
  ts.forEachChild(node, find);
}
find(ast);
if (!specialist || !hold) throw Error("Original specialist dispatch and reconciliation guard must be found");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const dispatch = new AsyncFunction("tc", "toolResults", "requestExecutionState", "fetch", "authorityAdmits", "authorityForCall",
  "WORKSPACE_BUILD_TOOLS", "supabaseUrl", "supabaseServiceKey", "personaCtx", "user", "OUTCOME_UNKNOWN_NOTE", "authHeader", "supabaseKey",
  ts.transpileModule(`for (let once=0;once<1;once++) ${specialist}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
const nextWrite = new Function("tc", "toolResults", "requestExecutionState", "write",
  ts.transpileModule(`const MUTATING_TOOLS=new Set(["crm_create_contact"]),interactive=false,interactiveReceiptScanSaturated=false,interactiveUnresolvedEffects=[];
    for(let once=0;once<1;once++){ ${hold} write(); }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
const invocation = "33333333-3333-4333-8333-333333333333";
const note = "Inspect the original outcome before repeating work.";
async function execute(payload: unknown, options: { tool?: string; throws?: boolean; raw?: boolean; args?: string; allowed?: boolean; needsReview?: boolean } = {}) {
  const state = { needsReview: options.needsReview ?? false }, results: { content: string }[] = [];
  const fetcher = vi.fn(async (_url?: string, _init?: RequestInit) => { if (options.throws) throw new TypeError("fetch failed");
    return new Response(options.raw ? "not-json" : JSON.stringify(payload)); });
  await dispatch({ id: "original-tool", function: { name: options.tool ?? "delegate_to_subagent", arguments: options.args ?? '{"slug":"zion","input":{}}' } },
    results, state, fetcher, () => options.allowed !== false, async () => ({}), new Set(), "https://fixture.invalid", "synthetic",
    { tenant_id: "aaaaaaaa-1111-4000-8000-0000000000aa" }, { id: "synthetic-owner" }, note, "Bearer ordinary-session", "ordinary-public-key");
  const write = vi.fn();
  nextWrite({ id: "later-tool", function: { name: "crm_create_contact" } }, results, state, write);
  return { state, results, write, fetcher };
}
describe("original Chat specialist uncertainty and next-write guard", () => {
  it("reads an original assignment using only the person's JWT and selected business", async () => {
    const f = await execute({ ok: true, invocation: { id: invocation, receipt_state: "verified" } }, {
      tool: "list_subagents", args: JSON.stringify({ invocation_id: invocation, tenant_id: "foreign", context: { user_id: "foreign" } }),
    });
    const init = f.fetcher.mock.calls[0][1]!;
    expect(init.headers).toMatchObject({ Authorization: "Bearer ordinary-session", apikey: "ordinary-public-key" });
    expect(JSON.parse(String(init.body))).toMatchObject({ action: "tool_search", invocation_id: invocation, tenant_id: "aaaaaaaa-1111-4000-8000-0000000000aa" });
    expect(JSON.parse(String(init.body)).context).toBeUndefined(); expect(f.fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(f.results[0].content).invocation.id).toBe(invocation); expect(f.state.needsReview).toBe(false);
  });
  it("discovers recent original identities without dispatching another assignment", async () => {
    const f = await execute({ ok: true, recent_invocations: [{ id: invocation }], sample_only: true }, {
      tool: "list_subagents", args: '{"recent_assignments":true}',
    });
    const init = f.fetcher.mock.calls[0][1]!;
    expect(init.headers).toMatchObject({ Authorization: "Bearer ordinary-session" });
    expect(JSON.parse(String(init.body))).toMatchObject({ action: "tool_search", recent_assignments: true });
    expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.state.needsReview).toBe(false);
  });
  it("inspection cannot clear an existing uncertain-effect hold or authorize a later action", async () => {
    const f = await execute({ ok: true, invocation: { id: invocation, receipt_state: "verified" } }, {
      tool: "list_subagents", args: JSON.stringify({ invocation_id: invocation }), needsReview: true,
    });
    expect(f.state.needsReview).toBe(true); expect(f.write).not.toHaveBeenCalled();
  });
  it("legacy roster reads retain their original transport and never claim an assignment result", async () => {
    const f = await execute({ ok: true, matches: [] }, { tool: "list_subagents", args: "{}" });
    const init = f.fetcher.mock.calls[0][1]!;
    expect(init.headers).toMatchObject({ Authorization: "Bearer synthetic", apikey: "synthetic" });
    const body = JSON.parse(String(init.body)); expect(body.action).toBe("tool_search");
    expect(body.invocation_id).toBeUndefined(); expect(body.recent_assignments).toBeUndefined();
    expect(JSON.parse(f.results[0].content).invocation).toBeUndefined();
  });
  it.each([
    { ok: false, outcome_unknown: true, invocation_id: invocation },
    { ok: false, outcome_unknown: true, outcome_recorded: true, receipt_unverified: true, invocation_id: invocation },
  ])("holds the actual next mutator after an unconfirmed specialist outcome %j", async payload => {
    const f = await execute(payload);
    expect(f.state.needsReview).toBe(true); expect(f.write).not.toHaveBeenCalled();
    expect(JSON.parse(f.results.at(-1)!.content).error).toBe("prior_effect_reconciliation_required");
    expect(JSON.parse(f.results[0].content).invocation_id).toBe(invocation);
  });
  it.each([{ throws: true }, { raw: true }])("lost/malformed post-dispatch response stays unknown %j", async options => {
    const f = await execute(null, options);
    expect(f.state.needsReview).toBe(true); expect(f.write).not.toHaveBeenCalled();
    expect(JSON.parse(f.results[0].content)).toMatchObject({ outcome_unknown: true, note });
  });
  it("does not treat an asynchronous dispatch as completed specialist work", async () => {
    const f = await execute({ ok: true, runtime: "langgraph", invocation_id: invocation, receipt_recorded: true });
    expect(f.state.needsReview).toBe(true); expect(f.write).not.toHaveBeenCalled();
  });
  it("preserves confirmed original success and failed/refused outcomes", async () => {
    for (const payload of [{ ok: true, invocation_id: invocation, receipt_recorded: true },
      { ok: false, not_applied: true }, { ok: false, runtime: "soft", invocation_id: invocation, receipt_recorded: true }]) {
      const f = await execute(payload); expect(f.state.needsReview).toBe(false); expect(f.write).toHaveBeenCalledOnce();
    }
  });
  it.each([{ tool: "list_subagents", throws: true }, { args: "invalid" }, { allowed: false }])("read/pre-dispatch refusal cannot invent an uncertain effect %j", async options => {
    const f = await execute({ ok: false }, options);
    expect(f.state.needsReview).toBe(false); expect(f.write).toHaveBeenCalledOnce();
    if (options.args || options.allowed === false) expect(f.fetcher).not.toHaveBeenCalled();
  });
});
