import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Execute the original door's actual pre-parser statements, including Auth.
// The existing legacy command parser is deliberately outside this read-only test.
const source = readFileSync("supabase/functions/crm-command/index.ts", "utf8");
const ast = ts.createSourceFile("door.ts", source, ts.ScriptTarget.Latest, true);
let handler: ts.ArrowFunction | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "serve") {
    const candidate = node.arguments[0];
    if (ts.isArrowFunction(candidate)) handler = candidate;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!handler || !ts.isBlock(handler.body)) throw Error("Original CRM handler missing");
const boundary = handler.body.statements.findIndex(s => ts.isTypeAliasDeclaration(s) && s.name.text === "ParsedBody");
if (boundary < 0) throw Error("Original command boundary missing");
const code = ts.transpileModule(`async function run(req) {
${handler.body.statements.slice(0, boundary).map(s => s.getText(ast)).join("\n")}
return { legacy: true, body: await req.json() };
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const ACTOR = "e4000000-0000-4000-8000-000000000001";
function world(authorized = true) {
  const caller = { auth: { getUser: vi.fn(async () => ({ data: { user: authorized ? { id: ACTOR } : null }, error: null })) } };
  const admin = {};
  const inspect = vi.fn(async () => ({ status: 200, body: { ok: true, outcome: "recorded" } }));
  let clients = 0;
  const run = new Function("createClient", "Deno", "response", "cors", "inspectOpportunityResult", `${code};return run;`)(
    () => clients++ === 0 ? caller : admin, { env: { get: () => "fixture" } },
    (status: number, body: unknown) => ({ status, body }), {}, inspect,
  );
  const request = (body: unknown, auth = true) => new Request("https://fixture.invalid/crm-command", {
    method: "POST", headers: { ...(auth ? { Authorization: "Bearer fixture" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { caller, admin, inspect, run, request };
}
describe("original CRM authenticated inspection entry", () => {
  it("passes only the verified server actor and original clients to the reader", async () => {
    const w = world(), raw = { inspect_opportunity_result: { deal_id: "fixture" }, actorId: "forged" };
    expect(await w.run(w.request(raw))).toEqual({ status: 200, body: { ok: true, outcome: "recorded" } });
    expect(w.caller.auth.getUser).toHaveBeenCalledTimes(1);
    expect(w.inspect).toHaveBeenCalledWith({ raw, actorId: ACTOR, caller: w.caller, admin: w.admin });
  });
  it.each([false, true])("requires actual authentication before inspection (header %s)", async header => {
    const w = world(false), answer = await w.run(w.request({ inspect_opportunity_result: {} }, header));
    expect(answer.status).toBe(401); expect(w.inspect).not.toHaveBeenCalled();
  });
  it.each([null, false, {}, { command: { action: "deal.update" }, idempotency_key: "original" }])(
    "does not consume or alter the ordinary command body %j", async raw => {
      const w = world(); expect(await w.run(w.request(raw))).toEqual({ legacy: true, body: raw });
      expect(w.inspect).not.toHaveBeenCalled();
    });
  it("never falls through to a mutation when a malformed inspection flag is present", async () => {
    const w = world(); w.inspect.mockResolvedValueOnce({ status: 400, body: { ok: false, outcome: "refused" } });
    expect(await w.run(w.request({ inspect_opportunity_result: null, command: { action: "deal.update" } }))).toEqual({ status: 400, body: { ok: false, outcome: "refused" } });
    expect(w.inspect).toHaveBeenCalledTimes(1);
  });
});
