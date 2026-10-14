import type { ReadLinkDestination } from "../../supabase/functions/_shared/paige-turn/record-links";
import type { BusinessReviewSnapshot, ReviewMetric } from "./data/useBusinessReview";

/** Presentation metadata only. The Fabric owns figures, risks, coverage and provenance. */
const AREAS: Record<string, { label: string; destination?: ReadLinkDestination; recommendation: string }> = {
  payments: { label: "Finance & collections", destination: "finance", recommendation: "Review the collections records and decide the next step." },
  sales_pipeline: { label: "Sales pipeline", destination: "sales_pipeline", recommendation: "Review the opportunities behind this risk with PAIGE." },
  operations: { label: "Operations & Systems Check", destination: "systems_check", recommendation: "Open the findings and review the required setup or repair." },
  clients: { label: "Clients", destination: "contacts", recommendation: "Review the client records and choose where to focus." },
  revenue: { label: "Revenue", recommendation: "Review the available financial sources." },
  communications: { label: "Conversations", recommendation: "Review communications readiness." },
  email: { label: "Email", recommendation: "Review email readiness." },
  campaigns: { label: "Marketing campaigns", recommendation: "Review campaign evidence." },
  bookings: { label: "Bookings", recommendation: "Review the recorded bookings." },
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
  const rank = { act: 0, watch: 1, info: 2 };
  return executiveAreas(snapshot).flatMap((area) => area.entry.status === "available" && area.entry.data
    ? area.entry.data.risks.filter((risk) => risk.severity !== "info").map((risk) => ({ ...risk, area })) : [])
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function formatReviewMetric(metric: ReviewMetric): string {
  if (metric.value === null || !Number.isFinite(metric.value)) return "Unavailable";
  if (metric.unit === "currency_minor") {
    if (!metric.currency) return "Unavailable";
    return `${metric.currency} ${(metric.value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const value = metric.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return metric.unit === "percent" ? `${value}%` : metric.unit === "days" ? `${value} days` : value;
}

export function formatReviewInstant(instant: string, timezone: string, withTime = false): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric",
      ...(withTime ? { hour: "numeric", minute: "2-digit" } as const : {}) }).format(new Date(instant));
  } catch { return "Date unavailable"; }
}

export function reviewGapNote(reason?: string): string {
  if (reason === "no_adapter") return "This source is not connected to the business review yet.";
  if (reason === "not_connected") return "Not connected. No figures are available from this source.";
  if (reason === "scope_changed") return "The workspace changed during the read. Refresh to read the active workspace.";
  if (reason === "forbidden" || reason === "authorization_denied") return "This read was not authorized for the current workspace.";
  return reason ? `The source could not be read: ${reason.replace(/_/g, " ")}.` : "No readable evidence was returned for this area.";
}
