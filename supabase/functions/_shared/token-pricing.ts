// ── Token pricing — THE ONE HOME (§18) ───────────────────────────────────────────────────────
//
// MEASURED ON PRODUCTION, 2026-09-01. Of 228 tenant-attributable traces carrying tokens, 197 (86%)
// recorded NO cost at all — 15,475,175 of 15,578,931 tokens, 99.3%. The priced 31 all came through
// `model-router`; the unpriced 197 all came through the DIRECT `claude.ts` path, which has the
// provider's own `usage` in hand at its trace site and simply never priced it. Patching six call
// sites would leave the seventh to be found later, so the estimate is filled at the single trace
// WRITER instead, and every caller — present and future — is priced by construction.
//
// WHY ITS OWN MODULE, and not inside `model-router` where the table used to live: `claude.ts` needs
// it and is imported BY the router, so a `claude.ts → model-router` import is a cycle. The platform
// had grown THREE copies of this table as a result — the router's, plus a local one in
// `eval/scorers.ts` whose own comment apologised for it ("estimateCost is not exported from the
// router"). Three tables that can drift apart silently is a §18 defect on its own; each unpriced
// path was the same defect wearing different clothes.
//
// It carries NO imports on purpose, so the same source that Deno type-checks for the edge runtime
// is the source `scripts/token-pricing/check.mjs` executes — the pricing arithmetic is graded by a
// real test rather than by reading it. (That check loads it through the harness's esbuild loader,
// not Node's own type stripping, which is version-dependent and broke CI once.)
//
// PER-MODEL, not per-provider, for anthropic. The old single "anthropic" price was Claude's
// reasoning-tier rate applied to EVERY Claude call, so 8,535,448 haiku tokens would have been
// booked at roughly 3× their real list price. An estimate that uses the wrong model's list price is
// not coarse, it is wrong (§13) — and it is wrong in the direction that overstates what a tenant
// owes, which is the worse direction.
//
// EVERY PRE-EXISTING PAIRING KEEPS ITS EXACT PRICE. The provider defaults are the previous numbers
// unchanged, so every sonnet-priced path — including the §33 visual-critique cost cap, which routes
// frontier on the Sonnet reasoning tier (`CLAUDE_REASONING`; every Sonnet id matches the same Sonnet row) — computes byte-identically. Only models that were demonstrably
// OVER-priced move, and only downward. The check suite pins this as its own case, so a later edit
// that quietly reprices an existing pairing fails rather than passing silently.

/** Rough public list prices, $/1K tokens. The `anthropic` row is the DEFAULT for an unknown Claude model. */
export const TEXT_PER_1K: Readonly<Record<string, { in: number; out: number }>> = {
  anthropic: { in: 0.003, out: 0.015 },     // Claude reasoning tier
  openai: { in: 0.0025, out: 0.010 },       // gpt-4o
  groq: { in: 0.00059, out: 0.00079 },      // Llama 3.3 70B
  featherless: { in: 0.0002, out: 0.0002 }, // flat-plan host; nominal per-token estimate
};

// Matched on a SUBSTRING of the model id, so `claude-haiku-4-5` and any later `claude-haiku-*`
// both resolve without a new entry per release. An unrecognised model falls back to the provider
// default above — never to zero, which would read as "this call was free".
export const ANTHROPIC_MODEL_PER_1K: ReadonlyArray<readonly [string, { in: number; out: number }]> = [
  ["haiku", { in: 0.001, out: 0.005 }],
  ["opus", { in: 0.015, out: 0.075 }],
  ["sonnet", { in: 0.003, out: 0.015 }],
];

// OpenAI GPT-6 family (INT-334), list prices from openai.com, $/1K. Matched on the EXACT id prefix,
// most specific first, so `gpt-6.1-sol` never falls into a shorter `gpt-6` entry. An unlisted OpenAI
// model keeps the provider default above (gpt-4o) — never zero. Cached input is not priced here
// (COST_BASIS excludes caching; INT-331 owns cache-aware cost).
export const OPENAI_MODEL_PER_1K: ReadonlyArray<readonly [string, { in: number; out: number }]> = [
  ["gpt-6.1-sol", { in: 0.002, out: 0.010 }],
  ["gpt-6-sol", { in: 0.002, out: 0.010 }],
  ["gpt-6-astra", { in: 0.010, out: 0.050 }],
  ["gpt-6-luna", { in: 0.0001, out: 0.0005 }],
];

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

/** The $/1K in+out rate for a provider/model, or undefined when there is no basis to price it. */
export function tokenRate(provider: string, model?: string | null): { in: number; out: number } | undefined {
  if (provider === "anthropic" && typeof model === "string") {
    const m = model.toLowerCase();
    for (const [needle, rate] of ANTHROPIC_MODEL_PER_1K) if (m.includes(needle)) return rate;
  }
  if (provider === "openai" && typeof model === "string") {
    const m = model.toLowerCase();
    for (const [prefix, rate] of OPENAI_MODEL_PER_1K) if (m.startsWith(prefix)) return rate;
  }
  return TEXT_PER_1K[provider];
}

/**
 * A clearly-labelled ESTIMATE of one text call's cost in USD.
 *
 * Returns undefined — NEVER 0 — when there is no basis: an unknown provider, or no token counts at
 * all. Zero and unknown are different facts. A meter that reports an unpriced call as free is the
 * same class of lie as a dashboard reporting an estimate as a bill, and it is the lie a downstream
 * `COALESCE(cost, 0)` writes for you if this function ever starts returning 0.
 */
export function estimateTokenCostUsd(
  provider: string,
  model?: string | null,
  tokensIn?: number | null,
  tokensOut?: number | null,
): number | undefined {
  if (tokensIn == null && tokensOut == null) return undefined;
  const rate = tokenRate(provider, model);
  if (!rate) return undefined;
  return round4(((tokensIn ?? 0) / 1000) * rate.in + ((tokensOut ?? 0) / 1000) * rate.out);
}

/** Provider-only STANDARD short-context list estimate, NOT customer/native metering.
 * Official OpenAI pricing/cache docs checked 2026-11-13. All input categories
 * are disjoint. Missing write lifetimes or inconsistent usage stays UNKNOWN. */
export function estimateOpenAIProviderUsageCost(
  model: string, input: number | null, output: number | null, cached: number | null,
  write30m: number | null, write12h: number | null,
): number | undefined {
  const counts = [input, output, cached, write30m, write12h];
  if (counts.some(n => n === null || !Number.isSafeInteger(n) || n < 0)) return undefined;
  // Long-context pricing is a distinct schedule. Never silently understate it.
  if (input! > 272000) return undefined;
  const known = OPENAI_MODEL_PER_1K.find(([id]) => model === id ||
    (model.startsWith(`${id}-`) && /^\d{4}-\d{2}-\d{2}$/.test(model.slice(id.length + 1))));
  if (!known) return undefined;
  const ordinary = input! - cached! - write30m! - write12h!;
  if (ordinary < 0) return undefined;
  const cachedMultiplier = known[0] === "gpt-6.1-sol" ? 0.05 : 0.1;
  const cost = ((ordinary + cached! * cachedMultiplier + write30m! * 1.25 + write12h! * 2.5)
    * known[1].in + output! * known[1].out) / 1000;
  return Number.isFinite(cost) ? Math.round(cost * 1e8) / 1e8 : undefined;
}
