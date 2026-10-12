// SYNTHETIC provider for rendered interaction ONLY. Not persistence or auth proof.
import { useState } from "react";
import { cleanSoloSetupBrief } from "@/solo/settings-setup-contract";
import { EMPTY_PAIGE_PROFILE } from "@/solo/settings-business-context-contract";
import type { BusinessContextSaveInput } from "@/solo/data/useSoloBusinessContext";
const tenantId = "test-tenant-interview";
let revision = 1;
let brief = cleanSoloSetupBrief({ publicName: "Example Services", industry: "Consulting", updatedAt: "synthetic-1", provenance: { publicName: { source: "owner_confirmed", confidence: "confirmed" }, industry: { source: "owner_confirmed", confidence: "confirmed" } } });
let progress: unknown = null;
export const useTenantContext = () => ({ activeTenantId: tenantId, activeTenant: { account_number: "synthetic" } });
export function useSoloBusinessContext() {
  const [epoch, setEpoch] = useState(0);
  return { loading: false, error: null, saving: false, accessScope: "owner_full", resolvedTenantId: tenantId, contextRevision: revision, brief, pendingProposal: null,
    businessOwners: [], primaryBusinessEmail: "", knowledgeSources: [], paigeProfile: EMPTY_PAIGE_PROFILE, voiceExamples: [],
    refresh: async () => { setEpoch(epoch + 1); },
    save: async (next: BusinessContextSaveInput) => {
      revision++; brief = cleanSoloSetupBrief({ ...next.brief, updatedAt: `synthetic-${revision}` }); setEpoch(epoch + 1);
      return { ok: true as const, kind: "saved" as const, readback: { tenantId, brief, contextRevision: revision } };
    },
  };
}
export const supabase = { rpc: async (name: string, args: Record<string, unknown>) => {
  if (name === "save_solo_business_interview_checkpoint") progress = { tenantId, threadId: args._thread_id, ...(args._checkpoint as object), contextRevisionAtCheckpoint: revision };
  return { data: progress, error: null };
} };
