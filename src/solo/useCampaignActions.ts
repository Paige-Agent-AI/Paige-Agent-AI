// Campaigns: the steps that carry each campaign out (INT-298 MBC slices 5–6). Reads and writes Marketing
// Actions through their governed RPCs (contract: docs/delivery/marketing-action-contract.md):
// `get_campaign_brief_actions` for every campaign's steps with the lifecycle the server derives from the
// action bus, and `configure_campaign_brief_actions` to plan, remove, record a result or judge it.
//
// TRUTH BOUNDARY (§13/§70). The lifecycle is the server's, never inferred here. A step is "done" only when a
// run or an approval stands behind it; one marked done with neither reads as recorded and takes no result.
// A write is reported done only after the re-read shows it; a write the read cannot confirm says so.
import { useCallback, useEffect, useRef, useState } from "react";
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
  /** The bus's own status. A failed step stays failed on screen, even once a result is recorded or judged. */
  readonly failed: boolean;
  /** The bus action kind; only the record-only campaign step is known to send and publish nothing. */
  readonly actionKind: string | null;
  /** Why a failed step failed. Owners and admins only; null for a member. */
  readonly error: string | null;
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

export type PlanInput = { title: string; tactic: string; family: ActionFamily; dueAt?: string | null; expected?: string | null; key?: string };
/** The kind PAIGE and the dossier plan: it records the step on approval and runs nothing. */
export const RECORD_ONLY_KIND = "marketing.campaign_action";
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
/** The state a step reads as. A failure is never hidden behind a later result or judgement. */
export function stateLabel(action: Pick<CampaignAction, "lifecycle" | "verdict" | "failed">): string {
  const judged = action.lifecycle === "evaluated" && action.verdict ? `judged: ${VERDICT_LABEL[action.verdict]}` : null;
  if (action.failed && action.lifecycle !== "failed") return `Failed · ${judged ?? "result recorded"}`;
  return judged ? `Judged: ${VERDICT_LABEL[action.verdict as Verdict]}` : LIFECYCLE_LABEL[action.lifecycle];
}
/** The campaign state class a lifecycle draws with (the desk's existing palette; never gold, §11). */
export function lifecycleTone(action: Pick<CampaignAction, "lifecycle" | "verdict"> & { failed?: boolean }): string {
  if (action.failed) return "st-blocked";
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
export function basisLine(action: Pick<CampaignAction, "basis" | "failed" | "error" | "actionKind">): string | null {
  if (action.failed) return action.error ? `It failed: ${action.error.slice(0, 200)}` : "It failed.";
  if (action.basis === "workflow_run") return "Done by the run it started.";
  // Approving the record-only campaign step records it and runs nothing; any other kind may have acted.
  if (action.basis === "approval") return action.actionKind === RECORD_ONLY_KIND
    ? "Finished on your approval, which records the step. Nothing was sent or published."
    : "Finished on your approval.";
  if (action.basis === "recorded") return "Marked done with no run or approval behind it, so it takes no result.";
  return null;
}
// Removing takes the step off the campaign with its recorded result and judgement; the action itself stays on
// the action list, so one still waiting for approval can still be approved. The confirmation says both.
export function removeWarning(action: Pick<CampaignAction, "observed" | "verdict" | "lifecycle">): string {
  const parts = ["Take this step off the campaign?"];
  if (action.observed || action.verdict) parts.push("Its recorded result and judgement go with it.");
  if (["planned", "prepared", "approval_required", "approved", "scheduled"].includes(action.lifecycle))
    parts.push("The action stays on your list and in Approvals; decline it there if it shouldn't run.");
  else parts.push("The action itself is unchanged.");
  return parts.join(" ");
}
/** Results can be recorded only over a proven finish or a failure; judged only once recorded. */
export const canRecordOutcome = (action: CampaignAction) => action.lifecycle === "completed" || action.lifecycle === "failed";
export const canEvaluate = (action: CampaignAction) => action.lifecycle === "outcome_observed";

// pg-token parity: every token the writer raises reads as a sentence a person can act on
// (useCampaignActions.test.tsx reads every CAMPAIGN_* token out of the migrations and checks each one).
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
  if (has("CAMPAIGN_ACTION_ARGUMENTS_INVALID")) return "Something in that step couldn't be used. Check the due date is a real date, then try again. Nothing was saved.";
  if (has("CAMPAIGN_ACTION_FAMILY_INVALID")) return "Choose what kind of step it is. Nothing was saved.";
  if (has("CAMPAIGN_ACTION_VERDICT_INVALID")) return "Judge it as met, partly met or not met. Nothing was changed.";
  if (has("CAMPAIGN_ACTION_DEPENDENCY_INVALID")) return "The step it waits on must be another step in this campaign. Nothing was saved.";
  if (has("CAMPAIGN_ACTION_PROCESS_NOT_FOUND")) return "That process isn't in this workspace any more. Nothing was saved.";
  if (has("CAMPAIGN_ACTION_LINK_IMMUTABLE")) return "A step can't move to another campaign or change its action. Remove it and plan it again instead.";
  if (has("CAMPAIGN_BRIEF_ACTION_INVALID") || has("CAMPAIGN_BRIEF_ACTOR_INVALID") || has("CAMPAIGN_BRIEF_IDEMPOTENCY_REQUIRED"))
    return "The screen sent a change the server doesn't accept. Reload and try again; nothing was changed.";
  return "That change could not be saved. Nothing else was changed.";
}

/** A date picked in a date field means local midnight that day; send it as that instant so it reads back as the same day. */
export function localDayStart(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const at = new Date(`${date}T00:00:00`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

type ActionRow = Record<string, unknown> & { evidence?: Record<string, unknown>; approval?: Record<string, unknown>; owner?: Record<string, unknown> };
export function readActions(data: unknown): Pick<CampaignActionsState, "canManage" | "actions"> {
  const payload = (data ?? {}) as { can_manage?: unknown; actions?: unknown };
  const actions = (Array.isArray(payload.actions) ? payload.actions as ActionRow[] : []).flatMap((row) => {
    const lifecycle = pick(row?.lifecycle, LIFECYCLES);
    const family = pick(row?.family, FAMILIES);
    if (!lifecycle || !family || !str(row.brief_id) || !str(row.action_id) || !str(row.tactic)) {
      console.warn("[campaign-actions] a step the screen can't draw was left out", { action_id: row?.action_id, lifecycle: row?.lifecycle, family: row?.family });
      return [];
    }
    const expected = row.expected_result as Record<string, unknown> | null;
    const observed = row.observed_result as Record<string, unknown> | null;
    const evaluation = row.evaluation as Record<string, unknown> | null;
    return [{
      briefId: String(row.brief_id), actionId: String(row.action_id), tactic: String(row.tactic), family, lifecycle,
      failed: row.status === "failed" || lifecycle === "failed", actionKind: str(row.action_kind), error: str(row.evidence?.error),
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
  // Reads are numbered; only the newest one may draw, so a slow older readback never undoes a newer change.
  const seq = useRef(0);

  const read = useCallback(async () => {
    const ticket = ++seq.current;
    const { data, error } = await rpc("get_campaign_brief_actions", { _tenant_id: tenantId, _brief_id: briefId });
    if (error) throw new Error(error.message ?? "read failed");
    return { next: readActions(data), latest: () => ticket === seq.current };
  }, [tenantId, briefId]);

  useEffect(() => {
    if (!tenantId) return;
    let live = true;
    setState((current) => ({ ...current, phase: "loading" }));
    read().then(({ next, latest }) => { if (live && latest()) setState({ phase: "ready", ...next }); }, (error) => {
      if (!live) return;
      console.error("[campaign-actions] read failed", error);
      setState({ phase: "error", canManage: false, actions: [] });
    });
    return () => { live = false; };
  }, [tenantId, refreshKey, read]);

  // Every write: send, re-read, and count it only when the server's own read shows the change.
  const write = useCallback(async (command: Record<string, unknown>, confirmed: (next: ReturnType<typeof readActions>, data: Record<string, unknown>) => boolean, key?: string): Promise<Result> => {
    if (!tenantId) return { ok: false, message: "This workspace could not be resolved, so nothing was saved." };
    const { data, error } = await rpc("configure_campaign_brief_actions", {
      _tenant_id: tenantId, _command: command, _idempotency_key: key ?? crypto.randomUUID(), _actor_kind: "human",
    });
    if (error) {
      console.error("[campaign-actions] write failed", { type: command.type, error });
      return { ok: false, message: actionMessageFor(String(error.message || "")) };
    }
    const answer = (data ?? {}) as Record<string, unknown>;
    try {
      const { next, latest } = await read();
      if (latest()) setState({ phase: "ready", ...next });
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
  }, (next, data) => Boolean(find(next, briefId, data.action_id)), input.key), [write]);
  const remove = useCallback((briefId: string, actionId: string) => write({ type: "unlink_action", briefId, actionId },
    (next) => !find(next, briefId, actionId)), [write]);
  const recordOutcome = useCallback((briefId: string, actionId: string, summary: string, value: number | null) => write({
    type: "record_outcome", briefId, actionId, observed: { summary: summary.trim(), ...(value === null ? {} : { value }) },
  }, (next) => find(next, briefId, actionId)?.lifecycle === "outcome_observed"), [write]);
  const evaluate = useCallback((briefId: string, actionId: string, verdict: Verdict, note: string | null) => write({
    type: "evaluate_outcome", briefId, actionId, verdict, ...(note?.trim() ? { note: note.trim() } : {}),
  }, (next) => find(next, briefId, actionId)?.verdict === verdict), [write]);

  // No workspace to read means nothing can load; say so rather than spin.
  return { ...state, phase: tenantId ? state.phase : "error", retry, plan, remove, recordOutcome, evaluate };
}
