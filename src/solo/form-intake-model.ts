import type { FormIntakeField, FormIntakeSubmission } from "./useFormIntake";
import type { PipelineWorkspace } from "./useSoloCampaigns";

/** Pure helpers for the form intake panel: how a submission is named, labelled and described. */

export function pipelineName(workspace: PipelineWorkspace, id: string | null) {
  return workspace.pipelines.find((p) => p.id === id)?.name ?? null;
}

export function stageLabel(workspace: PipelineWorkspace, id: string | null) {
  return workspace.stages.find((s) => s.id === id)?.label ?? null;
}

export type Chip = { tone: "ok" | "v" | "warn" | "bad" | "n"; text: string };

const SKIP_REASON: Record<string, string> = {
  form_hourly_cap: "hourly limit reached",
  business_daily_cap: "daily limit reached",
};

// Only known platform reason codes become customer copy. Never echo a provider payload,
// internal file refusal or address from an unrecognized stored reason.
const REPLY_SKIP_REASON: Record<string, string> = {
  form_not_opted_in: "Reply drafts are off for this form",
  business_not_eligible: "Reply drafting is unavailable for this business",
  business_not_active: "Business needs attention before drafting",
  no_contact: "Reply needs a contact",
  contact_not_in_workspace: "Reply needs contact review",
  no_contact_email: "Reply needs the contact's email",
  submitted_email_not_contact_email: "Reply needs contact review",
  no_email_sender: "Reply needs business email setup",
  several_email_senders: "Reply needs one sending address",
  email_readiness_unreadable: "Business email status unavailable",
  lead_reply_unavailable: "Reply drafting status unavailable",
  cap_unreadable: "Reply drafting limit unavailable",
  business_hourly_cap: "Reply drafting limit reached",
  business_daily_cap: "Reply drafting limit reached",
  contact_daily_cap: "This contact's reply drafting limit reached",
};

export function submissionChips(row: FormIntakeSubmission, workspace: PipelineWorkspace): Chip[] {
  const chips: Chip[] = [];
  if (row.state === "pending" || row.state === "claimed") chips.push({ tone: "n", text: "Processing" });
  if (row.contactId) chips.push({ tone: "ok", text: "Lead created" });
  if (row.dealId) {
    const deal = workspace.deals.find((d) => d.id === row.dealId);
    const where = deal ? [pipelineName(workspace, deal.pipelineId), stageLabel(workspace, deal.stageId)].filter(Boolean).join(" → ") : "";
    chips.push({ tone: "v", text: where || "In pipeline" });
  }
  if (row.alertSentAt) chips.push({ tone: "ok", text: "Alert emailed" });
  else if (row.alertSkippedReason) chips.push({ tone: "warn", text: `Alert withheld — ${SKIP_REASON[row.alertSkippedReason] ?? row.alertSkippedReason.replace(/_/g, " ")}` });
  if (row.leadReplySkippedReason) chips.push({ tone: "warn", text: REPLY_SKIP_REASON[row.leadReplySkippedReason] ?? "Reply draft wasn't prepared" });
  if (row.state === "error") chips.push({ tone: "bad", text: "Needs attention" });
  return chips;
}

function optionLabel(field: FormIntakeField | undefined, value: unknown) {
  const option = field?.options?.find((o) => (typeof o === "string" ? o : o.value) === value);
  if (!option) return String(value);
  return typeof option === "string" ? option : option.label;
}

export function formatAnswer(field: FormIntakeField | undefined, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() ? (field?.options ? optionLabel(field, value) : value) : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map((v) => optionLabel(field, v)).join(", ") : null;
  if (typeof value === "number") return String(value);
  // A structured answer (an address, say) reads as its parts, never as raw JSON.
  if (typeof value === "object") {
    const parts = Object.values(value as Record<string, unknown>)
      .map((part) => (typeof part === "string" || typeof part === "number" ? String(part).trim() : ""))
      .filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  return String(value);
}

export const humanize = (key: string) => key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Who sent it, as the owner would say it: a name field if there is one, else the email given. */
export function submissionTitle(row: FormIntakeSubmission, fields: FormIntakeField[]) {
  const text = (key: string) => { const v = row.answers[key]; return typeof v === "string" && v.trim() ? v.trim() : null; };
  const named = fields.find((f) => f.type !== "email" && /name/i.test(f.key) && text(f.key));
  if (named) {
    const first = fields.find((f) => /first/i.test(f.key) && text(f.key));
    const last = fields.find((f) => /last/i.test(f.key) && text(f.key));
    if (first && last) return `${text(first.key)} ${text(last.key)}`;
    return text(named.key)!;
  }
  const email = fields.find((f) => f.type === "email" && text(f.key)) ?? (text("email") ? { key: "email" } : null);
  return email ? text(email.key)! : "Submission";
}

