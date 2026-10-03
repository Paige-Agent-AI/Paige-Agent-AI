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

describe("legacy invoice dispatch managed-draft boundary", () => {
  it.each([{ billing_draft_version: 1 }, { billing_draft: {} },
    { billing_draft_version: 0 }, { billing_draft: false },
    { billing_draft_version: 2, billing_draft: { schema_version: 1 } }])(
    "refuses any non-null managed marker before all downstream effects %#", async (marker) => {
      const f = fixture({ ...invoice, ...marker });
      expect(await f.execute({ invoice_id: invoice.id })).toEqual({ ok: false, error: "managed_billing_draft_dispatch_unavailable" });
      expect(f.select.mock.calls).toEqual([["paige_invoices", "*"]]);
      expect(f.admin.from).toHaveBeenCalledTimes(1);
      for (const spy of [f.admin.rpc, f.writes, f.fetch, f.audit, f.address, f.env]) expect(spy).not.toHaveBeenCalled();
    });

  it.each([{}, { billing_draft_version: null, billing_draft: null }])(
    "retains successful legacy dispatch before/after migration %#", async (marker) => {
      const f = fixture({ ...invoice, ...marker });
      const result = await f.execute({ invoice_id: invoice.id });
      expect(result.ok).toBe(true);
      expect(result.data.status).toBe("sent");
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.admin.rpc).toHaveBeenCalledWith("tenant_sender_identity", { _tenant_id: invoice.tenant_id });
      expect(f.writes).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", sent_to_email: "client@example.test" }));
      expect(f.audit).toHaveBeenCalledTimes(1);
    });

  it.each([
    { configured: false, expected: "resend_not_configured" },
    { email: null, expected: "contact_email_missing" },
    { sender: null, expected: "from_address_not_resolved" },
  ])("retains legacy pre-send refusal $expected", async ({ expected, ...options }) => {
    const f = fixture(invoice, options);
    expect(await f.execute({ invoice_id: invoice.id })).toEqual({ ok: false, error: expected });
    for (const spy of [f.fetch, f.writes, f.audit]) expect(spy).not.toHaveBeenCalled();
  });

  it.each(["refused", "throws"] as const)("retains legacy delivery failure %s without success writes", async (delivery) => {
    const f = fixture(invoice, { delivery });
    expect((await f.execute({ invoice_id: invoice.id })).error).toMatch(/^email_send_failed:/);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.writes).not.toHaveBeenCalled();
    expect(f.audit).not.toHaveBeenCalled();
  });

  it.each([
    { row: null, options: {}, expected: "invoice_not_found" },
    { row: invoice, options: { readError: "read refused" }, expected: "read refused" },
    { row: { ...invoice, status: "sent" }, options: {}, expected: "invoice_not_draft:sent" },
  ])("retains initial invoice refusal $expected", async ({ row, options, expected }) => {
    const f = fixture(row, options);
    expect(await f.execute({ invoice_id: invoice.id })).toEqual({ ok: false, error: expected });
    expect(f.admin.from).toHaveBeenCalledTimes(1);
    for (const spy of [f.fetch, f.admin.rpc, f.writes, f.audit]) expect(spy).not.toHaveBeenCalled();
  });
});
