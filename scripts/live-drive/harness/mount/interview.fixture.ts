// Existing render provider only. No Auth, model, database or provider effects.
import { useSyncExternalStore } from "react";
import { supabase as chatSupabase } from "../paige-chat-mount/solo-stubs";
export { useScopedUserId, usePlaybook, useChatDocumentUpload } from "../paige-chat-mount/solo-stubs";
import { cleanSoloSetupBrief } from "@/solo/settings-setup-contract";
import { EMPTY_PAIGE_PROFILE } from "@/solo/settings-business-context-contract";
import type { BusinessContextSaveInput } from "@/solo/data/useSoloBusinessContext";
const params = new URLSearchParams(location.search);
export const scenario = params.get("state") ?? "populated";
export const syntheticContext = params.get("context") === "second" ? "second" : "primary";
const tenantId = "synthetic-interview-" + syntheticContext;
const threadId = syntheticContext === "second" ? "22222222-2222-4222-8222-222222222222" : "11111111-1111-4111-8111-111111111111";
const empty = ["empty", "first-use"].includes(scenario);
const name = syntheticContext === "second" ? "Synthetic / Northside Studio" : "Synthetic / Example Services";
let revision = 1;
let brief = cleanSoloSetupBrief({ publicName: empty ? "" : name, industry: empty ? "" : "Consulting", updatedAt: "synthetic-1",
  operatingPreferences: scenario === "long" ? "We review customer requests in our existing shared inbox and spreadsheet. ".repeat(24) + "https://example.invalid/" + "long-reference-".repeat(30) : "",
  provenance: empty ? {} : { publicName: { source: "owner_confirmed", confidence: "confirmed" }, industry: { source: scenario === "connection" ? "connection_sourced" : "owner_confirmed", confidence: scenario === "connection" ? "observed" : "confirmed" } } });
let checkpoint: unknown = scenario === "paused" ? { tenantId, threadId, phase: "paused", nextField: "offers", contextRevisionAtCheckpoint: 1 } : null;
let attempts = 0;
let snapshot = { brief, revision, saving: false, loading: scenario === "loading", saveOutcomeUnknown: false, reconciling: false, error: scenario === "source-error" ? "Synthetic dependency unavailable. Open Setup or reopen this profile after recovery." : null as string | null };
const listeners = new Set<() => void>();
const publish = (patch: Partial<typeof snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(fn => fn()); };
export function recoverSyntheticSource() { publish({ loading: false, error: null }); }
export function advanceSyntheticRevision() { revision++; brief = cleanSoloSetupBrief({ ...brief, updatedAt: "synthetic-" + revision }); publish({ brief, revision }); }
export const fixtureIdentity = { tenantId, threadId, name };
export const useTenantContext = () => ({ activeTenantId: tenantId, isPlatformStaff: false, activeUserId: "test-owner-render", activeTenant: { id: tenantId, account_number: syntheticContext, account_type: "standalone", name } });
export function useSoloBusinessContext() {
  const current = useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot);
  const proposal = ["proposal", "mixed-proposal"].includes(scenario) ? { id: "synthetic-proposal", reason: "Synthetic suggestion for review; no model call occurred.", patch: scenario === "mixed-proposal" ? { industry: "Design consulting", legalName: "Excluded private field" } : { industry: "Design consulting", offers: "Website planning" }, proposedAt: "synthetic" } : null;
  return { ...current, canEdit: scenario !== "denied", canEditLegal: scenario !== "denied", activeTenantId: tenantId, representatives: [], contextRevision: current.revision, accessScope: scenario === "denied" ? "read_only" : "owner_full", resolvedTenantId: tenantId, pendingProposal: proposal,
    businessOwners: [], primaryBusinessEmail: "", knowledgeSources: [], paigeProfile: EMPTY_PAIGE_PROFILE, voiceExamples: [],
    refresh: async () => { recoverSyntheticSource(); },
    reconcileSave: async () => { publish({reconciling:true}); await new Promise(resolve=>setTimeout(resolve,250)); publish({reconciling:false,saveOutcomeUnknown:false}); return {ok:true as const,kind:"reconciled" as const,readback:{tenantId,brief,contextRevision:revision}}; },
    save: async (next: BusinessContextSaveInput) => {
      publish({ saving: true }); await new Promise(resolve => setTimeout(resolve, 250)); publish({ saving: false });
      if (scenario === "save-error" && ++attempts === 1) return { ok: false as const, kind: "error" as const, error: "Synthetic save failed. Your draft is retained; retry when ready." };
      revision++; brief = cleanSoloSetupBrief({ ...next.brief, updatedAt: "synthetic-" + revision }); publish({ brief, revision });
      if (["unknown-committed", "unknown-uncommitted"].includes(scenario) && ++attempts === 1) { if(scenario === "unknown-uncommitted") {brief=cleanSoloSetupBrief({publicName:name,industry:"Consulting",updatedAt:"synthetic-"+revision});publish({brief});} publish({saveOutcomeUnknown:true});return {ok:false as const,kind:"unknown" as const,error:"Synthetic response lost"}; }
      return { ok: true as const, kind: "saved" as const, readback: { tenantId, brief, contextRevision: revision } };
    },
  };
}
export const supabase = { ...chatSupabase, rpc: async (name: string, args: Record<string, unknown>) => {
  if(name === "get_solo_business_context") return {data:{tenantId,accessScope:"owner_full",brief,contextRevision:revision},error:null};
  if (scenario === "progress-error") return { data: null, error: { message: "Synthetic checkpoint unavailable" } };
  if (name === "save_solo_business_interview_checkpoint") checkpoint = { tenantId, threadId: args._thread_id, ...(args._checkpoint as object), contextRevisionAtCheckpoint: revision };
  return { data: checkpoint, error: null };
} };

const threadAdapter = { threads: [] as never[], isLoading:false,isFetched:true, loadTurns:async()=>[], ensureThread:async()=>threadId, onTurnPersisted:()=>{},renameThread:()=>{},archiveThread:()=>{},deleteThread:async()=>{} };
export function usePaigeThreads() { return threadAdapter; }

export const useOptionalTenantContext = useTenantContext;
