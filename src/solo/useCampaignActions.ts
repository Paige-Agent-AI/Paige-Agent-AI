// Campaigns: the steps that carry each campaign out (INT-298 MBC slices 5–6). Reads and writes Marketing
// Actions through their governed RPCs (contract: docs/delivery/marketing-action-contract.md):
// `get_campaign_brief_actions` for every campaign's steps with the lifecycle the server derives from the
// action bus, and `configure_campaign_brief_actions` to plan, remove, record a result or judge it.
//
// TRUTH BOUNDARY (§13/§70). The lifecycle is the server's, never inferred here. A step is "done" only when a
// run or an approval stands behind it; one marked done with neither reads as recorded and takes no result.
// A write is reported done only after the re-read shows it; a write the read cannot confirm says so.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ActionLifecycle =
  | "planned" | "prepared" | "approval_required" | "approved" | "scheduled" | "executing" | "unknown"
  | "completed" | "recorded" | "failed" | "blocked" | "stopped" | "outcome_observed" | "evaluated";
export type ActionFamily = "email" | "social" | "page" | "form" | "funnel" | "content" | "ads" | "event" | "outreach" | "sales_handoff" | "other";
export type Verdict = "met" | "partly_met" | "not_met";

export type CampaignAction = {
  readonly briefId: string;
  readonly actionId: string;
  readonly tactic: string;
  readonly family: ActionFamily;
  readonly lifecycle: ActionLifecycle;
  /** Null when this viewer may not read the action itself (a member). */
  readonly title: string | null;
  readonly summary: string | null;
  readonly kindLabel: string | null;
  readonly lane: string | null;
  readonly department: string | null;
  readonly dueAt: string | null;
  readonly waitingOnDependency: boolean;
  readonly expected: { readonly summary: string; readonly metricKey: string | null; readonly target: number | null } | null;
  readonly observed: { readonly summary: string; readonly metricKey: string | null; readonly value: number | null } | null;
  readonly observedThrough: "human" | "paige" | null;
  readonly verdict: Verdict | null;
  readonly verdictNote: string | null;
  readonly basis: "workflow_run" | "approval" | "recorded" | null;
  readonly createdThrough: "human" | "paige" | null;
};

export type PlanInput = { title: string; tactic: string; family: ActionFamily; dueAt?: string | null; expected?: string | null };
type Result = { ok: boolean; message: string };

export type CampaignActionsState = {
  readonly phase: "loading" | "ready" | "error";
  readonly canManage: boolean;
  readonly actions: readonly CampaignAction[];
  readonly retry: () => void;
  readonly plan: (briefId: string, input: PlanInput) => Promise<Result>;
  readonly remove: (briefId: string, actionId: string) => Promise<Result>;
  readonly recordOutcome: (briefId: string, actionId: string, summary: string, value: number | null) => Promise<Result>;
  readonly evaluate: (briefId: string, actionId: string, verdict: Verdict, note: string | null) => Promise<Result>;
};

const LIFECYCLES: readonly ActionLifecycle[] = ["planned", "prepared", "approval_required", "approved", "scheduled", "executing", "unknown", "completed", "recorded", "failed", "blocked", "stopped", "outcome_observed", "evaluated"];
export const FAMILIES: readonly ActionFamily[] = ["email", "social", "page", "form", "funnel", "content", "ads", "event", "outreach", "sales_handoff", "other"];
const VERDICTS: readonly Verdict[] = ["met", "partly_met", "not_met"];
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const pick = <T extends string>(value: unknown, list: readonly T[]): T | null => (typeof value === "string" && (list as readonly string[]).includes(value) ? value as T : null);

// How a family and a state read to a person. The dossier and PAIGE say the same words.
export const FAMILY_LABEL: Record<ActionFamily, string> = {
  email: "Email", social: "Social", page: "Page", form: "Form", funnel: "Funnel", content: "Content", ads: "Ads",
  event: "Event", outreach: "Outreach", sales_handoff: "Sales handoff", other: "Other",
};
export const LIFECYCLE_LABEL: Record<ActionLifecycle, string> = {
  planned: "Planned", prepared: "Prepared", approval_required: "Waiting for your approval", approved: "Approved",
  scheduled: "Scheduled", executing: "Running", unknown: "Result unknown", completed: "Done",
  recorded: "Marked done, nothing shows it ran", failed: "Failed", blocked: "Blocked", stopped: "Stopped",
  outcome_observed: "Result recorded", evaluated: "Judged",
};
export const VERDICT_LABEL: Record<Verdict, string> = { met: "Met", partly_met: "Partly met", not_met: "Not met" };
/** The campaign state class a lifecycle draws with (the desk's existing palette; never gold, §11). */
export function lifecycleTone(action: Pick<CampaignAction, "lifecycle" | "verdict">): string {
  switch (action.lifecycle) {
    case "completed": case "outcome_observed": return "st-ready";
    case "evaluated": return action.verdict === "met" ? "st-ready" : action.verdict === "not_met" ? "st-blocked" : "st-await";
    case "approval_required": case "unknown": return "st-await";
    case "failed": case "blocked": return "st-blocked";
    case "prepared": case "approved": case "scheduled": case "executing": return "st-partial";
    case "recorded": case "stopped": return "st-unavail";
    default: return "st-planned";
  }
}
/** What a finish rests on, in words. Null while the step has not finished. */
export function basisLine(basis: CampaignAction["basis"]): string | null {
  if (basis === "workflow_run") return "Done by the run it started.";
  if (basis === "approval") return "Finished on your approval, which records the step. Nothing was sent or published.";
  if (basis === "recorded") return "Marked done with no run or approval behind it, so it takes no result.";
  return null;
}
/** Results can be recorded only over a proven finish or a failure; judged only once recorded. */
export const canRecordOutcome = (action: CampaignAction) => action.lifecycle === "completed" || action.lifecycle === "failed";
export const canEvaluate = (action: CampaignAction) => action.lifecycle === "outcome_observed";

// pg-token parity: every token the writer raises reads as a sentence a person can act on.
export function actionMessageFor(detail: string): string {
  const has = (token: string) => detail.includes(token);
  if (has("CAMPAIGN_ACTION_NOT_PROVEN")) return "That step was marked done without a run or an approval, so there's no result to record. Nothing was changed.";
  if (has("CAMPAIGN_ACTION_NOT_FINISHED")) return "That step hasn't finished yet, so there's no result to record. Nothing was changed.";
  if (has("CAMPAIGN_ACTION_NO_OUTCOME")) return "Record what happened before judging it. Nothing was changed.";
  if (has("CAMPAIGN_ACTION_ALREADY_EVALUATED")) return "That result has already been judged, so it stays as it is.";
  if (has("CAMPAIGN_ACTION_BUS_REFUSED")) return "The action list didn't accept this step from your account. Nothing was planned.";
  if (has("CAMPAIGN_ACTION_IN_OTHER_CAMPAIGN")) return "That step already belongs to another campaign. Nothing was changed.";
  if (has("CAMPAIGN_ACTION_NOT_LINKED") || has("CAMPAIGN_ACTION_NOT_FOUND")) return "That step is no longer part of this campaign. Reload to see the latest.";
  if (has("CAMPAIGN_BRIEF_NOT_FOUND")) return "That campaign is no longer available in this workspace. Nothing was changed.";
  if (has("CAMPAIGN_BRIEF_FORBIDDEN")) return "Only owners and admins can change a campaign's steps, and the server refused the change.";
  if (has("CAMPAIGN_ACTION_TACTIC_INVALID")) return "Give the step a tactic (up to 120 characters). Nothing was saved.";
  if (has("CAMPAIGN_ACTION_TITLE_INVALID")) return "Give the step a name (up to 200 characters). Nothing was saved.";
  if (has("CAMPAIGN_ACTION_RESULT_INVALID")) return "Describe the result in up to 500 characters; a figure must be a number. Nothing was saved.";
  if (has("CAMPAIGN_BRIEF_IDEMPOTENCY_CONFLICT")) return "That change was already recorded with different details. Reload and try again.";
  return "That change could not be saved. Nothing else was changed.";
}

type ActionRow = Record<string, unknown> & { evidence?: Record<string, unknown>; approval?: Record<string, unknown>; owner?: Record<string, unknown> };
export function readActions(data: unknown): Pick<CampaignActionsState, "canManage" | "actions"> {
  const payload = (data ?? {}) as { can_manage?: unknown; actions?: unknown };
  const actions = (Array.isArray(payload.actions) ? payload.actions as ActionRow[] : []).flatMap((row) => {
    const lifecycle = pick(row?.lifecycle, LIFECYCLES);
    const family = pick(row?.family, FAMILIES);
    if (!lifecycle || !family || !str(row.brief_id) || !str(row.action_id) || !str(row.tactic)) return [];
    const expected = row.expected_result as Record<string, unknown> | null;
    const observed = row.observed_result as Record<string, unknown> | null;
    const evaluation = row.evaluation as Record<string, unknown> | null;
    return [{
      briefId: String(row.brief_id), actionId: String(row.action_id), tactic: String(row.tactic), family, lifecycle,
      title: str(row.title), summary: str(row.summary), kindLabel: str(row.kind_label),
      lane: str(row.approval?.lane), department: str(row.owner?.department), dueAt: str(row.due_at),
      waitingOnDependency: row.waiting_on_dependency === true,
      expected: expected && str(expected.summary) ? { summary: String(expected.summary), metricKey: str(expected.metric_key), target: num(expected.target) } : null,
      // The server already withholds a result over an unproven step; the screen never shows one there either.
      observed: observed && str(observed.summary) && lifecycle !== "recorded" ? { summary: String(observed.summary), metricKey: str(observed.metric_key), value: num(observed.value) } : null,
      observedThrough: pick(row.observed_through, ["human", "paige"] as const),
      verdict: lifecycle === "evaluated" ? pick(evaluation?.verdict, VERDICTS) : null,
      verdictNote: lifecycle === "evaluated" ? str(evaluation?.note) : null,
      basis: pick(row.evidence?.basis, ["workflow_run", "approval", "recorded"] as const),
      createdThrough: pick(row.created_through, ["human", "paige"] as const),
    }];
  });
  return { canManage: payload.can_manage === true, actions };
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args);

/** One campaign's steps (or, with no brief, the workspace's). Read only where it is shown: the open dossier. */
export function useCampaignActions(tenantId: string | null, briefId: string | null = null): CampaignActionsState {
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<Pick<CampaignActionsState, "phase" | "canManage" | "actions">>({ phase: "loading", canManage: false, actions: [] });
  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);

  const read = useCallback(async () => {
    const { data, error } = await rpc("get_campaign_brief_actions", { _tenant_id: tenantId, _brief_id: briefId });
    if (error) throw new Error(error.message ?? "read failed");
    return readActions(data);
  }, [tenantId, briefId]);

  useEffect(() => {
    if (!tenantId) return;
    let live = true;
    setState((current) => ({ ...current, phase: "loading" }));
    read().then((next) => { if (live) setState({ phase: "ready", ...next }); }, (error) => {
      if (!live) return;
      console.error("[campaign-actions] read failed", error);
      setState({ phase: "error", canManage: false, actions: [] });
    });
    return () => { live = false; };
  }, [tenantId, refreshKey, read]);

  // Every write: send, re-read, and count it only when the server's own read shows the change.
  const write = useCallback(async (command: Record<string, unknown>, confirmed: (next: ReturnType<typeof readActions>, data: Record<string, unknown>) => boolean): Promise<Result> => {
    if (!tenantId) return { ok: false, message: "This workspace could not be resolved, so nothing was saved." };
    const { data, error } = await rpc("configure_campaign_brief_actions", {
      _tenant_id: tenantId, _command: command, _idempotency_key: crypto.randomUUID(), _actor_kind: "human",
    });
    if (error) {
      console.error("[campaign-actions] write failed", { type: command.type, error });
      return { ok: false, message: actionMessageFor(String(error.message || "")) };
    }
    const answer = (data ?? {}) as Record<string, unknown>;
    try {
      const next = await read();
      setState({ phase: "ready", ...next });
      if (!confirmed(next, answer)) return { ok: false, message: "The change was sent but the campaign doesn't show it yet. Reload to check." };
    } catch (readError) {
      console.error("[campaign-actions] readback failed", readError);
      return { ok: false, message: "The change was sent but couldn't be confirmed. Reload to check." };
    }
    return { ok: true, message: typeof answer.message === "string" ? answer.message : "Saved." };
  }, [tenantId, read]);

  const find = (next: ReturnType<typeof readActions>, briefId: string, actionId: unknown) =>
    next.actions.find((action) => action.briefId === briefId && action.actionId === actionId);

  const plan = useCallback((briefId: string, input: PlanInput) => write({
    type: "plan_action", briefId, title: input.title.trim(), tactic: input.tactic.trim(), family: input.family,
    ...(input.dueAt ? { dueAt: input.dueAt } : {}),
    ...(input.expected?.trim() ? { expectedResult: { summary: input.expected.trim() } } : {}),
  }, (next, data) => Boolean(find(next, briefId, data.action_id))), [write]);
  const remove = useCallback((briefId: string, actionId: string) => write({ type: "unlink_action", briefId, actionId },
    (next) => !find(next, briefId, actionId)), [write]);
  const recordOutcome = useCallback((briefId: string, actionId: string, summary: string, value: number | null) => write({
    type: "record_outcome", briefId, actionId, observed: { summary: summary.trim(), ...(value === null ? {} : { value }) },
  }, (next) => find(next, briefId, actionId)?.lifecycle === "outcome_observed"), [write]);
  const evaluate = useCallback((briefId: string, actionId: string, verdict: Verdict, note: string | null) => write({
    type: "evaluate_outcome", briefId, actionId, verdict, ...(note?.trim() ? { note: note.trim() } : {}),
  }, (next) => find(next, briefId, actionId)?.verdict === verdict), [write]);

  return { ...state, phase: tenantId ? state.phase : "loading", retry, plan, remove, recordOutcome, evaluate };
}
