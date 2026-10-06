/**
 * The Claude reasoning tier — ONE seam, graded by what actually leaves the process.
 *
 * Drives the REAL `_shared/claude.ts` and `_shared/model-router.ts` under the repo's Node loader
 * (scripts/client-memory-authz/register.mjs) with `fetch` replaced by a recording fake Anthropic.
 * Nothing here re-implements the seam: every assertion reads either the request body that would
 * have gone to api.anthropic.com or the `paige_llm_trace` row that reached `.insert()`.
 *
 * It answers four questions, each of which a model migration can get wrong silently:
 *
 *   1. IDENTITY — does every entry point (callClaude, chatCompletionCompat, gatewayCompat streamed and
 *      non-streamed, routedChatCompletion) resolve the reasoning tier through `CLAUDE_REASONING`, with
 *      the classification tier untouched?
 *   2. EQUIVALENCE — apart from `model`, is every request body byte-identical to the frozen snapshot
 *      taken on the commit before the switch (`fixtures/request-bodies.json`)? A model swap that also
 *      changes sampling, tool_choice, caching or adds a thinking/effort field is not a model swap.
 *   3. COMPATIBILITY — no request on the reasoning tier carries a field the current reasoning model
 *      rejects (non-default sampling, forced tool_choice, `thinking.type: disabled|enabled`).
 *   4. TRACE TRUTH — every trace row names the model that actually served the call: the provider's
 *      echoed id on success, the resolved Claude id on failure — never null and never the legacy
 *      gateway label (`google/gemini-…`) the caller happened to pass.
 *
 * Run: `npm run test:reasoning-tier`. `REASONING_TIER_SNAPSHOT_OUT=<path>` writes the snapshot
 * instead of comparing against it (used once, on the base commit, to freeze the equivalence oracle).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { setScenario, recorder } from "../client-memory-authz/fake-supabase.mjs";

const SNAPSHOT_PATH = new URL("./fixtures/request-bodies.json", import.meta.url);
const SNAPSHOT_OUT = process.env.REASONING_TIER_SNAPSHOT_OUT || "";

globalThis.Deno = {
  env: {
    get: (k) => ({
      ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key",
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    })[k] ?? undefined,
  },
};

// ── the recording fake Anthropic ────────────────────────────────────────────────────────────
// The provider echoes a CONCRETE id that can differ from the requested alias — exactly what
// production shows for Haiku (requested `claude-haiku-4-5`, served `claude-haiku-4-5-20251001`).
// That difference is what lets a check tell "traced the served model" from "traced the request".
const SERVED = { "claude-haiku-4-5": "claude-haiku-4-5-20251001" };
const served = (m) => SERVED[m] ?? m;
const calls = [];
let failNext = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.anthropic.com/")) {
    if (realFetch && !u.startsWith("https://")) return realFetch(url, init);
    throw new Error(`reasoning-tier-check: unexpected network call to ${u}`);
  }
  const body = JSON.parse(init.body);
  calls.push(body);
  if (failNext > 0) {
    failNext--;
    return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "rejected" } }), {
      status: 400, headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  }
  const usage = { input_tokens: 7, output_tokens: 11, cache_read_input_tokens: 4096, cache_creation_input_tokens: 128 };
  if (body.stream) {
    const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    const sse = [
      ev({ type: "message_start", message: { id: "msg_s", model: served(body.model), usage: { ...usage, output_tokens: 1 } } }),
      ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "streamed" } }),
      ev({ type: "content_block_stop", index: 0 }),
      ev({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 11 } }),
      ev({ type: "message_stop" }),
    ].join("");
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  return new Response(JSON.stringify({
    id: "msg_n", type: "message", role: "assistant", model: served(body.model),
    content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage,
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const claude = await import("../../supabase/functions/_shared/claude.ts");
const router = await import("../../supabase/functions/_shared/model-router.ts");
const { assertModelAllowed } = await import("../../supabase/functions/_shared/model-allowlist.ts");
const { estimateTokenCostUsd } = await import("../../supabase/functions/_shared/token-pricing.ts");
const { CLAUDE_REASONING, CLAUDE_CLASSIFICATION } = claude;

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log(`  FAIL  ${name}`); } };

const lastCall = () => calls[calls.length - 1];
async function drain(stream) {
  if (!stream) return "";
  const reader = stream.getReader();
  let s = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; s += new TextDecoder().decode(value); }
  return s;
}
/** The trace rows inserted since `from`; the write is detached, so yield until it lands. */
async function tracesSince(from, want = 1) {
  for (let i = 0; i < 50 && recorder().inserts.filter((x) => x.table === "paige_llm_trace").length < from + want; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  return recorder().inserts.filter((x) => x.table === "paige_llm_trace").slice(from).map((x) => x.row);
}
const traceCount = () => recorder().inserts.filter((x) => x.table === "paige_llm_trace").length;

setScenario({});
const bodies = {}; // case name → the request body, for the equivalence snapshot

const TOOL = { type: "function", function: { name: "crm_contact_lookup", description: "Find a contact", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } };
const PDF = "data:application/pdf;base64,JVBERi0xLjQK";

console.log("0. the canonical constants");
ok(CLAUDE_REASONING === "claude-sonnet-5-5", `0.1 CLAUDE_REASONING is claude-sonnet-5-5 (got ${CLAUDE_REASONING})`);
ok(CLAUDE_CLASSIFICATION === "claude-haiku-4-5", `0.2 the classification tier is untouched (got ${CLAUDE_CLASSIFICATION})`);

console.log("1. callClaude — the direct path (default tier = reasoning)");
{
  await claude.callClaude({ messages: [{ role: "user", content: "hi" }], system: "sys", temperature: 0.2, maxTokens: 900 });
  bodies.callClaude_default = lastCall();
  ok(lastCall().model === CLAUDE_REASONING, "1.1 default tier sends CLAUDE_REASONING");
  ok(!("temperature" in lastCall()), "1.2 temperature is stripped on the reasoning tier");
  await claude.callClaude({ messages: [{ role: "user", content: "hi" }], tier: "classification", temperature: 0.2 });
  bodies.callClaude_classification = lastCall();
  ok(lastCall().model === CLAUDE_CLASSIFICATION, "1.3 classification tier sends Haiku");
  ok(lastCall().temperature === 0.2, "1.4 Haiku still receives temperature (behavior preserved)");

  const forcedTool = { name: "extract", description: "x", input_schema: { type: "object", properties: {} } };
  await claude.callClaude({ messages: [{ role: "user", content: "hi" }], tools: [forcedTool], toolChoice: { type: "tool", name: "extract" } });
  ok(JSON.stringify(lastCall().tool_choice) === JSON.stringify({ type: "auto" }), "1.6 a forced tool_choice degrades to auto on the reasoning tier (it 400s there)");
  await claude.callClaude({ messages: [{ role: "user", content: "hi" }], tier: "classification", tools: [forcedTool], toolChoice: { type: "tool", name: "extract" } });
  ok(lastCall().tool_choice?.type === "tool", "1.7 …and is preserved on Haiku, which accepts it");

  const before = traceCount();
  await claude.callClaude({ messages: [{ role: "user", content: "hi" }], tier: "classification", trace: { agent_id: "check" } });
  const [row] = await tracesSince(before);
  ok(row?.model === "claude-haiku-4-5-20251001", `1.5 an opted-in trace names the SERVED model (got ${row?.model})`);
}

console.log("2. chatCompletionCompat — legacy labels resolve through the tier, never through the label");
{
  await claude.chatCompletionCompat({ model: "google/gemini-2.5-pro", messages: [{ role: "system", content: "S" }, { role: "user", content: "q" }], tools: [TOOL], tool_choice: { type: "function", function: { name: "crm_contact_lookup" } }, temperature: 0.4, max_tokens: 1200 });
  bodies.compat_pro_tools = lastCall();
  ok(lastCall().model === CLAUDE_REASONING, "2.1 'pro' label → CLAUDE_REASONING");
  ok(JSON.stringify(lastCall().tool_choice) === JSON.stringify({ type: "auto" }), "2.2 a forced OpenAI tool_choice is coerced to auto (forced tool use 400s on the reasoning model)");
  ok(!("temperature" in lastCall()), "2.3 temperature stripped on the reasoning tier");

  await claude.chatCompletionCompat({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content: "q" }], temperature: 0.4 });
  bodies.compat_flash = lastCall();
  ok(lastCall().model === CLAUDE_CLASSIFICATION, "2.4 'flash' label → Haiku");

  await claude.chatCompletionCompat({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content: [{ type: "text", text: "read this" }, { type: "image_url", image_url: { url: PDF } }] }] });
  bodies.compat_flash_pdf = lastCall();
  ok(lastCall().model === CLAUDE_REASONING, "2.5 a PDF turn on a cheap label is upgraded to CLAUDE_REASONING");
  ok(lastCall().messages[0].content.some((b) => b.type === "document"), "2.6 the PDF reaches the model as a document block");

  await claude.chatCompletionCompat({ messages: [{ role: "user", content: "json please" }], response_format: { type: "json_object" } }, "reasoning");
  bodies.compat_json = lastCall();
  ok(/single valid JSON value/.test(lastCall().system), "2.7 JSON mode still rides the system prompt (no prefill — 400s on the reasoning model)");
  ok(lastCall().messages[lastCall().messages.length - 1].role === "user", "2.8 the request never ends on an assistant turn");
}

console.log("3. gatewayCompat — the streamed Chat front door");
{
  const before = traceCount();
  const r = await claude.gatewayCompat("anthropic", { body: JSON.stringify({ model: "google/gemini-2.5-pro", messages: [{ role: "system", content: "persona" }, { role: "user", content: "look up Ana" }], tools: [TOOL], tool_choice: "auto", stream: true }) }, { agent_id: "paige-ai-chat", job_kind: "chat" });
  bodies.gateway_stream_reasoning = lastCall();
  const sse = await drain(r.body);
  ok(r.ok && /streamed/.test(sse), "3.1 the stream translates to OpenAI-shaped SSE");
  ok(lastCall().model === CLAUDE_REASONING, "3.2 substantive Chat streams on CLAUDE_REASONING");
  ok(JSON.stringify(lastCall().cache_control) === JSON.stringify({ type: "ephemeral" }), "3.3 automatic prompt caching is still requested");
  ok(!("thinking" in lastCall()) && !("output_config" in lastCall()), "3.4 no thinking/effort field is added — the model's own default stands");
  const [row] = await tracesSince(before);
  ok(row?.model === CLAUDE_REASONING, `3.5 the streamed trace names the served model (got ${row?.model})`);
  ok(row?.cache_read_input_tokens === 4096 && row?.cache_creation_input_tokens === 128, "3.6 cache read/create counts reach the trace");
  ok(row?.tokens_in === 7, "3.7 tokens_in stays the UNCACHED remainder — cache reads are never folded in");

  const before2 = traceCount();
  const r2 = await claude.gatewayCompat("anthropic", { body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content: "hi" }], stream: true }) }, { agent_id: "paige-ai-chat", job_kind: "chat" });
  bodies.gateway_stream_classification = lastCall();
  await drain(r2.body);
  const [row2] = await tracesSince(before2);
  ok(row2?.model === "claude-haiku-4-5-20251001", `3.8 a streamed trace records the provider's served id, not the requested alias (got ${row2?.model})`);
}

console.log("4. gatewayCompat — non-streamed, success and failure");
{
  const before = traceCount();
  await claude.gatewayCompat("anthropic", { body: JSON.stringify({ model: "google/gemini-2.5-pro", messages: [{ role: "user", content: "summarise" }] }) }, { agent_id: "paige-ai-chat", job_kind: "chat-close" });
  bodies.gateway_nonstream_reasoning = lastCall();
  const [row] = await tracesSince(before);
  ok(row?.model === CLAUDE_REASONING, `4.1 success trace names the served model (got ${row?.model})`);

  failNext = 1;
  const before2 = traceCount();
  const r = await claude.gatewayCompat("anthropic", { body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "user", content: "fold" }] }) }, { agent_id: "paige-ai-chat", job_kind: "thread-summary-fold" });
  ok(r.ok === false && r.status === 400, "4.2 a provider 400 surfaces as a 400");
  const [row2] = await tracesSince(before2);
  ok(row2?.model === CLAUDE_CLASSIFICATION, `4.3 the failure trace names the Claude model it called, never the legacy label (got ${row2?.model})`);
}

console.log("5. routedChatCompletion — Deep Research synthesis / strategist / judge");
{
  const before = traceCount();
  await router.routedChatCompletion("doc_draft", { messages: [{ role: "user", content: "synthesise" }], max_tokens: 900, temperature: 0.2 }, { agent_id: "paige-deep-research" });
  bodies.routed_doc_draft = lastCall();
  ok(lastCall().model === CLAUDE_REASONING, "5.1 doc_draft resolves to CLAUDE_REASONING");
  const [row] = await tracesSince(before);
  ok(row?.model === CLAUDE_REASONING, `5.2 success trace names the served model (got ${row?.model})`);

  failNext = 1;
  const before2 = traceCount();
  let threw = false;
  try { await router.routedChatCompletion("doc_draft", { messages: [{ role: "user", content: "synthesise" }] }, { agent_id: "paige-deep-research" }); } catch { threw = true; }
  ok(threw, "5.3 a provider 400 still throws to the caller");
  const [row2] = await tracesSince(before2);
  ok(row2?.model === CLAUDE_REASONING, `5.4 the failure trace names the model that rejected it, not null (got ${row2?.model})`);
}

console.log("6. the request shapes the reasoning model rejects never leave the seam");
{
  const reasoningBodies = calls.filter((b) => b.model === CLAUDE_REASONING);
  ok(reasoningBodies.length >= 6, `6.0 the drive exercised the reasoning tier (${reasoningBodies.length} calls)`);
  ok(reasoningBodies.every((b) => !("temperature" in b) && !("top_p" in b) && !("top_k" in b)), "6.1 no sampling parameter");
  ok(reasoningBodies.every((b) => !b.tool_choice || b.tool_choice.type === "auto" || b.tool_choice.type === "none"), "6.2 no forced tool_choice");
  ok(reasoningBodies.every((b) => !b.thinking || !["disabled", "enabled"].includes(b.thinking.type)), "6.3 no thinking.type disabled|enabled");
}

console.log("7. the allow-list and the price derive from the seam");
{
  let allowed = true;
  try { assertModelAllowed("anthropic", CLAUDE_REASONING); } catch { allowed = false; }
  ok(allowed, "7.1 the current reasoning id is on the allow-list");
  let staleAllowed = true;
  try { assertModelAllowed("anthropic", "claude-sonnet-5"); } catch { staleAllowed = false; }
  ok(!staleAllowed, "7.2 the retired id is NOT — an override naming it would run the new model under the old label");
  ok(estimateTokenCostUsd("anthropic", CLAUDE_REASONING, 1000, 1000) === estimateTokenCostUsd("anthropic", "claude-sonnet-5", 1000, 1000),
     "7.3 the new id prices on the same Sonnet row as the old one (no unknown-model fallback)");
}

console.log("8. equivalence — every body matches the pre-switch snapshot except `model`");
{
  const normalise = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "model" ? "<MODEL>" : v)));
  const now = Object.fromEntries(Object.entries(bodies).map(([k, v]) => [k, normalise(v)]));
  if (SNAPSHOT_OUT) {
    writeFileSync(SNAPSHOT_OUT, JSON.stringify(now, null, 2) + "\n");
    console.log(`  wrote snapshot → ${SNAPSHOT_OUT}`);
  } else {
    const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    ok(Object.keys(snap).sort().join() === Object.keys(now).sort().join(), "8.0 the same cases were driven as on the base commit");
    for (const k of Object.keys(snap)) {
      ok(JSON.stringify(now[k]) === JSON.stringify(snap[k]), `8.${k} body is byte-identical to the pre-switch body apart from model`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
