// The PAIGE turn reducer — what a chat turn turned out to be, OBSERVED from what already happened.
//
// docs/delivery/paige-conversational-loop-c1.md, decisions 3–5. Pure TypeScript with no Deno API, so
// the edge function feeds it and vitest drives it directly. It never decides anything about the turn:
// the loop runs exactly as before, and this only records what the loop did — the rounds it ran, the
// tools it executed, the cards it issued, and how it ended — so the frame on the wire and the record
// on the assistant turn come from one place (§18).
//
// THE TWO THINGS IT IS EASY TO GET WRONG, written down so they are not rediscovered:
//  - WAITING IS DERIVED FROM WHAT WAS ISSUED, NOT FROM HOW THE LOOP EXITED. After a confirm card the
//    model is re-called and usually answers ("I've put that up for your approval"), so the loop ends
//    on a natural stop. The turn is still waiting on the person. Same for accepted document work.
//  - MODE IS OBSERVED, NEVER PREDICTED. No classifier call, no latency: `pending` until a round
//    resolves, then whatever the executed tools say. The classifiers are injected, so a future domain
//    changes the edge function's classifier set, not this file.

import {
  boundTurnTrace,
  TURN_CONTRACT_VERSION,
  turnFrame,
  WAITING_STATES,
  type ResumeKind,
  type TurnEvent,
  type TurnFrame,
  type TurnMode,
  type TurnRecord,
  type TurnState,
  type TurnTraceEntry,
  type TurnWaitingOn,
} from "./contract.ts";

/** How the edge function classifies a tool. Injected, so the reducer holds no tool list. */
export interface TurnClassifiers {
  isMutating(tool: string): boolean;
  isBuild(tool: string): boolean;
  isResearch(tool: string): boolean;
  isDelegation(tool: string): boolean;
}

/** For a turn that runs no tool at all (the client-scope refusal stream). */
export const NO_TOOLS: TurnClassifiers = Object.freeze({
  isMutating: () => false,
  isBuild: () => false,
  isResearch: () => false,
  isDelegation: () => false,
});

/** One dispatched tool call, as the reducer needs to know it. Built by `observeToolResult`. */
export interface ExecutedTool {
  name: string;
  /** False when a gate refused the call before any executor ran (see `observeToolResult`). A refused
   *  call is not work this turn did: it counts toward neither `tools` nor the observed mode. */
  ran: boolean;
  /** A card now waits on the person's yes (paige_confirm or approval_queued). */
  needsConfirm?: boolean;
  /** Durable work accepted this call (paige_durable_work id), finishing later. */
  acceptedWorkId?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read one dispatched tool's own result JSON the way the chat loop already reads it — and nothing
 * more. Each condition is the existing one, so the record cannot disagree with the cards:
 *  - ran: false for the five results that say no executor ran. Each one, and which EXISTING per-call
 *    trail already reads it as "did not run" — they do not all agree, so this names them one by one:
 *      `disabled` set (an autonomy-off tool)            — describeStep drops it, the write trail
 *                                                          skips it, approval-outcome says not_run.
 *      `error: "internal_text_in_draft"` (R2 refusal)    — describeStep drops it, the write trail
 *                                                          skips it, approval-outcome says not_run.
 *      `refused_before_run` set (an id the model made    — the write trail skips it and approval-
 *        up, _shared/confirm-fingerprint.ts)               outcome says not_run; describeStep does
 *                                                          NOT drop it (it renders a step).
 *      `forbidden_seat` set (the client-seat gate)       — describeStep drops it; the write trail
 *                                                          does not read the flag.
 *      `error: "outside_studio_scope"` (Studio boundary) — NO existing trail drops it: describeStep
 *                                                          renders a step for it and the write
 *                                                          trail records a failed write. It is not-run
 *                                                          on the dispatch code's own evidence: the
 *                                                          boundary `continue`s before every door.
 *    NOT on the list: the approval-resolution refusal (`success: false, outcome: "refused"`). It does
 *    `continue` before crm-command is invoked, but `outcome: "refused"` is also what executors that DID
 *    run return (crm-command, the calendar send), so the shape cannot tell them apart — and describeStep
 *    and the write trail both count it as an attempted call. It stays counted until it declares
 *    `refused_before_run` like the other pre-run refusals (#1460).
 *  - a confirm card: `needs_confirm && confirm_summary`, the exact condition that pushes paige_confirm.
 *    A queued approval (`propose_action` → `{success:true, queued:true}`) is the approval_queued
 *    card, which waits on the person just the same.
 *  - accepted work: `document_generate` → `{accepted:true, work_status:"claimed", work_id}`. An
 *    already-completed or unreconciled job is not new work this turn waits on.
 */
export function observeToolResult(name: string, content: string | undefined | null): ExecutedTool {
  let parsed: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(content ?? "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) parsed = v as Record<string, unknown>;
  } catch { /* not JSON: ran, reported nothing structured */ }
  const ran = !(parsed?.forbidden_seat === true || parsed?.disabled === true || parsed?.refused_before_run === true
    || parsed?.error === "internal_text_in_draft"
    || (parsed?.success === false && parsed?.error === "outside_studio_scope"));
  const needsConfirm = (!!parsed?.needs_confirm && !!parsed?.confirm_summary)
    || (parsed?.queued === true && parsed?.success === true);
  const acceptedWorkId = name === "document_generate" && parsed?.accepted === true
      && parsed?.work_status === "claimed" && typeof parsed?.work_id === "string"
    ? parsed.work_id
    : null;
  return { name, ran, needsConfirm, acceptedWorkId };
}

export interface TurnTracker {
  /** A model round is about to be consumed (continuations count). */
  roundStarted(): void;
  /** The tools-free closing call (a forced close, or Live's answer call) is about to be made. It
   *  counts toward `rounds` — a model call the turn actually made — but not toward the observed mode,
   *  which reads how many decision rounds the turn needed. */
  closingCallStarted(): void;
  /** What one round's executeToolCalls dispatched; calls a gate refused (`ran: false`) are skipped. */
  toolsExecuted(results: ReadonlyArray<ExecutedTool>): void;
  /** PAIGE ended the turn on a question with choices. */
  choicesAsked(): void;
  /** A limit stopped the turn: a budget (rounds, tool calls, wall clock, continuations) or the
   *  no-progress stop (the model repeated a call it already made). */
  budgetStop(): void;
  /** A scope change or an error stopped the turn; nothing more will come. */
  interrupted(): void;
  /** An answer existed but a final gate held it back. */
  withheld(): void;
  /** Refused before any work. */
  refused(): void;
  /** A round resolved with no tool call — the model answered. */
  naturalStop(): void;
  /** This turn carried a paused objective forward (C4a: an approved act run from its stored
   *  proposal). Recorded as `turn_state.resumed`; the wire says so with one `resumed` frame. */
  resumed(kind: ResumeKind): void;
  readonly state: TurnState;
  readonly mode: TurnMode;
  /** `started` / `resumed` (WORKING), or the terminal event that matches the state. Reserved events throw. */
  frame(event: TurnEvent): TurnFrame;
  /** The one terminal frame: `waiting` for a waiting state, else `completed`. */
  terminalFrame(): TurnFrame;
  /** bundle_ref.turn_state */
  record(): TurnRecord;
  /** bundle_ref.turn_trace — action steps only, bounded. */
  trace(steps: ReadonlyArray<{ kind?: unknown; label?: unknown; group?: unknown; status?: unknown }>): TurnTraceEntry[];
}

export function createTurnTracker(classify: TurnClassifiers): TurnTracker {
  let rounds = 0;
  let closingCalls = 0;
  const executed: string[] = [];
  let approvals = 0;
  const workIds: string[] = [];
  let asked = false;
  let answered = false;
  let budgetStopped = false;
  let wasInterrupted = false;
  let wasWithheld = false;
  let wasRefused = false;
  let resumedKind: ResumeKind | null = null;

  const mode = (): TurnMode => {
    if (executed.some((t) => classify.isBuild(t))) return "build";
    if (executed.some((t) => classify.isDelegation(t))) return "multi_agent";
    if (executed.some((t) => classify.isResearch(t))) return "research";
    if (executed.some((t) => classify.isMutating(t))) return "action";
    if (asked) return "clarify";
    if (executed.length) return "answer";
    // No tool ran. One round that answered is the fast path; more than one (a continuation, a
    // budget after prose) is still an answer, just not a first-round one.
    if (answered) return rounds <= 1 ? "fast_answer" : "answer";
    return "pending";
  };

  // Precedence: how the turn ENDED outranks what it was waiting on — a withheld turn's cards were
  // dropped with its answer, and an interrupted one never released them.
  const state = (): TurnState => {
    if (wasRefused) return "REFUSED";
    if (wasWithheld) return "WITHHELD";
    if (wasInterrupted) return "INTERRUPTED";
    if (approvals > 0) return "WAIT_APPROVAL";
    if (workIds.length) return "WAIT_WORK";
    if (asked) return "ASK_USER";
    if (budgetStopped) return "LIMIT_REACHED";
    return "FINAL";
  };

  const waitingOn = (s: TurnState): TurnWaitingOn | undefined => {
    if (s === "WAIT_APPROVAL") return { kind: "approval", approvals, ...(workIds.length ? { work_ids: [...workIds] } : {}) };
    if (s === "WAIT_WORK") return { kind: "work", work_ids: [...workIds] };
    if (s === "ASK_USER") return { kind: "choice" };
    return undefined;
  };

  const terminalEvent = (s: TurnState): TurnEvent => (WAITING_STATES.has(s) ? "waiting" : "completed");

  return {
    roundStarted() { rounds += 1; },
    closingCallStarted() { closingCalls += 1; },
    toolsExecuted(results) {
      for (const r of results) {
        if (!r?.name || r.ran === false) continue;
        executed.push(r.name);
        if (r.needsConfirm) approvals += 1;
        const id = r.acceptedWorkId;
        if (typeof id === "string" && UUID.test(id) && !workIds.includes(id)) workIds.push(id);
      }
    },
    choicesAsked() { asked = true; },
    budgetStop() { budgetStopped = true; },
    interrupted() { wasInterrupted = true; },
    withheld() { wasWithheld = true; },
    refused() { wasRefused = true; },
    naturalStop() { answered = true; },
    resumed(kind) { resumedKind = kind; },
    get state() { return state(); },
    get mode() { return mode(); },
    frame(event) {
      if (event === "started") return turnFrame("started", "WORKING", mode());
      if (event === "resumed") return turnFrame("resumed", "WORKING", mode());
      if (event !== "waiting" && event !== "completed") {
        throw new Error(`paige_turn: ${event} is reserved for a later slice and never emitted yet`);
      }
      const s = state();
      if (terminalEvent(s) !== event) throw new Error(`paige_turn: ${event} does not match state ${s}`);
      return turnFrame(event, s, mode());
    },
    terminalFrame() {
      const s = state();
      return turnFrame(terminalEvent(s), s, mode());
    },
    record() {
      const s = state();
      const w = waitingOn(s);
      return { v: TURN_CONTRACT_VERSION, state: s, mode: mode(), rounds: rounds + closingCalls, tools: executed.length, ...(w ? { waiting_on: w } : {}), ...(resumedKind ? { resumed: { kind: resumedKind } } : {}) };
    },
    trace(steps) { return boundTurnTrace(steps); },
  };
}

/**
 * Put the turn record on an assistant turn's metadata, at the persist call site — never inside
 * `assistantTurnMetadata`, whose output is pinned by n5 (#1701 extended it).
 *
 * THE PERSIST GATE IS UNCHANGED, and that is this function's one subtle rule: `persistAssistantTurn`
 * writes nothing when the text is empty AND there is no legacy card. Adding a record would make every
 * such bundle non-null and start persisting empty turns, so that case is returned untouched.
 * `turn_trace` is omitted when empty: old readers ignore it either way, and [] costs bytes on every row.
 */
export function attachTurnRecord<M extends { bundleRef?: unknown }>(
  tracker: TurnTracker,
  text: string,
  meta: M,
  steps: ReadonlyArray<{ kind?: unknown; label?: unknown; group?: unknown; status?: unknown }> = [],
): M {
  if (!text?.trim() && !meta.bundleRef) return meta;
  const legacy = meta.bundleRef && typeof meta.bundleRef === "object" ? (meta.bundleRef as Record<string, unknown>) : {};
  const trace = tracker.trace(steps);
  return {
    ...meta,
    bundleRef: { ...legacy, turn_state: tracker.record(), ...(trace.length ? { turn_trace: trace } : {}) },
  };
}
