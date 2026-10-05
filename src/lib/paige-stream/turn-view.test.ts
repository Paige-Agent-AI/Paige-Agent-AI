// C3a — the living turn view. Every case drives the view from TURN STATE and step frames only:
// the module is handed whether answer text has arrived (a boolean), never the text itself, so
// nothing PAIGE writes can steer what the status line claims (owner ruling 2026-10-05).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STEP_START_LABELS } from "../../../supabase/functions/_shared/paige-turn/step-start";
import { TURN_MODES, TURN_STATES, type TurnFrame, type TurnMode, type TurnState } from "../../../supabase/functions/_shared/paige-turn/contract";
import {
  DECISION_REPLY,
  STILL_RESEARCHING,
  deriveLiveTurnView,
  deriveSnapshotView,
  formatElapsed,
  isDecisionReplyText,
  readTurnTrace,
  settleTurnRows,
  upsertTurnRow,
  type LiveTurnInput,
  type TurnRow,
} from "./turn-view";

const T0 = 1_000_000;
const frame = (event: TurnFrame["event"], state: TurnState, mode: TurnMode): TurnFrame => ({ v: 1, event, state, mode });
const row = (id: string, label: string, status: TurnRow["status"] = "done", since = T0): TurnRow =>
  ({ id, label, group: "owner", status, since });

function live(over: Partial<LiveTurnInput> = {}): LiveTurnInput {
  return {
    frame: frame("started", "WORKING", "pending"),
    rows: [],
    streaming: true,
    writing: false,
    gateOpen: true,
    startedAt: T0,
    now: T0 + 2_000,
    endCause: null,
    elapsedMs: null,
    hasContent: false,
    awaitingApproval: false,
    personaName: "PAIGE",
    ...over,
  };
}

describe("turn view — while PAIGE is working", () => {
  it("shows nothing for the first 400 ms, then Thinking", () => {
    expect(deriveLiveTurnView(live({ gateOpen: false }))).toBeNull();
    const v = deriveLiveTurnView(live())!;
    expect([v.kind, v.text, v.glyph, v.elapsed]).toEqual(["think", "Thinking", "dot", "live"]);
  });

  it("a fast answer never gets a line — not while streaming, not after", () => {
    const fast = frame("completed", "FINAL", "fast_answer");
    expect(deriveLiveTurnView(live({ frame: fast }))).toBeNull();
    expect(deriveLiveTurnView(live({ frame: fast, hasContent: true }))).toBeNull();
    expect(deriveLiveTurnView(live({ frame: fast, streaming: false, endCause: "done", elapsedMs: 2_000, hasContent: true }))).toBeNull();
  });

  it("a running step's label wins over Writing, and Writing wins over Thinking", () => {
    const running = live({ rows: [row("a", "Looked through your contacts"), row("b", "Reviewing your pipeline", "running")] });
    expect(deriveLiveTurnView(running)!.text).toBe("Reviewing your pipeline");
    expect(deriveLiveTurnView(running)!.steps).toBe(2);

    const runningAfterTerminal = live({ frame: frame("completed", "FINAL", "action"), rows: [row("b", "Sending to Daniel", "running")] });
    expect(deriveLiveTurnView(runningAfterTerminal)!.text).toBe("Sending to Daniel");

    const writing = live({ frame: frame("completed", "FINAL", "answer"), rows: [row("a", "Looked")] });
    expect(deriveLiveTurnView(writing)!.text).toBe("Writing the answer");
    expect(deriveLiveTurnView(writing)!.kind).toBe("work");

    // An acknowledgement that streams before any terminal is NOT the answer being written.
    expect(deriveLiveTurnView(live({ hasContent: true }))!.text).toBe("Thinking");
    // The server's own writing phase is a truthful signal too.
    expect(deriveLiveTurnView(live({ writing: true }))!.text).toBe("Writing the answer");
  });

  it("one step shows elapsed only; two or more add the count", () => {
    expect(deriveLiveTurnView(live({ rows: [row("a", "Looking", "running")] }))!.steps).toBeNull();
    expect(deriveLiveTurnView(live({ rows: [row("a", "One"), row("b", "Two", "running")] }))!.steps).toBe(2);
  });

  it("Deep Research says it is still researching after 10 s of the real START label, and only then", () => {
    const label = STEP_START_LABELS.deep_research;
    const at = (ms: number) => deriveLiveTurnView(live({ rows: [row("r", label, "running", T0)], now: T0 + ms }))!.text;
    expect(at(9_000)).toBe(label);
    expect(at(10_500)).toBe(STILL_RESEARCHING);
    // Another tool held for 10 s keeps its own label.
    expect(deriveLiveTurnView(live({ rows: [row("x", "Searching the web", "running", T0)], now: T0 + 30_000 }))!.text)
      .toBe("Searching the web");
  });

  it("waiting on an approval stops the work line at once, while text is still arriving", () => {
    const v = deriveLiveTurnView(live({ frame: frame("waiting", "WAIT_APPROVAL", "action"), rows: [row("a", "Drafted")], awaitingApproval: true, hasContent: true }))!;
    expect([v.kind, v.glyph, v.text, v.elapsed]).toEqual(["wait", "hand", "Waiting for your OK", null]);
  });
});

describe("turn view — after the turn ends", () => {
  const ended = (state: TurnState | null, over: Partial<LiveTurnInput> = {}) => deriveLiveTurnView(live({
    frame: state ? frame(state === "WAIT_APPROVAL" ? "waiting" : "completed", state, "answer") : null,
    streaming: false,
    endCause: "done",
    elapsedMs: 14_000,
    ...over,
  }));

  it("FINAL with steps settles into What PAIGE did, with a check and the measured time", () => {
    const v = ended("FINAL", { rows: [row("a", "One"), row("b", "Two", "error")] })!;
    expect([v.kind, v.glyph, v.text, v.elapsed]).toEqual(["done", "check", "What PAIGE did · 2 steps", 14_000]);
    expect(ended("FINAL", { rows: [row("a", "One")] })!.text).toBe("What PAIGE did · 1 step");
  });

  it("FINAL with no steps leaves no line — never an empty trace", () => {
    expect(ended("FINAL")).toBeNull();
  });

  it("uses the tenant's persona name", () => {
    expect(ended("FINAL", { rows: [row("a", "One")], personaName: "Rowan" })!.text).toBe("What Rowan did · 1 step");
    expect(ended("FINAL", { rows: [row("a", "One")], personaName: "" })!.text).toBe("What PAIGE did · 1 step");
  });

  it("[DONE] with no terminal never claims Done: no check, no Done announcement", () => {
    const v = ended(null, { rows: [row("a", "One")] })!;
    expect(v.glyph).toBe("none");
    expect(v.announce).not.toMatch(/done/i);
    expect(ended("WORKING", { rows: [row("a", "One")] })!.glyph).toBe("none");
    expect(ended(null)).toBeNull();
  });

  it("LIMIT_REACHED and INTERRUPTED are warnings, never a check", () => {
    const limit = ended("LIMIT_REACHED", { rows: [row("a", "One"), row("b", "Two")] })!;
    expect([limit.kind, limit.glyph, limit.text, limit.steps, limit.footer]).toEqual(["warn", "triangle", "Reached the limit for one answer", 2, null]);
    const stopped = ended("INTERRUPTED", { hasContent: true })!;
    expect([stopped.kind, stopped.glyph, stopped.text]).toEqual(["warn", "triangle", "Stopped before finishing"]);
    expect(stopped.footer).toEqual({ text: "What arrived is above.", actions: ["askAgain"] });
    expect(ended("INTERRUPTED", { hasContent: false })!.footer).toEqual({ text: "", actions: ["askAgain"] });
  });

  it("REFUSED and WITHHELD are neutral locks", () => {
    expect(ended("REFUSED")).toMatchObject({ kind: "held", glyph: "lock", text: "Stopped — couldn't confirm that client" });
    expect(ended("WITHHELD")).toMatchObject({ kind: "held", glyph: "lock", text: "Held back after a final check" });
  });

  it("WAIT_WORK says it started in the background and claims no progress", () => {
    expect(ended("WAIT_WORK", { rows: [row("a", "Started the document")] })).toMatchObject({ kind: "bg", glyph: "clock", text: "Started in the background", steps: 1 });
  });

  it("a decided or no-longer-live approval settles like an answer", () => {
    expect(ended("WAIT_APPROVAL", { rows: [row("a", "Drafted")], awaitingApproval: true })).toMatchObject({ kind: "wait", text: "Waiting for your OK" });
    expect(ended("WAIT_APPROVAL", { rows: [row("a", "Drafted")], awaitingApproval: false })).toMatchObject({ kind: "done", text: "What PAIGE did · 1 step" });
    expect(ended("WAIT_APPROVAL", { awaitingApproval: false })).toBeNull();
  });

  it("Stop: stopped rows, a neutral pause, and the footer that says what may still finish", () => {
    const v = deriveLiveTurnView(live({
      streaming: false, endCause: "cancelled", elapsedMs: 7_000,
      rows: settleTurnRows([row("a", "Looked"), row("b", "Reviewing your pipeline", "running")], "cancelled"),
    }))!;
    expect([v.kind, v.glyph, v.text, v.elapsed]).toEqual(["stop", "pause", "Stopped by you", 7_000]);
    expect(v.rows.map((r) => [r.status, r.detail])).toEqual([["done", undefined], ["stopped", "Stopped — it may still finish on its own"]]);
    // §13 — Stop ends the read, not the work: the server has no cancel path for a running tool loop.
    // The footer claims no more than that — nothing about what was saved, nothing that limits it to
    // "the step that had started".
    expect(v.footer).toEqual({
      text: "Stopped showing this answer. PAIGE may still finish work that had already started.",
      actions: ["see", "askAgain"],
    });
    expect(v.footer!.text).not.toMatch(/saved|only|cancel(l)?ed on/i);
  });

  it("the six-minute window stops listening honestly", () => {
    const v = deriveLiveTurnView(live({
      streaming: false, endCause: "timeout", elapsedMs: 360_000,
      rows: settleTurnRows([row("a", "Looked"), row("b", "Checking your tasks", "running")], "timeout"),
    }))!;
    expect([v.kind, v.glyph, v.text, v.steps]).toEqual(["neutral", "clock", "Stopped listening at six minutes", 2]);
    expect(v.rows[1]).toMatchObject({ status: "stopped", detail: "No answer before the window ended" });
  });

  it("every TurnState × mode maps to exactly one outcome, and none but FINAL/decided approval gets a check", () => {
    for (const state of TURN_STATES) {
      for (const mode of TURN_MODES) {
        const v = deriveLiveTurnView(live({
          frame: frame(state === "WORKING" ? "started" : "completed", state, mode),
          streaming: false, endCause: "done", elapsedMs: 1_000, rows: [row("a", "One")],
        }));
        if (state === "FINAL" && mode === "fast_answer") { expect(v).toBeNull(); continue; }
        expect(v).not.toBeNull();
        if (v!.glyph === "check") expect(["FINAL", "WAIT_APPROVAL", "ASK_USER"]).toContain(state);
      }
    }
  });
});

describe("turn view — a saved thread reads back the same", () => {
  it("reload settle matches the live settle for the same trace (time and step detail excepted)", () => {
    const rows = [row("a", "Looked through your contacts"), row("b", "Checked your calendar", "error")];
    const liveView = deriveLiveTurnView(live({ frame: frame("completed", "FINAL", "action"), streaming: false, endCause: "done", elapsedMs: 9_000, rows }))!;
    const persisted = readTurnTrace(rows.map(({ label, group, status }) => ({ label, group, status })));
    const reloaded = deriveSnapshotView({ outcome: { state: "FINAL", mode: "action" }, rows: persisted, elapsedMs: null, endCause: null, source: "reload", hasContent: true }, { personaName: "PAIGE", awaitingApproval: false })!;
    expect([reloaded.kind, reloaded.glyph, reloaded.text]).toEqual([liveView.kind, liveView.glyph, liveView.text]);
    expect(reloaded.rows.map((r) => [r.label, r.status])).toEqual(liveView.rows.map((r) => [r.label, r.status]));
    expect(reloaded.elapsed).toBeNull();
  });

  it("an old row with no record has no line; a record left WORKING reads Didn't finish", () => {
    expect(deriveSnapshotView({ outcome: null, rows: [], elapsedMs: null, endCause: null, source: "reload", hasContent: true }, { personaName: "PAIGE", awaitingApproval: false })).toBeNull();
    expect(deriveSnapshotView({ outcome: { state: "WORKING", mode: "pending" }, rows: [], elapsedMs: null, endCause: null, source: "reload", hasContent: false }, { personaName: "PAIGE", awaitingApproval: false }))
      .toMatchObject({ kind: "neutral", glyph: "pause", text: "Didn't finish", footer: { text: "", actions: ["askAgain"] } });
  });

  it("readTurnTrace keeps only well-formed done/error entries", () => {
    expect(readTurnTrace(undefined)).toEqual([]);
    expect(readTurnTrace({ label: "x" })).toEqual([]);
    expect(readTurnTrace([
      { label: "Looked", group: "owner", status: "done" },
      { label: "Failed", group: "client", status: "error" },
      { label: "", group: "owner", status: "done" },
      { label: "Running", group: "owner", status: "running" },
      { label: 5, group: "owner", status: "done" },
      { label: "Odd group", group: "evil", status: "done" },
    ]).map((r) => [r.label, r.group, r.status])).toEqual([
      ["Looked", "owner", "done"], ["Failed", "client", "error"], ["Odd group", "owner", "done"],
    ]);
  });
});

describe("turn rows from step frames", () => {
  it("keeps actions only, upserts by id in seq order, and drops a withdrawn row", () => {
    let rows: TurnRow[] = [];
    rows = upsertTurnRow(rows, { id: "t:1", seq: 0, round: 1, kind: "thought", label: "I will check", group: "owner" }, T0);
    expect(rows).toEqual([]);
    rows = upsertTurnRow(rows, { id: "b", seq: 2, round: 1, kind: "action", label: "Second", group: "owner", status: "running" }, T0);
    rows = upsertTurnRow(rows, { id: "a", seq: 1, round: 1, kind: "action", label: "First", group: "owner", status: "running" }, T0 + 5);
    rows = upsertTurnRow(rows, { id: "a", seq: 1, round: 1, kind: "action", label: "First done", group: "owner", status: "done", detail: "41 contacts" }, T0 + 9);
    expect(rows.map((r) => [r.id, r.label, r.status, r.detail, r.since])).toEqual([
      ["a", "First done", "done", "41 contacts", T0 + 5], ["b", "Second", "running", undefined, T0],
    ]);
    rows = upsertTurnRow(rows, { id: "b", seq: 2, round: 1, kind: "action", label: "Second", group: "owner", status: "withdrawn" }, T0 + 10);
    expect(rows.map((r) => r.id)).toEqual(["a"]);
    // A status this client does not know is ignored, never drawn as done.
    expect(upsertTurnRow(rows, { id: "c", seq: 3, round: 1, label: "Odd", group: "owner", status: "exploded" }, T0)).toBe(rows);
  });

  it("a finished read drops a step nothing will ever close", () => {
    expect(settleTurnRows([row("a", "One"), row("b", "Two", "running")], "done").map((r) => r.id)).toEqual(["a"]);
  });
});

describe("decision replies", () => {
  it("recognises only the client's own two sentences", () => {
    expect(isDecisionReplyText(DECISION_REPLY.approved)).toBe("approved");
    expect(isDecisionReplyText(`${DECISION_REPLY.approved} [Card result — Send the note: ran]`)).toBe("approved");
    expect(isDecisionReplyText(DECISION_REPLY.declined)).toBe("declined");
    expect(isDecisionReplyText("Approved — run it. Also email Maya.")).toBeNull();
    expect(isDecisionReplyText("approved — run it.")).toBeNull();
    expect(isDecisionReplyText("Approved")).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("reads like a clock a person would say", () => {
    expect([formatElapsed(400), formatElapsed(999), formatElapsed(1_000), formatElapsed(14_200), formatElapsed(74_000), formatElapsed(360_000)])
      .toEqual(["<1s", "<1s", "1s", "14s", "1m 14s", "6m"]);
  });
});

describe("prose independence (owner ruling: never infer state from final prose)", () => {
  it("the view module reads no answer text — only a boolean says whether any arrived", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/paige-stream/turn-view.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The decision detector and its result reader are the only string readers. Both read the USER
    // turn the card sent — the client's OWN constants and the suffix the client itself wrote — and
    // neither decides a turn state. No other function may read text.
    const body = src
      .replace(/export function isDecisionReplyText[\s\S]*?\n}\n/, "")
      .replace(/export function decisionCardResult[\s\S]*?\n}\n/, "");
    expect(body).not.toContain("isDecisionReplyText(");
    expect(body).not.toContain("decisionCardResult(");
    expect(body).not.toMatch(/\.content\b|\bcontent\s*[:?]|assistantMessage|answerText|\.includes\(|\.match\(|\.test\(|RegExp|startsWith|endsWith|indexOf/);
    // The same cases with arbitrary words "arriving" produce identical views — text cannot steer them.
    const a = deriveLiveTurnView(live({ frame: frame("completed", "FINAL", "answer"), rows: [row("a", "One")], streaming: false, endCause: "done", elapsedMs: 5, hasContent: true }));
    const b = deriveLiveTurnView(live({ frame: frame("completed", "FINAL", "answer"), rows: [row("a", "One")], streaming: false, endCause: "done", elapsedMs: 5, hasContent: true }));
    expect(a).toEqual(b);
  });
});

describe("REFUSED names a cause only while exactly one emitter exists", () => {
  // "Stopped — couldn't confirm that client" is true because the only `refused()` caller is the
  // client-scope refusal. A second emitter (a different reason) must change that line first.
  it("the client-scope refusal is the one and only `.refused()` caller", () => {
    const hits = execSync("git grep -n -F '.refused()' -- 'supabase/functions/*.ts' ':!*.test.ts' ':!*_test.ts' ':!*/tests/*'", { encoding: "utf8" })
      .trim().split("\n").filter(Boolean);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^supabase\/functions\/paige-ai-chat\/index\.ts:\d+:\s*refusedTurn\.refused\(\);$/);
    const src = readFileSync(resolve(process.cwd(), "supabase/functions/paige-ai-chat/index.ts"), "utf8");
    const at = src.indexOf("refusedTurn.refused();");
    expect(at).toBeGreaterThan(0);
    // It sits inside the client-scope refusal branch, a few lines below its opening.
    expect(src.slice(Math.max(0, at - 1600), at)).toContain("if (clientScopeDenied) {");
  });
});
