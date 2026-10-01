// _shared/claude.ts
// Anthropic-only AI client for Paige edge functions.
// Replaces the Lovable AI gateway (OpenAI-compatible proxy over Gemini/OpenAI).
//
// Two tiers (aliases → auto-upgrade on future model versions):
//   REASONING      — chat, doc drafting, game plans, deep skills
//   CLASSIFICATION — metadata extraction, tone checks, simple routing
//
// Exposes:
//   callClaude()            — native Anthropic Messages call (system/tools/json)
//   chatCompletionCompat()  — OpenAI-/gateway-shaped shim for minimal-diff migration
//   Model constants + tier mapping helper
//
// Streaming is intentionally NOT handled here — the two streaming call sites
// (paige-ai-chat, broker-paige-chat) get a dedicated streaming path in R4.

import { traceLLMCall, traceAdmin, type TraceCtx } from "./llm-trace.ts";
import { accruedSpendToday, BudgetExceeded, enforceBudget, resolveCeiling, type BudgetDb } from "./router-budget/mod.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_ERROR_CAPTURE_BYTES = 4096;

/**
 * Preserve enough structure to diagnose a rejected Anthropic request without ever retaining the
 * provider's raw message. Provider errors can echo request content, so only fixed classifications,
 * a tool-schema path, and a validated request id survive into the trace.
 */
async function anthropicFailureDiagnostic(resp: Response): Promise<string> {
  let excerpt = "";
  let capturedBytes = 0;
  let truncated = false;
  if (resp.body) {
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (received <= ANTHROPIC_ERROR_CAPTURE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = ANTHROPIC_ERROR_CAPTURE_BYTES + 1 - received;
        const part = value.subarray(0, Math.max(0, remaining));
        if (part.length) chunks.push(part);
        received += part.length;
        if (value.length > part.length || received > ANTHROPIC_ERROR_CAPTURE_BYTES) {
          truncated = true;
          break;
        }
      }
    } finally {
      if (truncated) {
        try { await reader.cancel(); } catch { /* response already closed */ }
      }
    }
    capturedBytes = Math.min(received, ANTHROPIC_ERROR_CAPTURE_BYTES);
    const combined = new Uint8Array(capturedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= capturedBytes) break;
      const part = chunk.subarray(0, capturedBytes - offset);
      combined.set(part, offset);
      offset += part.length;
    }
    excerpt = new TextDecoder().decode(combined);
  }

  let parsed: any = null;
  try { parsed = excerpt ? JSON.parse(excerpt) : null; } catch { /* classify as unparsed */ }
  const rawType = parsed?.error?.type ?? parsed?.type;
  const errorType = typeof rawType === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(rawType)
    ? rawType
    : "unknown";
  const rawMessage = typeof parsed?.error?.message === "string" ? parsed.error.message : "";
  const pathMatch = rawMessage.match(
    /^\s*((?:tools|tool_choice)(?:(?:\.\d+)|(?:\.[A-Za-z_][A-Za-z0-9_-]*)){1,8})\s*:/i,
  );
  const errorPath = pathMatch?.[1] ?? null;
  const lower = rawMessage.toLowerCase();
  const issueCodes: string[] = [];
  const addIssue = (condition: boolean, code: string) => { if (condition) issueCodes.push(code); };
  addIssue(/input[_ ]schema/.test(lower), "input_schema");
  addIssue(/invalid.{0,24}json schema|json schema.{0,24}invalid/.test(lower), "invalid_json_schema");
  addIssue(/top[- ]level.{0,40}anyof|anyof.{0,40}top[- ]level/.test(lower), "top_level_anyof");
  addIssue(/top[- ]level.{0,40}oneof|oneof.{0,40}top[- ]level/.test(lower), "top_level_oneof");
  addIssue(/top[- ]level.{0,40}allof|allof.{0,40}top[- ]level/.test(lower), "top_level_allof");
  addIssue(/unsupported.{0,24}keyword|keyword.{0,24}unsupported/.test(lower), "unsupported_keyword");
  addIssue(/required.{0,40}propert|propert.{0,40}required/.test(lower), "required_properties");
  if (!issueCodes.length) issueCodes.push("unclassified");

  const headerRequestId = resp.headers.get("request-id") ?? resp.headers.get("x-request-id");
  const bodyRequestId = parsed?.request_id;
  const candidateRequestId = headerRequestId ?? (typeof bodyRequestId === "string" ? bodyRequestId : null);
  const providerRequestId = candidateRequestId && /^[a-zA-Z0-9_-]{1,128}$/.test(candidateRequestId)
    ? candidateRequestId
    : null;

  return JSON.stringify({
    provider_request_id: providerRequestId,
    http_status: resp.status,
    error_type: errorType,
    error_path: errorPath,
    issue_codes: [...new Set(issueCodes)],
    captured_bytes: capturedBytes,
    truncated,
  });
}

export const CLAUDE_REASONING = "claude-sonnet-5";       // alias: auto-upgrades
export const CLAUDE_CLASSIFICATION = "claude-haiku-4-5"; // alias: auto-upgrades
export type ClaudeTier = "reasoning" | "classification";

function tierModel(tier: ClaudeTier): string {
  return tier === "reasoning" ? CLAUDE_REASONING : CLAUDE_CLASSIFICATION;
}

// The current reasoning-tier Claude models (Sonnet 5 / Opus 4.x / Fable 5) REJECT any non-default
// sampling parameter (temperature/top_p/top_k) with an HTTP 400. The classification tier (Haiku 4.5)
// still accepts them. Callers routinely pass a temperature, so strip it for the models that refuse it
// rather than 400 the whole request — otherwise every reasoning call that sets temperature fails
// (this was the paige-public-chat / paige-deep-research / paige-voice-chat 400->502 defect).
function modelRejectsSampling(model: string): boolean {
  return /sonnet-5|opus-4|fable-5/i.test(model);
}

// Map a legacy gateway model string to a Paige tier, preserving the original
// cost/capability intent (pro/gpt-4 => reasoning; flash/lite/mini => classification).
export function tierForLegacyModel(model?: string): ClaudeTier {
  const m = (model ?? "").toLowerCase();
  if (/pro|gpt-4|opus|sonnet|o1|o3/.test(m)) return "reasoning";
  return "classification"; // flash, flash-lite, mini, haiku, unknown => cheap tier
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | unknown[]; // string, or Anthropic content blocks (incl. tool_result)
}

// ---------------------------------------------------------------------------
// Translate an OpenAI-/gateway-style message list into Anthropic messages.
// This is the ONE place that must get tool-calling right — the tool loop sends
// back an assistant turn carrying `tool_calls` followed by `tool` results, and
// Anthropic needs (a) the assistant `tool_use` blocks so each `tool_result` has
// a matching id, and (b) consecutive tool_results merged onto ONE user turn
// (Anthropic requires alternating roles). Missing (a) was the Lovable→Anthropic
// regression that broke every tool-using turn ("couldn't finish that").
// ---------------------------------------------------------------------------
interface OaiMessage { role: string; content: unknown; tool_calls?: any[]; tool_call_id?: string }

// Translate an OpenAI-style message content (string OR a blocks array that may carry
// image_url / file / data-URI attachments) into Anthropic content. A plain string stays
// a string; a blocks array maps text→text and data-URI images/PDFs→Anthropic image/document
// blocks. Without this, multimodal content was JSON.stringify'd and the model saw no image.
function toClaudeContent(c: unknown): string | any[] {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return c == null ? "" : JSON.stringify(c);
  const blocks: any[] = [];
  for (const b of c as any[]) {
    if (b == null) continue;
    if (b.type === "text" && typeof b.text === "string") { blocks.push({ type: "text", text: b.text }); continue; }
    // Already-Anthropic blocks pass straight through.
    if (b.type === "image" || b.type === "document" || b.type === "tool_result" || b.type === "tool_use") { blocks.push(b); continue; }
    // OpenAI image_url / file blocks — accept a data: URI and split out media type + base64.
    const dataUrl: string | undefined =
      b.type === "image_url" ? b.image_url?.url :
      b.type === "file" ? (b.file?.file_data ?? b.file?.url ?? b.data) :
      typeof b.url === "string" ? b.url : undefined;
    const m = typeof dataUrl === "string" ? dataUrl.match(/^data:([^;]+);base64,(.*)$/s) : null;
    if (m) {
      const media = m[1]; const data = m[2];
      if (media === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: media, data } });
      else if (media.startsWith("image/")) blocks.push({ type: "image", source: { type: "base64", media_type: media, data } });
      else blocks.push({ type: "text", text: `[unsupported attachment: ${media}]` });
      continue;
    }
    blocks.push({ type: "text", text: typeof b === "string" ? b : JSON.stringify(b) });
  }
  return blocks.length ? blocks : "";
}

function splitMessages(messages: OaiMessage[]): { system: string; msgs: ClaudeMessage[] } {
  const asStr = (c: unknown) => (typeof c === "string" ? c : c == null ? "" : JSON.stringify(c));
  const systemParts: string[] = [];
  const raw: ClaudeMessage[] = [];
  for (const m of messages ?? []) {
    if (m.role === "system") { systemParts.push(asStr(m.content)); continue; }
    if (m.role === "tool") {
      raw.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: asStr(m.content) }] });
      continue;
    }
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const blocks: any[] = [];
      const txt = asStr(m.content);
      if (txt && txt !== "null") blocks.push({ type: "text", text: txt });
      for (const tc of m.tool_calls) {
        let input: unknown = {};
        try { input = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { input = {}; }
        blocks.push({ type: "tool_use", id: tc.id, name: tc?.function?.name, input });
      }
      raw.push({ role: "assistant", content: blocks });
      continue;
    }
    raw.push({ role: m.role === "assistant" ? "assistant" : "user", content: toClaudeContent(m.content) });
  }
  // Coalesce consecutive same-role turns (batches multiple tool_results onto one
  // user turn; keeps roles alternating).
  const toBlocks = (c: unknown): any[] => (Array.isArray(c) ? c : [{ type: "text", text: typeof c === "string" ? c : JSON.stringify(c) }]);
  const msgs: ClaudeMessage[] = [];
  for (const m of raw) {
    const last = msgs[msgs.length - 1];
    if (last && last.role === m.role) {
      last.content = [...toBlocks(last.content), ...toBlocks(m.content)];
    } else {
      msgs.push({ role: m.role, content: m.content });
    }
  }
  return { system: systemParts.join("\n\n"), msgs };
}

export interface ClaudeCallOpts {
  messages: ClaudeMessage[];
  system?: string;
  tier?: ClaudeTier;          // default "reasoning"
  model?: string;             // explicit override wins over tier
  maxTokens?: number;         // default 2048
  temperature?: number;
  tools?: unknown[];          // Anthropic tool schema: {name, description, input_schema}
  toolChoice?: unknown;       // {type:"auto"|"any"|"tool", name?}
  stopSequences?: string[];
  signal?: AbortSignal;
  /** §34 L1.1 — OPT-IN trace: a DIRECT callClaude caller (one that bypasses callModel/routedChatCompletion)
   *  passes this to record the call in paige_llm_trace. callModel's internal path leaves it unset, so its
   *  calls trace once at callModel — never double here. */
  trace?: TraceCtx;
}

export interface ClaudeToolUse { id: string; name: string; input: unknown }

export interface ClaudeResult {
  text: string;                 // concatenated text blocks ("" if none)
  toolUses: ClaudeToolUse[];    // tool_use blocks ([] if none)
  stopReason: string | null;
  // Anthropic's own usage object, passed through verbatim (see the `usage: data?.usage` return below).
  // input_tokens is the UNCACHED REMAINDER — the real prompt size is
  // input_tokens + cache_creation_input_tokens + cache_read_input_tokens. The cache fields were always
  // present at runtime; this type was the only thing hiding them.
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
  raw: unknown;
}

function apiKey(): string {
  const k = Deno.env.get("ANTHROPIC_API_KEY");
  if (!k) throw new Error("ANTHROPIC_API_KEY is not set");
  return k;
}

export async function callClaude(opts: ClaudeCallOpts): Promise<ClaudeResult> {
  const model = opts.model ?? tierModel(opts.tier ?? "reasoning");
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 2048,
    messages: opts.messages,
  };
  if (opts.system) body.system = opts.system;
  if (opts.temperature != null && !modelRejectsSampling(model)) body.temperature = opts.temperature;
  if (opts.tools?.length) body.tools = opts.tools;
  if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  if (opts.stopSequences?.length) body.stop_sequences = opts.stopSequences;

  const t0 = Date.now();
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey(),
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!resp.ok) {
      const detail = await anthropicFailureDiagnostic(resp);
      throw new Error(`Anthropic ${resp.status}: ${detail}`);
    }
    const data = await resp.json();
    const blocks: unknown[] = Array.isArray(data?.content) ? data.content : [];
    const text = blocks
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("");
    const toolUses: ClaudeToolUse[] = blocks
      .filter((b: any) => b?.type === "tool_use")
      .map((b: any) => ({ id: b.id, name: b.name, input: b.input }));
    // §34 L1.1 — opt-in trace for DIRECT callers (never set on the callModel path → no double).
    if (opts.trace) {
      traceLLMCall({
        ...opts.trace,
        provider: "anthropic",
        model,
        job_kind: opts.trace.job_kind ?? "text",
        modality: "text",
        status: "success",
        tokens_in: data?.usage?.input_tokens ?? null,
        tokens_out: data?.usage?.output_tokens ?? null,
        cache_read_input_tokens: data?.usage?.cache_read_input_tokens ?? null,
        cache_creation_input_tokens: data?.usage?.cache_creation_input_tokens ?? null,
        latency_ms: Date.now() - t0,
        input: opts.messages,
        output: text,
        metadata: { caller_function: opts.trace.agent_id },
      });
    }
    return { text, toolUses, stopReason: data?.stop_reason ?? null, usage: data?.usage ?? null, raw: data };
  } catch (e) {
    if (opts.trace) {
      traceLLMCall({
        ...opts.trace,
        provider: "anthropic",
        model,
        job_kind: opts.trace.job_kind ?? "text",
        modality: "text",
        status: "error",
        latency_ms: Date.now() - t0,
        input: opts.messages,
        error_class: (e as Error)?.name ?? "error",
        error_message: (e as Error)?.message ?? String(e),
        metadata: { caller_function: opts.trace.agent_id },
      });
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// OpenAI-/gateway-compatible shim.
// Lets existing call sites migrate with a near-mechanical edit:
//   fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {..body:{model,messages,tools,response_format}})
//     -> chatCompletionCompat({model,messages,tools,response_format})
// Returns an OpenAI-shaped response so downstream `choices[0].message.content`
// / `tool_calls` parsing keeps working.
// ---------------------------------------------------------------------------
interface OpenAIStyleBody {
  model?: string;
  messages: { role: string; content: unknown }[];
  tools?: { type: string; function: { name: string; description?: string; parameters?: unknown } }[];
  tool_choice?: unknown;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type?: string } | undefined;
}

// ── supports_documents capability (#587) ────────────────────────────────────────────────────
// Which Claude tier can natively read a PDF/document content block. Sonnet (reasoning) reads PDFs
// via the Anthropic `document` block; Haiku (classification) is the cheap text tier we do NOT route
// document turns to. This is the router's `supports_documents` capability, honored at the ONE
// tier-resolution seam below so EVERY caller's document turn lands on a PDF-capable model — not just
// paige-ai-chat (§18 one home). Non-document turns are unaffected.
export function tierSupportsDocuments(tier: ClaudeTier): boolean {
  return tier === "reasoning";
}
const DOCUMENT_CAPABLE_TIER: ClaudeTier = "reasoning";

// True if any message carries a PDF/document block — an already-Anthropic `document` block OR an
// OpenAI-style image_url/file whose data-URI media type is application/pdf (the shape paige-ai-chat
// inlines, which toClaudeContent converts to a document block). Images are excluded on purpose:
// the classification tier is vision-capable, so only PDFs force the document-capable upgrade.
type LooseContentBlock = {
  type?: string;
  image_url?: { url?: string };
  file?: { file_data?: string; url?: string; data?: string };
  url?: string;
  data?: string;
};
function messagesCarryDocument(messages: OaiMessage[]): boolean {
  for (const m of messages ?? []) {
    const c = m?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c as LooseContentBlock[]) {
      if (b?.type === "document") return true;
      const dataUrl: string | undefined =
        b?.type === "image_url" ? b?.image_url?.url :
        b?.type === "file" ? (b?.file?.file_data ?? b?.file?.url ?? b?.data) :
        typeof b?.url === "string" ? b.url : undefined;
      if (typeof dataUrl === "string" && /^data:application\/pdf;base64,/.test(dataUrl)) return true;
    }
  }
  return false;
}

// Resolve the Claude tier for a gateway request, honoring supports_documents: a turn carrying a
// PDF/document block is upgraded to the document-capable tier so it never lands on a model that
// can't read the file. This is the ONE place both the streaming (buildClaudeRequest) and the
// non-streaming (chatCompletionCompat) paths resolve their tier, so the capability binds every
// caller identically. A caller-supplied tierOverride still wins EXCEPT it is upgraded (never
// downgraded) when a document is present.
export function resolveRequestTier(body: OpenAIStyleBody, tierOverride?: ClaudeTier): ClaudeTier {
  const base = tierOverride ?? tierForLegacyModel(body.model);
  if (!tierSupportsDocuments(base) && messagesCarryDocument(body.messages as OaiMessage[])) {
    return DOCUMENT_CAPABLE_TIER;
  }
  return base;
}

export async function chatCompletionCompat(body: OpenAIStyleBody, tierOverride?: ClaudeTier): Promise<any> {
  // Extract system + translate messages (incl. assistant tool_calls -> tool_use).
  const { system: sys0, msgs } = splitMessages(body.messages as OaiMessage[]);
  let system = sys0;

  // response_format json -> nudge via system (Anthropic has no json_object flag).
  if (body.response_format?.type && /json/.test(body.response_format.type)) {
    system = (system ? system + "\n\n" : "") +
      "Respond with a single valid JSON value only. No prose, no markdown fences.";
  }

  // Translate OpenAI tool schema -> Anthropic tool schema.
  const tools = body.tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));

  const result = await callClaude({
    messages: msgs,
    system: system || undefined,
    model: undefined,
    // #587 supports_documents: a PDF-bearing turn is upgraded to the document-capable tier here.
    tier: resolveRequestTier(body, tierOverride),
    maxTokens: body.max_tokens ?? 2048,
    temperature: body.temperature,
    tools,
    toolChoice: body.tool_choice && tools?.length ? { type: "auto" } : undefined,
  });

  const tool_calls = result.toolUses.map((tu) => ({
    id: tu.id,
    type: "function",
    function: { name: tu.name, arguments: JSON.stringify(tu.input ?? {}) },
  }));

  return {
    id: (result.raw as any)?.id ?? "msg",
    object: "chat.completion",
    model: (result.raw as any)?.model,
    choices: [{
      index: 0,
      finish_reason: result.stopReason === "tool_use" ? "tool_calls" : "stop",
      message: {
        role: "assistant",
        content: result.text || null,
        ...(tool_calls.length ? { tool_calls } : {}),
      },
    }],
    // Cache counts ride ALONGSIDE the OpenAI-shaped pair and are never folded into prompt_tokens:
    // input_tokens is the uncached remainder, and meter_llm_usage bills tokens_in + tokens_out, so
    // widening prompt_tokens would change every tenant's metered quantity. Additive only — every
    // consumer reads NAMED keys, so adding two cannot break one: model-router emit, gatewayCompat
    // trace, eval scorers, and paige-context-router:316 — which reads `usage.total_tokens`, a field
    // this compat object has NEVER emitted, so its token counter has always been zero. Named here
    // because an inventory that omits a consumer is worth less than no inventory at all; the dead
    // read is pre-existing and tracked separately, not introduced or fixed here.
    usage: result.usage
      ? {
          prompt_tokens: result.usage.input_tokens,
          completion_tokens: result.usage.output_tokens,
          cache_read_input_tokens: result.usage.cache_read_input_tokens,
          cache_creation_input_tokens: result.usage.cache_creation_input_tokens,
        }
      : undefined,
  };
}

// Drop-in replacement for `fetch(gatewayUrl, init)` on NON-streaming chat calls.
// Returns a Response-like object so existing `.ok` / `.status` / `await x.json()`
// handling keeps working unchanged — the only migration edit at a call site is
// swapping `fetch("https://ai.gateway.lovable.dev/v1/chat/completions", init)`
// for `gatewayCompat("anthropic", init)`. (Streaming call sites are handled
// separately; do NOT use this for stream:true requests.)
// Translate an OpenAI-/gateway-style body into an Anthropic Messages request object.
function buildClaudeRequest(body: OpenAIStyleBody): Record<string, unknown> {
  const { system: sys0, msgs } = splitMessages(body.messages as OaiMessage[]);
  let system = sys0;
  if (body.response_format?.type && /json/.test(body.response_format.type)) {
    system = (system ? system + "\n\n" : "") +
      "Respond with a single valid JSON value only. No prose, no markdown fences.";
  }
  const tools = body.tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
  // #587 supports_documents: a PDF-bearing turn is upgraded to the document-capable tier here.
  const model = tierModel(resolveRequestTier(body));
  const req: Record<string, unknown> = {
    model,
    max_tokens: body.max_tokens ?? 2048,
    messages: msgs,
    // Prompt caching (automatic): the chat re-sends a large stable prefix every turn
    // (persona + voice + context blocks + tools). Top-level cache_control makes the API
    // cache the prefix and move the breakpoint forward as conversations grow — cache
    // reads bill at 0.1x, which is the single biggest Anthropic-spend lever for the
    // main chat. Minimum cacheable length (Sonnet 5: 1024 tokens) is far exceeded by
    // the assembled chat prompt; prompts below the floor cache silently as no-ops.
    cache_control: { type: "ephemeral" },
  };
  if (system) req.system = system;
  if (body.temperature != null && !modelRejectsSampling(model)) req.temperature = body.temperature;
  if (tools?.length) { req.tools = tools; req.tool_choice = body.tool_choice ? { type: "auto" } : { type: "auto" }; }
  // U2 — extended thinking, GATED OFF by default. ONLY when the caller explicitly opts in
  // (`paige_thinking === true` on the parsed request body) do we emit Anthropic's thinking block.
  // With the flag absent/false this whole branch is skipped and the request object is byte-for-byte
  // what it is today. Anthropic requires temperature UNSET and max_tokens > budget_tokens when
  // thinking is enabled, so we enforce both only on the opt-in path.
  if ((body as { paige_thinking?: unknown }).paige_thinking === true) {
    const budget = 8000; // U2 — Studio design-agent extended-thinking budget (spec Upgrade 2)
    req.thinking = { type: "enabled", budget_tokens: budget };
    delete req.temperature;
    if ((req.max_tokens as number) <= budget) req.max_tokens = budget + 2048;
  }
  return req;
}

// Call Anthropic with stream:true and translate its SSE events into OpenAI-style
// SSE (`data: {choices:[{delta:{content|tool_calls}, finish_reason}]}` ... `data: [DONE]`),
// so existing frontends/edge readers that parse the OpenAI stream keep working.
async function streamAnthropicAsOpenAI(
  reqBody: Record<string, unknown>,
  trace?: TraceCtx,
): Promise<{ ok: boolean; status: number; body?: ReadableStream<Uint8Array> }> {
  const streamStarted = Date.now();
  const streamModel = typeof reqBody?.model === "string" ? reqBody.model : null;
  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ ...reqBody, stream: true }),
  });
  if (!resp.ok || !resp.body) {
    // §34 L1.1 — a rejected STREAMING request (400/429/500) early-returns before the ReadableStream (and
    // its finally-trace) is ever built. Without this, the most common streaming failure — the exact 400
    // the live HOTFIX references — would go UNTRACED and under-report the fleet error rate (§13). Emit it.
    const detail = await anthropicFailureDiagnostic(resp);
    if (trace) {
      traceLLMCall({
        ...trace,
        provider: "anthropic",
        model: streamModel,
        job_kind: trace.job_kind ?? "chat",
        modality: "text",
        status: "error",
        latency_ms: Date.now() - streamStarted,
        input: (reqBody as { messages?: unknown }).messages,
        error_class: resp.ok ? "missing_body" : `http_${resp.status}`,
        error_message: detail,
        metadata: { caller_function: trace.agent_id },
      });
    }
    return { ok: false, status: resp.status };
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const upstream = resp.body.getReader();
  const send = (c: ReadableStreamDefaultController<Uint8Array>, obj: unknown) =>
    c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";
      let toolIndex = -1;
      const blockToTool = new Map<number, number>();
      let stopReason = "end_turn";
      // §34 L1.1 — usage/output capture for the streaming trace row (net-new parse: Anthropic ships
      // input_tokens on message_start and cumulative output_tokens on message_delta).
      let inTok: number | null = null;
      let outTok: number | null = null;
      // Cache counts ride the SAME message_start usage object that input_tokens does.
      let cacheReadTok: number | null = null;
      let cacheCreateTok: number | null = null;
      let outText = "";
      let streamErrored = false;
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
            if (!js) continue;
            let ev: any;
            try { ev = JSON.parse(js); } catch { continue; }
            if (ev.type === "message_start") {
              inTok = ev.message?.usage?.input_tokens ?? inTok;
              // `?? previous`, never `?? null`: an absent field must not erase a reported value.
              cacheReadTok = ev.message?.usage?.cache_read_input_tokens ?? cacheReadTok;
              cacheCreateTok = ev.message?.usage?.cache_creation_input_tokens ?? cacheCreateTok;
            } else if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
              toolIndex++;
              blockToTool.set(ev.index, toolIndex);
              send(controller, { choices: [{ index: 0, delta: { tool_calls: [{ index: toolIndex, id: ev.content_block.id, type: "function", function: { name: ev.content_block.name, arguments: "" } }] }, finish_reason: null }] });
            } else if (ev.type === "content_block_start" && ev.content_block?.type === "redacted_thinking") {
              // U2 — redacted (safety-encrypted) thinking. Surface a marker on the DISTINCT channel so
              // the client can note it without any answer-text contamination. Only ever present on the
              // opt-in path; the tool_use / text_delta paths above are unchanged when no thinking arrives.
              send(controller, { choices: [{ index: 0, delta: { paige_thinking: "", paige_thinking_redacted: true }, finish_reason: null }] });
            } else if (ev.type === "content_block_delta") {
              if (ev.delta?.type === "text_delta") {
                if (outText.length < 40000) outText += ev.delta.text; // bounded — excerpt truncates at 32KB anyway
                send(controller, { choices: [{ index: 0, delta: { content: ev.delta.text }, finish_reason: null }] });
              } else if (ev.delta?.type === "input_json_delta") {
                const ti = blockToTool.get(ev.index) ?? 0;
                send(controller, { choices: [{ index: 0, delta: { tool_calls: [{ index: ti, function: { arguments: ev.delta.partial_json } }] }, finish_reason: null }] });
              } else if (ev.delta?.type === "thinking_delta") {
                // U2 — extended thinking on a DISTINCT channel (`delta.paige_thinking`, never `content`),
                // so the client tells reasoning apart from answer text. This delta type only arrives when
                // the request opted in (default OFF), so the text_delta / input_json_delta paths above are
                // byte-for-byte unchanged when no thinking block is present.
                send(controller, { choices: [{ index: 0, delta: { paige_thinking: ev.delta.thinking }, finish_reason: null }] });
              }
            } else if (ev.type === "message_delta") {
              if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
              if (ev.usage?.output_tokens != null) outTok = ev.usage.output_tokens; // cumulative final count
              // Opportunistic secondary read — message_delta is NOT documented to echo cache counts.
              // Explicit null-checks so an absent field keeps the message_start value.
              if (ev.usage?.cache_read_input_tokens != null) cacheReadTok = ev.usage.cache_read_input_tokens;
              if (ev.usage?.cache_creation_input_tokens != null) cacheCreateTok = ev.usage.cache_creation_input_tokens;
            } else if (ev.type === "message_stop") {
              send(controller, { choices: [{ index: 0, delta: {}, finish_reason: stopReason === "tool_use" ? "tool_calls" : "stop" }] });
            }
          }
        }
      } catch (_e) {
        streamErrored = true;
        // fall through to DONE so the client stream terminates cleanly
      } finally {
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
        // §34 L1.1 — one trace row for the whole streamed turn, fired after the stream drains (so tokens
        // are known). Detached best-effort inside traceLLMCall; honest status if the stream broke midway.
        if (trace) {
          traceLLMCall({
            ...trace,
            provider: "anthropic",
            model: streamModel,
            job_kind: trace.job_kind ?? "chat",
            modality: "text",
            status: streamErrored ? "error" : "success",
            tokens_in: inTok,
            tokens_out: outTok,
            cache_read_input_tokens: cacheReadTok,
            cache_creation_input_tokens: cacheCreateTok,
            latency_ms: Date.now() - streamStarted,
            input: (reqBody as { messages?: unknown }).messages,
            output: outText,
            error_class: streamErrored ? "stream_interrupted" : null,
            metadata: { caller_function: trace.agent_id },
          });
        }
      }
    },
  });
  return { ok: true, status: 200, body: stream };
}

export async function gatewayCompat(
  _url: string,
  init: { body?: string; method?: string; headers?: unknown },
  trace?: TraceCtx,
): Promise<{ ok: boolean; status: number; body?: ReadableStream<Uint8Array>; json: () => Promise<any>; text: () => Promise<string> }> {
  const parsed: OpenAIStyleBody & { stream?: boolean } = init?.body ? JSON.parse(init.body) : ({} as any);
  const started = Date.now();

  // 0) BUDGET ENFORCEMENT (docs/brain/paige-router-budget-contract.md, #1102/#1105): the chat
  //    GATEWAY is the third distinct model-call entry point (after callModel and
  //    routedChatCompletion) and the highest-traffic one — the tenant/client chat front door,
  //    streaming included. Chat is REASONING-band work: at the hard ceiling it fails closed
  //    (BudgetExceeded surfaces in the turn) rather than silently degrading. The gate hit rides
  //    the ctx so BOTH trace writers (streamed and non-streamed) record it via their spreads.
  let budgetGateHits: { budget: Record<string, unknown> } | null = null;
  if (trace?.tenant_id) {
    const admin = traceAdmin();
    if (admin) {
      const ceiling = await resolveCeiling(admin as unknown as BudgetDb, trace.tenant_id);
      const accrued = await accruedSpendToday(admin as unknown as BudgetDb, trace.tenant_id);
      if (accrued == null) {
        // Accrual unknown ≠ $0. Proceed ungated but LOUD — observable, not silent.
        console.warn("[claude-gateway] budget accrual unknown; chat proceeds ungated (budget_accrual_unknown)");
      } else {
        const d = enforceBudget({ accrued_usd: accrued, ceiling_usd: ceiling, band: "reasoning" });
        if (d.gate) {
          budgetGateHits = { budget: { level: d.gate.replace("budget_", ""), accrued_usd: d.accrued_usd, ceiling_usd: d.ceiling_usd, band: "reasoning" } };
        }
        if (d.decision === "block") {
          const err = new BudgetExceeded(d.ceiling_usd, d.accrued_usd);
          traceLLMCall({
            ...(trace ?? {}),
            provider: "router_budget",
            model: null,
            job_kind: trace.job_kind ?? "chat",
            modality: "text",
            status: "error",
            latency_ms: Date.now() - started,
            input: parsed.messages,
            output: null,
            error_class: "budget_exceeded",
            error_message: err.message,
            doctrine_gate_hits: budgetGateHits,
            metadata: { caller_function: trace.agent_id },
          });
          throw err;
        }
      }
    }
  }
  // ctx carries the gate hit into every downstream trace writer (both spread it).
  const ctx: TraceCtx = { ...(trace ?? {}), ...(budgetGateHits ? { doctrine_gate_hits: budgetGateHits } as TraceCtx : {}) };

  try {
    if (parsed.stream === true) {
      // The streamed turn traces itself when it drains (tokens are only known then). Pass a context
      // ({} if the caller didn't thread one) so the stream always writes an honest row. §34 L1.1.
      const r = await streamAnthropicAsOpenAI(buildClaudeRequest(parsed), ctx);
      return { ok: r.ok, status: r.status, body: r.body, json: async () => ({}), text: async () => "" };
    }
    const data = await chatCompletionCompat(parsed);
    // §34 L1.1 — non-stream gateway call is a DISTINCT entry (not via callModel/routedChatCompletion),
    // so tracing here never double-counts. Always writes a row (tenant null until a caller threads ctx).
    const usage = data?.usage ?? {};
    traceLLMCall({
      ...ctx,
      provider: "anthropic",
      model: data?.model ?? (typeof parsed.model === "string" ? parsed.model : null),
      job_kind: ctx.job_kind ?? "chat",
      modality: "text",
      status: "success",
      tokens_in: usage.prompt_tokens ?? null,
      tokens_out: usage.completion_tokens ?? null,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
      latency_ms: Date.now() - started,
      input: parsed.messages,
      output: data?.choices?.[0]?.message?.content ?? null,
      metadata: { caller_function: ctx.agent_id },
    });
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    traceLLMCall({
      ...ctx,
      provider: "anthropic",
      model: typeof parsed.model === "string" ? parsed.model : null,
      job_kind: ctx.job_kind ?? "chat",
      modality: "text",
      status: "error",
      latency_ms: Date.now() - started,
      input: parsed.messages,
      error_class: (e as Error)?.name ?? "error",
      error_message: msg,
      metadata: { caller_function: trace?.agent_id },
    });
    const m = msg.match(/Anthropic (\d{3})/);
    const status = m ? Number(m[1]) : 500;
    return { ok: false, status, json: async () => ({ error: msg }), text: async () => msg };
  }
}
