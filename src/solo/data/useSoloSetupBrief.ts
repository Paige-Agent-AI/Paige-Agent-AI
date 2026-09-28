import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { createSettingsRequestGate } from "../settings-contract";
import { rescanBusinessContext } from "@/lib/systemsCheck/rescanBusinessContext";
import {
  cleanSoloBusinessOwners,
  cleanSoloSetupBrief,
  type SetupAccessScope,
  type SoloBusinessOwner,
  type SoloSetupBrief,
  type SoloSetupProposal,
} from "../settings-setup-contract";
import { useSoloPeople, type SoloPerson } from "./useSoloPeople";

type ContextRow = {
  tenantId?: string;
  tenantName?: string;
  brief?: unknown;
  pendingProposal?: unknown;
  primaryBusinessEmail?: string | null;
  accessScope?: SetupAccessScope;
  businessOwners?: unknown;
};

type IdentityRow = { default_email_sender?: string | null };

function proposalOf(value: unknown): SoloSetupProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.reason !== "string" || typeof raw.proposedAt !== "string") return null;
  if (!raw.patch || typeof raw.patch !== "object" || Array.isArray(raw.patch)) return null;
  return { id: raw.id, reason: raw.reason, proposedAt: raw.proposedAt, patch: raw.patch as Partial<SoloSetupBrief> };
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
  return value instanceof Error ? value.message : fallback;
}

function isConflict(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const raw = value as { code?: unknown; hint?: unknown; message?: unknown };
  return raw.code === "40001" || raw.hint === "SETUP_CONFLICT" || String(raw.message ?? "").includes("changed in another session");
}

export type SoloSetupSaveResult =
  | { ok: true; kind: "saved"; brief: SoloSetupBrief; businessOwners: SoloBusinessOwner[] }
  | { ok: false; kind: "failed" | "conflict" | "stale"; error: string };

export type SoloSetupBriefData = {
  loading: boolean;
  error: string | null;
  saving: boolean;
  accessScope: SetupAccessScope;
  canEdit: boolean;
  canEditLegal: boolean;
  activeTenantId: string | null;
  resolvedTenantId: string | null;
  brief: SoloSetupBrief;
  businessOwners: SoloBusinessOwner[];
  representatives: SoloPerson[];
  representativesLoading: boolean;
  representativesError: string | null;
  managedSendingEmail: string | null;
  primaryBusinessEmail: string | null;
  pendingProposal: SoloSetupProposal | null;
  save: (brief: SoloSetupBrief, businessOwners: SoloBusinessOwner[], proposalId: string | null) => Promise<SoloSetupSaveResult>;
  dismissProposal: (proposalId: string) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => void;
};

export function useSoloSetupBrief(): SoloSetupBriefData {
  const { activeTenantId } = useTenantContext();
  const people = useSoloPeople();
  const gate = useRef(createSettingsRequestGate());
  const saveEpoch = useRef(0);
  const activeTenantRef = useRef(activeTenantId);
  activeTenantRef.current = activeTenantId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessScope, setAccessScope] = useState<SetupAccessScope>("read_only");
  const [resolvedTenantId, setResolvedTenantId] = useState<string | null>(null);
  // The workspace the last load finished for, whether it succeeded or failed. A failed read must
  // still settle, or its error is hidden behind a loading state that never ends.
  const [settledTenantId, setSettledTenantId] = useState<string | null>(null);
  const [brief, setBrief] = useState(() => cleanSoloSetupBrief(null));
  const [businessOwners, setBusinessOwners] = useState<SoloBusinessOwner[]>([]);
  const [managedSendingEmail, setManagedSendingEmail] = useState<string | null>(null);
  const [primaryBusinessEmail, setPrimaryBusinessEmail] = useState<string | null>(null);
  const [pendingProposal, setPendingProposal] = useState<SoloSetupProposal | null>(null);

  const acceptContext = useCallback((row: ContextRow, expectedTenantId: string) => {
    if (row.tenantId !== expectedTenantId) throw new Error("The active workspace could not be resolved safely.");
    setBrief(cleanSoloSetupBrief(row.brief, row.tenantName ?? ""));
    setBusinessOwners(cleanSoloBusinessOwners(row.businessOwners));
    setPendingProposal(proposalOf(row.pendingProposal));
    setResolvedTenantId(row.tenantId ?? null);
    setAccessScope(["owner_full", "admin_operational", "read_only"].includes(String(row.accessScope))
      ? row.accessScope as SetupAccessScope
      : "read_only");
    setPrimaryBusinessEmail(row.primaryBusinessEmail?.trim() || null);
  }, []);

  const load = useCallback(async () => {
    const token = gate.current.begin();
    saveEpoch.current += 1;
    setSaving(false);
    setLoading(true);
    setError(null);
    setAccessScope("read_only");
    setResolvedTenantId(null);
    setSettledTenantId(null);
    setBrief(cleanSoloSetupBrief(null));
    setBusinessOwners([]);
    setPendingProposal(null);
    setManagedSendingEmail(null);
    setPrimaryBusinessEmail(null);
    if (!activeTenantId) {
      setLoading(false);
      return;
    }
    try {
      const [contextResult, identityResult] = await Promise.all([
        // Migration-backed canonical Setup read. Generated types refresh after apply.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc("get_solo_setup_context"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc("resolve_tenant_domain_identity"),
      ]);
      if (!gate.current.isCurrent(token)) return;
      if (contextResult.error) throw contextResult.error;
      const row = (Array.isArray(contextResult.data) ? contextResult.data[0] : contextResult.data) as ContextRow | null;
      const identity = (Array.isArray(identityResult.data) ? identityResult.data[0] : identityResult.data) as IdentityRow | null;
      if (!row) throw new Error("The active workspace could not be resolved safely.");
      acceptContext(row, activeTenantId);
      setManagedSendingEmail(identityResult.error ? null : identity?.default_email_sender?.trim() || null);
    } catch (caught) {
      if (!gate.current.isCurrent(token)) return;
      setError(errorMessage(caught, "Couldn't load this business brief."));
    } finally {
      if (gate.current.isCurrent(token)) {
        setSettledTenantId(activeTenantId);
        setLoading(false);
      }
    }
  }, [acceptContext, activeTenantId]);

  useEffect(() => {
    const activeGate = gate.current;
    void load();
    return () => activeGate.clear();
  }, [load]);

  const canEditCurrentTenant = accessScope !== "read_only"
    && Boolean(activeTenantId)
    && resolvedTenantId === activeTenantId;
  const tenantResolved = Boolean(activeTenantId) && resolvedTenantId === activeTenantId;
  const tenantSettled = Boolean(activeTenantId) && settledTenantId === activeTenantId;

  const save = useCallback(async (
    next: SoloSetupBrief,
    nextOwners: SoloBusinessOwner[],
    proposalId: string | null,
  ): Promise<SoloSetupSaveResult> => {
    const tenantAtStart = activeTenantId;
    if (!tenantAtStart) return { ok: false, kind: "failed", error: "No active workspace." };
    if (!canEditCurrentTenant) {
      return { ok: false, kind: "failed", error: "This workspace has not resolved safely for editing." };
    }
    const epoch = ++saveEpoch.current;
    setSaving(true);
    try {
      // One transaction writes the general brief, protected legal overlay, and
      // business ownership records, then returns the canonical stored readback.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: saveError } = await (supabase as any).rpc("save_solo_setup_context", {
        _brief: next,
        _business_owners: nextOwners,
        _expected_updated_at: brief.updatedAt ?? null,
        _proposal_id: proposalId,
      });
      if (saveError) throw saveError;
      if (epoch !== saveEpoch.current || activeTenantRef.current !== tenantAtStart) {
        return { ok: false, kind: "stale", error: "The account changed before this save response returned. Its result was not shown here." };
      }
      const row = (Array.isArray(data) ? data[0] : data) as ContextRow | null;
      if (!row) throw new Error("The save completed without a readable workspace record.");
      acceptContext(row, tenantAtStart);
      const storedBrief = cleanSoloSetupBrief(row.brief, row.tenantName ?? "");
      const storedOwners = cleanSoloBusinessOwners(row.businessOwners);
      // Fire-and-forget: Systems Check re-reads the fields this save just wrote (§18/§13 — see
      // rescanBusinessContext's own header). Never awaited, never allowed to affect this result.
      rescanBusinessContext();
      return { ok: true, kind: "saved", brief: storedBrief, businessOwners: storedOwners };
    } catch (caught) {
      if (epoch !== saveEpoch.current || activeTenantRef.current !== tenantAtStart) {
        return { ok: false, kind: "stale", error: "The account changed before this save response returned. Its result was not shown here." };
      }
      return {
        ok: false,
        kind: isConflict(caught) ? "conflict" : "failed",
        error: errorMessage(caught, "Couldn't save your business brief."),
      };
    } finally {
      if (epoch === saveEpoch.current) setSaving(false);
    }
  }, [acceptContext, activeTenantId, brief.updatedAt, canEditCurrentTenant]);

  const dismissProposal = useCallback(async (proposalId: string) => {
    if (!canEditCurrentTenant) return { ok: false, error: "This workspace has not resolved safely for editing." };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: dismissError } = await (supabase as any).rpc("dismiss_solo_business_brief_proposal", { _proposal_id: proposalId });
      if (dismissError) throw dismissError;
      setPendingProposal(null);
      return { ok: true };
    } catch (caught) {
      return { ok: false, error: errorMessage(caught, "Couldn't dismiss this suggestion.") };
    }
  }, [canEditCurrentTenant]);

  return {
    loading: loading || people.loading || !tenantSettled,
    error: tenantSettled ? error : null,
    saving,
    accessScope,
    canEdit: canEditCurrentTenant,
    canEditLegal: accessScope === "owner_full" && canEditCurrentTenant,
    activeTenantId,
    resolvedTenantId,
    brief: tenantResolved ? brief : cleanSoloSetupBrief(null),
    businessOwners: tenantResolved ? businessOwners : [],
    representatives: tenantResolved ? people.people.filter((person) => person.status === "Active") : [],
    representativesLoading: people.loading,
    representativesError: people.error,
    managedSendingEmail,
    primaryBusinessEmail,
    pendingProposal,
    save,
    dismissProposal,
    refresh: load,
  };
}
