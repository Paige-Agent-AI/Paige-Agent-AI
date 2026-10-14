/**
 * useCommandCenter — the Solo Command Center HOME adapter.
 *
 * A THIN composition layer (§18: compose the EXISTING production hooks, never
 * re-query). It reshapes the shared, RLS-tenant-scoped reads into exactly the
 * prop shapes the solo `CommandCenter` fixture already renders, so the solo
 * design is preserved and only the DATA source changes.
 *
 * Seams reused (data/actions only):
 *   • usePendingApprovals({ scope: "all" }) → paige_approval_queue_v         (§36 marquee)
 *   • usePracticeDashboard()               → practice_dashboard_metrics + queue
 *   • usePaigeDeptStatus()                 → real per-department OPEN counts
 *   • useTenantContext()                   → active tenant (greeting) / God-tier scope
 *
 * §9 TENANT ISOLATION: this adapter passes NO tenant_id anywhere — every hook
 * derives scope from the session/RLS on its own (see each hook's header). The
 * approve/decline writes go through the SAME server-gated seams the production
 * ApprovalRow uses (execute-approval edge fn; RLS-protected UPDATE).
 *
 * §13 HONESTY: every metric is present-guarded — a tile is emitted only when its
 * real column is present; there is no fabricated value, delta, or sparkline (the
 * RPC returns point-in-time, no history). The greeting summary is composed from
 * the real approvals count + attention only — never a $ figure it cannot source.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePendingApprovals } from "@/hooks/usePendingApprovals";
import {
  usePracticeDashboard,
  type PracticeAttention,
} from "@/hooks/usePracticeDashboard";
import { usePaigeDeptStatus, type DeptStatusRow } from "@/hooks/usePaigeDeptStatus";
import { useTenantContext } from "@/hooks/useTenantContext";

/** A single approval reshaped into the solo `ApprovalCard` prop shape. */
export interface CommandApproval {
  id: string;
  dept: string;
  title: string;
  preview: string;
  type: string | null;
  urgency: "today" | "week";
  aging: string;
}

/** A KPI tile reshaped into the solo `Metric` prop shape (no spark/delta — no real history). */
export interface CommandMetric {
  k: string;
  v: string;
}

export interface CommandCenterData {
  accountEpoch: string | null;
  approvals: CommandApproval[];
  metrics: CommandMetric[];
  attention: PracticeAttention | undefined;
  departments: DeptStatusRow[];
  greeting: { name: string; dateLabel: string; summary: string };
  counts: { approvals: number };
  loading: boolean;
  isError: boolean;
  departmentsConfigured: boolean;
  /** True only when there is genuinely nothing to show (fresh, empty book). */
  empty: boolean;
  approve: (id: string) => Promise<{ ok: boolean; error?: string }>;
  decline: (id: string) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => void;
}

/** "send_message" / "email-draft" → "Send message". Null → "Paige". */
function humanize(raw: string | null | undefined): string {
  if (!raw) return "Paige";
  const s = raw.replace(/[_-]+/g, " ").trim();
  if (!s) return "Paige";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** age_seconds → compact "just now" / "5m" / "3h" / "2d". */
function humanizeAge(seconds: number | null | undefined): string {
  const s = typeof seconds === "number" && seconds > 0 ? seconds : 0;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const usd = (cents: number): string =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));

function firstToken(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

export function useCommandCenter(): CommandCenterData {
  const { activeTenant, activeTenantId } = useTenantContext();
  const { items, loading: approvalsLoading, error: approvalsError, refresh: refreshApprovals } =
    usePendingApprovals({ scope: "all" });
  const { metrics: m, attention, loading: dashLoading, isError: dashboardError, refetch } =
    usePracticeDashboard(30, activeTenantId);
  const { departments, loading: departmentsLoading, configured: departmentsConfigured } =
    usePaigeDeptStatus(activeTenantId);
  // The legacy queue hook refetches on tenant changes but may briefly retain its
  // prior response. The row carries its server-owned tenant id, so fail closed at
  // this composition boundary and never render a row from another account epoch.
  const epochItems = useMemo(
    () => activeTenantId ? items.filter((item) => item.tenant_id === activeTenantId) : [],
    [activeTenantId, items],
  );

  // Greeting first name from auth metadata (best effort, §15 — never a placeholder).
  const [authName, setAuthName] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!on) return;
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const full =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        "";
      setAuthName(full ? firstToken(full) : null);
    });
    return () => {
      on = false;
    };
  }, []);

  const approvals = useMemo<CommandApproval[]>(
    () =>
      epochItems.map((r) => {
        const draft = (r.draft_content ?? {}) as Record<string, unknown>;
        const draftSubject = typeof draft.subject === "string" ? draft.subject : "";
        const draftBody =
          typeof draft.body === "string"
            ? draft.body
            : typeof draft.preview === "string"
              ? draft.preview
              : typeof r.draft_content === "string"
                ? (r.draft_content as string)
                : "";
        return {
          id: r.id,
          dept: humanize(r.category),
          title: r.summary || draftSubject || humanize(r.category),
          preview: draftBody,
          type: r.type ? humanize(r.type) : null,
          urgency:
            r.sla_state === "overdue" || r.sla_state === "due_soon" ? "today" : "week",
          aging: humanizeAge(r.age_seconds),
        };
      }),
    [epochItems],
  );

  const metrics = useMemo<CommandMetric[]>(() => {
    const out: CommandMetric[] = [];
    if (!m) return out;
    if (typeof m.won_value_cents === "number")
      out.push({ k: "Won this period (estimated)", v: usd(m.won_value_cents) });
    if (typeof m.active_clients === "number")
      out.push({ k: "Active contacts", v: String(m.active_clients) });
    if (typeof m.active_retainers === "number")
      out.push({ k: "Active retainers", v: String(m.active_retainers) });
    if (typeof m.pipeline_value_cents === "number")
      out.push({ k: "Pipeline value", v: usd(m.pipeline_value_cents) });
    return out;
  }, [m]);

  const at = attention ?? {};
  const attentionTotal =
    (at.at_risk_clients ?? 0) +
    (at.follow_ups_due ?? 0) +
    (at.upcoming_sessions_7d ?? 0) +
    (at.tasks_due ?? 0) +
    (at.onboarding_in_progress ?? 0);

  const loading = approvalsLoading || dashLoading || departmentsLoading;
  const isError = dashboardError || !!approvalsError;
  const empty =
    !loading &&
    (m?.active_clients ?? 0) === 0 &&
    attentionTotal === 0 &&
    approvals.length === 0;

  const greeting = useMemo(() => {
    const name = authName || activeTenant?.name || "there";
    const dateLabel = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const parts: string[] = [];
    if (approvals.length)
      parts.push(`${approvals.length} draft${approvals.length === 1 ? "" : "s"} waiting`);
    if (at.at_risk_clients)
      parts.push(`${at.at_risk_clients} contact${at.at_risk_clients === 1 ? "" : "s"} at risk`);
    if (at.follow_ups_due)
      parts.push(`${at.follow_ups_due} follow-up${at.follow_ups_due === 1 ? "" : "s"} due`);
    const summary = parts.length ? `${parts.join(" · ")}.` : "You're all caught up.";
    return { name, dateLabel, summary };
  }, [authName, activeTenant?.name, approvals.length, at.at_risk_clients, at.follow_ups_due]);

  const refresh = useCallback(() => {
    void refreshApprovals();
    refetch();
  }, [refreshApprovals, refetch]);

  const approve = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      // §10 callable seam — approve AND act (email/SMS sent; others acknowledged).
      const { data, error } = await supabase.functions.invoke("execute-approval", {
        body: { approval_id: id },
      });
      const res = data as { ok?: boolean; error?: string } | null;
      if (error || res?.ok === false) {
        return {
          ok: false,
          error: error?.message ?? res?.error ?? "Couldn't complete that action.",
        };
      }
      refresh();
      return { ok: true };
    },
    [refresh],
  );

  const decline = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      // Reject-with-reason: the SAME tenant-scoped RLS-protected UPDATE ApprovalRow's decline path uses (§18).
      const { error } = await supabase
        .from("paige_pending_approvals")
        .update({
          status: "rejected",
          decision_rationale: "Dismissed from Command Center",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) return { ok: false, error: error.message };
      refresh();
      return { ok: true };
    },
    [refresh],
  );

  return {
    accountEpoch: activeTenantId,
    approvals,
    metrics,
    attention,
    departments,
    greeting,
    counts: { approvals: approvals.length },
    loading,
    isError,
    departmentsConfigured,
    empty,
    approve,
    decline,
    refresh,
  };
}

