/**
 * Grades `supabase/functions/_shared/token-pricing.ts` — the one home for LLM token pricing.
 *
 * WHY THIS EXISTS. The meter (`meter_llm_usage`) carries a cost figure into a usage record, and a
 * usage record is the thing a billing decision is eventually made from. Three properties therefore
 * have to be true and have to STAY true, and none of them is visible by reading the table:
 *
 *   1. No PRE-EXISTING provider/model pairing changed price when per-model pricing was introduced.
 *      The §33 visual-critique cost cap routes frontier on `claude-sonnet-5` and compares a running
 *      spend against `STUDIO_CRITIQUE_COST_CAP_USD`; if sonnet's rate moved, that cap silently
 *      allows more or fewer iterations. Section 1 pins every previously-priced pairing to its exact
 *      previous arithmetic.
 *   2. An unpriceable call returns `undefined`, never `0`. Zero and unknown are different facts —
 *      and `COALESCE(cost, 0)` downstream turns the second into the first for free.
 *   3. Haiku is no longer booked at reasoning-tier rates. This was the live defect: 8,535,448 haiku
 *      tokens on production would have been priced at roughly 3× their list price.
 *
 * It runs the REAL module — the same source Deno type-checks for the edge runtime. No
 * re-implementation of the arithmetic lives here; a test that recomputes the thing it is grading
 * proves only that it can multiply.
 *
 * It loads that source through the harness's esbuild loader rather than Node's own type stripping.
 * The first version used `--experimental-strip-types`, which passed locally on Node 22 and failed
 * CI outright with `bad option` — the flag was REMOVED in Node 24, which the runner uses. A test
 * that only runs on the author's Node version is not a gate. The loader is already proven in CI by
 * the sibling `trace-wiring` suite and is version-independent.
 */
import { ANTHROPIC_MODEL_PER_1K, estimateTokenCostUsd, tokenRate } from "../../supabase/functions/_shared/token-pricing.ts";

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log(`  FAIL  ${name}`); } };
const eq = (got, want, name) => ok(Object.is(got, want), `${name} — expected ${want}, got ${got}`);

// ── 1. NO PRE-EXISTING PAIRING CHANGED PRICE ────────────────────────────────────────────────
// The previous estimator was provider-keyed only, at these exact rates. Every one is re-asserted
// against a hand-computed figure, so a future edit to the table fails here rather than shipping.
console.log("1. every pre-existing provider price is byte-identical to before per-model pricing");
// 1000 in + 1000 out = 1 kIn + 1 kOut, so the answer IS (in + out).
eq(estimateTokenCostUsd("anthropic", "claude-sonnet-5", 1000, 1000), 0.018, "1.1 anthropic sonnet 0.003+0.015");
eq(estimateTokenCostUsd("openai", null, 1000, 1000), 0.0125, "1.2 openai 0.0025+0.010");
eq(estimateTokenCostUsd("groq", null, 1000, 1000), 0.0014, "1.3 groq 0.00059+0.00079 rounded to 4dp");
eq(estimateTokenCostUsd("featherless", null, 1000, 1000), 0.0004, "1.4 featherless 0.0002+0.0002");
// The provider DEFAULT for an unknown Claude model must still be the reasoning-tier rate — that is
// what every previously-priced anthropic row was computed at.
eq(estimateTokenCostUsd("anthropic", null, 1000, 1000), 0.018, "1.5 anthropic default (no model) unchanged");
eq(estimateTokenCostUsd("anthropic", "some-future-claude", 1000, 1000), 0.018,
   "1.6 an UNRECOGNISED claude model falls back to the default rate, not to zero");

// The §33 cap consumer, stated as its own case so the coupling is not merely a comment.
eq(tokenRate("anthropic", "claude-sonnet-5").in, tokenRate("anthropic", null).in,
   "1.7 §33 critique routes claude-sonnet-5; its rate equals the old provider default (cap unmoved)");
eq(tokenRate("anthropic", "claude-sonnet-5").out, tokenRate("anthropic", null).out,
   "1.8 …on the output rate too");
// INT-329: the reasoning tier may move to claude-sonnet-5-5 (part 2). Pricing it by VALUE alone cannot tell "matched
// the Sonnet row" from "fell back to the provider default" (both are 0.003/0.015), so the matched row is
// asserted by name — an unknown-model fallback must never be what prices the live reasoning tier.
eq(ANTHROPIC_MODEL_PER_1K.find(([needle]) => "claude-sonnet-5-5".includes(needle))?.[0], "sonnet",
   "1.9 claude-sonnet-5-5 is priced by the explicit Sonnet row, not the unknown-model default");
eq(estimateTokenCostUsd("anthropic", "claude-sonnet-5-5", 1000, 1000), estimateTokenCostUsd("anthropic", "claude-sonnet-5", 1000, 1000),
   "1.10 …at the same estimate as claude-sonnet-5 (list prices are identical, so the A/B is like-for-like)");

// ── 2. UNKNOWN IS NOT ZERO ──────────────────────────────────────────────────────────────────
console.log("2. an unpriceable call returns undefined, never 0");
eq(estimateTokenCostUsd("anthropic", "claude-sonnet-5", null, null), undefined,
   "2.1 no token counts at all → undefined (a call we cannot price is not a free call)");
eq(estimateTokenCostUsd("anthropic", "claude-sonnet-5", undefined, undefined), undefined,
   "2.2 …undefined counts behave the same as null");
eq(estimateTokenCostUsd("some-new-provider", null, 1000, 1000), undefined,
   "2.3 an unknown PROVIDER is undefined, not 0 — a provider we have no list price for is unpriced");
// The distinction that matters: a genuinely zero-token successful call IS priceable, and is 0.
eq(estimateTokenCostUsd("anthropic", "claude-sonnet-5", 0, 0), 0,
   "2.4 …but a call that really used 0 tokens costs 0 — zero and unknown stay different answers");
ok(estimateTokenCostUsd("anthropic", "claude-sonnet-5", 1000, null) === 0.003,
   "2.5 one side missing still prices the side we have");

// ── 3. HAIKU IS NO LONGER BOOKED AT REASONING-TIER RATES ────────────────────────────────────
console.log("3. per-model pricing — the live over-charge that forced this");
eq(estimateTokenCostUsd("anthropic", "claude-haiku-4-5", 1000, 1000), 0.006, "3.1 haiku 0.001+0.005");
ok(estimateTokenCostUsd("anthropic", "claude-haiku-4-5", 1000, 1000)
     < estimateTokenCostUsd("anthropic", "claude-sonnet-5", 1000, 1000),
   "3.2 haiku prices STRICTLY BELOW sonnet — the defect was that they were equal");
eq(estimateTokenCostUsd("anthropic", "claude-opus-5", 1000, 1000), 0.09, "3.3 opus 0.015+0.075");
ok(estimateTokenCostUsd("anthropic", "claude-opus-5", 1000, 1000)
     > estimateTokenCostUsd("anthropic", "claude-sonnet-5", 1000, 1000),
   "3.4 opus prices STRICTLY ABOVE sonnet");
// Substring matching, so a later release needs no new entry.
eq(estimateTokenCostUsd("anthropic", "CLAUDE-HAIKU-9", 1000, 1000), 0.006,
   "3.5 matching is case-insensitive and version-agnostic — a future haiku needs no code change");
// A NON-anthropic provider must not be model-matched: 'haiku' in an openai model name is not a
// Claude tier, and letting it match would price an OpenAI call off Anthropic's table.
eq(estimateTokenCostUsd("openai", "haiku-flavoured-gpt", 1000, 1000), 0.0125,
   "3.6 model matching is anthropic-only — another provider's model name never reaches Claude rates");

// ── 4. THE PRODUCTION FIGURE THIS CHANGE IS FOR ─────────────────────────────────────────────
// 8,535,448 haiku tokens are on production unpriced. Not back-priced (§13 — the migration says so),
// but the going-forward rate is asserted here so the size of what was being mis-stated is on record.
console.log("4. the measured production quantity, priced both ways");
const haikuOld = estimateTokenCostUsd("anthropic", null, 4267724, 4267724);
const haikuNew = estimateTokenCostUsd("anthropic", "claude-haiku-4-5", 4267724, 4267724);
ok(haikuOld > haikuNew * 2.9 && haikuOld < haikuNew * 3.1,
   `4.1 the old provider-only rate over-prices haiku by ~3× (old $${haikuOld} vs new $${haikuNew})`);

console.log(`\ntoken-pricing: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
