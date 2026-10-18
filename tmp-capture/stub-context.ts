import { cleanSoloSetupBrief } from "../../solo/settings-setup-contract";
const brief = cleanSoloSetupBrief({
  publicName: "Meridian Design Co",
  industry: "Design consultancy for home-service brands",
  currentPriority: "Turn more quotes into booked work",
  provenance: {
    publicName: { source: "owner_confirmed", confidence: "confirmed" },
    industry: { source: "owner_confirmed", confidence: "confirmed" },
    currentPriority: { source: "owner_confirmed", confidence: "confirmed" },
  },
});
export function useSoloBusinessContext() {
  return {
    loading: false, error: null, saving: false, saveOutcomeUnknown: false, reconciling: false,
    accessScope: "owner_full", resolvedTenantId: "tenant-a", contextRevision: 7, brief,
    pendingProposal: null, businessOwners: [{ id: "existing-owner" }],
    primaryBusinessEmail: "studio@example.invalid", knowledgeSources: [{ id: "existing-source" }],
    paigeProfile: { identity: "existing-profile" }, voiceExamples: [{ id: "existing-example" }],
    save: async () => ({ ok: true, kind: "saved", readback: { tenantId: "tenant-a", brief, contextRevision: 8 } }),
    refresh: async () => {},
    reconcileSave: async () => ({ ok: true, kind: "reconciled", readback: { tenantId: "tenant-a", brief, contextRevision: 8 } }),
  };
}
