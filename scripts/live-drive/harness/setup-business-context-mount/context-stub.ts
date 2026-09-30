import { useState } from "react";
import { cleanSoloSetupBrief } from "@/solo/settings-setup-contract";
import { EMPTY_PAIGE_PROFILE } from "@/solo/settings-business-context-contract";

const confirmed = {
  source: "owner_confirmed",
  confidence: "confirmed",
} as const;
const initial = {
  brief: cleanSoloSetupBrief({
    legalName: "Harness Advisory LLC",
    publicName: "Harness Advisory",
    dbaName: "Harness Studio",
    website: "https://example.com",
    registeredStreet: "100 Example Avenue",
    registeredCity: "Example City",
    registeredRegion: "Example Region",
    registeredPostalCode: "12345",
    registeredIsoCountry: "US",
    entityType: "llc",
    formationJurisdiction: "Example jurisdiction",
    representativeUserIds: ["harness-owner"],
    authorizedRepresentativeUserId: "harness-owner",
    authorizedRepresentativePhone: "+14045550188",
    currentPriority: "Build a trustworthy owner experience",
    provenance: { legalName: confirmed, publicName: confirmed },
  }),
  businessOwners: [],
  knowledgeSources: [
    {
      id: "source-1",
      sourceType: "link",
      title: "Business overview",
      category: "business",
      sourceUrl: "https://example.com",
      reference: "",
      notes: "Synthetic render fixture only.",
      reviewStatus: "ready",
      provenance: confirmed,
    },
  ],
  paigeProfile: {
    ...EMPTY_PAIGE_PROFILE,
    voiceCharacter: "Direct, warm, strategic, and grounded",
    audienceRelationship: "Trusted guide beside the founder",
    messageStructure: "Lead with the outcome, then the path",
  },
  voiceExamples: [],
  primaryBusinessEmail: "owner@example.com",
};
export function useSoloBusinessContext() {
  const [snapshot, setSnapshot] = useState(initial);
  return {
    ...snapshot,
    loading: false,
    error: null,
    saving: false,
    accessScope: "owner_full",
    canEdit: true,
    canEditLegal: true,
    activeTenantId: "harness-tenant",
    resolvedTenantId: "harness-tenant",
    primaryBusinessEmailProvenance: confirmed,
    pendingProposal: null,
    managedEmail: {
      localPart: "harness",
      domain: "mail.paigeagent.ai",
      address: "harness@mail.paigeagent.ai",
      available: null,
      registrationAvailable: true,
    },
    representatives: [
      {
        id: "harness-owner",
        name: "Harness Owner",
        role: "Owner",
        email: "owner@example.com",
        status: "Active",
        isOwner: true,
      },
    ],
    representativesLoading: false,
    representativesError: null,
    save: async (draft: typeof initial) => {
      setSnapshot(draft);
      return { ok: true, kind: "saved" };
    },
    refresh: () => {},
    dismissProposal: async () => {},
    checkManagedEmail: async (local: string) => ({
      available: true,
      address: `${local}@mail.paigeagent.ai`,
    }),
    registerManagedEmail: async () => ({ registered: false }),
    searchNaics: async () => [
      {
        code: "541611",
        title:
          "Administrative Management and General Management Consulting Services",
      },
    ],
  };
}
