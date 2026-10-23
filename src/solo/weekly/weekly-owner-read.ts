import { readWeeklyCommitmentProjection } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-read.ts";
import type { WeeklyCheck, WeeklyCommitmentSnapshot } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";
import type { ContextIdentity } from "../../../supabase/functions/_shared/paige-context/mod";
import { createWeeklyDraftDeadline } from "../../../supabase/functions/_shared/paige-orchestration/weekly-draft-deadline.ts";
import { reviewWeeklyProposal } from "./weekly-responsibility";
import type { WeeklySchedule } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";

export type WeeklyOwnerRead = { status: "ready"; snapshot: WeeklyCommitmentSnapshot }
  | { status: "loading" | "unavailable" | "refused" };
export type WeeklyBrowserScope = { actorId: string; tenantId: string; epoch: number; actAsClientId?: string | null };
type Caller = {
  auth: { getSession(): PromiseLike<{ data: { session: { user: { id: string } } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
/** Browser inspection, never model admission. Identity is re-proven, not inferred from a route/role label. */
export async function readWeeklyOwner(scope: WeeklyBrowserScope, caller: Caller, current: () => WeeklyBrowserScope | null): Promise<WeeklyOwnerRead> {
  const origin = { ...scope };
  const matches = () => { const now = current(); return (origin.actAsClientId ?? null) === null && (now?.actAsClientId ?? null) === null && now?.actorId === origin.actorId && now.tenantId === origin.tenantId && now.epoch === origin.epoch; };
  const refused: WeeklyOwnerRead = { status: "refused" };
  let retired = false;
  const stage = createWeeklyDraftDeadline(8000, () => !retired);
  const inspectStage = <T>(start: () => PromiseLike<T>) => stage(() => {
    if (!matches()) throw new Error("scope_changed");
    const request = start();
    if (request instanceof Promise) void request.catch(() => {});
    return stage(() => new Promise<T>((resolve, reject) => {
      if (!matches()) throw new Error("scope_changed");
      // Subscribe only after the original deadline and current scope recheck.
      request.then(resolve, reject);
    }));
  });
  const scopedCaller = { rpc: (name: string, args?: Record<string, unknown>) => inspectStage(() => caller.rpc(name, args)) };
  const inspect = async (): Promise<WeeklyOwnerRead> => {
    try {
      if (!matches()) return refused;
      const session = await inspectStage(() => caller.auth.getSession());
      if (session.error || session.data.session?.user.id !== origin.actorId || !matches()) return refused;
      const owner = await scopedCaller.rpc("weekly_commitment_owner", { _tenant: origin.tenantId, _actor: origin.actorId });
      if (!matches()) return refused;
      if (owner.error) return { status: "unavailable" };
      if (owner.data !== true) return refused;
      // This role is assigned only after the canonical owner predicate succeeded.
      // The shared reader independently re-checks tenant and ownership before and after its read.
      const identity: ContextIdentity = { actorId: origin.actorId, tenantId: origin.tenantId, workspaceId: origin.tenantId,
        role: "owner", accountShape: "solo", actAsClientId: null, scopeEpoch: origin.epoch };
      const result = await stage(() => readWeeklyCommitmentProjection(identity, { caller: scopedCaller, currentIdentity: () => !retired && matches() ? identity : null }));
      if (!matches()) return refused;
      const after = await inspectStage(() => caller.auth.getSession());
      if (after.error || after.data.session?.user.id !== origin.actorId || !matches()) return refused;
      return result.status === "available" && result.data ? { status: "ready", snapshot: result.data } : { status: "unavailable" };
    } catch { return { status: "unavailable" }; }
  };
  try {
    return await stage(inspect);
  } catch { return { status: "unavailable" }; }
  finally { retired = true; }
}

export type WeeklyOwnerControl = { status: "saved"; snapshot: WeeklyCommitmentSnapshot }
  | { status: "refused" | "stale" | "unsupported" | "unavailable" | "unknown" };
export type WeeklyFutureControl = (check: WeeklyCheck, action: "pause" | "cancel" | "configure", schedule?: WeeklySchedule) => Promise<WeeklyOwnerControl>;
/** Deliberate human-only future control. The original native writers own authority,
 * concurrency and audit; a changed definition disarms and cannot authorize, enable or replay work. */
export async function controlWeeklyOwner(scope: WeeklyBrowserScope, review: WeeklyCheck, action: "pause" | "cancel" | "configure",
  caller: Caller, current: () => WeeklyBrowserScope | null, schedule?: WeeklySchedule): Promise<WeeklyOwnerControl> {
  const origin = { ...scope }, expected = { id: review.automation_id, revision: review.revision,
    status: review.schedule_status, schedule: { ...review.schedule } };
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  let retired = false, dispatched = false;
  const matches = () => {
    try {
      const now = current();
      return !retired && (origin.actAsClientId ?? null) === null && (now?.actAsClientId ?? null) === null
        && now?.actorId === origin.actorId && now.tenantId === origin.tenantId && now.epoch === origin.epoch;
    } catch { return false; }
  };
  const proposed = action === "configure" && schedule ? reviewWeeklyProposal(schedule.weekday, schedule.local_time, schedule.timezone) : null;
  if (!["pause", "cancel", "configure"].includes(action) || action === "configure" && !proposed || action !== "configure" && schedule !== undefined
    || !uuid.test(origin.actorId) || !uuid.test(origin.tenantId)
    || !uuid.test(expected.id) || !Number.isSafeInteger(expected.revision) || expected.revision < 1 || !matches()) return { status: "refused" };
  const stage = createWeeklyDraftDeadline(12_000, matches);
  const sameDefinition = (value: WeeklyCheck) => value.automation_id === expected.id && value.revision === expected.revision
    && value.schedule.weekday === expected.schedule.weekday && value.schedule.local_time === expected.schedule.local_time
    && value.schedule.timezone === expected.schedule.timezone;
  try {
    const before = await stage(() => readWeeklyOwner(origin, caller, () => matches() ? origin : null));
    if (!matches()) return { status: "refused" };
    if (before.status !== "ready") return { status: before.status === "refused" ? "refused" : "unavailable" };
    const target = before.snapshot.checks.find(item => item.automation_id === expected.id);
    if (!target || !sameDefinition(target) || target.schedule_status !== expected.status
      || target.schedule_status === "cancelled" || action === "pause" && target.schedule_status === "paused") return { status: "stale" };
    if (proposed && proposed.weekday === expected.schedule.weekday && proposed.local_time === expected.schedule.local_time
      && proposed.timezone === expected.schedule.timezone) return { status: "unsupported" };
    const result = await stage(() => {
      // Treat an eager SDK/factory as possibly dispatched. Recheck again before
      // subscribing to a lazy PostgREST query; late preflight can never write.
      dispatched = true;
      const request = proposed ? caller.rpc("configure_weekly_commitment_check", { _automation_id: expected.id,
        _weekday: proposed.weekday, _local_time: proposed.local_time, _timezone: proposed.timezone, _expected_revision: expected.revision })
        : caller.rpc("control_weekly_commitment_check", { _automation_id: expected.id, _action: action, _expected_revision: expected.revision });
      if (request instanceof Promise) void request.catch(() => {});
      return stage(() => new Promise<{ data: unknown; error: unknown }>((resolve, reject) => request.then(resolve, reject)));
    });
    if (!matches()) return { status: "refused" };
    if (result.error) {
      const code = typeof result.error === "object" && "code" in result.error ? result.error.code : null;
      return { status: code === "40001" ? "stale" : code === "42501" ? "refused" : code === "22023" ? "unsupported" : "unknown" };
    }
    const data = result.data, state = proposed ? "draft" : action === "pause" ? "paused" : "cancelled";
    const revision = expected.revision + (proposed ? 1 : 0);
    if (!data || typeof data !== "object" || !("ok" in data) || data.ok !== true
      || !("automation_id" in data) || data.automation_id !== expected.id || !("revision" in data) || data.revision !== revision
      || !("state" in data) || data.state !== state || (proposed
        ? !("requires_authorization" in data) || data.requires_authorization !== true
        : !("future_runs_only" in data) || data.future_runs_only !== true)) return { status: "unknown" };
    const after = await stage(() => readWeeklyOwner(origin, caller, () => matches() ? origin : null));
    if (!matches()) return { status: "refused" };
    if (after.status !== "ready") return { status: after.status === "refused" ? "refused" : "unknown" };
    const saved = after.snapshot.checks.find(item => item.automation_id === expected.id);
    const definitionMatches = saved && (proposed ? saved.automation_id === expected.id && saved.revision === revision
      && saved.schedule.weekday === proposed.weekday && saved.schedule.local_time === proposed.local_time && saved.schedule.timezone === proposed.timezone
      && saved.schedule_status === "requested" && saved.execution_availability === "held" : sameDefinition(saved) && saved.schedule_status === state);
    return saved && definitionMatches && saved.next_run_at === null
      ? { status: "saved", snapshot: after.snapshot } : { status: "unknown" };
  } catch { return { status: !matches() ? "refused" : dispatched ? "unknown" : "unavailable" }; }
  finally { retired = true; }
}
