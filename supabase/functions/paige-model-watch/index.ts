// paige-model-watch — ANT-37: the Model Discovery Watch beat. Scheduled daily by the incumbent
// pg_cron pattern (migration-registered, like heartbeat/evaluator-daily), manually invocable by
// the service role.
//
// WHAT IT DOES — metadata only, zero spend, existing credentials:
//   1. Reads the COST-FREE official models-list endpoints (OpenAI `GET /v1/models`, Anthropic
//      `GET /v1/models`) with the EXISTING production keys. No inference, no billing, no new
//      credentials, no egress beyond the two providers PAIGE already calls.
//   2. Persists what the sources said as `model_discovery_observations` (append-only, dated by
//      the source, raw record capped). A models list states EXISTENCE, not prices — unknown
//      pricing is left absent, never guessed.
//   3. Diffs against the previous observation per model (pure engine: `_shared/model-discovery/
//      diff.ts`), dedupes by event signature against `model_discovery_events`, and inserts only
//      NEW facts (an unchanged re-announcement stays quiet).
//   4. Returns the summary. Discovery events are INFORMATION for owner review — nothing here
//      touches routing, admission, or lifecycle (the fabric imports no discovery module; pinned).
//
// DORMANT BY GATE (implemented, not abandoned — the activation directive's rule): if a source's
// key is absent the watch records that source as skipped, honestly, and continues with the rest.
// Deliberately NOT implemented (owner-gated forever, recorded in ANT-37): release-note scraping
// beyond the two official endpoints, pricing-page fetching (the price home is token-pricing.ts),
// any benchmark or probe that spends, and any new provider credential.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { diffObservations, detectStaleSources, eventSignature, type CatalogObservation } from "../_shared/model-discovery/diff.ts";
import { MODEL_REGISTRY } from "../_shared/model-discovery/registry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** One cost-free models-list read. Returns honest nulls: missing key → DORMANT (gate recorded), error → failed. */
async function readModelsList(
  label: string,
  url: string,
  headers: Record<string, string>,
  hasCredential: boolean,
): Promise<{ source: string; models: string[] | null; error?: string }> {
  // Gate on the CREDENTIAL, not the rendered header ("Bearer " is truthy — the P2 this fixed).
  if (!hasCredential) return { source: label, models: null, error: "dormant: no existing credential for this source (gate recorded)" };
  try {
    const r = await fetch(url, { headers, method: "GET" });
    if (!r.ok) return { source: label, models: null, error: `http_${r.status}` };
    const data = await r.json();
    const models = Array.isArray(data?.data) ? data.data.map((m: { id?: unknown }) => String(m?.id ?? "")).filter(Boolean) : null;
    return { source: label, models };
  } catch (e) {
    return { source: label, models: null, error: `network: ${(e as Error)?.name ?? "error"}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let authorized = bearer.length > 0 && bearer === SERVICE_ROLE;
  if (!authorized) {
    const cronToken = req.headers.get("x-cron-token") ?? "";
    if (cronToken) {
      const { data: cronOk } = await admin.rpc("verify_cron_token", { _token: cronToken });
      authorized = cronOk === true;
    }
  }
  if (!authorized) return json({ error: "unauthorized" }, 401);

  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    await readModelsList("https://api.openai.com/v1/models", "https://api.openai.com/v1/models", {
      authorization: `Bearer ${OPENAI_KEY ?? ""}`,
    }, Boolean(OPENAI_KEY)),
    await readModelsList("https://api.anthropic.com/v1/models", "https://api.anthropic.com/v1/models", {
      "x-api-key": ANTHROPIC_KEY ?? "",
      "anthropic-version": "2023-06-01",
    }, Boolean(ANTHROPIC_KEY)),
  ];

  // 1) Persist what each source said (existence only; pricing/caps stay absent, never guessed).
  // Batched: one insert per source, one prior-lookup per run — a cron beat, not a request loop.
  const next: Record<string, CatalogObservation> = {};
  let observedCount = 0;
  for (const s of sources) {
    if (!s.models) continue;
    const rows = s.models.map((id) => ({
      observed_at: today, source_url: s.source,
      provider: s.source.includes("anthropic") ? "anthropic" : "openai",
      model: id, availability: "ga", raw: { endpoint_listed: true },
    }));
    for (const id of s.models) {
      next[id] = { model: id, observed_at: today, source_url: s.source, availability: "ga" }; // ids are provider-unique
      observedCount++;
    }
    const { error: insErr } = await admin.from("model_discovery_observations").insert(rows);
    if (insErr) return json({ error: "observation_write_failed", detail: insErr.message }, 500);
  }

  // 2) The most recent PRIOR observation per listed model (one batched read), then the pure diff.
  const ids = Object.keys(next);
  const prev: Record<string, CatalogObservation> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from("model_discovery_observations")
      .select("model, observed_at, source_url, availability, input_per_1k, output_per_1k, context_tokens, tools, structured_output, streaming")
      .in("model", ids.slice(i, i + 100)).lt("observed_at", today)
      .order("observed_at", { ascending: false });
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const id = String(row.model);
      if (!prev[id]) prev[id] = {
        model: id, observed_at: String(row.observed_at).slice(0, 10), source_url: String(row.source_url),
        availability: (row.availability as CatalogObservation["availability"]) ?? undefined,
        input_per_1k: row.input_per_1k != null ? Number(row.input_per_1k) : undefined,
        output_per_1k: row.output_per_1k != null ? Number(row.output_per_1k) : undefined,
        context_tokens: row.context_tokens != null ? Number(row.context_tokens) : undefined,
        tools: row.tools != null ? Boolean(row.tools) : undefined,
        structured_output: row.structured_output != null ? Boolean(row.structured_output) : undefined,
        streaming: row.streaming != null ? Boolean(row.streaming) : undefined,
      };
    }
  }
  const incumbentFamilies = new Set(Object.values(MODEL_REGISTRY).map((c) => c.family));
  const events = diffObservations(prev, next, incumbentFamilies);

  // 2b) STALENESS is the delisting signal: a model the sources no longer list leaves its LAST
  // observation behind, and once that ages past STALE_AFTER_DAYS the watch says so (dated,
  // deduped) — absence is never silently ignored. The last-seen map comes from the EXACT
  // group-by RPC (model_discovery_last_seen), never a fixed-row window: a window of N rows
  // covers only N/catalog-size days and would silently fall inside the staleness bound.
  const listed = new Set(Object.keys(next));
  const { data: lastSeenRows, error: lastSeenErr } = await admin.rpc("model_discovery_last_seen");
  if (lastSeenErr) return json({ error: "last_seen_read_failed", detail: lastSeenErr.message }, 500);
  const absentStale = ((lastSeenRows ?? []) as Array<{ model: string; last_seen: string; source_url: string }>)
    .filter((row) => !listed.has(row.model) && String(row.last_seen).slice(0, 10) !== today)
    .map((row) => ({ model: row.model, observed_at: String(row.last_seen).slice(0, 10), source_url: row.source_url }));
  const allEvents = [...events, ...detectStaleSources(absentStale, today)];

  // 3) Dedupe: an event is suppressed only when the LAST event for its basis (kind|model|field)
  // already says the same value — unchanged re-announcements stay quiet, but a value that
  // LEFT and came back fires again (A→B→A→B alerts twice, as it should).
  const { data: lastEventRows } = await admin.from("model_discovery_events")
    .select("kind, model, field, after_value").order("created_at", { ascending: false }).limit(5000);
  const lastValueByBasis = new Map<string, string>();
  for (const row of (lastEventRows ?? []) as Array<{ kind: string; model: string; field: string | null; after_value: string | null }>) {
    const basis = [row.kind, row.model, row.field ?? ""].join("|");
    if (!lastValueByBasis.has(basis)) lastValueByBasis.set(basis, row.after_value ?? "");
  }
  const suppressedKinds: Record<string, number> = {};
  const insertedKinds: Record<string, number> = {};
  let inserted = 0;
  for (const e of allEvents) {
    const basis = [e.kind, e.model, e.field ?? ""].join("|");
    if (lastValueByBasis.get(basis) === (e.after ?? "")) {
      suppressedKinds[e.kind] = (suppressedKinds[e.kind] ?? 0) + 1;
      continue;
    }
    // The STORED signature is date-scoped: a same-day double beat still collides (the race
    // backstop), while a value that left and came back on a later date inserts a NEW row —
    // the all-time-unique basis+value key would have silently dropped the returning fact.
    const { error } = await admin.from("model_discovery_events").insert({
      signature: `${eventSignature(e)}|${e.observed_at}`, kind: e.kind, model: e.model, field: e.field ?? null,
      before_value: e.before ?? null, after_value: e.after ?? null, delta_pct: e.delta_pct ?? null,
      source_url: e.source_url, observed_at: e.observed_at,
    });
    if (error) console.warn("[model-watch] event insert failed:", e.kind, e.model, error.message);
    else { inserted++; insertedKinds[e.kind] = (insertedKinds[e.kind] ?? 0) + 1; lastValueByBasis.set(basis, e.after ?? ""); }
  }

  return json({
    ok: true,
    ran_at: today,
    sources: sources.map((s) => ({ source: s.source, models: s.models?.length ?? null, error: s.error ?? null })),
    observed: observedCount,
    events_new: inserted,
    events_kinds: insertedKinds,
    events_suppressed_unchanged: suppressedKinds,
    note: "informational only — no routing, admission or lifecycle change; owner review owns every advance",
  });
});
