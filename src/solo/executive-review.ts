import type { ReadLinkDestination } from "../../supabase/functions/_shared/paige-turn/record-links";
import { formatSnapshotMetricValue, rankOperatingSnapshotRisks } from "../../supabase/functions/_shared/paige-context/snapshot";
import type { BusinessReviewSnapshot, ReviewMetric } from "./data/useBusinessReview";

/** Presentation metadata only. The Fabric owns figures, risks, coverage and provenance. */
const AREAS: Record<string, { label: string; destination?: ReadLinkDestination; recommendation: string }> = {
  finance: { label: "Financial source evidence", destination: "finance", recommendation: "Inspect the source facts and missing information in Finance." },
  payments: { label: "Finance & collections", destination: "finance", recommendation: "Review the collections records and decide the next step." },
  sales_pipeline: { label: "Sales pipeline", destination: "sales_pipeline", recommendation: "Review the opportunities behind this risk with PAIGE." },
  operations: { label: "Operations & Systems Check", destination: "systems_check", recommendation: "Open the findings and review the required setup or repair." },
  clients: { label: "Clients", destination: "contacts", recommendation: "Review the client records and choose where to focus." },
  revenue: { label: "Revenue", recommendation: "Review the available financial sources." },
  communications: { label: "Conversations", recommendation: "Review communications readiness." },
  email: { label: "Email", destination: "marketing", recommendation: "Inspect the original campaign sends and tracking limits in Marketing." },
  campaigns: { label: "Marketing intake", destination: "marketing", recommendation: "Review routing and processing in the existing Marketing records. No correction has run." },
  bookings: { label: "Bookings", destination: "calendar", recommendation: "Review the recorded bookings." },
  work: { label: "Delivery work", destination: "operations_work", recommendation: "Review the delivery records." },
  game_plan: { label: "Game Plan performance", destination: "business_game_plan", recommendation: "Review the recorded direction and strategic plays." },
  outcomes: { label: "Execution outcomes", recommendation: "Review the recorded outcomes." },
};

export function executiveAreas(snapshot: BusinessReviewSnapshot) {
  return snapshot.requested.map((key) => ({
    key,
    ...(AREAS[key] ?? { label: key.replace(/_/g, " "), recommendation: "Review the source with PAIGE." }),
    entry: snapshot.domains[key] ?? { status: "unavailable" as const, data: null, reason: "missing_result" },
  }));
}

export function executivePriorities(snapshot: BusinessReviewSnapshot) {
  const areas = executiveAreas(snapshot);
  return rankOperatingSnapshotRisks(snapshot).map(({ domain, ...risk }) => ({
    ...risk, area: areas.find(area => area.key === domain)!,
  }));
}

export function formatReviewMetric(metric: ReviewMetric): string {
  if (metric.value === null || !Number.isFinite(metric.value)) return "Unavailable";
  if (metric.unit === "currency_minor" && !metric.currency) return "Unavailable";
  // Same representation as the canonical snapshot/Chat projection, including non-two-decimal
  // and unknown currencies. A visual must never reinterpret the owning source's minor units.
  return formatSnapshotMetricValue(metric);
}

export function formatReviewInstant(instant: string, timezone: string, withTime = false): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric",
      ...(withTime ? { hour: "numeric", minute: "2-digit" } as const : {}) }).format(new Date(instant));
  } catch { return "Date unavailable"; }
}

export function reviewGapNote(reason?: string): string {
  if (reason?.replace(/^adapter:/, '').startsWith('finance_')) return 'Financial evidence could not be verified for this review. Inspect its sources in Finance, then refresh.';
  if (reason === "no_adapter" || reason?.startsWith("no_adapter:")) return "This area is not included in this business review yet.";
  if (reason === "not_connected") return "Not connected. No figures are available from this source.";
  if (reason === "scope_changed") return "The workspace changed during the read. Refresh to read the active workspace.";
  if (reason === "forbidden" || reason === "authorization_denied") return "This read was not authorized for the current workspace.";
  return reason ? `The source could not be read: ${reason.replace(/_/g, " ")}.` : "No readable evidence was returned for this area.";
}
