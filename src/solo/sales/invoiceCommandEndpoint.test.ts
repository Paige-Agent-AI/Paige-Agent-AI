import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, expect, it } from "vitest";
import { decideDeclaredCapability } from "../../../supabase/functions/_shared/capability-kit/decision";
import { SALES_INVOICE_KIT_BY_ACTION } from "../../../supabase/functions/_shared/paige-spine/domains/sales_invoice";
import { FINGERPRINT, UUID, SALES_INVOICE_ACTIONS, parseSalesInvoiceCommand } from "../../../supabase/functions/_shared/sales-invoice-command/contract";
import { PAIGE_APP_ORIGIN } from "../../../supabase/functions/_shared/canonical-app-url";
import { invoicePublicOriginReady } from "../../../supabase/functions/_shared/sales-invoice-delivery/binding";

const tenant = "10000000-0000-4000-8000-000000000001";
const operation = "20000000-0000-4000-8000-000000000001";
const command = { action: "invoice.record_manual_payment", invoice_id: "30000000-0000-4000-8000-000000000001", expected_version: 2, amount_cents: 1000, currency: "usd", method: "cash", received_at: "2026-10-03T12:00:00.000Z" };
const source = readFileSync("supabase/functions/sales-invoice-command/index.ts", "utf8").replace(/^import .*;\r?\n/gm, "");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

type Setup = { role?: string; currentTenant?: string; replay?: unknown; auditFails?: boolean; claimed?: unknown; pendingCycle?: unknown; executeError?: unknown; authenticated?: boolean; deliveryResult?: unknown; publicOrigin?: string; };
function setup(options: Setup = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const claims: Record<string, unknown>[][] = [];
  let handler: (request: Request) => Promise<Response>;
  const caller = { auth: { getUser: async () => ({ data: { user: options.authenticated === false ? null : { id: "owner" } }, error: null }) }, rpc: async (name: string) => ({ data: name === "current_user_tenant_id" ? options.currentTenant ?? tenant : "auto", error: null }) };
  const admin = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "read_sales_invoice_command_result" || name === "read_sales_invoice_delivery_result") return { data: options.replay ?? null, error: null };
      if (name === "preview_sales_invoice_command" || name === "preview_sales_invoice_delivery_command") return { data: { eligible: true, summary: "Review the exact commercial action" }, error: null };
      return { data: { ok: true, row: { status: "issued", outstanding_cents: 9000 } }, error: options.executeError ?? null };
    },
    from: (table: string) => {
      const filters: Record<string, unknown>[] = [];
      let mutation = "";
      const builder: Record<string, unknown> = {};
      for (const method of ["eq", "is", "not", "neq", "gt", "lte", "contains", "order", "limit"]) builder[method] = (...args: unknown[]) => { filters.push({ method, args }); return builder; };
      builder.select = () => builder;
      builder.update = () => { mutation = "update"; return builder; };
      builder.insert = (args: unknown) => {
        calls.push({ name: `insert:${table}`, args });
        mutation = "insert";
        return builder;
      };
      builder.maybeSingle = async () => {
        if (table === "tenant_members") return { data: { role: options.role ?? "owner", status: "active" }, error: null };
        if (mutation === "update") { claims.push(filters); return { data: options.claimed ? { args: options.claimed } : null, error: null }; }
        if (table === "paige_pending_confirmations" && !mutation) { calls.push({ name: "pending-cycle", args: filters }); return { data: options.pendingCycle ? { args: options.pendingCycle } : null, error: null }; }
        return { data: { summary: "Review payment", expires_at: "2026-10-03T13:00:00Z" }, error: null };
      };
      builder.then = (resolve: (value: {error: {code:string}|null}) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ error: table === "paige_audit_log" && options.auditFails ? { code: "failure" } : null }).then(resolve, reject);
      return builder;
    },
  };
  const scope = {
    Deno: { env: { get: (key: string) => key }, serve: (fn: typeof handler) => { handler = fn; } },
    createClient: (_url: string, key: string) => key === "SUPABASE_ANON_KEY" ? caller : admin,
    confirmFingerprint: async () => "1234567890abcdef", decideDeclaredCapability, SALES_INVOICE_KIT_BY_ACTION,
    databaseAnswered: (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"),
    mintSignerToken: () => "one-time-secret", sha256Hex: async () => "a".repeat(64),
    executeSalesInvoiceDelivery: async (args: unknown) => { calls.push({ name: "delivery", args }); return options.deliveryResult ?? { ok: true, outcome: "provider_accepted", provider_receipt_available: true, delivery_confirmed: false }; },
    FINGERPRINT, UUID, SALES_INVOICE_ACTIONS, parseSalesInvoiceCommand,
    PAIGE_APP_ORIGIN: options.publicOrigin ?? PAIGE_APP_ORIGIN, invoicePublicOriginReady,
  };
  // Execute the production handler itself, substituting only network/runtime boundaries.
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const request = async (extra: Record<string, unknown> = {}) => {
    const response = await handler!(new Request("https://example.test/sales-invoice-command", { method: "POST", headers: { Authorization: "Bearer signed-session" }, body: JSON.stringify({ expected_tenant_id: tenant, operation_id: operation, command, ...extra }) }));
    return { status: response.status, body: await response.json() };
  };
  const details=(name:string)=>{const value=calls.find(call=>call.name===name)?.args;if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Missing call '+name);return value as Record<string,unknown>;};
  return { request, calls, claims, details };
}

describe("actual invoice HTTP adapter authority and recovery", () => {
  it("refuses an unsigned caller before any business RPC", async () => {
    const test = setup({ authenticated: false });
    expect((await test.request()).status).toBe(401); expect(test.calls).toEqual([]);
  });
  it("refuses a workspace switch before any invoice read", async () => {
    const test = setup({ currentTenant: "another-workspace" });
    expect((await test.request()).body.code).toBe("WORKSPACE_CHANGED"); expect(test.calls).toEqual([]);
  });
  it("refuses a read-only member before invoice read or approval", async () => {
    const test = setup({ role: "member" });
    expect((await test.request()).status).toBe(403); expect(test.calls).toEqual([]);
  });
  it("refuses request-authored authority", async () => {
    const test = setup();
    expect((await test.request({ governance: { approved: true } })).status).toBe(400); expect(test.calls).toEqual([]);
  });
  it("replays a committed receipt before consuming approval or checking current balance", async () => {
    const test = setup({ replay: { ok: true, payment: { id: operation } } });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body).toMatchObject({ ok: true, replayed: true });
    expect(test.calls.map(call => call.name)).toEqual(["read_sales_invoice_command_result"]); expect(test.claims).toEqual([]);
  });
  it("proposes a high-risk partial receipt rather than treating auto as approval", async () => {
    const test = setup();
    expect((await test.request()).body).toMatchObject({ outcome: "approval_required", fingerprint: "1234567890abcdef" });
    expect(test.calls.some(call => call.name === "execute_sales_invoice_command")).toBe(false);
  });
  it("creates a fresh approval cycle without changing an unrecorded receipt operation", async () => {
    const test = setup();
    expect((await test.request()).body.outcome).toBe("approval_required");
    const stored = test.details("insert:paige_pending_confirmations").args as Record<string,unknown>;
    expect(stored).toMatchObject({ command, operation_id: operation, expected_tenant_id: tenant });
    expect(stored.approval_cycle_nonce).toMatch(UUID);
    expect(test.claims).toEqual([]);
  });
  it("reuses the existing exact server-issued receipt proposal cycle", async () => {
    const cycle = { command, operation_id: operation, expected_tenant_id: tenant, approval_subject: `invoice.record_manual_payment:${command.invoice_id}`, approval_cycle_nonce: command.invoice_id };
    const test = setup({ pendingCycle: cycle });
    expect((await test.request()).body.outcome).toBe("approval_required");
    expect(test.details("insert:paige_pending_confirmations")).toMatchObject({args:{approval_cycle_nonce:command.invoice_id}});
  });
  it("does not reuse a proposal cycle with a different receipt amount", async () => {
    const test = setup({ pendingCycle: { command: { ...command, amount_cents: 500 }, operation_id: operation, expected_tenant_id: tenant, approval_subject: `invoice.record_manual_payment:${command.invoice_id}`, approval_cycle_nonce: command.invoice_id } });
    expect((await test.request()).body.code).toBe("APPROVAL_CYCLE_INVALID");
    expect(test.calls.some(call => call.name === "delivery" || call.name === "execute_sales_invoice_command")).toBe(false);
  });
  it("executes stored amount and operation after a fenced single-use claim", async () => {
    const stored = { command: { ...command, amount_cents: 500 }, operation_id: "20000000-0000-4000-8000-000000000002", expected_tenant_id: tenant };
    const test = setup({ claimed: stored });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body.ok).toBe(true);
    expect(test.calls.find(call => call.name === "execute_sales_invoice_command")?.args).toMatchObject({ _operation_id: stored.operation_id, _command: { amount_cents: 500 }, _governance: { approval_channel: "operator_card", decision_receipt_recorded: true } });
    expect(test.claims[0]).toEqual(expect.arrayContaining([
      { method: "eq", args: ["user_id", "owner"] }, { method: "eq", args: ["tenant_id", tenant] },
      { method: "eq", args: ["tool_name", "sales_record_manual_payment"] },
      { method: "is", args: ["consumed_at", null] }, { method: "is", args: ["thread_id", null] }, { method: "is", args: ["scoped_client_id", null] },
      { method: "not", args: ["server_issued_at", "is", null] }, { method: "not", args: ["issued_in_request", "is", null] },
    ]));
  });
  it("fails closed if the decision receipt cannot be persisted", async () => {
    const test = setup({ auditFails: true, claimed: { command, operation_id: operation, expected_tenant_id: tenant } });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body.code).toBe("SALES_DECISION_RECEIPT_FAILED");
    expect(test.calls.some(call => call.name === "execute_sales_invoice_command")).toBe(false);
  });
  it("rejects a claimed operation from a different tenant", async () => {
    const test = setup({ claimed: { command, operation_id: operation, expected_tenant_id: "different-tenant" } });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body.code).toBe("APPROVAL_CLAIM_INVALID");
    expect(test.calls.some(call => call.name === "execute_sales_invoice_command")).toBe(false);
  });
  it("returns a share token once without persisting its plaintext", async () => {
    const link = { action: "invoice.link_create", invoice_id: command.invoice_id, expected_version: 2, expires_in_days: 7, grant_scope: "share" };
    const test = setup({ claimed: { command: link, operation_id: operation, expected_tenant_id: tenant } });
    expect((await test.request({ command: link, approved_fingerprint: "1234567890abcdef" })).body.access_token).toBe("one-time-secret");
    expect(JSON.stringify(test.calls)).not.toContain("one-time-secret");
    expect(test.details("execute_sales_invoice_command")).toMatchObject({_governance:{generated_link:{token_hash:"a".repeat(64)}}});
  });
  it("does not remint a bearer secret when recovering a committed link operation", async () => {
    const link = { action: "invoice.link_create", invoice_id: command.invoice_id, expected_version: 2, expires_in_days: 7, grant_scope: "share" };
    const test = setup({ replay: { ok: true, link: { grant_id: operation } } });
    const result = await test.request({ command: link });
    expect(result.body).toMatchObject({ replayed: true, link_recovery_required: true });
    expect(result.body.access_token).toBeUndefined();
    expect(test.calls.map(call => call.name)).toEqual(["read_sales_invoice_command_result"]);
  });
  it("does not turn a missing database response into a safe retry claim", async () => {
    const test = setup({ claimed: { command, operation_id: operation, expected_tenant_id: tenant }, executeError: { message: "Network response lost" } });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body).toMatchObject({ outcome: "outcome_unknown", operation_id: operation });
  });
  it("returns a known database rejection as refused", async () => {
    const test = setup({ claimed: { command, operation_id: operation, expected_tenant_id: tenant }, executeError: { code: "23514" } });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body.outcome).toBe("refused");
  });
  it("cannot dispatch invoice email without a canonical claim", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const test = setup();
    expect((await test.request({ command: email })).body.outcome).toBe("approval_required");
    expect(test.calls.some(call => call.name === "delivery")).toBe(false);
    expect(test.calls.map(call => call.name)).toContain("preview_sales_invoice_delivery_command");
  });
  it("fails readiness before approval if the controlled document origin is invalid", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const test = setup({ publicOrigin: "https://arbitrary.example/path?token=untrusted" });
    expect((await test.request({ command: email })).body.outcome).toBe("needs_setup");
    expect(test.calls.some(call => call.name === "delivery" || call.name === "insert:paige_pending_confirmations")).toBe(false);
  });
  it("uses the approved connector and command for the sole delivery executor", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const approvedEmail = { ...email, connector_id: command.invoice_id };
    const test = setup({ claimed: { command: approvedEmail, operation_id: operation, expected_tenant_id: tenant } });
    expect((await test.request({ command: email, approved_fingerprint: "1234567890abcdef" })).body).toMatchObject({ ok: true, outcome: "provider_accepted", delivery_confirmed: false });
    expect(test.calls.find(call => call.name === "delivery")?.args).toMatchObject({ command: { connector_id: command.invoice_id }, governance: { tool: "billing_send_invoice", approval_channel: "operator_card" } });
    expect(test.calls.some(call => call.name === "execute_sales_invoice_command")).toBe(false);
  });
  it("recovers accepted delivery without dispatching again", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const test = setup({ replay: { ok: true, outcome: "provider_accepted" } });
    expect((await test.request({ command: email })).body).toMatchObject({ replayed: true, outcome: "provider_accepted" });
    expect(test.calls.map(call => call.name)).toEqual(["read_sales_invoice_delivery_result"]);
  });
  it("requires a fresh server-authored approval cycle for prepared delivery", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const test = setup({ replay: { ok: false, outcome: "prepared" } });
    expect((await test.request({ command: email })).body.outcome).toBe("approval_required");
    const args = test.details("insert:paige_pending_confirmations").args as Record<string,unknown>;
    expect(args).toMatchObject({ command: email, operation_id: operation, expected_tenant_id: tenant });
    expect(args.approval_cycle_nonce).toMatch(UUID);
    expect(test.calls.some(call => call.name === "delivery")).toBe(false);
  });
  it("reuses and redeems the exact prepared recovery cycle", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const cycle = { command: email, operation_id: operation, expected_tenant_id: tenant, approval_subject: `invoice.email_send:${command.invoice_id}`, approval_cycle_nonce: command.invoice_id };
    const test = setup({ replay: { ok: false, outcome: "prepared" }, pendingCycle: cycle, claimed: cycle });
    expect((await test.request({ command: email, approved_fingerprint: "1234567890abcdef" })).body.outcome).toBe("provider_accepted");
    expect(test.details("delivery").operationId).toBe(operation);
  });
  it.each(["unknown", "dispatching"])("never re-dispatches %s delivery on recovery", async outcome => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const test = setup({ replay: { ok: false, outcome } });
    expect((await test.request({ command: email })).body).toMatchObject({ outcome, replayed: true });
    expect(test.calls.map(call => call.name)).toEqual(["read_sales_invoice_delivery_result"]);
  });
});
