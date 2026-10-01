/**
 * Grades the WIRING, not the arithmetic: does `traceLLMCall` actually put a cost on a row that
 * arrives without one?
 *
 * `scripts/token-pricing/check.mjs` proves the estimator computes the right number. That is a
 * different question from whether anything CALLS it. The live defect was exactly this gap — the
 * estimator existed in `model-router` and was correct, and 197 of 228 production traces still
 * carried no cost, because the `claude.ts` path never reached it. A pricing test that only exercises
 * the pricing function would have been fully green throughout.
 *
 * So this drives the REAL `_shared/llm-trace.ts` under the same ESM loader the knowledge-scope
 * harness uses (esm.sh → the recording fake client) and reads the row that was actually handed to
 * `.insert()`.
 */
import { setScenario, recorder } from "../client-memory-authz/fake-supabase.mjs";

// The module resolves its service client from `Deno.env` at first use. A missing service context is
// an honest NO-OP in production (no trace rather than a fake one) — so without this the whole suite
// would pass by writing nothing at all, which is the vacuity this harness must not have.
globalThis.Deno = {
  env: { get: (k) => ({
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  })[k] ?? "" },
};

const { traceLLMCall, COST_BASIS } = await import("../../supabase/functions/_shared/llm-trace.ts");

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log(`  FAIL  ${name}`); } };

/** Fire one trace and return the row that reached `.insert()`. */
async function traced(row) {
  setScenario({});
  traceLLMCall(row);
  // The write is detached (waitUntil is absent under Node, so it is a bare promise). Yield until it
  // has run rather than assuming synchrony — asserting too early would read an empty recorder and
  // report a MISSING row as a wrong row.
  for (let i = 0; i < 20 && recorder().inserts.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
  return recorder().inserts.find((x) => x.table === "paige_llm_trace")?.row ?? null;
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const base = { tenant_id: TENANT, provider: "anthropic", status: "success", tokens_in: 1000, tokens_out: 1000 };

console.log("1. an unpriced successful call is priced at the writer");
{
  // THE PRODUCTION SHAPE: exactly what `claude.ts` hands over — usage, no cost, no tier.
  const r = await traced({ ...base, model: "claude-haiku-4-5" });
  ok(r !== null, "1.0 the trace row reached insert at all");
  ok(r?.cost_estimate_usd === 0.006, `1.1 the claude.ts shape is now PRICED (got ${r?.cost_estimate_usd})`);
  ok(r?.cost_basis === COST_BASIS, "1.2 …and carries the basis string, so no reader mistakes it for a bill");
  ok(r?.tier === null, "1.3 tier stays null — the writer prices the call, it does not invent routing facts");
  // The recorder captures the row at `.insert()`, one link BEFORE `.abortSignal()`. So a row can be
  // recorded even if the chain then dies. Assert the chain actually completed, or every check above
  // is graded on a write that never happened.
  const chain = recorder().from.find((f) => f.table === "paige_llm_trace");
  ok(chain?.filters?.some((f) => f[0] === "abortSignal"),
     "1.4 the insert chain ran to completion — not recorded and then thrown away");
}

console.log("2. a caller that priced its own call still wins");
{
  // model-router supplies its own figure. The writer must not recompute and quietly disagree with it.
  const r = await traced({ ...base, model: "claude-sonnet-5", tier: "reasoning", cost_estimate_usd: 0.0424 });
  ok(r?.cost_estimate_usd === 0.0424, `2.1 the caller's explicit estimate is preserved (got ${r?.cost_estimate_usd})`);
}

console.log("3. the writer never invents a cost it has no basis for");
{
  // NOT the no-token error: that one declines for an unrelated reason (nothing to price), so it
  // grades nothing about the status guard. A mutation dropping `status === "success"` survived this
  // suite until the case below was added. The distinguishing shape is an error that DID report usage
  // — a stream that failed after partial tokens — where the estimator would happily produce a figure.
  const err = await traced({ ...base, model: "claude-sonnet-5", status: "error" });
  ok(err?.tokens_in === 1000, "3.0 the failed call really does carry usage — otherwise 3.1 grades nothing");
  ok(err?.cost_estimate_usd === null,
     `3.1 a FAILED call is unpriced even WITH usage, matching the router's own rule (got ${err?.cost_estimate_usd})`);
  ok(err?.cost_basis === null, "3.2 …and carries no basis, so null cost is never read as a measured zero");

  const unknown = await traced({ ...base, provider: "some-new-provider", model: null });
  ok(unknown?.cost_estimate_usd === null,
     "3.3 a provider with no list price stays null — not 0, which would book real spend as free");

  // A success that genuinely reported zero tokens: still no cost, but for a different reason. It must
  // not be silently priced as if tokens had been reported.
  const zero = await traced({ ...base, model: "claude-sonnet-5", tokens_in: 0, tokens_out: 0 });
  ok(zero?.cost_estimate_usd === 0, "3.4 a real zero-token success prices to 0 — measured, not unknown");
}

console.log("4. a per-artifact modality is left to the router, which knows the modality");
{
  // Image/3D/voice have no tokens, so the writer's token estimator must decline rather than
  // guess — the artifact price is the router's to supply.
  const img = await traced({ ...base, provider: "ideogram", model: null, modality: "image", tokens_in: null, tokens_out: null });
  ok(img?.cost_estimate_usd === null, "4.1 an artifact call with no tokens is not token-priced at the writer");
}

console.log("5. a refused row is not silent, and a missing cache column degrades instead of losing every trace");
{
  // WHY THIS EXISTS: supabase-js RESOLVES a PostgREST rejection into `{ error }` — it does not throw.
  // The writer's try/catch therefore never saw one, so a row the database refused vanished without so
  // much as a console.error. The shed-and-retry below replaced that silence; these lock it in.
  //
  // It also closes a gap in this harness's own history: the branch shipped with no coverage because
  // the harness was reported unrunnable. It runs — under `--import ../client-memory-authz/register.mjs`,
  // the same loader the header already names — and `fake-supabase.mjs` has supported a RETURNED insert
  // error the whole time.
  const attemptsFor = async (onInsert, row) => {
    setScenario({ onInsert });
    traceLLMCall(row);
    for (let i = 0; i < 40 && recorder().inserts.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    // Give a retry room to land. Asserting on one tick would read the first attempt and call a
    // two-attempt path a one-attempt path.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    return recorder().inserts.filter((x) => x.table === "paige_llm_trace").map((x) => x.row);
  };
  const CACHE_KEYS = ["cache_read_input_tokens", "cache_creation_input_tokens"];
  const withCache = { ...base, model: "claude-sonnet-5", cache_read_input_tokens: 4096, cache_creation_input_tokens: 128 };

  // (a) the race this branch exists for: the writer reaches production ahead of its migration.
  const shed = await attemptsFor(
    () => ({ code: "PGRST204", message: "Could not find the 'cache_read_input_tokens' column of 'paige_llm_trace' in the schema cache" }),
    withCache,
  );
  ok(shed.length === 2, "5.1 a cache-column PGRST204 retries exactly once — not zero, and not a loop");
  ok(shed[1] && CACHE_KEYS.every((k) => !(k in shed[1])),
     "5.2 the retry sheds BOTH cache columns, so the row lands instead of every trace being lost");
  ok(shed[1] && shed[1].tokens_in === 1000 && shed[1].cost_estimate_usd != null,
     "5.3 shedding drops only the cache columns — the rest of the row survives intact");

  // (b) the misattribution the peer-gate measured: keying on the CODE alone blamed the cache columns
  // for any missing column, and burned a retry still carrying the real offender.
  const other = await attemptsFor(
    () => ({ code: "PGRST204", message: "Could not find the 'working_context_tenant_id' column of 'paige_llm_trace' in the schema cache" }),
    withCache,
  );
  ok(other.length === 1,
     "5.4 a PGRST204 naming a DIFFERENT column does not retry — the shed is not a blanket code match");

  // (c) an ordinary rejection is reported once, never retried.
  const refused = await attemptsFor(() => ({ code: "23505", message: "duplicate key value violates unique constraint" }), withCache);
  ok(refused.length === 1, "5.5 a non-column rejection is logged and left alone, not retried");

  // (d) the happy path is untouched — one insert, cache counts carried through.
  const clean = await attemptsFor(() => null, withCache);
  ok(clean.length === 1, "5.6 a clean insert stays exactly one insert");
  ok(clean[0]?.cache_read_input_tokens === 4096 && clean[0]?.cache_creation_input_tokens === 128,
     "5.7 cache counts reach the row — the whole point of the change");
  ok(clean[0]?.tokens_in === 1000,
     "5.8 cache counts are NOT folded into tokens_in — meter_llm_usage bills tokens_in + tokens_out");
}

console.log(`\ntrace-wiring: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
