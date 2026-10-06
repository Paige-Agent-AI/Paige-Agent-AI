// deno test --allow-import --node-modules-dir=none supabase/functions/_shared/paige-turn/route.test.ts
//
// INT-334 R3 — the Turn Route contract (route.ts). What these hold:
//  - CONFORMANCE: every case in route.conformance.json resolves to its stated basis, intent, tool
//    exposure, cognitive class (and research / image / vision where stated). The R4 cases show the
//    same words ("Yes", "The second option") routing differently by thread state alone.
//  - STATE IS A FLOOR: across every combination of state and classification, no classification
//    lowers the class or the tool exposure a standing state set.
//  - CHEAP NEVER CARRIES TOOLS, and an absent or unsure classifier never yields the cheap class.
//  - A ROUTE IS NOT AUTHORITY: its keys are exactly the contract's, with nothing approval-, tenant-,
//    autonomy- or risk-shaped, whatever the input.
//  - THE POLICY: Sol leads operational, Astra leads frontier, Sonnet 5.5 is second in both; Luna leads
//    cheap; fallback only on recognised provider-health failures, never on an answer, and never once
//    something executable or visible was produced.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  CLASS_POLICY,
  COGNITIVE_CLASSES,
  DIFFICULTIES,
  IMAGE_NEEDS,
  mayFallback,
  NOT_FALLBACK,
  PROVIDER_FAILURES,
  RESEARCH_NEEDS,
  resolveTurnRoute,
  TURN_INTENTS,
  TURN_ROUTE_KEYS,
  type TurnClassification,
  type TurnRouteFacts,
} from "./route.ts";
import cases from "./route.conformance.json" with { type: "json" };

const RANK = { deterministic: 0, cheap: 1, operational: 2, frontier: 3 } as const;
const TRANK = { none: 0, read: 1, act: 2 } as const;

Deno.test("conformance: every case routes as stated", () => {
  assert(cases.length >= 25, "the conformance suite is not trimmed");
  for (const c of cases as Array<{ name: string; facts: TurnRouteFacts; expect: Record<string, unknown> }>) {
    const r = resolveTurnRoute(c.facts);
    const got: Record<string, unknown> = { basis: r.basis, intent: r.intent, tools: r.capability.tools, cognitive_class: r.cognitive_class };
    if ("research" in c.expect) got.research = r.capability.research;
    if ("image" in c.expect) got.image = r.capability.image;
    if ("vision" in c.expect) got.vision = r.capability.vision;
    assertEquals(got, c.expect, c.name);
  }
});

// Every state × a spread of classifications.
const FG = {
  none: { offer: { kind: "none", reason: "no_offer" }, standingCard: false },
  accepted: { offer: { kind: "accepted", offer: "send the card" }, standingCard: false },
  ambiguous: { offer: { kind: "ambiguous", offer: "send or draft" }, standingCard: false },
  card: { offer: { kind: "none", reason: "standing_wait" }, standingCard: true },
} as const;

function* states(): Generator<Omit<TurnRouteFacts, "classification">> {
  for (const surface of ["chat", "studio", "live"] as const)
    for (const approvedCard of [false, true])
      for (const answerBinding of [false, true])
        for (const fg of Object.keys(FG) as (keyof typeof FG)[])
          for (const acceptedOfferKind of [null, "act", "prose", "unknown"] as const)
            for (const document of [false, true])
              for (const image of [false, true])
                yield { surface, approvedCard, answerBinding, foreground: FG[fg] as TurnRouteFacts["foreground"], acceptedOfferKind, attachments: { document, image } };
}
function* classifications(): Generator<TurnClassification | null> {
  yield null;
  for (const intent of TURN_INTENTS.filter((i) => i !== "clarify") as TurnClassification["intent"][])
    for (const difficulty of DIFFICULTIES)
      for (const research of RESEARCH_NEEDS)
        for (const confidence of [0.2, 0.95])
          for (const needs_workspace_data of [false, true])
            for (const image of IMAGE_NEEDS)
              yield { intent, difficulty, research, image, needs_workspace_data, confidence };
}

Deno.test("state floors hold; cheap never carries tools; unsure never cheap; keys are the contract", () => {
  let n = 0;
  const allowed = new Set<string>(TURN_ROUTE_KEYS);
  for (const s of states()) {
    const unclassified = resolveTurnRoute({ ...s, classification: null });
    for (const c of classifications()) {
      const r = resolveTurnRoute({ ...s, classification: c });
      const why = JSON.stringify({ s, c });
      n++;
      assertEquals(Object.keys(r).sort(), [...allowed].sort(), "route keys");
      assertEquals(Object.keys(r.capability).sort(), ["image", "research", "tools", "vision"], "capability keys");
      assert(COGNITIVE_CLASSES.includes(r.cognitive_class));
      assertEquals(r.basis, unclassified.basis, "the classifier never changes the basis");
      if (r.capability.tools !== "none") assert(r.cognitive_class !== "cheap", `cheap with tools: ${why}`);
      if (!c || c.confidence < 0.6) {
        assert(r.cognitive_class !== "cheap", `an absent or unsure classifier never yields cheap: ${why}`);
        assertEquals([r.cognitive_class, r.capability.tools], [unclassified.cognitive_class, unclassified.capability.tools], "an unsure classifier changes nothing");
      }
      // Per-state floors.
      if (r.basis === "approved_card") {
        assertEquals([r.cognitive_class, r.capability.tools], ["deterministic", "none"], `a resume runs the stored act, no model: ${why}`);
      } else if (r.basis === "accepted_offer" && s.acceptedOfferKind === "prose") {
        // may be cheap — but only toolless (checked above)
      } else if (r.basis !== "fresh") {
        assert(RANK[r.cognitive_class] >= RANK.operational, `state floor is operational: ${why}`);
        assert(TRANK[r.capability.tools] >= TRANK[unclassified.capability.tools], `tools lowered below the state floor: ${why}`);
      }
      if (r.basis === "ambiguous_offer") {
        assertEquals([r.intent, r.capability.tools], ["clarify", "read"], `an ambiguous offer is a question, never an act: ${why}`);
      }
      if (r.basis === "accepted_offer" && s.acceptedOfferKind !== "prose") {
        assertEquals(r.capability.tools, "act", `an accepted act/unknown step keeps the governed tools: ${why}`);
      }
    }
  }
  assert(n > 100_000, `swept ${n}`);
});

Deno.test("state is decided before words: approval > answer > accepted > ambiguous > standing card", () => {
  const base = { surface: "chat", attachments: { document: false, image: false }, classification: null, acceptedOfferKind: "act" } as const;
  assertEquals(resolveTurnRoute({ ...base, approvedCard: true, answerBinding: true, foreground: FG.accepted as any }).basis, "approved_card");
  assertEquals(resolveTurnRoute({ ...base, approvedCard: false, answerBinding: true, foreground: FG.accepted as any }).basis, "answers_question");
  assertEquals(resolveTurnRoute({ ...base, approvedCard: false, answerBinding: false, foreground: FG.accepted as any }).basis, "accepted_offer");
  assertEquals(resolveTurnRoute({ ...base, approvedCard: false, answerBinding: false, foreground: FG.ambiguous as any }).basis, "ambiguous_offer");
  assertEquals(resolveTurnRoute({ ...base, approvedCard: false, answerBinding: false, foreground: FG.card as any }).basis, "standing_card");
});

Deno.test("deterministic: the same facts always give the same route", () => {
  for (const c of cases as Array<{ facts: TurnRouteFacts }>) {
    assertEquals(resolveTurnRoute(c.facts), resolveTurnRoute(structuredClone(c.facts)));
  }
});

Deno.test("policy: Sol and Astra lead, Sonnet 5.5 is second, Luna leads cheap", () => {
  assertEquals(CLASS_POLICY.operational.map((x) => `${x.provider}:${x.model}`), ["openai:gpt-6.1-sol", "anthropic:claude-sonnet-5-5"]);
  assertEquals(CLASS_POLICY.frontier.map((x) => `${x.provider}:${x.model}`), ["openai:gpt-6-astra", "anthropic:claude-sonnet-5-5"]);
  assertEquals(CLASS_POLICY.cheap.map((x) => x.provider), ["openai", "featherless", "groq", "anthropic"]);
  assertEquals(CLASS_POLICY.cheap[0].model, "gpt-6-luna");
  assertEquals(CLASS_POLICY.cheap[3].model, "claude-haiku-4-5");
  assert(!("deterministic" in CLASS_POLICY), "deterministic work is code, never a model");
});

Deno.test("fallback: provider health only; never on an answer; never after output, unless proven unexecuted", () => {
  const clean = { emittedToolCalls: false, emittedText: false, sideEffectProvenNone: false };
  for (const f of ["auth_config", "billing", "rate_limit", "model_unavailable", "provider_outage"] as const) assert(mayFallback(f, clean), f);
  for (const f of ["invalid_request", "unknown"] as const) assert(!mayFallback(f, clean), f);
  for (const f of NOT_FALLBACK) assert(!mayFallback(f, clean), f);
  assert(!mayFallback("provider_outage", { ...clean, emittedToolCalls: true }), "a round that showed a tool call does not move");
  assert(!mayFallback("provider_outage", { ...clean, emittedText: true }), "a round the person already saw does not move");
  assert(mayFallback("provider_outage", { emittedToolCalls: true, emittedText: false, sideEffectProvenNone: true }), "a tool call proven unexecuted may move");
  assert(!mayFallback("provider_outage", { emittedToolCalls: true, emittedText: true, sideEffectProvenNone: true }), "text the person saw cannot be unsaid");
  assertEquals(PROVIDER_FAILURES.length, 7);
});
