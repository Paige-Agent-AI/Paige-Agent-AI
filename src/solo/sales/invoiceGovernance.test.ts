import { describe, expect, it } from "vitest";
import { decideGovernedExecution, type GovernedDoor } from "../../../supabase/functions/_shared/paige-spine/governedExecution";
import { SALES_INVOICE_ACTIONS } from "../../../supabase/functions/_shared/sales-invoice-command/contract";

const caller = { authenticated: true, userId: "owner", principal: "person" as const, tenantId: "workspace", tenantSource: "server" as const, door: "other" as GovernedDoor, access: { allowed: true } };
const approved = { command: { action: "invoice.record_manual_payment", amount_cents: 1000 }, operation_id: "approved-operation" };
const substituted = { command: { action: "invoice.record_manual_payment", amount_cents: 99999 }, operation_id: "different-operation" };
const decision = (id: string, approval: Record<string, unknown>, overrides = {}) => decideGovernedExecution({ caller, capability: { id, effect: "mutate", outcomeChannel: "record_capability_run", availability: "needs_approval" }, approval: { autonomyLane: "auto", ...approval }, requestArgs: substituted, ...overrides });

describe("Sales financial actions use canonical authority", () => {
  it.each(Object.values(SALES_INVOICE_ACTIONS))("requires a real approval even at auto for %s", id => {
    const result = decision(id, {});
    expect(result.kind).toBe("propose");
    expect(result.audit.laneEffective).toBe("confirm");
  });
  it.each(Object.values(SALES_INVOICE_ACTIONS))("honours the stored approved operation for %s", id => {
    const result = decision(id, { claimedArgs: approved, claimedFor: id });
    expect(result.kind).toBe("execute");
    if (result.kind === "execute") expect(result.args).toBe(approved);
  });
  it("cannot use publication approval for a payment recording", () => expect(decision("sales_record_manual_payment", { claimedArgs: approved, claimedFor: "sales_publish_invoice" })).toMatchObject({ kind: "refuse", code: "approval_claim_capability_mismatch" }));
  it("does not treat a failed claim as approval", () => expect(decision("sales_record_manual_payment", { claimedArgs: null, claimedFor: "sales_record_manual_payment" })).toMatchObject({ kind: "propose", revalidate: true }));
  it("preserves a workspace brake after approval", () => expect(decision("sales_record_manual_payment", { autonomyLane: "off", claimedArgs: approved, claimedFor: "sales_record_manual_payment" })).toMatchObject({ kind: "refuse", code: "autonomy_off" }));
  it("refuses a read-only role even with approval", () => expect(decision("sales_record_manual_payment", { claimedArgs: approved, claimedFor: "sales_record_manual_payment" }, { caller: { ...caller, access: { allowed: false } } })).toMatchObject({ kind: "refuse", code: "access_denied" }));
  it("refuses request-derived tenancy", () => expect(decision("sales_record_manual_payment", {}, { caller: { ...caller, tenantSource: "request" } })).toMatchObject({ kind: "refuse", code: "tenant_not_server_derived" }));
  it("does not grant an automation financial authority", () => expect(decision("sales_record_manual_payment", {}, { caller: { ...caller, principal: "service" } })).toMatchObject({ kind: "refuse", code: "service_principal_may_not_mutate" }));
  it.each(["chat", "other", "agent", "automation", "mcp", "skill"] as GovernedDoor[])("requires the same approval through %s", door => expect(decision("sales_record_manual_payment", {}, { caller: { ...caller, door } }).kind).toBe("propose"));
});
