import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyPlanError } from "@/lib/planning";

/**
 * Reads the Planning hub's data from the plan_list RPC — the same tenant- and
 * caller-scoped view Paige's tools write to (§10, the UI is one caller). Returns
 * plans (with nested items) and loose_items (standalone reminders/tasks Paige
 * set with no parent plan). Manual state + refresh, matching the repo's
 * data-hook idiom (useMyActions).
 */

export type PlanItemType = "milestone" | "task" | "reminder";
export type PlanItemStatus = "open" | "in_progress" | "done" | "cancelled" | "blocked";
export type PlanPriority = "low" | "normal" | "high" | "urgent";

export interface PlanItem {
  id: string;
  tenant_id: string;
  plan_id: string | null;
  item_type: PlanItemType;
  assigned_to_user_id: string | null;
  contact_id: string | null;
  title: string;
  summary: string | null;
  status: PlanItemStatus;
  priority: PlanPriority;
  due_at: string | null;
  remind_at: string | null;
  remind_target: string | null;
  reminded_at: string | null;
  created_by: string | null;
  linked_action_id: string | null;
  /** Canonical row version; absent versions are inspect-only in Operations. */
  updated_at?: string;
}

export interface Plan {
  id: string;
  tenant_id: string;
  title: string;
  summary: string | null;
  horizon: string;
  scope: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  owner_user_id: string | null;
  created_by: string | null;
  items: PlanItem[];
}

export type PlanScope = "mine" | "by_me" | "team";

export interface UsePlanListOpts {
  /** 'mine' → assigned to me; 'by_me' → I created, assigned to someone else;
   * 'team' → everything visible (staff). */
  scope?: PlanScope;
  from?: string; // ISO date
  to?: string;   // ISO date
  status?: string;
  /** Only items for this client (the contact-record Tasks tab). */
  contactId?: string;
  /** Treat from/to as ITEM due/remind dates (the calendar range read) rather
   * than plan-window dates. */
  byItemDate?: boolean;
  enabled?: boolean;
  /**
   * Authenticated tenant epoch. The RPC still derives authority server-side;
   * this key only clears client residue and rejects late responses after a switch.
   */
  tenantScopeKey?: string | null;
}

export interface UsePlanListResult {
  plans: Plan[];
  looseItems: PlanItem[];
  /** Every item across plans + loose, flattened — the working set for buckets. */
  allItems: PlanItem[];
  loading: boolean;
  error: string | null;
  /** True when the caller has no access to planning (e.g. a client, whom the
   * RPC refuses) — the UI shows a graceful state instead of a raw error. */
  forbidden: boolean;
  userId: string | null;
  /** Refetch. Pass { silent: true } after a single-row mutation so the whole
   * hub doesn't flash to skeletons. */
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
}

export function usePlanList(opts: UsePlanListOpts = {}): UsePlanListResult {
  const { scope = "mine", from, to, status, contactId, byItemDate, enabled = true, tenantScopeKey } = opts;
  const [plans, setPlans] = useState<Plan[]>([]);
  const [looseItems, setLooseItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = ++requestSeq.current;
    if (!enabled || tenantScopeKey === null) {
      setPlans([]);
      setLooseItems([]);
      setUserId(null);
      setError(null);
      setForbidden(false);
      setLoading(false);
      return;
    }
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (seq !== requestSeq.current) return;
      const uid = user?.id ?? null;
      setUserId(uid);

      const params: Record<string, unknown> = {
        p_from: from ?? null,
        p_to: to ?? null,
        p_status: status ?? null,
        p_limit: 200,
        p_contact_id: contactId ?? null,
        p_by_item_date: byItemDate ?? false,
      };
      // 'mine' pins to the caller; 'team'/'by_me' fetch the full visible set and
      // filter client-side (plan_list has no created_by filter yet).
      if (scope === "mine" && uid) params.p_assigned_to_user_id = uid;

      const { data, error: rpcErr } = await supabase.rpc("plan_list", params);
      if (seq !== requestSeq.current) return;
      if (rpcErr) throw rpcErr;

      const payload = (data ?? {}) as { plans?: Plan[]; loose_items?: PlanItem[] };
      let nextPlans = Array.isArray(payload.plans) ? payload.plans : [];
      let nextLoose = Array.isArray(payload.loose_items) ? payload.loose_items : [];

      if (scope === "by_me" && uid) {
        const mineByMe = (i: PlanItem) => i.created_by === uid && i.assigned_to_user_id !== uid;
        nextLoose = nextLoose.filter(mineByMe);
        nextPlans = nextPlans
          .map((p) => ({ ...p, items: (p.items ?? []).filter(mineByMe) }))
          .filter((p) => p.items.length > 0 || p.owner_user_id === uid || p.created_by === uid);
      }

      setPlans(nextPlans.map((p) => ({ ...p, items: p.items ?? [] })));
      setLooseItems(nextLoose);
      setForbidden(false);
    } catch (e: unknown) {
      if (seq !== requestSeq.current) return;
      const raw = e instanceof Error ? e.message : String(e ?? "");
      // A client (non-member) is refused by the RPC — that's a graceful "not
      // available here" state, not an error banner with an internal code.
      setForbidden(raw.includes("PLAN_FORBIDDEN") || raw.includes("PLAN_NO_TENANT"));
      setError(friendlyPlanError(raw));
      setPlans([]);
      setLooseItems([]);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [enabled, scope, from, to, status, contactId, byItemDate, tenantScopeKey]);

  useEffect(() => {
    requestSeq.current += 1;
    setPlans([]);
    setLooseItems([]);
    setUserId(null);
    setError(null);
    setForbidden(false);
  }, [tenantScopeKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const allItems = [
    ...looseItems,
    ...plans.flatMap((p) => p.items),
  ];

  return { plans, looseItems, allItems, loading, error, forbidden, userId, refresh };
}
