// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { stableRunId } from "../../supabase/functions/_shared/capability-record";
import { actReceiptRunSeed } from "../../supabase/functions/_shared/paige-orchestration/outcomes";
import { weeklyCommitmentExecutor } from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-adapter";
import type { DispatchInput } from "../../supabase/functions/_shared/paige-orchestration/adapters";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const original = { tenantId: id(1), subjectId: id(2), eventId: id(3), actId: id(4), correlationRef: "original-weekly-occurrence" };
async function invoke(over: Record<string, unknown> = {}, readback = false, detailOver: Record<string, unknown> = {},
  port: { error?: { code: string; message: string }; throws?: boolean } = {}) {
  const receipt = await stableRunId(actReceiptRunSeed(original.eventId, original.actId));
  const data = { outcome: "executed", receipt_id: receipt, error: null, detail: {
    confirmed_via: "weekly_commitment_observation", receipt_id: receipt,
    automation_id: original.subjectId, event_id: original.eventId, act_id: original.actId, ...detailOver,
  }, ...over };
  const rpc = vi.fn(async () => { if (port.throws) throw new Error("Lost original response"); return { data, error: port.error ?? null }; });
  const input: DispatchInput = { ...original, subjectTable: "paige_automations", actionKind: "planning.weekly_commitment_check",
    args: {}, db: { rpc, from: () => { throw new Error("Only the original weekly RPC is permitted"); } } };
  const outbound = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No outbound requests in this proof"));
  const result = await (readback ? weeklyCommitmentExecutor.readback("untrusted-provider-reference", input) : weeklyCommitmentExecutor.dispatch(input));
  expect(outbound).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledOnce();
  return { result, rpc, receipt };
}
afterEach(() => vi.restoreAllMocks());

describe("weekly original observation and receipt identity", () => {
  it.each([false, true])("accepts only the original canonical committed outcome, readback=%s", async readback => {
    const { result, rpc, receipt } = await invoke({}, readback);
    expect(result.outcome).toBe("executed");
    expect(rpc).toHaveBeenCalledWith(readback ? "read_weekly_commitment_check" : "execute_weekly_commitment_check", {
      _automation_id: original.subjectId, _event_id: original.eventId, _act_id: original.actId, _correlation: original.correlationRef,
      ...(!readback ? { _receipt_id: receipt } : {}),
    });
  });
  it.each([false, true])("refuses an unrelated or malformed receipt, readback=%s", async readback => {
    const { result } = await invoke({ receipt_id: id(90) }, readback, { receipt_id: id(90) });
    expect(result.outcome).toBe("ambiguous"); expect(result.detail?.proven_absent).toBe(false);
  });
  it.each([undefined, null, "not-a-receipt"])("does not complete a malformed receipt %j", async bad => {
    const { result } = await invoke({ receipt_id: bad }, true, { receipt_id: bad });
    expect(result.outcome).toBe("ambiguous"); expect(result.detail?.proven_absent).toBe(false);
  });
  it.each(["top", "detail"])("requires both receipt references to agree: %s", async part => {
    const { result } = await invoke(part === "top" ? { receipt_id: id(90) } : {}, true, part === "detail" ? { receipt_id: id(90) } : {});
    expect(result.outcome).toBe("ambiguous"); expect(result.detail?.proven_absent).toBe(false);
  });
  it.each(["automation_id", "event_id", "act_id"])("does not complete another original %s", async key => {
    const { result } = await invoke({}, true, { [key]: id(91) });
    expect(result.outcome).toBe("ambiguous"); expect(result.detail?.proven_absent).toBe(false);
  });
  it("a conflicting executed result cannot turn into retry permission", async () => {
    const { result } = await invoke({ receipt_id: id(90) }, true, { receipt_id: "not-a-receipt", proven_absent: true });
    expect(result.outcome).toBe("ambiguous"); expect(result.detail?.proven_absent).toBe(false);
  });
  it("does not infer absence from a contradictory observation", async () => {
    const { result } = await invoke({ outcome: "ambiguous", error: "weekly_check_not_observed" }, true, { proven_absent: true });
    expect(result.outcome).toBe("ambiguous"); expect(result.detail?.proven_absent).toBe(false);
  });
  it("preserves canonical absence only for the original no-observation readback", async () => {
    const { result } = await invoke({ outcome: "ambiguous", receipt_id: undefined,
      detail: { proven_absent: true }, error: "weekly_check_not_observed" }, true);
    expect(result.outcome).toBe("ambiguous"); expect(result.detail?.proven_absent).toBe(true);
  });
  it("a missing native confirmation does not imply absence", async () => {
    const { result } = await invoke({ outcome: "ambiguous", receipt_id: undefined,
      detail: { proven_absent: true }, error: "weekly_check_binding_unverified" }, true);
    expect(result.outcome).toBe("ambiguous"); expect(result.detail?.proven_absent).toBe(false);
  });
  it("a canonical failure cannot authorize another dispatch", async () => {
    const { result } = await invoke({ outcome: "failed", receipt_id: undefined, detail: { proven_absent: true }, error: "weekly_check_binding_refused" }, true);
    expect(result.outcome).toBe("failed"); expect(result.detail?.proven_absent).toBe(false);
  });
  it.each([false, true])("lost acknowledgements stay unconfirmed, readback=%s", async readback => {
    const { result } = await invoke({}, readback, {}, { throws: true });
    expect(result.outcome).toBe("ambiguous"); expect(result.detail?.proven_absent).not.toBe(true);
  });
  it.each([[false, "42501", "failed"], [true, "42501", "ambiguous"], [false, "40001", "ambiguous"],
    [false, "proof_transport_error", "ambiguous"]])("preserves native rejection versus uncertainty %s / %s", async (readback, code, outcome) => {
      const { result } = await invoke({}, readback as boolean, {}, { error: { code: code as string, message: "Protected native failure" } });
      expect(result.outcome).toBe(outcome); expect(result.detail?.proven_absent).not.toBe(true);
    });
});
