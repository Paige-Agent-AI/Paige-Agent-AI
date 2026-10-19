// Shared types + helpers for the support / feedback portal.
export type TicketCategory =
  | "billing" | "technical_issue" | "account_access" | "paige_question"
  | "credit_report" | "funding_question" | "broker_issue" | "general";

export type TicketStatus = "open" | "in_progress" | "waiting_on_client" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export type FeatureCategory =
  | "credit_intelligence" | "funding" | "paige_ai" | "business_tools"
  | "broker_workspace" | "mobile" | "integrations" | "reporting" | "other";

export type FeatureStatus =
  | "submitted" | "under_review" | "planned" | "in_progress" | "shipped" | "declined";

// Categories a person can choose. Finance/credit categories are not platform defaults (CLAUDE.md §2);
// historical rows keep their stored values and still resolve a readable label below.
export const TICKET_CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: "billing", label: "Billing Question" },
  { value: "technical_issue", label: "Technical Issue" },
  { value: "account_access", label: "Account Access" },
  { value: "paige_question", label: "AI Assistant Question" },
  { value: "general", label: "General Question" },
];
const LEGACY_TICKET_LABELS: Record<string, string> = {
  credit_report: "Credit Report Issue",
  funding_question: "Funding Question",
  broker_issue: "Broker Issue",
};

export const FEATURE_CATEGORIES: { value: FeatureCategory; label: string }[] = [
  { value: "paige_ai", label: "AI Assistant" },
  { value: "business_tools", label: "Business Tools" },
  { value: "mobile", label: "Mobile Experience" },
  { value: "integrations", label: "Integrations" },
  { value: "reporting", label: "Reporting" },
  { value: "other", label: "Other" },
];

const LEGACY_FEATURE_LABELS: Record<string, string> = {
  credit_intelligence: "Credit Intelligence",
  funding: "Funding Tools",
  broker_workspace: "Broker Workspace",
};

export function ticketCategoryLabel(c: string): string {
  return TICKET_CATEGORIES.find((x) => x.value === c)?.label ?? LEGACY_TICKET_LABELS[c] ?? c;
}
export function featureCategoryLabel(c: string): string {
  return FEATURE_CATEGORIES.find((x) => x.value === c)?.label ?? LEGACY_FEATURE_LABELS[c] ?? c;
}

export const TICKET_STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  in_progress: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  waiting_on_client: "bg-purple-500/10 text-purple-600 border-purple-500/30",
  resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  closed: "bg-muted text-muted-foreground border-border",
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  waiting_on_client: "Waiting on You",
  resolved: "Resolved",
  closed: "Closed",
};

export const FEATURE_STATUS_STYLES: Record<FeatureStatus, string> = {
  submitted: "bg-muted text-muted-foreground border-border",
  under_review: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  planned: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  in_progress: "bg-purple-500/10 text-purple-600 border-purple-500/30",
  shipped: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  declined: "bg-destructive/10 text-destructive border-destructive/30",
};

export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  planned: "Planned",
  in_progress: "In Progress",
  shipped: "Shipped",
  declined: "Not Planned",
};

export const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low: "bg-muted text-muted-foreground border-border",
  normal: "bg-muted text-muted-foreground border-border",
  high: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  urgent: "bg-destructive/10 text-destructive border-destructive/30",
};

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo ago`;
  return `${Math.floor(s / 86400 / 365)}y ago`;
}
