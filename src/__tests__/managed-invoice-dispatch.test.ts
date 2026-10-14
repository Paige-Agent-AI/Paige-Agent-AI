// @vitest-environment node
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Execute the actual registered production handler, without booting the MCP server
// or importing its Deno/network dependencies. A copied guard would miss ordering bugs.
const source = readFileSync("supabase/functions/paige-mcp/index.ts", "utf8");
const ast = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
let handler: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "mcp.tool"
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "send_invoice") {
    const config = node.arguments[1];
    if (ts.isObjectLiteralExpression(config)) {
      const field = config.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(ast) === "handler");
      if (field && ts.isPropertyAssignment(field)) handler = field.initializer;
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!handler) throw new Error("Production send_invoice handler missing");
const code = ts.transpileModule(`const execute = ${handler.getText(ast)}; return execute;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const invoice = { id: "test-invoice", tenant_id: "test-tenant", contact_id: "test-contact",
  status: "draft", invoice_number: "TEST-1", amount_total_cents: 1200, currency: "USD",
  hosted_invoice_url: null, memo: null };

function fixture(row: Record<string, unknown> | null = invoice, options: {
  readError?: string; configured?: boolean; email?: string | null; sender?: string | null;
  delivery?: "ok" | "refused" | "throws";
} = {}) {
  const select = vi.fn();
  const writes = vi.fn();
  const admin = {
    from: vi.fn((table: string) => ({
      select: (columns: string) => {
        select(table, columns);
        // Model the pre-migration schema: explicitly requesting absent markers fails.
        const error = table === "paige_invoices" && columns.includes("billing_draft")
          ? { message: "column does not exist" }
          : options.readError ? { message: options.readError } : null;
        return { eq: () => ({ maybeSingle: async () => ({
          data: table === "paige_invoices" ? row : { first_name: "Test", email: options.email === undefined ? "client@example.test" : options.email },
          error,
        }) }) };
      },
      update: (value: unknown) => { writes(value); return { eq: vi.fn().mockResolvedValue({ error: null }) }; },
    })),
    rpc: vi.fn().mockResolvedValue({ data: { from_address: options.sender === undefined ? "sender@example.test" : options.sender } }),
  };
  const fetch = vi.fn(async () => {
    if (options.delivery === "throws") throw new Error("delivery unavailable");
    return { ok: options.delivery !== "refused", status: 429, json: async () => ({ message: "rate limited" }) };
  });
  const audit = vi.fn();
  const address = vi.fn((value) => value);
  const env = vi.fn().mockReturnValue("https://app.example.test");
  const execute = new Function("admin", "err", "ok", "CONTACT_METHOD_SELECT", "withPrimaryAddressFields",
    "RESEND_API_KEY", "Deno", "fetch", "audit", "crypto", code)(admin,
    (error: string) => ({ ok: false, error }), (data: unknown) => ({ ok: true, data }), "contact_methods",
    address, options.configured === false ? "" : "test-only", { env: { get: env } }, fetch, audit, webcrypto);
  return { admin, select, writes, fetch, audit, address, env, execute };
}

// #2072 containment (Experience 04): the legacy MCP send path is retired. Whatever the invoice,
// configuration or provider would do, the handler refuses before ANY read, provider call, state
// write or audit — so no customer can be emailed through it and no invoice is marked 'sent'.
const RETIRED = { ok: false, error: "legacy_invoice_send_retired: use the governed Sales invoice delivery" };

describe("legacy invoice dispatch is contained (#2072)", () => {
  it.each([
    { name: "legacy draft that used to send", row: invoice, options: {} },
    { name: "managed draft", row: { ...invoice, billing_draft_version: 1, billing_draft: {} }, options: {} },
    { name: "already sent", row: { ...invoice, status: "sent" }, options: {} },
    { name: "missing invoice", row: null, options: {} },
    { name: "provider not configured", row: invoice, options: { configured: false } },
    { name: "provider would fail", row: invoice, options: { delivery: "throws" as const } },
  ])("refuses with zero effects: $name", async ({ row, options }) => {
    const f = fixture(row, options);
    expect(await f.execute({ invoice_id: invoice.id, custom_message: "<script>x</script>" })).toEqual(RETIRED);
    for (const spy of [f.admin.from, f.select, f.admin.rpc, f.writes, f.fetch, f.audit, f.address, f.env]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("names the governed door instead of pretending to send", () => {
    expect(source).toMatch(/mcp\.tool\("send_invoice", \{\s*description:\s*"Retired\./);
    expect(source).not.toMatch(/\/i\/\$\{inv\.invoice_number\}/);
  });
});
