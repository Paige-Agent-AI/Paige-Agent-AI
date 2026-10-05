// The PAIGE turn contract — what the server says about a chat turn, and what the client may read.
//
// docs/delivery/paige-conversational-loop-c1.md. ONE home for the shape (§18): the edge function
// emits it, the shared client parser (src/lib/paige-stream) reads it, and the assistant turn's
// bundle_ref persists it. Pure TypeScript with no runtime imports, so Deno and Vite both load it.
//
// SAFETY RULES that every field below obeys, and that isTurnFrame() enforces on read:
//  - CLOSED ENUMS AND COUNTS ONLY. No prose, no labels, no ids that are not already the caller's.
//    The client-seat leak reader (_shared/client-seat-reply.ts) does not scan this frame, and the
//    frame is sent directly (not held) so a protected turn can say it has started. Anything a
//    person or a document wrote must never ride here.
//  - ONE LINE. Emitted as a single `data: <json>` line; a malformed line stalls two consumers.
//  - The four live parsers drop an unknown top-level key without rendering it, which is why this is
//    a new frame and not a new paige_step kind (a new kind would render as an action row).

/** The frame key on the wire: `data: {"paige_turn": TurnFrame}`. */
export const TURN_FRAME_KEY = "paige_turn" as const;

/** Bumped only on a breaking change to TurnFrame or TurnRecord. */
export const TURN_CONTRACT_VERSION = 1 as const;

/**
 * Wire events. `started` is the first frame of every stream; exactly one of `waiting` / `completed`
 * closes it, emitted before any answer byte. `segment` (interim vs final text) and `resumed` (one
 * shared resume with the durable-work lane) are reserved for a later slice and never emitted yet.
 *
 * THE WIRE TERMINAL IS PROVISIONAL ON AN ORDINARY STREAMED TURN; THE PERSISTED RECORD IS AUTHORITATIVE.
 * A turn whose answer streams live (nothing held for a final check) must send its terminal before the
 * first answer byte, so it cannot see a failure that happens after that byte is out. Spoken bytes
 * cannot be un-said, so the rule is:
 *  - the server sends the terminal as late as it honestly can — an answer streamed from the closing
 *    call (Live or text) has its terminal wait for the first line carrying answer TEXT (the stream's
 *    synthetic role-only first line is not an answer), so a closing call that fails, has no body, or
 *    breaks before any text ends INTERRUPTED on the wire, never first FINAL;
 *  - a stream the provider never finished (no finish_reason before [DONE]) is INTERRUPTED in the record;
 *  - once a `completed`/`waiting` frame is out, a later `paige_live_error` frame, or a snag sentence
 *    ("I hit a snag…"), SUPERSEDES it — the turn did not end the way its terminal said;
 *  - `bundle_ref.turn_state` on the assistant turn records the final truth (INTERRUPTED in that
 *    case) WHEN THERE IS A ROW: the persist gate writes no assistant row for an empty answer with no
 *    legacy bundle card (even when a proposal card was on the wire), and then there is no record at
 *    all — the wire terminal is the only signal. A reader that needs the outcome of a finished turn
 *    reads the record when it exists, not the frame.
 * A PROTECTED (held) turn has no provisional window: its terminal is sent at the release point, after
 * the final checks, so its wire terminal and its record agree.
 */
export const TURN_EVENTS = ["started", "waiting", "completed", "segment", "resumed"] as const;
export type TurnEvent = (typeof TURN_EVENTS)[number];

/**
 * Where the turn ended up. Distinct BY NAME AND CASE from the durable-work envelope's status words
 * (lower-case claimed|succeeded|failed|blocked|cancelled|expired|outcome_unknown): no turn state is
 * spelled like a work status in any case, so the two lifecycles cannot be read as one another when a
 * turn record sits beside a document job's work_status.
 *  - WORKING      — still running (only on `started`)
 *  - FINAL        — answered; the work this turn set out to do is done
 *  - WAIT_APPROVAL— a card needs the person's yes before something happens
 *  - WAIT_WORK    — durable work was accepted and finishes later (work_ids)
 *  - ASK_USER     — PAIGE asked a question with choices
 *  - LIMIT_REACHED— stopped by a limit before finishing: a budget (time, rounds, tool calls,
 *                   continuations) or the no-progress stop (the same call repeated)
 *  - INTERRUPTED  — stopped by a scope change or an error; nothing more will come
 *  - WITHHELD     — an answer existed but a final gate held it back
 *  - REFUSED      — the request was refused before any work (e.g. client scope)
 */
export const TURN_STATES = [
  "WORKING", "FINAL", "WAIT_APPROVAL", "WAIT_WORK", "ASK_USER", "LIMIT_REACHED", "INTERRUPTED", "WITHHELD", "REFUSED",
] as const;
export type TurnState = (typeof TURN_STATES)[number];

export const WAITING_STATES: ReadonlySet<TurnState> = new Set(["WAIT_APPROVAL", "WAIT_WORK", "ASK_USER"]);

/**
 * What kind of turn it turned out to be — OBSERVED from what the model actually did, never
 * predicted (no classifier call, no latency). `pending` until the first round resolves.
 */
export const TURN_MODES = [
  "pending", "fast_answer", "answer", "research", "action", "build", "multi_agent", "clarify",
] as const;
export type TurnMode = (typeof TURN_MODES)[number];

/** The frame on the wire. Every field is an enum or a small integer. */
export interface TurnFrame {
  v: typeof TURN_CONTRACT_VERSION;
  event: TurnEvent;
  state: TurnState;
  mode: TurnMode;
}

/** What a waiting turn is waiting on. Counts and the caller's own work ids only. */
export interface TurnWaitingOn {
  kind: "approval" | "work" | "choice";
  /** Approval cards issued this turn (count only — fingerprints live in paige_confirm). */
  approvals?: number;
  /** Durable work accepted this turn (paige_durable_work ids, the established `work_ids` name). */
  work_ids?: string[];
}

/** Persisted on the assistant turn as bundle_ref.turn_state. */
export interface TurnRecord {
  v: typeof TURN_CONTRACT_VERSION;
  state: TurnState;
  mode: TurnMode;
  /** Model calls actually made: decision rounds, continuations and the tools-free closing call. */
  rounds: number;
  /** Tool calls actually executed. */
  tools: number;
  waiting_on?: TurnWaitingOn;
}

/** One entry of bundle_ref.turn_trace: a work step as the person saw it (never a thought). */
export interface TurnTraceEntry {
  label: string;
  group: "owner" | "client" | "shared";
  status: "done" | "error";
}

/** Persistence budget for the trace (measured prod bundle_ref today: p95 485 B, max 762 B). */
export const TURN_TRACE_MAX_ENTRIES = 40;
export const TURN_TRACE_MAX_LABEL = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oneOf<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (values as readonly string[]).includes(v);
}

/** Build the wire frame. Throws on a value outside the contract — a bug, never a runtime input. */
export function turnFrame(event: TurnEvent, state: TurnState, mode: TurnMode): TurnFrame {
  if (!oneOf(TURN_EVENTS, event) || !oneOf(TURN_STATES, state) || !oneOf(TURN_MODES, mode)) {
    throw new Error(`paige_turn: value outside the contract (${event}/${state}/${mode})`);
  }
  return { v: TURN_CONTRACT_VERSION, event, state, mode };
}

/** The exact SSE line for a frame (one line, terminated). */
export function turnFrameLine(frame: TurnFrame): string {
  return `data: ${JSON.stringify({ [TURN_FRAME_KEY]: frame })}\n\n`;
}

/**
 * Read a frame defensively. Anything with an extra key, a non-enum value, or a version this client
 * does not know is rejected (null) — the client never trusts an unknown shape.
 */
export function isTurnFrame(value: unknown): value is TurnFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 4 || !["v", "event", "state", "mode"].every((k) => keys.includes(k))) return false;
  return o.v === TURN_CONTRACT_VERSION && oneOf(TURN_EVENTS, o.event) && oneOf(TURN_STATES, o.state)
    && oneOf(TURN_MODES, o.mode);
}

/**
 * Bound a trace for persistence: FINISHED action steps only, labels capped, entry count capped.
 *
 * Only an outcome is durable. A step's START (`running`) and anything withdrawn are live lifecycle —
 * they belong in the "What PAIGE did" strip while the turn runs, never in the record — so any status
 * other than `done` or `error` is skipped rather than coerced to `done` (it used to be, which would
 * have saved a step that never finished as one that did). A step with NO status is read as `done`,
 * as before: that is how a finished step was written before steps carried a lifecycle.
 */
export function boundTurnTrace(steps: ReadonlyArray<{ kind?: unknown; label?: unknown; group?: unknown; status?: unknown }>): TurnTraceEntry[] {
  const out: TurnTraceEntry[] = [];
  for (const s of steps) {
    if (out.length >= TURN_TRACE_MAX_ENTRIES) break;
    if (s?.kind !== "action") continue; // thoughts are model text — never durable
    if (s.status !== undefined && s.status !== "done" && s.status !== "error") continue; // not an outcome
    if (typeof s.label !== "string" || !s.label.trim()) continue;
    const label = s.label.trim().length > TURN_TRACE_MAX_LABEL
      ? `${s.label.trim().slice(0, TURN_TRACE_MAX_LABEL - 1).trimEnd()}…`
      : s.label.trim();
    const group = s.group === "client" || s.group === "shared" ? s.group : "owner";
    const status = s.status === "error" ? "error" : "done";
    out.push({ label, group, status });
  }
  return out;
}

/** Read a persisted turn record defensively (old rows have none; a bad row reads as none). */
export function readTurnRecord(value: unknown): TurnRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (o.v !== TURN_CONTRACT_VERSION || !oneOf(TURN_STATES, o.state) || !oneOf(TURN_MODES, o.mode)) return null;
  if (!Number.isInteger(o.rounds) || !Number.isInteger(o.tools)) return null;
  const rec: TurnRecord = { v: TURN_CONTRACT_VERSION, state: o.state, mode: o.mode, rounds: o.rounds as number, tools: o.tools as number };
  const w = o.waiting_on as Record<string, unknown> | undefined;
  if (w && typeof w === "object" && (w.kind === "approval" || w.kind === "work" || w.kind === "choice")) {
    rec.waiting_on = { kind: w.kind };
    if (Number.isInteger(w.approvals)) rec.waiting_on.approvals = w.approvals as number;
    if (Array.isArray(w.work_ids)) rec.waiting_on.work_ids = w.work_ids.filter((x): x is string => typeof x === "string" && UUID.test(x));
  }
  return rec;
}
