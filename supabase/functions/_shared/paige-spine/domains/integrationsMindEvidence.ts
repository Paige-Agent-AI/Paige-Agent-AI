// mind-projection-scr: SCR-INTEGRATIONS-MIND
import type { SpineEvidenceRpcClient, SpineRequestScope } from "../resolveEvidence.ts";

/**
 * The Integrations domain's MIND projection (Spine Change Request SCR-INTEGRATIONS-MIND,
 * owner green light 2026-10-02 after the Knowledge lane landed).
 *
 * SCOPE — read before reusing. This is NOT a generalisation of the Pipeline domain's Mind
 * primitive (mindEvidence.ts says a second domain needs a Spine Change Request, not an
 * import — this is that SCR, honoured by building a SEPARATE bounded projection rather than
 * widening the shared one). One domain, one bounded view: the tenant's integration
 * connection surface (the two read capabilities integrations.list / integrations.health).
 *
 * WHAT IT ADDS over the raw adapter rows: a closed-vocabulary fact filter, an explicit
 * freshness word, an opaque citation, and the read-only boundary — the things a person (or
 * the model) needs to trust, date, and act on a connection claim. One wording for Chat and
 * Mind so the two can never drift into different accounts of the same connector (§18).
 *
 * WHAT IT MAY NEVER CARRY: a server URL, a credential or its last4, a label the tenant
 * typed, an email address, an inbound domain, a tenant/user identifier, or any raw row
 * beyond the validated facts. Only the closed vocabularies below cross, and only values the
 * registry-declared adapter actually emits.
 */

export const INTEGRATIONS_MIND_CAPABILITIES = ["integrations.list", "integrations.health"] as const;

/** Closed vocabularies — exactly what public.list_integration_surface emits (20270410214500). */
const CHANNELS = new Set(["email", "sms", "calendar", "voice", "mcp"]);
const STATUSES = new Set(["active", "disabled", "pending"]);
const HEALTHS = new Set(["healthy", "degraded", "disconnected"]);
/** The adapter's own freshness boundary: a row older than this is stale, not current. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const CITATION = /^integrations:[a-z]+:[a-z0-9_-]+$/;

export type MindFreshness = "available" | "stale";

/** One attributable connection fact. Every field here is safe to show a person. */
export type IntegrationsMindRecord = {
  readonly occurredAt: string;
  readonly freshness: MindFreshness;
  readonly statement: string;
  readonly citation: string;
  readonly facts: Readonly<Record<string, string>>;
};

export type IntegrationsMindEvidence =
  | { readonly status: "recorded"; readonly records: readonly IntegrationsMindRecord[] }
  | { readonly status: "no_evidence" }
  | { readonly status: "unavailable" };

/** Validate and project ONE adapter row. A row outside the closed vocabularies is refused
 *  whole (fail-closed per record — drift becomes visible here and gets fixed in the
 *  registry, never silently widened), never partially sanitized into the Mind layer. */
export function projectIntegrationRow(row: unknown, now = Date.now()): IntegrationsMindRecord | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const channel = typeof r.channel === "string" ? r.channel : "";
  const provider = typeof r.provider === "string" ? r.provider : "";
  const status = typeof r.status === "string" ? r.status : "";
  const health = typeof r.health === "string" ? r.health : "";
  if (!CHANNELS.has(channel) || !STATUSES.has(status) || !HEALTHS.has(health) || !provider) return null;
  const occurredAt = typeof r.last_updated === "string" ? r.last_updated : "";
  if (!occurredAt) return null;
  const ageMs = now - Date.parse(occurredAt);
  const freshness: MindFreshness = Number.isFinite(ageMs) && ageMs <= STALE_AFTER_MS ? "available" : "stale";
  const citation = `integrations:${channel}:${provider}`;
  // Defence in depth: the citation is the identity a reader acts on — it must be the exact
  // shape this projection promised, assembled only from values that passed the vocabularies.
  if (!CITATION.test(citation)) return null;
  return {
    occurredAt,
    freshness,
    statement: `The ${channel} integration (${provider}) is ${status}; health ${health}.`,
    citation,
    facts: { channel, provider, status, health },
  };
}

export async function loadIntegrationsMindEvidence(
  client: SpineEvidenceRpcClient,
  scope?: SpineRequestScope,
): Promise<IntegrationsMindEvidence> {
  const isCurrent = () => { try { return scope ? scope.isCurrent() : true; } catch { return false; } };
  if (!isCurrent()) return { status: "unavailable" };
  try {
    const { data, error } = await client.rpc("list_integration_surface", {});
    if (!isCurrent()) return { status: "unavailable" };
    // Resolve to a three-state envelope FIRST (the canonical projector shape): a failed or
    // malformed read is a non-available result, never a guess at the rows.
    const envelope = error || !Array.isArray(data)
      ? { status: "unavailable" as const, signals: [] as (IntegrationsMindRecord | null)[] }
      : { status: "available" as const, signals: (data as unknown[]).map((row) => projectIntegrationRow(row)) };
    if (envelope.status !== "available") return { status: "unavailable" };
    // NO PARTIAL ANSWER: one un-projectable row fails the WHOLE projection. A filtered
    // subset could imply the missing connectors' states were verified when they were not.
    if (envelope.signals.some((signal) => signal === null)) return { status: "unavailable" };
    if (!envelope.signals.length) return { status: "no_evidence" };
    return { status: "recorded", records: envelope.signals as IntegrationsMindRecord[] };
  } catch {
    return isCurrent() ? { status: "unavailable" } : { status: "unavailable" };
  }
}

const HEADER = "=== INTEGRATIONS CONNECTION STATE — VERIFIED WORKSPACE SOURCE ===";
const FOOTER = "=== END INTEGRATIONS CONNECTION STATE ===";

export function renderIntegrationsMindEvidence(evidence: IntegrationsMindEvidence): string {
  if (evidence.status === "unavailable") {
    return [HEADER, "Status: UNAVAILABLE. The connection surface could not be read. Infer nothing from this failed read — not connection, not disconnection, not health.", FOOTER].join("\n");
  }
  if (evidence.status === "no_evidence") {
    return [HEADER, "Status: NO INTEGRATIONS ON RECORD. This workspace has no connectors registered — absence of records here is not proof that none exist or none can be connected.", FOOTER].join("\n");
  }
  const lines = evidence.records.map((record) => {
    const facts = Object.entries(record.facts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("; ");
    return `- ${record.occurredAt} | ${record.freshness} | ${record.statement} | ${facts} | source: ${record.citation}`;
  });
  return [
    HEADER,
    `Capabilities: ${INTEGRATIONS_MIND_CAPABILITIES.join(", ")}`,
    "Status: AVAILABLE",
    ...lines,
    "Use only these listed facts, and name the source reference on a line when you state what it proves. Do not infer credentials, endpoints, message contents, or any unlisted property. A provider absent here is not connected on record — say that, not that it cannot be.",
    "A line marked stale is past its freshness boundary: report it as old, never as current. Anything absent here is unknown, not disproven.",
    "Read-only: this projection never changes a connection.",
    FOOTER,
  ].join("\n");
}
