/**
 * The streaming Model Fabric (INT-334 R5), driven through its REAL transports.
 *
 * OWNER RULING MF-OWNER-2026-11-23 (2026-11-23): OpenRouter is the EXCLUSIVE external language-model
 * gateway. ALL routed classes (cheap/operational/frontier, and `deterministic` promoted to
 * operational) serve through OpenRouter Auto (`openrouter/auto`) with GPT models excluded via the
 * `auto-router` plugin. No direct OpenAI, Anthropic, Featherless, or Groq inference on any routed
 * path — the recorded 2026-10-06 chain and the 2026-11-17 OpenAI-namespaced transport are retired
 * (historical evidence only). If Auto fails, the turn is interrupted truthfully: no fallback to a
 * direct provider, ever. Interim posture pending the Auto vs explicit vs hybrid model comparison.
 *
 * What this pins:
 *  - ADMISSION-GATED: OpenRouter Auto serves only cohort-admitted tenants in the class scope; an
 *    unattributed/kill-switched caller gets NO provider (truthful failure), and no direct OpenAI or
 *    Anthropic call is ever made on a routed path.
 *  - THE ROUTE: every class requests `openrouter/auto`; the `auto-router` plugin carries
 *    `excluded_models: ["openai/*"]` (GPT exclusion — a top-level field would be ignored); PAIGE
 *    never overrides Auto's reasoning effort.
 *  - NO FALLBACK: a proven health failure (auth/config, billing, rate limit, model unavailable,
 *    outage, a network throw) or an invalid request interrupts the turn with the named failure and
 *    the status reaching the caller — never a second transport.
 *  - THE SHAPE: whatever served, the caller reads the same chat-shaped SSE, and the finished-round gate
 *    reads a normal tool-use stop.
 *  - The request carries exactly what chat sent (tools, tool_choice) and OpenRouter's own key/base.
 *
 * No network: fetch is a recording fake per provider. Run: `npm run test:model-fabric`.
 */
import { setScenario, recorder } from "../client-memory-authz/fake-supabase.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV = {
  ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key",
  OPENAI_API_KEY: "sk-test-not-a-real-key",
  OPENROUTER_API_KEY: "sk-or-test-not-a-real-key",
  // Empty cohort = the OpenRouter kill switch for the unattributed pins below. The admitted runs
  // force the candidate through the explicit `enabled` test seam instead.
  OPENROUTER_CANARY_TENANTS: "",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};
globalThis.Deno = { env: { get: (k) => ENV[k] ?? undefined, toObject: () => ({ ...ENV }) } };
setScenario({});

const enc = new TextEncoder();
const sse = (events) => new ReadableStream({
  start(c) { for (const e of events) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); c.close(); },
});

// ── Anthropic: a normal tool-use round (ONLY the pinned judge leg uses this transport) ────────
const ANTHROPIC_TOOL_ROUND = [
  { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-5-5-served", usage: { input_tokens: 5, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "crm_contact_lookup", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"Acme\"}" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
  { type: "message_stop" },
];
// ── The Responses wire: the same round, native events (OpenRouter Auto serves it) ─────────────
const responsesToolRound = (model) => [
  { type: "response.created", response: { model, status: "in_progress" } },
  { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "crm_contact_lookup", arguments: "" } },
  { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "{\"q\":\"Acme\"}" },
  { type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 0, arguments: "{\"q\":\"Acme\"}" },
  { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "crm_contact_lookup", arguments: "{\"q\":\"Acme\"}" } },
  { type: "response.completed", response: { model, status: "completed", usage: { input_tokens: 5, output_tokens: 9 } } },
];

// Recording fakes. `plan` says what the next call returns.
let calls = [];
let anthropicPlan = { status: 200 };
let plan = { status: 200 };
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
  if (u.startsWith("https://api.openai.com/")) throw new Error(`fabric-check: DIRECT OpenAI call is prohibited by MF-OWNER-2026-11-23 (${u})`);
  if (u.startsWith("https://openrouter.ai/")) return openrouterFetch(url, init);
  throw new Error(`fabric-check: unexpected network call to ${u}`);
};
// OpenRouter: the SAME Responses wire at its own base URL with its OWN key.
const openrouterFetch = async (url, init) => {
  const req = JSON.parse(init.body);
  calls.push({ provider: "openrouter", req, headers: init.headers });
  if (plan.throws) throw Object.assign(new Error("connection reset"), { name: "TypeError" });
  if (plan.status !== 200) {
    return new Response(JSON.stringify({ error: { type: plan.type, code: plan.code ?? null, message: "redacted" } }), { status: plan.status, headers: { "content-type": "application/json" } });
  }
  if (req.stream !== true) {
    const isClassifier = typeof req.instructions === "string" && req.instructions.includes("You label one message sent to PAIGE");
    const text = isClassifier
      ? JSON.stringify({ intent: "converse", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 })
      : "synthesis";
    return new Response(JSON.stringify({ id: "resp_or", model: req.model, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: 9, output_tokens: 7 } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(sse(responsesToolRound(`${req.model}-served-by-auto`)), { status: 200, headers: { "content-type": "text/event-stream" } });
};

const fabric = await import("../../supabase/functions/_shared/model-fabric.ts");
const { CLAUDE_REASONING, CLAUDE_CLASSIFICATION } = await import("../../supabase/functions/_shared/claude.ts");
const { readModelRound, executableToolCalls } = await import("../../supabase/functions/_shared/paige-turn/round.ts");
const { CLASS_POLICY } = await import("../../supabase/functions/_shared/paige-turn/route.ts");
const { OPENROUTER_EXCLUDED_MODELS } = await import("../../supabase/functions/_shared/openrouter-models.ts");

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
  const s = await fabric.fabricChatStream(cls, body, { openrouterFetch, ...opts });
  const runnable = s.ok && s.body ? executableToolCalls(readModelRound(await payloadsOf(s.body))) : [];
  return { s, runnable, calls: [...calls] };
}
const served = (r) => r.s.served ? `${r.s.served.provider}:${r.s.served.model}` : "none";
const realAttempt = (attempts) => attempts.find((a) => a.failure && a.failure !== "skipped_disabled") ?? attempts[0];
const autoLegGuards = (r) => {
  const p = r.calls[0]?.req?.plugins ?? [];
  return Array.isArray(p) && p[0]?.id === "auto-router" && Array.isArray(p[0]?.excluded_models) && p[0].excluded_models.includes("openai/*");
};

// ── 0. THE POLICY ITSELF (MF-OWNER-2026-11-23) ────────────────────────────────────────────────
// The routed policy is OpenRouter Auto ONLY, for every class, with GPT excluded. No direct
// OpenAI/Anthropic/Featherless/Groq candidate may exist on any routed class list.
{
  for (const cls of ["cheap", "operational", "frontier"]) {
    ok(CLASS_POLICY[cls].length === 1 && CLASS_POLICY[cls][0].provider === "openrouter" && CLASS_POLICY[cls][0].model === "openrouter/auto",
      `0.1 ${cls}: the one candidate is OpenRouter Auto`);
    ok(!CLASS_POLICY[cls].some((c) => c.provider !== "openrouter"),
      `0.2 ${cls}: NO direct OpenAI/Anthropic/Featherless/Groq candidate exists (MF-OWNER-2026-11-23)`);
  }
  ok(Array.isArray(OPENROUTER_EXCLUDED_MODELS) && OPENROUTER_EXCLUDED_MODELS.includes("openai/*"),
    "0.3 the GPT exclusion constant is the owner-ruled one");
}

// ── 1. ADMISSION: attributed traffic only; unattributed is refused truthfully ─────────────────
// These drives carry NO tenant (unattributed) and the cohort is the explicit kill switch, so NO
// candidate is admitted: the turn is interrupted, and no direct provider is EVER contacted.
ok(fabric.OPENROUTER_CHAT_ENABLED === true, "the OpenRouter master flag is ON");
anthropicPlan = { status: 200 }; plan = { status: 200 };
for (const cls of ["operational", "frontier", "deterministic", "cheap"]) {
  const r = await run(cls);
  ok(!r.s.ok && r.s.served === null && r.calls.length === 0,
    `${cls}: unattributed traffic gets NO provider — the turn is interrupted truthfully (${served(r)})`);
  ok(r.s.attempts.some((a) => a.provider === "openrouter" && a.failure === "skipped_disabled"),
    `${cls}: the not-admitted OpenRouter candidate is recorded`);
  ok(!r.calls.some((c) => c.provider === "anthropic" || c.provider === "openai"),
    `${cls}: no direct OpenAI or Anthropic call exists for unattributed traffic`);
}
{
  const r = await run("operational");
  ok(r.runnable.length === 0, "an interrupted round never reaches the tool gate");
}

// ── 2. THE ROUTE (admitted through the test seam): Auto serves every class ───────────────────
const ON = { enabled: { openrouter: true } };
for (const cls of ["operational", "frontier", "cheap", "deterministic"]) {
  const r = await run(cls, ON);
  ok(served(r) === "openrouter:openrouter/auto", `${cls}: OpenRouter Auto serves (${served(r)})`);
  ok(r.calls.length === 1 && r.calls[0].provider === "openrouter" && r.calls[0].req.model === "openrouter/auto",
    `${cls}: one call to the Auto leg, no other transport`);
  ok(autoLegGuards(r), `${cls}: the auto-router plugin carries the GPT exclusion on every leg`);
  ok(!("reasoning" in r.calls[0].req), `${cls}: PAIGE never overrides Auto's reasoning effort`);
  ok(!("store" in r.calls[0].req) && !("include" in r.calls[0].req) && !("prompt_cache_key" in r.calls[0].req),
    `${cls}: OpenRouter omits OpenAI-only fields (store, include, prompt_cache_key)`);
  ok(r.runnable.length === 1 && r.runnable[0].arguments === "{\"q\":\"Acme\"}",
    `${cls}: the chat-shaped round reaches the gate whole from the Auto leg`);
}
{
  const r = await run("operational", ON);
  ok(Array.isArray(r.calls[0].req.tools) && r.calls[0].req.tools[0]?.name === "crm_contact_lookup" && r.calls[0].req.stream === true,
    "operational: tools and streaming reach the Auto leg");
  ok(r.calls[0].headers.authorization === "Bearer sk-or-test-not-a-real-key",
    "OpenRouter uses its OWN key, never the OpenAI key");
  const close = await run("operational", ON, { messages: BODY.messages });
  ok(!("tools" in close.calls[0].req) && !("tool_choice" in close.calls[0].req),
    "a tools-free closing round sends no tools");
  const cacheScoped = await run("operational", { ...ON, trace: { tenant_id: "7e5a0000-0000-4000-8000-0000000000c9", agent_id: "fabric-check",
    prompt_cache_scope: { actor_id: "00000000-0000-4000-8000-000000000011", tenant_id: "7e5a0000-0000-4000-8000-0000000000c9", working_context_tenant_id: "7e5a0000-0000-4000-8000-0000000000c9" } } });
  ok(cacheScoped.s.ok && !cacheScoped.calls.some((c) => "prompt_cache_key" in c.req),
    "a trusted cache partition never leaks a prompt_cache_key onto the OpenRouter wire (OpenRouter owns session stickiness)");
}

// ── 2b. THE FABRIC'S OWN ADMISSION CONTRACT (env-staged, fail closed) ──────────────────────────
{
  ok(fabric.openRouterAdmitted(null, "operational") === false, "unattributed traffic is never admitted to OpenRouter");
  delete ENV.OPENROUTER_CANARY_TENANTS;
  ok(fabric.openRouterAdmitted("7e5a0000-0000-4000-8000-0000000000f1", "operational") === true,
    "an attributed tenant is admitted by default when the key is configured");
  delete ENV.OPENROUTER_API_KEY;
  delete ENV.OPEN_ROUTER_AI_API;
  ok(fabric.openRouterAdmitted("7e5a0000-0000-4000-8000-0000000000f1", "operational") === false,
    "no configured key under either name means no admission — fail closed, never a hard failure");
  ENV.OPEN_ROUTER_AI_API = "sk-or-production-name-test";
  ok(fabric.openRouterAdmitted("7e5a0000-0000-4000-8000-0000000000f1", "operational") === true,
    "the configured OPEN_ROUTER_AI_API Edge secret admits OpenRouter on its own");
  delete ENV.OPEN_ROUTER_AI_API;
  ENV.OPENROUTER_API_KEY = "sk-or-test-not-a-real-key";
  ENV.OPENROUTER_CANARY_TENANTS = "";
  ok(fabric.openRouterAdmitted("7e5a0000-0000-4000-8000-0000000000f1", "operational") === false,
    "an explicitly empty tenant cohort is the kill switch");
  const noKey = await run("operational");
  ok(!noKey.s.ok && noKey.s.calls === undefined && noKey.calls.length === 0
    && noKey.s.attempts.some((a) => a.failure === "skipped_disabled"),
    "a missing OpenRouter key skips the candidate — the turn is interrupted, no fallback");
}
{
  const trace = { tenant_id: "7e5a0000-0000-4000-8000-0000000000a1", agent_id: "fabric-check" };
  const rec = recorder();
  const before = rec.inserts.filter((i) => i.table === "paige_llm_trace").length;
  const r = await fabric.fabricCompletion({ cognitive_class: "operational", job: "research_unit_synthesis", messages: [{ role: "user", content: "x" }] }, { ...ON, openrouterFetch, trace });
  for (let i = 0; i < 30 && rec.inserts.filter((x) => x.table === "paige_llm_trace").length <= before; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  const row = rec.inserts.filter((x) => x.table === "paige_llm_trace").slice(before).at(-1)?.row;
  ok(r.ok && r.route.served?.provider === "openrouter" && row?.provider === "openrouter"
    && row?.metadata?.route_served_provider === "openrouter",
    "the completion seam traces OpenRouter as the REAL serving provider, never a borrowed 'openai'");
}

// ── 3. NO FALLBACK: a failure interrupts the turn; the status reaches the caller ──────────────
const MOVES = [
  ["auth/config (401)", { status: 401, type: "invalid_request_error", code: "invalid_api_key" }, "auth_config"],
  ["rate limit (429)", { status: 429, type: "rate_limit_error", code: "rate_limit_exceeded" }, "rate_limit"],
  ["billing (429 insufficient_quota)", { status: 429, type: "insufficient_quota", code: "insufficient_quota" }, "billing"],
  ["outage (503)", { status: 503, type: "server_error" }, "provider_outage"],
  ["network throw", { throws: true }, "provider_outage"],
];
for (const [name, failure, expected] of MOVES) {
  plan = failure; anthropicPlan = { status: 200 };
  const r = await run("operational", ON);
  const expectedStatus = failure.throws ? 0 : failure.status;
  ok(!r.s.ok && r.s.served === null && r.s.status === expectedStatus,
    `${name}: the turn is interrupted; the status reaches the caller (${r.s.status})`);
  ok(r.calls.length === 1 && r.calls[0].provider === "openrouter",
    `${name}: exactly one transport was tried — OpenRouter only`);
  ok(realAttempt(r.s.attempts)?.failure === expected,
    `${name}: the failure is named (${realAttempt(r.s.attempts)?.failure})`);
  ok(r.runnable.length === 0, `${name}: nothing reaches the tool gate`);
}
const STAYS = [
  ["invalid request (400)", { status: 400, type: "invalid_request_error", code: "invalid_value" }, 400],
  ["unknown (418)", { status: 418, type: "weird" }, 418],
];
for (const [name, failure, status] of STAYS) {
  plan = failure; anthropicPlan = { status: 200 };
  const r = await run("operational", ON);
  ok(!r.s.ok && r.s.served === null && r.s.status === status, `${name}: no other transport is contacted (${r.s.status})`);
  ok(r.calls.length === 1 && r.calls[0].provider === "openrouter", `${name}: the Auto leg was the only call`);
}
plan = { status: 200 };

// ── 3b. WHAT A THROW PROVES (R5a review S1/S4, single-candidate form) ────────────────────────
{
  // NOTE (MF-OWNER-2026-11-23 posture): the old budget-rethrow pin drove the Anthropic gateway seam
  // on a routed Anthropic candidate — that candidate no longer exists, and the owner billing policy
  // (October27) makes enforceBudget informational (never block), so no live routed path can throw
  // budget_exceeded. The rethrow handlers remain in the fabric for compatibility; the gates that DO
  // run on every leg (budget read + authority revalidation) are pinned by E1-E3, H, I, K5 and E5.

  // A missing key is configuration, proven by its own error type — the candidate is skipped.
  delete ENV.OPENROUTER_API_KEY;
  const noKey = await run("operational");
  ok(!noKey.s.ok && noKey.calls.length === 0 && noKey.s.attempts.some((a) => a.failure === "skipped_disabled"),
    "no configured OpenRouter key: the turn is interrupted truthfully (skipped candidate recorded)");
  ENV.OPENROUTER_API_KEY = "sk-or-test-not-a-real-key";

  // A throw that proves no provider-health failure (the adapter refused the request shape before any
  // fetch) is `unknown`: the turn is interrupted and the provider is never contacted.
  const hosted = await run("operational", ON, { ...BODY, tools: [{ type: "web_search" }] });
  ok(!hosted.s.ok && realAttempt(hosted.s.attempts)?.failure === "unknown" && hosted.calls.length === 0,
    `a pre-fetch refusal is unknown, never an outage, and nothing is called (${fabric.describeAttempts(hosted.s)})`);
}

// ── 4. The cheap class never receives tools from chat (route contract), but the fabric does not add any.
{
  const r = await run("cheap", ON, { messages: BODY.messages });
  ok(!("tools" in r.calls[0].req), "the fabric adds no tools to a tools-free body");
}

// ── C. THE CLASS-BEARING CONSUMER SEAM (fabricCompletion) — R6A-RETURN D, non-streaming ───────
// A consumer names a cognitive class and its OWN job identity; the fabric alone picks the provider
// and model; the served route rides the response; the judge carve-out pins. Existing routed callers
// are untouched (nothing in production calls this yet — Deep Research adopts it in its own lane).
{
  anthropicPlan = { status: 200 };
  plan = { status: 200 };
  const seamRun = async (request, opts = {}) => {
    calls.length = 0;
    const r = await fabric.fabricCompletion(request, { openrouterFetch, ...opts });
    return { r, calls };
  };
  const REQ = (cls, job) => ({ cognitive_class: cls, job, messages: [{ role: "system", content: "consumer" }, { role: "user", content: "synthesize the evidence" }] });

  // C1 — every class serves OpenRouter Auto; the response is chat-shaped with the route attached.
  const cheap = await seamRun(REQ("cheap", "research_hop_planner"), ON);
  ok(cheap.r.ok && cheap.r.route.served?.provider === "openrouter" && cheap.r.route.served?.model === "openrouter/auto"
    && cheap.r.route.reason === "served_primary" && cheap.r.route.fallback === false,
    `C1 cheap class serves OpenRouter Auto (${cheap.r.route.served?.model})`);
  ok(cheap.r.response?.choices?.[0]?.message?.content === "synthesis" && typeof cheap.r.response?.usage?.prompt_tokens === "number",
    "C1 the result is chat-shaped with usage");
  const op = await seamRun(REQ("operational", "research_unit_synthesis"), ON);
  ok(op.r.ok && op.r.route.served?.provider === "openrouter" && op.r.route.served?.model === "openrouter/auto"
    && op.r.route.job === "research_unit_synthesis" && op.r.route.requested_class === "operational",
    "C1 operational class serves the Auto leg — the consumer named no provider");
  const fr = await seamRun(REQ("frontier", "research_difficult_reconciliation"), ON);
  ok(fr.r.ok && fr.r.route.served?.model === "openrouter/auto", "C1 frontier class serves the Auto leg");

  // C3 — no fallback: a proven health failure interrupts; invalid_request never moves either.
  plan = { status: 401, type: "authentication_error" };
  const fb = await seamRun(REQ("operational", "research_unit_synthesis"), ON);
  ok(!fb.r.ok && fb.r.route.reason === "failed" && realAttempt(fb.r.route.attempts)?.failure === "auth_config" && fb.calls.length === 1,
    "C3 a 401 interrupts the turn — no other transport is contacted");
  plan = { status: 400, type: "invalid_request_error" };
  const bad = await seamRun(REQ("operational", "research_unit_synthesis"), ON);
  ok(!bad.r.ok && bad.r.error?.failure === "invalid_request" && bad.calls.length === 1,
    "C3 an invalid request never moves — the same broken request would fail anywhere");
  plan = { status: 200 };

  // C4 — October27 owner policy: the old allowance is informational. Preserve the
  // original route and tenant-attributed usage, without an invented billing stop.
  setScenario({ tables: {
    admin_app_settings: [{ key: "llm_budget_daily_usd__t_6e5a0000-0000-4000-8000-0000000000c4", value: 1 }],
    paige_llm_trace: [{ tenant_id: "6e5a0000-0000-4000-8000-0000000000c4", cost_estimate_usd: 99, created_at: new Date().toISOString() }],
  } });
  const traceSeam = { tenant_id: "6e5a0000-0000-4000-8000-0000000000c4", agent_id: "fabric-check-seam" };
  const recC4 = recorder();
  calls.length = 0;
  const aboveMarker = await fabric.fabricCompletion(REQ("operational", "research_unit_synthesis"), { ...ON, openrouterFetch, trace: traceSeam });
  ok(aboveMarker.ok && aboveMarker.response?.choices?.[0]?.message?.content === "synthesis"
    && aboveMarker.route.served?.provider === "openrouter" && calls.length === 1,
    "C4 usage above the old marker preserves the original successful route");
  const c4rows = recC4.inserts.filter(i => i.table === "paige_llm_trace");
  ok(c4rows.length === 1 && c4rows[0].row?.tenant_id === traceSeam.tenant_id
    && c4rows[0].row?.provider === "openrouter" && c4rows[0].row?.doctrine_gate_hits?.budget?.level === "hard",
    "C4 the original provider usage row retains tenant attribution and the informational marker");
  setScenario({});

  // C5 — the judge carve-out: a pinned route ignores the class policy and never falls back.
  // OWNER DECISION POINT (flagged to the owner, preserved here): the pinned rubric judge still runs
  // on the direct Anthropic tier. MF-OWNER-2026-11-23 makes OpenRouter the exclusive gateway for
  // language-model inference; whether the pinned judge migrates to an OpenRouter-served model is a
  // material instrument decision for the owner and PO-EXP27 — NOT changed unilaterally here.
  const pinOk = await seamRun(REQ("cheap", "rubric_judge_v3"), { ...ON, pinned: { tier: "reasoning" } });
  ok(pinOk.r.ok && pinOk.r.route.served?.provider === "anthropic" && String(pinOk.r.route.served?.model).includes("sonnet")
    && pinOk.r.route.reason === "pinned_served" && pinOk.calls.length === 1 && pinOk.calls[0].provider === "anthropic",
    "C5 a pinned route serves Anthropic whatever the class or the enabled set says (preserved carve-out, owner decision pending)");
  anthropicPlan = { status: 503, type: "overloaded_error" };
  const pinFail = await seamRun(REQ("operational", "rubric_judge_v3"), { ...ON, pinned: { tier: "reasoning" } });
  ok(!pinFail.r.ok && pinFail.r.route.reason === "pinned_failed" && pinFail.r.error?.failure === "provider_outage"
    && pinFail.calls.length === 1,
    "C5 a pinned route fails without moving — the instrument stays comparable");
  anthropicPlan = { status: 200 };

  // C6 — the request contract: no provider or model field exists to set, and the job identity is validated.
  let badJob = null;
  try { await fabric.fabricCompletion({ ...REQ("operational", "Not A Job") }, { openrouterFetch }); } catch (e) { badJob = e; }
  ok(badJob instanceof Error && /job/.test(badJob.message), "C6 a malformed job identity is refused");
  ok(!("provider" in REQ("operational", "x")) && !("model" in REQ("operational", "x")),
    "C6 the request carries no provider or model field to hardcode");

  // C8 — the OPENROUTER leg's trace row carries the consumer's job identity too (never the adapter's "chat").
  {
    const rec8 = recorder();
    const before8 = rec8.inserts.filter((i) => i.table === "paige_llm_trace").length;
    await seamRun(REQ("operational", "research_unit_synthesis"), { ...ON, trace: { tenant_id: "tenant-seam8", agent_id: "fabric-check-seam" } });
    const rows8 = rec8.inserts.filter((i) => i.table === "paige_llm_trace").slice(before8);
    ok(rows8.length === 1 && rows8[0].row?.job_kind === "research_unit_synthesis" && rows8[0].row?.provider === "openrouter",
      `C8 the Auto-served leg traces the consumer's job identity (${rows8[0]?.row?.job_kind})`);
  }

  // C9 — a FAILED Auto leg leaves the same evidence a successful one does.
  {
    const rec9 = recorder();
    const before9 = rec9.inserts.filter((i) => i.table === "paige_llm_trace").length;
    plan = { status: 503, type: "server_error" };
    await seamRun(REQ("operational", "research_unit_synthesis"), { ...ON, trace: { tenant_id: "tenant-seam9", agent_id: "fabric-check-seam" } });
    plan = { status: 200 };
    const rows9 = rec9.inserts.filter((i) => i.table === "paige_llm_trace").slice(before9);
    ok(rows9.length === 1 && rows9[0].row?.status === "error" && rows9[0].row?.job_kind === "research_unit_synthesis"
      && rows9[0].row?.provider === "openrouter",
      `C9 a failed Auto leg writes one attributed error trace row (${rows9[0]?.row?.provider})`);
  }

  // C10 — transport failures are the streaming fabric's provider_outage.
  {
    const realFetch = globalThis.fetch;
    plan = { status: 200 };
    let orThrew = false;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("https://openrouter.ai/")) { orThrew = true; throw Object.assign(new Error("connection reset"), { name: "TypeError" }); }
      return realFetch(url, init);
    };
    calls.length = 0;
    const t = await fabric.fabricCompletion(REQ("operational", "research_unit_synthesis"), { ...ON, openrouterFetch: globalThis.fetch });
    globalThis.fetch = realFetch;
    ok(t.route.attempts.some((a) => a.failure === "provider_outage") && orThrew,
      `C10 a transport throw on the Auto leg classifies provider_outage (${t.route.attempts.map((a) => a.failure).join(",")})`);
  }

  // C7 — telemetry: the Auto leg writes exactly one trace row carrying the consumer's job kind.
  const rec0 = recorder();
  const before = rec0.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await seamRun(REQ("operational", "research_unit_synthesis"), { ...ON, trace: { tenant_id: "tenant-seam2", agent_id: "fabric-check-seam" } });
  const rows = rec0.inserts.filter((i) => i.table === "paige_llm_trace").slice(before);
  ok(rows.length === 1 && rows[0].row?.job_kind === "research_unit_synthesis" && rows[0].row?.provider === "openrouter",
    `C7 one attributed trace row carries the consumer's job identity (${rows.length} rows)`);
}


// ── D. THE CLASSIFIER THROUGH THE FABRIC (#1844) — the first production consumer of the seam ────
// classifyTurn now opens through fabricCompletion({cheap, turn_classify}): same wire, same deadline,
// same conservative null, and — new, on the owner's order — the tenant budget gate covers
// it (R4's S3 gap), with the router's established ungated-on-unreadable-accrual policy preserved.
{
  const { classifyTurn, TURN_CLASSIFY_DEADLINE_MS } = await import("../../supabase/functions/_shared/paige-turn/classify-call.ts");
  const CLASSIFY_TRACE = { tenant_id: "5a4a3a2a-0000-4000-8000-00000000c1a1", agent_id: "paige-ai-chat", job_kind: "turn-classify" };
  // The classifier drives REAL admission (no enabled seam): lift the pinned kill switch for this
  // section only, and restore it after so the unattributed pins keep their posture.
  delete ENV.OPENROUTER_CANARY_TENANTS;

  // D0 — the RECALIBRATED deadline (EXP01, 2026-11-13): the value is pinned because changing it is
  // a reviewed decision, and it stays above the incumbent p90 the parameter was first calibrated on.
  const classifySource = readFileSync(fileURLToPath(new URL("../../supabase/functions/_shared/paige-turn/classify-call.ts", import.meta.url)), "utf8");
  ok(TURN_CLASSIFY_DEADLINE_MS === 4000,
    "D0 the deadline is the bounded 4000 ms recalibration (original 2500ms censored-tail failure retained)");
  ok(classifySource.includes("TURN_CLASSIFY_DEADLINE_MS = 4000") && classifySource.includes("tune-or-revert"),
    "D0 the constant's own record names the calibration basis and the acceptance gate");
  ok(TURN_CLASSIFY_DEADLINE_MS > 1460,
    "D0 the deadline stays above the incumbent classifier p90 it was first calibrated on (Haiku 1460 ms)");

  // D1 — routing parity under MF-OWNER-2026-11-23: the cheap class serves the OpenRouter Auto leg.
  // The classifier's shape rides the Responses wire (instructions, 120 output tokens); its temperature-0
  // knob is deliberately DROPPED — the adapter's pinned rule sends no sampling to a reasoning model
  // (openai-responses-check 2.4). Determinism rests on the closed-enum parse, the conservative null,
  // and the deadline. The TRACE keeps the caller's tag.
  setScenario({});
  calls.length = 0;
  const recD = recorder();
  const beforeD = recD.inserts.filter((i) => i.table === "paige_llm_trace").length;
  const cls = await classifyTurn("thanks so much", null, CLASSIFY_TRACE);
  const d1row = recD.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeD).at(-1)?.row;
  ok(cls !== null && typeof cls.confidence === "number",
    `D1 the classifier answers through the fabric (intent ${cls?.intent})`);
  ok(calls.length === 1 && calls[0].provider === "openrouter" && calls[0].req.model === "openrouter/auto",
    `D1 the cheap class serves the Auto leg first — provider parity (${calls[0]?.req?.model})`);
  ok(calls[0].req.plugins?.[0]?.id === "auto-router" && calls[0].req.plugins?.[0]?.excluded_models?.includes("openai/*"),
    "D1 the classifier's Auto leg carries the GPT exclusion plugin");
  ok(String(calls[0].req.instructions).includes("You label one message sent to PAIGE") && calls[0].req.max_output_tokens === 120 && !("temperature" in calls[0].req),
    "D1 the classifier's shape rides the wire; sampling is never sent to a reasoning model (2.4 rule)");
  ok(d1row?.job_kind === "turn-classify" && d1row?.provider === "openrouter",
    `D1 the trace keeps the caller's job_kind tag (${d1row?.job_kind}) — no trace-history break`);

  // D1-tail — drive the REAL classifier/Fabric/adapter with a response in the
  // censored tail of the former 2500ms window. No provider or authority bypass.
  setScenario({});
  calls.length = 0;
  const tailFetch = globalThis.fetch;
  let tailAborted = false;
  const tailDispatches = [];
  globalThis.fetch = async (url, init) => {
    tailDispatches.push(String(url));
    if (String(url).startsWith("https://openrouter.ai/")) {
      await new Promise((resolve, reject) => {
        const abort = () => { tailAborted = true; clearTimeout(timer); reject(init.signal.reason); };
        const timer = setTimeout(() => { init.signal?.removeEventListener("abort", abort); resolve(); }, 3000);
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    return tailFetch(url, init);
  };
  let tailClassification;
  try { tailClassification = await classifyTurn("thanks so much", null, CLASSIFY_TRACE); }
  finally { globalThis.fetch = tailFetch; }
  ok(tailClassification?.intent === "converse" && tailClassification.needs_workspace_data === false && !tailAborted,
    "D1-tail a valid 3000ms Auto classification survives without taking unclassified_default");
  ok(tailDispatches.length === 1 && tailDispatches[0].startsWith("https://openrouter.ai/"),
    "D1-tail one original primary request, no retry or second-provider dispatch");

  // D2 — the known ceiling, under the ESTABLISHED contract: the classifier is a CHEAP-band call,
  // and the budget contract deliberately allows gated continuation for the cheap band at the hard
  // ceiling (the R5a review's S3 disposition, unchanged by order of the owner). The pin: the call
  // proceeds, the gate hit is RECORDED on the attributed row, and nothing throws into the turn.
  setScenario({ tables: {
    admin_app_settings: [{ key: "llm_budget_daily_usd__t_5a4a3a2a-0000-4000-8000-00000000c1a2", value: 1 }],
    paige_llm_trace: [{ tenant_id: "5a4a3a2a-0000-4000-8000-00000000c1a2", cost_estimate_usd: 99, created_at: new Date().toISOString() }],
  } });
  calls.length = 0;
  const recD2 = recorder();
  const beforeD2 = recD2.inserts.filter((i) => i.table === "paige_llm_trace").length;
  const overCeiling = await classifyTurn("thanks so much", null, { tenant_id: "5a4a3a2a-0000-4000-8000-00000000c1a2", agent_id: "paige-ai-chat", job_kind: "turn-classify" });
  const gateRows = recD2.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeD2);
  ok(overCeiling !== null && calls.length === 1 && calls[0].provider === "openrouter",
    `D2 over a known ceiling the cheap-band classifier continues UNDER the established contract, on the Auto leg (answered=${overCeiling !== null})`);
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

  // D4 — the deadline: a transport slower than the bound is abandoned and the conservative
  // null returns (the fetch is aborted through the seam's signal). The slow fake sits on the
  // OPENROUTER leg — under MF-OWNER-2026-11-23 that is the classifier's only transport.
  setScenario({});
  const realFetchD = globalThis.fetch;
  let observedSignal = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://openrouter.ai/")) {
      observedSignal = init?.signal ?? null;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, TURN_CLASSIFY_DEADLINE_MS + 1500);
        observedSignal?.addEventListener("abort", () => { clearTimeout(t); const e = new Error("aborted"); e.name = "AbortError"; reject(e); }, { once: true });
      });
      return new Response(JSON.stringify({ id: "r", model: "openrouter/auto", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}" }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
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
    { ...ON, openrouterFetch, trace: { tenant_id: "5a4a3a2a-0000-4000-8000-00000000c1a5", agent_id: "a", job_kind: "my_own_tag" } },
  );
  void tagRun;
  const tagRows = recorder().inserts.filter((i) => i.table === "paige_llm_trace" && i.row?.tenant_id === "5a4a3a2a-0000-4000-8000-00000000c1a5");
  ok(tagRows.length === 1 && tagRows[0].row?.job_kind === "my_own_tag",
    `D5 a caller's own trace job_kind wins over the request's (rows=${tagRows.length}, kind=${tagRows[0]?.row?.job_kind}, ok=${tagRun.ok}, err=${tagRun.error?.failure})`);

  setScenario({});
  // Restore the kill switch for the classifier/Anthropic-incumbent pins after this section.
  ENV.OPENROUTER_CANARY_TENANTS = "";
}


// ── E. #1850: streaming budget, document turns, whole-operation cancellation ────────────────────
{
  const STREAM_BODY = { messages: [{ role: "user", content: "stream this" }], tools: [TOOL], tool_choice: "auto" };
  const streamRun = async (cls, opts = {}, body = STREAM_BODY) => {
    calls.length = 0;
    anthropicPlan = { status: 200 };
    plan = { status: 200 };
    const stream = await fabric.fabricChatStream(cls, body, { openrouterFetch, ...opts });
    const reader = stream.body?.getReader();
    while (reader && !(await reader.read()).done) { /* drain */ }
    return { stream, calls };
  };

  // E1 — usage above the former marker does not stop the original streaming leg.
  setScenario({ tables: {
    admin_app_settings: [{ key: "llm_budget_daily_usd__t_6e5a0000-0000-4000-8000-0000000000e1", value: 1 }],
    paige_llm_trace: [{ tenant_id: "6e5a0000-0000-4000-8000-0000000000e1", cost_estimate_usd: 99, created_at: new Date().toISOString() }],
  } });
  const recE1 = recorder();
  const beforeE1 = recE1.inserts.filter((i) => i.table === "paige_llm_trace").length;
  calls.length = 0;
  const aboveMarkerE1 = await streamRun("operational", { ...ON, trace: { tenant_id: "6e5a0000-0000-4000-8000-0000000000e1", agent_id: "fabric-check" } });
  const e1rows = recE1.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeE1);
  ok(aboveMarkerE1.stream.ok && aboveMarkerE1.calls.length === 1 && aboveMarkerE1.calls[0]?.provider === "openrouter",
    "E1 usage above the old marker streams on the Auto leg without interruption");
  ok(e1rows.length === 1 && e1rows[0].row?.provider === "openrouter"
    && e1rows[0].row?.tenant_id === "6e5a0000-0000-4000-8000-0000000000e1"
    && e1rows[0].row?.doctrine_gate_hits?.budget?.level === "hard" && e1rows[0].row?.error_class !== "budget_exceeded",
    "E1 actual streamed usage retains one tenant-attributed trace and its informational marker");

  // E2 — a soft-gate zone streams AND the hit rides the drained stream's own trace row.
  setScenario({ tables: {
    admin_app_settings: [{ key: "llm_budget_daily_usd__t_6e5a0000-0000-4000-8000-0000000000e2", value: 10 }],
    paige_llm_trace: [{ tenant_id: "6e5a0000-0000-4000-8000-0000000000e2", cost_estimate_usd: 9, created_at: new Date().toISOString() }],
  } });
  const recE2 = recorder();
  const beforeE2 = recE2.inserts.filter((i) => i.table === "paige_llm_trace").length;
  const soft = await streamRun("operational", { ...ON, trace: { tenant_id: "6e5a0000-0000-4000-8000-0000000000e2", agent_id: "fabric-check", job_kind: "chat" } });
  const softRows = recE2.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeE2);
  ok(soft.stream.ok && soft.calls[0]?.provider === "openrouter",
    "E2 a soft-gate zone streams on the class's candidate");
  ok(softRows.some((r) => r.row?.provider === "openrouter" && r.row?.doctrine_gate_hits?.budget?.level === "soft"),
    `E2 the gate hit rides the drained stream's own trace row (${softRows.map((r) => `${r.row?.provider}:${JSON.stringify(r.row?.doctrine_gate_hits)}`).join(",")})`);

  // E3 — unknown accrual: the established ungated-but-loud policy, on the streaming leg too.
  setScenario({ tables: {}, tableErrors: { paige_llm_trace: { message: "read failed", code: "XX001" } } });
  const unknown = await streamRun("operational", { ...ON, trace: { tenant_id: "6e5a0000-0000-4000-8000-0000000000e3", agent_id: "fabric-check" } });
  ok(unknown.stream.ok && unknown.calls[0]?.provider === "openrouter",
    "E3 unreadable accrual proceeds ungated on the streaming leg (policy unchanged)");

  // E4 — DOCUMENT TURNS (P1 finding, honestly pinned): the Responses adapter refuses document parts
  // by design (never a silent omission). Under MF-OWNER-2026-11-23 the direct-Anthropic
  // document-capable route is retired, and until a document-capable model through OpenRouter is
  // qualified (owner's model comparison includes document-bearing requests), a document turn is
  // refused TRUTHFULLY: the Auto candidate is skipped, no provider is contacted, nothing is
  // fabricated. This records the capability gap; it does not pretend the capability exists.
  setScenario({});
  const DOC_BODY = { messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0" } }, { type: "text", text: "read this" }] }], tools: [TOOL], tool_choice: "auto" };
  const docStream = await streamRun("operational", { ...ON }, DOC_BODY);
  ok(!docStream.stream.ok && docStream.calls.length === 0
    && docStream.stream.attempts.some((a) => a.failure === "unsupported_document"),
    `E4 a document turn is refused truthfully (unsupported_document), never silently dropped, never a fabricated answer (${fabric.describeAttempts(docStream.stream)}) — document-capable OpenRouter model PENDING the owner's model comparison`);
  const docCompletion = await fabric.fabricCompletion({ cognitive_class: "operational", job: "research_dossier_synthesis", ...DOC_BODY }, { ...ON, openrouterFetch });
  ok(!docCompletion.ok && docCompletion.route.attempts.some((a) => a.failure === "unsupported_document"),
    "E4 the completion seam skips the Auto candidate for a document turn too");

  // E5 — the classifier's whole operation is bounded: a budget read that outlives the deadline
  // dispatches NOTHING after the classifier has timed out.
  const { classifyTurn, TURN_CLASSIFY_DEADLINE_MS } = await import("../../supabase/functions/_shared/paige-turn/classify-call.ts");
  delete ENV.OPENROUTER_CANARY_TENANTS;
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
  ENV.OPENROUTER_CANARY_TENANTS = "";

  // E6 — real cancellation of the OpenRouter transport: the fetch receives the signal, aborts,
  // and the interrupted leg never becomes a fabricated success.
  setScenario({});
  const realFetchE = globalThis.fetch;
  let orSignalSeen = null;
  const slowOpenrouter = async (url, init) => {
    if (!String(url).includes("openrouter")) return realFetchE(url, init);
    orSignalSeen = init?.signal ?? null;
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 5000);
      orSignalSeen?.addEventListener("abort", () => { clearTimeout(t); const e = new Error("aborted"); e.name = "AbortError"; reject(e); }, { once: true });
    });
    throw new Error("unreachable");
  };
  calls.length = 0;
  const sigE6 = AbortSignal.timeout(150);
  const abortedRun = await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "turn_classify", messages: STREAM_BODY.messages },
    { enabled: { openrouter: true }, openrouterFetch: slowOpenrouter, signal: sigE6 },
  );
  ok(orSignalSeen instanceof AbortSignal && abortedRun.error?.failure === "aborted"
    && !abortedRun.route.served && calls.length === 0,
    `E6 the OpenRouter fetch receives the deadline signal and aborts for real (${abortedRun.error?.failure})`);

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

  setScenario({});
  anthropicPlan = { status: 200 };
  plan = { status: 200 };

  // F1 — the completion seam's served row carries the full route (Auto leg, admitted seam).
  const recF = recorder();
  const beforeF = recF.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "research_unit_synthesis", messages: [{ role: "user", content: "x" }] },
    { ...ON, openrouterFetch, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f1", agent_id: "fabric-check" } },
  );
  const f1 = recF.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF).at(-1)?.row;
  const f1r = routeOf(f1);
  ok(f1r.route_requested_class === "operational" && f1r.route_job === "research_unit_synthesis"
    && f1r.route_served_provider === "openrouter" && f1r.route_served_model === "openrouter/auto"
    && f1r.route_fallback === false && f1r.route_reason === "served_primary",
    `F1 the served Auto row carries the route (${JSON.stringify(f1r)})`);

  // F2 — a failed seam call: the error row carries reason=failed and NO served keys.
  plan = { status: 503, type: "server_error" };
  const recF2 = recorder();
  const beforeF2 = recF2.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "research_unit_synthesis", messages: [{ role: "user", content: "x" }] },
    { ...ON, openrouterFetch, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f2", agent_id: "fabric-check" } },
  );
  plan = { status: 200 };
  const f2 = recF2.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF2).at(-1)?.row;
  const f2r = routeOf(f2);
  ok(f2?.status === "error" && f2?.provider === "openrouter" && f2?.error_class === "http_503"
    && f2r.route_served_provider === "openrouter" && f2r.route_fallback === false,
    `F2 a failed Auto leg's error row keeps its projected route and the provider's own error class (${JSON.stringify(f2r)})`);

  // F3 — the judge pin records pinned_served (preserved carve-out; owner decision pending).
  const recF3 = recorder();
  const beforeF3 = recF3.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await fabric.fabricCompletion(
    { cognitive_class: "cheap", job: "rubric_judge_v3", messages: [{ role: "user", content: "x" }] },
    { ...ON, openrouterFetch, pinned: { tier: "reasoning" }, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f3", agent_id: "fabric-check" } },
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
    { openrouterFetch, pinned: { tier: "reasoning" }, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f3b", agent_id: "fabric-check" } },
  );
  anthropicPlan = { status: 200 };
  const f3b = recF3b.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF3b).at(-1)?.row;
  ok(f3b?.status === "error" && routeOf(f3b).route_reason === "pinned_failed" && routeOf(f3b).route_served_provider === undefined,
    `F3b a pinned leg's error row records pinned_failed with no served keys (${JSON.stringify(routeOf(f3b))})`);

  // F4 — a failed seam call on the Auto leg (admitted): error row, reason=failed.
  plan = { status: 529, type: "overloaded_error" };
  const recF4 = recorder();
  const beforeF4 = recF4.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "research_unit_synthesis", messages: [{ role: "user", content: "x" }] },
    { ...ON, openrouterFetch, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f4", agent_id: "fabric-check" } },
  );
  plan = { status: 200 };
  const f4 = recF4.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF4).at(-1)?.row;
  const f4r = routeOf(f4);
  ok(f4?.status === "error" && f4?.provider === "openrouter" && f4r.route_served_provider === "openrouter"
    && f4r.route_fallback === false && f4r.route_requested_class === "operational",
    `F4 a failed Auto leg's error row keeps its projected route (${JSON.stringify(f4r)})`);

  // F5 — the STREAMED rows carry the route (drain rows, via the ctx spread).
  const STREAM_F5 = { messages: [{ role: "user", content: "stream this" }], tools: [TOOL], tool_choice: "auto" };
  const drain = async (cls, opts, body = STREAM_F5) => {
    const rec = recorder();
    const before = rec.inserts.filter((i) => i.table === "paige_llm_trace").length;
    const stream = await fabric.fabricChatStream(cls, body, { openrouterFetch, ...opts });
    const reader = stream.body?.getReader();
    while (reader && !(await reader.read()).done) { /* drain */ }
    return rec.inserts.filter((i) => i.table === "paige_llm_trace").slice(before).at(-1)?.row;
  };
  const orRow = await drain("operational", { ...ON, trace: { tenant_id: "8f6c0000-0000-4000-8000-0000000000f5b", agent_id: "fabric-check", job_kind: "chat-tool-loop" } });
  const orr = routeOf(orRow);
  ok(orRow?.provider === "openrouter" && orr.route_served_provider === "openrouter" && orr.route_served_model === "openrouter/auto"
    && orr.route_requested_class === "operational" && orr.route_job === "chat-tool-loop" && orr.route_reason === "served_primary",
    `F5 the streamed Auto drain row carries the route with the caller's job tag (${JSON.stringify(orr)})`);

  // F6 — the classifier's rows carry the route automatically (cheap, turn_classify).
  // It drives REAL admission: lift the pinned kill switch for this one call, then restore it.
  const { classifyTurn } = await import("../../supabase/functions/_shared/paige-turn/classify-call.ts");
  delete ENV.OPENROUTER_CANARY_TENANTS;
  const recF6 = recorder();
  const beforeF6 = recF6.inserts.filter((i) => i.table === "paige_llm_trace").length;
  await classifyTurn("thanks so much", null, { tenant_id: "8f6c0000-0000-4000-8000-0000000000f6", agent_id: "paige-ai-chat", job_kind: "turn-classify" });
  const f6 = recF6.inserts.filter((i) => i.table === "paige_llm_trace").slice(beforeF6).at(-1)?.row;
  const f6r = routeOf(f6);
  ok(f6r.route_requested_class === "cheap" && f6r.route_job === "turn-classify"
    && f6r.route_served_provider === "openrouter" && f6r.route_served_model === "openrouter/auto"
    && f6r.route_reason === "served_primary",
    `F6 the classifier's row carries its route automatically (${JSON.stringify(f6r)})`);
  ENV.OPENROUTER_CANARY_TENANTS = "";

  // F7 — privacy: every route value is a closed code or an id; nothing free-text.
  const allRouteRows = recorder().inserts.filter((i) => i.table === "paige_llm_trace").map((i) => i.row?.metadata).filter((m) => m && "route_reason" in m);
  ok(allRouteRows.length >= 5 && allRouteRows.every((m) => CLOSED_REASON.test(m.route_reason) && CLOSED_CLASS.test(m.route_requested_class)
    && typeof m.route_fallback === "boolean" && !/[^\w.:/-]/.test(String(m.route_job))),
    `F7 every recorded route value is a closed code or an id (${allRouteRows.length} rows checked)`);

  setScenario({});
}


// ── G. THE CUTOVER COMPLETED: production-wide admission, all classes, env-staged ────────────────
// The OpenRouter flag is ON and admission is PRODUCTION-WIDE for ALL THREE classes. The env is the
// staged control (a set list restricts tenants or narrows classes; an explicitly EMPTY tenant value
// is the kill switch). No-spend: the Auto legs here run against the harness recording fake.
{
  const ANY_TENANT = "9a7d0000-0000-4000-8000-0000000000b2";
  const OTHER_TENANT = "8b5c0000-0000-4000-8000-0000000000c3";

  ok(fabric.OPENROUTER_CHAT_ENABLED === true, "G1 the OpenRouter master flag is ON");
  ok(fabric.openRouterCanaryTenants() !== null && fabric.openRouterCanaryTenants().length === 0,
    "G1 the pinned empty cohort is the kill switch for these unattributed drives");

  const admits = (t, c) => fabric.openRouterCohortAdmits(t, c);
  ENV.OPENROUTER_CANARY_TENANTS = "";
  delete ENV.OPENROUTER_CANARY_TENANTS;
  ok(admits(ANY_TENANT, "operational") === true, "G2 ANY well-formed tenant is admitted for operational");
  ok(admits(ANY_TENANT, "cheap") === true && admits(ANY_TENANT, "frontier") === true,
    "G2 the default scope is the COMPLETED owner policy — all three classes admitted");
  ok(admits(null, "operational") === false && admits("not-a-uuid", "operational") === false,
    "G2 unattributed and malformed tenants are never admitted");
  ENV.OPENROUTER_CANARY_CLASSES = "operational";
  ok(admits(ANY_TENANT, "cheap") === false && admits(ANY_TENANT, "frontier") === false,
    "G2 an explicit class scope can NARROW to a subset (a reviewed decision)");
  ENV.OPENROUTER_CANARY_CLASSES = "garbage,frontier";
  ok(admits(ANY_TENANT, "operational") === false && admits(ANY_TENANT, "frontier") === true,
    "G2 an explicit scope REPLACES the default (unknown class tokens ignored, never wider)");
  ENV.OPENROUTER_CANARY_CLASSES = "garbage,,";
  ok(admits(ANY_TENANT, "operational") === true && admits(ANY_TENANT, "cheap") === true && admits(ANY_TENANT, "frontier") === true,
    "G2 a SET value with ZERO valid tokens falls back to the default (all three)");
  delete ENV.OPENROUTER_CANARY_CLASSES;

  setScenario({});
  anthropicPlan = { status: 200 };
  plan = { status: 200 };
  calls.length = 0;
  const anyStream = await fabric.fabricChatStream("operational", { messages: [{ role: "user", content: "x" }], tools: [TOOL], tool_choice: "auto" },
    { openrouterFetch, trace: { tenant_id: ANY_TENANT, agent_id: "fabric-check", job_kind: "chat" } });
  const readerG = anyStream.body?.getReader();
  while (readerG && !(await readerG.read()).done) { /* drain */ }
  ok(anyStream.ok && anyStream.served?.provider === "openrouter" && anyStream.served?.model === "openrouter/auto"
    && calls.every((c) => c.provider === "openrouter"),
    `G3 ANY tenant's operational round serves the Auto leg first (${anyStream.served?.provider}:${anyStream.served?.model})`);
  calls.length = 0;
  const unattributed = await fabric.fabricChatStream("operational", { messages: [{ role: "user", content: "x" }], tools: [TOOL], tool_choice: "auto" },
    { openrouterFetch, trace: { agent_id: "fabric-check", job_kind: "chat" } });
  const readerU = unattributed.body?.getReader();
  while (readerU && !(await readerU.read()).done) { /* drain */ }
  ok(!unattributed.ok && unattributed.served === null && calls.length === 0,
    "G3 unattributed traffic is refused truthfully — never admitted, never a direct provider");
  const cheapCompletion = await fabric.fabricCompletion(
    { cognitive_class: "cheap", job: "turn_classify", messages: [{ role: "user", content: "x" }] },
    { openrouterFetch, trace: { tenant_id: ANY_TENANT, agent_id: "fabric-check" } });
  ok(cheapCompletion.route.served?.provider === "openrouter" && cheapCompletion.route.served?.model === "openrouter/auto",
    "G3 the CLASSIFIER serves the Auto leg first — cheap is admitted under the completed policy");
  const opCompletion = await fabric.fabricCompletion(
    { cognitive_class: "operational", job: "research_unit_synthesis", messages: [{ role: "user", content: "x" }] },
    { openrouterFetch, trace: { tenant_id: ANY_TENANT, agent_id: "fabric-check" } });
  ok(opCompletion.ok && opCompletion.route.served?.provider === "openrouter" && opCompletion.route.served?.model === "openrouter/auto",
    "G3 the completion seam serves the Auto leg for any tenant's operational job");
  calls.length = 0;
  const frontierStream = await fabric.fabricChatStream("frontier", { messages: [{ role: "user", content: "x" }], tools: [TOOL], tool_choice: "auto" },
    { openrouterFetch, trace: { tenant_id: ANY_TENANT, agent_id: "fabric-check", job_kind: "chat" } });
  const readerF = frontierStream.body?.getReader();
  while (readerF && !(await readerF.read()).done) { /* drain */ }
  ok(frontierStream.ok && frontierStream.served?.provider === "openrouter" && frontierStream.served?.model === "openrouter/auto"
    && calls.every((c) => c.provider === "openrouter"),
    `G3 ANY tenant's frontier round serves the Auto leg first (${frontierStream.served?.provider}:${frontierStream.served?.model})`);

  ENV.OPENROUTER_CANARY_TENANTS = OTHER_TENANT.toUpperCase();
  ok(fabric.openRouterCanaryTenants() !== null && admits(ANY_TENANT, "operational") === false && admits(OTHER_TENANT, "operational") === true,
    "G4 a set env cohort RESTRICTS to it, case-insensitively (staged rollout)");
  ENV.OPENROUTER_CANARY_TENANTS = "";
  ok(fabric.openRouterCanaryTenants() !== null && fabric.openRouterCanaryTenants().length === 0 && admits(ANY_TENANT, "operational") === false,
    "G4 an explicitly EMPTY cohort admits NOBODY — the kill switch, effective on the next call (no deploy)");
  delete ENV.OPENROUTER_CANARY_TENANTS;
  ok(fabric.openRouterCanaryTenants() === null && admits(ANY_TENANT, "operational") === true,
    "G4 clearing the env RESTORES production-wide (unsetting is NOT the kill switch)");

  setScenario({});
}
// Trusted in-process authority must be current after budget reads and before
// every provider leg. Refusal/throw is not a provider failure or fallback reason.
{
  setScenario({}); plan = { status: 200 }; anthropicPlan = { status: 200 };
  const request = { cognitive_class: "operational", job: "thread_summary_fold", max_tokens: 2048, messages: [{ role: "user", content: "fold" }] };
  for (const [name, gate] of [["false", async () => false], ["throw", () => { throw new Error("synthetic authority unavailable"); }], ["rejection", async () => { throw new Error("synthetic rejected authority"); }]]) {
    calls.length = 0;
    const trace = { agent_id: "fabric-scope-check" };
    const r = await fabric.fabricCompletion(request, { ...ON, openrouterFetch, trace, beforeProviderAttempt: gate });
    ok(!r.ok && r.error?.failure === "caller_refused" && calls.length === 0 && r.route.served === null,
      `H1 authority ${name} prevents every provider leg, never falls back`);
    ok(trace.fabric_route === null && r.route.reason === "failed", `H1 authority ${name} clears stale route projection`);
  }
  let gates = 0; calls.length = 0; plan = { status: 429, type: "rate_limit_error" };
  const refused = await fabric.fabricCompletion(request, { ...ON, openrouterFetch, beforeProviderAttempt: async () => ++gates === 1 });
  ok(!refused.ok && refused.error?.failure === "rate_limit" && gates === 1
    && calls.length === 1 && calls[0].provider === "openrouter", "H2 authority admitted the one leg; its provider failure is named, never a second transport");
  gates = 0; calls.length = 0; plan = { status: 200 };
  const allowed = await fabric.fabricCompletion(request, { ...ON, openrouterFetch, beforeProviderAttempt: async () => { gates++; return true; } });
  ok(allowed.ok && gates === 1 && calls.length === 1 && allowed.route.served?.provider === "openrouter",
    "H2 unchanged authority admits the one Auto leg with one check per provider leg");
}
// The streamed seam must revalidate after its OWN budget and internal awaits.
{
  setScenario({}); plan = { status: 200 }; anthropicPlan = { status: 200 };
  for (const [name, gate] of [
    ['false', async () => false], ['throw', () => { throw new Error('synthetic authority unavailable'); }],
    ['rejection', async () => { throw new Error('synthetic rejected authority'); }],
  ]) {
    const trace = { agent_id: 'stream-authority-check' };
    const r = await run('operational', { ...ON, trace, beforeProviderAttempt: gate });
    ok(!r.s.ok && r.s.served === null && r.calls.length === 0 && r.s.attempts.at(-1)?.failure === 'caller_refused',
      `I1 ${name} refuses before transport and never falls back`);
    ok(trace.fabric_route === null, `I1 ${name} clears projected route without provider fault`);
  }
  let gates = 0;
  let r = await run('operational', { ...ON, beforeProviderAttempt: async () => { gates++; return true; } });
  ok(r.s.ok && gates === 1 && r.calls.length === 1 && r.calls[0].provider === 'openrouter', 'I2 unchanged authority admits the Auto leg once');
  plan = { status: 429, type: 'rate_limit_error' }; gates = 0;
  r = await run('operational', { ...ON, beforeProviderAttempt: async () => ++gates === 1 });
  ok(!r.s.ok && gates === 1 && r.calls.length === 1 && r.calls[0].provider === 'openrouter' && r.s.attempts.at(-1)?.failure === 'rate_limit',
    'I2 changed authority after the primary failure is terminal — the provider failure is named, never a second transport');
  gates = 0;
  plan = { status: 200 };
  r = await run('operational', { ...ON, beforeProviderAttempt: async () => { gates++; return true; } });
  ok(r.s.ok && gates === 1 && r.calls.length === 1 && r.s.served?.provider === 'openrouter', 'I2 unchanged authority preserves the proven health admission');
  for (const [name, gateFlip] of [['primary budget', false]]) {
    let current = true; const trace = { tenant_id: '7e5a0000-0000-4000-8000-0000000000f1', agent_id: 'stream-budget-authority' };
    setScenario({ serviceTables: { paige_llm_trace: filters => { if (filters.some(([op, column]) => op === 'select' && column === 'cost_estimate_usd') && (!gateFlip || calls.some(call => call.provider === 'openrouter'))) current = false; return []; } } });
    plan = gateFlip ? { status: 429, type: 'rate_limit_error' } : { status: 200 };
    r = await run('operational', { ...ON, trace, beforeProviderAttempt: async () => current });
    ok(!r.s.ok && r.s.attempts.at(-1)?.failure === 'caller_refused' && trace.fabric_route === null
      && r.calls.length === (gateFlip ? 1 : 0) && r.calls.every(call => call.provider === 'openrouter'),
      `I3 scope flip in ${name} refuses the next actual transport`);
  }
  setScenario({}); plan = { status: 200 };
}
// A successful HTTP open is not a successful model acquisition. A proven provider
// failure before ANY semantic output interrupts the turn (no second transport exists).
{
  setScenario({}); anthropicPlan = { status: 200 };
  const created = { type: 'response.created', response: { status: 'in_progress' } };
  const failed = (code) => ({ type: 'response.failed', response: {
    status: 'failed', error: { code, message: 'Synthetic provider failure.' },
  } });
  for (const [code, expected] of [
    ['insufficient_quota', 'billing'], ['credit_balance_exhausted', 'billing'], ['rate_limit_exceeded', 'rate_limit'],
    ['model_not_found', 'model_unavailable'], ['invalid_api_key', 'auth_config'],
  ]) {
    let gates = 0, opens = 0;
    const r = await run('frontier', { ...ON,
      beforeProviderAttempt: async () => { gates++; return true; },
      openrouterFetch: async () => { opens++; return new Response(sse([created, failed(code)])); },
    });
    ok(!r.s.ok && r.s.served === null && opens === 1 && gates === 1
      && realAttempt(r.s.attempts)?.failure === expected && r.runnable.length === 0,
      `J1 presemantic HTTP200 ${code} is named (${expected}) and the turn is interrupted, never replayed`);
  }
  for (const semantic of [
    { type: 'response.output_text.delta', delta: 'Already received.' },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc-j2', call_id: 'call-j2', name: 'crm_contact_lookup' } },
    { type: 'response.refusal.delta', delta: 'Refused.' },
    { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs-j2', encrypted_content: 'synthetic-opaque', summary: [] } },
    { type: 'response.future_unknown_event' },
    { type: 'response.created', response: { status: 'in_progress', output: [{ type: 'reasoning', id: 'rs-hidden' }] } },
    { type: 'response.failed', response: { status: 'failed', error: { code: 'insufficient_quota' }, output: [{ type: 'function_call', call_id: 'call-hidden' }] } },
  ]) {
    const r = await run('frontier', { ...ON,
      openrouterFetch: async () => new Response(sse([created, semantic, failed('insufficient_quota')])),
    });
    ok(r.s.served?.provider === 'openrouter' && r.calls.length === 0 && r.runnable.length === 0,
      `J2 ${semantic.type} prevents replay even after a provider failure`);
  }
  for (const terminal of [failed('unrecognised_code'), failed('credit_balance_exhausted_extra'),
    { type: 'response.failed', response: { status: 'completed', error: { code: 'insufficient_quota' } } },
  ]) {
    const r = await run('frontier', { ...ON, openrouterFetch: async () => new Response(sse([created, terminal])) });
    ok(!r.s.ok && r.s.served === null && r.calls.length === 0
      && r.s.attempts.at(-1)?.failure === 'unknown', 'J3 unknown/contradictory terminal is refused, never replayed');
  }
  let gates = 0;
  const refused = await run('frontier', { ...ON, beforeProviderAttempt: async () => ++gates === 1,
    openrouterFetch: async () => new Response(sse([created, failed('insufficient_quota')])),
  });
  ok(!refused.s.ok && gates === 1 && refused.calls.length === 0
    && refused.s.attempts.at(-1)?.failure === 'billing', 'J4 authority was current for the one leg; its failure is named and nothing is replayed');

  let creditGates = 0;
  const refusedCredits = await run('frontier', { ...ON, beforeProviderAttempt: async () => ++creditGates === 1,
    openrouterFetch: async () => new Response(sse([created, failed('credit_balance_exhausted')])),
  });
  ok(!refusedCredits.s.ok && creditGates === 1 && refusedCredits.calls.length === 0
    && refusedCredits.s.attempts.at(-1)?.failure === 'billing',
    'J4 credit exhaustion is named on the one leg; authority was current and nothing is replayed');
  for (const semantic of [
    { type: 'response.output_text.delta', delta: 'Already received.' },
    { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc-credit', call_id: 'call-credit', name: 'crm_contact_lookup' } },
    { type: 'response.refusal.delta', delta: 'Refused.' },
    { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs-credit', encrypted_content: 'synthetic-opaque', summary: [] } },
    { type: 'response.future_unknown_event' },
  ]) {
    const r = await run('frontier', { ...ON,
      openrouterFetch: async () => new Response(sse([created, semantic, failed('credit_balance_exhausted')])),
    });
    ok(r.s.served?.provider === 'openrouter' && r.calls.length === 0 && r.runnable.length === 0,
      `J4 credit exhaustion after ${semantic.type} cannot replay received or uncertain work`);
  }
  const cancelled = new AbortController(); cancelled.abort(); let opens = 0;
  const aborted = await fabric.fabricChatStream('frontier', BODY, { ...ON, signal: cancelled.signal,
    openrouterFetch: async () => { opens++; return new Response(sse([created, failed('insufficient_quota')])); },
  });
  if (aborted.body) await aborted.body.cancel();
  ok(!aborted.ok && aborted.served === null && opens === 0
    && aborted.attempts.at(-1)?.failure === 'aborted', 'J5 an already cancelled caller starts no provider leg');

  let entered, upstreamCancelled = 0, actualSignal;
  const opened = new Promise(resolve => { entered = resolve; });
  const controller = new AbortController(); calls = [];
  const acquiring = fabric.fabricChatStream('frontier', BODY, { ...ON, signal: controller.signal,
    openrouterFetch: async (_url, init) => {
      actualSignal = init.signal; entered();
      return new Response(new ReadableStream({
        start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify(created)}\n\n`)); },
        cancel() { upstreamCancelled++; },
      }));
    },
  });
  let settled = false; void acquiring.then(() => { settled = true; });
  await opened; await Promise.resolve(); await Promise.resolve();
  ok(!settled, 'J6 metadata alone does not claim a served business answer');
  controller.abort(); const interrupted = await acquiring;
  ok(!interrupted.ok && interrupted.served === null && actualSignal.aborted
    && upstreamCancelled === 1 && calls.length === 0 && interrupted.attempts.at(-1)?.failure === 'aborted',
    'J6 caller cancellation during acquisition cancels upstream and starts no replay');

  const bytes = enc.encode([created, failed('insufficient_quota')]
    .map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  const fragmented = await run('frontier', { ...ON, openrouterFetch: async () => new Response(new ReadableStream({
    start(c) { for (const b of bytes) c.enqueue(Uint8Array.of(b)); c.close(); },
  })) });
  ok(!fragmented.s.ok && fragmented.s.served === null && realAttempt(fragmented.s.attempts)?.failure === 'billing',
    'J7 one-byte fragmented CRLF terminal failure is named, never replayed');

  const recoveredError = await run('frontier', { ...ON,
    openrouterFetch: async () => new Response(sse([created, { type: 'error', error: { type: 'api_error' } }])),
  });
  ok(!recoveredError.s.ok && realAttempt(recoveredError.s.attempts)?.failure === 'provider_outage',
    'J8 an explicit presemantic provider error uses the incumbent failure classifier');

  setScenario({});
  const trace = { tenant_id: '7e5a0000-0000-4000-8000-0000000000f3', agent_id: 'fabric-check', job_kind: 'chat' };
  const beforeJ9 = recorder().inserts.filter(r => r.table === 'paige_llm_trace').length;
  const traced = await run('frontier', { ...ON, trace,
    openrouterFetch: async () => new Response(sse([created, failed('insufficient_quota')])),
  });
  for (let i = 0; i < 30 && recorder().inserts.filter(r => r.table === 'paige_llm_trace').length <= beforeJ9; i++)
    await new Promise(resolve => setTimeout(resolve, 0));
  const rows = recorder().inserts.filter(r => r.table === 'paige_llm_trace').slice(beforeJ9).map(r => r.row);
  const primary = rows.find(r => r.provider === 'openrouter');
  ok(!traced.s.ok && rows.length === 1 && primary?.status === 'error'
    && primary.metadata?.route_served_provider === 'openrouter' && primary.metadata?.route_fallback === false
    && trace.fabric_route?.reason === 'failed' && trace.fabric_route?.served_provider == null,
    `J9 the failed leg's trace retains its own provider/route while the caller's ctx carries the served-null failure route (${rows.length} rows)`);
}
// Cancellation before HTTP open is the caller's state, never a provider fault.
{
  setScenario({});
  const ctrl = new AbortController(); let opens = 0;
  const r = await run('frontier', { ...ON, signal: ctrl.signal,
    openrouterFetch: async () => { opens++; ctrl.abort(); throw new DOMException('Synthetic cancellation.', 'AbortError'); },
  });
  ok(!r.s.ok && r.s.served === null && opens === 1 && r.calls.length === 0
    && r.s.attempts.at(-1)?.failure === 'aborted', 'J11 pre-header cancellation is reported as aborted with no replay');
  const atAuthority = new AbortController(); opens = 0;
  const refused = await run('frontier', { ...ON, signal: atAuthority.signal,
    beforeProviderAttempt: async () => { atAuthority.abort(); return false; },
    openrouterFetch: async () => { opens++; throw new Error('CANCELLED_DISPATCH_FORBIDDEN'); },
  });
  ok(!refused.s.ok && opens === 0 && refused.calls.length === 0
    && refused.s.attempts.at(-1)?.failure === 'aborted', 'J11 cancellation during authority check is not misreported as an authority refusal');
}
// The five incumbent Root entry points must actually forward cancellation;
// an adapter-only signal test cannot establish that the owner can interrupt.
{
  const { default: ts } = await import('typescript');
  const source = readFileSync(new URL('../../supabase/functions/paige-ai-chat/index.ts', import.meta.url), 'utf8');
  const root = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const sites = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(root) === 'fabricChatStream') sites.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  ok(sites.length === 5, 'J10 preserves the five original streaming call sites');
  ok(sites.every(call => ts.isObjectLiteralExpression(call.arguments[2]) && call.arguments[2].properties.some(
    p => ts.isPropertyAssignment(p) && p.name.getText(root) === 'signal' && p.initializer.getText(root) === 'req.signal')),
    'J10 every original Root stream forwards its true request signal');
}
// The private cache contract on the OpenRouter wire: PAIGE never sends a prompt_cache_key to
// OpenRouter (the adapter omits it by design; OpenRouter owns session stickiness server-side),
// so a trusted partition can never leak onto the wire — but authority, cancellation and hashing
// semantics around the cache seam are still revalidated before any provider attempt.
{
  plan = { status: 200 };
  const trace = { tenant_id: '00000000-0000-4000-8000-000000000001', agent_id: 'fabric-cache-check',
    prompt_cache_scope: { actor_id: '00000000-0000-4000-8000-000000000011',
      tenant_id: '00000000-0000-4000-8000-000000000001', working_context_tenant_id: '00000000-0000-4000-8000-000000000001' } };
  let checked = 0;
  const a = await run('operational', { ...ON, trace, beforeProviderAttempt: () => { checked++; return true; } });
  ok(a.s.ok && a.calls[0].provider === 'openrouter' && checked === 1
    && !a.calls[0].req.prompt_cache_key, 'K1 the Auto leg never carries a prompt_cache_key (OpenRouter owns session stickiness)');
  const b = await run('operational', { ...ON, trace: { ...trace,
    prompt_cache_scope: { ...trace.prompt_cache_scope, actor_id: '00000000-0000-4000-8000-000000000012' } } });
  ok(b.s.ok && !b.calls[0].req.prompt_cache_key, 'K2 a different admitted actor never leaks any cache group onto the wire');
  const refused = await run('operational', { ...ON, trace, beforeProviderAttempt: () => false });
  ok(!refused.s.ok && refused.calls.length === 0 && refused.s.attempts.at(-1)?.failure === 'caller_refused',
    'K3 cache-key preparation never bypasses current authority or triggers replay');
  calls = [];
  const r = await fabric.fabricCompletion({ cognitive_class: 'operational', job: 'thread_summary_fold',
    messages: BODY.messages }, { ...ON, trace, openrouterFetch, beforeProviderAttempt: () => true });
  ok(r.ok && calls.length === 1 && !calls[0].req.prompt_cache_key,
    'K4 the nonstreaming Auto leg keeps the same no-cache-key contract');
  const digest = crypto.subtle.digest;
  try {
    let current = true;
    crypto.subtle.digest = async function(...args) {
      const hash = await digest.apply(this, args); current = false; return hash;
    };
    const revoked = await run('operational', { ...ON, trace, beforeProviderAttempt: () => current });
    ok(!revoked.s.ok && revoked.calls.length === 0 && revoked.s.attempts.at(-1)?.failure === 'caller_refused',
      'K5 revocation DURING the real hashing await is revalidated before any provider attempt');
    const cancel = new AbortController();
    crypto.subtle.digest = async function(...args) {
      const hash = await digest.apply(this, args); cancel.abort(); return hash;
    };
    calls = [];
    const aborted = await run('operational', { ...ON, trace, signal: cancel.signal });
    ok(!aborted.s.ok && calls.length === 0 && aborted.s.attempts.at(-1)?.failure === 'aborted',
      'K6 cancellation during hashing with no callback causes zero provider attempts');
    crypto.subtle.digest = async () => { throw new Error('synthetic hash unavailable'); };
    const unavailable = await run('operational', { ...ON, trace });
    ok(unavailable.s.ok && unavailable.calls.length === 1 && unavailable.calls[0].provider === 'openrouter',
      'K7 hash failure preserves inference on the Auto leg (no cache group could join anyway)');
  } finally { crypto.subtle.digest = digest; }
}
console.log(`fabric-check: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
