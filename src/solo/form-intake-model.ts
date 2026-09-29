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
  return JSON.stringify(value);
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

