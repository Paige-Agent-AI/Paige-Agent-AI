import { describe, expect, it } from "vitest";
import { originalResearchReference, readOriginalResearchWork } from "./researchWorkRecovery";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reference = { threadId: id(1), intentId: id(2), workId: id(3) };
const effect = { tool: "deep_research", outcome: "durable_accepted", work_id: reference.workId };
const turn = (effects: unknown[]) => ({ role: "assistant", interactive_intent_id: reference.intentId,
  interactive_terminal_state: "WAIT_WORK", bundle_ref: { turn_state: { v: 1, state: "WAIT_WORK" },
    interactive: { request_intent_id: reference.intentId, effects } } });
const completion = { resultRef: reference.workId, receiptRef: id(4) };
const work = { ...reference, state: "succeeded", version: 3, recoveryState: "terminal_unverified",
  artifactVerified: false, artifactRef: null, continuation: { workId: reference.workId,
    eligibleForContext: true, reason: "canonical_terminal", state: "succeeded", completion } };

describe("original Research recovery evidence", () => {
  it("uses only the original protected Research accepted effect", () => {
    expect(originalResearchReference(turn([effect]), reference.threadId)).toEqual(reference);
    for (const changed of [turn([{ ...effect, tool: "document_generate" }]),
      turn([{ ...effect, outcome: "reported_success" }]), turn([effect, effect]),
      { ...turn([effect]), role: "user" }, { ...turn([effect]), interactive_intent_id: id(9) },
      { ...turn([effect]), interactive_terminal_state: null },
      { ...turn([effect]), bundle_ref: { ...turn([effect]).bundle_ref, turn_state: { v: 1, state: "FINAL" } } }]) {
      expect(originalResearchReference(changed, reference.threadId)).toBeNull();
    }
  });

  it("accepts the exact receipt pair for a saved partial report without promoting the legacy artifact flag", () => {
    expect(readOriginalResearchWork({ durable_work: work }, reference)).toEqual({ state: "verified", ...completion });
    expect(work.artifactVerified).toBe(false);
    expect(readOriginalResearchWork({ durable_work: structuredClone(work) }, reference))
      .toEqual({ state: "verified", ...completion });
  });

  it.each([
    { threadId: id(8) }, { intentId: id(8) }, { workId: id(8) }, { version: 0 },
    { version: 1.1 }, { observationKind: "systems_check" }, { state: "outcome_unknown" },
    { recoveryState: "reconciliation_required" }, { continuation: null },
    { continuation: { ...work.continuation, eligibleForContext: false } },
    { continuation: { ...work.continuation, workId: id(8) } },
    { continuation: { ...work.continuation, reason: "terminal_unverified" } },
    { continuation: { ...work.continuation, completion: { ...completion, resultRef: id(8) } } },
    { continuation: { ...work.continuation, completion: { ...completion, receiptRef: "invented" } } },
  ])("refuses foreign, ambiguous or unverified evidence %j", change => {
    expect(readOriginalResearchWork({ durable_work: { ...work, ...change } }, reference)).toEqual({ state: "unknown" });
  });

  it.each(["claimed", "blocked", "failed", "cancelled"])("preserves %s without suggesting a new run", state => {
    expect(readOriginalResearchWork({ durable_work: { ...work, state, recoveryState: "observed", continuation: null } }, reference))
      .toEqual({ state: state === "claimed" ? "pending" : state });
  });
});
