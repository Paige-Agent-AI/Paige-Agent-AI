// _shared/model-router.ts — Paige Model Router (#110).
//
// One seam that decides WHICH model does a job, by JOB KIND — so the high-volume grunt
// work (classify, extract, summarize, score, internal first-drafts) can ride cheap open
// models via Featherless, while Claude keeps the reasoning and everything that ships to a
// human or takes an action. This is the economic enabler under the Client Heartbeat (#111)
// and any per-client-at-scale work: reasoning about every client is only affordable if the
// cheap parts are actually cheap.
//
// HARD RULES (non-negotiable, enforced below):
//   1. SENSITIVE jobs — an approval/routing DECISION, a final outbound message, final
//      client-facing copy, anything side-effecting — NEVER route to an open model. They
//      always go to Claude's reasoning tier. Cost is not worth a wrong autonomous act or
//      an off-voice message under the coach's brand (§3/§8).
//   2. Client-facing copy an open model drafted gets a Claude voice-polish pass before it
//      reaches anyone (helper below); open models draft, Claude finishes.
//   3. Graceful fallback: if FEATHERLESS_API_KEY is unset, or Featherless errors/times out,
//      the job silently falls back to Claude. The router can never harden into an outage —
//      worst case is "we paid Claude prices," never "the feature broke."
//
// Until FEATHERLESS_API_KEY is set every job resolves to Claude, so adopting this is safe
// today and the cheap tier activates automatically once the key lands.

import {
  chatCompletionCompat,
  type ClaudeTier,
  CLAUDE_REASONING,
  CLAUDE_CLASSIFICATION,
} from "./claude.ts";
import {
  accruedSpendToday,
  BudgetExceeded,
  type BudgetBand,
  type BudgetDecision,
  enforceBudget,
  resolveCeiling,
  type BudgetDb,
} from "./router-budget/mod.ts";

// ── Job taxonomy ────────────────────────────────────────────────────────────
export type JobKind =
  // CHEAP — internal, high-volume, low-stakes; open-model-eligible
  | "classify" | "extract" | "summarize" | "score" | "tone_check" | "internal_first_draft"
  // REASONING — Claude reasoning tier
  | "chat" | "plan" | "propose" | "doc_draft"
  // SENSITIVE — Claude reasoning tier, NEVER an open model
  | "approval_decision" | "outbound_final" | "client_copy_final" | "action_decision";

const CHEAP_KINDS = new Set<JobKind>([
  "classify", "extract", "summarize", "score", "tone_check", "internal_first_draft",
]);
// The middle band of the union — Claude reasoning tier, but not side-effecting/sensitive. Named as
// its own set (not inline literals) so JOB_KINDS below is COMPOSED from all three bands and can
// never silently omit a member as the union grows.
const REASONING_KINDS = new Set<JobKind>([
  "chat", "plan", "propose", "doc_draft",
]);
const SENSITIVE_KINDS = new Set<JobKind>([
  "approval_decision", "outbound_final", "client_copy_final", "action_decision",
]);

// The complete runtime set of valid JobKinds — the JobKind union is compile-time only, so this is
// the ONE source of truth a runtime caller (e.g. the subagent-forge config.job_kind validator, §34-L5)
// checks against, so a silent typo can't mis-route an agent. Read-only + ADDITIVE: it changes no
// routing behavior. Composed FROM the three band sets so it can never drift from them — a new
// JobKind added to any band is automatically a member here.
export const JOB_KINDS: ReadonlySet<JobKind> = new Set<JobKind>([
  ...CHEAP_KINDS,
  ...REASONING_KINDS,
  ...SENSITIVE_KINDS,
]);

/** Runtime type-guard: is `v` a valid JobKind? The one validator a caller should use. */
export function isJobKind(v: unknown): v is JobKind {
  return typeof v === "string" && JOB_KINDS.has(v as JobKind);
}

/** The default job_kind for a soft sub-agent when none is set — its output is an internal draft
 *  Paige integrates/reviews (open-model-eligible). Mirrors invokeSoft's inline default (§14). */
export const DEFAULT_SUBAGENT_JOB_KIND: JobKind = "internal_first_draft";

export interface Route {
  provider: "anthropic" | "featherless";
  model?: string;        // set only for featherless
  tier: ClaudeTier;      // the Claude tier used when provider=anthropic (or on fallback)
  reason: string;
}

// Featherless is OpenAI-compatible. Base URL is env-overridable so we can retune without a
// deploy. A wrong/removed model id is caught by the fallback, never a hard failure.
const FEATHERLESS_BASE = Deno.env.get("FEATHERLESS_BASE_URL") ?? "https://api.featherless.ai/v1";
function featherlessKey(): string | undefined { return envKey("FEATHERLESS_API_KEY") || undefined; }

// Per-job-kind Featherless model map, specialized instead of one 8B for everything (owner
// directive 2026-07-15: "don't default and assume" — every id below was checked against
// Featherless's live model catalog before being wired in). Each is env-overridable
// (FEATHERLESS_MODEL_<KIND>) so the mix can be retuned without a code deploy.
// NOTE (plan): the platform is on Featherless's "Feather Per-Request" DEVELOPER plan
// (subscribed 2026-08-10) — per-request billing from a credit balance, with NO model-size cap,
// so the 14B/70B ids below (and the 70B open-flexible default) are reachable. If a configured id
// is ever unreachable (e.g. a plan downgrade), featherlessChat returns null so the callers
// degrade to Claude, never a hard failure: routedChatCompletion self-rescues in-file, and the
// callModel open-flexible degrade-to-Claude path lands in HOTFIX A / PR #436 (complementary).
const FEATHERLESS_MODEL_BY_KIND: Partial<Record<JobKind, string>> = {
  classify: "Qwen/Qwen2.5-7B-Instruct",             // best cheap-tier JSON/label adherence
  score: "Qwen/Qwen2.5-7B-Instruct",                 // numeric/rubric-out, high-volume
  tone_check: "Qwen/Qwen2.5-14B-Instruct",           // needs more nuance than a raw label
  extract: "Qwen/Qwen2.5-14B-Instruct",              // structured-field extraction to JSON
  summarize: "Qwen/Qwen2.5-14B-Instruct",            // coherence for briefs/heartbeat feeds
  internal_first_draft: "meta-llama/Llama-3.3-70B-Instruct", // internal draft only, never sent
};
// The Featherless model the open-flexible (callModel) tier uses when the caller passes no
// model_override, and the last-resort default for any future CHEAP_KIND lacking a per-kind map
// entry above. Env-overridable (§10 config-as-data) so the owner can rotate the model with NO
// code deploy: FEATHERLESS_DEFAULT_MODEL is the primary name; FEATHERLESS_CHEAP_MODEL is kept as
// a back-compat alias. Default = Llama-3.3-70B (owner's ranked #1 cheap-tier pick, allow-listed):
// stronger JSON/instruction-following than the prior 8B, which lowers the malformed-output rate
// that would otherwise trigger the pricier Claude rescue. A cheaper alternative (Qwen2.5-14B) is a
// one-env-var change away if per-request spend warrants it.
const FEATHERLESS_DEFAULT_MODEL =
  Deno.env.get("FEATHERLESS_DEFAULT_MODEL") ??
  Deno.env.get("FEATHERLESS_CHEAP_MODEL") ??
  "meta-llama/Llama-3.3-70B-Instruct";

function featherlessModelFor(jobKind: JobKind): string {
  const envOverride = Deno.env.get(`FEATHERLESS_MODEL_${jobKind.toUpperCase()}`);
  return envOverride || FEATHERLESS_MODEL_BY_KIND[jobKind] || FEATHERLESS_DEFAULT_MODEL;
}

/** Decide who does a job. Pure + synchronous — safe to log/inspect. */
export function pickRoute(jobKind: JobKind): Route {
  if (SENSITIVE_KINDS.has(jobKind)) {
    return { provider: "anthropic", tier: "reasoning", reason: `sensitive:${jobKind} → Claude reasoning (never an open model)` };
  }
  if (CHEAP_KINDS.has(jobKind)) {
    if (featherlessKey()) {
      return { provider: "featherless", model: featherlessModelFor(jobKind), tier: "classification", reason: `cheap:${jobKind} → open model (Claude classification on fallback)` };
    }
    return { provider: "anthropic", tier: "classification", reason: `cheap:${jobKind} → Claude classification (Featherless not configured)` };
  }
  // reasoning kinds (chat/plan/propose/doc_draft) and any unknown → Claude reasoning
  return { provider: "anthropic", tier: "reasoning", reason: `reasoning:${jobKind} → Claude reasoning` };
}

interface OpenAIStyleBody {
  model?: string;
  messages: { role: string; content: unknown }[];
  tools?: { type: string; function: { name: string; description?: string; parameters?: unknown } }[];
  tool_choice?: unknown;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type?: string } | undefined;
}

// Featherless (OpenAI-compat) non-streaming call. Returns an OpenAI-shaped response, or
// null on ANY problem so the caller falls back to Claude. Tools are NOT sent to open
// models here (cheap-tier jobs are text in / text out); if a caller passes tools it's a
// signal the job isn't actually cheap — we fall back to Claude.
async function featherlessChat(body: OpenAIStyleBody, model: string): Promise<any | null> {
  const key = featherlessKey();
  if (!key) return null;
  if (body.tools?.length) return null; // tool-use jobs are not cheap-tier; use Claude
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const resp = await fetch(`${FEATHERLESS_BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: body.messages,
        max_tokens: body.max_tokens ?? 2048,
        temperature: body.temperature ?? 0.4,
        ...(body.response_format?.type && /json/.test(body.response_format.type)
          ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) { clearTimeout(t); console.warn(`model-router: featherless ${resp.status}, falling back to Claude`); return null; }
    const data = await resp.json();
    clearTimeout(t);
    if (!data?.choices?.[0]?.message) return null;
    return data;
  } catch (e) {
    console.warn("model-router: featherless error, falling back to Claude:", (e as Error)?.message);
    return null;
  }
}

/**
 * Route one completion by job kind. Sensitive/reasoning jobs go straight to Claude;
 * cheap jobs try Featherless and fall back to Claude on any issue. Same OpenAI-shaped
 * return as gatewayCompat/chatCompletionCompat, so call sites parse choices[0].message
 * unchanged.
 */
export async function routedChatCompletion(jobKind: JobKind, body: OpenAIStyleBody, trace?: TraceCtx): Promise<any> {
  const route = pickRoute(jobKind);
  const started = Date.now();

  // BUDGET ENFORCEMENT (docs/brain/paige-router-budget-contract.md, #1102): this is the
  // routed-TEXT path — the chat traffic — a DISTINCT entry point from callModel, and both
  // enforce. Band maps from the job kind's own band (the same three sets pickRoute uses).
  // No tenant in the trace ctx (platform/system turn) or no admin client → ungated, like
  // audit/persist. The gate hit rides the trace's doctrine_gate_hits on every path.
  const budgetBand: BudgetBand = SENSITIVE_KINDS.has(jobKind)
    ? "sensitive"
    : REASONING_KINDS.has(jobKind) ? "reasoning" : "cheap";
  let budgetCheck: BudgetDecision | null = null;
  if (trace?.tenant_id) {
    const budgetAdmin = getAdmin();
    if (budgetAdmin) {
      const ceiling = await resolveCeiling(budgetAdmin as unknown as BudgetDb, trace.tenant_id);
      const accrued = await accruedSpendToday(budgetAdmin as unknown as BudgetDb, trace.tenant_id);
      if (accrued == null) {
        // Accrual unknown ≠ $0. Proceed ungated but LOUD — observable, not silent.
        console.warn("[model-router] budget accrual unknown; chat call proceeds ungated (budget_accrual_unknown)");
      } else {
        budgetCheck = enforceBudget({ accrued_usd: accrued, ceiling_usd: ceiling, band: budgetBand });
        if (budgetCheck.decision === "block") {
          const err = new BudgetExceeded(budgetCheck.ceiling_usd, budgetCheck.accrued_usd);
          traceLLMCall({
            tenant_id: trace.tenant_id,
            task_id: trace.task_id ?? null,
            agent_id: trace.agent_id ?? null,
            parent_trace_id: trace.parent_trace_id ?? null,
            provider: "router_budget",
            model: null,
            job_kind: trace.job_kind ?? jobKind,
            modality: "text",
            tier: route.tier,
            status: "error",
            latency_ms: Date.now() - started,
            input: body.messages,
            output: null,
            error_class: "budget_exceeded",
            error_message: err.message,
            doctrine_gate_hits: { budget: { level: "exceeded", accrued_usd: budgetCheck.accrued_usd, ceiling_usd: budgetCheck.ceiling_usd, band: budgetBand } },
            metadata: { caller_function: trace.agent_id },
          });
          throw err;
        }
      }
    }
  }

  // §34 L1.1: one trace row per routed text call. This is a DISTINCT entry point (its callers do not go
  // through callModel), so tracing here never double-counts. The shared helpers it calls
  // (featherlessChat / chatCompletionCompat / callClaude) do NOT trace — this is the single trace layer
  // for the routed-text path. Detached best-effort (never blocks the return).
  const emit = (provider: string, resp: any, status: "success" | "error", err?: unknown) => {
    const usage = resp?.usage ?? {};
    const tokensIn = usage.prompt_tokens ?? null;
    const tokensOut = usage.completion_tokens ?? null;
    // Cache counts are recorded but NOT priced here — pricing cached tokens moves a shipped cost cap
    // and is a separate, owner-visible decision. Recording them first is what makes that decision
    // answerable with data instead of instinct.
    const cacheRead = usage.cache_read_input_tokens ?? null;
    const cacheCreate = usage.cache_creation_input_tokens ?? null;
    traceLLMCall({
      tenant_id: trace?.tenant_id ?? null,
      task_id: trace?.task_id ?? null,
      agent_id: trace?.agent_id ?? null,
      parent_trace_id: trace?.parent_trace_id ?? null,
      provider,
      model: resp?.model ?? null,
      job_kind: trace?.job_kind ?? jobKind,
      modality: "text",
      tier: route.tier,
      status,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheCreate,
      latency_ms: Date.now() - started,
      cost_estimate_usd: status === "success"
        ? (estimateCost(provider, "text", tokensIn ?? undefined, tokensOut ?? undefined, resp?.model ?? null) ?? null)
        : null,
      input: body.messages,
      output: status === "success" ? (resp?.choices?.[0]?.message?.content ?? null) : null,
      error_class: status === "error" ? ((err as Error)?.name ?? "error") : null,
      error_message: status === "error" ? ((err as Error)?.message ?? String(err)) : null,
      doctrine_gate_hits: budgetCheck?.gate
        ? { budget: { level: budgetCheck.gate.replace("budget_", ""), accrued_usd: budgetCheck.accrued_usd, ceiling_usd: budgetCheck.ceiling_usd, band: budgetCheck.band } }
        : null,
      metadata: { caller_function: trace?.agent_id },
    });
  };
  try {
    if (route.provider === "featherless" && route.model) {
      const open = await featherlessChat(body, route.model);
      if (open) { emit("featherless", open, "success"); return open; }
      // fall through to Claude on any failure
    }
    const claudeResp = await chatCompletionCompat(body, route.tier);
    emit("anthropic", claudeResp, "success");
    return claudeResp;
  } catch (e) {
    emit(route.provider === "featherless" ? "featherless" : "anthropic", null, "error", e);
    throw e;
  }
}

/**
 * Voice-polish pass (§3): take copy an open model drafted and have Claude finish it in the
 * tenant's voice before it reaches a human. Sensitive/client-facing copy should ALWAYS end
 * on a Claude pass — cheap models draft, Claude ships. Returns the polished text (or the
 * original on any failure — never blocks).
 */
export async function claudeVoicePolish(draft: string, brandVoice?: string): Promise<string> {
  const d = (draft ?? "").trim();
  if (d.length < 2) return d;
  try {
    const resp = await chatCompletionCompat({
      messages: [
        { role: "system", content: `You polish marketing/communication copy so it reads in a direct, confident, human founder voice.${brandVoice ? ` Brand voice: ${brandVoice}.` : ""} Never use "AI-powered", "streamline", "seamless", or "empower". Keep the meaning and structure; tighten wording only. Return ONLY the polished copy — no preamble.` },
        { role: "user", content: d },
      ],
    }, "reasoning");
    const out = resp?.choices?.[0]?.message?.content;
    return typeof out === "string" && out.trim().length > 1 ? out.trim() : d;
  } catch { return d; }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// FULL-MODALITY MODEL ROUTER (Vibe Studio) — EXTENDS the text-only seam above.
//
// The text-only `pickRoute`/`routedChatCompletion` above answers "which model for a text JOB
// KIND." This section answers the bigger question the Vibe Studio needs: "which provider for
// which MODALITY at which cost TIER" — text, image, image-with-text, 3d, audio-voice, doc-render
// — behind ONE fail-closed seam (`callModel`) that no caller has to remember doctrine to use.
//
// The doctrine gates (§9/§17/§2 pre-gen, §3 post-gen) live in the PURE `model-router-gates.ts`;
// the allow-list in `model-allowlist.ts`; each provider in its own fail-closed client. This file
// is the INTEGRATOR: run gates → resolve route → allow-list any override → call provider →
// (§3 voice) → persist the artifact → audit. Every existing export above stays untouched (§12).
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import {
  type Modality,
  type Tier,
  type GateInput,
  DoctrineViolation,
  runPreGenerationGates,
  voiceViolations,
  financeDefaultPrefilter,
} from "./model-router-gates.ts";
import { assertModelAllowed } from "./model-allowlist.ts";
import { envKey } from "./env-key.ts";
import {
  NeedsConfigError,
  NotYetConfiguredError,
  type ProviderCallResult,
} from "./provider-types.ts";
import { openaiImage } from "./openai.ts";
import { groqChat } from "./groq.ts";
import { ideogramImage } from "./ideogram.ts";
import { replicateRun } from "./replicate.ts";
import { meshyTextTo3d } from "./meshy.ts";
import { geminiImage } from "./gemini-image.ts";
import { renderDoc, type DocFormat } from "./doc-render.ts";
import { traceLLMCall, type TraceCtx } from "./llm-trace.ts";
import { estimateTokenCostUsd } from "./token-pricing.ts";

// Re-export the shared vocabulary from its one home (§12) so a caller imports everything it
// needs from the router, not from three files.
export type { Modality, Tier } from "./model-router-gates.ts";
export { NeedsConfigError, NotYetConfiguredError } from "./provider-types.ts";
export { DoctrineViolation } from "./model-router-gates.ts";

// ── Public contract ──────────────────────────────────────────────────────────────────────
export interface CallOpts {
  tenantId: string;
  actorRole?: string;
  /** The acting user's id — stamped as studio_deliverable.created_by (falls back to the system NIL uuid). */
  actorUserId?: string;
  is_customer_send?: boolean;
  is_approval_decision?: boolean;
  is_platform_default?: boolean;
  model_override?: string;
  callerFunction?: string;
  brandVoice?: string;
  // §34 Layer-1 trace correlation — all optional + defaulted, so every existing caller compiles
  // unchanged (additive, §12). taskId groups the traces for one logical task; agentId identifies the
  // sub-agent (falls back to callerFunction); parentTraceId links a child call to its parent for the
  // multi-agent tree.
  taskId?: string;
  agentId?: string;
  parentTraceId?: string;
  /** Persist this generation as a studio_deliverable (bucket object + provenance row). Defaults to
   *  true for binary artifacts and false for TEXT — text is only a deliverable when the caller says
   *  so (persist:true), so high-volume internal text (classify/summarize) doesn't churn storage. */
  persist?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ModelResult {
  artifact_url?: string;
  content?: string;
  provider: string;
  model: string;
  tier: Tier;
  modality: Modality;
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate_usd?: number;
  latency_ms: number;
  needs_config?: boolean;
  deliverable_id?: string;
}

// The system/Paige actor when no human user id is supplied (created_by is NOT NULL). No FK, so a
// nil uuid is a safe "produced by the service-role router" stamp.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_FLUX_MODEL = "black-forest-labs/flux-dev";

// ── Task normalization ─────────────────────────────────────────────────────────────────────
/** Extract the human-readable prompt/task text: a string as-is; {prompt}/{content}/{text}; else JSON. */
function taskText(task: unknown): string {
  if (typeof task === "string") return task;
  if (task && typeof task === "object") {
    const t = task as Record<string, unknown>;
    if (typeof t.prompt === "string") return t.prompt;
    if (typeof t.content === "string") return t.content;
    if (typeof t.text === "string") return t.text;
  }
  try { return JSON.stringify(task ?? ""); } catch { return String(task ?? ""); }
}

/** Text calls: use an explicit {messages} array if present, else wrap the task text as one user turn. */
function taskMessages(task: unknown): { role: string; content: unknown }[] {
  if (task && typeof task === "object" && Array.isArray((task as any).messages)) {
    return (task as any).messages;
  }
  return [{ role: "user", content: taskText(task) }];
}

function sizeOf(task: unknown): string | undefined {
  const s = (task as any)?.size;
  return typeof s === "string" ? s : undefined;
}
function aspectOf(task: unknown): string | undefined {
  const a = (task as any)?.aspect ?? (task as any)?.aspect_ratio;
  return typeof a === "string" ? a : undefined;
}
function fluxInput(task: unknown): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt: taskText(task) };
  const ar = aspectOf(task);
  if (ar) input.aspect_ratio = ar;
  return input;
}

// ── Provider adapters that need a wrapper to speak ProviderCallResult ───────────────────────
// Claude text (frontier tier). Fail-closed on a missing ANTHROPIC_API_KEY so text degrades the
// same honest way every other modality does. model_override picks the tier (reasoning default).
async function claudeText(task: unknown, model?: string): Promise<ProviderCallResult> {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new NeedsConfigError("anthropic");
  const started = Date.now();
  const tier: ClaudeTier =
    model === "classification" || model === "claude-haiku-4-5" ? "classification" : "reasoning";
  const resp = await chatCompletionCompat({ messages: taskMessages(task) as any, max_tokens: 2048 }, tier);
  const content = resp?.choices?.[0]?.message?.content ?? "";
  return {
    content: typeof content === "string" ? content : JSON.stringify(content),
    provider: "anthropic",
    model: resp?.model ?? (tier === "reasoning" ? CLAUDE_REASONING : CLAUDE_CLASSIFICATION),
    tokens_in: resp?.usage?.prompt_tokens,
    tokens_out: resp?.usage?.completion_tokens,
    cache_read_input_tokens: resp?.usage?.cache_read_input_tokens,
    cache_creation_input_tokens: resp?.usage?.cache_creation_input_tokens,
    latency_ms: Date.now() - started,
  };
}

// Featherless open-flexible text — reuses the fail-safe featherlessChat above, but fail-CLOSED
// (NeedsConfig) when the key is entirely absent so the router degrades honestly instead of a
// silent Claude substitution (that substitution is `routedChatCompletion`'s job, not callModel's).
async function featherlessProvider(messages: { role: string; content: unknown }[], model?: string): Promise<ProviderCallResult> {
  if (!envKey("FEATHERLESS_API_KEY")) throw new NeedsConfigError("featherless");
  const started = Date.now();
  const m = model || FEATHERLESS_DEFAULT_MODEL;
  const data = await featherlessChat({ messages, max_tokens: 2048 }, m);
  if (!data) throw new Error("Featherless call failed or returned no choice");
  const content = data?.choices?.[0]?.message?.content ?? "";
  return {
    content: typeof content === "string" ? content : JSON.stringify(content),
    provider: "featherless",
    model: data?.model ?? m,
    tokens_in: data?.usage?.prompt_tokens,
    tokens_out: data?.usage?.completion_tokens,
    latency_ms: Date.now() - started,
  };
}

// ── The route table: (modality, tier) → provider cell ───────────────────────────────────────
interface RouteCell {
  provider: string;                 // provider slug for the allow-list + audit + cost
  justification: string;            // one-line rationale for THIS cell (documented per §11/§13)
  invoke: (task: unknown, model?: string) => Promise<ProviderCallResult>;
}

// image-with-text is the SAME cell at every tier: Ideogram is the only lane that renders legible
// typography inside the image, so tier is a cost hint (V_2 vs V_2_TURBO via model_override), not a
// provider switch (§18 — one home per capability).
const imageWithTextCell: RouteCell = {
  provider: "ideogram",
  justification: "Ideogram — the only lane that renders legible words INSIDE the image (ad creatives/posters/thumbnails); routed here at every tier.",
  invoke: (task, model) => ideogramImage({ prompt: taskText(task), aspect: aspectOf(task), model }),
};

// 3d — Meshy primary; on a missing Meshy key, fall back to a Replicate 3D model IF one is
// configured (STUDIO_REPLICATE_3D_MODEL). Otherwise the NeedsConfigError propagates and callModel
// degrades honestly — never a fake mesh (§13).
const threeDCell: RouteCell = {
  provider: "meshy",
  justification: "Meshy text-to-3D primary (frontier=meshy-5 / open-fast=meshy-4 via override); Replicate 3D backup when configured.",
  invoke: async (task, model) => {
    try {
      return await meshyTextTo3d({ prompt: taskText(task), ai_model: model });
    } catch (e) {
      if (e instanceof NeedsConfigError) {
        const backup = Deno.env.get("STUDIO_REPLICATE_3D_MODEL");
        if (backup) return await replicateRun({ model: backup, input: { prompt: taskText(task) } });
      }
      throw e;
    }
  },
};

// audio-voice — fail closed until Studio is attached to the same server-side Paige Voice Profile
// and provider-readiness resolver as paige-tts. A task/request may never select a provider voice.
// This deliberately returns needs_config rather than retaining a hidden second voice path.
const voiceCell: RouteCell = {
  provider: "paige-voice-profile",
  justification: "Studio narration is unavailable until it traverses the approved Paige Voice Profile and readiness gate (§13).",
  invoke: () => {
    throw new NeedsConfigError("paige_voice_profile:studio_adapter", "Studio narration must use the server-approved Paige Voice Profile control plane");
  },
};

// doc-render — in-band document renderers (pdf/docx/pptx/epub) via pure-JS/npm libs (doc-render.ts).
// Each format is INDEPENDENTLY fail-closed there: a broken lib import/render throws NeedsConfigError
// for THAT format only → callModel degrades it to honest needs_config, never a fake/broken document
// (§13). task is {format,title,content,style}; renderDoc returns bytes+mime the router persists.
const docRenderCell: RouteCell = {
  provider: "doc-render",
  justification: "In-band doc renderers (pdf/docx/pptx/epub) — pure-JS/npm libs, each independently fail-closed to needs_config (§13/§19).",
  invoke: async (task) => {
    const started = Date.now();
    const t = (task && typeof task === "object") ? (task as Record<string, unknown>) : {};
    const format = typeof t.format === "string" ? (t.format as DocFormat) : undefined;
    const title = typeof t.title === "string" ? t.title : undefined;
    // content: explicit content/blocks/markdown wins; else fall back to the raw task text.
    const content = t.content ?? t.blocks ?? t.markdown ?? t.text ?? taskText(task);
    const style = (t.style && typeof t.style === "object") ? (t.style as Record<string, unknown>) : undefined;
    // HTML-FIDELITY is the DEFERRED path (Lane C — a hardened headless-Chromium microservice, see
    // docs/doc-render-decision.md). The in-band renderers treat an HTML string as plain text, which would
    // silently produce a doc with visible <tags> — wrong, not fake. So an explicit html request degrades
    // honestly to needs_config until that microservice lands, rather than rendering literal markup (§13).
    if (t.mode === "html" || typeof t.html === "string" || format === ("html" as DocFormat)) {
      throw new NeedsConfigError("doc-render:html-fidelity", "HTML→PDF fidelity is not yet configured (deferred microservice)");
    }
    // A missing/unknown format is an honest fail-closed inside renderDoc (throws NeedsConfigError),
    // caught by callModel as needs_config — never a fabricated document.
    const rendered = await renderDoc({ format: format as DocFormat, title, content, style });
    return {
      artifact_bytes: rendered.bytes,
      artifact_mime: rendered.mime,
      provider: "doc-render",
      model: format ?? "doc",
      latency_ms: Date.now() - started,
    };
  },
};

// The full (modality × tier) map. Every cell carries its own justification so the route choices
// are auditable in code (§11/§13). A missing cell (e.g. 3d/open-flexible, any video-*) resolves to
// a clean NotYetConfigured reject in callModel — never a silent wrong-provider substitution.
const ROUTE_TABLE: Partial<Record<Modality, Partial<Record<Tier, RouteCell>>>> = {
  text: {
    frontier: {
      provider: "anthropic",
      justification: "Claude reasoning — the ONLY tier §17 permits for a customer send / approval decision; best judgment & voice.",
      invoke: (task, model) => claudeText(task, model),
    },
    "open-fast": {
      provider: "groq",
      justification: "Groq Llama 3.3 70B — very low latency/cost for high-volume drafts & classification-adjacent text (never a send, §17).",
      invoke: (task, model) => groqChat({ messages: taskMessages(task), model }),
    },
    "open-flexible": {
      provider: "featherless",
      justification: "Featherless — flat-rate open-weight host; caller may pin any allow-listed open model via model_override.",
      invoke: (task, model) => featherlessProvider(taskMessages(task), model),
    },
  },
  image: {
    "open-fast": {
      provider: "gemini",
      justification: "Gemini 2.5 Flash Image — the cheap/strong DEFAULT for hero & marketing art (owner directive 2026-07-15).",
      invoke: (task, model) => geminiImage({ prompt: taskText(task), model }),
    },
    "open-flexible": {
      provider: "replicate",
      justification: "Replicate Flux family — premium/tunable image; caller picks flux-dev/schnell/1.1-pro/kontext via model_override.",
      invoke: (task, model) => replicateRun({ model: model || DEFAULT_FLUX_MODEL, input: fluxInput(task) }),
    },
    frontier: {
      provider: "openai",
      justification: "OpenAI gpt-image-1 — frontier image ESCALATION when the Gemini/Flux result isn't right.",
      invoke: (task) => openaiImage({ prompt: taskText(task), size: sizeOf(task) }),
    },
  },
  "image-with-text": {
    frontier: imageWithTextCell,
    "open-fast": imageWithTextCell,
    "open-flexible": imageWithTextCell,
  },
  "vision-critique": {
    // Image(s)+text IN → a text SHIP/ITERATE/BLOCK critique OUT (the design-critic "eyes", §25/§33).
    // ONLY a frontier cell exists on purpose: open-fast/open-flexible have NO cell, so callModel
    // resolves them to a clean needs_config degrade (never a wrong-provider substitution) — i.e.
    // "a design judgment never routes to an open model" is guaranteed STRUCTURALLY, not by a runtime
    // check. claudeText → chatCompletionCompat → callClaude on CLAUDE_REASONING (claude-sonnet-5,
    // vision-capable); the caller passes a base64 image data-URI block that toClaudeContent turns
    // into an Anthropic vision block.
    frontier: {
      provider: "anthropic",
      justification: "Claude reasoning (vision-capable) reads a rendered screenshot and returns a design critique — a judgment, never an open model (no open-tier cell exists here).",
      invoke: (task, model) => claudeText(task, model),
    },
  },
  "3d": {
    frontier: threeDCell,
    "open-fast": threeDCell,
  },
  "audio-voice": {
    frontier: voiceCell,
    "open-fast": voiceCell,
    "open-flexible": voiceCell,
  },
  "doc-render": {
    frontier: docRenderCell,
    "open-fast": docRenderCell,
    "open-flexible": docRenderCell,
  },
};

// ── Cost estimator (CLEARLY-LABELED ESTIMATES, not billed figures) ──────────────────────────
// Rough public list prices as of 2026-07; text is $/1K tokens, binary is $/artifact. These are
// planning estimates recorded on the deliverable, NOT an invoice — the true cost is the provider's.
// Token pricing is NOT here — `_shared/llm-trace.ts` owns it (§18), because `claude.ts` also needs
// it and cannot import this module without a cycle. Artifact pricing stays here: it is keyed on the
// modality, which is a routing fact this layer knows and the trace writer does not.
const COST_ESTIMATES = {
  per_artifact: {
    gemini: 0.039,      // Gemini flash image
    openai: 0.040,      // gpt-image-1 (1024²)
    ideogram: 0.080,    // V_2 typography image
    replicate: 0.030,   // Flux dev/schnell class
    meshy: 0.200,       // text-to-3D preview
    elevenlabs: 0.030,  // ~1k chars of TTS
  },
} as const;

/** A clearly-labeled ESTIMATE of this call's cost in USD (undefined when we have no basis). */
function estimateCost(
  provider: string,
  modality: Modality,
  tokensIn?: number,
  tokensOut?: number,
  model?: string | null,
): number | undefined {
  // vision-critique is a Claude text-OUT call (image in, critique text out), so it's token-priced
  // like text — not a per-artifact image cost. Pricing it here gives the §33 cost-cap a real figure.
  if (modality === "text" || modality === "vision-critique") {
    return estimateTokenCostUsd(provider, model, tokensIn, tokensOut);
  }
  // openai text is handled above; here openai means gpt-image-1.
  const per = (COST_ESTIMATES.per_artifact as Record<string, number>)[provider];
  return per;
}

// ── Service-role client (lazy) for audit + deliverable persistence ──────────────────────────
//
// Typed `SupabaseClient`, NOT `ReturnType<typeof createClient>`. The inferred form resolves every
// table's row type to `never`, so `.insert({...})` failed overload resolution on both writers below
// — two long-standing TS2769s that `deno check` reported on every function importing this module.
// `_shared/llm-trace.ts` already uses this idiom and checks clean. Fixed here rather than left
// inherited: the deno ratchet stops crediting a diagnostic in a file the change TOUCHES, which is
// the right rule — editing a file makes you answerable for it.
let _admin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient | null {
  if (_admin) return _admin;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null; // no service context (e.g. offline) — audit/persist become no-ops
  _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

// A short, non-reversible hash of the task text so a violation/audit record can reference WHICH
// task without ever logging the raw content or any PII it may contain (§11/§13). FNV-1a, hex.
function hashTask(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Best-effort audit into paige_audit_log. NEVER contains an API key/secret, and NEVER blocks the
// call — a logging hiccup must not fail a generation (§13). Column shape mirrors paige-mcp's audit().
async function auditRouter(action: string, opts: CallOpts, payload: Record<string, unknown>): Promise<void> {
  try {
    const admin = getAdmin();
    if (!admin) return;
    await admin.from("paige_audit_log").insert({
      tenant_id: opts.tenantId || null,
      actor_user_id: opts.actorUserId ?? null,
      actor_role: opts.actorRole ?? null,
      action,
      target_type: "model_router",
      payload,
    });
  } catch (e) {
    console.error("model-router: audit failed:", (e as Error)?.message);
  }
}

function extFor(mime: string | undefined, modality: Modality): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("gltf-binary") || m.includes("glb")) return "glb";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("pdf")) return "pdf";
  if (m.includes("wordprocessingml")) return "docx";
  if (m.includes("presentationml")) return "pptx";
  if (m.includes("epub")) return "epub";
  if (m.includes("markdown")) return "md";
  if (m.includes("text")) return "txt";
  if (modality === "3d") return "glb";
  if (modality === "audio-voice") return "mp3";
  if (modality === "image" || modality === "image-with-text") return "png";
  return "bin";
}

// Persist the produced artifact (inline bytes, a downloaded vendor URL, or text content) into the
// private studio-deliverables bucket under a leading tenant_id path segment, then insert the
// studio_deliverable provenance row and mint a 30-day signed URL. Fail-SOFT: on any persistence
// error we log and return what we have — a generation is never lost because hosting hiccuped (§13).
async function persistDeliverable(
  result: ProviderCallResult,
  modality: Modality,
  tier: Tier,
  opts: CallOpts,
  cost: number | undefined,
): Promise<{ deliverable_id?: string; artifact_url?: string }> {
  const admin = getAdmin();
  if (!admin) return {};
  try {
    let storageKey: string | undefined;
    let signedUrl: string | undefined;
    let bytes: Uint8Array | undefined;
    let mime = result.artifact_mime;

    if (result.artifact_bytes) {
      bytes = result.artifact_bytes;
    } else if (result.artifact_url) {
      const dl = await fetch(result.artifact_url);
      if (dl.ok) {
        bytes = new Uint8Array(await dl.arrayBuffer());
        mime = mime ?? dl.headers.get("content-type") ?? "application/octet-stream";
      } else {
        console.error("model-router: vendor artifact download failed:", dl.status);
      }
    } else if (typeof result.content === "string" && result.content.length) {
      bytes = new TextEncoder().encode(result.content);
      mime = mime ?? "text/plain; charset=utf-8";
    }

    if (bytes) {
      const ext = extFor(mime, modality);
      storageKey = `${opts.tenantId}/${modality}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const up = await admin.storage.from("studio-deliverables").upload(storageKey, bytes, {
        contentType: mime,
        upsert: false,
      });
      if (up.error) {
        console.error("model-router: deliverable upload failed:", up.error.message);
        storageKey = undefined;
      } else {
        const signed = await admin.storage.from("studio-deliverables").createSignedUrl(storageKey, 30 * 24 * 60 * 60);
        signedUrl = signed.data?.signedUrl ?? undefined;
      }
    }

    const { data, error } = await admin
      .from("studio_deliverable")
      .insert({
        tenant_id: opts.tenantId,
        mode: opts.callerFunction ?? modality,
        modality,
        artifact_storage_key: storageKey ?? null,
        provider: result.provider,
        model: result.model,
        tier,
        cost_estimate_usd: cost ?? null,
        created_by: opts.actorUserId ?? NIL_UUID,
        metadata: {
          caller_function: opts.callerFunction ?? null,
          tokens_in: result.tokens_in ?? null,
          tokens_out: result.tokens_out ?? null,
          latency_ms: result.latency_ms,
          brand_voice: opts.brandVoice ?? null,
          ...(opts.metadata ?? {}),
        },
      })
      .select("id")
      .single();

    if (error) {
      console.error("model-router: deliverable insert failed:", error.message);
      return { artifact_url: signedUrl ?? result.artifact_url };
    }
    return { deliverable_id: (data as any)?.id, artifact_url: signedUrl ?? result.artifact_url };
  } catch (e) {
    console.error("model-router: persist failed:", (e as Error)?.message);
    return { artifact_url: result.artifact_url };
  }
}

/**
 * callModel — the ONE full-modality seam. Enforces doctrine at the boundary so no caller must
 * remember it, in this exact order:
 *   1. PRE-generation gates (§9 scope → §17 send/approval tier → §2 finance-in-default). A
 *      DoctrineViolation is audited then RE-THROWN — the call does not proceed.
 *   2. Resolve the (modality, tier) route; an unserved combo (3d/open-flexible, video-*, …) is a
 *      clean NotYetConfigured reject.
 *   3. Allow-list any untrusted model_override for the cell's provider.
 *   4. Call the provider. A NeedsConfig/NotYetConfigured is an HONEST degrade → { needs_config:true }
 *      (never thrown, never faked).
 *   5. POST-generation §3 voice gate on customer-send text — rewrite up to 2×, else throw.
 *   6. Persist the artifact (bucket + studio_deliverable row + 30-day signed URL).
 *   7. Best-effort success audit.
 */
export async function callModel(
  modality: Modality,
  tier: Tier,
  task: unknown,
  opts: CallOpts,
): Promise<ModelResult> {
  const started = Date.now();
  const text = taskText(task);

  // 1) PRE-generation doctrine gates. Fail-closed: audit + re-throw on violation.
  const gateInput: GateInput = {
    modality,
    tier,
    tenantId: opts.tenantId,
    actorRole: opts.actorRole,
    is_customer_send: opts.is_customer_send,
    is_approval_decision: opts.is_approval_decision,
    is_platform_default: opts.is_platform_default,
    taskText: text,
  };
  try {
    runPreGenerationGates(gateInput);
  } catch (e) {
    if (e instanceof DoctrineViolation) {
      await auditRouter("model_router.doctrine_violation", opts, {
        code: e.code,
        modality,
        tier,
        reason: e.message,
        task_hash: hashTask(text),
        caller_function: opts.callerFunction ?? null,
        ...(e.detail?.phrase ? { phrase: e.detail.phrase } : {}),
      });
    }
    throw e;
  }

  // 1.5) BUDGET ENFORCEMENT (docs/brain/paige-router-budget-contract.md): every call crosses a
  //      budget decision BEFORE dispatch — "estimates are not budget enforcement." The band maps
  //      from this call's own signals: customer-send/approval = SENSITIVE (fails closed at the
  //      hard ceiling, never silently degraded); reasoning tier = REASONING (fails closed); every
  //      other tier = CHEAP (continues gated — the economy tier IS the remediation). The gate hit
  //      rides the trace's doctrine_gate_hits and is Rail-correlatable via llm_trace_id. No admin
  //      client (offline/no service context) → no ledger to read → ungated, like audit/persist.
  const budgetBand: BudgetBand = (opts.is_customer_send || opts.is_approval_decision)
    ? "sensitive"
    : (tier === "frontier" ? "reasoning" : "cheap");
  let budgetCheck: BudgetDecision | null = null;
  const budgetAdmin = getAdmin();
  if (budgetAdmin) {
    const ceiling = await resolveCeiling(budgetAdmin as unknown as BudgetDb, opts.tenantId);
    const accrued = await accruedSpendToday(budgetAdmin as unknown as BudgetDb, opts.tenantId);
    if (accrued == null) {
      // Accrual unknown ≠ $0 (never a claim). Proceed UNGATED but audited — observable, not
      // silent, and not a metrics-blip brick of the revenue path (documented deviation).
      await auditRouter("model_router.budget_accrual_unknown", opts, {
        modality, tier, ceiling_usd: ceiling,
        caller_function: opts.callerFunction ?? null,
      });
    } else {
      budgetCheck = enforceBudget({ accrued_usd: accrued, ceiling_usd: ceiling, band: budgetBand });
      if (budgetCheck.decision === "block") {
        await auditRouter("model_router.budget_exceeded", opts, {
          modality, tier, band: budgetBand,
          accrued_usd: budgetCheck.accrued_usd, ceiling_usd: budgetCheck.ceiling_usd,
          caller_function: opts.callerFunction ?? null,
        });
        traceLLMCall({
          tenant_id: opts.tenantId,
          provider: "router_budget",
          model: null,
          job_kind: `${modality}:${tier}`,
          modality, tier,
          status: "error",
          error_class: "budget_exceeded",
          error_message: `daily ceiling $${budgetCheck.ceiling_usd} reached (accrued $${budgetCheck.accrued_usd.toFixed(2)}); resets at UTC midnight`,
          latency_ms: Date.now() - started,
          input: text,
          output: null,
          doctrine_gate_hits: { budget: { level: "exceeded", accrued_usd: budgetCheck.accrued_usd, ceiling_usd: budgetCheck.ceiling_usd, band: budgetBand } },
          metadata: { caller_function: opts.callerFunction, actor_role: opts.actorRole },
        });
        throw new BudgetExceeded(budgetCheck.ceiling_usd, budgetCheck.accrued_usd);
      }
    }
  }

  // 2) Resolve the route. No cell = a modality/tier we don't serve yet (incl. any video-*). Degrade
  //    to the SAME honest needs_config shape a provider-raised NeedsConfig produces (one shape for
  //    "can't do this yet", so a caller never has to handle both a throw and a flag).
  const cell = ROUTE_TABLE[modality]?.[tier];
  if (!cell) {
    return { provider: "unconfigured", model: "", tier, modality, latency_ms: Date.now() - started, needs_config: true };
  }

  // 3) Any caller-supplied model_override is untrusted — it must be on the provider's allow-list. A
  //    smuggled/renamed/expensive id is a spend-abuse signal (§13/§14): audit it before re-throwing.
  const sensitive = Boolean(opts.is_customer_send) || Boolean(opts.is_approval_decision);
  if (opts.model_override) {
    try {
      assertModelAllowed(cell.provider, opts.model_override);
    } catch (e) {
      if (e instanceof DoctrineViolation) {
        await auditRouter("model_router.doctrine_violation", opts, {
          code: e.code,
          modality,
          tier,
          provider: cell.provider,
          model_override: opts.model_override,
          task_hash: hashTask(text),
          caller_function: opts.callerFunction ?? null,
        });
      }
      throw e;
    }
  }

  // 4) Call the provider. NeedsConfig/NotYetConfigured → honest needs_config degrade (never fake success).
  //    A SENSITIVE text call (customer send / approval decision) ignores a downgrading model_override —
  //    §17 hardens these to Claude's REASONING tier, so we never let a caller pin them to Haiku.
  const effectiveOverride = (sensitive && modality === "text") ? undefined : opts.model_override;
  let result: ProviderCallResult;
  try {
    result = await cell.invoke(task, effectiveOverride);
  } catch (e) {
    // §34 L1: trace correlation shared by both outcome branches below.
    const traceBase = {
      tenant_id: opts.tenantId,
      task_id: opts.taskId ?? null,
      agent_id: opts.agentId ?? opts.callerFunction ?? null,
      parent_trace_id: opts.parentTraceId ?? null,
      job_kind: `${modality}:${tier}`,
      modality,
      tier,
      latency_ms: Date.now() - started,
      input: text,
      metadata: { caller_function: opts.callerFunction, actor_role: opts.actorRole },
    } as const;
    if (e instanceof NeedsConfigError || e instanceof NotYetConfiguredError) {
      const provider = e instanceof NeedsConfigError ? e.provider : cell.provider;
      // Honest needs_config degrade → trace it as such (not a fake success, not an error).
      traceLLMCall({ ...traceBase, provider, model: opts.model_override ?? null, status: "needs_config", error_class: "needs_config" });
      return {
        provider,
        model: opts.model_override ?? "",
        tier,
        modality,
        latency_ms: Date.now() - started,
        needs_config: true,
      };
    }
    // Real provider error → trace it (scrubbed message). Keep this trace ALWAYS — we WANT the
    // failed cheap-tier provider outage (e.g. featherless/groq) on record even when the fallback
    // below rescues the call.
    const failedProvider = cell.provider;
    traceLLMCall({
      ...traceBase,
      provider: failedProvider,
      model: opts.model_override ?? null,
      status: "error",
      error_class: (e as Error)?.name ?? "error",
      error_message: (e as Error)?.message ?? String(e),
    });
    // §34 resilience — the router can never harden into an outage (worst case is we paid Claude
    // prices, never the feature broke). For NON-frontier TEXT, a real provider error degrades to
    // the healthy Claude frontier cell (mirrors routeText's featherless→Claude fallback). TEXT-only
    // by design: a failed binary gen keeps its honest needs_config/error behavior — silently
    // escalating an image to a pricier tier is a different decision we are NOT making here. §17 is
    // safe: sensitive text (customer_send/approval) is already forced to frontier upstream, so it
    // never reaches this branch — the fallback only ever fires for non-sensitive cheap-tier text.
    const frontierCell = ROUTE_TABLE.text?.frontier;
    if (modality === "text" && tier !== "frontier" && frontierCell && frontierCell !== cell) {
      try {
        // A SINGLE DIRECT call to the frontier cell — NOT a recursive callModel, so no gate
        // re-entry and no infinite loop. Pass `undefined` as the override so we never forward a
        // featherless/groq model id to Claude. On success, execution flows OUT of this try/catch
        // into the §3 voice gate + §2 finance re-scan + persist + audit + success trace below —
        // the fallback output MUST still pass those gates (we do not bypass them).
        result = await frontierCell.invoke(task, undefined);
        traceLLMCall({
          ...traceBase,
          provider: "anthropic",
          model: null,
          status: "success",
          metadata: { ...traceBase.metadata, fallback_from: `${failedProvider}/${tier}` },
        });
      } catch (fallbackErr) {
        // The rescue itself failed — trace the fallback attempt as an error, then re-throw the
        // ORIGINAL provider error (not the fallback's) so the caller sees the true first cause.
        traceLLMCall({
          ...traceBase,
          provider: "anthropic",
          model: null,
          status: "error",
          error_class: (fallbackErr as Error)?.name ?? "error",
          error_message: (fallbackErr as Error)?.message ?? String(fallbackErr),
          metadata: { ...traceBase.metadata, fallback_from: `${failedProvider}/${tier}` },
        });
        throw e;
      }
    } else {
      throw e;
    }
  }

  // 5) POST-generation doctrine on SHIPPED text — copy that reaches a customer (is_customer_send) OR
  //    ships to every tenant as a platform default (is_platform_default). §3 voice: rewrite up to 2×,
  //    else throw + audit. §2: a clean platform-default PROMPT can still yield finance/credit OUTPUT —
  //    re-scan the generated text and reject it, closing the door §2's input-only prefilter left ajar.
  if (modality === "text" && typeof result.content === "string") {
    const shipped = Boolean(opts.is_customer_send) || Boolean(opts.is_platform_default);
    if (shipped) {
      let out = result.content;
      let attempts = 0;
      while (voiceViolations(out).length > 0 && attempts < 2) {
        out = await claudeVoicePolish(out, opts.brandVoice);
        attempts++;
      }
      const remaining = voiceViolations(out);
      if (remaining.length > 0) {
        await auditRouter("model_router.voice_violation", opts, {
          modality, tier, provider: result.provider, tells: remaining,
          task_hash: hashTask(text), caller_function: opts.callerFunction ?? null,
        });
        throw new DoctrineViolation("§3", "shipped copy still contains banned voice after rewrite; needs human review", {
          tells: remaining,
        });
      }
      result.content = out;
    }
    if (Boolean(opts.is_platform_default)) {
      const phrase = financeDefaultPrefilter(result.content);
      if (phrase) {
        await auditRouter("model_router.doctrine_violation", opts, {
          code: "§2", modality, tier, provider: result.provider, phrase,
          scan: "output", task_hash: hashTask(text), caller_function: opts.callerFunction ?? null,
        });
        throw new DoctrineViolation("§2", "generated platform-default text contains finance/credit language", { phrase });
      }
    }
  }

  // 6) Persist the produced artifact + provenance row; attach deliverable_id + a 30-day signed URL.
  //    Binary artifacts always persist; TEXT persists only when the caller asks (persist:true) — so
  //    high-volume internal text routed here doesn't churn storage with never-read .txt deliverables.
  const cost = estimateCost(result.provider, modality, result.tokens_in, result.tokens_out);
  const shouldPersist = opts.persist ?? (modality !== "text");
  const persisted: { deliverable_id?: string; artifact_url?: string } = shouldPersist
    ? await persistDeliverable(result, modality, tier, opts, cost)
    : {};

  // 7) Best-effort success audit (never blocks the return).
  await auditRouter("model_router.call", opts, {
    modality,
    tier,
    provider: result.provider,
    model: result.model,
    tokens_in: result.tokens_in ?? null,
    tokens_out: result.tokens_out ?? null,
    cost_estimate_usd: cost ?? null,
    latency_ms: result.latency_ms,
    caller_function: opts.callerFunction ?? null,
  });

  // §34 L1: the full trace row (scrubbed + truncated I/O, tokens, cost estimate, correlation). Detached
  // best-effort — never blocks the return. Output is the produced content or, for a binary artifact, the
  // deliverable reference (the writer never inlines bytes). The budget gate hit (if any) rides
  // doctrine_gate_hits — the enforcement decision is recorded, never silent.
  traceLLMCall({
    tenant_id: opts.tenantId,
    task_id: opts.taskId ?? null,
    agent_id: opts.agentId ?? opts.callerFunction ?? null,
    parent_trace_id: opts.parentTraceId ?? null,
    provider: result.provider,
    model: result.model,
    job_kind: `${modality}:${tier}`,
    modality,
    tier,
    status: "success",
    tokens_in: result.tokens_in ?? null,
    tokens_out: result.tokens_out ?? null,
    cache_read_input_tokens: result.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: result.cache_creation_input_tokens ?? null,
    latency_ms: result.latency_ms,
    cost_estimate_usd: cost ?? null,
    input: text,
    output: typeof result.content === "string" ? result.content : (persisted.artifact_url ?? result.artifact_url ?? null),
    deliverable_id: persisted.deliverable_id ?? null,
    doctrine_gate_hits: budgetCheck?.gate
      ? { budget: { level: budgetCheck.gate.replace("budget_", ""), accrued_usd: budgetCheck.accrued_usd, ceiling_usd: budgetCheck.ceiling_usd, band: budgetCheck.band } }
      : null,
    metadata: { caller_function: opts.callerFunction, actor_role: opts.actorRole },
  });

  return {
    artifact_url: persisted.artifact_url ?? result.artifact_url,
    content: result.content,
    provider: result.provider,
    model: result.model,
    tier,
    modality,
    tokens_in: result.tokens_in,
    tokens_out: result.tokens_out,
    cost_estimate_usd: cost,
    latency_ms: result.latency_ms,
    deliverable_id: persisted.deliverable_id,
  };
}
