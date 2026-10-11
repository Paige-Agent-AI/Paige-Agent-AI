// Replaces only Marketing › Analytics' server-figures read (`issue_analytics_evidence_bundle`, INT-298 MBC 2b).
// Each answer is shaped as the shared issuer returns it, so the page's real validator (parseMetricResult)
// checks it exactly as in production. A fictional business's figures (§63).
//   populated  — an owner whose leads all fit the page's read: the server's counts equal the page's own
//   full       — an owner whose 200-row read is full: the server counts 140 more leads in the range
//   first      — an owner with no leads yet
//   loading    — never answers
//   error      — the read fails (the page keeps its own counts)
//   readonly   — a member: the server refuses (42501), the page keeps its own counts
import { mode } from "./mode";
import { FULL_READ, FULL_UNREAD_IN_RANGE, populated } from "./stubs";

type Answer = { data: unknown; error: { code?: string; message: string } | null };
type Values = { kind: "count"; count: number } | { kind: "distribution"; items: { key: string; label: string; count: number }[] };

const ref = (prefix: string, n: number) => `${prefix}_${String(n).padStart(64, "0")}`;

function bundle(args: Record<string, unknown>, values: Values) {
  const asOf = new Date().toISOString();
  return {
    metric_key: args.p_metric_key, metric_version: "1.0.0", owner_department: "marketing", label: "Leads", definition: "Form submissions in the range.", formula: "COUNT(*)",
    range: { key: args.p_range_key, start: args.p_range_start, end: args.p_range_end, bounds: "[start,end)", timezone: "UTC", semantics: "event_timestamp_cohort" },
    dimensions: {}, values, unit: "count", source_refs: ["public.growth_form_submissions"], as_of: asOf,
    freshness: { queried_at: asOf, source_updated_through: null },
    coverage: { state: "complete", candidate_count: 0, contributing_count: 0, excluded_count: 0 }, exclusions: [], truth_state: "LIVE", caveats: [],
    source_revision_ref: ref("sr_v1", 1), account_epoch: args.p_account_epoch, account_epoch_ref: ref("ae_v1", 2), evidence_ref: ref("aneb_v1", 3),
    reference_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

// The harness's own sample leads, counted over the requested range as the server producer counts them, so the
// headline figures agree with the rings and the trend whenever the page's read is complete.
const BRIEF_REFS: Record<string, { id: string; name: string }> = { "cb-spring": { id: "b1", name: "Spring advisory intake" }, "cb-podcast": { id: "b3", name: "Podcast guest series" } };
type Lead = { createdAt: string; trackingSource: string | null; trackingCampaign: string | null; dealId: string | null };

function leadsIn(args: Record<string, unknown>): Lead[] {
  const start = Date.parse(String(args.p_range_start)), end = Date.parse(String(args.p_range_end));
  const rows: Lead[] = mode === "first" ? [] : mode === "full" ? FULL_READ : populated.submissions;
  const read = rows.filter((row) => { const t = Date.parse(row.createdAt); return t >= start && t < end; });
  // `?mode=full`: leads in the range the page's 200-row read never reached (all untagged, none an opportunity).
  const unread = mode === "full" && end > Date.now() - 3_600_000 ? Array.from({ length: FULL_UNREAD_IN_RANGE }, () => ({ createdAt: new Date(start).toISOString(), trackingSource: null, trackingCampaign: null, dealId: null })) : [];
  return [...read, ...unread];
}

function grouped(entries: [string, string][], untaggedLabel: string) {
  const counts = new Map<string, { key: string; label: string; count: number }>();
  for (const [key, label] of entries) counts.set(key, { key, label, count: (counts.get(key)?.count ?? 0) + 1 });
  const rows = [...counts.values()];
  return [...rows.filter((row) => row.key !== "_untagged").sort((x, y) => y.count - x.count || (x.key < y.key ? -1 : 1)), ...rows.filter((row) => row.key === "_untagged").map((row) => ({ ...row, label: untaggedLabel }))];
}

function figures(args: Record<string, unknown>): Values {
  const leads = leadsIn(args);
  const tag = (value: string | null) => (value ?? "").trim().toLowerCase();
  switch (args.p_metric_key) {
    case "marketing.leads.received": return { kind: "count", count: leads.length };
    case "marketing.leads.converted_to_opportunity": return { kind: "count", count: leads.filter((lead) => lead.dealId).length };
    case "marketing.leads.by_utm_source": return { kind: "distribution", items: grouped(leads.map((lead) => (tag(lead.trackingSource) ? [`src:${tag(lead.trackingSource)}`, tag(lead.trackingSource)] : ["_untagged", ""])), "No source tag") };
    case "marketing.leads.by_campaign_tag": return { kind: "distribution", items: grouped(leads.map((lead) => {
      const value = tag(lead.trackingCampaign);
      if (!value) return ["_untagged", ""];
      const brief = BRIEF_REFS[value];
      return brief ? [`brief:${brief.id}`, brief.name] : [`tag:${value}`, value];
    }), "No campaign tag") };
    default: return { kind: "count", count: 0 };
  }
}

function rpc(name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  if (name !== "issue_analytics_evidence_bundle") return Promise.resolve({ data: null, error: null });
  // The drive reads this to tell the server path from the page's own counts when the two agree.
  const counter = globalThis as { __marketingMetricReads?: number };
  counter.__marketingMetricReads = (counter.__marketingMetricReads ?? 0) + 1;
  if (mode === "loading") return new Promise(() => {});
  if (mode === "error") return Promise.resolve({ data: null, error: { message: "harness_read_failed" } });
  if (mode === "readonly") return Promise.resolve({ data: null, error: { code: "42501", message: "ANALYTICS_EVIDENCE_UNAVAILABLE" } });
  return Promise.resolve({ data: bundle(args, figures(args)), error: null });
}

export const supabase = { rpc };
