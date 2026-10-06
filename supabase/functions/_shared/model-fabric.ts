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

import { gatewayCompat } from "./claude.ts";
import type { TraceCtx } from "./llm-trace.ts";
import { OPENAI_EFFORT_BY_CLASS, type OpenAIReasoningClass } from "./openai-models.ts";
import { responsesStream, type ChatShapeBody } from "./openai-responses.ts";
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
  failure?: ProviderFailureClass | "budget_exceeded" | "skipped_disabled";
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
export async function fabricChatStream(cls: CognitiveClass, body: ChatShapeBody & { tool_choice?: unknown }, opts: FabricOptions = {}): Promise<FabricStream> {
  const enabled = { openai: opts.enabled?.openai ?? OPENAI_CHAT_ENABLED };
  const { use, skipped } = candidatesFor(cls, enabled);
  const attempts: FabricAttempt[] = skipped.map((c) => ({ provider: c.provider, model: c.model ?? "", failure: "skipped_disabled" as const }));
  let last: FabricStream = { ok: false, status: 0, served: null, attempts };
  const klass = streamingClass(cls);

  for (const c of use) {
    const model = c.model as string;
    let opened: { ok: boolean; status: number; body?: ReadableStream<Uint8Array>; failureClass?: ProviderFailureClass };
    try {
      if (c.provider === "openai") {
        const effort = OPENAI_EFFORT_BY_CLASS[klass as OpenAIReasoningClass];
        opened = await responsesStream(body, { model, effort, fetchImpl: opts.openaiFetch }, opts.trace);
      } else {
        // The Anthropic path keeps its own budget gate, request shaping and trace (gatewayCompat). A real
        // Claude id resolves to its own tier there (sonnet → reasoning, haiku → classification).
        const r = await gatewayCompat("anthropic", {
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
        throw e;
      }
      const failure = classifyProviderFailure({ provider: c.provider, status: 0, transport: (e as Error)?.name === "TimeoutError" ? "timeout" : "network" });
      attempts.push({ provider: c.provider, model, failure, status: 0 });
      last = { ok: false, status: 0, served: null, attempts };
      if (mayFallback(failure, { emittedToolCalls: false, emittedText: false, sideEffectProvenNone: true })) continue;
      return last;
    }
    if (opened.ok && opened.body) {
      attempts.push({ provider: c.provider, model, status: opened.status });
      return { ok: true, status: opened.status, body: opened.body, served: { provider: c.provider, model }, attempts };
    }
    const failure = opened.failureClass ?? "unknown";
    attempts.push({ provider: c.provider, model, failure, status: opened.status });
    last = { ok: false, status: opened.status, served: null, attempts };
    // The stream never opened, so nothing was shown and nothing can have run.
    if (!mayFallback(failure, { emittedToolCalls: false, emittedText: false, sideEffectProvenNone: true })) return last;
  }
  return last;
}

/** One line for the server log: which candidate served, and why any before it did not. Closed values only. */
export function describeAttempts(s: FabricStream): string {
  return s.attempts.map((a) => `${a.provider}:${a.model}${a.failure ? `(${a.failure})` : "(served)"}`).join(" → ");
}
