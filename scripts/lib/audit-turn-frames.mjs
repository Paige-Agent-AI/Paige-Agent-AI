/**
 * THE TURN-FRAME STREAM AUDIT — the one copy both chat harnesses use (paige-turn,
 * docs/delivery/paige-conversational-loop-c1.md).
 *
 * `scripts/client-memory-authz/check.mjs` and `scripts/knowledge-scope/stage1-check.mjs` each drive the
 * real `paige-ai-chat` handler and audit every stream they produce for the turn frame. The structural
 * rules are the same in both, so they live here once and a change to the terminal rule is made once.
 * Each harness keeps its own counters, its own extra rules (confirm cards, refusals, changed
 * workspaces) and its own assertion ids; this only reads one stream and says what it found.
 *
 * The rules, for every stream that carries `data:` lines:
 *   - the first frame is `paige_turn` / `started`, and `started` appears exactly once;
 *   - every `paige_turn` frame passes the contract's closed-shape reader (when one is supplied);
 *   - exactly ONE terminal (`completed` or `waiting`);
 *   - the terminal precedes the first answer frame (reply text in `choices`, or a Studio question's
 *     `paige_choices`) and the first `[DONE]`;
 *   - a withheld turn (`paige_withheld` on the wire) ends WITHHELD.
 *
 * And the tool-step lifecycle (C2b, docs/delivery/paige-conversational-loop-c2.md), read from every
 * `paige_step` frame (`auditStepLifecycle`, below):
 *   - a step's status is `running`, `done`, `error`, `withdrawn`, or missing (an older frame: done);
 *   - a thought is never `running` and never `withdrawn` — it is only ever sent finished;
 *   - per id: at most one `running`, first; then exactly ONE close (done / error / withdrawn / missing),
 *     carrying the same `seq` as its `running`; nothing after the close;
 *   - `withdrawn` only ever closes a `running` (there is nothing to take back otherwise);
 *   - no id is left `running` when the stream ends;
 *   - every step frame precedes the first answer frame and the first `[DONE]`.
 *
 * Plus one rule a harness applies where it can see the saved turn (C2): the answer a reader gets up
 * to the first `[DONE]` is exactly the text the thread kept, and no reply text follows that `[DONE]`
 * (`wireAnswerText` / `wireAnswerMatchesSaved`, below).
 *
 * Pure: no imports, no I/O. The contract's `isTurnFrame` is passed in, so this file needs no TypeScript
 * loader of its own.
 */

/**
 * @param {string} bodyText the full SSE response body
 * @param {{ isTurnFrame?: (value: unknown) => boolean }} [options]
 * @returns {null | {
 *   violations: string[],
 *   terminal: { i: number, t: { v: number, event: string, state: string, mode: string } } | null,
 *   items: Array<{ done?: true, f?: Record<string, unknown>, bad?: true }>,
 *   has: (key: string) => boolean,
 * }} null when the body carries no `data:` line (not a stream)
 */
export function auditTurnStream(bodyText, { isTurnFrame } = {}) {
  if (typeof bodyText !== "string") return null;
  const lines = bodyText.split("\n").filter((l) => l.startsWith("data: "));
  if (!lines.length) return null;
  const items = lines.map((l) => {
    const raw = l.slice(6).trim();
    if (raw === "[DONE]") return { done: true };
    try { return { f: JSON.parse(raw) }; } catch { return { bad: true }; }
  });
  const violations = [];
  const has = (key) => items.some((it) => it.f && Object.prototype.hasOwnProperty.call(it.f, key));
  const turns = items.map((it, i) => ({ i, t: it.f?.paige_turn })).filter((x) => x.t !== undefined);
  const started = turns.filter((x) => x.t?.event === "started").length;
  const terminals = turns.filter((x) => x.t?.event === "completed" || x.t?.event === "waiting");

  if (items[0]?.f?.paige_turn?.event !== "started") violations.push(`first frame is not started: ${lines[0]?.slice(0, 80)}`);
  if (started !== 1) violations.push(`started ${started} times`);
  if (isTurnFrame && turns.some((x) => !isTurnFrame(x.t))) {
    violations.push(`a turn frame outside the contract: ${JSON.stringify(turns.map((x) => x.t))}`);
  }
  for (const why of auditStepLifecycle(items)) violations.push(why);
  if (terminals.length !== 1) {
    violations.push(`${terminals.length} terminal frames: ${JSON.stringify(turns.map((x) => x.t))}`);
    return { violations, terminal: null, items, has };
  }
  const [terminal] = terminals;
  // The answer is the reply text or, on a Studio question, the chips.
  const firstAnswer = items.findIndex((it) => Array.isArray(it.f?.choices) || it.f?.paige_choices !== undefined);
  const firstDone = items.findIndex((it) => it.done);
  if (firstAnswer !== -1 && terminal.i > firstAnswer) violations.push(`terminal after the first answer frame (${terminal.i} > ${firstAnswer})`);
  if (firstDone !== -1 && terminal.i > firstDone) violations.push(`terminal after [DONE] (${terminal.i} > ${firstDone})`);
  if (has("paige_withheld") && terminal.t.state !== "WITHHELD") violations.push(`a withheld turn's terminal is ${terminal.t.state}`);
  return { violations, terminal, items, has };
}

const STEP_STATUSES = new Set(["running", "done", "error", "withdrawn"]);

/**
 * THE TOOL-STEP LIFECYCLE (C2b). Reads the parsed items of one stream (as `auditTurnStream` builds
 * them) and returns every way its `paige_step` frames break the contract in the header above.
 *
 * @param {Array<{ done?: true, f?: Record<string, unknown>, bad?: true }>} items
 * @returns {string[]}
 */
export function auditStepLifecycle(items) {
  const violations = [];
  const firstAnswer = items.findIndex((it) => Array.isArray(it.f?.choices) || it.f?.paige_choices !== undefined);
  const firstDone = items.findIndex((it) => it.done);
  const fence = [firstAnswer, firstDone].filter((i) => i !== -1).reduce((a, b) => Math.min(a, b), Infinity);
  /** @type {Map<string, { open: boolean, seq: unknown, closed: boolean }>} */
  const byId = new Map();
  items.forEach((it, i) => {
    const s = /** @type {any} */ (it.f?.paige_step);
    if (s === undefined) return;
    const id = String(s?.id ?? "");
    const status = s?.status;
    const at = `step ${JSON.stringify(id)} (${s?.kind ?? "?"}, ${status ?? "missing"})`;
    if (status !== undefined && !STEP_STATUSES.has(status)) { violations.push(`${at}: status outside the lifecycle`); return; }
    if (s?.kind === "thought" && (status === "running" || status === "withdrawn")) violations.push(`${at}: a thought is only ever sent finished`);
    if (i > fence) violations.push(`${at}: after the first answer frame or [DONE] (${i} > ${fence})`);
    const prior = byId.get(id);
    if (prior?.closed) { violations.push(`${at}: arrived after the step had already closed`); return; }
    if (status === "running") {
      if (prior?.open) { violations.push(`${at}: started twice`); return; }
      byId.set(id, { open: true, seq: s?.seq, closed: false });
      return;
    }
    if (status === "withdrawn" && !prior?.open) violations.push(`${at}: withdrawn without a running start`);
    if (prior?.open && prior.seq !== s?.seq) violations.push(`${at}: closed with seq ${JSON.stringify(s?.seq)}, started with ${JSON.stringify(prior.seq)}`);
    byId.set(id, { open: false, seq: s?.seq, closed: true });
  });
  for (const [id, st] of byId) if (st.open) violations.push(`step ${JSON.stringify(id)} still running when the stream ended`);
  return violations;
}

/**
 * THE ANSWER A CLIENT READS, from one SSE body: every reply-text delta (`choices[0].delta.content`) and
 * any Studio question's `paige_choices.prompt`, joined in wire order, up to the FIRST `[DONE]` — where
 * four of the seven SSE consumers stop reading. Text after that sentinel never reaches those readers,
 * so it is not part of the answer they saw; it is still a defect, and `wireAnswerMatchesSaved` reports
 * it by comparing what a reader got with what the thread kept.
 *
 * @param {string} bodyText
 * @returns {string}
 */
export function wireAnswerText(bodyText) {
  if (typeof bodyText !== "string") return "";
  const lines = bodyText.split("\n").filter((l) => l.startsWith("data: "));
  let out = "";
  for (const l of lines) {
    const raw = l.slice(6).trim();
    if (raw === "[DONE]") break;
    let f;
    try { f = JSON.parse(raw); } catch { continue; }
    const c = f?.choices?.[0]?.delta?.content;
    if (typeof c === "string") out += c;
    if (typeof f?.paige_choices?.prompt === "string") out += f.paige_choices.prompt;
  }
  return out;
}

/**
 * THE WIRE AND THE TRANSCRIPT CARRY THE SAME ANSWER (§13/§94). Given one stream and the assistant text
 * the thread saved for it, says why they differ, or null when they agree. Also flags any reply text
 * that arrives AFTER the first `[DONE]` (a reader that stops there never sees it, and one that does
 * not stop sees a different answer from the one saved).
 *
 * @param {string} bodyText
 * @param {string} savedText
 * @returns {string | null}
 */
export function wireAnswerMatchesSaved(bodyText, savedText) {
  const read = wireAnswerText(bodyText);
  const saved = String(savedText ?? "");
  if (read !== saved) return `the wire answer differs from the saved one: ${JSON.stringify(read.slice(0, 80))} vs ${JSON.stringify(saved.slice(0, 80))}`;
  const lines = String(bodyText).split("\n").filter((l) => l.startsWith("data: "));
  const firstDone = lines.indexOf("data: [DONE]");
  if (firstDone !== -1) {
    const late = lines.slice(firstDone + 1).some((l) => {
      try { const f = JSON.parse(l.slice(6)); return typeof f?.choices?.[0]?.delta?.content === "string" && f.choices[0].delta.content.length > 0; } catch { return false; }
    });
    if (late) return "reply text after the first [DONE]";
  }
  return null;
}
