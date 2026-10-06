// INT-334 R3 — THE TURN ROUTE: what a turn needs, decided before any model or provider is picked.
//
// The owner's order (2026-10-06): thread state → intent → capability → governance → cognitive class →
// model and provider → execution → verified readback and receipt → response. Until now chat chose a
// MODEL from the person's literal words (`substantiveTurnIntent`, a regex in paige-ai-chat) and nothing
// else; INT-332 added the first state input (the foreground offer). This module is the contract that
// replaces that regex as the model-selection authority: a pure function from server-resolved facts to a
// route. It calls no model, reads no request field, and writes nothing.
//
// WHAT A ROUTE IS NOT. It is not authority. It carries no tenant, actor, role, approval, autonomy lane,
// budget or risk — those are resolved per step by the Spine and the gates, unchanged, whatever the route
// says. A route that says `tools: "act"` lets the model SEE the governed tools; every call still goes
// through the gate, which alone decides whether it runs, needs a card, or is refused. A provider or a
// class being chosen never widens what PAIGE may do (owner ruling: "No model is allowed to acquire
// greater authority because of provider choice").
//
// STATE FIRST, CLASSIFICATION SECOND. The thread's own state (an approved card, an answer to PAIGE's
// question, an accepted offer, a standing card) sets a FLOOR the classifier can raise but never lower:
// "Yes", "Sounds good", "The second option" mean nothing on their own and everything in context, so
// no word list reads them. The classifier (a cheap structured model call, wired in R4/R5) supplies
// intent, research need and difficulty for a fresh turn; when it is absent or unsure, the route takes
// the conservative default — the operational class with the governed tools — never the cheap tier.
//
// CHEAP NEVER CARRIES TOOLS. A tool-bearing turn is operational at least (owner ruling: Haiku is no
// longer a front-door tool-loop model). The cheap class is for a turn that needs no tools and no data.
//
// NOT EVERY TURN NEEDS A MODEL. An approval resume (C4a/b) executes the act stored in its approved
// row; no model chooses anything before that, so its route is `deterministic`. What the loop says
// afterwards is the loop's business.
//
// WHAT STAYS IN THE LOOP, NOT HERE (coordination with the conversational-loop lane, 2026-10-06):
// whether a step needs approval (the tool/Spine door decides risk, autonomy, role, workspace and the
// card), held-step continuation, inspection of accumulated model output, the claim guard, truthful
// server readback, the continuation budget, and wire text == persisted transcript. C4d/C4e
// (durable-work resume) are paused; WAIT_WORK is deliberately not a routing state yet.
//
// Pure TypeScript; imports only pure data modules, so Deno and Node load it.

import { OPENAI_CHEAP, OPENAI_FRONTIER, OPENAI_OPERATIONAL } from "../openai-models.ts";
import { CLAUDE_CLASSIFICATION, CLAUDE_REASONING } from "../claude-models.ts";
import type { Foreground, OfferKind } from "./continuity.ts";

export const TURN_ROUTE_VERSION = 1 as const;

// ── Closed vocabularies ────────────────────────────────────────────────────────────────────────────

/** Which thread state the route stood on. Decided before anything reads the person's words. */
export const ROUTE_BASES = [
  "fresh",            // nothing standing: the turn is read on its own
  "approved_card",    // the person approved a card by its server-issued fingerprint (C4a/b)
  "answers_question", // the reply is bound to PAIGE's standing ask_choices question (C4c)
  "accepted_offer",   // the reply accepts the ONE offer PAIGE just made (INT-332)
  "ambiguous_offer",  // the reply accepts an offer that named alternatives: PAIGE must ask which
  "standing_card",    // a card PAIGE issued is still waiting; typed words never approve it
] as const;
export type RouteBasis = (typeof ROUTE_BASES)[number];

/** What the person wants this turn to accomplish. */
export const TURN_INTENTS = [
  "converse", // acknowledgement, thanks, small talk
  "answer",   // a question PAIGE answers (from context, knowledge or a lookup)
  "act",      // a platform step: create, update, send, schedule, move…
  "research", // find out about the world beyond the workspace
  "build",    // make an asset: page, form, funnel, document, image
  "choose",   // pick among options PAIGE laid out
  "clarify",  // PAIGE must ask before acting (set by state rules, never by the classifier)
] as const;
export type TurnIntent = (typeof TURN_INTENTS)[number];

/** Research depth. A capability, not a model: each maps to its own home (R9). */
export const RESEARCH_NEEDS = ["none", "quick_lookup", "deep_research", "secure_browser"] as const;
export type ResearchNeed = (typeof RESEARCH_NEEDS)[number];

/** How much of the governed tool set the model may SEE (the gate still decides every call). */
export const TOOL_EXPOSURE = ["none", "read", "act"] as const;
export type ToolExposure = (typeof TOOL_EXPOSURE)[number];

export const IMAGE_NEEDS = ["none", "generate", "find"] as const;
export type ImageNeed = (typeof IMAGE_NEEDS)[number];

/** The cognitive classes (R6). `deterministic` is code, never a model. */
export const COGNITIVE_CLASSES = ["deterministic", "cheap", "operational", "frontier"] as const;
export type CognitiveClass = (typeof COGNITIVE_CLASSES)[number];
const CLASS_RANK: Record<CognitiveClass, number> = { deterministic: 0, cheap: 1, operational: 2, frontier: 3 };

export const DIFFICULTIES = ["trivial", "routine", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Why the route came out as it did. Closed codes for traces — never model text, never a thought. */
export const ROUTE_REASONS = [
  "approved_card", "answers_question", "accepted_offer_act", "accepted_offer_prose", "ambiguous_offer",
  "standing_card", "studio_surface", "attached_document", "attached_image", "unclassified_default",
  "low_confidence", "trivial_no_data", "needs_workspace_data", "intent_act", "intent_build",
  "intent_research", "hard_difficulty", "image_generate", "image_find",
] as const;
export type RouteReason = (typeof ROUTE_REASONS)[number];

/** Below this, the classifier's answer is not trusted to LOWER anything. */
export const CLASSIFIER_MIN_CONFIDENCE = 0.6;

// ── Inputs and output ──────────────────────────────────────────────────────────────────────────────

/**
 * The cheap classifier's structured answer (produced in R4/R5; absent until then). For an ACCEPTED
 * OFFER it describes the accepted STEP — the offer PAIGE made — never the bare reply ("Yes" says
 * nothing about the work); for a fresh turn, the person's message.
 */
export interface TurnClassification {
  intent: Exclude<TurnIntent, "clarify">;
  research: ResearchNeed;
  difficulty: Difficulty;
  image: ImageNeed;
  /** The answer depends on this workspace's records (contacts, deals, documents…). */
  needs_workspace_data: boolean;
  confidence: number;
}

/** Facts the handler has ALREADY resolved server-side. Nothing here comes from the request body. */
export interface TurnRouteFacts {
  surface: "chat" | "studio" | "live";
  /** A card approval was verified by fingerprint for this turn (C4a/b). */
  approvedCard: boolean;
  /** The reply is bound to PAIGE's standing question (C4c `answerBinding`). */
  answerBinding: boolean;
  /** `readForeground` from continuity.ts, already gated by the handler's offer eligibility. */
  foreground: Foreground;
  /** `offerKind` of the accepted offer, when there is one. */
  acceptedOfferKind: OfferKind | null;
  attachments: { document: boolean; image: boolean };
  classification: TurnClassification | null;
}

export interface TurnRoute {
  v: typeof TURN_ROUTE_VERSION;
  basis: RouteBasis;
  intent: TurnIntent;
  capability: { tools: ToolExposure; research: ResearchNeed; vision: boolean; image: ImageNeed };
  cognitive_class: CognitiveClass;
  reasons: RouteReason[];
}

/** The only keys a route may carry — a pin that no authority-shaped field is ever added to it. */
export const TURN_ROUTE_KEYS = ["v", "basis", "intent", "capability", "cognitive_class", "reasons"] as const;

// ── The resolver ───────────────────────────────────────────────────────────────────────────────────

const TOOL_RANK: Record<ToolExposure, number> = { none: 0, read: 1, act: 2 };
const maxClass = (a: CognitiveClass, b: CognitiveClass) => (CLASS_RANK[a] >= CLASS_RANK[b] ? a : b);
const maxTools = (a: ToolExposure, b: ToolExposure) => (TOOL_RANK[a] >= TOOL_RANK[b] ? a : b);

/**
 * Resolve the route for one turn. Total and deterministic: every input yields exactly one route, and
 * the same facts always yield the same route.
 */
export function resolveTurnRoute(facts: TurnRouteFacts): TurnRoute {
  const reasons: RouteReason[] = [];
  const c = facts.classification;
  const trusted = !!c && Number.isFinite(c.confidence) && c.confidence >= CLASSIFIER_MIN_CONFIDENCE;
  const vision = !!facts.attachments?.image;
  const image: ImageNeed = trusted ? c!.image : "none";
  const research: ResearchNeed = trusted ? c!.research : "none";

  // 1. STATE. Each standing state fixes the basis and a floor (intent, tools, class).
  let basis: RouteBasis = "fresh";
  let intent: TurnIntent | null = null;
  let tools: ToolExposure = "none";
  let cls: CognitiveClass = "cheap";
  const offer = facts.foreground?.offer;

  if (facts.approvedCard) {
    // The stored, approved act executes as recorded: no model, no tools, nothing the classifier may change.
    return {
      v: TURN_ROUTE_VERSION, basis: "approved_card", intent: "act",
      capability: { tools: "none", research: "none", vision: false, image: "none" },
      cognitive_class: "deterministic", reasons: ["approved_card"],
    };
  } else if (facts.answerBinding) {
    basis = "answers_question"; intent = "choose"; tools = "act"; cls = "operational"; reasons.push("answers_question");
  } else if (offer?.kind === "accepted") {
    basis = "accepted_offer";
    if (facts.acceptedOfferKind === "prose") {
      // The answer IS the reply. It may stay cheap when a trusted classifier says it is light and
      // needs no data; otherwise (and always when unclassified) it is operational with reads.
      intent = "answer"; tools = trusted ? "none" : "read"; cls = trusted ? "cheap" : "operational";
      reasons.push("accepted_offer_prose");
    } else {
      // An accepted act or unknown step: never the cheap class (INT-332).
      intent = "act"; tools = "act"; cls = "operational"; reasons.push("accepted_offer_act");
    }
  } else if (offer?.kind === "ambiguous") {
    // PAIGE asks which (ask_choices is a presentation tool, never a write).
    basis = "ambiguous_offer"; intent = "clarify"; tools = "read"; cls = "operational"; reasons.push("ambiguous_offer");
  } else if (facts.foreground?.standingCard) {
    // Typed words never approve a card; the reply must not narrate one either, so not the cheap class.
    basis = "standing_card"; tools = "read"; cls = "operational"; reasons.push("standing_card");
  }

  // 2. FACTS THAT ARE NOT WORDS: the surface and what was attached.
  if (facts.surface === "studio") {
    intent = intent ?? "build"; tools = maxTools(tools, "act"); cls = maxClass(cls, "operational"); reasons.push("studio_surface");
  }
  if (facts.attachments?.document) {
    tools = maxTools(tools, "read"); cls = maxClass(cls, "operational"); reasons.push("attached_document");
  }
  if (vision) {
    cls = maxClass(cls, "operational"); reasons.push("attached_image");
  }

  // 3. CLASSIFICATION — raises the floor; lowers nothing below it, and is ignored when unsure.
  if (!c) {
    if (basis === "fresh" && facts.surface !== "studio") {
      intent = intent ?? "answer"; tools = maxTools(tools, "act"); cls = maxClass(cls, "operational"); reasons.push("unclassified_default");
    }
  } else if (!trusted) {
    if (basis === "fresh" && facts.surface !== "studio") {
      intent = intent ?? "answer"; tools = maxTools(tools, "act"); cls = maxClass(cls, "operational"); reasons.push("low_confidence");
    }
  } else {
    const ci = c.intent;
    // The classifier names the intent only where state did not: a fresh turn, or a reply beside a standing card.
    if (basis === "fresh" || basis === "standing_card") intent = intent ?? ci;
    if (ci === "act") { tools = maxTools(tools, "act"); reasons.push("intent_act"); }
    if (ci === "build") { tools = maxTools(tools, "act"); reasons.push("intent_build"); }
    if (ci === "research" || research !== "none") { tools = maxTools(tools, "read"); reasons.push("intent_research"); }
    if (c.needs_workspace_data) { tools = maxTools(tools, "read"); reasons.push("needs_workspace_data"); }
    if (image === "generate") { tools = maxTools(tools, "act"); reasons.push("image_generate"); }
    if (image === "find") { tools = maxTools(tools, "read"); reasons.push("image_find"); }
    if (c.difficulty === "hard" && ci !== "converse") { cls = maxClass(cls, "frontier"); reasons.push("hard_difficulty"); }
    // Cheap only for a toolless, attachment-free turn that is trivial or ordinary conversation, on a
    // fresh turn or an accepted prose step (the only states whose floor is cheap).
    const light = c.difficulty === "trivial" || (ci === "converse" && c.difficulty !== "hard");
    const cheapState = basis === "fresh" || (basis === "accepted_offer" && facts.acceptedOfferKind === "prose");
    if (cheapState && tools === "none" && light && !facts.attachments?.document && !vision) {
      reasons.push("trivial_no_data"); // stays cheap
    } else {
      cls = maxClass(cls, "operational");
    }
  }

  // CHEAP NEVER CARRIES TOOLS.
  if (tools !== "none") cls = maxClass(cls, "operational");

  return {
    v: TURN_ROUTE_VERSION,
    basis,
    intent: intent ?? "answer",
    capability: { tools, research, vision, image },
    cognitive_class: cls,
    reasons,
  };
}

// ── Class → provider policy (data, consumed by the Model Fabric in R5–R7) ─────────────────────────

export type FabricProvider = "openai" | "anthropic" | "featherless" | "groq";

/** One candidate in a class's ordered list. `model: null` means the fabric's own pool picks (open models are config). */
export interface RouteCandidate { provider: FabricProvider; model: string | null }

/**
 * The owner's policy (2026-10-06): Sol is the operational default, Astra the frontier default, Sonnet
 * 5.5 the secondary peer for both, and cheap cognition on Luna then the open pool then Haiku. Order is
 * preference; the fabric moves to the next candidate only on a fallback-eligible failure (below).
 */
export const CLASS_POLICY: Readonly<Record<Exclude<CognitiveClass, "deterministic">, readonly RouteCandidate[]>> = {
  cheap: [
    { provider: "openai", model: OPENAI_CHEAP },
    { provider: "featherless", model: null },
    { provider: "groq", model: null },
    { provider: "anthropic", model: CLAUDE_CLASSIFICATION },
  ],
  operational: [
    { provider: "openai", model: OPENAI_OPERATIONAL },
    { provider: "anthropic", model: CLAUDE_REASONING },
  ],
  frontier: [
    { provider: "openai", model: OPENAI_FRONTIER },
    { provider: "anthropic", model: CLAUDE_REASONING },
  ],
};

// ── Fallback eligibility ───────────────────────────────────────────────────────────────────────────

/**
 * Why a model call failed, as the fabric classifies it from what the provider ACTUALLY returned
 * (status, error type, a recognised message) — never inferred. `unknown` is a real answer.
 */
export const PROVIDER_FAILURES = [
  "auth_config",       // missing/invalid key, unconfigured provider (401/403, NeedsConfig)
  "billing",           // the provider said the account has no credit / billing problem
  "rate_limit",        // 429, or the provider named a usage/rate limit
  "model_unavailable", // 404 model, no access to the model
  "invalid_request",   // 400 the provider attributes to the request (schema, parameter)
  "provider_outage",   // 5xx, overloaded, timeout, connection failure
  "unknown",
] as const;
export type ProviderFailure = (typeof PROVIDER_FAILURES)[number];

/** Outcomes that are ANSWERS, not failures. None of them may ever move a turn to another provider. */
export const NOT_FALLBACK = [
  "model_refusal",          // the model declined
  "disliked_answer",        // an answer someone would rather differ
  "research_insufficient",  // research honestly found too little
  "governance_refused",     // a gate refused an action
  "approval_required",      // a card is needed
  "tool_failed_downstream", // a tool ran and its own system failed
] as const;
export type NotFallback = (typeof NOT_FALLBACK)[number];

const FALLBACK_ON: ReadonlySet<ProviderFailure> = new Set(["auth_config", "billing", "rate_limit", "model_unavailable", "provider_outage"]);

/**
 * May the fabric retry this round on the next candidate?
 *  - only for a provider/configuration/transport health failure it recognised;
 *  - never for an invalid request (another provider would get the same broken request) or `unknown`;
 *  - never once the round produced anything executable or anything already delivered to the person,
 *    unless that output is proven not executed (`sideEffectProvenNone`).
 */
export function mayFallback(failure: ProviderFailure | NotFallback, round: { emittedToolCalls: boolean; emittedText: boolean; sideEffectProvenNone: boolean }): boolean {
  if (!FALLBACK_ON.has(failure as ProviderFailure)) return false;
  if ((round.emittedToolCalls || round.emittedText) && !round.sideEffectProvenNone) return false;
  return true;
}
