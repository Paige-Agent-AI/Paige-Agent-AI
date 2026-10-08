// INT-334 R5 — THE STREAMING MODEL FABRIC: a cognitive class in, one provider-neutral chat-shaped stream
// out. The one place chat (and anything else that streams a reasoning turn) chooses a provider.
//
// A caller says WHAT kind of thinking a round needs (`cheap` / `operational` / `frontier`, from the Turn
// Route); the fabric takes that class's candidates in the owner's order (paige-turn/route.ts
// `CLASS_POLICY`: Sol → Sonnet 5.5, Astra → Sonnet 5.5, Luna → open pool → Haiku), skips any provider
// not enabled for streaming chat, and opens the first one that answers. Every candidate returns the SAME
// chat-shaped SSE (role chunk, content deltas, tool_calls by index, a finish only on a normal stop,
// [DONE]) — the Anthropic path through `gatewayCompat` (budget gate and trace included, unchanged), the
// OpenAI path through `responsesStream` — so the loop's hooks, the claim guard, the held-step logic and
// the finished-round tool gate (paige-turn/round.ts) see one shape whatever served the round.
//
// FALLBACK IS NARROW (route.ts `mayFallback`). The next candidate is tried only when the stream never
// opened AND the provider's own response proves a health failure (auth/config, billing, rate limit,
// model unavailable, outage — `_shared/provider-failure.ts`). Never on an invalid request or an
// unknown 4xx, never once a stream opened (anything after that is the round gate's business), never for
// a budget stop. A provider being chosen grants nothing: tools, approvals and authority are decided
// downstream, unchanged.
//
// OPENAI IS OFF FOR CHAT until the controlled Sol canary passes (`OPENAI_CHAT_ENABLED` below). Turning
// it on is a reviewed one-line change, never an environment toggle nobody can see.

import { chatCompletionCompat, gatewayCompat, messagesCarryDocument, resolvedClaudeModel, CLAUDE_REASONING, type ClaudeTier } from "./claude.ts";
import { NeedsConfigError } from "./provider-types.ts";
import { traceAdmin, traceLLMCall, type FabricRouteTelemetry, type TraceCtx } from "./llm-trace.ts";
import { accruedSpendToday, BudgetExceeded, enforceBudget, resolveCeiling, type BudgetDb } from "./router-budget/mod.ts";
import { OPENAI_EFFORT_BY_CLASS, type OpenAIReasoningClass } from "./openai-models.ts";
import { responsesCompletion, responsesStream, type ChatShapeBody } from "./openai-responses.ts";
import { classifyProviderFailure, PROVIDER_FAILURE_CLASSES, type ProviderFailureClass } from "./provider-failure.ts";
import { CLASS_POLICY, mayFallback, type CognitiveClass, type FabricProvider, type RouteCandidate } from "./paige-turn/route.ts";

/**
 * The Sol cutover switch. While false, chat's streamed rounds are served by Anthropic exactly as before
 * (the OpenAI candidates are skipped). Flipped only after the controlled Sol canary passes, in its own
 * reviewed PR — the release bar is in docs/model-routing/int-334/EVIDENCE.md.
 */
export const OPENAI_CHAT_ENABLED = false;

/** Providers that can serve a streamed, tool-bearing chat round today. The open pool does not stream. */
const STREAMING_PROVIDERS: ReadonlySet<FabricProvider> = new Set(["openai", "anthropic"]);

export interface FabricAttempt {
  provider: FabricProvider;
  model: string;
  /** Present when this candidate did not serve the round. */
  failure?: ProviderFailureClass | "budget_exceeded" | "skipped_disabled" | "unsupported_document" | "aborted";
  status?: number;
}

export interface FabricStream {
  ok: boolean;
  status: number;
  body?: ReadableStream<Uint8Array>;
  /** The candidate that served the round (null when none did). */
  served: { provider: FabricProvider; model: string } | null;
  attempts: FabricAttempt[];
}

export interface FabricOptions {
  trace?: TraceCtx;
  /** Anthropic-only request extras the chat already sends (e.g. the dormant Studio thinking flag). */
  anthropicExtras?: Record<string, unknown>;
  /** Test seam: override the enabled set and transports. Never set by production callers. */
  enabled?: { openai?: boolean };
  openaiFetch?: typeof fetch;
  /** Test seam: the Anthropic gateway. Never set by production callers. */
  anthropicGateway?: typeof gatewayCompat;
}

/** The class a streamed round runs on. `deterministic` work calls no model; if it does, it is operational. */
export function streamingClass(cls: CognitiveClass): Exclude<CognitiveClass, "deterministic"> {
  return cls === "deterministic" ? "operational" : cls;
}

export function candidatesFor(cls: CognitiveClass, enabled: { openai: boolean }): { use: RouteCandidate[]; skipped: RouteCandidate[] } {
  const use: RouteCandidate[] = [];
  const skipped: RouteCandidate[] = [];
  for (const c of CLASS_POLICY[streamingClass(cls)]) {
    const on = STREAMING_PROVIDERS.has(c.provider) && !!c.model && (c.provider !== "openai" || enabled.openai);
    (on ? use : skipped).push(c);
  }
  return { use, skipped };
}

/**
 * Open one streamed chat round for a cognitive class. `body` is PAIGE's chat shape (messages, tools,
 * tool_choice). Returns the first stream a candidate opened, or the last failure.
 */
// ── THE SHARED BUDGET GATE (both fabrics, every provider) ─────────────────────────────────────────
//
// One gate for the streaming and the non-streaming fabric: read the ceiling (cached) and today's
// accrual, decide under the router's OWN contract, and never change its policies — accrual that
// cannot be read proceeds UNGATED but LOUD; `allow_gated` (the cheap band at a hard ceiling)
// proceeds WITH the hit recorded; only a `block` stops the call, terminally, traced, and it never
// becomes a reason to try another provider.

interface FabricBudgetDecision {
  blocked: false;
  gateHits: { budget: Record<string, unknown> } | null;
}

async function fabricBudgetGate(
  tenantId: string,
  band: "cheap" | "reasoning" | "sensitive",
  requestJob: string,
  trace: TraceCtx | undefined,
  started: number,
  traceCtxCarrier: TraceCtx | undefined,
  input?: unknown,
): Promise<FabricBudgetDecision> {
  const db = budgetDb();
  if (!db) return { blocked: false, gateHits: null };
  const ceiling = await resolveCeiling(db, tenantId);
  const accrued = await accruedSpendToday(db, tenantId);
  if (accrued == null) {
    console.warn("[fabric] budget accrual unknown; call proceeds ungated (budget_accrual_unknown)");
    return { blocked: false, gateHits: null };
  }
  const d = enforceBudget({ accrued_usd: accrued, ceiling_usd: ceiling, band });
  const gateHits = d.gate
    ? { budget: { level: d.gate.replace("budget_", ""), accrued_usd: d.accrued_usd, ceiling_usd: d.ceiling_usd, band: d.band } }
    : null;
  if (gateHits && traceCtxCarrier) {
    // The hit rides the ctx so the serving trace writer (streamed or not) records it via its spread.
    traceCtxCarrier.doctrine_gate_hits = gateHits;
  }
  if (d.decision === "block") {
    traceLLMCall({ ...(trace ?? {}), provider: "router_budget", model: null,
      job_kind: trace?.job_kind ?? requestJob, modality: "text", status: "error",
      latency_ms: Date.now() - started, input: input ?? null, output: null,
      error_class: "budget_exceeded", error_message: new BudgetExceeded(d.ceiling_usd, d.accrued_usd).message,
      doctrine_gate_hits: gateHits,
      metadata: { caller_function: trace?.agent_id } });
    throw new BudgetExceeded(d.ceiling_usd, d.accrued_usd);
  }
  return { blocked: false, gateHits };
}

export async function fabricChatStream(cls: CognitiveClass, body: ChatShapeBody & { tool_choice?: unknown }, opts: FabricOptions = {}): Promise<FabricStream> {
  const enabled = { openai: opts.enabled?.openai ?? OPENAI_CHAT_ENABLED };
  const { use, skipped } = candidatesFor(cls, enabled);
  const attempts: FabricAttempt[] = skipped.map((c) => ({ provider: c.provider, model: c.model ?? "", failure: "skipped_disabled" as const }));
  let last: FabricStream = { ok: false, status: 0, served: null, attempts };
  const klass = streamingClass(cls);

  for (const c of use) {
    const model = c.model as string;
    let opened: { ok: boolean; status: number; body?: ReadableStream<Uint8Array>; failureClass?: ProviderFailureClass };
    // #1856 — the projected route rides the ctx BEFORE the leg: the Anthropic gateway copies the ctx
    // at call time, so the attach must precede the dispatch; on open-success the projection is exact.
    if (opts.trace) {
      const failedBefore = attempts.some((a) => a.failure && a.failure !== "skipped_disabled");
      opts.trace.fabric_route = {
        requested_class: cls,
        job: opts.trace.job_kind ?? "chat",
        served_provider: c.provider,
        served_model: model,
        fallback: failedBefore,
        reason: failedBefore ? "served_fallback" : "served_primary",
      };
    }
    try {
      if (c.provider === "openai") {
        // #1850 — DOCUMENT TURNS go to the document-capable provider: the OpenAI adapter refuses
        // document parts by design (never a silent omission), so the fabric skips the candidate
        // before the key is read and Anthropic (document-capable, #587) serves the round.
        if (messagesCarryDocument(body.messages as never)) {
          attempts.push({ provider: "openai", model, failure: "unsupported_document" });
          last = { ok: false, status: 0, served: null, attempts };
          continue;
        }
        // #1850 — the streaming OpenAI leg sits under the SAME canonical budget gate as the
        // Anthropic leg (chat is reasoning-band work, the contract's own classification). A block
        // throws before any transport moves and never falls back to the next candidate.
        if (opts.trace?.tenant_id) {
          await fabricBudgetGate(opts.trace.tenant_id, "reasoning", "chat", opts.trace, Date.now(), opts.trace, body.messages);
        }
        const effort = OPENAI_EFFORT_BY_CLASS[klass as OpenAIReasoningClass];
        opened = await responsesStream(body, { model, effort, fetchImpl: opts.openaiFetch }, opts.trace);
      } else {
        // The Anthropic path keeps its own budget gate, request shaping and trace (gatewayCompat). A real
        // Claude id resolves to its own tier there (sonnet → reasoning, haiku → classification).
        const r = await (opts.anthropicGateway ?? gatewayCompat)("anthropic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, model, stream: true, ...(opts.anthropicExtras ?? {}) }),
        }, opts.trace);
        const proven = PROVIDER_FAILURE_CLASSES.includes(r.failureClass as ProviderFailureClass) ? r.failureClass as ProviderFailureClass : undefined;
        opened = { ok: r.ok, status: r.status, body: r.body, failureClass: r.ok ? undefined : proven ?? classifyProviderFailure({ provider: "anthropic", status: r.status }) };
      }
    } catch (e) {
      // A budget stop is a decision, not a provider failure: it is never retried elsewhere.
      if ((e as { code?: unknown })?.code === "budget_exceeded") {
        attempts.push({ provider: c.provider, model, failure: "budget_exceeded" });
        if (opts.trace) opts.trace.fabric_route = null;
        throw e;
      }
      // What the throw proves, and nothing more: a missing key is configuration; a timeout or a fetch
      // TypeError is transport; anything else thrown before a response (a refused tool, a model outside
      // the allow-list) proves no provider-health failure, so it is `unknown` and never falls back.
      const name = (e as Error)?.name;
      const failure: ProviderFailureClass = e instanceof NeedsConfigError ? "auth_config"
        : name === "TimeoutError" || name === "AbortError" ? classifyProviderFailure({ provider: c.provider, status: 0, transport: "timeout" })
        : e instanceof TypeError ? classifyProviderFailure({ provider: c.provider, status: 0, transport: "network" })
        : "unknown";
      attempts.push({ provider: c.provider, model, failure, status: 0 });
      last = { ok: false, status: 0, served: null, attempts };
      if (mayFallback(failure, { emittedToolCalls: false, emittedText: false, sideEffectProvenNone: true })) continue;
      if (opts.trace) opts.trace.fabric_route = { requested_class: cls, job: opts.trace.job_kind ?? "chat", served_provider: null, served_model: null, fallback: attempts.some((a) => a.failure && a.failure !== "skipped_disabled"), reason: "failed" };
      return last;
    }
    if (opened.ok && opened.body) {
      attempts.push({ provider: c.provider, model, status: opened.status });
      return { ok: true, status: opened.status, body: opened.body, served: { provider: c.provider, model }, attempts };
    }
    const failure = opened.failureClass ?? "unknown";
    attempts.push({ provider: c.provider, model, failure, status: opened.status });
    last = { ok: false, status: opened.status, served: null, attempts };
    // The stream never opened, so nothing was shown and nothing can have run. The projected route
    // is replaced by the served-null failure route so a reused ctx carries no stale "served by X".
    if (!mayFallback(failure, { emittedToolCalls: false, emittedText: false, sideEffectProvenNone: true })) {
      if (opts.trace) opts.trace.fabric_route = { requested_class: cls, job: opts.trace.job_kind ?? "chat", served_provider: null, served_model: null, fallback: attempts.some((a) => a.failure && a.failure !== "skipped_disabled"), reason: "failed" };
      return last;
    }
  }
  // #1856 — nothing served: the failure route rides the ctx for whatever is observed next (this
  // also clears any projected served route — served_* are null here); the attempt detail is in the
  // warn line below (closed values only).
  if (opts.trace) {
    opts.trace.fabric_route = { requested_class: cls, job: opts.trace.job_kind ?? "chat", served_provider: null, served_model: null, fallback: attempts.some((a) => a.failure && a.failure !== "skipped_disabled"), reason: "failed" };
  }
  return last;
}

/** One line for the server log: which candidate served, and why any before it did not. Closed values only. */
export function describeAttempts(s: FabricStream): string {
  return s.attempts.map((a) => `${a.provider}:${a.model}${a.failure ? `(${a.failure})` : "(served)"}`).join(" → ");
}

// ── INT-334: THE CLASS-BEARING CONSUMER SEAM (non-streaming) ───────────────────────────────────────
//
// The shared contract an approved consumer uses to request reasoning WITHOUT naming a provider or a
// model (R6A-RETURN §D): a cognitive class and the consumer's own job identity in, one chat-shaped
// completion out, and the SERVED ROUTE on the response so the consumer can persist what ran without
// becoming the router. `routedChatCompletion` (by JobKind) keeps serving every existing caller
// unchanged; nothing is migrated by this seam — Deep Research adopts it in its own lane (R6-B), and
// later COO operating intelligence the same way. One policy (CLASS_POLICY), one fallback rule
// (mayFallback), one failure classifier — no second route table.
//
// WHAT THE SEAM DOES NOT OWN: business data, business authorization, execution policy, the
// Operating/Cognitive Fabric. A class is not authority (the owner's binding rule); the consumer's
// own gates decide everything their work touches.
//
// OPENAI follows the same posture as chat: candidates are skipped while OPENAI_CHAT_ENABLED is
// false, so today every class is served by Anthropic exactly as routedChatCompletion's tiers serve
// it (operational/frontier → the reasoning tier, cheap → the classification tier). The budget gate
// runs on EVERY candidate including the OpenAI path (R5a's release bar item, built in here from the
// start), and a budget stop is terminal — never a reason to try another provider.

/** The classes a consumer may request. `deterministic` is code and is never a model call. */
export type ConsumerCognitiveClass = Exclude<CognitiveClass, "deterministic">;

/** A consumer job identity: snake_case, stable, named by the consumer's own declaration. */
const JOB_IDENTITY = /^[a-z][a-z0-9_]{2,63}$/;

export interface FabricCompletionRequest extends ChatShapeBody {
  cognitive_class: ConsumerCognitiveClass;
  /** The consumer's own job identity (e.g. `research_unit_synthesis`) — recorded on the trace and the route. */
  job: string;
}

/** Why the route came out as it did. A closed set; the per-attempt detail rides `attempts`. */
export type FabricRouteReason =
  | "served_primary"      // the class's first usable candidate served
  | "served_fallback"     // a later candidate served after a proven provider-health failure
  | "pinned_served"       // the pinned route served (the judge carve-out: no policy, no fallback)
  | "pinned_failed"       // the pinned route failed; nothing else was tried, by design
  | "failed";             // every usable candidate failed; the last closed failure class is on the result

export interface FabricCompletionRoute {
  requested_class: ConsumerCognitiveClass;
  job: string;
  served: { provider: FabricProvider; model: string } | null;
  fallback: boolean;
  reason: FabricRouteReason;
  attempts: FabricAttempt[];
}

export interface FabricCompletionResult {
  ok: boolean;
  route: FabricCompletionRoute;
  /** Chat-shaped (choices[0].message, model, usage, paige_stop) — the shape consumers already parse. */
  response?: Record<string, unknown>;
  /** The closed failure class of the last failed attempt; provider text is never kept. */
  error?: { failure: ProviderFailureClass | "budget_exceeded" | "unsupported_document" | "aborted" };
}

export interface FabricCompletionOpts {
  trace?: TraceCtx;
  /** A caller deadline. Threads to the Anthropic leg's fetch; the OpenAI leg is bounded by the
   * caller's own race until the OpenAI-path slice adds native cancellation there. */
  signal?: AbortSignal;
  /**
   * The judge carve-out (R6A-RETURN D.5): ONE pinned candidate, no class policy, NO fallback —
   * a longitudinal instrument must not inherit dynamic routing. Pinning grants nothing and is
   * Anthropic-only by construction (the frozen instrument's provider).
   */
  pinned?: { tier: ClaudeTier };
  /** Test seams: the enabled set and the OpenAI transport. Never set by production callers. */
  enabled?: { openai?: boolean };
  openaiFetch?: typeof fetch;
}

function budgetDb(): BudgetDb | null {
  // The ONE memoized service client every other budget enforcer shares (llm-trace's admin) —
  // never a second client per isolate.
  return traceAdmin() as unknown as BudgetDb;
}

/**
 * One non-streaming completion for a cognitive class. `request` carries WHAT kind of thinking the
 * job needs and the job's own identity; the fabric alone decides who serves it. Budget stops throw
 * (terminal, like every other fabric entry point); a failed call never keeps provider text.
 */
export async function fabricCompletion(
  request: FabricCompletionRequest,
  opts: FabricCompletionOpts = {},
): Promise<FabricCompletionResult> {
  const started = Date.now();
  const cls = request.cognitive_class;
  const klass = streamingClass(cls);
  if (!JOB_IDENTITY.test(request.job)) throw new Error("fabricCompletion: job must be a snake_case job identity");
  const enabled = { openai: opts.enabled?.openai ?? OPENAI_CHAT_ENABLED };
  const attempts: FabricAttempt[] = [];
  let gateHitForTrace: { budget: Record<string, unknown> } | null = null;
  const route = (served: FabricCompletionRoute["served"], reason: FabricRouteReason, fallback: boolean): FabricCompletionRoute =>
    ({ requested_class: cls, job: request.job, served, fallback, reason, attempts });

  // THE PINNED ROUTE: one Anthropic candidate, no policy, no fallback, no dynamic class routing.
  let use: RouteCandidate[];
  if (opts.pinned) {
    use = [{ provider: "anthropic", model: opts.pinned.tier === "reasoning" ? CLAUDE_REASONING : "claude-classification" }];
  } else {
    const c = candidatesFor(klass, enabled);
    use = c.use;
    for (const sk of c.skipped) attempts.push({ provider: sk.provider, model: sk.model ?? "", failure: "skipped_disabled" });
  }

  // The budget band the class rides. Frontier spend is the reasoning band today; pricing semantics
  // belong to INT-331 and are not changed here. A PINNED route pays for the tier it runs, whatever
  // class the instrument declared (a pinned judge on the reasoning tier is reasoning-band spend).
  const band = opts.pinned
    ? (opts.pinned.tier === "reasoning" ? "reasoning" : "cheap")
    : klass === "cheap" ? "cheap" : "reasoning";

  let last: FabricCompletionResult = { ok: false, route: route(null, opts.pinned ? "pinned_failed" : "failed", false) };
  // #1856 — every failure exit clears the projected route from the caller's ctx: a reused ctx can
  // never carry a stale "served by X" route into a later row (the success paths overwrite it with
  // the exact route, so only failures need the explicit clear).
  const clearRoute = () => { if (opts.trace) opts.trace.fabric_route = null; };

  for (const c of use) {
    // BUDGET GATE — every candidate, both providers, the ONE shared gate. A stop is a decision,
    // never retried elsewhere; a caller deadline that fired while the gate read was in flight
    // aborts the call BEFORE any provider is dispatched (#1850's cancellation proof).
    if (opts.signal?.aborted) {
      attempts.push({ provider: c.provider, model: c.model ?? "", failure: "aborted", status: 0 });
      clearRoute();
      return { ok: false, route: route(null, opts.pinned ? "pinned_failed" : "failed", false), error: { failure: "aborted" } };
    }
    if (opts.trace?.tenant_id) {
      try {
        const decision = await fabricBudgetGate(opts.trace.tenant_id, band, request.job, opts.trace, started, undefined, request.messages);
        gateHitForTrace = decision.gateHits;
      } catch (e) {
        attempts.push({ provider: c.provider, model: c.model ?? "", failure: "budget_exceeded" });
        clearRoute();
        throw e;
      }
    }
    if (opts.signal?.aborted) {
      attempts.push({ provider: c.provider, model: c.model ?? "", failure: "aborted", status: 0 });
      clearRoute();
      return { ok: false, route: route(null, opts.pinned ? "pinned_failed" : "failed", false), error: { failure: "aborted" } };
    }
    // #1850 — document turns never reach the OpenAI adapter (it refuses document parts by design;
    // the refusal stays as defense in depth). The document-capable provider serves them instead.
    if (c.provider === "openai" && messagesCarryDocument(request.messages as never)) {
      attempts.push({ provider: "openai", model: c.model ?? "", failure: "unsupported_document" });
      last = { ok: false, route: route(null, opts.pinned ? "pinned_failed" : "failed", false), error: { failure: "unsupported_document" } };
      if (opts.pinned) { clearRoute(); return last; }
      continue;
    }

    const anthropicTier: ClaudeTier | null = c.provider === "anthropic" ? (c.model === CLAUDE_REASONING ? "reasoning" : "classification") : null;
    // #1856 — the projected route rides the ctx BEFORE the leg, so the leg's own trace row (the
    // OpenAI self-trace, or the streamed drain) carries it via its spread; the seam's Anthropic rows
    // set it explicitly (success and error) where the exact reason is known.
    const failedBefore = attempts.some((a) => a.failure && a.failure !== "skipped_disabled");
    const projectedRoute: FabricRouteTelemetry = {
      requested_class: cls,
      job: opts.trace?.job_kind ?? request.job,
      served_provider: c.provider,
      served_model: c.model ?? "",
      fallback: failedBefore,
      reason: opts.pinned ? "pinned_served" : failedBefore ? "served_fallback" : "served_primary",
    };
    if (opts.trace) opts.trace.fabric_route = projectedRoute;
    try {
      const resp: Record<string, unknown> = c.provider === "openai"
        // The trace carries the CONSUMER's job identity, never the adapter's "chat" default; the
        // OpenAI leg self-traces through responsesCompletion under this context.
        ? await responsesCompletion(request, { model: c.model as string, effort: OPENAI_EFFORT_BY_CLASS[klass as OpenAIReasoningClass], fetchImpl: opts.signal ? (u, i) => (opts.openaiFetch ?? fetch)(u, { ...i, signal: opts.signal }) : opts.openaiFetch }, opts.trace ? { ...opts.trace, job_kind: opts.trace.job_kind ?? request.job, ...(gateHitForTrace ? { doctrine_gate_hits: gateHitForTrace } : {}) } : undefined)
        : await callAnthropicTraced(request, anthropicTier as ClaudeTier, request.job, opts.trace, gateHitForTrace, opts.signal, projectedRoute);
      const servedModel = typeof resp.model === "string" && resp.model
        ? resp.model
        : c.provider === "anthropic"
          ? resolvedClaudeModel(request as unknown as Parameters<typeof resolvedClaudeModel>[0], anthropicTier as ClaudeTier)
          : (c.model as string);
      attempts.push({ provider: c.provider, model: servedModel });
      const failedBefore = attempts.some((a) => a.failure && a.failure !== "skipped_disabled");
      return {
        ok: true,
        response: resp,
        route: route(
          { provider: c.provider, model: servedModel },
          opts.pinned ? "pinned_served" : failedBefore ? "served_fallback" : "served_primary",
          failedBefore,
        ),
      };
    } catch (e) {
      if ((e as { code?: unknown })?.code === "budget_exceeded") {
        attempts.push({ provider: c.provider, model: c.model ?? "", failure: "budget_exceeded" });
        clearRoute();
        throw e;
      }
      const err = e as { name?: string; status?: number; failureClass?: string };
      const proven = PROVIDER_FAILURE_CLASSES.includes(err.failureClass as ProviderFailureClass) ? err.failureClass as ProviderFailureClass : undefined;
      // Transport throws carry no status: a timeout or a broken connection is the streaming
      // fabric's `provider_outage` (fallback-eligible) — the 2026-10-06 outage class — never `unknown`.
      const failure: ProviderFailureClass = e instanceof NeedsConfigError ? "auth_config"
        : (proven
          ?? (err.name === "TimeoutError" || err.name === "AbortError" ? classifyProviderFailure({ provider: c.provider, status: 0, transport: "timeout" })
          : (e instanceof TypeError || err.name === "TypeError") ? classifyProviderFailure({ provider: c.provider, status: 0, transport: "network" })
          : classifyProviderFailure({ provider: c.provider, status: typeof err.status === "number" ? err.status : 0 })));
      attempts.push({ provider: c.provider, model: c.model ?? "", failure, status: typeof err.status === "number" ? err.status : 0 });
      last = { ok: false, route: route(null, opts.pinned ? "pinned_failed" : "failed", false), error: { failure } };
      // A caller deadline that fired mid-flight is terminal: no fallback either — nothing may be
      // dispatched after the caller's window, whatever the failure would otherwise allow.
      if (opts.signal?.aborted) {
        last = { ok: false, route: route(null, opts.pinned ? "pinned_failed" : "failed", false), error: { failure: "aborted" } };
        attempts.push({ provider: c.provider, model: c.model ?? "", failure: "aborted", status: 0 });
        clearRoute();
        return last;
      }
      if (opts.pinned) { clearRoute(); return last; } // a pinned route never moves — the instrument stays comparable
      if (!mayFallback(failure, { emittedToolCalls: false, emittedText: false, sideEffectProvenNone: true })) { clearRoute(); return last; }
    }
  }
  clearRoute();
  return last;
}

/**
 * The Anthropic candidate for non-streaming calls: `chatCompletionCompat` (the same translation the
 * routed path uses) under the seam's OWN budget-checked trace row — the compat layer itself never
 * traces, so this is the single trace layer for this leg (the OpenAI leg self-traces through
 * responsesCompletion; neither double-counts).
 */
async function callAnthropicTraced(body: ChatShapeBody, tier: ClaudeTier, job: string, trace?: TraceCtx, gateHits?: { budget: Record<string, unknown> } | null, signal?: AbortSignal, route?: FabricRouteTelemetry): Promise<Record<string, unknown>> {
  const started = Date.now();
  const shaped = body as unknown as Parameters<typeof chatCompletionCompat>[0];
  try {
    const resp = await chatCompletionCompat(shaped, tier, signal);
    const usage = (resp as { usage?: { prompt_tokens?: number; completion_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } })?.usage ?? {};
    traceLLMCall({
      ...(trace ?? {}), provider: "anthropic",
      model: (resp as { model?: string })?.model ?? resolvedClaudeModel(shaped, tier),
      // The CALLER's own trace tag wins when set (an adopter keeps its trace-history job_kind);
      // the request's job identity is the default.
      job_kind: trace?.job_kind ?? job, modality: "text", tier, status: "success",
      tokens_in: usage.prompt_tokens ?? null,
      tokens_out: usage.completion_tokens ?? null,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
      latency_ms: Date.now() - started,
      input: body.messages, output: (resp as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content ?? null,
      doctrine_gate_hits: gateHits ?? null,
      fabric_route: route ?? null,
      metadata: { caller_function: trace?.agent_id },
    });
    return resp as Record<string, unknown>;
  } catch (e) {
    // A failed leg leaves the SAME evidence a successful one does — every peer entry point traces
    // its errors; a zero-trace failure path is exactly the row the fleet error-rate needs.
    const err = e as { status?: number; failureClass?: string };
    traceLLMCall({
      ...(trace ?? {}), provider: "anthropic",
      model: resolvedClaudeModel(shaped, tier),
      job_kind: trace?.job_kind ?? job, modality: "text", tier, status: "error",
      latency_ms: Date.now() - started,
      input: body.messages, output: null,
      error_class: PROVIDER_FAILURE_CLASSES.includes(err.failureClass as ProviderFailureClass) ? err.failureClass : ((e as Error)?.name ?? "error"),
      error_message: (e as Error)?.name ?? "error",
      fabric_route: route ? { ...route, served_provider: null, served_model: null, reason: route.reason === "pinned_served" ? "pinned_failed" : "failed" } : null,
      metadata: { caller_function: trace?.agent_id },
    });
    throw e;
  }
}
