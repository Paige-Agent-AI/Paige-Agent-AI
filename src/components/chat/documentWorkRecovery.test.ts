import { describe, expect, it } from "vitest";
import { originalDocumentReference, readOriginalDocumentWork } from "./documentWorkRecovery";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reference = { threadId: id(1), intentId: id(2), workId: id(3) };
const effect = { tool: "document_generate", outcome: "durable_accepted", work_id: reference.workId };
const turn = (effects: unknown[]) => ({
  role: "assistant", interactive_terminal_state: "WAIT_WORK", interactive_intent_id: reference.intentId,
  bundle_ref: { turn_state: { v: 1, state: "WAIT_WORK" },
    interactive: { request_intent_id: reference.intentId, effects } },
});
const completion = { resultRef: id(4), receiptRef: id(5) };
const work = {
  ...reference, state: "succeeded", version: 3, recoveryState: "observed",
  artifactVerified: true, artifactRef: completion.resultRef,
  continuation: { workId: reference.workId, eligibleForContext: true,
    reason: "canonical_terminal", state: "succeeded", completion },
};

describe("original document continuation in Chat", () => {
  it("recovers the original locator from a saved accepted effect", () => {
    expect(originalDocumentReference(turn([effect]), reference.threadId)).toEqual(reference);
    expect(originalDocumentReference({ ...turn([effect]), role: "user" }, reference.threadId)).toBeNull();
    expect(originalDocumentReference(turn([effect, { ...effect, work_id: id(8) }]), reference.threadId)).toBeNull();
    expect(originalDocumentReference(turn([{ ...effect, outcome: "reported_success" }]), reference.threadId)).toBeNull();
  });

  it("restores the same verified result and receipt across readback", () => {
    const read = () => readOriginalDocumentWork({ durable_work: structuredClone(work) }, reference);
    expect(read()).toEqual({ state: "verified", ...completion });
    expect(read()).toEqual({ state: "verified", ...completion });
  });

  it.each([
    { workId: id(6) }, { intentId: id(6) }, { threadId: id(6) },
    { artifactRef: id(6) }, { artifactVerified: false }, { continuation: undefined },
    { continuation: { ...work.continuation, workId: id(6) } },
    { continuation: { ...work.continuation, completion: { ...completion, receiptRef: "guessed" } } },
    { state: "outcome_unknown", recoveryState: "reconciliation_required" },
  ])("withholds unavailable, stale or unrelated evidence (%j)", change => {
    expect(readOriginalDocumentWork({ durable_work: { ...work, ...change } }, reference)).toEqual({ state: "unknown" });
  });

  it("distinguishes genuine approval, ordinary blocking, and in-progress work", () => {
    const read = (state: string, continuation?: unknown) => readOriginalDocumentWork({
      durable_work: { ...work, state, artifactVerified: false, artifactRef: null, continuation },
    }, reference);
    expect(read("claimed")).toEqual({ state: "pending" });
    expect(read("blocked")).toEqual({ state: "blocked" });
    expect(read("blocked", { reason: "approval_pending", eligibleForContext: false, state: "unavailable" }))
      .toEqual({ state: "approval" });
    expect(read("cancelled")).toEqual({ state: "cancelled" });
  });
});
