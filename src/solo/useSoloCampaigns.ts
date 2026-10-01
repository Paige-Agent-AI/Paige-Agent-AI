import { useCallback, useEffect, useRef, useState } from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";

export type CampaignRecord = {
  id: string;
  name: string;
  status: string;
  activeCount: number | null;
  completedCount: number | null;
  lastActivityAt: string | null;
};

export type CampaignArtifact = {
  id: string;
  type: "page" | "funnel" | "form";
  name: string;
  slug: string;
  status: string;
  updatedAt: string;
  publicHref: string;
  recentSubmissions: number;
  routingConfigured: boolean;
  routingState:
    | "No route"
    | "Draft route"
    | "Approval-gated"
    | "Human-only"
    | "Approval-gated + human-only"
    | "Active + approval-gated"
    | "Active + human-only"
    | "Active + approval-gated + human-only"
    | "Active";
  routingTargets: string[];
  recentDispatches: { succeeded: number; failed: number; other: number };
  dispatchStatuses: Record<string, number>;
};

export type CampaignSubmission = {
  id: string;
  formId: string;
  source: string;
  state: string;
  createdAt: string;
  contactId: string | null;
  dealId: string | null;
};

export type SoloCampaignsState = {
  tenantId: string | null;
  phase: "resolving" | "loading" | "ready" | "error" | "unavailable";
  campaigns: CampaignRecord[];
  artifacts: CampaignArtifact[];
  submissions: CampaignSubmission[];
  pipelineWorkspace: PipelineWorkspace;
  pipelineAction: (action: PipelineAction) => Promise<{
    ok: boolean;
    message: string;
    data?: Record<string, unknown>;
  }>;
  retry: () => void;
};

export type StageType = "open" | "won" | "lost";
export type PipelineStage = {
  id: string;
  pipelineId: string;
  label: string;
  description: string;
  orderIndex: number;
  archivedAt: string | null;
  movePolicy: "direct" | "approval";
  stageType: StageType;
  version: number;
};
export type PipelineAutomationRule = {
  id: string;
  pipelineId: string;
  fromStageId: string | null;
  toStageId: string;
  composeIntent: string;
  sendMode: "draft_for_review" | "auto_send";
  isActive: boolean;
};
export type PipelineOutcome = {
  id: string;
  outcomeType:
    "won" | "lost" | "not_fit" | "closed_without_decision" | "reopened";
  reason: string | null;
  notes: string | null;
  outcomeDate: string;
  createdAt: string;
  createdThrough: string;
};
export type PipelineDeal = {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  clientId: string | null;
  clientName: string;
  owner: string;
  status: string;
  source: string;
  nextAction: string;
  tags: string[];
  notes: string;
  createdAt: string;
  actualCloseDate: string | null;
  lostReason: string | null;
  outcomes: PipelineOutcome[];
  updatedAt: string;
  version: number;
  history: { summary: string; createdAt: string }[];
};
export type PipelineFolder = {
  id: string;
  name: string;
  lifecycleStatus: "active" | "archived";
  version: number;
  pipelineCount: number;
};
export type PipelineRecord = {
  id: string;
  shortRef: string;
  folderId: string | null;
  folderName: string | null;
  name: string;
  description: string;
  isDefault: boolean;
  lifecycleStatus: "draft" | "active" | "archived";
  version: number;
  createdAt: string;
  updatedAt: string;
  createdThrough:
    "owner" | "team_member" | "paige" | "approved_automation" | null;
  createdByName: string | null;
  requestedByName: string | null;
  stageCount: number;
  dealCount: number;
};
export type PipelineWorkspace = {
  canManage: boolean;
  canArchiveFolders: boolean;
  canDelete?: boolean;
  folders: PipelineFolder[];
  pipelines: PipelineRecord[];
  stages: PipelineStage[];
  deals: PipelineDeal[];
  automationRules: PipelineAutomationRule[];
};
export type PipelineStageDraft = {
  label: string;
  description: string;
  movePolicy: "direct" | "approval";
  stageType?: StageType;
};
type CommandBase = { idempotencyKey?: string; automationReviewed?: boolean };
export type PipelineAction =
  | (CommandBase & {
      type: "delete-empty-pipeline";
      pipelineId: string;
      pipelineRef: string;
      expectedVersion: number;
      expectedStageCount: number;
    })
  | (CommandBase & {
      type: "create-pipeline";
      name: string;
      description: string;
      stages: PipelineStageDraft[];
    })
  | (CommandBase & {
      type: "update-pipeline";
      pipelineId: string;
      name: string;
      description: string;
      expectedVersion: number;
    })
  | (CommandBase & {
      type: "archive-pipeline";
      pipelineId: string;
      pipelineRef: string;
      confirmedReference: string;
      expectedVersion: number;
    })
  | (CommandBase & {
      type: "activate-pipeline" | "restore-pipeline";
      pipelineId: string;
      expectedVersion: number;
    })
  | (CommandBase & {
      type: "create-stage";
      pipelineId: string;
      label: string;
      description: string;
      movePolicy: "direct" | "approval";
      stageType?: StageType;
      expectedVersion: number;
    })
  | (CommandBase & {
      type: "update-stage";
      stageId: string;
      label: string;
      description: string;
      movePolicy: "direct" | "approval";
      stageType?: StageType;
      expectedVersion: number;
    })
  | (CommandBase & {
      type: "archive-stage" | "restore-stage";
      stageId: string;
      expectedVersion: number;
    })
  | (CommandBase & {
      type: "reorder-stages";
      pipelineId: string;
      orderedIds: string[];
      expectedVersion: number;
    })
  | (CommandBase & {
      type: "create-deal";
      pipelineId: string;
      stageId: string;
      title: string;
      clientId?: string | null;
      tags: string[];
      notes?: string;
    })
  | (CommandBase & {
      type: "update-deal";
      dealId: string;
      expectedVersion: number;
      title: string;
      tags: string[];
      notes: string;
    })
  | (CommandBase & {
      type: "move-deal";
      dealId: string;
      targetStageId: string;
      expectedVersion: number;
      reason?: string;
    })
  | (CommandBase & {
      type: "record-outcome";
      dealId: string;
      expectedVersion: number;
      outcomeType: "won" | "lost" | "not_fit" | "closed_without_decision";
      reason?: string;
      notes?: string;
      outcomeDate: string;
      targetStageId?: string;
    })
  | (CommandBase & {
      type: "reopen-deal";
      dealId: string;
      expectedVersion: number;
      targetStageId: string;
    })
  | (CommandBase & { type: "create-folder"; name: string })
  | (CommandBase & {
      type: "rename-folder";
      folderId: string;
      name: string;
      expectedVersion: number;
    })
  | (CommandBase & {
      type: "archive-folder";
      folderId: string;
      confirmedName: string;
      expectedVersion: number;
    })
  | (CommandBase & {
      type: "restore-folder";
      folderId: string;
      expectedVersion: number;
    })
  | (CommandBase & {
      type: "move-pipeline-to-folder";
      pipelineId: string;
      pipelineRef: string;
      folderId: string | null;
      expectedVersion: number;
    });

type PageRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  updated_at: string;
};
type FunnelRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  updated_at: string;
};
type FormRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  updated_at: string;
};
type SubmissionRow = {
  id: string;
  form_id: string;
  source: string;
  processing_state: string;
  created_at: string;
  contact_id: string | null;
  deal_id: string | null;
};
type RoutingEvidenceRow = {
  id: string;
  form_id: string;
  target_slug: string;
  enabled: boolean;
  effective_autonomy_lane: "auto" | "confirm" | "off";
  dispatch_statuses: Record<string, number> | null;
};
type RoutingEvidencePayload = { routes?: RoutingEvidenceRow[] };
type PipelineWorkspacePayload = {
  can_manage?: boolean;
  can_archive_folders?: boolean;
  can_delete?: boolean;
  folders?: {
    id: string;
    name: string;
    lifecycle_status?: "active" | "archived";
    version?: number;
    pipeline_count?: number;
  }[];
  pipelines?: {
    id: string;
    short_ref: string;
    folder_id?: string | null;
    folder_name?: string | null;
    name: string;
    description?: string | null;
    is_default?: boolean;
    lifecycle_status?: "draft" | "active" | "archived";
    version?: number;
    created_at: string;
    updated_at: string;
    created_through?:
      "owner" | "team_member" | "paige" | "approved_automation" | null;
    created_by_name?: string | null;
    requested_by_name?: string | null;
    stage_count?: number;
    deal_count?: number;
  }[];
  stages?: {
    id: string;
    pipeline_id: string;
    label: string;
    description?: string | null;
    order_index: number;
    archived_at?: string | null;
    move_policy?: "direct" | "approval";
    stage_type?: StageType;
    version?: number;
  }[];
  automation_rules?: {
    id: string;
    pipeline_id: string;
    from_stage_id?: string | null;
    to_stage_id: string;
    compose_intent: string;
    send_mode: "draft_for_review" | "auto_send";
    is_active: boolean;
  }[];
  deals?: {
    id: string;
    title: string;
    pipeline_id: string;
    stage_id: string;
    client_id?: string | null;
    client_name?: string | null;
    owner_user_id?: string | null;
    status?: string | null;
    source?: string | null;
    next_action?: string | null;
    tags?: string[];
    notes?: string | null;
    created_at?: string;
    actual_close_date?: string | null;
    lost_reason?: string | null;
    outcomes?: {
      id: string;
      outcome_type:
        "won" | "lost" | "not_fit" | "closed_without_decision" | "reopened";
      reason?: string | null;
      notes?: string | null;
      outcome_date: string;
      created_at: string;
      created_through?: string;
    }[];
    updated_at: string;
    version?: number;
    history?: { summary: string; createdAt: string }[];
  }[];
};

const emptyPipeline: PipelineWorkspace = {
  canManage: false,
  canArchiveFolders: false,
  folders: [],
  pipelines: [],
  stages: [],
  deals: [],
  automationRules: [],
};
const empty = {
  campaigns: [],
  artifacts: [],
  submissions: [],
  pipelineWorkspace: emptyPipeline,
};

export function useSoloCampaigns(): SoloCampaignsState {
  const { activeTenantId, activeTenant, accountContextLoading } =
    useTenantContext();
  const deletionContext = useRef({
    tenantId: activeTenantId,
    loading: accountContextLoading,
  });
  if (
    deletionContext.current.tenantId !== activeTenantId ||
    deletionContext.current.loading !== accountContextLoading
  ) {
    deletionContext.current = {
      tenantId: activeTenantId,
      loading: accountContextLoading,
    };
  }
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<
    Omit<SoloCampaignsState, "retry" | "pipelineAction">
  >({
    tenantId: activeTenantId ?? null,
    phase: accountContextLoading ? "resolving" : "loading",
    ...empty,
  });
  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);
  const pipelineAction = useCallback(
    async (action: PipelineAction) => {
      if (!activeTenantId)
        return { ok: false, message: "No tenant workspace is selected." };
      if (action.type === "delete-empty-pipeline") {
        const context = deletionContext.current;
        if (context.tenantId !== activeTenantId || context.loading)
          return {
            ok: false,
            message: "Workspace changed. Reopen the pipeline before deleting.",
          };
        const { data, error } = await supabase.rpc(
          "delete_empty_pipeline" as never,
          {
            _expected_tenant_id: activeTenantId,
            _pipeline_id: action.pipelineId,
            _pipeline_ref: action.pipelineRef,
            _expected_version: action.expectedVersion,
            _expected_stage_count: action.expectedStageCount,
            _idempotency_key: action.idempotencyKey ?? crypto.randomUUID(),
          } as never,
        );
        if (context !== deletionContext.current)
          return {
            ok: false,
            message:
              "Workspace changed. Reopen the pipeline list to check the result.",
          };
        if (error) {
          const detail = String(error.message || "");
          const message = /FORBIDDEN|OWNER|TENANT|CONTEXT/.test(detail)
            ? "Deletion is not allowed for this workspace and role. Nothing was deleted."
            : /VERSION|STALE|STAGE_COUNT|REFERENCE|NOT_FOUND/.test(detail)
              ? "This pipeline changed or is no longer available. Reload and review its exact reference before trying again."
              : "Deletion could not be confirmed. Retry the same request safely, or reload the pipeline list to check its current state.";
          return { ok: false, message };
        }
        const payload = (data ?? {}) as Record<string, unknown>;
        // The tenant-keyed workspace refreshes after it owns the success transition.
        return {
          ok: payload.ok === true,
          message:
            typeof payload.message === "string"
              ? payload.message
              : "Deletion was not confirmed. Reload the pipeline list.",
          data: payload,
        };
      }
      const context = deletionContext.current;
      if (context.tenantId !== activeTenantId || context.loading)
        return {
          ok: false,
          message: "Workspace changed. Reopen Pipeline before saving.",
        };
      const { idempotencyKey, ...command } = action;
      // Owner-board mutations enter the canonical human wrapper. PAIGE deal movement
      // remains behind its service-only governed executor; both share stage/outcome policy.
      // Pipeline never creates a second approval queue.
      const name = "configure_tenant_pipeline";
      const args = {
        _tenant_id: activeTenantId,
        _command: command,
        _idempotency_key: idempotencyKey ?? crypto.randomUUID(),
        _actor_kind: "human",
      };
      const { data, error } = await supabase.rpc(name as never, args as never);
      if (context !== deletionContext.current)
        return {
          ok: false,
          message:
            "Workspace changed. Reopen Pipeline to confirm the current result.",
        };
      if (error) {
        console.error("[solo-pipeline] action failed", {
          action: action.type,
          error,
        });
        const detail = String(error.message || "");
        const message = detail.includes("PIPELINE_VERSION_CONFLICT")
          ? "This record changed somewhere else. The board was refreshed; review the current stage before trying again."
          : detail.includes("PIPELINE_FOLDER_NAME_CONFLICT")
            ? "A folder with that name already exists in this workspace."
            : detail.includes("PIPELINE_FOLDER_CONFIRMATION_MISMATCH")
              ? "That folder name does not match the selected folder. Nothing was archived."
              : detail.includes("PIPELINE_FOLDER_TENANT_MISMATCH") ||
                  detail.includes("PIPELINE_FOLDER_FORBIDDEN")
                ? "That folder or pipeline is not available to this workspace and role."
                : detail.includes("PIPELINE_ARCHIVE_REFERENCE_REQUIRED")
                  ? "Enter the selected pipeline reference before archiving."
                  : detail.includes("PIPELINE_ARCHIVE_REFERENCE_MISMATCH") ||
                      detail.includes("PIPELINE_ARCHIVE_CONFIRMATION_MISMATCH")
                    ? "That reference does not match the selected pipeline. Nothing was archived."
                    : detail.includes("PIPELINE_DEPENDENCIES_UNRESOLVED")
                      ? "Delete is blocked until its deals, routes, approvals, automations, and retained history are resolved."
                      : detail.includes("PIPELINE_APPROVAL_REQUIRED")
                        ? "Approval is required through the existing governed PAIGE path. The deal stayed put; no separate approval request was created."
                        : // A raised token with no line here falls through to the generic sentence below, which tells
                          // the person nothing about why the save was refused (§36/§70). The server raises this one
                          // rather than coercing a bad value to "open", precisely so the refusal is visible — that is
                          // wasted if the reason never reaches the screen.
                          detail.includes(
                              "PIPELINE_AUTOMATION_REVIEW_REQUIRED",
                            ) ||
                            detail.includes(
                              "PIPELINE_AUTOMATION_BINDING_REQUIRED",
                            )
                          ? "Review the sourced stage automation impact before applying this change."
                          : detail.includes("PIPELINE_STAGE_TYPE_INVALID")
                            ? "A stage can only be active work, won, or lost. Nothing was changed."
                            : detail.includes(
                                  "PIPELINE_OUTCOME_REASON_REQUIRED",
                                )
                              ? "Add a reason before recording this outcome."
                              : detail.includes(
                                    "PIPELINE_OUTCOME_STAGE_MISMATCH",
                                  )
                                ? "That closing stage does not match the selected outcome."
                                : detail.includes(
                                      "PIPELINE_OPEN_STAGE_REQUIRED",
                                    )
                                  ? "Choose an active-work stage first."
                                  : detail.includes(
                                        "PIPELINE_TENANT_MISMATCH",
                                      ) || detail.includes("PIPELINE_FORBIDDEN")
                                    ? "That change is not allowed in this workspace and role."
                                    : "That change could not be saved. Nothing else was changed.";
        return { ok: false, message };
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      if (payload.ok !== true)
        return {
          ok: false,
          message:
            typeof payload.message === "string"
              ? payload.message
              : "The server did not confirm this change. Nothing is being claimed as saved.",
        };
      setRefreshKey((key) => key + 1);
      const dependencyText =
        payload.dependencies && typeof payload.dependencies === "object"
          ? Object.entries(payload.dependencies as Record<string, unknown>)
              .map(([key, value]) => `${key}: ${value}`)
              .join(" · ")
          : "";
      const message = `${typeof payload.message === "string" ? payload.message : "Saved to this tenant’s pipeline."}${dependencyText ? ` ${dependencyText}` : ""}`;
      return { ok: true, message, data: payload };
    },
    [activeTenantId],
  );

  useEffect(() => {
    let current = true;
    if (accountContextLoading) {
      setState({
        tenantId: activeTenantId ?? null,
        phase: "resolving",
        ...empty,
      });
      return () => {
        current = false;
      };
    }
    if (!activeTenantId) {
      setState({ tenantId: null, phase: "unavailable", ...empty });
      return () => {
        current = false;
      };
    }

    setState((previous) =>
      previous.tenantId === activeTenantId && previous.phase === "ready"
        ? previous
        : { tenantId: activeTenantId, phase: "loading", ...empty },
    );
    void (async () => {
      try {
        const [
          pageResponse,
          funnelResponse,
          formResponse,
          submissionResponse,
          routingResponse,
          pipelineResponse,
        ] = await Promise.all([
          supabase
            .from("growth_pages")
            .select("id,slug,title,status,updated_at")
            .eq("tenant_id", activeTenantId)
            .order("updated_at", { ascending: false }),
          supabase
            .from("growth_funnels")
            .select("id,slug,name,status,updated_at")
            .eq("tenant_id", activeTenantId)
            .order("updated_at", { ascending: false }),
          supabase
            .from("growth_forms")
            .select("id,slug,name,status,updated_at")
            .eq("tenant_id", activeTenantId)
            .order("updated_at", { ascending: false }),
          supabase
            .from("growth_form_submissions")
            .select(
              "id,form_id,source,processing_state,created_at,contact_id,deal_id",
            )
            .eq("tenant_id", activeTenantId)
            .order("created_at", { ascending: false })
            .limit(200),
          supabase.rpc(
            "get_pipeline_routing_evidence" as never,
            { _tenant_id: activeTenantId } as never,
          ),
          supabase.rpc(
            "get_pipeline_workspace" as never,
            { _tenant_id: activeTenantId } as never,
          ),
        ]);
        const firstError = [
          pageResponse.error,
          funnelResponse.error,
          formResponse.error,
          submissionResponse.error,
          routingResponse.error,
          pipelineResponse.error,
        ].find(Boolean);
        if (firstError) throw firstError;
        if (!current) return;

        // The existing tenant-campaigns bridge is not tenant-authorized upstream,
        // so Solo deliberately does not call it. Keep Overview unavailable until
        // a server-derived, tenant-scoped all-state contract exists.
        const campaigns: CampaignRecord[] = [];
        const pages = (pageResponse.data ?? []) as PageRow[];
        const funnels = (funnelResponse.data ?? []) as FunnelRow[];
        const forms = (formResponse.data ?? []) as FormRow[];
        const submissions = (
          (submissionResponse.data ?? []) as SubmissionRow[]
        ).map((row) => ({
          id: row.id,
          formId: row.form_id,
          source: row.source || "Unspecified",
          state: row.processing_state,
          createdAt: row.created_at,
          contactId: row.contact_id,
          dealId: row.deal_id,
        }));
        const submissionCounts = submissions.reduce<Record<string, number>>(
          (counts, row) => {
            counts[row.formId] = (counts[row.formId] ?? 0) + 1;
            return counts;
          },
          {},
        );
        const routingPayload = (routingResponse.data ??
          {}) as unknown as RoutingEvidencePayload;
        const automations = routingPayload.routes ?? [];
        const automationsByForm = automations.reduce<
          Record<string, RoutingEvidenceRow[]>
        >((groups, row) => {
          (groups[row.form_id] ??= []).push(row);
          return groups;
        }, {});
        const routingEvidence = (formId: string) => {
          const configured = automationsByForm[formId] ?? [];
          const enabled = configured.filter((automation) => automation.enabled);
          const dispatchStatuses = configured.reduce<Record<string, number>>(
            (counts, automation) => {
              Object.entries(automation.dispatch_statuses ?? {}).forEach(
                ([status, count]) => {
                  counts[status] = (counts[status] ?? 0) + count;
                },
              );
              return counts;
            },
            {},
          );
          const approvalGated = enabled.some(
            (automation) => automation.effective_autonomy_lane === "confirm",
          );
          const humanOnly = enabled.some(
            (automation) => automation.effective_autonomy_lane === "off",
          );
          const active = enabled.some(
            (automation) => automation.effective_autonomy_lane === "auto",
          );
          return {
            routingConfigured: configured.length > 0,
            routingState:
              configured.length === 0
                ? ("No route" as const)
                : enabled.length === 0
                  ? ("Draft route" as const)
                  : active && approvalGated && humanOnly
                    ? ("Active + approval-gated + human-only" as const)
                    : active && approvalGated
                      ? ("Active + approval-gated" as const)
                      : active && humanOnly
                        ? ("Active + human-only" as const)
                        : approvalGated && humanOnly
                          ? ("Approval-gated + human-only" as const)
                          : approvalGated
                            ? ("Approval-gated" as const)
                            : humanOnly
                              ? ("Human-only" as const)
                              : ("Active" as const),
            routingTargets: [...new Set(enabled.map((row) => row.target_slug))],
            dispatchStatuses,
            recentDispatches: Object.entries(dispatchStatuses).reduce(
              (counts, [status, count]) => {
                if (["succeeded", "success", "completed"].includes(status))
                  counts.succeeded += count;
                else if (["failed", "error"].includes(status))
                  counts.failed += count;
                else counts.other += count;
                return counts;
              },
              { succeeded: 0, failed: 0, other: 0 },
            ),
          };
        };
        const tenantSlug = activeTenant?.slug ?? "";
        const rawPipeline = (pipelineResponse.data ??
          {}) as unknown as PipelineWorkspacePayload;
        const pipelineWorkspace: PipelineWorkspace = {
          canManage: rawPipeline.can_manage === true,
          canArchiveFolders: rawPipeline.can_archive_folders === true,
          canDelete: rawPipeline.can_delete === true,
          folders: (rawPipeline.folders ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            lifecycleStatus: row.lifecycle_status ?? "active",
            version: row.version ?? 1,
            pipelineCount: row.pipeline_count ?? 0,
          })),
          pipelines: (rawPipeline.pipelines ?? []).map((row) => ({
            id: row.id,
            shortRef: row.short_ref,
            folderId: row.folder_id ?? null,
            folderName: row.folder_name ?? null,
            name: row.name,
            description: row.description ?? "",
            isDefault: row.is_default === true,
            lifecycleStatus: row.lifecycle_status ?? "active",
            version: row.version ?? 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            createdThrough: row.created_through ?? null,
            createdByName: row.created_by_name ?? null,
            requestedByName: row.requested_by_name ?? null,
            stageCount: row.stage_count ?? 0,
            dealCount: row.deal_count ?? 0,
          })),
          stages: (rawPipeline.stages ?? []).map((row) => ({
            id: row.id,
            pipelineId: row.pipeline_id,
            label: row.label,
            description: row.description ?? "",
            orderIndex: row.order_index,
            archivedAt: row.archived_at ?? null,
            movePolicy: row.move_policy ?? "direct",
            stageType: row.stage_type ?? "open",
            version: row.version ?? 1,
          })),
          automationRules: (rawPipeline.automation_rules ?? []).map((row) => ({
            id: row.id,
            pipelineId: row.pipeline_id,
            fromStageId: row.from_stage_id ?? null,
            toStageId: row.to_stage_id,
            composeIntent: row.compose_intent,
            sendMode: row.send_mode,
            isActive: row.is_active,
          })),
          deals: (rawPipeline.deals ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            pipelineId: row.pipeline_id,
            stageId: row.stage_id,
            clientId: row.client_id ?? null,
            clientName: row.client_name || "Client not recorded",
            owner: row.owner_user_id ? "Assigned owner" : "Owner not recorded",
            status: row.status || "Not recorded",
            source: row.source || "Source not recorded",
            nextAction: row.next_action || "Next action not recorded",
            tags: row.tags ?? [],
            notes: row.notes ?? "",
            createdAt: row.created_at ?? row.updated_at,
            actualCloseDate: row.actual_close_date ?? null,
            lostReason: row.lost_reason ?? null,
            outcomes: (row.outcomes ?? []).map((outcome) => ({
              id: outcome.id,
              outcomeType: outcome.outcome_type,
              reason: outcome.reason ?? null,
              notes: outcome.notes ?? null,
              outcomeDate: outcome.outcome_date,
              createdAt: outcome.created_at,
              createdThrough: outcome.created_through ?? "Not recorded",
            })),
            updatedAt: row.updated_at,
            version: row.version ?? 1,
            history: row.history ?? [],
          })),
        };
        const artifacts: CampaignArtifact[] = [
          ...pages
            .filter((row) => row.status === "published")
            .map((row) => ({
              id: row.id,
              type: "page" as const,
              name: row.title,
              slug: row.slug,
              status: row.status,
              updatedAt: row.updated_at,
              publicHref: tenantSlug ? `/p/${tenantSlug}/${row.slug}` : "",
              recentSubmissions: 0,
              routingConfigured: false,
              routingState: "No route" as const,
              routingTargets: [],
              recentDispatches: { succeeded: 0, failed: 0, other: 0 },
              dispatchStatuses: {},
            })),
          ...funnels
            .filter((row) => row.status === "active")
            .map((row) => ({
              id: row.id,
              type: "funnel" as const,
              name: row.name,
              slug: row.slug,
              status: row.status,
              updatedAt: row.updated_at,
              publicHref: tenantSlug ? `/f/${tenantSlug}/${row.slug}` : "",
              recentSubmissions: 0,
              routingConfigured: false,
              routingState: "No route" as const,
              routingTargets: [],
              recentDispatches: { succeeded: 0, failed: 0, other: 0 },
              dispatchStatuses: {},
            })),
          ...forms
            .filter((row) => row.status === "active")
            .map((row) => ({
              id: row.id,
              type: "form" as const,
              name: row.name,
              slug: row.slug,
              status: row.status,
              updatedAt: row.updated_at,
              publicHref: `/form/${row.id}`,
              recentSubmissions: submissionCounts[row.id] ?? 0,
              ...routingEvidence(row.id),
            })),
        ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setState({
          tenantId: activeTenantId,
          phase: "ready",
          campaigns,
          artifacts,
          submissions,
          pipelineWorkspace,
        });
      } catch (error) {
        console.error("[solo-campaigns] read failed", error);
        if (current)
          setState((previous) =>
            previous.tenantId === activeTenantId && previous.phase === "ready"
              ? previous
              : { tenantId: activeTenantId, phase: "error", ...empty },
          );
      }
    })();
    return () => {
      current = false;
    };
  }, [accountContextLoading, activeTenantId, activeTenant?.slug, refreshKey]);

  // Realtime pipeline board: one tenant-keyed subscription over the records the canonical
  // load already reads. Events and (re)subscriptions resolve through `retry()` — a full
  // reload of current truth under whatever tenant is active — so there is no second cache
  // to drift, stale events cannot overwrite fresher state, and a late event from a previous
  // workspace can only cause a refetch scoped to the current one. The effect re-runs on
  // tenant change: the old channel is removed before a new one is opened.
  useEffect(() => {
    if (!activeTenantId || accountContextLoading) return;
    let disposed = false;
    // Coalesce event bursts: one bulk write over N deals fires N change events, and each must not
    // trigger its own full reload. A short trailing window collapses a burst into one reload of
    // current truth.
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleReload = () => {
      if (disposed) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { if (!disposed) retry(); }, 200);
    };
    const channel = supabase
      .channel(`solo-pipeline-board:${activeTenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deals", filter: `tenant_id=eq.${activeTenantId}` },
        () => scheduleReload(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pipelines", filter: `tenant_id=eq.${activeTenantId}` },
        () => scheduleReload(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pipeline_stages", filter: `tenant_id=eq.${activeTenantId}` },
        () => scheduleReload(),
      )
      .subscribe((status) => {
        // A channel that (re)connects refetches once: recovery reads current truth instead
        // of trusting the state left from before the disconnect.
        if (status === "SUBSCRIBED" && !disposed) scheduleReload();
      });
    return () => {
      disposed = true;
      clearTimeout(reloadTimer);
      supabase.removeChannel(channel);
    };
  }, [activeTenantId, accountContextLoading, retry]);

  const synchronousTenantId = activeTenantId ?? null;
  const visibleState =
    state.tenantId === synchronousTenantId
      ? state
      : {
          tenantId: synchronousTenantId,
          phase: accountContextLoading
            ? ("resolving" as const)
            : synchronousTenantId
              ? ("loading" as const)
              : ("unavailable" as const),
          ...empty,
        };
  return { ...visibleState, retry, pipelineAction };
}
