/**
 * The streaming Model Fabric (INT-334 R5), driven through its REAL transports.
 *
 * `fabricChatStream` takes a cognitive class and opens one chat-shaped stream: Anthropic through the
 * real `gatewayCompat` (request shaping, tier resolution), OpenAI through the real `responsesStream`.
 * What this pins:
 *  - ADMISSION-GATED: OpenAI serves only cohort-admitted tenants in the class scope; each class is
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
import { setScenario, recorder } from "../client-memory-authz/fake-supabase.mjs";

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
    if (req.stream !== true) {
      const model = req.model && String(req.model).includes("haiku") ? "claude-haiku-4-5-served" : "claude-sonnet-5-5-served";
      const isClassifier = typeof req.system === "string" && req.system.includes("You label one message sent to PAIGE");
      const text = isClassifier
        ? JSON.stringify({ intent: "converse", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 })
        : "synthesis";
      return new Response(JSON.stringify({ id: "msg_ns", model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 9, output_tokens: 7 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
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
  if (req.stream !== true) {
    return new Response(JSON.stringify({ id: "resp_ns", model: req.model, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "synthesis" }] }], usage: { input_tokens: 9, output_tokens: 7 } }), { status: 200, headers: { "content-type": "application/json" } });
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

// ── 1. OWNER-DIRECTED FLAG, ATTRIBUTION-REQUIRED ADMISSION ────────────────────────────────────
// The master flag is ON per the 2026-10-08 owner directive (OpenAI is the preferred primary).
// Admission still requires a well-formed tenant in the cohort AND the class scope — these drives
// carry NO tenant (unattributed), so every class serves from Anthropic exactly as before.
ok(fabric.OPENAI_CHAT_ENABLED === true, "the owner-directed master flag is ON (2026-10-08 directive)");
anthropicPlan = { status: 200 }; openaiPlan = { status: 200 };
for (const [cls, model] of [["operational", CLAUDE_REASONING], ["frontier", CLAUDE_REASONING], ["deterministic", CLAUDE_REASONING], ["cheap", CLAUDE_CLASSIFICATION]]) {
  const r = await run(cls);
  ok(r.s.ok && r.s.served?.provider === "anthropic", `${cls}: unattributed traffic serves from Anthropic (never admitted) (${served(r)})`);
  ok(r.calls.length === 1 && r.calls[0].provider === "anthropic", `${cls}: OpenAI is never called for unattributed traffic`);
  ok(r.calls[0]?.req.model === model, `${cls}: Anthropic receives ${model} (got ${r.calls[0]?.req.model})`);
  ok(r.s.attempts.some((a) => a.provider === "openai" && a.failure === "skipped_disabled"), `${cls}: the not-admitted OpenAI candidate is recorded`);
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

// ── 3b. WHAT A THROW PROVES (R5a review S1/S4) ───────────────────────────────────────────────
{
  // A budget stop is a decision: rethrown, never retried on another provider, never an {ok:false}.
  const budget = Object.assign(new Error("daily ceiling reached"), { code: "budget_exceeded" });
  const stop = async () => { throw budget; };
  let thrown = null; calls = [];
  try { await fabric.fabricChatStream("operational", BODY, { openaiFetch, anthropicGateway: stop }); } catch (e) { thrown = e; }
  ok(thrown === budget, "a budget stop on the only candidate is rethrown, never returned as a failure");
  openaiPlan = { status: 503, type: "server_error" }; thrown = null; calls = [];
  try { await fabric.fabricChatStream("operational", BODY, { ...ON, openaiFetch, anthropicGateway: stop }); } catch (e) { thrown = e; }
  ok(thrown === budget, "after a health fallback, a budget stop on the next candidate is still rethrown");
  openaiPlan = { status: 200 };

  // A missing key is configuration, proven by its own error type.
  delete ENV.OPENAI_API_KEY;
  const noKey = await run("operational", ON);
  ok(noKey.s.attempts[0]?.failure === "auth_config" && served(noKey) === `anthropic:${CLAUDE_REASONING}`,
    `a missing OpenAI key is auth_config and falls back (${fabric.describeAttempts(noKey.s)})`);
  ENV.OPENAI_API_KEY = "sk-test-not-a-real-key";
  delete ENV.ANTHROPIC_API_KEY;
  const noAnthropic = await run("operational");
  ok(!noAnthropic.s.ok && noAnthropic.s.attempts.at(-1)?.failure === "auth_config",
    `a missing Anthropic key is auth_config, not an outage (${fabric.describeAttempts(noAnthropic.s)})`);
  ENV.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";

  // A throw that proves no provider-health failure (the adapter refused the request shape before any
  // fetch) is `unknown`: no fallback, and the provider is never contacted.
  const hosted = await run("operational", ON, { ...BODY, tools: [{ type: "web_search" }] });
  ok(!hosted.s.ok && hosted.s.attempts.at(-1)?.failure === "unknown" && hosted.calls.length === 0,
    `a pre-fetch refusal is unknown, never an outage, and nothing is called (${fabric.describeAttempts(hosted.s)})`);
}

// ── 4. The cheap class never receives tools from chat (route contract), but the fabric does not add any.
{
  const r = await run("cheap", {}, { messages: BODY.messages });
  ok(!("tools" in r.calls[0].req), "the fabric adds no tools to a tools-free body");
}


// ── C. THE CLASS-BEARING CONSUMER SEAM (fabricCompletion) — R6A-RETURN D, non-streaming ───────
// A consumer names a cognitive class and its OWN job identity; the fabric alone picks the provider
// and model; the served route rides the response; the judge carve-out pins. Existing routed callers
// are untouched (nothing in production calls this yet — Deep Research adopts it in its own lane).
{
  anthropicPlan = { status: 200 };
  openaiPlan = { status: 200 };
  const seamRun = async (request, opts = {}) => {
    calls.length = 0;
    const r = await fabric.fabricCompletion(request, { openaiFetch, ...opts });
    return { r, calls };
  };
  const REQ = (cls, job) => ({ cognitive_class: cls, job, messages: [{ role: "system", content: "consumer" }, { role: "user", content: "synthesize the evidence" }] });

  // C1 — with OpenAI off, every class is served by Anthropic's own tier for it, exactly like the
  // routed path's tiers, and the response is chat-shaped with the route attached.
  const cheap = await seamRun(REQ("cheap", "research_hop_planner"));
  ok(cheap.r.ok && cheap.r.route.served?.provider === "anthropic" && String(cheap.r.route.served?.model).includes("haiku")
    && cheap.r.route.reason === "served_primary" && cheap.r.route.fallback === false,
    `C1 cheap class serves Anthropic's cheap tier (${cheap.r.route.served?.model})`);
  ok(cheap.r.response?.choices?.[0]?.message?.content === "synthesis" && typeof cheap.r.response?.usage?.prompt_tokens === "number",
    "C1 the result is chat-shaped with usage");
  const op = await seamRun(REQ("operational", "research_unit_synthesis"));
  ok(op.r.ok && op.r.route.served?.provider === "anthropic" && String(op.r.route.served?.model).includes("sonnet")
    && op.r.route.job === "research_unit_synthesis" && op.r.route.requested_class === "operational",
    `C1 operational class serves the reasoning tier (${op.r.route.served?.model}) — the consumer named no provider`);
  const fr = await seamRun(REQ("frontier", "research_difficult_reconciliation"));
  ok(fr.r.ok && String(fr.r.route.served?.model).includes("sonnet"), "C1 frontier class serves the reasoning tier while OpenAI is off");

  // C2 — with OpenAI enabled (test seam), the class's first candidate serves with its effort.
  const sol = await seamRun(REQ("operational", "research_unit_synthesis"), ON);
  ok(sol.r.ok && sol.r.route.served?.provider === "openai" && sol.r.route.served?.model === "gpt-6.1-sol"
    && sol.calls.length === 1 && sol.calls[0].req.model === "gpt-6.1-sol" && sol.calls[0].req.store === false
    && sol.calls[0].req.reasoning?.effort === "medium",
    "C2 operational serves Sol with the class effort, store:false, and no Anthropic call");
  const luna = await seamRun(REQ("cheap", "research_hop_planner"), ON);
  ok(luna.r.route.served?.model === "gpt-6-luna" && luna.calls[0].req.reasoning?.effort === "none", "C2 cheap serves Luna");

  // C3 — narrow fallback: a proven health failure moves once; invalid_request never moves.
  openaiPlan = { status: 401, type: "authentication_error" };
  const fb = await seamRun(REQ("operational", "research_unit_synthesis"), ON);
  ok(fb.r.ok && fb.r.route.served?.provider === "anthropic" && fb.r.route.reason === "served_fallback" && fb.r.route.fallback === true
    && fb.r.route.attempts[0]?.failure === "auth_config",
    "C3 a 401 falls back to Sonnet and the route records why");
  openaiPlan = { status: 400, type: "invalid_request_error" };
  const bad = await seamRun(REQ("operational", "research_unit_synthesis"), ON);
  ok(!bad.r.ok && bad.r.error?.failure === "invalid_request" && bad.calls.length === 1,
    "C3 an invalid request never moves — the other provider would get the same broken request");
  openaiPlan = { status: 200 };

  // C4 — the budget gate runs on the seam's own candidates, and a stop is terminal (never falls over).
  setScenario({ tables: {
    admin_app_settings: [{ key: "llm_budget_daily_usd__t_tenant-seam", value: 1 }],
    paige_llm_trace: [{ tenant_id: "tenant-seam", cost_estimate_usd: 99, created_at: new Date().toISOString() }],
  } });
  const traceSeam = { tenant_id: "tenant-seam", agent_id: "fabric-check-seam" };
  let threw = null;
  calls.length = 0;
  try { await fabric.fabricCompletion(REQ("operational", "research_unit_synthesis"), { openaiFetch, trace: traceSeam }); } catch (e) { threw = e; }
  ok(threw?.code === "budget_exceeded" && calls.length === 0,
    "C4 a budget stop throws before any provider call and never tries another");
  setScenario({});

  // C5 — the judge carve-out: a pinned route ignores the class policy and never falls back.
  const pinOk = await seamRun(REQ("cheap", "rubric_judge_v3"), { ...ON, pinned: { tier: "reasoning" } });
  ok(pinOk.r.ok && pinOk.r.route.served?.provider === "anthropic" && String(pinOk.r.route.served?.model).includes("sonnet")
    && pinOk.r.route.reason === "pinned_served" && pinOk.calls.length === 1 && pinOk.calls[0].provider === "anthropic",
    "C5 a pinned route serves Anthropic whatever the class or the enabled set says");
  anthropicPlan = { status: 503, type: "overloaded_error" };
  const pinFail = await seamRun(REQ("operational", "rubric_judge_v3"), { ...ON, pinned: { tier: "reasoning" } });
  ok(!pinFail.r.ok && pinFail.r.route.reason === "pinned_failed" && pinFail.r.error?.failure === "provider_outage"
    && pinFail.calls.length === 1,
    "C5 a pinned route fails without moving — the instrument stays comparable");
  anthropicPlan = { status: 200 };

  // C6 — the request contract: no provider or model field exists to set, and the job identity is validated.
  let badJob = null;
  try { await fabric.fabricCompletion({ ...REQ("operational", "Not A Job") }, { openaiFetch }); } catch (e) { badJob = e; }
  ok(badJob instanceof Error && /job/.test(badJob.message), "C6 a malformed job identity is refused");
  ok(!("provider" in REQ("operational", "x")) && !("model" in REQ("operational", "x")),
    "C6 the request carries no provider or model field to hardcode");

  // C8 — the OPENAI leg's trace row carries the consumer's job identity too (never the adapter's "chat").
  {
    const rec8 = recorder();
    const before8 = rec8.inserts.filter((i) => i.table === "paige_llm_trace").length;
    await seamRun(REQ("operational", "research_unit_synthesis"), { ...ON, trace: { tenant_id: "tenant-seam8", agent_id: "fabric-check-seam" } });
    const rows8 = rec8.inserts.filter((i) => i.table === "paige_llm_trace").slice(before8);
    ok(rows8.length === 1 && rows8[0].row?.job_kind === "research_unit_synthesis" && rows8[0].row?.provider === "openai",
      `C8 the OpenAI-served leg traces the consumer's job identity (${rows8[0]?.row?.job_kind})`);
  }

  // C9 — a FAILED Anthropic leg leaves the same evidence a successful one does.
  {
    const rec9 = recorder();
    const before9 = rec9.inserts.filter((i) => i.table === "paige_llm_trace").length;
    anthropicPlan = { status: 503, type: "overloaded_error" };
    await seamRun(REQ("operational", "research_unit_synthesis"), { trace: { tenant_id: "tenant-seam9", agent_id: "fabric-check-seam" } });
    anthropicPlan = { status: 200 };
    const rows9 = rec9.inserts.filter((i) => i.table === "paige_llm_trace").slice(before9);
    ok(rows9.length === 1 && rows9[0].row?.status === "error" && rows9[0].row?.job_kind === "research_unit_synthesis"
      && rows9[0].row?.error_class === "provider_outage" && rows9[0].row?.error_message === "Error",
      `C9 a failed Anthropic leg writes one attributed error trace row, name-only message (${rows9[0]?.row?.error_class}/${rows9[0]?.row?.error_message})`);
  }

  // C10 — transport failures are the streaming fabric's provider_outage: fallback-eligible.
  {
    const realFetch = globalThis.fetch;
    anthropicPlan = { status: 200 };
    let anthropicThrew = false;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("https://api.anthropic.com/")) { anthropicThrew = true; throw Object.assign(new Error("connection reset"), { name: "TypeError" }); }
      return realFetch(url, init);
    };
    calls.length = 0;
    const t = await fabric.fabricCompletion(REQ("operational", "research_unit_synthesis"), { openaiFetch });
    globalThis.fetch = realFetch;
    ok(t.route.attempts.some((a) => a.failure === "provider_outage") && anthropicThrew,
      `C10 a transport throw on the Anthropic leg classifies provider_outage (${t.route.attempts.map((a) => a.failure).join(",")})`);
  }

  // C7 — telemetry: the anthropic leg writes exactly one trace row carrying the consumer's job kind.
  const rec0 = recorder();
  const before = rec0.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await seamRun(REQ("operational", "research_unit_synthesis"), { trace: { tenant_id: "tenant-seam2", agent_id: "fabric-check-seam" } });
  const rows = rec0.inserts.filter((i) => i.table === "paige_llm_trace").slice(before);
  ok(rows.length === 1 && rows[0].row?.job_kind === "research_unit_synthesis" && rows[0].row?.provider === "anthropic",
    `C7 one attributed trace row carries the consumer's job identity (${rows.length} rows)`);
}


// ── D. THE CLASSIFIER THROUGH THE FABRIC (#1844) — the first production consumer of the seam ────
// classifyTurn now opens through fabricCompletion({cheap, turn_classify}): same wire, same 1.2 s
// deadline, same conservative null, and — new, on the owner's order — the tenant budget gate covers
// it (R4's S3 gap), with the router's established ungated-on-unreadable-accrual policy preserved.
{
  const { classifyTurn, TURN_CLASSIFY_DEADLINE_MS } = await import("../../supabase/functions/_shared/paige-turn/classify-call.ts");
  const CLASSIFY_TRACE = { tenant_id: "5a4a3a2a-0000-4000-8000-00000000c1a1", agent_id: "paige-ai-chat", job_kind: "turn-classify" };

  // D1 — routing parity: the cheap class serves Anthropic's cheap tier, the classifier's own shape
  // rides the wire, the route records the fabric job, and the TRACE keeps the caller's tag.
  setScenario({});
  calls.length = 0;
  const recD = recorder();
  const beforeD = recD.inserts.filter((i) => i.table === "paige_llm_trace").length;
  const cls = await classifyTurn("thanks so much", null, CLASSIFY_TRACE);
  const d1row = recD.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeD).at(-1)?.row;
  ok(cls !== null && typeof cls.confidence === "number",
    `D1 the classifier answers through the fabric (intent ${cls?.intent})`);
  ok(calls.length === 1 && calls[0].provider === "anthropic" && String(calls[0].req.model).includes("haiku"),
    `D1 the cheap class serves the cheap tier — provider parity (${calls[0]?.req?.model})`);
  ok(calls[0].req.system?.includes("You label one message sent to PAIGE") && calls[0].req.max_tokens === 120 && calls[0].req.temperature === 0,
    "D1 the classifier's own shape rides the wire (system, 120 tokens, temperature 0)");
  ok(d1row?.job_kind === "turn-classify" && d1row?.provider === "anthropic",
    `D1 the trace keeps the caller's job_kind tag (${d1row?.job_kind}) — no trace-history break`);

  // D2 — the known ceiling, under the ESTABLISHED contract: the classifier is a CHEAP-band call,
  // and the budget contract deliberately allows gated continuation for the cheap band at the hard
  // ceiling (the R5a review's S3 disposition, unchanged by order of the owner). The pin: the call
  // proceeds, the gate hit is RECORDED on the attributed row, and nothing throws into the turn.
  // (A hard stop at the ceiling for the classifier would be a material budget-failure change —
  // owner determination, not this slice. The reasoning-band stop itself is pinned at C4.)
  setScenario({ tables: {
    admin_app_settings: [{ key: "llm_budget_daily_usd__t_5a4a3a2a-0000-4000-8000-00000000c1a2", value: 1 }],
    paige_llm_trace: [{ tenant_id: "5a4a3a2a-0000-4000-8000-00000000c1a2", cost_estimate_usd: 99, created_at: new Date().toISOString() }],
  } });
  calls.length = 0;
  const recD2 = recorder();
  const beforeD2 = recD2.inserts.filter((i) => i.table === "paige_llm_trace").length;
  const overCeiling = await classifyTurn("thanks so much", null, { tenant_id: "5a4a3a2a-0000-4000-8000-00000000c1a2", agent_id: "paige-ai-chat", job_kind: "turn-classify" });
  const gateRows = recD2.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeD2);
  ok(overCeiling !== null && calls.length === 1,
    `D2 over a known ceiling the cheap-band classifier continues UNDER the established contract (answered=${overCeiling !== null})`);
  ok(gateRows.length === 1 && gateRows[0].row?.doctrine_gate_hits?.budget != null && gateRows[0].row?.job_kind === "turn-classify",
    `D2 the gate hit is recorded on the attributed row (rows=${gateRows.length}, hit=${JSON.stringify(gateRows[0]?.row?.doctrine_gate_hits)})`);

  // D3 — the established ungated-on-unreadable-accrual policy is PRESERVED: a table the budget read
  // cannot complete proceeds ungated but loud (the classifier still serves).
  setScenario({ tables: {
    admin_app_settings: [{ key: "llm_budget_daily_usd__t_5a4a3a2a-0000-4000-8000-00000000c1a3", value: { ceiling_usd: 1 } }],
  }, tableErrors: { paige_llm_trace: { message: "read failed", code: "XX001" } } });
  calls.length = 0;
  const ungated = await classifyTurn("thanks so much", null, CLASSIFY_TRACE);
  ok(ungated !== null && calls.length === 1,
    "D3 accrual that cannot be read proceeds ungated — the router's established policy, unchanged");

  // D4 — the 1.2 s deadline: a transport slower than the bound is abandoned and the conservative
  // null returns (the fetch is aborted through the seam's signal).
  setScenario({});
  const realFetchD = globalThis.fetch;
  let observedSignal = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.anthropic.com/")) {
      observedSignal = init?.signal ?? null;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, TURN_CLASSIFY_DEADLINE_MS + 1500);
        observedSignal?.addEventListener("abort", () => { clearTimeout(t); const e = new Error("aborted"); e.name = "AbortError"; reject(e); }, { once: true });
      });
      return new Response(JSON.stringify({ id: "m", model: "claude-haiku-4-5", content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetchD(url, init);
  };
  const t0 = Date.now();
  const slow = await classifyTurn("thanks so much", null, CLASSIFY_TRACE);
  const elapsed = Date.now() - t0;
  globalThis.fetch = realFetchD;
  ok(slow === null && elapsed < TURN_CLASSIFY_DEADLINE_MS + 400,
    `D4 a slow provider is abandoned at the deadline (${elapsed}ms, conservative null)`);
  ok(observedSignal instanceof AbortSignal,
    "D4 the deadline threads to the provider fetch as a real abort signal");

  // D5 — the seam's caller-tag rule (generic): a caller's trace.job_kind beats the request job.
  const tagRun = await fabric.fabricCompletion(
    { cognitive_class: "cheap", job: "turn_classify", messages: [{ role: "user", content: "x" }] },
    { openaiFetch, trace: { tenant_id: "5a4a3a2a-0000-4000-8000-00000000c1a5", agent_id: "a", job_kind: "my_own_tag" } },
  );
  void tagRun;
  const tagRows = recorder().inserts.filter((i) => i.table === "paige_llm_trace" && i.row?.tenant_id === "5a4a3a2a-0000-4000-8000-00000000c1a5");
  ok(tagRows.length === 1 && tagRows[0].row?.job_kind === "my_own_tag",
    `D5 a caller's own trace job_kind wins over the request's (rows=${tagRows.length}, kind=${tagRows[0]?.row?.job_kind}, ok=${tagRun.ok}, err=${tagRun.error?.failure})`);

  setScenario({});
}


// ── E. #1850: streaming budget, document turns, whole-operation cancellation ────────────────────
{
  const STREAM_BODY = { messages: [{ role: "user", content: "stream this" }], tools: [TOOL], tool_choice: "auto" };
  const streamRun = async (cls, opts = {}, body = STREAM_BODY) => {
    calls.length = 0;
    anthropicPlan = { status: 200 };
    openaiPlan = { status: 200 };
    const stream = await fabric.fabricChatStream(cls, body, { openaiFetch, ...opts });
    const reader = stream.body?.getReader();
    while (reader && !(await reader.read()).done) { /* drain */ }
    return { stream, calls };
  };

  // E1 — the streaming OpenAI leg sits under the canonical budget gate: a reasoning-band block
  // throws BEFORE any transport moves, is traced, and NEVER falls back to Anthropic.
  setScenario({ tables: {
    admin_app_settings: [{ key: "llm_budget_daily_usd__t_6e5a0000-0000-4000-8000-0000000000e1", value: 1 }],
    paige_llm_trace: [{ tenant_id: "6e5a0000-0000-4000-8000-0000000000e1", cost_estimate_usd: 99, created_at: new Date().toISOString() }],
  } });
  const recE1 = recorder();
  const beforeE1 = recE1.inserts.filter((i) => i.table === "paige_llm_trace").length;
  let threwE1 = null;
  calls.length = 0;
  try { await streamRun("operational", { ...ON, trace: { tenant_id: "6e5a0000-0000-4000-8000-0000000000e1", agent_id: "fabric-check" } }); } catch (e) { threwE1 = e; }
  const e1rows = recE1.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeE1);
  ok(threwE1?.code === "budget_exceeded" && calls.length === 0,
    `E1 a streaming block throws before any transport and never falls back (threw=${threwE1?.code}, calls=${calls.length})`);
  ok(e1rows.length === 1 && e1rows[0].row?.provider === "router_budget" && e1rows[0].row?.error_class === "budget_exceeded",
    "E1 the streaming block is auditable (one attributed router_budget row)");

  // E2 — a soft-gate zone streams AND the hit rides the drained stream's own trace row.
  setScenario({ tables: {
    admin_app_settings: [{ key: "llm_budget_daily_usd__t_6e5a0000-0000-4000-8000-0000000000e2", value: 10 }],
    paige_llm_trace: [{ tenant_id: "6e5a0000-0000-4000-8000-0000000000e2", cost_estimate_usd: 9, created_at: new Date().toISOString() }],
  } });
  const recE2 = recorder();
  const beforeE2 = recE2.inserts.filter((i) => i.table === "paige_llm_trace").length;
  const soft = await streamRun("operational", { ...ON, trace: { tenant_id: "6e5a0000-0000-4000-8000-0000000000e2", agent_id: "fabric-check", job_kind: "chat" } });
  const softRows = recE2.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeE2);
  ok(soft.stream.ok && soft.calls[0]?.provider === "openai",
    "E2 a soft-gate zone streams on the class's candidate");
  ok(softRows.some((r) => r.row?.provider === "openai" && r.row?.doctrine_gate_hits?.budget?.level === "soft"),
    `E2 the gate hit rides the drained stream's own trace row (${softRows.map((r) => `${r.row?.provider}:${JSON.stringify(r.row?.doctrine_gate_hits)}`).join(",")})`);

  // E3 — unknown accrual: the established ungated-but-loud policy, on the streaming leg too.
  setScenario({ tables: {}, tableErrors: { paige_llm_trace: { message: "read failed", code: "XX001" } } });
  const unknown = await streamRun("operational", { ...ON, trace: { tenant_id: "6e5a0000-0000-4000-8000-0000000000e3", agent_id: "fabric-check" } });
  ok(unknown.stream.ok && unknown.calls[0]?.provider === "openai",
    "E3 unreadable accrual proceeds ungated on the streaming leg (policy unchanged)");

  // E4 — document turns never reach the OpenAI adapter: the document-capable provider serves.
  setScenario({});
  const DOC_BODY = { messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0" } }, { type: "text", text: "read this" }] }], tools: [TOOL], tool_choice: "auto" };
  const docStream = await streamRun("operational", { ...ON }, DOC_BODY);
  ok(docStream.stream.ok && docStream.calls.length === 1 && docStream.calls[0].provider === "anthropic"
    && docStream.stream.attempts.some((a) => a.failure === "unsupported_document"),
    `E4 a document turn streams from the document-capable provider; the OpenAI candidate is skipped, never asked (${fabric.describeAttempts(docStream.stream)})`);
  const docCompletion = await fabric.fabricCompletion({ cognitive_class: "operational", job: "research_dossier_synthesis", ...DOC_BODY }, { ...ON, openaiFetch });
  ok(docCompletion.ok && docCompletion.route.served?.provider === "anthropic"
    && docCompletion.route.attempts.some((a) => a.failure === "unsupported_document"),
    "E4 the completion seam skips the OpenAI candidate for a document turn too");

  // E5 — the classifier's whole operation is bounded: a budget read that outlives the deadline
  // dispatches NOTHING after the classifier has timed out.
  const { classifyTurn, TURN_CLASSIFY_DEADLINE_MS } = await import("../../supabase/functions/_shared/paige-turn/classify-call.ts");
  setScenario({ tables: {
    paige_llm_trace: async () => { await new Promise((r) => setTimeout(r, TURN_CLASSIFY_DEADLINE_MS + 2000)); return []; },
  } });
  calls.length = 0;
  const tE5 = Date.now();
  const timedOut = await classifyTurn("thanks so much", null, { tenant_id: "6e5a0000-0000-4000-8000-0000000000e5", agent_id: "fabric-check", job_kind: "turn-classify" });
  const e5elapsed = Date.now() - tE5;
  ok(timedOut === null && e5elapsed < TURN_CLASSIFY_DEADLINE_MS + 400,
    `E5 the classifier returns its conservative null inside the deadline while the gate read still hangs (${e5elapsed}ms)`);
  await new Promise((r) => setTimeout(r, TURN_CLASSIFY_DEADLINE_MS + 1200));
  ok(calls.length === 0,
    `E5 after the delayed read resolves, NO provider was dispatched (calls=${calls.length}) — the timeout cancelled the operation, not just the waiting`);

  // E6 — real cancellation of the dormant OpenAI transport: the fetch receives the signal, aborts,
  // and an aborted leg never falls back.
  setScenario({});
  const realFetchE = globalThis.fetch;
  let openaiSignalSeen = null;
  const slowOpenai = async (url, init) => {
    if (!String(url).includes("openai")) return realFetchE(url, init);
    openaiSignalSeen = init?.signal ?? null;
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 5000);
      openaiSignalSeen?.addEventListener("abort", () => { clearTimeout(t); const e = new Error("aborted"); e.name = "AbortError"; reject(e); }, { once: true });
    });
    throw new Error("unreachable");
  };
  calls.length = 0;
  const sigE6 = AbortSignal.timeout(150);
  const abortedRun = await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "turn_classify", messages: STREAM_BODY.messages },
    { enabled: { openai: true }, openaiFetch: slowOpenai, signal: sigE6 },
  );
  ok(openaiSignalSeen instanceof AbortSignal && abortedRun.error?.failure === "aborted"
    && !abortedRun.route.served && calls.filter((c) => c.provider === "anthropic").length === 0,
    `E6 the OpenAI fetch receives the deadline signal, aborts for real, and never falls back (${abortedRun.error?.failure})`);

  setScenario({});
  globalThis.fetch = realFetchE;
}


// ── F. #1856: SERVED-ROUTE TELEMETRY on the existing trace ledger ───────────────────────────────
// Every fabric-served call's row carries, as allowlisted metadata SCALARS: what class was asked
// for, the job identity, who served, whether a fallback occurred, and the closed reason. No new
// ledger, no new table, no object metadata (the allowlist's scalars-only rule stands).
{
  const routeOf = (row) => row?.metadata ?? {};
  const CLOSED_REASON = /^(served_primary|served_fallback|pinned_served|pinned_failed|failed)$/;
  const CLOSED_CLASS = /^(cheap|operational|frontier|deterministic)$/;

  // F1 — the completion seam's served rows carry the full route, both providers.
  // (The F-series pins the ANTHROPIC leg's row shapes under the kill switch — the OpenAI leg's
  // shapes are pinned by the C-series with the enabled seam. Under the cutover default these
  // operational calls would serve Sol; the empty cohort forces the incumbent for these pins.)
  ENV.OPENAI_CANARY_TENANTS = "";
  setScenario({});
  anthropicPlan = { status: 200 };
  openaiPlan = { status: 200 };
  const recF = recorder();
  const beforeF = recF.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "research_unit_synthesis", messages: [{ role: "user", content: "x" }] },
    { openaiFetch, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f1", agent_id: "fabric-check" } },
  );
  const f1 = recF.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF).at(-1)?.row;
  const f1r = routeOf(f1);
  ok(f1r.route_requested_class === "operational" && f1r.route_job === "research_unit_synthesis"
    && f1r.route_served_provider === "anthropic" && typeof f1r.route_served_model === "string" && f1r.route_served_model.includes("sonnet")
    && f1r.route_fallback === false && f1r.route_reason === "served_primary",
    `F1 the served Anthropic row carries the route (${JSON.stringify(f1r)})`);

  const recF1b = recorder();
  const beforeF1b = recF1b.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "research_unit_synthesis", messages: [{ role: "user", content: "x" }] },
    { ...ON, openaiFetch, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f1b", agent_id: "fabric-check" } },
  );
  const f1b = recF1b.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF1b).at(-1)?.row;
  const f1br = routeOf(f1b);
  ok(f1b?.provider === "openai" && f1br.route_served_provider === "openai" && f1br.route_served_model === "gpt-6.1-sol"
    && f1br.route_requested_class === "operational" && f1br.route_reason === "served_primary",
    `F1 the served OpenAI row carries the route too (${JSON.stringify(f1br)})`);

  // F2 — a fallback records fallback=true and served_fallback on the row that served.
  openaiPlan = { status: 401, type: "authentication_error" };
  const recF2 = recorder();
  const beforeF2 = recF2.inserts.filter((i) => i.table === "paige_llm_trace").length;
  const fbRun = await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "research_unit_synthesis", messages: [{ role: "user", content: "x" }] },
    { ...ON, openaiFetch, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f2", agent_id: "fabric-check" } },
  );
  const f2rows = recF2.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF2);
  const f2served = f2rows.filter((r) => r.row?.status === "success").at(-1)?.row;
  ok(fbRun.route.fallback === true && f2served && routeOf(f2served).route_reason === "served_fallback"
    && routeOf(f2served).route_fallback === true && routeOf(f2served).route_served_provider === "anthropic",
    `F2 a fallback's served row records served_fallback + fallback=true (${JSON.stringify(routeOf(f2served))})`);
  openaiPlan = { status: 200 };

  // F3 — the judge pin records pinned_served.
  const recF3 = recorder();
  const beforeF3 = recF3.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await fabric.fabricCompletion(
    { cognitive_class: "cheap", job: "rubric_judge_v3", messages: [{ role: "user", content: "x" }] },
    { ...ON, openaiFetch, pinned: { tier: "reasoning" }, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f3", agent_id: "fabric-check" } },
  );
  const f3 = recF3.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF3).at(-1)?.row;
  ok(routeOf(f3).route_reason === "pinned_served" && routeOf(f3).route_served_provider === "anthropic",
    `F3 a pinned route records pinned_served (${JSON.stringify(routeOf(f3))})`);

  // F3b — a pinned leg's failure records pinned_failed on its error row (the frozen-instrument
  // forensic row says PINNED, distinguishing it from an unpinned failure).
  anthropicPlan = { status: 503, type: "overloaded_error" };
  const recF3b = recorder();
  const beforeF3b = recF3b.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await fabric.fabricCompletion(
    { cognitive_class: "cheap", job: "rubric_judge_v3", messages: [{ role: "user", content: "x" }] },
    { openaiFetch, pinned: { tier: "reasoning" }, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f3b", agent_id: "fabric-check" } },
  );
  anthropicPlan = { status: 200 };
  const f3b = recF3b.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF3b).at(-1)?.row;
  ok(f3b?.status === "error" && routeOf(f3b).route_reason === "pinned_failed" && routeOf(f3b).route_served_provider === undefined,
    `F3b a pinned leg's error row records pinned_failed with no served keys (${JSON.stringify(routeOf(f3b))})`);

  // F4 — a failed seam call: the error row carries reason=failed and NO served keys.
  anthropicPlan = { status: 503, type: "overloaded_error" };
  const recF4 = recorder();
  const beforeF4 = recF4.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "research_unit_synthesis", messages: [{ role: "user", content: "x" }] },
    { openaiFetch, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f4", agent_id: "fabric-check" } },
  );
  anthropicPlan = { status: 200 };
  const f4 = recF4.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF4).at(-1)?.row;
  const f4r = routeOf(f4);
  ok(f4?.status === "error" && f4r.route_reason === "failed" && f4r.route_served_provider === undefined
    && f4r.route_served_model === undefined && f4r.route_requested_class === "operational",
    `F4 a failed call's error row records failed with no served keys (${JSON.stringify(f4r)})`);

  // F5 — the STREAMED rows carry the route on both legs (drain rows, via the ctx spread).
  const STREAM_F5 = { messages: [{ role: "user", content: "stream this" }], tools: [TOOL], tool_choice: "auto" };
  const drain = async (cls, opts, body = STREAM_F5) => {
    const rec = recorder();
    const before = rec.inserts.filter((i) => i.table === "paige_llm_trace").length;
    const stream = await fabric.fabricChatStream(cls, body, { openaiFetch, ...opts });
    const reader = stream.body?.getReader();
    while (reader && !(await reader.read()).done) { /* drain */ }
    return rec.inserts.filter((i) => i.table === "paige_llm_trace").slice(before).at(-1)?.row;
  };
  const anthRow = await drain("operational", { trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f5a", agent_id: "fabric-check", job_kind: "chat-tool-loop" } });
  const ar = routeOf(anthRow);
  ok(ar.route_served_provider === "anthropic" && ar.route_requested_class === "operational"
    && ar.route_job === "chat-tool-loop" && ar.route_reason === "served_primary" && ar.route_fallback === false,
    `F5 the streamed Anthropic drain row carries the route with the caller's job tag (${JSON.stringify(ar)})`);
  const oaiRow = await drain("operational", { ...ON, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f5b", agent_id: "fabric-check", job_kind: "chat" } });
  const orr = routeOf(oaiRow);
  ok(oaiRow?.provider === "openai" && orr.route_served_provider === "openai" && orr.route_served_model === "gpt-6.1-sol"
    && orr.route_requested_class === "operational" && orr.route_reason === "served_primary",
    `F5 the streamed OpenAI drain row carries the route too (${JSON.stringify(orr)})`);

  // F6 — the classifier's rows carry the route automatically (cheap, turn_classify).
  const { classifyTurn } = await import("../../supabase/functions/_shared/paige-turn/classify-call.ts");
  const recF6 = recorder();
  const beforeF6 = recF6.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await classifyTurn("thanks so much", null, { tenant_id: "8f6c0000-0000-4000-8000-0000000000f6", agent_id: "paige-ai-chat", job_kind: "turn-classify" });
  const f6 = recF6.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF6).at(-1)?.row;
  const f6r = routeOf(f6);
  ok(f6r.route_requested_class === "cheap" && f6r.route_job === "turn-classify"
    && String(f6r.route_served_model).includes("haiku") && f6r.route_reason === "served_primary",
    `F6 the classifier's row carries its route automatically (${JSON.stringify(f6r)})`);

  delete ENV.OPENAI_CANARY_TENANTS;

  // F7 — privacy: every route value is a closed code or an id; nothing free-text.
  const allRouteRows = recorder().inserts.filter((i) => i.table === "paige_llm_trace").map((i) => i.row?.metadata).filter((m) => m && "route_reason" in m);
  ok(allRouteRows.length >= 5 && allRouteRows.every((m) => CLOSED_REASON.test(m.route_reason) && CLOSED_CLASS.test(m.route_requested_class)
    && typeof m.route_fallback === "boolean" && !/[^\w.:/-]/.test(String(m.route_job))),
    `F7 every recorded route value is a closed code or an id (${allRouteRows.length} rows checked)`);

  setScenario({});
}


// ── G. THE CUTOVER: production-wide admission, class-scoped, env-staged ─────────────────────────
// The owner-directed flag is ON and admission is PRODUCTION-WIDE (the live validation drive passed
// — EVIDENCE.md). The class scope stays operational only; the env is the staged control (a set list
// restricts; an explicitly EMPTY value is the kill switch). No-spend: the OpenAI legs here run
// against the harness recording fake.
{
  const ANY_TENANT = "9a7d0000-0000-4000-8000-0000000000b2";
  const OTHER_TENANT = "8b5c0000-0000-4000-8000-0000000000c3";

  ok(fabric.OPENAI_CHAT_ENABLED === true, "G1 the owner-directed master flag is ON");
  ok(fabric.openAiCanaryTenants() === null, "G1 with no env cohort, admission is PRODUCTION-WIDE (null = all)");

  const admits = (t, c) => fabric.openAiCohortAdmits(t, c);
  ok(admits(ANY_TENANT, "operational") === true, "G2 ANY well-formed tenant is admitted for operational");
  ok(admits(ANY_TENANT, "cheap") === false && admits(ANY_TENANT, "frontier") === false,
    "G2 the scope is operational ONLY — cheap and frontier stay on the incumbent path until their own validation");
  ok(admits(null, "operational") === false && admits("not-a-uuid", "operational") === false,
    "G2 unattributed and malformed tenants are never admitted");
  ENV.OPENAI_CANARY_CLASSES = "operational,cheap";
  ok(admits(ANY_TENANT, "cheap") === true, "G2 an explicit class scope can widen (a reviewed decision)");
  ENV.OPENAI_CANARY_CLASSES = "garbage,frontier";
  ok(admits(ANY_TENANT, "operational") === false && admits(ANY_TENANT, "frontier") === true,
    "G2 an explicit scope REPLACES the default (unknown class tokens ignored, never wider)");
  delete ENV.OPENAI_CANARY_CLASSES;

  setScenario({});
  anthropicPlan = { status: 200 };
  openaiPlan = { status: 200 };
  calls.length = 0;
  const anyStream = await fabric.fabricChatStream("operational", { messages: [{ role: "user", content: "x" }], tools: [TOOL], tool_choice: "auto" },
    { openaiFetch, trace: { tenant_id: ANY_TENANT, agent_id: "fabric-check", job_kind: "chat" } });
  const readerG = anyStream.body?.getReader();
  while (readerG && !(await readerG.read()).done) { /* drain */ }
  ok(anyStream.ok && anyStream.served?.provider === "openai" && anyStream.served?.model === "gpt-6.1-sol"
    && calls.every((c) => c.provider === "openai"),
    `G3 ANY tenant's operational round serves Sol first (${anyStream.served?.provider}:${anyStream.served?.model})`);
  calls.length = 0;
  const unattributed = await fabric.fabricChatStream("operational", { messages: [{ role: "user", content: "x" }], tools: [TOOL], tool_choice: "auto" },
    { openaiFetch, trace: { agent_id: "fabric-check", job_kind: "chat" } });
  const readerU = unattributed.body?.getReader();
  while (readerU && !(await readerU.read()).done) { /* drain */ }
  ok(unattributed.ok && unattributed.served?.provider === "anthropic" && calls.every((c) => c.provider === "anthropic"),
    "G3 unattributed traffic still serves from the incumbent (never admitted)");
  const cheapCompletion = await fabric.fabricCompletion(
    { cognitive_class: "cheap", job: "turn_classify", messages: [{ role: "user", content: "x" }] },
    { openaiFetch, trace: { tenant_id: ANY_TENANT, agent_id: "fabric-check" } });
  ok(cheapCompletion.route.served?.provider === "anthropic" && String(cheapCompletion.route.served?.model).includes("haiku")
    && cheapCompletion.route.attempts.some((a) => a.provider === "openai" && a.failure === "skipped_disabled"),
    "G3 the CLASSIFIER stays on Haiku — cheap is not admitted until its own validation");
  const opCompletion = await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "research_unit_synthesis", messages: [{ role: "user", content: "x" }] },
    { openaiFetch, trace: { tenant_id: ANY_TENANT, agent_id: "fabric-check" } });
  ok(opCompletion.ok && opCompletion.route.served?.provider === "openai" && opCompletion.route.served?.model === "gpt-6.1-sol",
    "G3 the completion seam serves Sol first for any tenant's operational job");

  ENV.OPENAI_CANARY_TENANTS = OTHER_TENANT.toUpperCase();
  ok(fabric.openAiCanaryTenants() !== null && admits(ANY_TENANT, "operational") === false && admits(OTHER_TENANT, "operational") === true,
    "G4 a set env cohort RESTRICTS to it, case-insensitively (staged rollout)");
  ENV.OPENAI_CANARY_TENANTS = "";
  ok(fabric.openAiCanaryTenants() !== null && fabric.openAiCanaryTenants().length === 0 && admits(ANY_TENANT, "operational") === false,
    "G4 an explicitly EMPTY cohort admits NOBODY — the kill switch, effective on the next call (no deploy)");
  delete ENV.OPENAI_CANARY_TENANTS;
  ok(fabric.openAiCanaryTenants() === null && admits(ANY_TENANT, "operational") === true,
    "G4 clearing the env RESTORES production-wide (unsetting is NOT the kill switch)");

  setScenario({});
}
console.log(`fabric-check: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
