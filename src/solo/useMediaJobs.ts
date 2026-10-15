// useMediaJobs — the real data hook behind the canonical Vibe Studio.
//
// The ONE client of the paige-media edge seam: capabilities truth, the job list
// (RLS tenant-scoped read + realtime), asset previews for finished jobs (the
// marketing_content library — the one asset home), and the governed actions
// (submit / approve / decline / cancel). No provider is ever called from the
// browser; every estimate, budget decision, and approval boundary lives
// server-side in the seam.
//
// Approval (v2b, owner ruling 2026-10-04 — "Requester approves, any admin can
// decline"): a job awaiting approval carries a server-issued proposal addressed
// to the person who asked. The seam hands its fingerprint to that person only;
// approving echoes it back in the request body. Everyone else sees who asked and
// can decline.
//
// Truth rules (AGENTS.md): job states render exactly what the seam reports —
// "succeeded" appears only when the server marked it, needs_config/budget
// denials surface the server's own explanation, and nothing here fabricates
// progress, cost, or capability.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";

export interface MediaModelInfo {
  id: string;
  label: string;
  mode: "image" | "image_edit" | "video";
  tier: "standard" | "premium";
  estCostPerUnitUsd: number;
  unit: "image" | "second";
}

export interface MediaCapabilities {
  providers: Array<{
    provider: string;
    execution: "async" | "sync";
    configured: boolean;
    models: MediaModelInfo[];
    license: { licenseClass: string; commercialUse: string; disclosure: string };
    retention: { policy: string; copyDeadline: string };
  }>;
  music: { available: boolean; status: string; note: string };
  video: {
    available: boolean;
    enabled: boolean;
    provider_configured: boolean;
    provider_ceiling_set: boolean;
    completed_today: number;
    daily_limit: number;
    note: string;
  };
  budget: {
    ceiling_set: boolean;
    ceiling_usd: number | null;
    accrued_today_usd: number | null;
    draft_allowance_usd: number;
    platform_spend_ceiling_usd?: number;
  };
  credits?: {
    readable: boolean;
    reason?: string;
    credit_usd?: number;
    allowance_monthly?: number;
    included_remaining?: number;
    purchased_remaining?: number;
    total_remaining?: number;
    month?: string | null;
    consumed_this_month?: number;
    allowance_pct_used?: number | null;
    notice_band?: 50 | 80 | 100 | null;
  };
  packs?: Array<{ id: string; priceUsd: number; credits: number; label: string }>;
}

/** What the seam says this viewer may do with a pending approval. The fingerprint is the requester's only. */
export interface MediaApprovalInfo {
  requested_by_you: boolean;
  requester_name: string | null;
  fingerprint?: string;
  expires_at?: string;
  summary?: string;
}

/** The approval as the surfaces read it. `requestedByYou` is null only until we know who is looking. */
export interface MediaApprovalState {
  requestedByYou: boolean | null;
  requesterName: string | null;
}

export interface MediaJob {
  id: string;
  actor_id?: string | null;
  mode: string;
  provider: string;
  model: string;
  params: Record<string, unknown> | null;
  state: string;
  approval_state: string;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  error: string | null;
  content_id: string | null;
  video_seconds: number | null;
  created_at: string;
  completed_at: string | null;
  approval?: MediaApprovalInfo;
}

export interface MediaAsset {
  id: string;
  kind: string;
  title: string;
  image_url: string | null;
  meta: Record<string, unknown> | null;
}

// String-literal discriminant (not boolean): this repo compiles non-strict
// (strictNullChecks off), where boolean-literal discrimination does not narrow.

/**
 * Denial bodies (403/429/400 — video-off, daily cap, budget exceeded, unknown
 * model) live on FunctionsHttpError.context (the Response), not on the generic
 * "Function returned an error" message — the connectError.ts:164 house pattern.
 */
async function functionsErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: { json?: () => Promise<unknown> } })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = (await context.json()) as { error?: unknown } | null;
      if (body && typeof body.error === "string") return body.error;
    } catch {
      // fall through to the generic message
    }
  }
  return error instanceof Error ? error.message : "The request failed.";
}

export type SubmitOutcome =
  | { status: "ok"; job: MediaJob; awaitingApproval?: boolean }
  | { status: "error"; message: string; needsConfig?: boolean; needsCeiling?: boolean; budgetDenied?: boolean; limitReached?: boolean };

const isJobRow = (v: unknown): v is MediaJob =>
  !!v && typeof v === "object" && typeof (v as MediaJob).id === "string";

export function useMediaJobs() {
  const { activeTenantId } = useTenantContext();
  const [capabilities, setCapabilities] = useState<MediaCapabilities | null>(null);
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [assets, setAssets] = useState<Record<string, MediaAsset>>({});
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Record<string, MediaApprovalInfo>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const tenantRef = useRef<string | null>(null);
  tenantRef.current = activeTenantId ?? null;

  const invoke = useCallback(async <T,>(action: string, payload: Record<string, unknown> = {}): Promise<T | null> => {
    const { data, error } = await supabase.functions.invoke<T>("paige-media", {
      body: { action, ...payload },
    });
    if (error) throw new Error(await functionsErrorMessage(error));
    return data;
  }, []);

  const refreshCapabilities = useCallback(async () => {
    try {
      const data = await invoke<MediaCapabilities>("capabilities");
      if (data) setCapabilities(data);
    } catch {
      setCapabilities(null);
    }
  }, [invoke]);

  const refreshJobs = useCallback(async () => {
    const tenant = tenantRef.current;
    if (!tenant) return;
    const { data, error } = await supabase
      .from("paige_media_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (!error && data) setJobs(data as MediaJob[]);
  }, []);

  // Who is looking, so the requester's own approvals read as theirs even before the seam answers.
  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => { if (alive) setUserId(data?.user?.id ?? null); }, () => {});
    return () => { alive = false; };
  }, []);

  // The approval facts come from the seam (the job rows are read under RLS and carry none): for
  // the requester, the fingerprint the Approve control echoes back; for anyone else, who asked.
  const refreshApprovals = useCallback(async () => {
    try {
      const data = await invoke<{ jobs?: MediaJob[] }>("list", { limit: 30 });
      const next: Record<string, MediaApprovalInfo> = {};
      for (const j of data?.jobs ?? []) if (j.approval) next[j.id] = j.approval;
      setApprovals(next);
    } catch {
      // The surfaces fall back to who-asked from the row; Approve fetches its fingerprint itself.
    }
  }, [invoke]);
  const pendingKey = useMemo(
    () => jobs.filter((j) => j.state === "blocked" && j.approval_state === "pending").map((j) => j.id).sort().join(","),
    [jobs],
  );
  useEffect(() => {
    if (pendingKey) void refreshApprovals();
  }, [pendingKey, refreshApprovals]);

  const approvalFor = useCallback((job: MediaJob): MediaApprovalState => {
    const info = approvals[job.id] ?? job.approval;
    if (info) return { requestedByYou: info.requested_by_you, requesterName: info.requester_name ?? null };
    if (userId && job.actor_id) return { requestedByYou: job.actor_id === userId, requesterName: null };
    return { requestedByYou: null, requesterName: null };
  }, [approvals, userId]);

  // Resolve finished-job asset previews from the ONE library (RLS-scoped read).
  const refreshAssets = useCallback(async (current: MediaJob[]) => {
    const ids = current
      .filter((j) => j.state === "succeeded" && j.content_id)
      .map((j) => j.content_id as string)
      .filter((id) => id && !assets[id]);
    if (!ids.length) return;
    const { data, error } = await supabase
      .from("marketing_content")
      .select("id, kind, title, image_url, meta")
      .in("id", ids);
    if (!error && data) {
      setAssets((prev) => {
        const next = { ...prev };
        for (const row of data as MediaAsset[]) next[row.id] = row;
        return next;
      });
    }
  }, [assets]);

  // Initial load + realtime. While any job is in flight, a 10s poll backstops
  // realtime (the sweeper advances states server-side with the service role).
  useEffect(() => {
    if (!activeTenantId) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      await Promise.all([refreshCapabilities(), refreshJobs()]);
      if (alive) setLoading(false);
    })();
    const channel = supabase
      .channel(`paige-media-jobs-${activeTenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "paige_media_jobs" },
        () => {
          if (alive) void refreshJobs();
        },
      )
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [activeTenantId, refreshCapabilities, refreshJobs]);

  useEffect(() => {
    if (!jobs.length) return;
    void refreshAssets(jobs);
  }, [jobs, refreshAssets]);

  const inFlight = useMemo(
    () => jobs.some((j) => ["created", "blocked", "submitted", "processing", "outcome_unknown", "expired"].includes(j.state)),
    [jobs],
  );

  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void refreshJobs(), 10_000);
    return () => clearInterval(t);
  }, [inFlight, refreshJobs]);

  const submit = useCallback(
    async (input: {
      prompt: string;
      model: string;
      aspectRatio?: string;
      videoSeconds?: number;
      referenceContentIds?: string[];
      requestId: string;
    }): Promise<SubmitOutcome> => {
      setActionError(null);
      try {
        const data = await invoke<{ job?: MediaJob; awaiting_approval?: boolean; approval?: MediaApprovalInfo | null; error?: string; needs_config?: boolean; needs_ceiling?: boolean; budget_denied?: boolean; limit_reached?: boolean }>("submit", {
          prompt: input.prompt,
          model: input.model,
          aspect_ratio: input.aspectRatio,
          video_seconds: input.videoSeconds,
          reference_content_ids: input.referenceContentIds,
          request_id: input.requestId,
        });
        if (!data?.job || data.error) {
          return {
            status: "error",
            message: data?.error ?? "The job couldn't be created.",
            needsConfig: data?.needs_config,
            needsCeiling: data?.needs_ceiling,
            budgetDenied: data?.budget_denied,
            limitReached: data?.limit_reached,
          };
        }
        if (data.approval) {
          const approval = data.approval;
          const jobId = data.job.id;
          setApprovals((prev) => ({ ...prev, [jobId]: approval }));
        }
        void refreshJobs();
        void refreshCapabilities();
        return { status: "ok", job: data.job, awaitingApproval: data.awaiting_approval };
      } catch (e) {
        const message = e instanceof Error ? e.message : "The request failed.";
        setActionError(message);
        return { status: "error", message };
      }
    },
    [invoke, refreshCapabilities, refreshJobs],
  );

  // Approve sends the server-issued fingerprint back — the one proof the seam accepts. If this
  // view has not got it yet (a reload, a job Paige started in chat), it asks the seam for it first.
  const approve = useCallback(
    async (jobId: string): Promise<boolean> => {
      setActionError(null);
      try {
        let fingerprint = approvals[jobId]?.fingerprint;
        if (!fingerprint) {
          const status = await invoke<{ approval?: MediaApprovalInfo }>("status", { job_id: jobId });
          if (status?.approval) {
            const approval = status.approval;
            setApprovals((prev) => ({ ...prev, [jobId]: approval }));
          }
          fingerprint = status?.approval?.fingerprint;
        }
        if (!fingerprint) {
          setActionError("This approval isn't ready yet. Try again in a moment.");
          return false;
        }
        await invoke("approve", { job_id: jobId, approved_fingerprint: fingerprint });
        void refreshJobs();
        void refreshCapabilities();
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "The approval failed.");
        void refreshApprovals();
        return false;
      }
    },
    [approvals, invoke, refreshApprovals, refreshCapabilities, refreshJobs],
  );

  const decline = useCallback(
    async (jobId: string): Promise<boolean> => {
      setActionError(null);
      try {
        await invoke("reject", { job_id: jobId });
        void refreshJobs();
        void refreshCapabilities();
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "The decline failed.");
        return false;
      }
    },
    [invoke, refreshCapabilities, refreshJobs],
  );

  const decide = useCallback(
    (jobId: string, yes: boolean): Promise<boolean> => (yes ? approve(jobId) : decline(jobId)),
    [approve, decline],
  );

  const cancel = useCallback(
    async (jobId: string): Promise<boolean> => {
      setActionError(null);
      try {
        await invoke("cancel", { job_id: jobId });
        void refreshJobs();
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "The cancellation failed.");
        return false;
      }
    },
    [invoke, refreshJobs],
  );

  return { capabilities, jobs, assets, loading, actionError, submit, approve, decline, decide, approvalFor, cancel, refreshCapabilities, isJobRow };
}
