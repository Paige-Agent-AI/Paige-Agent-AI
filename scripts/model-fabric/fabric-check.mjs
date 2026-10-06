/**
 * The streaming Model Fabric (INT-334 R5), driven through its REAL transports.
 *
 * `fabricChatStream` takes a cognitive class and opens one chat-shaped stream: Anthropic through the
 * real `gatewayCompat` (request shaping, tier resolution), OpenAI through the real `responsesStream`.
 * What this pins:
 *  - OFF BY DEFAULT: while `OPENAI_CHAT_ENABLED` is false, no class ever reaches OpenAI; each class is
 *    served by the Anthropic model the owner's order names (operational/frontier → Sonnet 5.5, cheap →
 *    Haiku), and a `deterministic` class that reaches a model is served as operational.
 *  - THE ORDER: with OpenAI enabled, Sol serves operational, Astra frontier, Luna cheap — Anthropic is
 *    not called — and the effort sent is the class's.
 *  - NARROW FALLBACK: a proven health failure before the stream opened (auth/config, billing, rate
 *    limit, model unavailable, outage, a network throw) moves to the next candidate; an invalid
 *    request or an unknown failure does not, and its status reaches the caller unchanged.
 *  - THE SHAPE: whatever served, the caller reads the same chat-shaped SSE, and the finished-round gate
 *    reads a normal tool-use stop from either provider.
 *  - The request carries exactly what chat sent (tools, tool_choice, Studio's thinking flag to
 *    Anthropic only).
 *
 * No network: fetch is a recording fake per provider. Run: `npm run test:model-fabric`.
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

const enc = new TextEncoder();
const sse = (events) => new ReadableStream({
  start(c) { for (const e of events) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); c.close(); },
});

// ── Anthropic: a normal tool-use round ───────────────────────────────────────────────────────
const ANTHROPIC_TOOL_ROUND = [
  { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-5-5-served", usage: { input_tokens: 5, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "crm_contact_lookup", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"Acme\"}" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
  { type: "message_stop" },
];
// ── OpenAI: the same round, native events ────────────────────────────────────────────────────
const openaiToolRound = (model) => [
  { type: "response.created", response: { model, status: "in_progress" } },
  { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "crm_contact_lookup", arguments: "" } },
  { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "{\"q\":\"Acme\"}" },
  { type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 0, arguments: "{\"q\":\"Acme\"}" },
  { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "crm_contact_lookup", arguments: "{\"q\":\"Acme\"}" } },
  { type: "response.completed", response: { model, status: "completed", usage: { input_tokens: 5, output_tokens: 9 } } },
];

// Recording fakes. `openaiPlan` / `anthropicPlan` say what the next call returns.
let calls = [];
let anthropicPlan = { status: 200 };
let openaiPlan = { status: 200 };
function errorResponse(status, type, message) {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), { status, headers: { "content-type": "application/json" } });
}
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.anthropic.com/")) {
    const req = JSON.parse(init.body);
    calls.push({ provider: "anthropic", req });
    if (anthropicPlan.status !== 200) return errorResponse(anthropicPlan.status, anthropicPlan.type, anthropicPlan.message);
    return new Response(sse(ANTHROPIC_TOOL_ROUND), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  throw new Error(`fabric-check: unexpected network call to ${u}`);
};
const openaiFetch = async (url, init) => {
  const req = JSON.parse(init.body);
  calls.push({ provider: "openai", req });
  if (openaiPlan.throws) throw Object.assign(new Error("connection reset"), { name: "TypeError" });
  if (openaiPlan.status !== 200) {
    return new Response(JSON.stringify({ error: { type: openaiPlan.type, code: openaiPlan.code ?? null, message: "redacted" } }), { status: openaiPlan.status, headers: { "content-type": "application/json" } });
  }
  return new Response(sse(openaiToolRound(`${req.model}-2026-09-30`)), { status: 200, headers: { "content-type": "text/event-stream" } });
};

const fabric = await import("../../supabase/functions/_shared/model-fabric.ts");
const { CLAUDE_REASONING, CLAUDE_CLASSIFICATION } = await import("../../supabase/functions/_shared/claude.ts");
const { readModelRound, executableToolCalls } = await import("../../supabase/functions/_shared/paige-turn/round.ts");

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log(`  FAIL  ${name}`); } };

const TOOL = { type: "function", function: { name: "crm_contact_lookup", description: "Find a contact", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } };
const BODY = { messages: [{ role: "system", content: "persona" }, { role: "user", content: "look up Acme" }], tools: [TOOL], tool_choice: "auto" };

async function payloadsOf(stream) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); }
  return buf.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
}
async function run(cls, opts = {}, body = BODY) {
  calls = [];
  const s = await fabric.fabricChatStream(cls, body, { openaiFetch, ...opts });
  const runnable = s.ok && s.body ? executableToolCalls(readModelRound(await payloadsOf(s.body))) : [];
  return { s, runnable, calls: [...calls] };
}
const served = (r) => r.s.served ? `${r.s.served.provider}:${r.s.served.model}` : "none";

// ── 1. OFF BY DEFAULT ─────────────────────────────────────────────────────────────────────────
ok(fabric.OPENAI_CHAT_ENABLED === false, "OpenAI is off for chat until the Sol canary passes");
anthropicPlan = { status: 200 }; openaiPlan = { status: 200 };
for (const [cls, model] of [["operational", CLAUDE_REASONING], ["frontier", CLAUDE_REASONING], ["deterministic", CLAUDE_REASONING], ["cheap", CLAUDE_CLASSIFICATION]]) {
  const r = await run(cls);
  ok(r.s.ok && r.s.served?.provider === "anthropic", `${cls}: served by Anthropic while OpenAI is off (${served(r)})`);
  ok(r.calls.length === 1 && r.calls[0].provider === "anthropic", `${cls}: OpenAI is never called while off`);
  ok(r.calls[0]?.req.model === model, `${cls}: Anthropic receives ${model} (got ${r.calls[0]?.req.model})`);
  ok(r.s.attempts.some((a) => a.provider === "openai" && a.failure === "skipped_disabled"), `${cls}: the skipped OpenAI candidate is recorded`);
  ok(r.runnable.length === 1 && r.runnable[0].name === "crm_contact_lookup", `${cls}: the chat-shaped round reaches the gate whole`);
}
{
  const r = await run("operational");
  ok(Array.isArray(r.calls[0].req.tools) && r.calls[0].req.tools[0]?.name === "crm_contact_lookup" && r.calls[0].req.stream === true, "operational: tools and streaming reach Anthropic");
  ok(!("thinking" in r.calls[0].req), "no thinking block unless Studio asked");
  const t = await run("operational", { anthropicExtras: { paige_thinking: true } });
  ok(t.calls[0].req.thinking?.type === "enabled", "Studio's thinking flag reaches Anthropic");
  const close = await run("operational", {}, { messages: BODY.messages });
  ok(!("tools" in close.calls[0].req) && !("tool_choice" in close.calls[0].req), "a tools-free closing round sends no tools");
}

// ── 2. THE ORDER (OpenAI enabled) ─────────────────────────────────────────────────────────────
const ON = { enabled: { openai: true } };
for (const [cls, model, effort] of [["operational", "gpt-6.1-sol"], ["frontier", "gpt-6-astra"], ["cheap", "gpt-6-luna"], ["deterministic", "gpt-6.1-sol"]]) {
  const r = await run(cls, ON);
  ok(served(r) === `openai:${model}`, `${cls}: ${model} serves first (${served(r)})`);
  ok(r.calls.length === 1 && r.calls[0].provider === "openai" && r.calls[0].req.model === model, `${cls}: Anthropic is not called when ${model} answers`);
  ok(r.calls[0].req.store === false, `${cls}: store:false`);
  ok(typeof r.calls[0].req.reasoning?.effort === "string", `${cls}: the class's effort is sent (${r.calls[0].req.reasoning?.effort})`);
  ok(r.runnable.length === 1 && r.runnable[0].arguments === "{\"q\":\"Acme\"}", `${cls}: the same chat shape reaches the gate from OpenAI`);
  void effort;
}
{
  const op = await run("operational", ON), fr = await run("frontier", ON), ch = await run("cheap", ON);
  const e = (r) => r.calls[0].req.reasoning?.effort;
  ok(new Set([e(op), e(fr), e(ch)]).size >= 2, `effort differs by class (cheap ${e(ch)}, operational ${e(op)}, frontier ${e(fr)})`);
  const t = await run("operational", { ...ON, anthropicExtras: { paige_thinking: true } });
  ok(!("paige_thinking" in t.calls[0].req) && !("thinking" in t.calls[0].req), "the Anthropic-only thinking flag never reaches OpenAI");
}

// ── 3. NARROW FALLBACK ────────────────────────────────────────────────────────────────────────
const MOVES = [
  ["auth/config (401)", { status: 401, type: "invalid_request_error", code: "invalid_api_key" }],
  ["rate limit (429)", { status: 429, type: "rate_limit_error", code: "rate_limit_exceeded" }],
  ["billing (429 insufficient_quota)", { status: 429, type: "insufficient_quota", code: "insufficient_quota" }],
  ["outage (503)", { status: 503, type: "server_error" }],
  ["network throw", { throws: true }],
];
for (const [name, plan] of MOVES) {
  openaiPlan = plan; anthropicPlan = { status: 200 };
  const r = await run("operational", ON);
  ok(served(r) === `anthropic:${CLAUDE_REASONING}`, `${name}: falls back to Sonnet 5.5 (${served(r)}; ${fabric.describeAttempts(r.s)})`);
  ok(r.calls.map((c) => c.provider).join(",") === "openai,anthropic", `${name}: tried Sol, then Sonnet — once each`);
  ok(r.s.attempts[0].failure && r.s.attempts[0].failure !== "unknown", `${name}: the failure is named (${r.s.attempts[0].failure})`);
  ok(r.runnable.length === 1, `${name}: the fallback round reaches the gate whole`);
}
const STAYS = [
  ["invalid request (400)", { status: 400, type: "invalid_request_error", code: "invalid_value" }, 400],
  ["unknown (418)", { status: 418, type: "weird" }, 418],
];
for (const [name, plan, status] of STAYS) {
  openaiPlan = plan; anthropicPlan = { status: 200 };
  const r = await run("operational", ON);
  ok(!r.s.ok && r.s.served === null && r.s.status === status, `${name}: no fallback; the status reaches the caller (${r.s.status})`);
  ok(r.calls.length === 1 && r.calls[0].provider === "openai", `${name}: Anthropic is never called`);
}
{
  // Every candidate down: the last failure is returned, nothing served, nothing runs.
  openaiPlan = { status: 503, type: "server_error" }; anthropicPlan = { status: 529, type: "overloaded_error", message: "Overloaded" };
  const r = await run("operational", ON);
  ok(!r.s.ok && r.s.served === null && r.calls.length === 2, `every candidate down: nothing served (${fabric.describeAttempts(r.s)})`);
  // Anthropic alone (OpenAI off): its own failure status reaches chat's existing error handling unchanged.
  anthropicPlan = { status: 429, type: "rate_limit_error", message: "slow down" };
  const a = await run("operational");
  ok(!a.s.ok && a.s.status === 429 && a.calls.length === 1, `OpenAI off, Anthropic 429: chat sees 429 as before (${a.s.status})`);
  anthropicPlan = { status: 400, type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." };
  const b = await run("operational");
  ok(!b.s.ok && b.s.status === 400 && b.s.attempts.at(-1).failure === "billing", `Anthropic credit-balance 400 is named billing, status unchanged (${b.s.attempts.at(-1).failure})`);
}
openaiPlan = { status: 200 }; anthropicPlan = { status: 200 };

// ── 4. The cheap class never receives tools from chat (route contract), but the fabric does not add any.
{
  const r = await run("cheap", {}, { messages: BODY.messages });
  ok(!("tools" in r.calls[0].req), "the fabric adds no tools to a tools-free body");
}

console.log(`fabric-check: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
