import type { SoloSetupBrief, SoloSetupProposal } from "./settings-setup-contract";

// A bounded editor over Setup, not an onboarding schema or another fact store.
export const INTERVIEW_FIELDS = [
  ["publicName", "Business name"], ["industry", "Industry"],
  ["offers", "What you offer"], ["deliveryModel", "How you deliver"],
  ["idealCustomer", "Your customers"], ["currentPriority", "Current priority"],
  ["goals90Day", "Goals for the next 90 days"], ["constraints", "Challenges and constraints"],
  ["operatingPreferences", "How you work and the systems you use"],
  ["doNotAssume", "What PAIGE should not assume"],
] as const;
export type InterviewField = typeof INTERVIEW_FIELDS[number][0];
export function nextInterviewField(brief: SoloSetupBrief, after?: InterviewField): InterviewField | null {
  const fields = INTERVIEW_FIELDS.map(([key]) => key);
  const start = after ? fields.indexOf(after) + 1 : 0;
  return fields.slice(start).find(key => !brief[key] || brief.provenance[key]?.source !== "owner_confirmed") ?? null;
}
export function isOperationalProposal(proposal: SoloSetupProposal): boolean {
  const keys = Object.keys(proposal.patch);
  return keys.length > 0 && keys.every(key => INTERVIEW_FIELDS.some(([field]) => field === key) && typeof proposal.patch[key as InterviewField] === "string");
}
export type InterviewCheckpoint = {
  tenantId: string; threadId: string; phase: "active" | "paused" | "completed";
  nextField: InterviewField | null; contextRevisionAtCheckpoint: number | null;
};
export function cleanInterviewCheckpoint(value: unknown, tenantId: string, threadId: string): InterviewCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.tenantId !== tenantId || row.threadId !== threadId ||
      !["active", "paused", "completed"].includes(String(row.phase)) ||
      (row.nextField !== null && !INTERVIEW_FIELDS.some(([key]) => key === row.nextField)) ||
      (row.contextRevisionAtCheckpoint !== null && (!Number.isSafeInteger(row.contextRevisionAtCheckpoint) || Number(row.contextRevisionAtCheckpoint) < 0))) return null;
  return row as InterviewCheckpoint;
}
