/**
 * The Model Discovery Watch core (ANT-37), graded through its real modules: the source-backed
 * registry, the deterministic diff engine, and the cost-per-completed-task comparator. What this
 * pins:
 *  - REGISTRY INTEGRITY: every entry names an official source + observation date; the incumbents
 *    are DERIVED from the live serving/price sources and cross-checked so the registry can never
 *    quietly disagree with production; unknowns are unknown, never guessed.
 *  - LIFECYCLE HONESTY: one state at a time, no skips, rejected is terminal, and detection NEVER
 *    advances anything (no function exists that would).
 *  - THE SIX DETERMINISTIC SCENARIOS (owner activation directive): new family, retirement, price
 *    change (+direction/pct), capability change, stale source, contradictory data — and dedupe:
 *    a repeated unchanged announcement never re-alerts.
 *  - COMPARATOR MATH: per-COMPLETED-task arithmetic incl. reliability amortization; unknown
 *    pricing = undefined, never free; measured vs estimated labeled; a proxy workload is labeled.
 *  - AUTHORITY ISOLATION: the fabric's serving modules never import discovery (structural pin).
 *
 * Pure modules only — no env, no I/O, no network. Run: `npm run test:model-discovery`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log(`  FAIL  ${name}`); } };

const registry = await import("../../supabase/functions/_shared/model-discovery/registry.ts");
const diff = await import("../../supabase/functions/_shared/model-discovery/diff.ts");
const compare = await import("../../supabase/functions/_shared/model-discovery/compare.ts");
const { OPENAI_MODEL_BY_CLASS } = await import("../../supabase/functions/_shared/openai-models.ts");
const { tokenRate } = await import("../../supabase/functions/_shared/token-pricing.ts");

// ── 1. Registry integrity ─────────────────────────────────────────────────────────────────────
console.log("1. registry integrity — sources, derivation, honesty");
{
  const entries = Object.values(registry.MODEL_REGISTRY);
  ok(entries.length >= 4, `1.0 the registry holds incumbents + at least the owner-named challenger (${entries.length})`);
  ok(entries.every((c) => c.source?.url && /^\d{4}-\d{2}-\d{2}/.test(c.source.observed_at)),
    "1.1 every entry names a source URL and an observation date");
  ok(entries.every((c) => !c.pricing || (c.pricing.source?.url && c.pricing.basis)),
    "1.2 every priced entry attributes its price source and basis");
  // Incumbents are DERIVED: cross-check ids against the live serving constants and prices against
  // the ONE price home, so a serving or price edit that bypasses the registry fails here.
  for (const cls of ["cheap", "operational", "frontier"]) {
    const inc = registry.incumbentForClass(cls);
    ok(inc.id === OPENAI_MODEL_BY_CLASS[cls] && inc.lifecycle === "verified_release" && inc.serving_class === cls,
      `1.3 the ${cls} incumbent is derived from the live serving constant (${inc.id})`);
    ok(inc.pricing.input_per_1k === tokenRate("openai", inc.id).in && inc.pricing.output_per_1k === tokenRate("openai", inc.id).out,
      `1.4 the ${cls} incumbent's prices come from token-pricing.ts, not restated (${inc.pricing.input_per_1k}/1k in)`);
  }
  const haiku = registry.MODEL_REGISTRY["claude-haiku-4-5"];
  ok(haiku?.lifecycle === "discovered" && !haiku.serving_class,
    "1.5 a challenger is DISCOVERED with no serving class — detection grants no authority");
  // Workload honesty: measured entries cite provenance; the frontier proxy is labeled.
  const w = registry.WORKLOAD_DISTRIBUTIONS;
  ok(w.classification.measured && w.classification.sample_rows > 0 && /paige_llm_trace/.test(w.classification.provenance),
    "1.6 the classification workload cites its aggregate trace provenance");
  ok(!w.frontier.measured && w.frontier.sample_rows === 0 && /proxy/i.test(w.frontier.proxy_basis ?? ""),
    "1.7 the frontier workload is honestly unmeasured with a labeled proxy (no invented traffic)");
}

// ── 2. Lifecycle honesty ──────────────────────────────────────────────────────────────────────
console.log("2. lifecycle — one state at a time, owner-gated, never auto");
{
  const chal = registry.MODEL_REGISTRY["claude-haiku-4-5"];
  let threw = null;
  try { diff.advanceLifecycle(chal, "measured"); } catch (e) { threw = e; }
  ok(threw !== null, "2.1 a candidate cannot SKIP states (discovered → measured refuses)");
  const one = diff.advanceLifecycle(chal, "compatible");
  ok(one.lifecycle === "compatible", "2.2 the one legal advance works (discovered → compatible)");
  threw = null;
  try { diff.advanceLifecycle({ ...chal, lifecycle: "rejected" }, "compatible"); } catch (e) { threw = e; }
  ok(threw !== null, "2.3 rejected is terminal");
  const SERVING_SEAM = [
    "../../supabase/functions/_shared/model-fabric.ts",
    "../../supabase/functions/_shared/paige-turn/route.ts",
    "../../supabase/functions/_shared/openai-responses.ts",
    "../../supabase/functions/_shared/claude.ts",
    "../../supabase/functions/_shared/paige-turn/classify-call.ts",
    "../../supabase/functions/paige-ai-chat/index.ts",
    "../../supabase/functions/paige-deep-research/fabric.ts",
  ];
  const leaking = SERVING_SEAM.filter((f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8").includes("model-discovery"));
  ok(leaking.length === 0,
    `2.4 NO serving module imports discovery — no routing authority flows from detection (${leaking.length ? "LEAKS: " + leaking.join(", ") : "fabric, route, adapters, chat, research all clean"})`);
  const diffSrc = readFileSync(fileURLToPath(new URL("../../supabase/functions/_shared/model-discovery/diff.ts", import.meta.url)), "utf8");
  ok(!/MODEL_REGISTRY\[.*\]\s*=/.test(diffSrc) && !diffSrc.includes("model-fabric"),
    "2.5 the diff engine mutates no registry entry and touches no serving module");
}

// ── 3. The six deterministic scenarios + dedupe ───────────────────────────────────────────────
console.log("3. diff — new family, retirement, price, capability, context, stale, contradiction, dedupe");
{
  const incumbentFamilies = new Set(Object.values(registry.MODEL_REGISTRY).map((c) => c.family));
  const prev = {
    "gpt-6.1-sol": { model: "gpt-6.1-sol", observed_at: "2026-10-01", source_url: "https://api.openai.com/v1/models", input_per_1k: 0.002, output_per_1k: 0.010 },
  };
  const next = {
    "gpt-7-luna": { model: "gpt-7-luna", observed_at: "2026-11-01", source_url: "https://api.openai.com/v1/models", input_per_1k: 0.0001, output_per_1k: 0.0005, context_tokens: 400000, tools: true, structured_output: true, streaming: true },
    "gpt-6-luna": { model: "gpt-6-luna", observed_at: "2026-11-01", source_url: "https://api.openai.com/v1/models", input_per_1k: 0.0001, output_per_1k: 0.0005, availability: "deprecated", context_tokens: 400000, tools: true, structured_output: true, streaming: true },
    "gpt-6.1-sol": { model: "gpt-6.1-sol", observed_at: "2026-11-01", source_url: "https://api.openai.com/v1/models", input_per_1k: 0.003, output_per_1k: 0.010, context_tokens: 272000, tools: true, structured_output: true, streaming: true },
    "gpt-6-astra": { model: "gpt-6-astra", observed_at: "2026-11-01", source_url: "https://api.openai.com/v1/models", input_per_1k: 0.010, output_per_1k: 0.050, context_tokens: 400000, tools: false, structured_output: true, streaming: true },
  };
  const events = diff.diffObservations(prev, next, incumbentFamilies);
  ok(events.some((e) => e.kind === "family_new" && e.model === "gpt-7-luna"),
    "3.1 a new model family is detected (gpt-7-*, not an incumbent family)");
  ok(!events.some((e) => e.kind === "family_new" && e.model === "gpt-6.1-sol"),
    "3.2 an incumbent-family model never emits family_new");
  ok(events.some((e) => e.kind === "family_retired" && e.model === "gpt-6-luna" && e.after === "deprecated"),
    "3.3 an announced deprecation is detected with its evidence");
  const priceUp = events.find((e) => e.kind === "price_changed" && e.model === "gpt-6.1-sol" && e.field === "input_per_1k");
  ok(priceUp && priceUp.delta_pct === 50 && priceUp.before === "0.002",
    `3.4 a price increase is detected with direction (+${priceUp?.delta_pct}%, list 0.002→0.003)`);
  const firstPrice = events.find((e) => e.kind === "price_changed" && e.model === "gpt-7-luna");
  ok(firstPrice && firstPrice.delta_pct === undefined,
    "3.5 a FIRST-EVER price is a change with no delta (unknown before — never a fabricated 0%)");
  ok(events.some((e) => e.kind === "capability_changed" && e.model === "gpt-6-astra" && e.field === "tools" && e.after === "false"),
    "3.6 a capability regression is detected (tools true→false)");
  ok(events.some((e) => e.kind === "context_changed" && e.model === "gpt-6-astra" && e.after === "400000"),
    "3.7 a context-window change is detected");
  // Re-announcing the same facts on a later date: the diff emits, dedupe against prior signatures suppresses.
  const again = diff.diffObservations(next, next, incumbentFamilies);
  ok(again.length === 0, "3.8 an unchanged re-observation produces ZERO events (no duplicate alerts)");
  const lastByBasis = new Map(events.map((e) => [[e.kind, e.model, e.field ?? ""].join("|"), e.after ?? ""]));
  ok(diff.dedupeEvents(events, lastByBasis).length === 0,
    "3.9 events already alerted at the same value are suppressed by basis (the provider page repeating itself stays quiet)");
  const flip = [
    { kind: "price_changed", model: "gpt-7-luna", field: "input_per_1k", before: "0.0001", after: "0.0002", source_url: "api", observed_at: "2026-11-02" },
    { kind: "price_changed", model: "gpt-7-luna", field: "input_per_1k", before: "0.0002", after: "0.0001", source_url: "api", observed_at: "2026-11-03" },
  ];
  ok(diff.dedupeEvents(flip, lastByBasis).length === 2,
    "3.9b a value that left and came back fires AGAIN (A→B→A alerts twice — the basis's last value changed in between)");
  const stale = diff.detectStaleSources([{ model: "gpt-6-luna", observed_at: "2026-09-01", source_url: "x" }], "2026-11-15");
  ok(stale.length === 1 && stale[0].kind === "stale_source" && stale[0].after === "2026-09-01" && stale[0].observed_at === "2026-11-15",
    "3.10 a source older than the staleness bound is flagged, carrying its LAST-SEEN date as the fact (a re-delist after a relist fires anew)");
  const reStale = diff.detectStaleSources([{ model: "gpt-6-luna", observed_at: "2026-12-01", source_url: "x" }], "2027-01-15");
  ok(reStale.length === 1 && reStale[0].after === "2026-12-01",
    "3.10b the stale basis keys on the date — delist→relist→re-delist is a NEW fact, never suppressed forever");
  const contra = diff.detectContradictions([
    { model: "gpt-7-luna", observed_at: "2026-11-01", source_url: "api", input_per_1k: 0.0001 },
    { model: "gpt-7-luna", observed_at: "2026-11-01", source_url: "pricing-page", input_per_1k: 0.0002 },
  ]);
  ok(contra.length === 1 && contra[0].kind === "contradictory_data" && / vs /.test(contra[0].source_url),
    "3.11 two sources disagreeing on a price is contradictory_data, both sources named");
  const noBasis = diff.diffObservations({ "gpt-6-astra": next["gpt-6-astra"] }, { "gpt-6-astra": next["gpt-6-astra"] }, incumbentFamilies);
  ok(noBasis.every((e) => e.kind !== "family_new"), "3.12 a known model re-observed is not a new family");
}

// ── 4. Comparator math — per COMPLETED task, honest bases ─────────────────────────────────────
console.log("4. comparator — cost per completed task, measured vs estimated, unknown ≠ free");
{
  const haikuRate = tokenRate("anthropic", "claude-haiku-4-5");
  ok(registry.MODEL_REGISTRY["claude-haiku-4-5"].pricing.input_per_1k === haikuRate.in
    && registry.MODEL_REGISTRY["claude-haiku-4-5"].pricing.output_per_1k === haikuRate.out,
    "1.8 the Haiku challenger's prices cannot drift from the ONE price home (token-pricing.ts), source attribution kept");
  const w = registry.WORKLOAD_DISTRIBUTIONS;
  const luna = registry.incumbentForClass("cheap");
  const est = compare.estimateTaskCost(luna, w.classification);
  ok(est.basis === "estimated" && est.workload_measured,
    "4.1 no reliability supplied → estimated basis on the measured workload");
  const expected = (w.classification.tokens_in_p50 * luna.pricing.input_per_1k + w.classification.tokens_out_p50 * luna.pricing.output_per_1k) / 1000;
  ok(Math.abs(est.per_task_usd - expected) < 1e-12,
    `4.2 the arithmetic is (in×p_in + out×p_out)/1000 (${est.per_task_usd.toExponential(3)} for a classification call)`);
  const half = compare.estimateTaskCost(luna, w.classification, { success_rate: 0.5, fallback_rate: 0.5, source: "fixture" });
  ok(half.basis === "measured" && Math.abs(half.per_task_usd - expected * 2) < 1e-12,
    "4.3 a 50% success rate DOUBLES the per-completed-task cost (failures amortize into completions)");
  let threw = null;
  try { compare.estimateTaskCost(luna, w.classification, { success_rate: 0, fallback_rate: 0, source: "x" }); } catch (e) { threw = e; }
  ok(threw !== null, "4.4 a zero success rate refuses (÷0 is not a price)");
  const unpriced = { ...luna, id: "mystery-1", pricing: undefined };
  ok(compare.estimateTaskCost(unpriced, w.classification) === undefined,
    "4.5 a model with no price basis yields undefined — never free, never compared");
  const haiku = registry.MODEL_REGISTRY["claude-haiku-4-5"];
  const cmp = compare.compareForWorkload(haiku, "cheap", w.classification);
  ok(cmp.verdict === "not_cheaper" && cmp.cheaper_pct === -900,
    `4.6 the owner-named Haiku comparison computes HONESTLY: ${cmp.cheaper_pct}% (Haiku is ~10× Luna's list price per completed classification — the comparator reports the arithmetic, flattering or not)`);
  const cmpFrontier = compare.compareForWorkload(haiku, "frontier", w.frontier);
  ok(cmpFrontier.candidate?.workload_proxy !== undefined,
    "4.7 the frontier comparison carries the proxy label (no invented traffic basis)");
  const cmpNoBasis = compare.compareForWorkload(unpriced, "operational", w.operational);
  ok(cmpNoBasis.verdict === "unknown_basis" && cmpNoBasis.cheaper_pct === undefined,
    "4.8 an unpriced candidate yields unknown_basis with no percentage");
}

console.log(`discovery-check: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
