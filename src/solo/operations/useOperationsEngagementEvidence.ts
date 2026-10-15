import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createSettingsRequestGate } from "@/solo/settings-contract";
import { normalizeEngagementRead } from "./operations-engagement-read";
import type { EngagementEvidence } from "./operations-engagement-readiness";

type State = { scope: string | null; evidence: EngagementEvidence | null; loading: boolean;
  error: string | null; forbidden: boolean };
/** Single selected Sales-source read. No handoff, commercial write or client acceptance. */
export function useOperationsEngagementEvidence(actorId: string | null, tenantId: string | null,
  agreementId: string | null) {
  const scope = actorId && tenantId && agreementId ? JSON.stringify([actorId, tenantId, agreementId]) : null;
  const gate = useRef(createSettingsRequestGate());
  const [state, setState] = useState<State>({ scope: null, evidence: null, loading: false, error: null, forbidden: false });
  const refresh = useCallback(async () => {
    const token = gate.current.begin();
    setState({ scope, evidence: null, loading: Boolean(scope), error: null, forbidden: false });
    if (!scope || !actorId || !tenantId || !agreementId) return null;
    try {
      const before = await supabase.auth.getUser();
      if (!gate.current.isCurrent(token)) return null;
      if (before.error || before.data.user?.id !== actorId) throw new Error("OPERATIONS_ENGAGEMENT_SCOPE_CHANGED");
      const reader = supabase as unknown as { rpc(name: string, args: Record<string, unknown>):
        PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> };
      const { data, error } = await reader.rpc("operations_engagement_evidence_read", {
        p_expected_actor_id: actorId, p_expected_tenant_id: tenantId, p_agreement_id: agreementId });
      const after = await supabase.auth.getUser();
      if (!gate.current.isCurrent(token)) return null;
      if (after.error || after.data.user?.id !== actorId) throw new Error("OPERATIONS_ENGAGEMENT_SCOPE_CHANGED");
      if (error) throw new Error(error.code === "42501" ? "OPERATIONS_ENGAGEMENT_FORBIDDEN" : "OPERATIONS_ENGAGEMENT_READ_UNAVAILABLE");
      const evidence = normalizeEngagementRead(data, actorId, tenantId, agreementId);
      if (!evidence) throw new Error("OPERATIONS_ENGAGEMENT_READ_UNAVAILABLE");
      setState({ scope, evidence, loading: false, error: null, forbidden: false });
      return evidence;
    } catch (error) {
      if (!gate.current.isCurrent(token)) return null;
      const forbidden = error instanceof Error && /OPERATIONS_ENGAGEMENT_(FORBIDDEN|SCOPE_CHANGED)/.test(error.message);
      setState({ scope, evidence: null, loading: false, forbidden, error: forbidden
        ? "This agreement isn’t available in this account or workspace."
        : "The agreement evidence couldn’t be loaded. Try again." });
      return null;
    }
  }, [scope, actorId, tenantId, agreementId]);
  useEffect(() => { void refresh(); const current = gate.current; return () => current.clear(); }, [refresh]);
  const visible = scope !== null && state.scope === scope;
  return { evidence: visible ? state.evidence : null, loading: scope !== null && (!visible || state.loading),
    error: visible ? state.error : null, forbidden: visible && state.forbidden, refresh };
}
