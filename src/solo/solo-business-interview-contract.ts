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
// Presentation copy reused by profile buttons and the incumbent Chat slash menu.
// These are editable questions, never a capability/eligibility or action registry.
export const INTERVIEW_NEXT_PROMPTS = [
  { label: "What can help?", prompt: "Using my confirmed business profile, recommend three or four relevant PAIGE capabilities. Explain how each would help, what you can actually do here, and any permissions or setup still needed." },
  { label: "What should I connect?", prompt: "Based on my business priorities and current systems, recommend useful integrations. Check what is actually connected, explain the benefits, prerequisites and permissions, and guide me to the secure connection controls. Keep passwords and tokens out of Chat." },
  { label: "Choose a first action", prompt: "Help me choose one useful first business action for my confirmed priority. Check what is available and any existing work, then show me a proposal to review. Do not execute it yet. If I approve it later, show me the saved result, its status and where I can find it again. If the outcome is uncertain, check it before another attempt." },
];
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
