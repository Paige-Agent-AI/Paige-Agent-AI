import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { createSettingsRequestGate } from "../settings-contract";
import {
  cleanSoloBusinessOwners,
  cleanSoloSetupBrief,
  type SetupAccessScope,
  type SetupFactProvenance,
  type SoloBusinessOwner,
  type SoloSetupBrief,
  type SoloSetupProposal,
} from "../settings-setup-contract";
import {
  EMPTY_PAIGE_PROFILE,
  cleanSetupKnowledgeSources,
  cleanSetupVoiceExamples,
  cleanSoloPaigeProfile,
  type ManagedEmailIdentity,
  type SetupKnowledgeSource,
  type SetupVoiceExample,
  type SoloPaigeProfile,
} from "../settings-business-context-contract";
import { useSoloPeople, type SoloPerson } from "./useSoloPeople";

// Unresolved snapshots must stay referentially stable: the editor resets its
// local draft when a persisted snapshot changes, including during first load.
const EMPTY_BRIEF = cleanSoloSetupBrief(null);
const EMPTY_OWNERS: SoloBusinessOwner[] = [];
const EMPTY_SOURCES: SetupKnowledgeSource[] = [];
const EMPTY_EXAMPLES: SetupVoiceExample[] = [];
const EMPTY_PEOPLE: SoloPerson[] = [];
const EMPTY_EMAIL_PROVENANCE: SetupFactProvenance = {
  source: "needs_confirmation",
  confidence: "unknown",
};

type ContextRow = {
  tenantId?: string;
  tenantName?: string;
  brief?: unknown;
  pendingProposal?: unknown;
  primaryBusinessEmail?: string | null;
  primaryEmailProvenance?: unknown;
  accessScope?: SetupAccessScope;
  businessOwners?: unknown;
  contextRevision?: number;
  knowledgeSources?: unknown;
  paigeProfile?: unknown;
  voiceExamples?: unknown;
  managedEmail?: unknown;
};

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function proposalOf(value: unknown): SoloSetupProposal | null {
  const raw = objectOf(value);
  if (
    typeof raw.id !== "string" ||
    typeof raw.reason !== "string" ||
    typeof raw.proposedAt !== "string"
  )
    return null;
  if (!raw.patch || typeof raw.patch !== "object" || Array.isArray(raw.patch))
    return null;
  return {
    id: raw.id,
    reason: raw.reason,
    proposedAt: raw.proposedAt,
    patch: raw.patch as Partial<SoloSetupBrief>,
  };
}

function managedEmailOf(value: unknown): ManagedEmailIdentity | null {
  const row = objectOf(value);
  if (typeof row.address !== "string") return null;
  return {
    localPart:
      typeof row.localPart === "string"
        ? row.localPart
        : row.address.split("@")[0],
    domain:
      typeof row.domain === "string"
        ? row.domain
        : (row.address.split("@")[1] ?? "mail.paigeagent.ai"),
    address: row.address,
    available: typeof row.available === "boolean" ? row.available : null,
    registrationAvailable: row.registrationAvailable === true,
  };
}

function errorMessage(value: unknown, fallback: string) {
  // Provider/database text is never an owner-facing error contract.
  if (isConflict(value))
    return "This business context changed in another session. Load the stored version before saving again.";
  const code = objectOf(value).code;
  if (code === "42501")
    return "You do not have permission to make this change in this workspace.";
  if (code === "23505")
    return "That address or record is no longer available. Check again before retrying.";
  if (code === "22023" || code === "22001" || code === "23514")
    return "Some details are invalid or too long. Review your entries and try again.";
  return fallback;
}

function isConflict(value: unknown) {
  const raw = objectOf(value);
  return (
    raw.code === "40001" ||
    raw.hint === "SETUP_CONFLICT" ||
    String(raw.message ?? "").includes("changed in another session")
  );
}

async function setupRpc(name: string, args?: Record<string, unknown>) {
  try {
    // Generated RPC types are refreshed after the Setup migration is applied.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (supabase as any).rpc(name, args);
  } catch {
    // Transport exceptions can contain URLs or provider text; never render them.
    return { data: null, error: { code: "SETUP_REQUEST_FAILED" } };
  }
}

export type BusinessContextSaveInput = {
  brief: SoloSetupBrief;
  businessOwners: SoloBusinessOwner[];
  primaryBusinessEmail: string;
  primaryBusinessEmailDecision?: "adopt" | "override" | null;
  knowledgeSources: SetupKnowledgeSource[];
  paigeProfile: SoloPaigeProfile;
  voiceExamples: SetupVoiceExample[];
  proposalId: string | null;
};

export type BusinessContextSaveResult =
  | {
      ok: true;
      kind: "saved";
      /** Caller-facing Setup readback, not a receipt or a model-context grant.
       * Never use the submitted draft as evidence that a fact was stored. */
      readback: {
        tenantId: string;
        brief: SoloSetupBrief;
        contextRevision: number | null;
      };
    }
  | { ok: false; kind: "failed" | "conflict" | "stale" | "unknown"; error: string };

const UNKNOWN_SAVE = "We couldn't verify whether Setup was saved. Check the stored version before saving again.";

export function useSoloBusinessContext() {
  const { activeTenantId, refresh: refreshTenant } = useTenantContext();
  const people = useSoloPeople();
  const gate = useRef(createSettingsRequestGate());
  const saveEpoch = useRef(0);
  const mutation = useRef<{ tenantId: string; epoch: number } | null>(null);
  const activeTenantRef = useRef(activeTenantId);
  activeTenantRef.current = activeTenantId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const unknownSaveTenant = useRef<string | null>(null);
  const [unknownTenant, setUnknownTenant] = useState<string | null>(null);
  const reconciliationBusy = useRef(false);
  const reconciliationTicket = useRef(0);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessScope, setAccessScope] = useState<SetupAccessScope>("read_only");
  const [resolvedTenantId, setResolvedTenantId] = useState<string | null>(null);
  const [brief, setBrief] = useState(() => cleanSoloSetupBrief(null));
  const [businessOwners, setBusinessOwners] = useState<SoloBusinessOwner[]>([]);
  const [primaryBusinessEmail, setPrimaryBusinessEmail] = useState("");
  const [primaryBusinessEmailProvenance, setPrimaryBusinessEmailProvenance] =
    useState<SetupFactProvenance>({
      source: "needs_confirmation",
      confidence: "unknown",
    });
  const [knowledgeSources, setKnowledgeSources] = useState<
    SetupKnowledgeSource[]
  >([]);
  const [paigeProfile, setPaigeProfile] =
    useState<SoloPaigeProfile>(EMPTY_PAIGE_PROFILE);
  const [voiceExamples, setVoiceExamples] = useState<SetupVoiceExample[]>([]);
  const [managedEmail, setManagedEmail] = useState<ManagedEmailIdentity | null>(
    null,
  );
  const [contextRevision, setContextRevision] = useState(0);
  const [pendingProposal, setPendingProposal] =
    useState<SoloSetupProposal | null>(null);

  const accept = useCallback((row: ContextRow, expectedTenantId: string) => {
    if (row.tenantId !== expectedTenantId)
      throw new Error("The active workspace could not be resolved safely.");
    setBrief(cleanSoloSetupBrief(row.brief, row.tenantName ?? ""));
    setBusinessOwners(cleanSoloBusinessOwners(row.businessOwners));
    setPrimaryBusinessEmail(row.primaryBusinessEmail?.trim() ?? "");
    const emailProvenance = objectOf(row.primaryEmailProvenance);
    setPrimaryBusinessEmailProvenance({
      source:
        emailProvenance.source === "owner_confirmed"
          ? "owner_confirmed"
          : row.primaryBusinessEmail
            ? "connection_sourced"
            : "needs_confirmation",
      confidence:
        emailProvenance.source === "owner_confirmed"
          ? "confirmed"
          : row.primaryBusinessEmail
            ? "observed"
            : "unknown",
    });
    setKnowledgeSources(cleanSetupKnowledgeSources(row.knowledgeSources));
    setPaigeProfile(cleanSoloPaigeProfile(row.paigeProfile));
    setVoiceExamples(cleanSetupVoiceExamples(row.voiceExamples));
    setManagedEmail(managedEmailOf(row.managedEmail));
    setContextRevision(
      Number.isSafeInteger(row.contextRevision)
        ? Number(row.contextRevision)
        : 0,
    );
    setPendingProposal(proposalOf(row.pendingProposal));
    setAccessScope(
      ["owner_full", "admin_operational", "read_only"].includes(
        String(row.accessScope),
      )
        ? (row.accessScope as SetupAccessScope)
        : "read_only",
    );
    setResolvedTenantId(row.tenantId ?? null);
  }, []);

  const load = useCallback(async (): Promise<ContextRow | null> => {
    if (mutation.current?.tenantId === activeTenantId) return null;
    const token = gate.current.begin();
    saveEpoch.current += 1;
    mutation.current = null;
    setSaving(false);
    setLoading(true);
    setError(null);
    setResolvedTenantId(null);
    setAccessScope("read_only");
    setBrief(cleanSoloSetupBrief(null));
    setBusinessOwners([]);
    setPrimaryBusinessEmail("");
    setPrimaryBusinessEmailProvenance({
      source: "needs_confirmation",
      confidence: "unknown",
    });
    setKnowledgeSources([]);
    setPaigeProfile(EMPTY_PAIGE_PROFILE);
    setVoiceExamples([]);
    setManagedEmail(null);
    setContextRevision(0);
    setPendingProposal(null);
    if (!activeTenantId) {
      setError("Choose a Solo workspace to open Setup.");
      setLoading(false);
      return null;
    }
    try {
      // Generated types refresh after the migration is applied.

      const { data, error: loadError } = await setupRpc(
        "get_solo_business_context",
      );
      if (!gate.current.isCurrent(token) || activeTenantRef.current !== activeTenantId) return null;
      if (loadError) throw loadError;
      const row = (Array.isArray(data) ? data[0] : data) as ContextRow | null;
      if (!row || !Number.isSafeInteger(row.contextRevision) || Number(row.contextRevision) < 0)
        throw new Error("The active workspace could not be resolved safely.");
      accept(row, activeTenantId);
      return row;
    } catch (caught) {
      if (gate.current.isCurrent(token))
        setError(errorMessage(caught, "Couldn't load this business context."));
    } finally {
      if (gate.current.isCurrent(token)) setLoading(false);
    }
    return null;
  }, [accept, activeTenantId]);

  useEffect(() => {
    const activeGate = gate.current;
    unknownSaveTenant.current = null;
    setUnknownTenant(null);
    reconciliationBusy.current = false;
    reconciliationTicket.current += 1;
    setReconciling(false);
    void load();
    return () => {
      activeGate.clear();
      saveEpoch.current += 1;
      mutation.current = null;
    };
  }, [load]);

  const tenantResolved =
    Boolean(activeTenantId) && resolvedTenantId === activeTenantId;
  const canEdit =
    tenantResolved && !loading && !error && accessScope !== "read_only";

  const save = useCallback(
    async (
      next: BusinessContextSaveInput,
    ): Promise<BusinessContextSaveResult> => {
      const tenantAtStart = activeTenantId;
      if (tenantAtStart && unknownSaveTenant.current === tenantAtStart)
        return { ok: false, kind: "unknown", error: UNKNOWN_SAVE };
      if (
        !tenantAtStart ||
        !canEdit ||
        activeTenantRef.current !== tenantAtStart ||
        mutation.current || reconciliationBusy.current
      )
        return {
          ok: false,
          kind: "failed",
          error: "This workspace has not resolved safely for editing.",
        };
      const epoch = ++saveEpoch.current;
      mutation.current = { tenantId: tenantAtStart, epoch };
      setSaving(true);
      try {
        const { data, error: saveError } = await setupRpc(
          "save_solo_business_context",
          {
            _expected_tenant_id: tenantAtStart,
            _brief: next.brief,
            _business_owners: next.businessOwners,
            _primary_business_email:
              accessScope === "owner_full" ? next.primaryBusinessEmail : null,
            _expected_primary_business_email: primaryBusinessEmail,
            _primary_business_email_decision:
              next.primaryBusinessEmailDecision ?? null,
            _knowledge_sources:
              accessScope === "owner_full" ? next.knowledgeSources : null,
            _paige_profile:
              accessScope === "owner_full" ? next.paigeProfile : null,
            _voice_examples:
              accessScope === "owner_full" ? next.voiceExamples : null,
            _expected_updated_at: brief.updatedAt ?? null,
            _expected_context_revision: contextRevision,
            _proposal_id: next.proposalId,
          },
        );
        if (saveError) throw saveError;
        if (
          epoch !== saveEpoch.current ||
          activeTenantRef.current !== tenantAtStart
        )
          return {
            ok: false,
            kind: "stale",
            error:
              "The account changed before this save response returned. Its result was not shown here.",
          };
        const row = (Array.isArray(data) ? data[0] : data) as ContextRow | null;
        if (!row || row.tenantId !== tenantAtStart || !Number.isSafeInteger(row.contextRevision) || Number(row.contextRevision) < 0)
          throw new Error("The saved record could not be verified.");
        accept(row, tenantAtStart);
        // #826: a successful save is the canonical setup journey's completion —
        // the trigger wrote features.solo_setup_complete in the same commit.
        // Refresh the tenant context (best-effort) so the setup gate opens
        // in-session, the marketplace precedent applied to the surface that
        // now owns completion. A refresh failure never fails the save; neither
        // does a context that offers no refresh (older doubles, tests).
        if (typeof refreshTenant === "function") {
          void Promise.resolve(refreshTenant()).catch(() => {});
        }
        return {
          ok: true,
          kind: "saved",
          readback: {
            tenantId: tenantAtStart,
            brief: cleanSoloSetupBrief(row.brief, row.tenantName ?? ""),
            contextRevision: Number.isSafeInteger(row.contextRevision) && Number(row.contextRevision) >= 0
              ? Number(row.contextRevision)
              : null,
          },
        };
      } catch (caught) {
        if (
          epoch !== saveEpoch.current ||
          activeTenantRef.current !== tenantAtStart
        )
          return {
            ok: false,
            kind: "stale",
            error:
              "The account changed before this save response returned. Its result was not shown here.",
          };
        // Only a PostgreSQL failure establishes a rolled-back transaction.
        // Lost transport, HTTP/proxy errors or an unreadable success payload do not.
        const code = String(objectOf(caught).code ?? "");
        if (!/^(?:[0-9]{2}|0[A-Z]|2[BDF]|3[BDF]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(code)) {
          unknownSaveTenant.current = tenantAtStart;
          setUnknownTenant(tenantAtStart);
          return { ok: false, kind: "unknown", error: UNKNOWN_SAVE };
        }
        return {
          ok: false,
          kind: isConflict(caught) ? "conflict" : "failed",
          error: errorMessage(caught, "Couldn't save this business context."),
        };
      } finally {
        if (mutation.current?.epoch === epoch) mutation.current = null;
        if (epoch === saveEpoch.current) setSaving(false);
      }
    },
    [
      accept,
      activeTenantId,
      brief.updatedAt,
      canEdit,
      contextRevision,
      accessScope,
      primaryBusinessEmail,
      refreshTenant,
    ],
  );

  const reconcileSave = useCallback(async () => {
    const tenantAtStart = activeTenantId;
    if (!tenantAtStart || activeTenantRef.current !== tenantAtStart ||
        unknownSaveTenant.current !== tenantAtStart || mutation.current || reconciliationBusy.current)
      return { ok: false as const, error: "Check the stored version in the current workspace before continuing." };
    reconciliationBusy.current = true;
    const ticket = ++reconciliationTicket.current;
    setReconciling(true);
    const expectedEpoch = saveEpoch.current + 1;
    try {
      const row = await load();
      if (!row || activeTenantRef.current !== tenantAtStart || saveEpoch.current !== expectedEpoch ||
          unknownSaveTenant.current !== tenantAtStart || row.tenantId !== tenantAtStart)
        return { ok: false as const, error: "The stored version could not be verified. No save was retried." };
      unknownSaveTenant.current = null;
      setUnknownTenant(null);
      return { ok: true as const, kind: "reconciled" as const, readback: {
        tenantId: tenantAtStart, brief: cleanSoloSetupBrief(row.brief, row.tenantName ?? ""),
        contextRevision: Number(row.contextRevision),
      } };
    } finally {
      if (reconciliationTicket.current === ticket && activeTenantRef.current === tenantAtStart) {
        reconciliationBusy.current = false;
        setReconciling(false);
      }
    }
  }, [activeTenantId, load]);

  const checkManagedEmail = useCallback(
    async (localPart: string) => {
      const tenantAtStart = activeTenantId;
      const epoch = saveEpoch.current;
      if (
        !tenantAtStart ||
        !canEdit ||
        accessScope !== "owner_full" ||
        unknownSaveTenant.current === tenantAtStart ||
        mutation.current ||
        activeTenantRef.current !== tenantAtStart
      )
        throw new Error("This workspace is not available for email changes.");

      const { data, error: rpcError } = await setupRpc(
        "check_solo_setup_managed_email",
        { _local_part: localPart },
      );
      if (
        activeTenantRef.current !== tenantAtStart ||
        epoch !== saveEpoch.current
      )
        throw new Error("The workspace changed. Check availability again.");
      if (rpcError)
        throw new Error(errorMessage(rpcError, "Couldn't check this address."));
      return managedEmailOf(data);
    },
    [activeTenantId, canEdit, accessScope],
  );

  const registerManagedEmail = useCallback(
    async (localPart: string) => {
      const tenantAtStart = activeTenantId;
      if (
        !tenantAtStart ||
        !canEdit ||
        accessScope !== "owner_full" ||
        unknownSaveTenant.current === tenantAtStart ||
        mutation.current ||
        activeTenantRef.current !== tenantAtStart
      )
        throw new Error("This workspace is not available for email changes.");
      const epoch = ++saveEpoch.current;
      mutation.current = { tenantId: tenantAtStart, epoch };
      setSaving(true);
      try {
        const { data, error: rpcError } = await setupRpc(
          "register_solo_setup_managed_email",
          { _expected_tenant_id: tenantAtStart, _local_part: localPart },
        );
        if (rpcError)
          throw new Error(
            errorMessage(rpcError, "Couldn't register this address."),
          );
        if (
          activeTenantRef.current !== tenantAtStart ||
          epoch !== saveEpoch.current
        )
          throw new Error(
            "The account changed before registration completed. Reload Setup before continuing.",
          );
        const value = managedEmailOf(data);
        const requestedLocal = localPart.trim().toLowerCase();
        if (
          !value ||
          objectOf(data).registered !== true ||
          value.localPart !== requestedLocal ||
          !value.domain ||
          value.address !== `${requestedLocal}@${value.domain}` ||
          (managedEmail?.domain && value.domain !== managedEmail.domain)
        )
          throw new Error(
            "Registration did not return a verified identity. Reload before retrying.",
          );
        const { data: stored, error: readError } = await setupRpc(
          "get_solo_business_context",
          {},
        );
        if (
          activeTenantRef.current !== tenantAtStart ||
          epoch !== saveEpoch.current
        )
          throw new Error(
            "The workspace changed. Reload Setup before continuing.",
          );
        const storedRow = objectOf(Array.isArray(stored) ? stored[0] : stored);
        const verified = managedEmailOf(storedRow.managedEmail);
        if (
          readError ||
          storedRow.tenantId !== tenantAtStart ||
          !verified ||
          verified.address !== value.address ||
          verified.localPart !== requestedLocal ||
          verified.domain !== value.domain
        )
          throw new Error(
            "Registration could not be verified after saving. Reload or retry before using this address.",
          );
        // Do not refresh the brief/revision underneath a separate unsaved draft.
        setManagedEmail(verified);
        return verified;
      } finally {
        if (mutation.current?.epoch === epoch) mutation.current = null;
        if (saveEpoch.current === epoch) setSaving(false);
      }
    },
    [activeTenantId, canEdit, accessScope, managedEmail?.domain],
  );

  const searchNaics = useCallback(
    async (query: string) => {
      const tenantAtStart = activeTenantId;
      const epoch = saveEpoch.current;
      if (
        !tenantAtStart ||
        !tenantResolved ||
        activeTenantRef.current !== tenantAtStart
      )
        throw new Error("Choose a Solo workspace before searching.");

      const { data, error: rpcError } = await setupRpc(
        "search_solo_setup_naics",
        { _query: query, _limit: 20 },
      );
      if (
        activeTenantRef.current !== tenantAtStart ||
        epoch !== saveEpoch.current
      )
        throw new Error("The workspace changed. Search again.");
      if (rpcError)
        throw new Error(
          errorMessage(rpcError, "Couldn't search the NAICS reference."),
        );
      return (Array.isArray(data) ? data : []).flatMap((row: unknown) => {
        const item = objectOf(row);
        return typeof item.code === "string" && typeof item.title === "string"
          ? [{ code: item.code, title: item.title }]
          : [];
      });
    },
    [activeTenantId, tenantResolved],
  );

  const dismissProposal = useCallback(
    async (id: string) => {
      const tenantAtStart = activeTenantId;
      if (
        !canEdit ||
        !tenantAtStart ||
        unknownSaveTenant.current === tenantAtStart ||
        mutation.current ||
        activeTenantRef.current !== tenantAtStart
      )
        return {
          ok: false,
          error: "This workspace has not resolved safely for editing.",
        };
      const epoch = ++saveEpoch.current;
      mutation.current = { tenantId: tenantAtStart, epoch };
      setSaving(true);
      try {
        const { error: rpcError } = await setupRpc(
          "dismiss_solo_setup_context_proposal",
          { _expected_tenant_id: tenantAtStart, _proposal_id: id },
        );
        if (rpcError) throw rpcError;
        if (
          activeTenantRef.current !== tenantAtStart ||
          epoch !== saveEpoch.current
        )
          return {
            ok: false,
            error: "The workspace changed. Reload before continuing.",
          };
        setPendingProposal(null);
        return { ok: true };
      } catch (caught) {
        return {
          ok: false,
          error: errorMessage(caught, "Couldn't dismiss this suggestion."),
        };
      } finally {
        if (mutation.current?.epoch === epoch) mutation.current = null;
        if (saveEpoch.current === epoch) setSaving(false);
      }
    },
    [canEdit, activeTenantId],
  );

  return {
    loading,
    error,
    saving,
    saveOutcomeUnknown: Boolean(activeTenantId) && unknownTenant === activeTenantId,
    reconciling,
    reconcileSave,
    accessScope,
    canEdit,
    canEditLegal: canEdit && accessScope === "owner_full",
    activeTenantId,
    resolvedTenantId,
    contextRevision: tenantResolved ? contextRevision : null,
    brief: tenantResolved ? brief : EMPTY_BRIEF,
    businessOwners: tenantResolved ? businessOwners : EMPTY_OWNERS,
    primaryBusinessEmail: tenantResolved ? primaryBusinessEmail : "",
    primaryBusinessEmailProvenance: tenantResolved
      ? primaryBusinessEmailProvenance
      : EMPTY_EMAIL_PROVENANCE,
    knowledgeSources: tenantResolved ? knowledgeSources : EMPTY_SOURCES,
    paigeProfile: tenantResolved ? paigeProfile : EMPTY_PAIGE_PROFILE,
    voiceExamples: tenantResolved ? voiceExamples : EMPTY_EXAMPLES,
    managedEmail: tenantResolved ? managedEmail : null,
    pendingProposal: tenantResolved ? pendingProposal : null,
    representatives: tenantResolved
      ? people.people.filter((person) => person.status === "Active")
      : EMPTY_PEOPLE,
    representativesLoading: people.loading,
    representativesError: people.error
      ? "Couldn't load active Team people. Retry before changing representatives."
      : null,
    save,
    checkManagedEmail,
    registerManagedEmail,
    searchNaics,
    dismissProposal,
    refresh: load,
  };
}
