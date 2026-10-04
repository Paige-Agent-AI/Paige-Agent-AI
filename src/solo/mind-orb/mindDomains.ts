// mindDomains — the honest reconciliation from Mind's REAL read contracts onto the owner-approved
// six-domain orb (§28 design) and its source-signal states. Pure and deterministic so the honesty
// rules are unit-testable in isolation (§13/§70): a node/record only ever exists because a real
// source produced it; a domain with no live hook renders an honest ABSENCE, never invented data.
//
// Approved domains + geometry (az/el) and the source-signal palette are ported verbatim from the
// approved prototype (docs/prototypes/command-center-mind-gate1.*). §00: this ports the approved
// design, it does not invent one.

import type { MindOrbRecordNode, MindOrbDomain, MindTruthTier } from "./engine";

export type MindDomainKey = "identity" | "people" | "goals" | "systems" | "knowledge" | "offers";

// Canonical source-signal states (the approved legend). Colour is resolved from a --sig-* token at
// render time by the caller; this module never hard-codes a colour.
export type MindSignalState =
  | "owner_confirmed"
  | "connection_sourced"
  | "source_refreshed"
  | "needs_confirmation"
  | "legacy_sourced"
  | "unavailable";

export type MindTruth = "LIVE SOURCE" | "PARTIAL" | "UNAVAILABLE" | "PROPOSED";
export type MindVerdict = "LIVE" | "PARTIAL" | "UNAVAILABLE";

export const SIGNAL_TOKEN: Record<MindSignalState, string> = {
  owner_confirmed: "--sig-confirmed",
  connection_sourced: "--sig-connection",
  source_refreshed: "--sig-refreshed",
  needs_confirmation: "--sig-needs",
  legacy_sourced: "--sig-legacy",
  unavailable: "--sig-unavailable",
};

export const SIGNAL_LABEL: Record<MindSignalState, string> = {
  owner_confirmed: "Owner-confirmed",
  connection_sourced: "Connection-sourced",
  source_refreshed: "Source refreshed",
  needs_confirmation: "Needs confirmation",
  legacy_sourced: "Legacy record",
  unavailable: "Unavailable",
};

// Truth badge (drawer/list) derived from the canonical state — never set independently.
export function truthForState(state: MindSignalState): MindTruth {
  switch (state) {
    case "owner_confirmed":
    case "connection_sourced":
    case "source_refreshed":
      return "LIVE SOURCE";
    case "needs_confirmation":
      return "PARTIAL";
    case "legacy_sourced":
      return "PROPOSED";
    case "unavailable":
      return "UNAVAILABLE";
  }
}

export interface MindDomainDef {
  key: MindDomainKey;
  name: string;
  az: number;
  el: number;
}

// Hub directions ported verbatim from the approved prototype's DOMAINS.
export const MIND_DOMAINS: readonly MindDomainDef[] = [
  { key: "identity", name: "Business context", az: -0.55, el: 0.62 },
  { key: "people", name: "Client relationships", az: -2.4, el: 0.05 },
  { key: "goals", name: "Operating decisions", az: -1.5, el: -0.75 },
  { key: "systems", name: "Connected sources", az: 1.1, el: 0.35 },
  { key: "knowledge", name: "Knowledge resources", az: 2.2, el: -0.25 },
  { key: "offers", name: "Offers & services", az: 0.2, el: -0.95 },
];

export interface MindRecord {
  id: string;
  domain: MindDomainKey;
  state: MindSignalState;
  truth: MindTruth;
  title: string;
  summary: string;
  source: string;
  when: string;
  evidence: string;
  owner: string;
}

export interface MindDomainModel {
  def: MindDomainDef;
  verdict: MindVerdict;
  records: MindRecord[];
  // Honest absence copy for a domain with a source/seam but nothing on file (or no hook yet).
  empty?: { heading: string; body: string };
}

// ---- Normalised inputs (already tenant-scoped by the caller's hooks; this module adds no data) ----

export interface KnowledgeDocInput {
  id: string;
  title: string;
  summary?: string | null;
  source?: string | null;
  when?: string | null;
  createdAt?: string | null;
  chunkCount?: number | null;
  domain?: string | null;
}

export interface N8nChannelInput {
  words: string; // human copy already resolved by the caller (N8N_*_WORDS)
  action: string; // action words already resolved
  lastSuccessfulCheck?: string | null;
  actionNeeded?: boolean;
  detail: string; // caller-composed evidence sentence
}

export interface N8nInput {
  api: N8nChannelInput;
  mcp: N8nChannelInput;
}

export interface ApprovalInput {
  id: string;
  title: string;
  dept: string;
  type?: string | null;
  aging: string;
}

export interface MindInputs {
  knowledge: KnowledgeDocInput[];
  n8n: N8nInput | null;
  approvals: ApprovalInput[];
}

function n8nState(channel: N8nChannelInput): MindSignalState {
  if (channel.actionNeeded) return "needs_confirmation";
  if (channel.lastSuccessfulCheck) return "source_refreshed";
  return "connection_sourced";
}

/**
 * Reconcile the real read contracts onto the six approved domains.
 * - knowledge  ← canonical Knowledge metadata — confirmation/coverage unverified
 * - systems    ← n8n readiness (Connected sources; status only) — LIVE
 * - goals      ← pending approvals (Operating decisions) — LIVE
 * - identity   ← business_context.readiness — NO frontend hook yet → honest absence
 * - people     ← governed memory — NO frontend hook yet → honest absence
 * - offers     ← catalog lives in Campaigns → honest UNAVAILABLE
 *
 * Systems Check findings are DELIBERATELY not surfaced here (§58 approved boundary — they live in the
 * Systems Check subtab). This function never invents a record: empty inputs yield empty domains.
 */
export function buildMindDomains(inputs: MindInputs): MindDomainModel[] {
  const byKey = new Map<MindDomainKey, MindDomainModel>();
  for (const def of MIND_DOMAINS) byKey.set(def.key, { def, verdict: "PARTIAL", records: [] });

  // Metadata proves a source record exists; it cannot confer Memory or complete-index truth.
  const knowledge = byKey.get("knowledge")!;
  knowledge.records = inputs.knowledge.map((doc) => ({
    id: `knowledge:${doc.id}`,
    domain: "knowledge" as const,
    state: "needs_confirmation" as const,
    truth: "PARTIAL" as const,
    title: doc.title,
    summary: doc.summary || "Saved document metadata.",
    source: doc.source || "PAIGE Knowledge",
    when: doc.when || doc.createdAt || "Recorded time unavailable",
    evidence: `${doc.chunkCount ?? 0} recorded chunk${doc.chunkCount === 1 ? "" : "s"}${doc.domain ? ` · ${doc.domain}` : ""}. Index completeness and owner-confirmed Memory are not established by this record.`,
    owner: "PAIGE Knowledge",
  }));
  knowledge.verdict = "PARTIAL";
  if (!knowledge.records.length) {
    knowledge.empty = {
      heading: "No knowledge documents loaded",
      body: "Saved Knowledge sources appear here with provenance. Indexing and owner-confirmed Memory require their own evidence.",
    };
  }

  // Connected sources — LIVE n8n readiness (current status only, not Rail history).
  const systems = byKey.get("systems")!;
  if (inputs.n8n) {
    const mk = (id: string, title: string, channel: N8nChannelInput): MindRecord => {
      const state = n8nState(channel);
      return {
        id,
        domain: "systems",
        state,
        truth: truthForState(state),
        title,
        summary: channel.words,
        source: "Integrations · current connection record",
        when: channel.lastSuccessfulCheck ? `Last successful check: ${channel.lastSuccessfulCheck}` : "No successful check proven",
        evidence: channel.detail,
        owner: "Solo Integrations",
      };
    };
    systems.records = [
      mk("systems:n8n-api", "n8n API connection", inputs.n8n.api),
      mk("systems:n8n-mcp", "n8n Paige tools (MCP)", inputs.n8n.mcp),
    ];
    systems.verdict = "LIVE";
  } else {
    systems.verdict = "PARTIAL";
    systems.empty = {
      heading: "Connection status not read yet",
      body: "PAIGE reads the current state of your connected tools here — not their history. Nothing is shown until a source reports.",
    };
  }

  // Operating decisions — LIVE pending approvals (the actionable queue itself stays in Systems Check).
  const goals = byKey.get("goals")!;
  goals.records = inputs.approvals.map((approval) => ({
    id: `decision:${approval.id}`,
    domain: "goals" as const,
    state: "needs_confirmation" as const,
    truth: "PARTIAL" as const,
    title: approval.title,
    summary: "A current decision awaiting you. The actionable queue lives in Systems Check.",
    source: "Waiting on you",
    when: approval.aging,
    evidence: `${approval.dept}${approval.type ? ` · ${approval.type}` : ""} · current pending item`,
    owner: "Systems Check decision queue",
  }));
  goals.verdict = goals.records.length ? "LIVE" : "PARTIAL";
  if (!goals.records.length) {
    goals.empty = {
      heading: "No decisions waiting",
      body: "Operating decisions PAIGE surfaces for you appear here. A governed store exists; nothing is on file yet.",
    };
  }

  // Business context — governed readiness exists server-side but has no frontend hook yet.
  byKey.get("identity")!.empty = {
    heading: "Business context not wired yet",
    body: "PAIGE can hold your confirmed business basics here. The governed store exists; nothing reads it into this view yet, so nothing is shown.",
  };

  // Client relationships — governed memory store exists; nothing writes to it from Mind/chat yet.
  byKey.get("people")!.empty = {
    heading: "Governed store exists · nothing on file yet",
    body: "Canonical people and relationships live in Clients. A governed memory seam can hold context on top, but nothing writes to it yet.",
  };

  // Offers & services — the catalog is real but lives in Offers, not as a governed fact.
  const offers = byKey.get("offers")!;
  offers.verdict = "UNAVAILABLE";
  offers.empty = {
    heading: "Not on file as knowledge yet",
    body: "PAIGE has no confirmed record of your offers. Your offers are real and live in Offers, but they aren't a governed fact yet.",
  };

  return MIND_DOMAINS.map((def) => byKey.get(def.key)!);
}

export function allRecords(domains: MindDomainModel[]): MindRecord[] {
  return domains.flatMap((d) => d.records);
}

// ---- Orb field mapping (owner-approved "Synapse" direction, 2026-09-20) ----
// The engine renders the FORM (structural dust) itself; this module supplies only the DATA layer:
// one bright node per governed MindRecord, in its domain region, coloured by its truth TIER. §00 ports
// the approved direction; §13/§70: a node exists only because a real record does — nothing invented.

/**
 * Collapse the drawer/list truth badge to the three orb tiers (the owner-approved 6→3 orb legend, via
 * the Synapse reference). The finer 6-state signal detail is NOT lost — it stays in the record drawer
 * and list (§58: the legend is coarsened on the orb only, not the provenance). PROPOSED (legacy) and
 * PARTIAL (needs confirmation / past freshness) both read as "held, not yet confirmed".
 */
export function truthToTier(truth: MindTruth): MindTruthTier {
  switch (truth) {
    case "LIVE SOURCE":
      return "grounded";
    case "UNAVAILABLE":
      return "unavailable";
    default:
      return "partial";
  }
}

/**
 * One bright node per governed record, tagged with its domain region and truth tier. The full record
 * rides back on `record` for onPick (the engine's `[k: string]: unknown` index signature preserves it
 * untouched). No hubs, no ghosts: an empty domain renders as a hollow-dim region in the form, never as
 * "pending" satellites that would read as items awaiting you (§13/§70) — the owner-approved change.
 */
export function buildOrbRecords(domains: MindDomainModel[]): MindOrbRecordNode[] {
  return allRecords(domains).map((record) => ({
    id: record.id,
    domain: record.domain,
    tier: truthToTier(record.truth),
    label: record.title,
    record,
  }));
}

/**
 * The headline stat counts GROUNDED (LIVE SOURCE) records ONLY, and is labelled as such. The total
 * bright-node count (every governed record, all tiers) is NEVER presented as "grounded" (owner ruling
 * 2026-09-20). This returns the grounded subset; the caller labels it.
 */
export function groundedCount(domains: MindDomainModel[]): number {
  return allRecords(domains).filter((r) => r.truth === "LIVE SOURCE").length;
}

/** The six domain regions the engine places nodes into (key + az/el hub direction, ported verbatim). */
export function orbDomains(): MindOrbDomain[] {
  return MIND_DOMAINS.map((d) => ({ key: d.key, az: d.az, el: d.el }));
}
