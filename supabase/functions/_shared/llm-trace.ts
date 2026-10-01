// §34 Layer 1 — Observability writer for paige_llm_trace.
//
// One row per LLM call. This module owns the three safety properties the adversarial pre-flight
// demanded (the existing paige_audit_log writer copies the *words* "best-effort, never blocks" but
// NOT the safety — it logs no raw content and is awaited; a full-I/O trace must do better):
//
//   S0 SCRUB — every text that could carry a credential (input, output, error message) is run through
//      scrubSecrets() BEFORE it leaves this process. input/output MAY still hold tenant/client PII (that
//      is the point of a trace) but NEVER a secret. We serialize only what we are handed — never Deno.env,
//      never a raw opts/headers object (metadata is an explicit scalar allowlist).
//   S1 DETACH — the write is fired through EdgeRuntime.waitUntil (NOT awaited on the response path), so
//      uploading a multi-KB row never adds latency to the actual generation. Own try/catch, bounded by an
//      AbortController timeout, never rethrows. Best-effort: MAY drop under isolate teardown (stated
//      honestly, §13) — we do not claim certainty.
//   S3 CAP — input/output are truncated to 32KB with truncation flags + original length; binaries are
//      referenced by deliverable_id, never inlined.
//
// Pure Supabase (§34): a service-role insert into one Postgres table. No vendor observability SDK.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
// Token pricing lives in its own dependency-free module so Node can execute the same source the
// edge runtime type-checks — see the header there for why it is not in `model-router` (§18).
import { estimateTokenCostUsd } from "./token-pricing.ts";

// Own the service-role client here (lazy) so EVERY LLM chokepoint can trace with a single
// traceLLMCall(row) — no caller needs to thread an admin client. Null when there's no service
// context (offline/local) → the writer is an honest no-op, never a fake row.
let _admin: SupabaseClient | null = null;
let _adminTried = false;
export function traceAdmin(): SupabaseClient | null {
  if (_adminTried) return _admin;
  _adminTried = true;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (url && key) _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

/** The minimal correlation context an LLM-call site threads in. All optional — a site with no tenant
 *  in scope still writes an honest row (tenant_id null), never a fabricated one. */
export interface TraceCtx {
  tenant_id?: string | null;
  task_id?: string | null;
  agent_id?: string | null;
  parent_trace_id?: string | null;
  job_kind?: string | null;
  /** The caller's OWN active workspace tenant id (owner #489) — server-derived for operator display
   *  itemization, DISTINCT from tenant_id (the persona-context attribution). Soft ref, coerced to null
   *  if non-uuid. Optional: a site that doesn't set it writes null (default), never a fabricated id. */
  working_context_tenant_id?: string | null;
}

/** Provenance stamp — bump when the estimator/scrubber/schema changes so a reader knows what produced a row. */
export const ROUTER_VERSION = "trace-2";
/** The cost figures in paige_llm_trace are ESTIMATES on this basis — surfaced so no dashboard reads them as a bill. */
export const COST_BASIS = "list price, in+out tokens, excl caching/thinking/tool round-trips, 2026-07";


const EXCERPT_CAP = 32 * 1024; // 32KB per I/O field (S3). Logged here so the cap is never silent (§24).

// Credential shapes to redact. Allowlist-of-patterns on the WRITE path (S0). Not exhaustive by design —
// the goal is to catch the well-known provider/cloud key formats that must never land at rest, not to be a
// perfect DLP. Extend as new shapes appear.
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,               // Anthropic
  /sk-[A-Za-z0-9]{20,}/g,                       // OpenAI / generic sk-
  /\bAKIA[0-9A-Z]{16}\b/g,                      // AWS access key id
  /\bASIA[0-9A-Z]{16}\b/g,                      // AWS temp key id
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,            // Slack tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,              // GitHub tokens
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,           // Authorization: Bearer …
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /([?&](?:token|sig|signature|key|apikey|api_key|access_token)=)[^&\s"']{8,}/gi, // signed-URL query params
  /\b[A-Fa-f0-9]{64,}\b/g,                      // long hex blobs (keys/hashes pasted inline)
];

// A trace's tenant_id is a SOFT correlation id (the DB FK to tenants was dropped — an observability row
// must never be LOST because its tenant isn't a real tenants row: a God/platform/operator context, a
// sub-account/agency id not stored in tenants, or a since-deleted tenant). Coerce anything that isn't a
// well-formed uuid to null so a malformed/empty id (e.g. "" ?? null keeps "") can't throw a 22P02 cast
// error into the (swallowed) insert. NULL = platform/system row — invisible to every tenant per RLS (§9).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanTenantId(t: string | null | undefined): string | null {
  if (typeof t !== "string") return null;
  const s = t.trim();
  if (!s) return null;
  if (UUID_RE.test(s)) return s;
  // Loud, never silent (§32): a non-empty non-uuid tenant_id is a caller bug worth seeing, but the trace
  // still persists (as a platform/null row) rather than being dropped by the swallowing catch.
  console.warn("paige_llm_trace: non-uuid tenant_id coerced to null:", s.slice(0, 40));
  return null;
}

/** Redact known credential shapes. input/output keep their PII (that's the trace's job) but shed secrets. */
export function scrubSecrets(input: string): string {
  let s = input;
  for (const re of SECRET_PATTERNS) s = s.replace(re, "[REDACTED]");
  // keep the signed-URL param NAME, drop only the value
  s = s.replace(/([?&](?:token|sig|signature|key|apikey|api_key|access_token)=)\[REDACTED\]/gi, "$1[REDACTED]");
  return s;
}

/** Coerce any input/output payload to a bounded, scrubbed string. Returns the excerpt + truncation flags. */
export function toExcerpt(value: unknown): { text: string | null; truncated: boolean; len: number | null } {
  if (value === undefined || value === null) return { text: null, truncated: false, len: null };
  let raw: string;
  if (typeof value === "string") raw = value;
  else {
    try { raw = JSON.stringify(value); } catch { raw = String(value); }
  }
  const origLen = raw.length; // honest ORIGINAL length, reported even when we truncate before scrubbing
  if (origLen <= EXCERPT_CAP) {
    const scrubbed = scrubSecrets(raw);
    return { text: scrubbed, truncated: false, len: origLen };
  }
  // Truncate BEFORE scrubbing so a multi-MB payload (e.g. a base64 PDF passed as input) doesn't run 9
  // regexes over megabytes on the response path. Scrub a small margin past the cap so a credential
  // straddling the 32KB boundary is still caught, then trim the display to the cap.
  const scrubbed = scrubSecrets(raw.slice(0, EXCERPT_CAP + 512));
  return { text: scrubbed.slice(0, EXCERPT_CAP) + "…[truncated]", truncated: true, len: origLen };
}

/** Only these scalar keys survive into metadata — never a raw opts/headers object (S0/S6). */
const METADATA_ALLOWLIST = ["caller_function", "actor_role", "retry_of", "attempt", "capped", "low_confidence"] as const;
function safeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!meta) return out;
  for (const k of METADATA_ALLOWLIST) {
    const v = meta[k];
    if (v === undefined || v === null) continue;
    // scalars only — an object/array could smuggle a secret past the allowlist
    if (typeof v === "string") out[k] = scrubSecrets(v).slice(0, 512);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

export interface TraceRow {
  tenant_id?: string | null;
  /** Owner #489 — the caller's OWN active workspace tenant id, server-derived (never body-supplied),
   *  captured for operator display itemization. Soft ref (no FK); cleanTenantId coerces non-uuid→null. */
  working_context_tenant_id?: string | null;
  task_id?: string | null;
  agent_id?: string | null;
  parent_trace_id?: string | null;
  provider: string;
  model?: string | null;
  job_kind?: string | null;
  modality?: string | null;
  tier?: string | null;
  status: "success" | "error" | "needs_config";
  tokens_in?: number | null;
  tokens_out?: number | null;
  /** Anthropic prompt-cache counts. DELIBERATELY separate from tokens_in: input_tokens is the uncached
   *  remainder, and meter_llm_usage bills quantity = tokens_in + tokens_out, so folding these in would
   *  change every tenant's metered quantity. null = provider did not report; 0 = reported zero. */
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  latency_ms?: number | null;
  cost_estimate_usd?: number | null;
  /** Raw input payload — scrubbed + truncated here, never stored raw. */
  input?: unknown;
  /** Raw output payload — scrubbed + truncated here, never stored raw. */
  output?: unknown;
  error_class?: string | null;
  error_message?: string | null;
  deliverable_id?: string | null;
  doctrine_gate_hits?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Record one LLM-call trace. DETACHED and best-effort (S1): returns immediately; the insert runs via
 * EdgeRuntime.waitUntil so it never adds latency to the caller's response and never throws into the
 * generation path. `admin` is the service-role client (getAdmin()); a null client is a silent no-op.
 */
export function traceLLMCall(row: TraceRow): void {
  const admin = traceAdmin();
  if (!admin) return; // no service context → no-op (honest: no trace rather than a fake one)

  const inp = toExcerpt(row.input);
  const outp = toExcerpt(row.output);
  // A caller that priced its own call wins; otherwise price it here so no path can record tokens
  // without recording what they cost. Only a SUCCEEDED text call is priced: an error carries no
  // usage, and a per-artifact modality (image/3D/voice) is priced per artifact by the router, which
  // is the layer that knows the modality. `undefined` from the estimator stays null — no basis is
  // recorded as no basis, never as zero.
  const costEstimate = row.cost_estimate_usd ??
    (row.status === "success"
      ? (estimateTokenCostUsd(row.provider, row.model, row.tokens_in, row.tokens_out) ?? null)
      : null);
  const record = {
    tenant_id: cleanTenantId(row.tenant_id),
    // Owner #489 — additive, DISTINCT from tenant_id. Same soft-ref coercion so a malformed/non-uuid
    // working-context id degrades to a null (platform/system) value rather than throwing into the insert.
    working_context_tenant_id: cleanTenantId(row.working_context_tenant_id),
    task_id: row.task_id ?? null,
    agent_id: row.agent_id ?? null,
    parent_trace_id: row.parent_trace_id ?? null,
    provider: row.provider,
    model: row.model ?? null,
    job_kind: row.job_kind ?? null,
    modality: row.modality ?? null,
    tier: row.tier ?? null,
    status: row.status,
    // NULL, never 0, when the provider didn't report — null cost/tokens ≠ zero (S4).
    tokens_in: row.tokens_in ?? null,
    tokens_out: row.tokens_out ?? null,
    cache_read_input_tokens: row.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: row.cache_creation_input_tokens ?? null,
    latency_ms: row.latency_ms ?? null,
    cost_estimate_usd: costEstimate,
    cost_basis: costEstimate == null ? null : COST_BASIS,
    input_excerpt: inp.text,
    output_excerpt: outp.text,
    input_truncated: inp.truncated,
    output_truncated: outp.truncated,
    input_len: inp.len,
    output_len: outp.len,
    error_class: row.error_class ?? null,
    error_message: row.error_message ? scrubSecrets(String(row.error_message)).slice(0, EXCERPT_CAP) : null,
    deliverable_id: row.deliverable_id ?? null,
    doctrine_gate_hits: row.doctrine_gate_hits ?? null,
    router_version: ROUTER_VERSION,
    metadata: safeMetadata(row.metadata),
  };

  const write = async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000); // bounded so a locked insert can't keep the isolate alive
    try {
      // supabase-js RESOLVES a PostgREST rejection into { error } rather than throwing, so the catch
      // below only ever saw network/abort faults — a row the database refused was previously silent.
      const { error } = await admin.from("paige_llm_trace").insert(record).abortSignal(ctrl.signal);
      if (error) {
        // PGRST204 = no such column. That is what happens if this writer deploys ahead of the migration
        // adding the cache columns, and because the record inserts whole it would cost EVERY trace row
        // on EVERY path — not just the cache fields. deploy-migrations.yml and deploy-edge-functions.yml
        // are independent path-triggered jobs with no ordering guarantee, so that race is real. Shed the
        // two optional columns and retry once: observability degrades instead of disappearing.
        // Trigger ONLY when the column the database NAMES is one of ours. Keying on the code alone
        // misattributes any other missing column to the cache fields — it logs a false cause and
        // spends the retry still carrying the offending field. Measured: a PGRST204 naming
        // working_context_tenant_id produced two attempts and a log line blaming the cache columns.
        const msg = error.message ?? "";
        const missingCacheColumn = /cache_(read|creation)_input_tokens/.test(msg) &&
          ((error as { code?: string }).code === "PGRST204" || /column .* does not exist/i.test(msg));
        if (missingCacheColumn) {
          const withoutCache = { ...record } as Record<string, unknown>;
          delete withoutCache.cache_read_input_tokens;
          delete withoutCache.cache_creation_input_tokens;
          // NOTE: the retry shares the original 5s abort budget rather than extending it — a slow
          // first attempt leaves it little, and an already-fired signal sends it to the outer catch.
          // That is the intended bound: a trace write must not lengthen to chase its own retry.
          console.error("paige_llm_trace: cache columns absent, retrying without them:", msg);
          const retry = await admin.from("paige_llm_trace").insert(withoutCache).abortSignal(ctrl.signal);
          if (retry.error) console.error("paige_llm_trace: write failed after retry:", retry.error.message);
        } else {
          console.error("paige_llm_trace: write rejected:", error.message);
        }
      }
    } catch (e) {
      // Best-effort: a trace hiccup must NEVER surface to the caller. Log loudly, never rethrow (an
      // unhandled rejection in a detached promise can crash the isolate on some runtimes).
      console.error("paige_llm_trace: write failed:", (e as Error)?.message);
    } finally {
      clearTimeout(t);
    }
  };

  // Detach: return to the caller immediately, keep the insert alive after the handler resolves. Fall back
  // to a plain fire-and-forget where EdgeRuntime is absent (local/test) — with a swallowing catch so a
  // rejected detached promise never becomes an unhandled rejection.
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(write());
  else void write().catch(() => {});
}
