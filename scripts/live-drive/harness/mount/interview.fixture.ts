// Existing render provider only. No Auth, model, database or provider effects.
import { useSyncExternalStore } from "react";
import { cleanSoloSetupBrief } from "@/solo/settings-setup-contract";
import { EMPTY_PAIGE_PROFILE } from "@/solo/settings-business-context-contract";
import type { BusinessContextSaveInput } from "@/solo/data/useSoloBusinessContext";
const params = new URLSearchParams(location.search);
export const scenario = params.get("state") ?? "populated";
export const syntheticContext = params.get("context") === "second" ? "second" : "primary";
const tenantId = "synthetic-interview-" + syntheticContext;
const threadId = "synthetic-thread-" + syntheticContext;
const empty = scenario === "empty";
const name = syntheticContext === "second" ? "Synthetic / Northside Studio" : "Synthetic / Example Services";
let revision = 1;
let brief = cleanSoloSetupBrief({ publicName: empty ? "" : name, industry: empty ? "" : "Consulting", updatedAt: "synthetic-1",
  operatingPreferences: scenario === "long" ? "We review customer requests in our existing shared inbox and spreadsheet. ".repeat(24) + "https://example.invalid/" + "long-reference-".repeat(30) : "",
  provenance: empty ? {} : { publicName: { source: "owner_confirmed", confidence: "confirmed" }, industry: { source: scenario === "connection" ? "connection_sourced" : "owner_confirmed", confidence: scenario === "connection" ? "observed" : "confirmed" } } });
let checkpoint: unknown = scenario === "paused" ? { tenantId, threadId, phase: "paused", nextField: "offers", contextRevisionAtCheckpoint: 1 } : null;
let attempts = 0;
let snapshot = { brief, revision, saving: false, loading: scenario === "loading", error: scenario === "source-error" ? "Synthetic dependency unavailable. Open Setup or reopen this profile after recovery." : null as string | null };
const listeners = new Set<() => void>();
const publish = (patch: Partial<typeof snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(fn => fn()); };
export function recoverSyntheticSource() { publish({ loading: false, error: null }); }
export function advanceSyntheticRevision() { revision++; brief = cleanSoloSetupBrief({ ...brief, updatedAt: "synthetic-" + revision }); publish({ brief, revision }); }
export const fixtureIdentity = { tenantId, threadId, name };
export const useTenantContext = () => ({ activeTenantId: tenantId, activeTenant: { account_number: syntheticContext } });
export function useSoloBusinessContext() {
  const current = useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot);
  const proposal = ["proposal", "mixed-proposal"].includes(scenario) ? { id: "synthetic-proposal", reason: "Synthetic suggestion for review; no model call occurred.", patch: scenario === "mixed-proposal" ? { industry: "Design consulting", legalName: "Excluded private field" } : { industry: "Design consulting", offers: "Website planning" }, proposedAt: "synthetic" } : null;
  return { ...current, contextRevision: current.revision, accessScope: scenario === "denied" ? "read_only" : "owner_full", resolvedTenantId: tenantId, pendingProposal: proposal,
    businessOwners: [], primaryBusinessEmail: "", knowledgeSources: [], paigeProfile: EMPTY_PAIGE_PROFILE, voiceExamples: [],
    refresh: async () => { recoverSyntheticSource(); },
    save: async (next: BusinessContextSaveInput) => {
      publish({ saving: true }); await new Promise(resolve => setTimeout(resolve, 250)); publish({ saving: false });
      if (scenario === "save-error" && ++attempts === 1) return { ok: false as const, kind: "error" as const, error: "Synthetic save failed. Your draft is retained; retry when ready." };
      revision++; brief = cleanSoloSetupBrief({ ...next.brief, updatedAt: "synthetic-" + revision }); publish({ brief, revision });
      return { ok: true as const, kind: "saved" as const, readback: { tenantId, brief, contextRevision: revision } };
    },
  };
}
export const supabase = { rpc: async (name: string, args: Record<string, unknown>) => {
  if (scenario === "progress-error") return { data: null, error: { message: "Synthetic checkpoint unavailable" } };
  if (name === "save_solo_business_interview_checkpoint") checkpoint = { tenantId, threadId: args._thread_id, ...(args._checkpoint as object), contextRevisionAtCheckpoint: revision };
  return { data: checkpoint, error: null };
} };
