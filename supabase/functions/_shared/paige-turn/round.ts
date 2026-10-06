// INT-334 R3 (the R7 invariant, built ahead of its caller) — A TOOL CALL RUNS ONLY FROM A FINISHED ROUND.
//
// A provider stream can show a tool call's id, name and arguments and then fail, be cut off, be
// cancelled, hit its token limit or turn into a refusal. Those calls are on the wire, but the model
// never finished deciding them. PAIGE must not execute them (owner ruling 2026-10-06, an acceptance
// requirement for R7, not a follow-up).
//
// ONE GATE FOR EVERY PROVIDER. Both stream converters — Anthropic (`claude.ts`
// `streamAnthropicAsOpenAI`) and OpenAI (`openai-responses.ts` `responsesStream`) — emit the same
// chat-shaped SSE. Each sends `finish_reason: "tool_calls"` only when the provider reported a normal
// tool-use stop, and sends NO finish at all when the stream failed, errored, was cut off or (OpenAI)
// was cancelled or ended on a non-terminal status. A token-limit stop is `length` (OpenAI) or `stop`
// (Anthropic); a refusal is `content_filter` (OpenAI) or `stop` (Anthropic). So the rule is one line
// and needs no knowledge of the provider: only a round whose finish is `tool_calls`, reached cleanly,
// may hand its calls to `executeToolCalls` — and only if every call in it is whole.
//
// Pure TypeScript, no imports, so Deno and Node both load it. Dormant until R7 routes chat through it.

/** How a model round ended, read from the chat-shaped stream. */
export const ROUND_ENDS = [
  "tool_use",        // finish_reason "tool_calls": the model finished choosing its calls
  "end_turn",        // finish_reason "stop": an answer (or, from Anthropic, a refusal or a token limit)
  "max_tokens",      // finish_reason "length"
  "refusal",         // finish_reason "content_filter"
  "unfinished",      // the stream ended with no finish at all: failed, errored, cancelled or truncated
  "transport_error", // the reader itself failed before the stream closed
] as const;
export type RoundEnd = (typeof ROUND_ENDS)[number];

export interface RoundToolCall { index: number; id: string; name: string; arguments: string }

export interface ModelRound {
  end: RoundEnd;
  toolCalls: RoundToolCall[];
  text: string;
}

/**
 * Fold a chat-shaped stream into one round. `payloads` are the `data:` payloads in order (JSON text or
 * "[DONE]"); `transportFailed` is true when the reader threw before the stream closed. Tool-call
 * fragments are joined by their `index`, exactly as the chat handler joins them today.
 */
export function readModelRound(payloads: Iterable<string>, transportFailed = false): ModelRound {
  const calls = new Map<number, RoundToolCall>();
  let text = "";
  let finish: string | null = null;
  let done = false;
  for (const raw of payloads) {
    const p = typeof raw === "string" ? raw.trim() : "";
    if (!p) continue;
    if (p === "[DONE]") { done = true; continue; }
    let frame: any;
    try { frame = JSON.parse(p); } catch { continue; }
    const choice = Array.isArray(frame?.choices) ? frame.choices[0] : null;
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string") text += delta.content;
    for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const i = Number.isInteger(tc?.index) ? tc.index : 0;
      const cur = calls.get(i) ?? { index: i, id: "", name: "", arguments: "" };
      if (typeof tc?.id === "string" && tc.id) cur.id = tc.id;
      if (typeof tc?.function?.name === "string" && tc.function.name) cur.name = tc.function.name;
      if (typeof tc?.function?.arguments === "string") cur.arguments += tc.function.arguments;
      calls.set(i, cur);
    }
    if (typeof choice.finish_reason === "string" && choice.finish_reason) finish = choice.finish_reason;
  }
  const toolCalls = [...calls.values()].sort((a, b) => a.index - b.index);
  let end: RoundEnd;
  if (transportFailed) end = "transport_error";
  else if (!finish || !done) end = "unfinished";
  else if (finish === "tool_calls") end = "tool_use";
  else if (finish === "length") end = "max_tokens";
  else if (finish === "content_filter") end = "refusal";
  else end = "end_turn";
  return { end, toolCalls, text };
}

function wholeCall(c: RoundToolCall): boolean {
  if (!c.id || !c.name) return false;
  try {
    const v = JSON.parse(c.arguments || "");
    return !!v && typeof v === "object" && !Array.isArray(v);
  } catch {
    return false;
  }
}

/**
 * THE GATE. The calls `executeToolCalls` may receive from this round: all of them when the round
 * ended in a normal tool-use stop and every call is whole (an id, a name, a JSON-object argument),
 * otherwise NONE. A batch is all-or-nothing: if one call is malformed, the model's decision is not
 * trusted for the others either. This does not decide whether a call is ALLOWED — the gate after it
 * still does; it decides only whether the model finished asking.
 */
export function executableToolCalls(round: ModelRound): RoundToolCall[] {
  if (round.end !== "tool_use") return [];
  if (!round.toolCalls.length || !round.toolCalls.every(wholeCall)) return [];
  return round.toolCalls;
}
