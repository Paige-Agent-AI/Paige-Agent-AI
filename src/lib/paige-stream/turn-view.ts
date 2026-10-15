// C3a — THE LIVING TURN VIEW (docs/delivery/paige-conversational-loop-c3.md).
//
// One pure function decides what a PAIGE answer's status line says, from TURN STATE ONLY:
//  - the latest `paige_turn` frame (C1), or the persisted `bundle_ref.turn_state` on reload;
//  - the action steps this turn (C2a/C2b: running → done | error | withdrawn on one id);
//  - the client's own clock (the 400 ms gate, elapsed time, the 10 s research expectation);
//  - how the read ended (done, the person pressed Stop, or the six-minute window);
//  - and ONE boolean: whether any answer text arrived. Never the text itself.
//
// Owner ruling 2026-10-05: turn state is THE control signal — never infer from final prose. So this
// module is handed no answer words at all, and a test reads its source to keep it that way. The one
// string comparison here (`isDecisionReplyText`) reads the client's OWN two decision sentences, to
// hide a bubble the person never typed — it never decides a state.
//
// Copy follows the approved prototype (docs/design-references/prototypes/paige-turn-states-c3.html, §28 frozen),
// with the truth corrections recorded in the delivery doc §6c: the limit line names no cause the
// wire does not carry, an interruption names no cause either, and background work claims no
// progress the record cannot drive.
import type { TurnFrame, TurnMode, TurnRecord, TurnState } from "../../../supabase/functions/_shared/paige-turn/contract";
import { STEP_START_LABELS } from "../../../supabase/functions/_shared/paige-turn/step-start";
import { normalizeStepStatus } from "./step-status";

export type TurnRowStatus = "running" | "done" | "error" | "stopped";
export type TurnGroup = "owner" | "client" | "shared";

/** One action step as the person sees it on this answer. `detail` exists only on a live turn. */
export interface TurnRow {
  id: string;
  label: string;
  group: TurnGroup;
  status: TurnRowStatus;
  detail?: string;
  /** Client time the row was first seen (for the research expectation). Live only. */
  since?: number;
}

export type TurnLineKind = "think" | "work" | "wait" | "done" | "warn" | "stop" | "held" | "neutral" | "bg";
export type TurnGlyph = "dot" | "check" | "hand" | "triangle" | "pause" | "lock" | "clock" | "help" | "none";
/** C4c — where a question PAIGE asked stands: still open (the person's call), answered (or let her
 *  choose), or moved past without an answer. Presentation only; the server decides what is open. */
export type AskStanding = "open" | "answered" | "unanswered";
export type TurnEndCause = "done" | "cancelled" | "timeout";
export type TurnFooterAction = "see" | "askAgain";

export interface TurnView {
  kind: TurnLineKind;
  glyph: TurnGlyph;
  text: string;
  /** "live" = a ticking elapsed time; a number = the measured duration; null = no time shown. */
  elapsed: "live" | number | null;
  /** A step count for the meta (null = none shown). */
  steps: number | null;
  rows: TurnRow[];
  footer: { text: string; actions: TurnFooterAction[] } | null;
  /** What a screen reader hears when the line ENTERS this state (announced on a change of kind). */
  announce: string;
}

/** Shown once a Deep Research START has run for this long — honest elapsed time, no fake stages. */
export const STILL_RESEARCHING_AFTER_MS = 10_000;
export const STILL_RESEARCHING = "Still researching — this kind can take a couple of minutes.";
/** Below this a turn shows nothing: a fast answer should feel instant, not staged. */
export const TURN_LINE_GATE_MS = 400;

/** The two sentences the approval card sends on the person's behalf. In `PaigeAIChat` the send sites
 *  and the reload detector both read these, so they cannot drift apart there. Studio
 *  (`useStudioChat`) and Operator (`useOperatorChat`) still spell the same two sentences themselves;
 *  moving them onto this constant is C3b (their surfaces are not in this slice). */
export const DECISION_REPLY = {
  approved: "Approved — run it.",
  declined: "Hold off — skip that one.",
} as const;
const CARD_RESULT_SUFFIX = " [Card result — ";

const DEEP_RESEARCH_START = STEP_START_LABELS.deep_research;

/** What the turn ended as — a live frame's state/mode, or a persisted record's. */
export interface TurnOutcome { state: TurnState; mode: TurnMode }

/** Everything a settled answer needs to draw its line again. Stamped on the message. */
export interface TurnSnapshot {
  outcome: TurnOutcome | null;
  rows: TurnRow[];
  elapsedMs: number | null;
  endCause: TurnEndCause | null;
  /** "live" was seen in this session; "reload" came back from a saved thread. */
  source: "live" | "reload";
  hasContent: boolean;
  /** C4a — this answer carried a paused objective forward (the server said `resumed` live, or the
   *  record has `turn_state.resumed`): today, an approved act the server ran from its stored
   *  proposal. Presentation reads it to draw the two answers as one; it never decides a state. */
  resumed?: boolean;
}

export interface LiveTurnInput {
  frame: TurnFrame | null;
  rows: TurnRow[];
  /** The request is still open. */
  streaming: boolean;
  /** The server sent its `paige_phase: "writing"` marker. */
  writing: boolean;
  /** 400 ms have passed since the send. */
  gateOpen: boolean;
  startedAt: number;
  now: number;
  endCause: TurnEndCause | null;
  elapsedMs: number | null;
  /** Whether any answer text arrived (a boolean — never the text). */
  hasContent: boolean;
  /** The approval card for this answer is on screen and undecided. */
  awaitingApproval: boolean;
  personaName?: string;
  /** C4a — the server said `resumed`: the person's approval is being carried forward (frame a3). */
  resumed?: boolean;
  /** C4c — this answer ended on a question; where it stands (frames c2 / c3 / c5). */
  ask?: AskStanding;
}

const nameOf = (personaName?: string) => (personaName && personaName.trim()) || "PAIGE";
const stepsWord = (n: number) => `${n} ${n === 1 ? "step" : "steps"}`;

/** Elapsed time the way a person says it: 14s, 1m 14s, 6m. */
export function formatElapsed(ms: number): string {
  // Under a second reads "<1s", never "0s": a step that ran is never shown as taking no time.
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

/**
 * Fold one `paige_step` frame into this answer's rows. Actions only — a thought is model text and
 * never enters a per-answer trace. Same lifecycle rules as the shared reader: upsert by id in seq
 * order, `withdrawn` removes the row, an unknown status is ignored rather than drawn as done.
 */
export function upsertTurnRow(prev: TurnRow[], step: unknown, now: number): TurnRow[] {
  if (!step || typeof step !== "object") return prev;
  const s = step as Record<string, unknown>;
  if (s.kind === "thought") return prev;
  if (typeof s.id !== "string" || typeof s.label !== "string" || !s.label.trim()) return prev;
  const status = normalizeStepStatus(s.status);
  if (status === null) return prev;
  const i = prev.findIndex((r) => r.id === s.id);
  if (status === "withdrawn") return i >= 0 ? prev.filter((r) => r.id !== s.id) : prev;
  const group: TurnGroup = s.group === "client" || s.group === "shared" ? s.group : "owner";
  const seq = typeof s.seq === "number" ? s.seq : Number.MAX_SAFE_INTEGER;
  const merged: TurnRow & { seq: number } = {
    id: s.id,
    label: s.label,
    group,
    status,
    ...(typeof s.detail === "string" && s.detail ? { detail: s.detail } : i >= 0 && prev[i].detail ? { detail: prev[i].detail } : {}),
    since: i >= 0 ? prev[i].since ?? now : now,
    seq,
  };
  const next = prev.map((r) => ({ ...r })) as Array<TurnRow & { seq?: number }>;
  if (i >= 0) next[i] = { ...next[i], ...merged };
  else next.push(merged);
  next.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return next as TurnRow[];
}

/**
 * The read ended with a step still running. On a normal finish nothing will close it, so it goes
 * (same rule as `settleOpenSteps`). On a Stop or the six-minute window it stays, marked stopped —
 * the tool may still be finishing on the server, and the row says so instead of vanishing.
 */
export function settleTurnRows(rows: TurnRow[], cause: TurnEndCause): TurnRow[] {
  if (!rows.some((r) => r.status === "running")) return rows;
  if (cause === "done") return rows.filter((r) => r.status !== "running");
  const detail = cause === "cancelled" ? "Stopped — it may still finish on its own" : "No answer before the window ended";
  return rows.map((r) => r.status === "running" ? { ...r, status: "stopped" as const, detail } : r);
}

/** Read `bundle_ref.turn_trace` defensively: well-formed done/error entries only. */
export function readTurnTrace(value: unknown): TurnRow[] {
  if (!Array.isArray(value)) return [];
  const out: TurnRow[] = [];
  value.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const e = entry as Record<string, unknown>;
    if (typeof e.label !== "string" || !e.label.trim()) return;
    if (e.status !== "done" && e.status !== "error") return;
    const group: TurnGroup = e.group === "client" || e.group === "shared" ? e.group : "owner";
    out.push({ id: `trace-${i}`, label: e.label.trim(), group, status: e.status });
  });
  return out;
}

export { readTurnRecord } from "../../../supabase/functions/_shared/paige-turn/contract";

/** A persisted record, reduced to what the line needs. */
export function outcomeFromRecord(record: TurnRecord | null): TurnOutcome | null {
  return record ? { state: record.state, mode: record.mode } : null;
}

/**
 * Is this user turn one of the card's own decision sentences? Presentation only: the bubble is
 * hidden, the turn itself stays in the transcript and in what is sent. Exact match, plus the
 * " [Card result — …]" suffix the client appends after a stored proposal ran.
 */
export function isDecisionReplyText(content: string): "approved" | "declined" | null {
  if (content === DECISION_REPLY.declined) return "declined";
  if (content === DECISION_REPLY.approved) return "approved";
  if (decisionCardResult(content) !== null) return "approved";
  return null;
}

/**
 * The verified result the client itself appended after a stored proposal ran — the text inside
 * " [Card result — …]", e.g. "Add John Coleman as a contact: didn't run". It is the client's own
 * readback of the door's answer (ran / didn't run / couldn't confirm), written at the send site in
 * `PaigeAIChat`, never model prose. Hiding the bubble must not hide this: where no report card
 * answers for the decision (the drawer, and every reload) it is drawn with the decision record.
 * Null when the sentence carries no result.
 */
export function decisionCardResult(content: string): string | null {
  const head = DECISION_REPLY.approved + CARD_RESULT_SUFFIX;
  if (!content.startsWith(head) || !content.endsWith("]")) return null;
  const inner = content.slice(head.length, -1).trim();
  return inner || null;
}

function doneLine(rows: TurnRow[], elapsed: number | null, name: string): TurnView | null {
  if (rows.length === 0) return null; // never an empty "What PAIGE did"
  return { kind: "done", glyph: "check", text: `What ${name} did · ${stepsWord(rows.length)}`, elapsed, steps: null, rows, footer: null, announce: "Done" };
}

/** The line for an answer that is no longer being read. */
export function deriveSnapshotView(
  snap: TurnSnapshot,
  opts: { personaName?: string; awaitingApproval: boolean; ask?: AskStanding },
): TurnView | null {
  const name = nameOf(opts.personaName);
  const rows = snap.rows;
  const elapsed = snap.source === "live" ? snap.elapsedMs : null;

  if (snap.endCause === "cancelled") {
    // §13 — Stop ends the READ, not the work. The server has no cancel path for a tool loop that is
    // already running (`req.signal` reaches only the spine resolver; step emits swallow a hung-up
    // client), so it may start further steps and save the answer after this. The footer claims
    // exactly that much and no more — never "anything finished is saved", never "only the step
    // that had started".
    return {
      kind: "stop", glyph: "pause", text: "Stopped by you", elapsed, steps: null, rows,
      footer: {
        text: `Stopped showing this answer. ${name} may still finish work that had already started.`,
        actions: rows.length ? ["see", "askAgain"] : ["askAgain"],
      },
      announce: "Stopped",
    };
  }
  if (snap.endCause === "timeout") {
    return {
      kind: "neutral", glyph: "clock", text: "Stopped listening at six minutes", elapsed,
      steps: rows.length || null, rows, footer: null, announce: `${name} stopped listening`,
    };
  }

  const o = snap.outcome;
  if (!o || o.state === "WORKING") {
    if (snap.source === "reload") {
      if (!o) return null; // an old row with no record: exactly as before C3
      return {
        kind: "neutral", glyph: "pause", text: "Didn't finish", elapsed: null, steps: null, rows,
        footer: { text: "", actions: ["askAgain"] }, announce: `${name} didn't finish`,
      };
    }
    // The body ended without a terminal frame: show what ran, and claim nothing about how it ended.
    if (!rows.length) return null;
    return { kind: "neutral", glyph: "none", text: `What ${name} did · ${stepsWord(rows.length)}`, elapsed, steps: null, rows, footer: null, announce: "Response ended" };
  }

  switch (o.state) {
    case "FINAL":
      return o.mode === "fast_answer" ? null : doneLine(rows, elapsed, name);
    case "ASK_USER":
      // C4c — c2: still open, it is the person's call; c5: they moved on, so it stays unanswered (it
      // is never answered for them). Answered (c3/c6): what she did before asking, as any answer.
      if (opts.ask === "open") {
        return { kind: "wait", glyph: "help", text: "Your call", elapsed: null, steps: null, rows, footer: null, announce: `${name} has a question for you` };
      }
      if (opts.ask === "unanswered") {
        return { kind: "neutral", glyph: "help", text: "Question not answered", elapsed: null, steps: null, rows, footer: null, announce: "Question not answered" };
      }
      return doneLine(rows, elapsed, name);
    case "WAIT_APPROVAL":
      if (opts.awaitingApproval) {
        return { kind: "wait", glyph: "hand", text: "Waiting for your OK", elapsed: null, steps: null, rows, footer: null, announce: `${name} needs your OK` };
      }
      return doneLine(rows, elapsed, name);
    case "WAIT_WORK":
      return { kind: "bg", glyph: "clock", text: "Started in the background", elapsed: null, steps: rows.length || null, rows, footer: null, announce: `${name} started work in the background` };
    case "LIMIT_REACHED":
      return { kind: "warn", glyph: "triangle", text: "Reached the limit for one answer", elapsed: null, steps: rows.length || null, rows, footer: null, announce: `${name} reached a limit` };
    case "INTERRUPTED":
      return {
        kind: "warn", glyph: "triangle", text: "Stopped before finishing", elapsed, steps: null, rows,
        footer: { text: snap.hasContent ? "What arrived is above." : "", actions: ["askAgain"] },
        announce: `${name} stopped before finishing`,
      };
    case "REFUSED":
      // The copy names a cause because exactly one emitter exists today: the client-scope refusal
      // (`refusedTurn.refused()` in paige-ai-chat). A test pins that single caller — a second
      // emitter must change this line before it ships.
      return { kind: "held", glyph: "lock", text: "Stopped — couldn't confirm that client", elapsed: null, steps: null, rows, footer: null, announce: `${name} stopped` };
    case "WITHHELD":
      return { kind: "held", glyph: "lock", text: "Held back after a final check", elapsed: null, steps: null, rows, footer: null, announce: `${name} held this answer back` };
    default:
      return null;
  }
}

/**
 * C4a — ONE ANSWER, ONE LINE. When an approval resumes the objective, the answer that asked and the
 * answer that carried it forward are drawn as one (prototype frames a3/a4): a single line whose
 * "What PAIGE did" lists the steps before the card and the steps after it, in that order. Ids are
 * namespaced so a reloaded trace (`trace-0` on both turns) cannot collide.
 */
export function mergeResumedRows(prior: readonly TurnRow[], resumed: readonly TurnRow[]): TurnRow[] {
  return [
    ...prior.map((r) => ({ ...r, id: `before:${r.id}` })),
    ...resumed.map((r) => ({ ...r, id: `after:${r.id}` })),
  ];
}

/** The line for the answer being read right now (or just finished, in this session). */
export function deriveLiveTurnView(i: LiveTurnInput): TurnView | null {
  const view = deriveLiveTurnViewInner(i);
  // a3 — "Approved. PAIGE is working": what a screen reader hears when the carried-forward work starts.
  if (view && i.resumed && i.streaming && (view.kind === "work" || view.kind === "think")) {
    return { ...view, announce: `Approved. ${nameOf(i.personaName)} is working` };
  }
  return view;
}

function deriveLiveTurnViewInner(i: LiveTurnInput): TurnView | null {
  const name = nameOf(i.personaName);
  if (!i.streaming) {
    return deriveSnapshotView(
      { outcome: i.frame ? { state: i.frame.state, mode: i.frame.mode } : null, rows: i.rows, elapsedMs: i.elapsedMs, endCause: i.endCause ?? "done", source: "live", hasContent: i.hasContent },
      { personaName: i.personaName, awaitingApproval: i.awaitingApproval, ask: i.ask },
    );
  }

  const state = i.frame?.state ?? "WORKING";
  // A fast answer: the terminal arrives just before its first word, and the line steps aside for good.
  if (state === "FINAL" && i.frame?.mode === "fast_answer") return null;
  // A decided outcome that is not an ordinary answer is shown as soon as it is known — the sweep
  // stops; the words PAIGE streams after it explain it.
  if (state === "WAIT_APPROVAL" && i.awaitingApproval) {
    return deriveSnapshotView({ outcome: { state, mode: i.frame!.mode }, rows: i.rows, elapsedMs: null, endCause: null, source: "live", hasContent: i.hasContent }, { personaName: i.personaName, awaitingApproval: true });
  }
  if (state === "LIMIT_REACHED" || state === "INTERRUPTED" || state === "REFUSED" || state === "WITHHELD") {
    return deriveSnapshotView({ outcome: { state, mode: i.frame!.mode }, rows: i.rows, elapsedMs: null, endCause: null, source: "live", hasContent: i.hasContent }, { personaName: i.personaName, awaitingApproval: false });
  }

  // The 400 ms gate comes before every working label. A fast answer can see the server's writing
  // marker (held answers, Live and document turns emit it before their terminal) inside the gate,
  // and must still draw nothing: f1 / owner proof 1.
  if (!i.gateOpen && i.rows.length === 0) return null;
  const steps = i.rows.length >= 2 ? i.rows.length : null;
  const running = [...i.rows].reverse().find((r) => r.status === "running");
  if (running) {
    const slow = running.label === DEEP_RESEARCH_START && i.now - (running.since ?? i.startedAt) >= STILL_RESEARCHING_AFTER_MS;
    return { kind: "work", glyph: "dot", text: slow ? STILL_RESEARCHING : running.label, elapsed: "live", steps, rows: i.rows, footer: null, announce: `${name} is working` };
  }
  const terminalArrived = i.frame?.event === "completed" || i.frame?.event === "waiting";
  if (terminalArrived || i.writing) {
    return { kind: "work", glyph: "dot", text: "Writing the answer", elapsed: "live", steps, rows: i.rows, footer: null, announce: `${name} is working` };
  }
  return { kind: "think", glyph: "dot", text: "Thinking", elapsed: "live", steps, rows: i.rows, footer: null, announce: `${name} is working` };
}
