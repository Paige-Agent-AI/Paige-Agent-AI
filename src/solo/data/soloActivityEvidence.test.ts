import { describe, expect, it } from "vitest";
import { readActivityEvidence } from "../../../supabase/functions/_shared/paige-context/activity-evidence";

const eventId = "11111111-1111-4111-8111-111111111111";
const receiptId = "22222222-2222-4222-8222-222222222222";
const targetId = "33333333-3333-4333-8333-333333333333";
const playId = "44444444-4444-4444-8444-444444444444";
const source = () => ({ version: 1, kind: "verified_original_result", rail_receipt_id: eventId,
  recorded_outcome: "capability_succeeded", business_result: { kind: "target_revision", receipt_id: receiptId,
    target_id: targetId, revision: 2, state: "active", operation: "target_revise" },
  record_links: [{ destination: "business_game_plan", record_id: playId }] });

describe("original activity evidence validation", () => {
  it.each([undefined, null])("keeps absent legacy evidence distinct from invalid data", raw => {
    expect(readActivityEvidence(raw, eventId)).toEqual({ state: "not_provided" });
  });
  it("retains only original typed identities and the existing semantic reference", () => {
    const result = readActivityEvidence({ ...source(), raw_secret: "never expose", actor_id: "not a presentation field" }, eventId);
    expect(result).toEqual({ state: "ready", evidence: { kind: "verified_original_result", railReceiptId: eventId,
      recordedOutcome: "capability_succeeded", businessResult: { kind: "target_revision", receiptId, targetId,
        revision: 2, state: "active", operation: "target_revise" }, recordLinks: [{ destination: "business_game_plan", record_id: playId }] } });
    expect(JSON.stringify(result)).not.toContain("never expose");
    expect(JSON.stringify(result)).not.toContain("actor_id");
  });
  it("keeps a successful capability read separate from a business result", () => {
    const raw = { ...source(), kind: "recorded_outcome", business_result: null, record_links: [], verified: true };
    const result = readActivityEvidence(raw, eventId);
    expect(result.state === "ready" && result.evidence.businessResult).toBeNull();
    expect(result.state === "ready" && result.evidence.kind).toBe("recorded_outcome");
  });
  it.each([
    { version: 2 }, { kind: "future_result" }, { rail_receipt_id: receiptId }, { recorded_outcome: "approved_and_paid" },
    { record_links: [{ destination: "finance", record_id: playId }] },
    { record_links: [{ destination: "business_game_plan", record_id: "https://example.invalid" }] },
    { record_links: [{ destination: "business_game_plan", record_id: playId, record_kind: "planning_item" }] },
    { record_links: [] }, { business_result: null },
  ])("rejects mismatched or unsupported evidence instead of inventing a link (%j)", patch => {
    expect(readActivityEvidence({ ...source(), ...patch }, eventId)).toEqual({ state: "invalid" });
  });
  it.each([{ revision: 0 }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { state: "met" },
    { operation: "send_payment" }, { state: ["active"] }, { operation: ["target_revise"] },
    { receipt_id: null }, { target_id: "not a target" }])("withholds malformed original results (%j)", patch => {
    const raw = source();
    expect(readActivityEvidence({ ...raw, business_result: { ...raw.business_result, ...patch } }, eventId)).toEqual({ state: "invalid" });
  });
  it("never turns a recorded-only row with injected result fields into verified work", () => {
    expect(readActivityEvidence({ ...source(), kind: "recorded_outcome" }, eventId)).toEqual({ state: "invalid" });
  });
});
