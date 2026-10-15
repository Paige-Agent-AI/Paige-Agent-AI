/**
 * The R7 invariant, pinned through BOTH real stream converters (INT-334 R3).
 *
 * A tool call may run only from a model round that reached a normal tool-use stop. This drives the
 * REAL Anthropic converter (`claude.ts` gatewayCompat → streamAnthropicAsOpenAI) and the REAL OpenAI
 * converter (`openai-responses.ts` responsesStream) with each provider's NATIVE event stream for every
 * owner-mandated case, then hands what PAIGE would read to the shared gate
 * (`_shared/paige-turn/round.ts`). Only the normal tool-use stop may yield calls to execute — for both
 * providers. A converter change that started finishing a failed, cut, cancelled, truncated or refused
 * round as `tool_calls` fails here, whichever provider it is in.
 *
 * No network: fetch is a recording fake per provider. Run: `npm run test:round-gate`.
 */
import { setScenario } from "../client-memory-authz/fake-supabase.mjs";

const ENV = {
  ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key",
  OPENAI_API_KEY: "sk-test-not-a-real-key",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};
globalThis.Deno = { env: { get: (k) => ENV[k] ?? undefined, toObject: () => ({ ...ENV }) } };
setScenario({});

/** A provider body: SSE events, optionally breaking (a transport failure) after them. */
function body(events, breakAfter = false) {
  const enc = new TextEncoder();
  const queue = events.map((e) => enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
  // Pull-based, so every event is READ before the break (error() would discard queued chunks).
  return new ReadableStream({
    pull(c) {
      if (queue.length) c.enqueue(queue.shift());
      else if (breakAfter) c.error(new Error("connection reset"));
      else c.close();
    },
  });
}
let nextAnthropic = null;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith("https://api.anthropic.com/")) {
    return new Response(body(nextAnthropic.events, nextAnthropic.breakAfter), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  throw new Error(`round-gate-check: unexpected network call to ${u}`);
};

const claude = await import("../../supabase/functions/_shared/claude.ts");
const oa = await import("../../supabase/functions/_shared/openai-responses.ts");
const { readModelRound, executableToolCalls } = await import("../../supabase/functions/_shared/paige-turn/round.ts");

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log(`  FAIL  ${name}`); } };

const TOOL = { type: "function", function: { name: "crm_contact_lookup", description: "Find a contact", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } };

// ── Anthropic native events ──────────────────────────────────────────────────────────────────
const A = {
  start: { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-5-5-served", usage: { input_tokens: 5, output_tokens: 1 } } },
  tool: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "crm_contact_lookup", input: {} } },
  half: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"Ac" } },
  rest: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "me\"}" } },
  stopBlock: { type: "content_block_stop", index: 0 },
  delta: (reason) => ({ type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: 9 } }),
  stop: { type: "message_stop" },
  error: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
};
// ── OpenAI native events ─────────────────────────────────────────────────────────────────────
const O = {
  created: { type: "response.created", response: { model: "gpt-6.1-sol-2026-09-30", status: "in_progress" } },
  added: { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "crm_contact_lookup", arguments: "" } },
  half: { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "{\"q\":\"Ac" },
  rest: { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "me\"}" },
  argsDone: { type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 0, arguments: "{\"q\":\"Acme\"}" },
  itemDone: { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "crm_contact_lookup", arguments: "{\"q\":\"Acme\"}" } },
  terminal: (type, status, extra = {}) => ({ type, response: { model: "gpt-6.1-sol-2026-09-30", status, usage: { input_tokens: 5, output_tokens: 9 }, ...extra } }),
  refusal: { type: "response.refusal.delta", item_id: "msg_1", output_index: 1, delta: "I can't help with that." },
  failed: { type: "response.failed", response: { model: "gpt-6.1-sol-2026-09-30", status: "failed", error: { message: "server_error" } } },
};

const CASES = [
  { name: "partial tool call, then the transport fails", executes: false,
    anthropic: { events: [A.start, A.tool, A.half], breakAfter: true },
    openai: { events: [O.created, O.added, O.half], breakAfter: true } },
  { name: "complete arguments, then the response fails", executes: false,
    anthropic: { events: [A.start, A.tool, A.half, A.rest, A.stopBlock, A.error] },
    openai: { events: [O.created, O.added, O.half, O.rest, O.argsDone, O.itemDone, O.failed] } },
  { name: "complete arguments, then the response is cancelled / cut", executes: false,
    anthropic: { events: [A.start, A.tool, A.half, A.rest, A.stopBlock] },
    openai: { events: [O.created, O.added, O.half, O.rest, O.argsDone, O.itemDone, O.terminal("response.completed", "cancelled")] } },
  { name: "complete arguments, then the token limit", executes: false,
    anthropic: { events: [A.start, A.tool, A.half, A.rest, A.stopBlock, A.delta("max_tokens"), A.stop] },
    openai: { events: [O.created, O.added, O.half, O.rest, O.argsDone, O.itemDone, O.terminal("response.incomplete", "incomplete", { incomplete_details: { reason: "max_output_tokens" } })] } },
  { name: "a refusal after a partial tool call", executes: false,
    anthropic: { events: [A.start, A.tool, A.half, A.delta("refusal"), A.stop] },
    openai: { events: [O.created, O.added, O.half, O.refusal, O.terminal("response.completed", "completed")] } },
  { name: "complete arguments, then a refusal", executes: false,
    anthropic: { events: [A.start, A.tool, A.half, A.rest, A.stopBlock, A.delta("refusal"), A.stop] },
    openai: { events: [O.created, O.added, O.half, O.rest, O.argsDone, O.itemDone, O.refusal, O.terminal("response.completed", "completed")] } },
  { name: "a stream with no terminal event at all", executes: false,
    anthropic: { events: [A.start, A.tool, A.half, A.rest, A.stopBlock, A.delta("tool_use")] },
    openai: { events: [O.created, O.added, O.half, O.rest, O.argsDone, O.itemDone] } },
  { name: "a normal tool-use stop", executes: true,
    anthropic: { events: [A.start, A.tool, A.half, A.rest, A.stopBlock, A.delta("tool_use"), A.stop] },
    openai: { events: [O.created, O.added, O.half, O.rest, O.argsDone, O.itemDone, O.terminal("response.completed", "completed")] } },
];

/** Read a converter's output the way the chat handler does: every `data:` payload, in order. */
async function payloadsOf(stream) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let transportFailed = false;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); }
  } catch { transportFailed = true; }
  const payloads = buf.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  return { payloads, transportFailed };
}

async function anthropicRound(c) {
  nextAnthropic = c;
  const r = await claude.gatewayCompat("anthropic", { body: JSON.stringify({ model: "google/gemini-2.5-pro", messages: [{ role: "user", content: "look up Acme" }], tools: [TOOL], tool_choice: "auto", stream: true }) });
  if (!r.ok || !r.body) throw new Error(`anthropic stream not opened: ${r.status}`);
  const { payloads, transportFailed } = await payloadsOf(r.body);
  return readModelRound(payloads, transportFailed);
}
async function openaiRound(c) {
  const fetchImpl = async () => new Response(body(c.events, c.breakAfter), { status: 200, headers: { "content-type": "text/event-stream" } });
  const r = await oa.responsesStream({ messages: [{ role: "user", content: "look up Acme" }], tools: [TOOL] }, { model: "gpt-6.1-sol", fetchImpl });
  if (!r.ok || !r.body) throw new Error(`openai stream not opened: ${r.status}`);
  const { payloads, transportFailed } = await payloadsOf(r.body);
  return readModelRound(payloads, transportFailed);
}

for (const c of CASES) {
  for (const [provider, run] of [["anthropic", anthropicRound], ["openai", openaiRound]]) {
    const round = await run(c[provider]);
    const calls = executableToolCalls(round);
    const label = `${provider}: ${c.name} (round ended ${round.end})`;
    if (c.executes) {
      ok(calls.length === 1 && calls[0].name === "crm_contact_lookup" && calls[0].arguments === "{\"q\":\"Acme\"}", `${label} → executes exactly the finished call`);
    } else {
      ok(calls.length === 0, `${label} → executes nothing`);
      ok(round.toolCalls.length >= 1, `${label} → the call WAS visible on the wire (the case is not vacuous)`);
    }
  }
}

console.log(`\nround-gate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
