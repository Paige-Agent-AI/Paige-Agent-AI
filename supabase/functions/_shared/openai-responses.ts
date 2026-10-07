// _shared/openai-responses.ts — the OpenAI Responses API adapter beneath PAIGE's model fabric (INT-334 R2).
//
// WHAT THIS IS. A provider adapter, not a product surface. It speaks the chat-shaped request PAIGE
// already builds (system / user / assistant-with-tool_calls / tool messages, function tools) and
// returns the chat-shaped result and SSE that PAIGE's readers already consume — the SAME shapes
// `claude.ts` produces from Anthropic — so a caller can move between providers without learning
// OpenAI vocabulary. GPT-6 Sol and Astra require the Responses API for tool calling.
//
// GOVERNANCE STAYS ABOVE IT (owner ruling 2026-10-06):
//   • Function tools only. Hosted/provider-native tools (web search, file search, MCP, computer use,
//     code interpreter, image generation, shell) are REFUSED here, before any network call. A
//     provider supporting a capability never makes it reachable; PAIGE's capability, Spine and
//     approval homes decide that, and their tools arrive here as ordinary function definitions.
//   • No authority lives here. Tenant, actor, risk, approval and autonomy are resolved by the caller's
//     existing gates; this file only carries the request to the model and the answer back.
//   • `store: false`. Reasoning state round-trips as `reasoning.encrypted_content` items, which the
//     caller may replay only to the same provider and model (`paige_provider_items`).
//
// HONEST BY CONSTRUCTION (§13): a missing key throws NeedsConfigError; an HTTP failure, a stream that
// breaks, `response.failed` or `error` are reported as errors (trace status "error"), never as a quiet
// empty success. The served model id comes from the response, never assumed from the request.
//
// DORMANT IN R2: nothing routes to this yet. R5–R7 put it behind the fabric's route policy.

import { NeedsConfigError } from "./provider-types.ts";
import { classifyProviderFailure, type ProviderFailureClass } from "./provider-failure.ts";
import { envKey } from "./env-key.ts";
import { traceLLMCall, type TraceCtx } from "./llm-trace.ts";
import { assertModelAllowed } from "./model-allowlist.ts";
import {
  OPENAI_EFFORT_BY_CLASS,
  OPENAI_MODEL_BY_CLASS,
  type OpenAIReasoningClass,
} from "./openai-models.ts";

const RESPONSES_PATH = "/responses";
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
/** Same bound the Claude seam uses for one model call, so a stalled stream ends rather than hangs. */
const MODEL_CALL_DEADLINE_MS = 120_000;

function baseUrl(): string {
  return Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
}
// One name: OPENAI_API_KEY (the image path reads the same secret). envKey tolerates case, not spelling.
function openaiKey(): string {
  const k = envKey("OPENAI_API_KEY");
  if (!k) throw new NeedsConfigError("openai");
  return k;
}

// ── request shape PAIGE speaks ─────────────────────────────────────────────────────────────────

export interface ChatShapeToolCall { id: string; type?: "function"; function: { name: string; arguments: string } }
export interface ChatShapeMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  tool_calls?: ChatShapeToolCall[];
  tool_call_id?: string;
  /** Opaque provider items (OpenAI reasoning) returned on an earlier assistant turn. Replayed only to
   *  the provider+model named in `paige_provider`; dropped for any other target. */
  paige_provider_items?: unknown[];
  paige_provider?: string;
}
export interface ChatShapeTool {
  type: string;
  function?: { name: string; description?: string; parameters?: unknown; strict?: boolean };
}
export interface ChatShapeBody {
  messages: ChatShapeMessage[];
  tools?: ChatShapeTool[];
  tool_choice?: unknown;
  max_tokens?: number;
  response_format?: { type: string; json_schema?: { name?: string; schema?: unknown; strict?: boolean } };
  stream?: boolean;
  /** Sampling is ignored: reasoning models reject it while reasoning is on. */
  temperature?: number;
  top_p?: number;
}

export interface ResponsesCallOpts {
  model: string;
  effort?: "none" | "low" | "medium" | "high" | "xhigh";
  /** Injectable transport for tests; production uses global fetch. */
  fetchImpl?: typeof fetch;
}

/** Thrown before any network call when a request would hand the provider a capability PAIGE governs. */
export class ProviderToolRefused extends Error {
  readonly toolType: string;
  constructor(toolType: string) {
    super(`provider tool type "${toolType}" is not allowed through the model fabric; expose it as a governed PAIGE function tool`);
    this.name = "ProviderToolRefused";
    this.toolType = toolType;
  }
}

/** The provider+model tag carried on assistant turns that hold replayable provider items. It names the
 *  model PAIGE REQUESTED (the alias it will request again), never the dated id the provider served, so a
 *  turn's reasoning replays on the next round of the same tool loop. */
export function providerTag(model: string): string {
  return `openai:${model}`;
}

/** Only encrypted reasoning items may be replayed, rebuilt field by field. Anything else a stored history
 *  carries (a developer message, a hosted-tool call item, …) is dropped: replay is never a side door. */
function replayableItems(items: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const it of items) {
    const r = it as { type?: unknown; id?: unknown; encrypted_content?: unknown; summary?: unknown };
    if (r?.type !== "reasoning" || typeof r.encrypted_content !== "string" || !r.encrypted_content) continue;
    out.push({
      type: "reasoning",
      ...(typeof r.id === "string" ? { id: r.id } : {}),
      encrypted_content: r.encrypted_content,
      summary: Array.isArray(r.summary) ? r.summary : [],
    });
  }
  return out;
}

const SOL_ASTRA_NO_NONE = (model: string) => !model.startsWith("gpt-6-luna");

// ── chat shape → Responses request ─────────────────────────────────────────────────────────────

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  return content == null ? "" : String(content);
}

function userParts(content: unknown): unknown[] {
  if (typeof content === "string") return [{ type: "input_text", text: content }];
  if (!Array.isArray(content)) return [{ type: "input_text", text: content == null ? "" : String(content) }];
  const out: unknown[] = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    const part = p as { type?: string; text?: unknown; image_url?: unknown };
    if (part.type === "text") out.push({ type: "input_text", text: String(part.text ?? "") });
    else if (part.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : (part.image_url as { url?: unknown } | undefined)?.url;
      if (typeof url === "string" && url) out.push({ type: "input_image", image_url: url });
    }
    // Other part types (e.g. a PDF `file`) are not translated here: the fabric routes document turns
    // only to a provider whose adapter carries them. Dropping silently would hide content, so refuse.
    else throw new ProviderToolRefused(`content:${part.type ?? "unknown"}`);
  }
  return out;
}

function toolDef(t: ChatShapeTool): Record<string, unknown> {
  if (t.type !== "function" || !t.function?.name) throw new ProviderToolRefused(String(t.type ?? "unknown"));
  return {
    type: "function",
    name: t.function.name,
    ...(t.function.description ? { description: t.function.description } : {}),
    parameters: t.function.parameters ?? { type: "object", properties: {} },
    strict: t.function.strict === true,
  };
}

/** Build the Responses request body. Pure: no env, no I/O — exported for the conformance gate. */
export function buildResponsesRequest(body: ChatShapeBody, opts: ResponsesCallOpts): Record<string, unknown> {
  // The adapter enforces its own limits rather than trusting every caller to: an id off the allow-list is
  // refused, and Sol/Astra (which reject `none`) never receive it.
  assertModelAllowed("openai", opts.model);
  const instructions: string[] = [];
  const input: unknown[] = [];
  const tag = providerTag(opts.model);
  for (const m of body.messages ?? []) {
    if (m.role === "system") {
      const t = textOf(m.content);
      if (t) instructions.push(t);
    } else if (m.role === "user") {
      input.push({ role: "user", content: userParts(m.content) });
    } else if (m.role === "assistant") {
      const t = textOf(m.content);
      const calls = m.tool_calls ?? [];
      // Reasoning items first, in the order produced, only for the same requested model, and only when the
      // turn has an item for them to precede (a refusal turn has none — an orphan reasoning item is invalid).
      if (Array.isArray(m.paige_provider_items) && m.paige_provider === tag && (t || calls.length)) {
        input.push(...replayableItems(m.paige_provider_items));
      }
      if (t) input.push({ role: "assistant", content: [{ type: "output_text", text: t }] });
      for (const tc of calls) {
        input.push({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments || "{}" });
      }
    } else if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output: textOf(m.content) });
    }
  }
  const req: Record<string, unknown> = {
    model: opts.model,
    input,
    store: false,
    include: ["reasoning.encrypted_content"],
    max_output_tokens: body.max_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  if (instructions.length) req.instructions = instructions.join("\n\n");
  if (opts.effort) req.reasoning = { effort: opts.effort === "none" && SOL_ASTRA_NO_NONE(opts.model) ? "low" : opts.effort };
  if (body.tools?.length) {
    req.tools = body.tools.map(toolDef);
    // PAIGE never forces a tool through the provider: "none" is honoured, anything else is "auto".
    req.tool_choice = body.tool_choice === "none" ? "none" : "auto";
  }
  const rf = body.response_format;
  if (rf?.type === "json_schema" && rf.json_schema?.schema) {
    req.text = { format: { type: "json_schema", name: rf.json_schema.name ?? "result", schema: rf.json_schema.schema, strict: rf.json_schema.strict !== false } };
  } else if (rf?.type === "json_object") {
    req.text = { format: { type: "json_object" } };
  }
  return req;
}

// ── Responses result → chat shape ──────────────────────────────────────────────────────────────

interface Usage { tokens_in: number | null; tokens_out: number | null; cached: number | null }
function readUsage(u: any): Usage {
  const input = typeof u?.input_tokens === "number" ? u.input_tokens : null;
  const cached = typeof u?.input_tokens_details?.cached_tokens === "number" ? u.input_tokens_details.cached_tokens : null;
  const out = typeof u?.output_tokens === "number" ? u.output_tokens : null;
  // tokens_in is the UNCACHED remainder, matching the Anthropic seam's meter semantics; cached tokens
  // are reported separately so a cached prefix is never billed as fresh input.
  return { tokens_in: input == null ? null : Math.max(0, input - (cached ?? 0)), tokens_out: out, cached };
}

/** Map a Responses status to PAIGE's provider-neutral stop vocabulary. */
export function stopFor(status: string | undefined, incompleteReason: string | undefined, refused: boolean, calledTools: boolean): {
  stop_reason: string; finish_reason: "stop" | "tool_calls" | "length" | "content_filter";
} {
  if (refused) return { stop_reason: "refusal", finish_reason: "content_filter" };
  if (status === "incomplete") {
    if (incompleteReason === "max_output_tokens") return { stop_reason: "max_tokens", finish_reason: "length" };
    if (incompleteReason === "content_filter") return { stop_reason: "content_filter", finish_reason: "content_filter" };
    return { stop_reason: `incomplete:${incompleteReason ?? "unknown"}`, finish_reason: "length" };
  }
  if (calledTools) return { stop_reason: "tool_use", finish_reason: "tool_calls" };
  return { stop_reason: "end_turn", finish_reason: "stop" };
}

/** Convert a completed Responses object to the chat-completion shape PAIGE's non-streaming readers use. */
export function toChatCompletion(resp: any, requestedModel: string): Record<string, unknown> {
  let text = "";
  let refused = false;
  const toolCalls: ChatShapeToolCall[] = [];
  const providerItems: unknown[] = [];
  for (const item of Array.isArray(resp?.output) ? resp.output : []) {
    if (item?.type === "message") {
      for (const c of Array.isArray(item.content) ? item.content : []) {
        if (c?.type === "output_text" && typeof c.text === "string") text += c.text;
        else if (c?.type === "refusal") refused = true;
      }
    } else if (item?.type === "function_call") {
      toolCalls.push({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments || "{}" } });
    } else if (item?.type === "reasoning") {
      providerItems.push(item);
    }
  }
  const served = typeof resp?.model === "string" ? resp.model : requestedModel;
  const stop = stopFor(resp?.status, resp?.incomplete_details?.reason, refused, toolCalls.length > 0);
  const u = readUsage(resp?.usage);
  return {
    id: resp?.id,
    model: served,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        ...(providerItems.length ? { paige_provider_items: providerItems, paige_provider: providerTag(requestedModel) } : {}),
      },
      finish_reason: stop.finish_reason,
    }],
    usage: { prompt_tokens: u.tokens_in, completion_tokens: u.tokens_out, cached_tokens: u.cached },
    paige_stop: { stop_reason: stop.stop_reason },
  };
}

// ── calls ──────────────────────────────────────────────────────────────────────────────────────

function emitTrace(trace: TraceCtx | undefined, row: {
  model: string; status: "success" | "error"; started: number; usage?: Usage; input?: unknown; output?: string;
  error_class?: string | null; error_message?: string | null; stop_reason?: string;
}) {
  if (!trace) return;
  // Cost is priced once, in traceLLMCall (token-pricing.ts), so this path cannot drift from the meter.
  traceLLMCall({
    ...trace,
    provider: "openai",
    model: row.model,
    job_kind: trace.job_kind ?? "chat",
    modality: "text",
    status: row.status,
    tokens_in: row.usage?.tokens_in ?? null,
    tokens_out: row.usage?.tokens_out ?? null,
    cache_read_input_tokens: row.usage?.cached ?? null,
    latency_ms: Date.now() - row.started,
    input: row.input,
    output: row.output,
    error_class: row.error_class ?? null,
    error_message: row.error_message ?? null,
    metadata: { caller_function: trace.agent_id, ...(row.stop_reason ? { stop_reason: row.stop_reason } : {}) },
  });
}

async function failureDetail(resp: Response): Promise<string> {
  return (await failureOf(resp)).detail;
}

/** The failure, read once: a short detail for the trace, and the class the provider's response proves. */
async function failureOf(resp: Response): Promise<{ detail: string; failureClass: ProviderFailureClass }> {
  let e: any = null;
  try { e = (await resp.json())?.error ?? null; } catch { /* not JSON */ }
  const detail = e ? [e.type, e.code, e.message].filter((x) => typeof x === "string").join(": ").slice(0, 500) || `http_${resp.status}` : `http_${resp.status}`;
  const failureClass = classifyProviderFailure({
    provider: "openai", status: resp.status,
    errorType: typeof e?.type === "string" ? e.type : null, errorCode: typeof e?.code === "string" ? e.code : null,
    message: typeof e?.message === "string" ? e.message : null,
  });
  return { detail, failureClass };
}

/** Non-streaming Responses call, returned in chat-completion shape. Throws on any failure. */
export async function responsesCompletion(body: ChatShapeBody, opts: ResponsesCallOpts, trace?: TraceCtx): Promise<Record<string, unknown>> {
  const req = buildResponsesRequest({ ...body, stream: false }, opts); // refuses governed tool types before the key is read
  const key = openaiKey();
  const started = Date.now();
  const doFetch = opts.fetchImpl ?? fetch;
  let resp: Response;
  try {
    resp = await doFetch(`${baseUrl()}${RESPONSES_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(MODEL_CALL_DEADLINE_MS),
    });
  } catch (e) {
    emitTrace(trace, { model: opts.model, status: "error", started, input: body.messages, error_class: "network", error_message: String((e as Error)?.message ?? e).slice(0, 500) });
    throw e;
  }
  if (!resp.ok) {
    // failureOf reads the body ONCE: the trace's short detail and the fabric's closed class.
    const f = await failureOf(resp);
    emitTrace(trace, { model: opts.model, status: "error", started, input: body.messages, error_class: `http_${resp.status}`, error_message: f.detail });
    // INT-334 — carry the closed failure class (and the status) ON the throw, so the fabric's
    // consumer seam can classify a failed non-stream leg without parsing the message text.
    throw Object.assign(new Error(`OpenAI ${resp.status}: ${f.detail}`), { status: resp.status, failureClass: f.failureClass });
  }
  let data: any;
  try {
    data = await resp.json();
  } catch (e) {
    const m = String((e as Error)?.message ?? e).slice(0, 500);
    emitTrace(trace, { model: opts.model, status: "error", started, input: body.messages, error_class: "invalid_json", error_message: m });
    throw new Error(`OpenAI returned a non-JSON body: ${m}`);
  }
  // Only a completed or incomplete response carries an answer; failed, cancelled, queued or in-progress
  // (or an error object) is an error, never a quiet empty success.
  if (data?.error || (data?.status !== "completed" && data?.status !== "incomplete")) {
    const msg = String(data?.error?.message ?? `response status ${data?.status ?? "missing"}`).slice(0, 500);
    emitTrace(trace, { model: typeof data?.model === "string" ? data.model : opts.model, status: "error", started, input: body.messages, error_class: "response_failed", error_message: msg });
    throw new Error(`OpenAI response not completed: ${msg}`);
  }
  const chat = toChatCompletion(data, opts.model);
  const msg = (chat.choices as any[])[0].message;
  emitTrace(trace, {
    model: chat.model as string, status: "success", started, usage: readUsage(data?.usage), input: body.messages,
    output: msg.content, stop_reason: (chat.paige_stop as { stop_reason: string }).stop_reason,
  });
  return chat;
}

/**
 * Streaming Responses call, translated to the chat-shaped SSE `claude.ts` emits:
 *   `data: {choices:[{delta:{content|tool_calls}, finish_reason}]}` … `data: [DONE]`.
 * Replayable reasoning items ride a DISTINCT delta key (`paige_provider_items`), never `content`, so
 * readers that do not know it ignore it. A failure mid-stream is reported (trace status "error") and the
 * stream still terminates with [DONE] — never a hang, never a fabricated finish.
 */
export async function responsesStream(body: ChatShapeBody, opts: ResponsesCallOpts, trace?: TraceCtx): Promise<{ ok: boolean; status: number; body?: ReadableStream<Uint8Array>; error?: string; failureClass?: ProviderFailureClass }> {
  const req = buildResponsesRequest(body, opts);
  const key = openaiKey();
  const started = Date.now();
  const doFetch = opts.fetchImpl ?? fetch;
  let resp: Response;
  try {
    resp = await doFetch(`${baseUrl()}${RESPONSES_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...req, stream: true }),
      signal: AbortSignal.timeout(MODEL_CALL_DEADLINE_MS),
    });
  } catch (e) {
    const m = String((e as Error)?.message ?? e).slice(0, 500);
    emitTrace(trace, { model: opts.model, status: "error", started, input: body.messages, error_class: "network", error_message: m });
    return { ok: false, status: 0, error: m, failureClass: classifyProviderFailure({ provider: "openai", status: 0, transport: (e as Error)?.name === "TimeoutError" ? "timeout" : "network" }) };
  }
  if (!resp.ok || !resp.body) {
    const f = resp.ok ? { detail: "missing_body", failureClass: "provider_outage" as ProviderFailureClass } : await failureOf(resp);
    emitTrace(trace, { model: opts.model, status: "error", started, input: body.messages, error_class: resp.ok ? "missing_body" : `http_${resp.status}`, error_message: f.detail });
    return { ok: false, status: resp.status, error: f.detail, failureClass: f.failureClass };
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const upstream = resp.body.getReader();
  const send = (c: ReadableStreamDefaultController<Uint8Array>, obj: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";
      let servedModel: string | null = null;
      let outText = "";
      let refused = false;
      let finalResponse: any = null;
      let failure: string | null = null;
      let streamErrored = false;
      // A streamed function call is identified by its item id (output_index as fallback). Its arguments are
      // reconciled against the `.done` events so a call never ends with lost or empty (invalid) arguments.
      const tools = new Map<string, { index: number; emitted: string }>();
      let nextTool = 0;
      const keyOf = (ev: any): string | null =>
        typeof ev?.item_id === "string" ? `id:${ev.item_id}`
        : typeof ev?.item?.id === "string" ? `id:${ev.item.id}`
        : typeof ev?.output_index === "number" ? `ix:${ev.output_index}` : null;
      const openTool = (c: ReadableStreamDefaultController<Uint8Array>, keys: (string | null)[], callId: string, name: string) => {
        const t = { index: nextTool++, emitted: "" };
        for (const k of keys) if (k) tools.set(k, t);
        send(c, { choices: [{ index: 0, delta: { tool_calls: [{ index: t.index, id: callId, type: "function", function: { name, arguments: "" } }] }, finish_reason: null }] });
        return t;
      };
      const toolFor = (ev: any) => {
        const a = keyOf(ev);
        const b = typeof ev?.output_index === "number" ? `ix:${ev.output_index}` : null;
        return (a && tools.get(a)) || (b && tools.get(b)) || undefined;
      };
      const emitArgs = (c: ReadableStreamDefaultController<Uint8Array>, t: { index: number; emitted: string }, delta: string) => {
        if (!delta) return;
        t.emitted += delta;
        send(c, { choices: [{ index: 0, delta: { tool_calls: [{ index: t.index, function: { arguments: delta } }] }, finish_reason: null }] });
      };
      /** At the end of a call: emit whatever the deltas missed. A call that never gets arguments is given "{}"
       *  only when the stream finishes, so an early empty `.done` cannot pre-empt a later event carrying them. */
      const settleArgs = (c: ReadableStreamDefaultController<Uint8Array>, t: { index: number; emitted: string }, full: unknown) => {
        const fullArgs = typeof full === "string" ? full : "";
        if (fullArgs && fullArgs.startsWith(t.emitted)) emitArgs(c, t, fullArgs.slice(t.emitted.length));
        // A `.done` that contradicts what was already streamed cannot be repaired (those bytes are sent):
        // the call's arguments are untrustworthy, so the turn is reported as failed, never as a clean call.
        else if (fullArgs && failure === null) failure = "tool_arguments_mismatch";
      };
      send(controller, { choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
      try {
        while (true) {
          const { done, value } = await upstream.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const js = t.slice(5).trim();
            if (!js || js === "[DONE]") continue;
            let ev: any;
            try { ev = JSON.parse(js); } catch { continue; }
            const type: string = ev?.type ?? "";
            if (type === "response.created" || type === "response.in_progress") {
              if (typeof ev.response?.model === "string") servedModel = ev.response.model;
            } else if (type === "response.output_text.delta" && typeof ev.delta === "string") {
              if (outText.length < 40000) outText += ev.delta;
              send(controller, { choices: [{ index: 0, delta: { content: ev.delta }, finish_reason: null }] });
            } else if (type === "response.refusal.delta" || type === "response.refusal.done") {
              refused = true; // never surfaced as answer text; reported as a refusal stop
            } else if (type === "response.output_item.added" && ev.item?.type === "function_call") {
              if (!toolFor(ev)) openTool(controller, [keyOf(ev), typeof ev.output_index === "number" ? `ix:${ev.output_index}` : null], ev.item.call_id, ev.item.name);
            } else if (type === "response.function_call_arguments.delta" && typeof ev.delta === "string") {
              const t = toolFor(ev);
              if (t) emitArgs(controller, t, ev.delta); // an unknown call is settled from its `.done` below
            } else if (type === "response.function_call_arguments.done") {
              const t = toolFor(ev);
              if (t) settleArgs(controller, t, ev.arguments);
            } else if (type === "response.output_item.done" && ev.item?.type === "function_call") {
              const t = toolFor(ev) ?? openTool(controller, [keyOf(ev), typeof ev.output_index === "number" ? `ix:${ev.output_index}` : null], ev.item.call_id, ev.item.name);
              settleArgs(controller, t, ev.item.arguments);
            } else if (type === "response.output_item.done" && ev.item?.type === "reasoning") {
              send(controller, { choices: [{ index: 0, delta: { paige_provider_items: [ev.item], paige_provider: providerTag(opts.model) }, finish_reason: null }] });
            } else if (type === "response.completed" || type === "response.incomplete") {
              finalResponse = ev.response;
              if (typeof ev.response?.model === "string") servedModel = ev.response.model;
            } else if (type === "response.failed") {
              finalResponse = ev.response;
              failure = String(ev.response?.error?.message ?? "response failed").slice(0, 500);
            } else if (type === "error") {
              failure = String(ev.message ?? ev.error?.message ?? "stream error").slice(0, 500);
            }
          }
        }
      } catch (_e) {
        streamErrored = true;
      } finally {
        // The event name is not the verdict: a terminal response whose own status is not completed or
        // incomplete (cancelled, queued, missing) fails here exactly as it does in responsesCompletion.
        if (finalResponse && !failure && finalResponse.status !== "completed" && finalResponse.status !== "incomplete") {
          failure = `response_${typeof finalResponse.status === "string" ? finalResponse.status.slice(0, 40) : "status_missing"}`;
        }
        const truncated = !finalResponse && !failure; // the stream ended without a terminal event
        const stop = stopFor(finalResponse?.status, finalResponse?.incomplete_details?.reason, refused, nextTool > 0);
        const errored = streamErrored || !!failure || truncated;
        if (!errored) {
          for (const t of new Set(tools.values())) if (!t.emitted) emitArgs(controller, t, "{}");
          send(controller, { choices: [{ index: 0, delta: {}, finish_reason: stop.finish_reason }] });
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
        emitTrace(trace, {
          model: servedModel ?? opts.model,
          status: errored ? "error" : "success",
          started,
          usage: readUsage(finalResponse?.usage),
          input: body.messages,
          output: outText,
          error_class: streamErrored ? "stream_interrupted" : failure ? "response_failed" : truncated ? "stream_truncated" : null,
          error_message: failure,
          stop_reason: errored ? undefined : stop.stop_reason,
        });
      }
    },
  });
  return { ok: true, status: 200, body: stream };
}

// ── PAIGE primitives (the vocabulary callers use; no provider names leak out) ───────────────────

export interface PrimitiveOpts { trace?: TraceCtx; fetchImpl?: typeof fetch }

function classOpts(cls: OpenAIReasoningClass, o?: PrimitiveOpts): ResponsesCallOpts {
  return { model: OPENAI_MODEL_BY_CLASS[cls], effort: OPENAI_EFFORT_BY_CLASS[cls], fetchImpl: o?.fetchImpl };
}

/** Normal sophisticated reasoning: conversation, tool reasoning, planning, synthesis. */
export function reasonOperational(body: ChatShapeBody, o?: PrimitiveOpts) {
  return responsesCompletion(body, classOpts("operational", o), o?.trace);
}
/** Hardest reasoning: ambiguity, long-horizon orchestration, deep research, large documents. */
export function reasonFrontier(body: ChatShapeBody, o?: PrimitiveOpts) {
  return responsesCompletion(body, classOpts("frontier", o), o?.trace);
}
/** Cheap structured classification/extraction against a JSON schema. */
export function classifyStructured(body: ChatShapeBody & { schema: unknown; schemaName?: string }, o?: PrimitiveOpts) {
  const { schema, schemaName, ...rest } = body;
  return responsesCompletion(
    { ...rest, response_format: { type: "json_schema", json_schema: { name: schemaName ?? "classification", schema, strict: true } } },
    classOpts("cheap", o),
    o?.trace,
  );
}
/** Streamed tool reasoning at a chosen class (operational by default). */
export function streamToolReasoning(body: ChatShapeBody, cls: OpenAIReasoningClass = "operational", o?: PrimitiveOpts) {
  return responsesStream(body, classOpts(cls, o), o?.trace);
}
/** Vision reasoning over image inputs (user content `image_url` parts). */
export function reasonVision(body: ChatShapeBody, cls: OpenAIReasoningClass = "operational", o?: PrimitiveOpts) {
  return responsesCompletion(body, classOpts(cls, o), o?.trace);
}
