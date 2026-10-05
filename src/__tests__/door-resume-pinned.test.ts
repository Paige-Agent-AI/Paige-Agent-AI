// C4b — the chat's approval resume hands a door bridge the PINNED proposal (docs/delivery/
// paige-conversational-loop-c4.md §3). What these hold, bridge by bridge: a pinned call never looks
// anything up and never chooses between approvals; it always goes to its door WITH the pinned
// fingerprint (never as an unapproved request, which a door at `auto` would simply execute); it sends
// the door exactly what the door stored; and it reports the approval it handed over (`spent`). A
// pinned row the bridge cannot hand back unchanged is refused before the door, with nothing spent.
// Unpinned calls are unchanged: the Sales bridges still report no `spent` (§58 — the card outcome an
// echoed Sales approval already gets is not altered by this slice).
import { describe, expect, it } from "vitest";
import { dispatchGrowthPublishChat } from "../../supabase/functions/_shared/growth-publish-chat.ts";
import { dispatchSalesInvoiceChat } from "../../supabase/functions/_shared/sales-invoice-chat.ts";
import { dispatchSalesCollectionsChat } from "../../supabase/functions/_shared/sales-collections-chat.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const other = "99999999-9999-4999-8999-999999999999";
const op = "33333333-3333-4333-8333-333333333333";
const invoice = "44444444-4444-4444-8444-444444444444";
const page = "55555555-5555-4555-8555-555555555555";
const fp = "abcdef0123456789";
const turn = { thread_id: null, user_turn_ordinal: 1, user_turn: "Approved — run it." };

/** Dependencies whose approval lookup FAILS THE TEST if a pinned call ever reaches it. */
function deps(answer: { data: unknown; error: unknown } = { data: { ok: true }, error: null }) {
  const invoked: Array<{ name: string; body: Record<string, unknown> }> = [];
  let looked = 0;
  const admin = { from: () => ({ select: () => { looked += 1; throw new Error("a pinned call looked up approvals"); } }) };
  return {
    invoked, looked: () => looked,
    sales: { admin, caller: { rpc: async () => ({ data: null, error: null }), functions: { invoke: async (name: string, o: { body: Record<string, unknown> }) => { invoked.push({ name, body: o.body }); return answer; } } } },
    publish: { admin, invoke: async (body: Record<string, unknown>) => { invoked.push({ name: "growth-publish-command", body }); return answer; } },
  };
}

const voidCommand = { action: "invoice.void", invoice_id: invoice, expected_version: 2, reason: "Issued twice by mistake" };
const voidRow = { command: voidCommand, operation_id: op, expected_tenant_id: tenant, approval_subject: `invoice.void:${invoice}`, approval_cycle_nonce: op };

describe("C4b — a pinned door approval", () => {
  it("Sales invoice: no lookup, the stored command and operation go to the door with the fingerprint, and the approval is reported spent", async () => {
    const d = deps({ data: { ok: true, operation: { id: op, action: "invoice.void" } }, error: null });
    const r = await dispatchSalesInvoiceChat({ tenantId: tenant, userId: "actor", toolName: "sales_void_invoice", args: { invoice_id: invoice, expected_version: 2 },
      approved: new Set([fp]), sameToolCalls: 1, turn, pinned: { fingerprint: fp, args: voidRow } }, d.sales as never);
    expect(d.looked()).toBe(0);
    expect(d.invoked).toEqual([{ name: "sales-invoice-command", body: { expected_tenant_id: tenant, operation_id: op, command: voidCommand, approved_fingerprint: fp } }]);
    expect(r.spent).toBe(fp);
    expect(r.content.success).toBe(true);
  });

  it("Sales invoice: a door that proposes again (its claim found nothing) still reports the approval it was handed", async () => {
    const d = deps({ data: { ok: false, outcome: "approval_required", fingerprint: "f".repeat(16), summary: "Void" }, error: null });
    const r = await dispatchSalesInvoiceChat({ tenantId: tenant, userId: "actor", toolName: "sales_void_invoice", args: {}, approved: new Set([fp]),
      sameToolCalls: 1, turn, pinned: { fingerprint: fp, args: voidRow } }, d.sales as never);
    expect(r.spent).toBe(fp);
    expect(r.content.needs_confirm).toBe(true);
  });

  it("Sales invoice: a pinned row bound to another workspace is refused before the door, nothing spent", async () => {
    const d = deps();
    const r = await dispatchSalesInvoiceChat({ tenantId: tenant, userId: "actor", toolName: "sales_void_invoice", args: {}, approved: new Set([fp]),
      sameToolCalls: 1, turn, pinned: { fingerprint: fp, args: { ...voidRow, expected_tenant_id: other } } }, d.sales as never);
    expect(d.invoked).toEqual([]);
    expect(r.refusal).toBe("unclaimable");
    expect(r.spent).toBeUndefined();
  });

  it("Sales invoice: an UNPINNED approved call is unchanged — it looks the approval up and reports no spent", async () => {
    const invoked: unknown[] = [];
    const q: Record<string, unknown> = {};
    for (const name of ["eq", "in", "is", "not", "gt"]) q[name] = () => q;
    q.limit = async () => ({ data: [{ fingerprint: fp, args: voidRow }], error: null });
    const r = await dispatchSalesInvoiceChat({ tenantId: tenant, userId: "actor", toolName: "sales_void_invoice", args: { invoice_id: invoice, expected_version: 2 },
      approved: new Set([fp]), sameToolCalls: 1, turn }, { admin: { from: () => ({ select: () => q }) },
      caller: { rpc: async () => ({ data: null, error: null }), functions: { invoke: async (_n: string, o: unknown) => { invoked.push(o); return { data: { ok: true }, error: null }; } } } } as never);
    expect(invoked).toHaveLength(1);
    expect(r.spent).toBeUndefined();
  });

  it("Sales draft: no lookup, the stored operation and intent go to the door with the fingerprint, spent reported", async () => {
    const draft = { schema_version: 3, client_id: invoice, items: [{ price_id: null, item: "Commercial service", unit_minor: 350000, quantity: 1 }], kind: "deposit",
      deposit_basis_points: null, deposit_minor: 50000, currency: "usd", cadence: null, recipient_email: "client@example.test", recipient_phone: null,
      email_source_method_id: null, phone_source_method_id: null, billing_address: null, agreement_id: null, processor_intent: null,
      payment_method_intents: [], delivery_channel_intents: ["email"], due_date: "2026-11-01", memo: null };
    const stored = { command: { action: "invoice.draft_create", draft }, operation_id: op, expected_tenant_id: tenant };
    const d = deps({ data: { ok: true, outcome: "draft_created" }, error: null });
    const r = await dispatchSalesInvoiceChat({ tenantId: tenant, userId: "actor", toolName: "billing_create_invoice", args: { draft },
      // sameToolCalls deliberately 2: a pinned call never chooses, so the one-call rule does not apply.
      approved: new Set([fp]), sameToolCalls: 2, turn, pinned: { fingerprint: fp, args: stored } }, d.sales as never);
    expect(d.looked()).toBe(0);
    expect(d.invoked).toHaveLength(1);
    expect(d.invoked[0].name).toBe("sales-invoice-draft-command");
    expect(d.invoked[0].body).toMatchObject({ expected_tenant_id: tenant, operation_id: op, approved_fingerprint: fp, intent: { action: "invoice.draft_create" } });
    expect(r.spent).toBe(fp);
  });

  it("Sales collections: no lookup, the stored command and operation go to the door with the fingerprint, spent reported", async () => {
    const digest = "a".repeat(64);
    const command = { action: "collection.commit_import", batch_id: page, expected_digest: digest };
    const d = deps({ data: { ok: true }, error: null });
    const r = await dispatchSalesCollectionsChat({ tenantId: tenant, userId: "actor", toolName: "sales_commit_collection_import", args: { batch_id: page, expected_digest: digest },
      approved: new Set([fp]), sameToolCalls: 1, turn, pinned: { fingerprint: fp, args: { command, operation_id: op, expected_tenant_id: tenant } } }, d.sales as never);
    expect(d.looked()).toBe(0);
    expect(d.invoked).toEqual([{ name: "sales-collection-command", body: { expected_tenant_id: tenant, operation_id: op, command, approved_fingerprint: fp } }]);
    expect(r.spent).toBe(fp);
  });

  it("publish: no lookup, the stored artifact goes to the door with the fingerprint, whatever id the call names", async () => {
    const stored = { action: "publish", kind: "page", id: page, expected_tenant_id: tenant, approval_subject: `publish:page:${page}`, approval_cycle_nonce: op };
    const d = deps({ data: { ok: true, id: page, status: "published", url: "/p/a" }, error: null });
    const r = await dispatchGrowthPublishChat({ tenantId: tenant, userId: "actor", toolName: "growth_page_publish", args: { page_id: invoice },
      approved: new Set([fp]), sameToolCalls: 3, pinned: { fingerprint: fp, args: stored } }, d.publish as never);
    expect(d.looked()).toBe(0);
    expect(d.invoked).toEqual([{ name: "growth-publish-command", body: { action: "publish", kind: "page", id: page, expected_tenant_id: tenant, chat_attempt: true, approved_fingerprint: fp } }]);
    expect(r.spent).toBe(fp);
    expect(r.approvalUnavailable).toBeUndefined();
  });

  it("publish: the door's APPROVAL_NOT_AVAILABLE is reported to the chat (not to the model); any other refusal is not", async () => {
    const stored = { action: "publish", kind: "page", id: page, expected_tenant_id: tenant };
    const refuse = (code: string) => ({ data: null, error: { context: { json: async () => ({ ok: false, refused: true, code, error: "No." }) } } });
    const unavailable = await dispatchGrowthPublishChat({ tenantId: tenant, userId: "actor", toolName: "growth_page_publish", args: {},
      approved: new Set([fp]), sameToolCalls: 1, pinned: { fingerprint: fp, args: stored } }, deps(refuse("APPROVAL_NOT_AVAILABLE")).publish as never);
    expect(unavailable.approvalUnavailable).toBe(true);
    expect(unavailable.content).not.toHaveProperty("approvalUnavailable");
    const other = await dispatchGrowthPublishChat({ tenantId: tenant, userId: "actor", toolName: "growth_page_publish", args: {},
      approved: new Set([fp]), sameToolCalls: 1, pinned: { fingerprint: fp, args: stored } }, deps(refuse("WORKSPACE_CHANGED")).publish as never);
    expect(other.approvalUnavailable).toBeUndefined();
  });

  it("publish: a pinned row of another kind or workspace is refused before the door", async () => {
    for (const change of [{ kind: "form" }, { expected_tenant_id: other }, { action: "unpublish" }]) {
      const d = deps();
      const r = await dispatchGrowthPublishChat({ tenantId: tenant, userId: "actor", toolName: "growth_page_publish", args: {},
        approved: new Set([fp]), sameToolCalls: 1, pinned: { fingerprint: fp, args: { action: "publish", kind: "page", id: page, expected_tenant_id: tenant, ...change } } }, d.publish as never);
      expect(d.invoked).toEqual([]);
      expect(r.refusal).toBe("unclaimable");
    }
  });
});
