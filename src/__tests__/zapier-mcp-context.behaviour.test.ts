// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
function actualEndpoint(currentTenant = A, adminAllowed = true) {
  const source = readFileSync(resolve("supabase/functions/call-zapier-action/index.ts"), "utf8");
  const ast = ts.createSourceFile("endpoint.ts", source, ts.ScriptTarget.Latest, true);
  const script = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getFullText(ast)).join("\n");
  const compiled = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const admin = { rpc: vi.fn(async () => ({ data: true, error: null })) };
  const user = { auth: { getUser: async () => ({ data: { user: { id: "actor-a" } } }) },
    rpc: vi.fn(async (name: string) => ({ data: name === "is_current_user_tenant_admin" ? adminAllowed : currentTenant, error: null })) };
  const resolver = vi.fn(async () => ({ error: "not_connected", status: 200 }));
  const provider = vi.fn(() => { throw new Error("Unexpected provider operation"); });
  let handler!: (request: Request) => Promise<Response>;
  const ports = {
    createClient: (_url: string, key: string) => key === "service" ? admin : user,
    corsHeaders: {}, jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    mcpListTools: provider, mcpListToolFingerprints: provider, confirmZapierMcpCatalog: provider,
    callApprovedCapability: provider, projectDiscovery: provider, fileGovernedOutcome: provider,
    resolveZapierMcpConnection: resolver, zapierMcpReadAuthorized: provider,
  };
  const runtime = { env: { get: (key: string) => key === "SUPABASE_SERVICE_ROLE_KEY" ? "service" : "anon" },
    serve: (callback: typeof handler) => { handler = callback; } };
  new Function("Deno", ...Object.keys(ports), compiled)(runtime, ...Object.values(ports));
  return { admin, user, resolver, provider, send: async (shape: "list" | "run", expected?: unknown) => {
    const body = { ...(shape === "list" ? { action: "list" } : { tool_name: "send_email", arguments: {} }),
      ...(expected === undefined ? {} : { expected_tenant_id: expected }) };
    const response = await handler(new Request("https://example.test", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fixture" }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  } };
}
describe("actual Zapier endpoint's captured-workspace entry contract", () => {
  it.each([undefined, null, "", "tenant-a", " " + A, 42, {}, A + "/other"])("refuses missing/malformed context before secret or provider I/O: %s", async (expected) => {
    for (const shape of ["list", "run"] as const) {
      const f = actualEndpoint();
      expect(await f.send(shape, expected)).toEqual({ status: 400, body: { error: "context_required" } });
      expect(f.resolver).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
      expect(f.admin.rpc).not.toHaveBeenCalled();
    }
  });
  it.each(["list", "run"] as const)("refuses captured A/current B before any B %s or receipt", async (shape) => {
    const f = actualEndpoint(B);
    expect(await f.send(shape, A)).toEqual({ status: 409, body: { error: "tenant_changed" } });
    expect(f.resolver).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
    expect(f.admin.rpc).not.toHaveBeenCalled();
  });
  it.each(["list", "run"] as const)("matching %s context reaches only the resolved workspace's original resolver", async (shape) => {
    const f = actualEndpoint(B);
    expect(await f.send(shape, B.toUpperCase())).toEqual({ status: 200, body: { ok: false, error: "not_connected" } });
    expect(f.resolver).toHaveBeenCalledWith(f.admin, B, "actor-a");
    expect(f.provider).not.toHaveBeenCalled();
  });
  it("cannot manufacture admin authority with a matching expectation", async () => {
    const f = actualEndpoint(A, false);
    expect(await f.send("run", A)).toEqual({ status: 403, body: { error: "forbidden" } });
    expect(f.resolver).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  });
});
