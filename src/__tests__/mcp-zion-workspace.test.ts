// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const ast = ts.createSourceFile("mcp.ts", readFileSync(resolve(__dirname, "../../supabase/functions/paige-mcp/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const declarations = ast.statements.filter(ts.isExpressionStatement).map(n => n.expression)
  .filter((n): n is ts.CallExpression => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
    && n.expression.expression.getText(ast) === "mcp" && n.expression.name.text === "tool"
    && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === "delegate_to_subagent");
if (declarations.length !== 1 || !ts.isObjectLiteralExpression(declarations[0].arguments[1])) throw Error("Original MCP delegate declaration required");
const property = declarations[0].arguments[1].properties.find(n => ts.isPropertyAssignment(n) && n.name.getText(ast) === "handler");
if (!property || !ts.isPropertyAssignment(property)) throw Error("Original delegate handler required");
const code = ts.transpileModule(`const handler = ${property.initializer.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const actor = "11111111-1111-4111-8111-111111111111", tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fixture(workspace: string | null = tenant, unavailable = false) {
  const scope = vi.fn(async () => { if (unavailable) throw Error("PRIVATE_SCOPE_DETAIL"); return workspace; });
  const transport = vi.fn(async (_body: unknown) => ({ status: 200, body: { ok: true } }));
  const run = new Function("currentActor", "actorTenantId", "callOrchestrator", "audit", "ok", "err", `${code}; return handler;`)(
    () => ({ kind: "user", user_id: actor }), scope, transport, vi.fn(async () => undefined),
    (result: unknown) => ({ ok: true, result }), (error: string) => ({ ok: false, error }));
  return { scope, transport, run };
}
describe("original MCP ZION delegation carries only the server-resolved workspace", () => {
  it("contact-free planning carries the current original actor and workspace", async () => {
    const f = fixture(); await f.run({ slug: "zion", input: { request: "Prepare a weekly plan" } });
    expect(f.scope).toHaveBeenCalledOnce();
    expect(f.transport).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: tenant, context: expect.objectContaining({ user_id: actor }) }));
  });
  it("a nested foreign tenant cannot steer the original workspace selector", async () => {
    const f = fixture(); await f.run({ slug: "zion", input: { tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } });
    expect(f.transport.mock.calls[0][0]).toMatchObject({ tenant_id: tenant });
  });
  it.each([false, true])("missing/unavailable current workspace refuses before transport (%s)", async unavailable => {
    const f = fixture(null, unavailable), result = await f.run({ slug: "zion", input: {} });
    expect(result.ok).toBe(false); expect(f.transport).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SCOPE_DETAIL");
  });
  it("the original other-specialist contact binder still receives its server workspace and selected contact", async () => {
    const f = fixture(), contact = "22222222-2222-4222-8222-222222222222";
    await f.run({ slug: "email-composer", contact_id: contact, input: {} });
    expect(f.transport).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: tenant, input: { contact_id: contact } }));
  });
  it("does not alter other contact-free specialist routing", async () => {
    const f = fixture(); await f.run({ slug: "existing-drafter", input: {} });
    expect(f.scope).not.toHaveBeenCalled(); expect(f.transport.mock.calls[0][0]).not.toHaveProperty("tenant_id");
  });
  it("malformed original input is refused before scope resolution or transport", async () => {
    const f = fixture(), result = await f.run({ slug: "zion", input: "[not-json" });
    expect(result.ok).toBe(false); expect(f.scope).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
  });
});
