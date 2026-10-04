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
