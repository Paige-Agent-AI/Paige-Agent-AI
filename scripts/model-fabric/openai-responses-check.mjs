/**
 * The OpenAI Responses adapter (INT-334 R2), graded by what would leave the process.
 *
 * Drives the REAL `_shared/openai-responses.ts` under the repo's Node loader with an injected recording
 * transport (no network) and the recording fake Supabase for trace rows. Every assertion reads either
 * the request body that would have gone to /v1/responses, the chat-shaped result/SSE PAIGE's readers
 * consume, or the `paige_llm_trace` row that reached `.insert()`.
 *
 * It answers five questions:
 *   1. GOVERNANCE — are provider-native tools (web search, MCP, computer use, file search, …) refused
 *      BEFORE any network call or key read? Is a forced tool_choice never sent? Is `store` false?
 *   2. TRANSLATION — does the chat shape PAIGE builds become the right Responses input (instructions,
 *      input_text/input_image, function_call / function_call_output by call_id, json_schema)?
 *   3. RESULT SHAPE — does a Responses result (and SSE) come back in the exact chat shape the Claude seam
 *      emits (role chunk, content deltas, tool_calls index/id/name then argument deltas, finish, [DONE])?
 *   4. HONESTY — HTTP errors, `response.failed`, an `error` event and a truncated stream are traced as
 *      errors and never finish as a clean success; a missing key is NeedsConfigError with no call made.
 *   5. TRACE + PRICE — served model (not requested), uncached input vs cached tokens, stop reason, and
 *      an explicit GPT-6 price row (never the gpt-4o default).
 *
 * Run: `npm run test:openai-responses`.
 */
import { setScenario, recorder } from "../client-memory-authz/fake-supabase.mjs";

const ENV = {
  OPENAI_API_KEY: "sk-test-not-a-real-key",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};
globalThis.Deno = { env: { get: (k) => ENV[k] ?? undefined, toObject: () => ({ ...ENV }) } };
globalThis.fetch = async (url) => { throw new Error(`openai-responses-check: unexpected global network call to ${url}`); };

const ad = await import("../../supabase/functions/_shared/openai-responses.ts");
const { assertModelAllowed } = await import("../../supabase/functions/_shared/model-allowlist.ts");
const { estimateTokenCostUsd } = await import("../../supabase/functions/_shared/token-pricing.ts");
const models = await import("../../supabase/functions/_shared/openai-models.ts");
const { NeedsConfigError } = await import("../../supabase/functions/_shared/provider-types.ts");

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log(`  FAIL  ${name}`); } };
setScenario({});

const traceCount = () => recorder().inserts.filter((x) => x.table === "paige_llm_trace").length;
async function tracesSince(from, want = 1) {
  for (let i = 0; i < 50 && traceCount() < from + want; i++) await new Promise((r) => setTimeout(r, 0));
  return recorder().inserts.filter((x) => x.table === "paige_llm_trace").slice(from).map((x) => x.row);
}
async function drain(stream) {
  const reader = stream.getReader();
  let s = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; s += new TextDecoder().decode(value); }
  return s;
}
const frames = (sse) => sse.split("\n\n").map((f) => f.trim()).filter(Boolean).map((f) => f.replace(/^data:\s*/, ""));

/** A recording transport. `respond(body)` returns a Response. */
function transport(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers, body: JSON.parse(init.body) });
    return respond(calls[calls.length - 1].body);
  };
  fn.calls = calls;
  return fn;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const sse = (events) => new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });

const TOOL = { type: "function", function: { name: "crm_contact_lookup", description: "Find a contact", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } };
const CONVO = [
  { role: "system", content: "You are PAIGE." },
  { role: "system", content: "Tenant context." },
  { role: "user", content: [{ type: "text", text: "Who is Acme's contact?" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }] },
  { role: "assistant", content: "Looking.", tool_calls: [{ id: "call_1", type: "function", function: { name: "crm_contact_lookup", arguments: "{\"q\":\"Acme\"}" } }] },
  { role: "tool", tool_call_id: "call_1", content: "{\"name\":\"Dana\"}" },
];
const TRACE = { tenant_id: "00000000-0000-4000-8000-000000000001", job_kind: "chat", agent_id: "check" };

console.log("0. the canonical constants");
ok(models.OPENAI_CHEAP === "gpt-6-luna" && models.OPENAI_OPERATIONAL === "gpt-6.1-sol" && models.OPENAI_FRONTIER === "gpt-6-astra",
   "0.1 the three GPT-6 ids are the owner-ruled ones");
ok(models.OPENAI_EFFORT_BY_CLASS.operational !== "none" && models.OPENAI_EFFORT_BY_CLASS.frontier !== "none",
   "0.2 Sol and Astra never get effort 'none' (they reject it)");

console.log("1. governance — refused before any call");
for (const type of ["web_search", "web_search_preview", "file_search", "mcp", "computer_use_preview", "code_interpreter", "image_generation", "local_shell"]) {
  const t = transport(() => json({}));
  let threw = null;
  try { await ad.responsesCompletion({ messages: [{ role: "user", content: "x" }], tools: [{ type }] }, { model: "gpt-6.1-sol", fetchImpl: t }); }
  catch (e) { threw = e; }
  ok(threw instanceof ad.ProviderToolRefused && t.calls.length === 0, `1.1 ${type} tool refused with no network call`);
}
{
  const t = transport(() => json({}));
  let threw = null;
  try { await ad.responsesCompletion({ messages: [{ role: "user", content: [{ type: "file", file: { file_data: "x" } }] }] }, { model: "gpt-6.1-sol", fetchImpl: t }); }
  catch (e) { threw = e; }
  ok(threw instanceof ad.ProviderToolRefused && t.calls.length === 0, "1.2 an untranslatable content part is refused, never silently dropped");
}
{
  const saved = ENV.OPENAI_API_KEY; delete ENV.OPENAI_API_KEY;
  const t = transport(() => json({}));
  let threw = null;
  try { await ad.responsesCompletion({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t }); }
  catch (e) { threw = e; }
  ENV.OPENAI_API_KEY = saved;
  ok(threw instanceof NeedsConfigError && t.calls.length === 0, "1.3 a missing key is NeedsConfigError and no call is made");
}

console.log("2. translation — chat shape → Responses request");
{
  const req = ad.buildResponsesRequest({ messages: CONVO, tools: [TOOL], tool_choice: { type: "function", function: { name: "crm_contact_lookup" } }, temperature: 0.4, top_p: 0.9 }, { model: "gpt-6.1-sol", effort: "medium" });
  ok(req.store === false, "2.1 store is false");
  ok(Array.isArray(req.include) && req.include.includes("reasoning.encrypted_content"), "2.2 encrypted reasoning is requested so state can round-trip without storage");
  ok(req.instructions === "You are PAIGE.\n\nTenant context.", "2.3 system messages become instructions, in order");
  ok(!("temperature" in req) && !("top_p" in req), "2.4 sampling is never sent to a reasoning model");
  ok(req.tool_choice === "auto", "2.5 a forced tool_choice is coerced to auto (PAIGE never forces through the provider)");
  ok(req.reasoning?.effort === "medium" && req.max_output_tokens === 4096, "2.6 effort set; max_output_tokens defaults to 4096");
  const [u, a1, a2, out] = req.input;
  ok(u.role === "user" && u.content[0].type === "input_text" && u.content[1].type === "input_image" && u.content[1].image_url.startsWith("data:image/png"),
     "2.7 user text and image parts become input_text / input_image");
  ok(a1.role === "assistant" && a1.content[0].type === "output_text" && a1.content[0].text === "Looking.", "2.8 assistant text becomes output_text");
  ok(a2.type === "function_call" && a2.call_id === "call_1" && a2.name === "crm_contact_lookup" && a2.arguments === "{\"q\":\"Acme\"}",
     "2.9 assistant tool_calls become function_call items keyed by call_id");
  ok(out.type === "function_call_output" && out.call_id === "call_1" && out.output === "{\"name\":\"Dana\"}", "2.10 tool results become function_call_output with the same call_id");
  ok(req.tools.length === 1 && req.tools[0].type === "function" && req.tools[0].name === "crm_contact_lookup" && req.tools[0].parameters.required[0] === "q",
     "2.11 function tools map to the Responses function shape");
}
{
  const req = ad.buildResponsesRequest({ messages: [{ role: "user", content: "x" }], tools: [TOOL], tool_choice: "none", max_tokens: 900 }, { model: "gpt-6-luna" });
  ok(req.tool_choice === "none" && req.max_output_tokens === 900 && !("reasoning" in req), "2.12 tool_choice none honoured; max_tokens carried; no effort when unset");
}
{
  const item = { type: "reasoning", id: "rs_1", encrypted_content: "opaque" };
  const same = ad.buildResponsesRequest({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b", paige_provider_items: [item], paige_provider: "openai:gpt-6.1-sol" }, { role: "user", content: "c" }] }, { model: "gpt-6.1-sol" });
  const other = ad.buildResponsesRequest({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b", paige_provider_items: [item], paige_provider: "openai:gpt-6-astra" }, { role: "user", content: "c" }] }, { model: "gpt-6.1-sol" });
  ok(same.input.some((x) => x.type === "reasoning") && !other.input.some((x) => x.type === "reasoning"),
     "2.13 reasoning items replay only to the model that produced them");
}
{
  const req = ad.buildResponsesRequest({ messages: [{ role: "user", content: "x" }], response_format: { type: "json_schema", json_schema: { name: "route", schema: { type: "object" } } } }, { model: "gpt-6-luna" });
  ok(req.text?.format?.type === "json_schema" && req.text.format.name === "route" && req.text.format.strict === true, "2.14 json_schema becomes text.format with strict on");
}

console.log("3. non-streaming result → chat shape + trace");
{
  const from = traceCount();
  const t = transport(() => json({
    id: "resp_1", model: "gpt-6.1-sol-2026-09-01", status: "completed",
    output: [
      { type: "reasoning", id: "rs_1", encrypted_content: "opaque" },
      { type: "message", content: [{ type: "output_text", text: "Dana runs Acme." }] },
      { type: "function_call", call_id: "call_9", name: "crm_contact_lookup", arguments: "{\"q\":\"Dana\"}" },
    ],
    usage: { input_tokens: 1200, output_tokens: 80, input_tokens_details: { cached_tokens: 1000 } },
  }));
  const r = await ad.responsesCompletion({ messages: CONVO, tools: [TOOL] }, { model: "gpt-6.1-sol", effort: "medium", fetchImpl: t }, TRACE);
  const m = r.choices[0].message;
  ok(t.calls.length === 1 && t.calls[0].url.endsWith("/responses") && t.calls[0].headers.authorization === "Bearer sk-test-not-a-real-key", "3.1 one call to /responses with bearer auth");
  ok(m.content === "Dana runs Acme." && m.tool_calls?.[0]?.id === "call_9" && m.tool_calls[0].function.name === "crm_contact_lookup", "3.2 text and tool calls come back in chat shape");
  ok(r.choices[0].finish_reason === "tool_calls" && r.paige_stop.stop_reason === "tool_use", "3.3 a tool call finishes as tool_calls / tool_use");
  ok(m.paige_provider === "openai:gpt-6.1-sol" && m.paige_provider_items?.[0]?.id === "rs_1", "3.4 reasoning items are returned on a distinct field, tagged with the REQUESTED model");
  // The real round trip: this result, fed back as the next round's history, must replay its reasoning even
  // though the provider served a dated id.
  const next = ad.buildResponsesRequest({ messages: [...CONVO, m, { role: "tool", tool_call_id: "call_9", content: "{}" }] }, { model: "gpt-6.1-sol" });
  ok(next.input.some((x) => x.type === "reasoning" && x.id === "rs_1"), "3.4b a completion result replays its reasoning on the next round despite a dated served id");
  ok(r.model === "gpt-6.1-sol-2026-09-01", "3.5 the result names the served model");
  const [row] = await tracesSince(from);
  ok(row?.provider === "openai" && row.model === "gpt-6.1-sol-2026-09-01" && row.status === "success", "3.6 trace: provider openai, the SERVED model, success");
  ok(row?.tokens_in === 200 && row.tokens_out === 80 && row.cache_read_input_tokens === 1000, "3.7 trace: tokens_in is the uncached remainder; cached tokens reported separately");
  ok(row?.metadata?.stop_reason === "tool_use" && row.tenant_id === TRACE.tenant_id, "3.8 trace: stop reason and tenant carried");
  ok(row?.cost_estimate_usd === estimateTokenCostUsd("openai", "gpt-6.1-sol-2026-09-01", 200, 80) && row.cost_estimate_usd === 0.0012,
     "3.9 trace: priced on the Sol row ($2/$10 per MTok), never the gpt-4o default");
}
{
  const t = transport(() => json({ model: "gpt-6-astra", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }], usage: { input_tokens: 5, output_tokens: 9 } }));
  const r = await ad.responsesCompletion({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6-astra", fetchImpl: t });
  ok(r.choices[0].finish_reason === "length" && r.paige_stop.stop_reason === "max_tokens", "3.10 incomplete(max_output_tokens) is reported as max_tokens, not a clean stop");
}
{
  const t = transport(() => json({ model: "gpt-6.1-sol", status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help with that." }] }], usage: { input_tokens: 5, output_tokens: 3 } }));
  const r = await ad.responsesCompletion({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t });
  ok(r.paige_stop.stop_reason === "refusal" && r.choices[0].finish_reason === "content_filter" && r.choices[0].message.content === "",
     "3.11 a refusal is a refusal stop, never presented as an answer");
}
{
  const from = traceCount();
  const t = transport(() => json({ error: { type: "invalid_request_error", code: "model_not_found", message: "no such model" } }, 404));
  let threw = null;
  try { await ad.responsesCompletion({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t }, TRACE); } catch (e) { threw = e; }
  const [row] = await tracesSince(from);
  ok(threw && /404/.test(threw.message), "3.12 an HTTP error throws, never a fabricated result");
  ok(row?.status === "error" && row.error_class === "http_404" && row.model === "gpt-6.1-sol" && /model_not_found/.test(row.error_message ?? ""),
     "3.13 the failure is traced with the requested model and the provider's reason");
}
{
  const from = traceCount();
  const t = transport(() => json({ model: "gpt-6.1-sol", status: "failed", error: { message: "server_error" }, output: [] }));
  let threw = null;
  try { await ad.responsesCompletion({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t }, TRACE); } catch (e) { threw = e; }
  const [row] = await tracesSince(from);
  ok(threw && row?.status === "error" && row.error_class === "response_failed", "3.14 a 200 carrying status:failed is an error, not a success");
}

console.log("4. streaming → the chat-shaped SSE the Claude seam emits");
{
  const from = traceCount();
  const t = transport(() => sse([
    { type: "response.created", response: { model: "gpt-6.1-sol-2026-09-01", status: "in_progress" } },
    { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "rs_2", encrypted_content: "opaque" } },
    { type: "response.output_text.delta", output_index: 1, delta: "Hel" },
    { type: "response.output_text.delta", output_index: 1, delta: "lo" },
    { type: "response.output_item.added", output_index: 2, item: { type: "function_call", call_id: "call_7", name: "crm_contact_lookup", arguments: "" } },
    { type: "response.function_call_arguments.delta", output_index: 2, delta: "{\"q\":" },
    { type: "response.function_call_arguments.delta", output_index: 2, delta: "\"Acme\"}" },
    { type: "response.completed", response: { model: "gpt-6.1-sol-2026-09-01", status: "completed", usage: { input_tokens: 300, output_tokens: 40, input_tokens_details: { cached_tokens: 256 } } } },
  ]));
  const res = await ad.responsesStream({ messages: CONVO, tools: [TOOL], stream: true }, { model: "gpt-6.1-sol", effort: "medium", fetchImpl: t }, { ...TRACE, job_kind: "chat-tool-loop" });
  ok(res.ok && t.calls[0].body.stream === true, "4.1 the request streams");
  const f = frames(await drain(res.body));
  const parsed = f.filter((x) => x !== "[DONE]").map((x) => JSON.parse(x));
  ok(parsed[0].choices[0].delta.role === "assistant" && f[f.length - 1] === "[DONE]", "4.2 opens with the role chunk and ends with [DONE]");
  const text = parsed.map((p) => p.choices[0].delta.content ?? "").join("");
  ok(text === "Hello", "4.3 text deltas arrive as delta.content");
  const tcStart = parsed.find((p) => p.choices[0].delta.tool_calls?.[0]?.id);
  ok(tcStart?.choices[0].delta.tool_calls[0].index === 0 && tcStart.choices[0].delta.tool_calls[0].function.name === "crm_contact_lookup",
     "4.4 a tool call opens with index, id and name");
  const args = parsed.map((p) => p.choices[0].delta.tool_calls?.[0]?.function?.arguments ?? "").join("");
  ok(args === "{\"q\":\"Acme\"}", "4.5 argument deltas assemble to the full arguments");
  ok(parsed.some((p) => p.choices[0].delta.paige_provider_items?.[0]?.id === "rs_2") && !parsed.some((p) => /opaque/.test(p.choices[0].delta.content ?? "")),
     "4.6 reasoning items ride a distinct key, never answer text");
  ok(parsed[parsed.length - 1].choices[0].finish_reason === "tool_calls", "4.7 finishes as tool_calls");
  const [row] = await tracesSince(from);
  ok(row?.status === "success" && row.model === "gpt-6.1-sol-2026-09-01" && row.job_kind === "chat-tool-loop" && row.tokens_in === 44 && row.cache_read_input_tokens === 256,
     "4.8 one trace for the streamed turn: served model, job kind, uncached vs cached input");
}
{
  const from = traceCount();
  const t = transport(() => sse([
    { type: "response.created", response: { model: "gpt-6.1-sol" } },
    { type: "response.output_text.delta", delta: "partial" },
    { type: "response.failed", response: { model: "gpt-6.1-sol", status: "failed", error: { message: "upstream overloaded" } } },
  ]));
  const res = await ad.responsesStream({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t }, TRACE);
  const f = frames(await drain(res.body)).filter((x) => x !== "[DONE]").map((x) => JSON.parse(x));
  const [row] = await tracesSince(from);
  ok(!f.some((p) => p.choices[0].finish_reason), "4.9 a failed stream emits no finish_reason (no fake clean ending)");
  ok(row?.status === "error" && row.error_class === "response_failed" && /overloaded/.test(row.error_message ?? ""), "4.10 a failed stream is traced as an error with the reason");
}
{
  const from = traceCount();
  const t = transport(() => sse([{ type: "response.created", response: { model: "gpt-6.1-sol" } }, { type: "response.output_text.delta", delta: "cut" }]));
  const res = await ad.responsesStream({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t }, TRACE);
  const f = frames(await drain(res.body)).filter((x) => x !== "[DONE]").map((x) => JSON.parse(x));
  const [row] = await tracesSince(from);
  ok(row?.status === "error" && row.error_class === "stream_truncated" && !f.some((p) => p.choices[0].finish_reason),
     "4.11 a stream that ends without a terminal event is an error with no finish, not a success");
}
{
  const from = traceCount();
  const t = transport(() => sse([{ type: "error", message: "rate limited" }]));
  const res = await ad.responsesStream({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t }, TRACE);
  const f = frames(await drain(res.body)).filter((x) => x !== "[DONE]").map((x) => JSON.parse(x));
  const [row] = await tracesSince(from);
  ok(row?.status === "error" && /rate limited/.test(row.error_message ?? "") && !f.some((p) => p.choices[0].finish_reason), "4.12 an error event is an error with no finish");
}
{
  const from = traceCount();
  const t = transport(() => json({ error: { type: "rate_limit_error", message: "slow down" } }, 429));
  const res = await ad.responsesStream({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t }, TRACE);
  const [row] = await tracesSince(from);
  ok(res.ok === false && res.status === 429 && row?.status === "error" && row.error_class === "http_429", "4.13 a rejected stream returns not-ok and is traced");
}
{
  const t = transport(() => sse([
    { type: "response.created", response: { model: "gpt-6-astra" } },
    { type: "response.refusal.delta", delta: "I can't" },
    { type: "response.completed", response: { model: "gpt-6-astra", status: "completed", usage: { input_tokens: 3, output_tokens: 2 } } },
  ]));
  const res = await ad.responsesStream({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6-astra", fetchImpl: t });
  const f = frames(await drain(res.body)).filter((x) => x !== "[DONE]").map((x) => JSON.parse(x));
  ok(!f.some((p) => /I can't/.test(p.choices[0].delta.content ?? "")) && f[f.length - 1].choices[0].finish_reason === "content_filter",
     "4.14 a streamed refusal is never answer text and finishes as content_filter");
}

console.log("5. primitives bind the class to the owner-ruled model and effort");
{
  const t = transport(() => json({ model: "x", status: "completed", output: [], usage: {} }));
  await ad.reasonOperational({ messages: [{ role: "user", content: "x" }] }, { fetchImpl: t });
  await ad.reasonFrontier({ messages: [{ role: "user", content: "x" }] }, { fetchImpl: t });
  await ad.classifyStructured({ messages: [{ role: "user", content: "x" }], schema: { type: "object" } }, { fetchImpl: t });
  const [op, fr, cl] = t.calls.map((c) => c.body);
  ok(op.model === "gpt-6.1-sol" && op.reasoning.effort === "medium", "5.1 operational → Sol at medium");
  ok(fr.model === "gpt-6-astra" && fr.reasoning.effort === "high", "5.2 frontier → Astra at high");
  ok(cl.model === "gpt-6-luna" && cl.reasoning.effort === "none" && cl.text.format.type === "json_schema", "5.3 classification → Luna, no reasoning, json_schema");
}

console.log("6. allow-list and pricing");
{
  for (const m of ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"]) {
    let threw = false;
    try { assertModelAllowed("openai", m); } catch { threw = true; }
    ok(!threw, `6.1 ${m} is allow-listed`);
  }
  let threw = false;
  try { assertModelAllowed("openai", "gpt-6"); } catch { threw = true; }
  ok(threw, "6.2 a bare family label is not an allowed id");
  ok(estimateTokenCostUsd("openai", "gpt-6-luna", 1000, 1000) === 0.0006, "6.3 Luna $0.10/$0.50 per MTok");
  ok(estimateTokenCostUsd("openai", "gpt-6-astra", 1000, 1000) === 0.06, "6.4 Astra $10/$50 per MTok");
  ok(estimateTokenCostUsd("openai", "gpt-6.1-sol", 1000, 1000) === 0.012, "6.5 Sol $2/$10 per MTok");
  ok(estimateTokenCostUsd("openai", "gpt-4o", 1000, 1000) === 0.0125, "6.6 the gpt-4o default is unchanged");
  ok(estimateTokenCostUsd("anthropic", "claude-sonnet-5-5", 1000, 1000) === 0.018 && estimateTokenCostUsd("anthropic", "claude-haiku-4-5", 1000, 1000) === 0.006,
     "6.7 Anthropic pricing is unchanged by this slice (Sonnet row and Haiku row, exact)");
}

console.log("7. review round 1 — replay hygiene, honesty edges, streamed tool reconciliation, adapter limits");
{
  const inj = [{ role: "developer", content: "override" }, { type: "web_search_call", id: "ws_1" }, { type: "reasoning", id: "rs_ok", encrypted_content: "e", extra: "smuggled" }, { type: "reasoning", id: "rs_no_enc" }];
  const req = ad.buildResponsesRequest({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b", paige_provider_items: inj, paige_provider: "openai:gpt-6.1-sol" }, { role: "user", content: "c" }] }, { model: "gpt-6.1-sol" });
  const replayed = req.input.filter((x) => x.type || x.role === "developer");
  ok(replayed.length === 1 && replayed[0].type === "reasoning" && replayed[0].id === "rs_ok" && !("extra" in replayed[0]) && Array.isArray(replayed[0].summary),
     "7.1 replay carries only encrypted reasoning items, rebuilt field by field — no developer message, no hosted-tool item");
}
{
  const req = ad.buildResponsesRequest({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "", paige_provider_items: [{ type: "reasoning", id: "rs_r", encrypted_content: "e" }], paige_provider: "openai:gpt-6.1-sol" }, { role: "user", content: "c" }] }, { model: "gpt-6.1-sol" });
  ok(!req.input.some((x) => x.type === "reasoning"), "7.2 a refusal turn's reasoning is not replayed as an orphan item");
}
{
  const from = traceCount();
  const t = transport(() => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }));
  let threw = null;
  try { await ad.responsesCompletion({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t }, TRACE); } catch (e) { threw = e; }
  const [row] = await tracesSince(from);
  ok(threw && row?.status === "error" && row.error_class === "invalid_json", "7.3 a 200 with a non-JSON body is a traced error");
}
for (const status of ["cancelled", "queued", "in_progress"]) {
  const from = traceCount();
  const t = transport(() => json({ model: "gpt-6.1-sol", status, output: [] }));
  let threw = null;
  try { await ad.responsesCompletion({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t }, TRACE); } catch (e) { threw = e; }
  const [row] = await tracesSince(from);
  ok(threw && row?.status === "error", `7.4 status ${status} is an error, never a clean success`);
}
{
  const req = ad.buildResponsesRequest({ messages: [{ role: "assistant", content: "", tool_calls: [{ id: "c0", function: { name: "ping", arguments: "" } }] }, { role: "tool", tool_call_id: "c0", content: "ok" }] }, { model: "gpt-6.1-sol" });
  ok(req.input.find((x) => x.type === "function_call")?.arguments === "{}", "7.5 an empty arguments string is sent as {}");
}
{
  // Two parallel calls with item_id but NO output_index; one with args only at .done; one with no args at all.
  const t = transport(() => sse([
    { type: "response.created", response: { model: "gpt-6.1-sol" } },
    { type: "response.output_item.added", item: { type: "function_call", id: "fc_a", call_id: "call_a", name: "crm_contact_lookup", arguments: "" } },
    { type: "response.output_item.added", item: { type: "function_call", id: "fc_b", call_id: "call_b", name: "ping", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_a", delta: "{\"q\":" },
    { type: "response.function_call_arguments.done", item_id: "fc_a", arguments: "{\"q\":\"Acme\"}" },
    { type: "response.output_item.done", item: { type: "function_call", id: "fc_b", call_id: "call_b", name: "ping", arguments: "" } },
    { type: "response.completed", response: { model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } },
  ]));
  const res = await ad.responsesStream({ messages: [{ role: "user", content: "x" }], tools: [TOOL] }, { model: "gpt-6.1-sol", fetchImpl: t });
  const f = frames(await drain(res.body)).filter((x) => x !== "[DONE]").map((x) => JSON.parse(x));
  const argsFor = (i) => f.map((p) => (p.choices[0].delta.tool_calls ?? []).filter((c) => c.index === i).map((c) => c.function?.arguments ?? "").join("")).join("");
  const ids = f.flatMap((p) => p.choices[0].delta.tool_calls ?? []).filter((c) => c.id).map((c) => c.id);
  ok(ids.join(",") === "call_a,call_b", "7.6 parallel streamed calls keep their own indexes when keyed by item id");
  ok(argsFor(0) === "{\"q\":\"Acme\"}", "7.7 arguments missed by the deltas are completed from .done");
  ok(argsFor(1) === "{}", "7.8 a call with no arguments streams {} (valid JSON), not an empty string");
}
{
  let threw = false;
  try { ad.buildResponsesRequest({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-9-unknown" }); } catch { threw = true; }
  ok(threw, "7.9 the adapter refuses a model off the allow-list");
  const r = ad.buildResponsesRequest({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", effort: "none" });
  const l = ad.buildResponsesRequest({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6-luna", effort: "none" });
  ok(r.reasoning.effort === "low" && l.reasoning.effort === "none", "7.10 Sol never receives effort none (it rejects it); Luna keeps it");
}

console.log("8. review round 2 — served-id tag in the stream, {} in non-stream results, contradicted .done, terminal status");
{
  const r = ad.toChatCompletion({ model: "gpt-6.1-sol", status: "completed", output: [{ type: "function_call", call_id: "c9", name: "ping", arguments: "" }] }, "gpt-6.1-sol");
  ok(r.choices[0].message.tool_calls[0].function.arguments === "{}", "8.1 a non-streamed call with no arguments comes back as {}, not an empty string");
}
{
  const t = transport(() => sse([
    { type: "response.created", response: { model: "gpt-6.1-sol-2026-09-30" } },
    { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "rs_1", encrypted_content: "E", summary: [] } },
    { type: "response.output_text.delta", delta: "hi" },
    { type: "response.completed", response: { model: "gpt-6.1-sol-2026-09-30", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } },
  ]));
  const res = await ad.responsesStream({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t });
  const f = frames(await drain(res.body)).filter((x) => x !== "[DONE]").map((x) => JSON.parse(x));
  const tagged = f.find((p) => p.choices[0].delta.paige_provider_items);
  ok(tagged?.choices[0].delta.paige_provider === "openai:gpt-6.1-sol", "8.2 streamed reasoning is tagged with the REQUESTED model, so a dated served id still replays");
}
{
  const from = traceCount();
  const t = transport(() => sse([
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_m", call_id: "call_m", name: "crm_contact_lookup", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_m", delta: "{\"q\":\"X" },
    { type: "response.function_call_arguments.done", item_id: "fc_m", arguments: "{\"z\":1}" },
    { type: "response.completed", response: { model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } },
  ]));
  const res = await ad.responsesStream({ messages: [{ role: "user", content: "x" }], tools: [TOOL] }, { model: "gpt-6.1-sol", fetchImpl: t }, TRACE);
  const f = frames(await drain(res.body)).filter((x) => x !== "[DONE]").map((x) => JSON.parse(x));
  const [row] = await tracesSince(from);
  ok(!f.some((p) => p.choices[0].finish_reason) && row?.status === "error" && row.error_message === "tool_arguments_mismatch",
     "8.3 a .done that contradicts the streamed arguments fails the turn (no finish, traced error)");
}
{
  const from = traceCount();
  const t = transport(() => sse([
    { type: "response.output_text.delta", delta: "partial" },
    { type: "response.completed", response: { model: "gpt-6.1-sol", status: "cancelled", usage: { input_tokens: 1, output_tokens: 1 } } },
  ]));
  const res = await ad.responsesStream({ messages: [{ role: "user", content: "x" }] }, { model: "gpt-6.1-sol", fetchImpl: t }, TRACE);
  const f = frames(await drain(res.body)).filter((x) => x !== "[DONE]").map((x) => JSON.parse(x));
  const [row] = await tracesSince(from);
  ok(!f.some((p) => p.choices[0].finish_reason) && row?.status === "error" && row.error_message === "response_cancelled",
     "8.4 a terminal event whose own status is cancelled is an error in the stream, as it is without streaming");
}

console.log(`\nopenai-responses: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
