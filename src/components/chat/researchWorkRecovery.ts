type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export interface OriginalResearchReference {
  threadId: string;
  intentId: string;
  workId: string;
}

/** A protected saved effect is only a locator. The native reader proves authority. */
export function originalResearchReference(turn: unknown, threadId: string): OriginalResearchReference | null {
  if (!uuid(threadId) || !object(turn) || turn.role !== "assistant" ||
    !uuid(turn.interactive_intent_id) || !object(turn.bundle_ref) ||
    !object(turn.bundle_ref.turn_state) || turn.bundle_ref.turn_state.v !== 1 ||
    turn.bundle_ref.turn_state.state !== turn.interactive_terminal_state ||
    !["FINAL", "WAIT_WORK", "WAIT_APPROVAL", "INTERRUPTED", "LIMIT_REACHED", "ASK_USER"]
      .includes(String(turn.interactive_terminal_state))) return null;
  const interactive = turn.bundle_ref.interactive;
  if (!object(interactive) || interactive.request_intent_id !== turn.interactive_intent_id ||
    !Array.isArray(interactive.effects) || interactive.effects.length > 20) return null;
  const effects = interactive.effects.filter(effect =>
    object(effect) && effect.tool === "deep_research" && effect.outcome === "durable_accepted");
  const effect = effects[0];
  if (effects.length !== 1 || !object(effect) || !uuid(effect.work_id)) return null;
  return { threadId, intentId: turn.interactive_intent_id, workId: effect.work_id };
}

export type ResearchWorkRead =
  | { state: "verified"; resultRef: string; receiptRef: string }
  | { state: "pending" | "blocked" | "failed" | "cancelled" | "unknown" };

export function readOriginalResearchWork(raw: unknown, reference: OriginalResearchReference): ResearchWorkRead {
  const unknown = { state: "unknown" } as const;
  if (!object(raw) || !object(raw.durable_work)) return unknown;
  const work = raw.durable_work;
  if (work.threadId !== reference.threadId || work.intentId !== reference.intentId ||
    work.workId !== reference.workId || !Number.isSafeInteger(work.version) ||
    Number(work.version) < 1 || work.observationKind !== undefined) return unknown;
  const continuation = object(work.continuation) ? work.continuation : null;
  // The original Research receipt reader verifies partial reports too. Its exact
  // completion pair is separate from the older answered-only artifact flag.
  if (work.state === "succeeded" && ["observed", "terminal_unverified"].includes(String(work.recoveryState)) &&
    continuation?.eligibleForContext === true && continuation.reason === "canonical_terminal" &&
    continuation.state === "succeeded" && continuation.workId === reference.workId &&
    object(continuation.completion) && continuation.completion.resultRef === reference.workId &&
    uuid(continuation.completion.receiptRef)) {
    return { state: "verified", resultRef: reference.workId, receiptRef: continuation.completion.receiptRef };
  }
  if (work.recoveryState !== "observed") return unknown;
  if (work.state === "claimed") return { state: "pending" };
  if (work.state === "blocked" || work.state === "failed" || work.state === "cancelled") return { state: work.state };
  return unknown;
}
