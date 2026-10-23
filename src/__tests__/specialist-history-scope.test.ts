// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const raw = readFileSync(resolve(__dirname, "../../supabase/functions/paige-orchestrator/index.ts"), "utf8");
const ast = ts.createSourceFile("orchestrator.ts", raw, ts.ScriptTarget.Latest, true);
const selected = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ["rosterHealthMap", "inspectRoster"].includes(n.name?.text ?? ""));
if (selected.length !== 2) throw Error("Original specialist inspection functions required");
const code = ts.transpileModule(selected.map(n => n.getText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const actor = "11111111-1111-4111-8111-111111111111", otherActor = "22222222-2222-4222-8222-222222222222";
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rows = [
  { invoked_by: actor, tenant_id: a, status: "succeeded", error: null },
  { invoked_by: actor, tenant_id: a, status: "failed", error: "own failure" },
  { invoked_by: actor, tenant_id: a, status: "dispatched", error: null },
  { invoked_by: actor, tenant_id: b, status: "succeeded", error: null },
  { invoked_by: actor, tenant_id: b, status: "failed", error: "OTHER_WORKSPACE" },
  { invoked_by: actor, tenant_id: null, status: "failed", error: "UNATTRIBUTED" },
  { invoked_by: otherActor, tenant_id: a, status: "failed", error: "OTHER_ACTOR" },
].map((r, i) => ({ ...r, subagent_slug: "zion", created_at: `2026-10-23T12:00:0${i}Z` }));
function fixture(history = rows) {
  const read = vi.fn((table: string) => {
    let filtered: Record<string, unknown>[] = table === "paige_subagents"
      ? [{ slug: "zion", name: "ZION", domain: "operations", enabled: true, tenant_id: null, config: {} }]
      : history.map(r => ({ ...r }));
    if (!["paige_subagents", "paige_subagent_invocations"].includes(table)) throw Error("Unexpected table");
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filtered = filtered.filter(r => r[key] === value); return chain; },
      is: (key: string, value: unknown) => { filtered = filtered.filter(r => r[key] === value); return chain; },
      in: (key: string, values: unknown[]) => { filtered = filtered.filter(r => values.includes(r[key])); return chain; },
      or: (filter: string) => { const tenant = /^tenant_id\.is\.null,tenant_id\.eq\.(.+)$/.exec(filter)?.[1];
        if (!tenant) throw Error("Unexpected registry filter"); filtered = filtered.filter(r => r.tenant_id === null || r.tenant_id === tenant); return chain; },
      order: (key: string, options?: { ascending?: boolean }) => { filtered.sort((x, y) => String(x[key]).localeCompare(String(y[key])) * (options?.ascending === false ? -1 : 1)); return chain; },
      then: (resolve: (value: unknown) => void) => resolve({ data: filtered, error: null }),
    };
    return chain;
  });
  const inspect = new Function("supabase", "looksLikeFinanceAgent", "pickRoute", "DEFAULT_SUBAGENT_JOB_KIND", `${code}; return inspectRoster;`)(
    { from: read }, () => false, () => ({ tier: "fixture-only" }), "internal_first_draft");
  return { inspect: (tenant: string | null, caller: string | null = actor) => inspect({}, tenant, false, caller), read };
}
describe("original specialist activity belongs to the verified workspace and requester", () => {
  it("cannot mix another workspace or legacy unattributed activity into this business", async () => {
    const f = fixture(), result = await f.inspect(a);
    expect(result[0].health).toEqual({ invocations: 3, success_rate: 0.5, dispatched: 1, last_error: "own failure" });
    expect(JSON.stringify(result)).not.toMatch(/OTHER_WORKSPACE|UNATTRIBUTED|OTHER_ACTOR/);
  });
  it("switching the verified workspace reads its original history without borrowing the first", async () => {
    const f = fixture(), result = await f.inspect(b);
    expect(result[0].health).toEqual({ invocations: 2, success_rate: 0.5, dispatched: 0, last_error: "OTHER_WORKSPACE" });
    expect(JSON.stringify(result)).not.toMatch(/own failure|UNATTRIBUTED|OTHER_ACTOR/);
  });
  it("a platform-only inspection cannot collect tenant-bound business activity", async () => {
    const result = await fixture().inspect(null);
    expect(result[0].health).toEqual({ invocations: 1, success_rate: 0, dispatched: 0, last_error: "UNATTRIBUTED" });
  });
  it("no verified requester performs no privileged invocation-history read", async () => {
    const f = fixture(); await f.inspect(a, null);
    expect(f.read.mock.calls.map(([table]) => table)).toEqual(["paige_subagents"]);
  });
  it("a genuinely empty selected workspace does not borrow the requester's other runs", async () => {
    const result = await fixture(rows.filter(r => r.tenant_id !== a)).inspect(a);
    expect(result[0].health).toEqual({ invocations: 0, success_rate: null, dispatched: 0, last_error: null });
  });
});
