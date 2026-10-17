import { useEffect, useState, useCallback, useId, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";

export interface ApprovalQueueRow {
  id: string;
  type: string;
  category: string | null;
  status: string;
  priority: number | null;
  risk_level: string | null;
  summary: string | null;
  source: string | null;
  requires_role: string | null;
  tenant_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  assigned_to_user_id: string | null;
  submitted_by_user_id: string | null;
  sla_due_at: string | null;
  created_at: string;
  // Additive queue column: absent on the old view during rolling deployment.
  // Native decisions require the actual returned version and never invent it.
  updated_at?: string;
  reviewed_at: string | null;
  sent_at: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb draft payload, arbitrary shape (pre-existing; typed loosely by consumers)
  draft_content: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb metadata, arbitrary shape (pre-existing; typed loosely by consumers)
  metadata: any;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_email: string | null;
  contact_lifecycle_stage: string | null;
  age_seconds: number;
  sla_state: "overdue" | "due_soon" | "on_track" | "closed" | "unscheduled";
}

/** Presentation routing only. The native RLS predicate and decision/execution
 * writers validate the stored immutable companion; client shape grants nothing. */
export function isNativeOwnerTaskApproval(a: ApprovalQueueRow): boolean {
  const object=(v: unknown):v is Record<string,unknown>=>!!v && typeof v==="object" && !Array.isArray(v);
  const uuid=(v: unknown)=>typeof v==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  return a.source==="paige_orchestration" && a.type==="other" && a.category==="owner.task" && uuid(a.id) && uuid(a.tenant_id)
    && object(a.draft_content) && a.draft_content.capability==="owner.task" && object(a.draft_content.args)
    && object(a.metadata) && a.metadata.source==="paige_orchestration" && a.metadata.capability_id==="owner.task"
    && ["event_id","act_id","act_execution_id","automation_id"].every(k=>uuid(a.metadata[k]));
}

// Back-compat alias kept so old call sites keep working.
export type PendingApproval = ApprovalQueueRow & {
  created_by_n8n_workflow_key: string | null;
};

export function usePendingApprovals(opts?: { scope?: "all" | "mine"; contactId?: string }) {
  const [items, setItems] = useState<ApprovalQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acceptedTenantId, setAcceptedTenantId] = useState<string | null | undefined>(undefined);
  const requestEpoch = useRef(0);
  // §9 defense-in-depth: scope every read to the tenant the operator is CURRENTLY
  // viewing. The base-table RLS (RESTRICTIVE tenant_isolation) + the queue view's
  // security_invoker are the authoritative gate; this explicit filter is belt-and-
  // suspenders so a multi-tenant admin never sees another tenant's queue even if the
  // view drifts again (the #55 leak was exactly a view that had lost security_invoker
  // and bypassed RLS as its postgres owner). At the God tier (activeTenantId === null)
  // NO tenant filter is applied — a platform owner's is_platform_owner() RLS branch
  // legitimately spans all tenants, mirroring useCommsSummary's model. Threading it
  // through the dep arrays ALSO makes a tenant SWITCH invalidate + refetch this hook:
  // it is a manual useState/useEffect hook, so queryClient.invalidateQueries() (fired
  // by TenantProvider.switchTenant) does NOT reach it — without activeTenantId in the
  // deps the previous tenant's list would linger until the next realtime event.
  const { activeTenantId } = useTenantContext();
  // Unique per hook instance so two consumers with the same scope/contactId
  // (e.g. AdminLayout + the Your Paige command center, both scope:"all") never
  // share a realtime channel topic. Supabase dedupes channels by topic and hands
  // the 2nd caller the already-subscribed channel — its .on("postgres_changes")
  // then throws "cannot add callbacks after subscribe()", crashing the workspace.
  const instanceId = useId();

  const refresh = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setError(null);
    let q = supabase
      .from("paige_approval_queue_v")
      .select("*")
      .eq("status", "pending")
      .order("priority", { ascending: true, nullsFirst: false })
      .order("sla_due_at", { ascending: true, nullsFirst: false })
      .limit(300);

    // Only scope when a workspace is active. null === God tier → no filter (see above).
    if (activeTenantId) q = q.eq("tenant_id", activeTenantId);
    if (opts?.contactId) q = q.eq("contact_id", opts.contactId);
    if (opts?.scope === "mine") {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) q = q.eq("assigned_to_user_id", user.id);
    }

    const { data, error: readError } = await q;
    if (epoch !== requestEpoch.current) return;
    if (readError) {
      setItems([]);
      setError(readError.message);
      setAcceptedTenantId(activeTenantId);
      setLoading(false);
      return;
    }
    setItems((data as ApprovalQueueRow[] | null) ?? []);
    setAcceptedTenantId(activeTenantId);
    setLoading(false);
  }, [opts?.scope, opts?.contactId, activeTenantId]);

  useEffect(() => {
    requestEpoch.current += 1;
    setItems([]);
    setError(null);
    setLoading(true);
    refresh();
    const channel = supabase
      .channel(`paige_approvals_${opts?.scope ?? "all"}_${opts?.contactId ?? "any"}_${activeTenantId ?? "god"}_${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "paige_pending_approvals" },
        () => { refresh(); },
      )
      .subscribe();
    return () => { requestEpoch.current += 1; supabase.removeChannel(channel); };
  }, [refresh, opts?.scope, opts?.contactId, activeTenantId, instanceId]);

  const scopeMatches = acceptedTenantId === activeTenantId;
  return {
    items: scopeMatches ? items : [],
    loading: scopeMatches ? loading : true,
    error: scopeMatches ? error : null,
    refresh,
  };
}

