type ObjectRecord = Record<string, unknown>;
const object = (value: unknown): value is ObjectRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export interface OriginalDocumentReference {
  threadId: string;
  intentId: string;
  workId: string;
}

/** A saved effect supplies a locator. The status endpoint proves current authority. */
export function originalDocumentReference(turn: unknown, threadId: string): OriginalDocumentReference | null {
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
    object(effect) && effect.tool === "document_generate" && effect.outcome === "durable_accepted");
  const effect = effects[0];
  if (effects.length !== 1 || !object(effect) || !uuid(effect.work_id)) return null;
  return { threadId, intentId: turn.interactive_intent_id, workId: effect.work_id };
}

export type DocumentWorkRead =
  | { state: "verified"; resultRef: string; receiptRef: string }
  | { state: "pending" | "approval" | "blocked" | "failed" | "cancelled" | "unknown" };

export function readOriginalDocumentWork(raw: unknown, reference: OriginalDocumentReference): DocumentWorkRead {
  const unknown = { state: "unknown" } as const;
  if (!object(raw) || !object(raw.durable_work)) return unknown;
  const work = raw.durable_work;
  if (work.threadId !== reference.threadId || work.intentId !== reference.intentId ||
    work.workId !== reference.workId || !Number.isSafeInteger(work.version) ||
    Number(work.version) < 1 || work.observationKind !== undefined) return unknown;
  const continuation = object(work.continuation) ? work.continuation : null;
  if (work.state === "succeeded" && work.recoveryState === "observed" &&
    work.artifactVerified === true && continuation?.eligibleForContext === true &&
    continuation.reason === "canonical_terminal" && continuation.state === "succeeded" &&
    continuation.workId === reference.workId && object(continuation.completion) &&
    uuid(continuation.completion.resultRef) && uuid(continuation.completion.receiptRef) &&
    work.artifactRef === continuation.completion.resultRef) {
    return { state: "verified", resultRef: continuation.completion.resultRef,
      receiptRef: continuation.completion.receiptRef };
  }
  if (work.recoveryState !== "observed") return unknown;
  if (work.state === "claimed") return { state: "pending" };
  if (work.state === "blocked") return { state: continuation?.reason === "approval_pending" &&
    continuation.eligibleForContext === false && continuation.state === "unavailable" ? "approval" : "blocked" };
  if (work.state === "cancelled" || work.state === "failed") return { state: work.state };
  return unknown;
}
