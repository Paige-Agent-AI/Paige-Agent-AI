// model-discovery/diff.ts — ANT-37: the deterministic change-detection engine. PURE: no env, no
// I/O, no clock reads (time arrives as an argument so tests are deterministic).
//
// It compares two observation snapshots of provider catalogs and emits CLOSED change events, each
// carrying its evidence (model, field, old→new, sources, timestamps). It NEVER advances a
// lifecycle state, NEVER recommends, and NEVER writes anywhere — presentation is the watch
// function's job, authority is nobody's job but the owner's.
//
// Dedup is by BASIS (kind + model + field) against the LAST value that basis alerted: an
// announcement re-observed unchanged — the provider's page still saying the same thing tomorrow —
// is suppressed. A value that LEFT and CAME BACK fires again (A→B→A→B alerts twice), because the
// basis's last alerted value changed in between. The stored row-level signature is the basis PLUS
// the value PLUS the fact's date — the same-day-double-beat idempotency backstop at the table.

import { DISCOVERY_LIFECYCLE, type ModelCandidate, type DiscoveryLifecycle } from "./registry.ts";

// ── Observation shape (what a metadata source yields; flat and provider-neutral) ─────────────

export interface CatalogObservation {
  model: string;
  observed_at: string; // ISO date THE SOURCE said it
  source_url: string;
  availability?: "ga" | "preview" | "deprecated" | "retired" | "unknown";
  input_per_1k?: number;
  output_per_1k?: number;
  context_tokens?: number;
  tools?: boolean;
  structured_output?: boolean;
  streaming?: boolean;
}

export const DISCOVERY_EVENT_KINDS = [
  "family_new",
  "family_retired",
  "price_changed",
  "capability_changed",
  "context_changed",
  "stale_source",
  "contradictory_data",
] as const;
export type DiscoveryEventKind = (typeof DISCOVERY_EVENT_KINDS)[number];

export interface DiscoveryEvent {
  kind: DiscoveryEventKind;
  model: string;
  field?: string;
  /** old → new values as strings; evidence, not interpretation. */
  before?: string;
  after?: string;
  source_url: string;
  observed_at: string;
  /** direction for price events: +25% means the challenger got MORE expensive. */
  delta_pct?: number;
}

/** Days after which an observation is stale (the watch re-checks; silence this old is a defect). */
export const STALE_AFTER_DAYS = 30;

const pct = (before: number, after: number) => Math.round(((after - before) / before) * 1000) / 10;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Diff two snapshots of observations. `prev` may be empty (first run: every model with a family
 * not among `incumbentFamilies` is family_new). Only listed, comparable fields emit events — an
 * observation that adds a previously-unknown value (undefined → value) is a capability/context
 * CHANGE (we learned something), while value → undefined is NOT an event (a source going quiet is
 * staleness, not a fact reversal).
 */
export function diffObservations(
  prev: Readonly<Record<string, CatalogObservation>>,
  next: Readonly<Record<string, CatalogObservation>>,
  incumbentFamilies: ReadonlySet<string>,
): DiscoveryEvent[] {
  const events: DiscoveryEvent[] = [];
  for (const [model, obs] of Object.entries(next)) {
    const family = model.split("-").slice(0, 2).join("-");
    const prior = prev[model];
    if (!prior && !incumbentFamilies.has(family)) {
      events.push({ kind: "family_new", model, source_url: obs.source_url, observed_at: obs.observed_at });
    }
    if (obs.availability && obs.availability !== prior?.availability && (obs.availability === "deprecated" || obs.availability === "retired")) {
      events.push({ kind: "family_retired", model, field: "availability", before: prior?.availability ?? "unknown", after: obs.availability, source_url: obs.source_url, observed_at: obs.observed_at });
    }
    if (typeof obs.input_per_1k === "number" && obs.input_per_1k !== prior?.input_per_1k) {
      events.push({ kind: "price_changed", model, field: "input_per_1k", before: prior?.input_per_1k !== undefined ? String(prior.input_per_1k) : "unknown", after: String(obs.input_per_1k), delta_pct: prior?.input_per_1k !== undefined ? pct(prior.input_per_1k, obs.input_per_1k) : undefined, source_url: obs.source_url, observed_at: obs.observed_at });
    }
    if (typeof obs.output_per_1k === "number" && obs.output_per_1k !== prior?.output_per_1k) {
      events.push({ kind: "price_changed", model, field: "output_per_1k", before: prior?.output_per_1k !== undefined ? String(prior.output_per_1k) : "unknown", after: String(obs.output_per_1k), delta_pct: prior?.output_per_1k !== undefined ? pct(prior.output_per_1k, obs.output_per_1k) : undefined, source_url: obs.source_url, observed_at: obs.observed_at });
    }
    if (typeof obs.context_tokens === "number" && obs.context_tokens !== prior?.context_tokens) {
      events.push({ kind: "context_changed", model, field: "context_tokens", before: prior?.context_tokens !== undefined ? String(prior.context_tokens) : "unknown", after: String(obs.context_tokens), source_url: obs.source_url, observed_at: obs.observed_at });
    }
    for (const cap of ["tools", "structured_output", "streaming"] as const) {
      const after = obs[cap];
      if (after !== undefined && after !== prior?.[cap]) {
        events.push({ kind: "capability_changed", model, field: cap, before: prior?.[cap] !== undefined ? String(prior[cap]) : "unknown", after: String(after), source_url: obs.source_url, observed_at: obs.observed_at });
      }
    }
  }
  return events;
}

/**
 * Contradiction detection: two live observations of the SAME model on the SAME date disagreeing
 * on a priced/capability field. Provider pages and APIs disagreeing is a data-quality fact the
 * operator must see before any benchmark is proposed from either number.
 */
export function detectContradictions(observations: readonly CatalogObservation[]): DiscoveryEvent[] {
  const events: DiscoveryEvent[] = [];
  const byModel = new Map<string, CatalogObservation[]>();
  for (const o of observations) {
    const list = byModel.get(o.model) ?? [];
    list.push(o);
    byModel.set(o.model, list);
  }
  for (const [model, list] of byModel) {
    if (list.length < 2) continue;
    const fields = ["input_per_1k", "output_per_1k", "tools", "structured_output", "streaming"] as const;
    for (const f of fields) {
      const values = [...new Set(list.map((o) => o[f]).filter((v) => v !== undefined))];
      if (values.length > 1) {
        events.push({ kind: "contradictory_data", model, field: f, before: String(values[0]), after: String(values[1]), source_url: list.map((o) => o.source_url).join(" vs "), observed_at: list[0].observed_at });
      }
    }
  }
  return events;
}

/** Staleness: an observation older than STALE_AFTER_DAYS (measured against `now`, injected).
 *  The event's `after` is the LAST-SEEN date — the fact is "last seen on DATE" — so a model that
 *  relists and delists again produces a NEW dated fact instead of being suppressed forever. */
export function detectStaleSources(
  observations: readonly CatalogObservation[],
  now: string,
): DiscoveryEvent[] {
  return observations
    .filter((o) => daysBetween(o.observed_at, now) > STALE_AFTER_DAYS)
    .map((o) => ({ kind: "stale_source" as const, model: o.model, after: o.observed_at, source_url: o.source_url, observed_at: now }));
}

/** The dedup signature: same fact, same date, same value → the SAME event, never re-alerted. */
export function eventSignature(e: DiscoveryEvent): string {
  return [e.kind, e.model, e.field ?? "", e.after ?? ""].join("|");
}

/** Suppress events whose basis already alerted the SAME value (unchanged re-announcements stay
 *  quiet); a returning value passes because the basis's last value changed in between. */
export function dedupeEvents(events: readonly DiscoveryEvent[], lastValueByBasis: ReadonlyMap<string, string>): DiscoveryEvent[] {
  const seen = new Map(lastValueByBasis);
  return events.filter((e) => {
    const basis = [e.kind, e.model, e.field ?? ""].join("|");
    if (seen.get(basis) === (e.after ?? "")) return false;
    seen.set(basis, e.after ?? "");
    return true;
  });
}

// ── Lifecycle honesty (pure helpers the harness pins) ────────────────────────────────────────

/** Ordered index of the lifecycle; `rejected` is terminal and unordered. */
export function lifecycleRank(state: DiscoveryLifecycle): number {
  if (state === "rejected") return Number.MAX_SAFE_INTEGER;
  const i = (DISCOVERY_LIFECYCLE as readonly string[]).indexOf(state);
  if (i < 0) throw new Error(`model-discovery: unknown lifecycle state ${state}`);
  return i;
}

/** The ONLY way a candidate advances: an explicit, ordered, no-skip, no-auto transition. */
export function advanceLifecycle(candidate: ModelCandidate, to: DiscoveryLifecycle): ModelCandidate {
  if (candidate.lifecycle === "rejected") throw new Error(`model-discovery: ${candidate.id} is rejected (terminal)`);
  if (to === "rejected") return { ...candidate, lifecycle: to };
  const from = lifecycleRank(candidate.lifecycle);
  const target = lifecycleRank(to);
  if (target !== from + 1) {
    throw new Error(`model-discovery: ${candidate.id} cannot skip ${candidate.lifecycle} → ${to} (one state at a time, owner-gated)`);
  }
  return { ...candidate, lifecycle: to };
}
