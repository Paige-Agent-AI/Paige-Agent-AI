// Original Systems result projection, reusing the original Work read and RLS.
// The original server caller owns current/lifetime; no admission or execution.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { awaitSystemsCheckRequest, isManualSystemsWorkId as uuid } from "./systems-check-wait.ts";
import { readManualSystemsWork } from "./systems-check-manual-request.ts";

export type ManualSystemsRunResult = { readback: "unconfirmed" } | {
  readback: "available";
  run: { id: string; workId: string; startedAt: string; completedAt: string; checkCount: number; passCount: number; failCount: number };
  /** Native completion records Rail atomically, but this source does not project
   * its original receipt identity. Never guess one from a title or timestamp. */
  receipt: "not_projected";
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const time = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2_147_483_647;

/** Reads the SAME original completed run under the caller's existing RLS.
 * Work.id = run.id = run.work_id is canonical only after native succeeded and
 * this actual association. A prepared request/202 never reaches the run read.
 * No latest-run guess, service read, finding mutation, dispatch or receipt write. */
export async function readManualSystemsRun(ports: {
  actorId: string; tenantId: string; workId: string; caller: SupabaseClient;
  signal: AbortSignal; current: () => boolean;
}): Promise<ManualSystemsRunResult> {
  const { actorId, tenantId, workId, caller, signal, current } = ports;
  const unconfirmed = { readback: "unconfirmed" } as const;
  try {
    if (![actorId, tenantId, workId].every(uuid) || !(signal instanceof AbortSignal) || typeof current !== "function") return unconfirmed;
    const live = () => !signal.aborted && current() === true;
    if (!live()) return unconfirmed;
    const user = await awaitSystemsCheckRequest(() => caller.auth.getUser(), signal);
    if (user.error || user.data?.user?.id !== actorId || !live()) return unconfirmed;
    const tenant = await awaitSystemsCheckRequest(() => caller.rpc("current_user_tenant_id"), signal);
    if (tenant.error || tenant.data !== tenantId || !live()) return unconfirmed;
    const work = await readManualSystemsWork(caller, workId, signal);
    if (!live() || !work || work.status !== "succeeded" || !work.settledAt) return unconfirmed;
    const reply = await awaitSystemsCheckRequest(() => caller.from("paige_systems_check_run")
      .select("id,work_id,tenant_id,scan_flavor,selected_runner_keys,triggered_by,started_at,completed_at,check_count,pass_count,fail_count")
      .eq("id", workId).eq("work_id", workId).eq("tenant_id", tenantId).abortSignal(signal).maybeSingle(), signal);
    if (reply.error || !live() || !record(reply.data)) return unconfirmed;
    const r = reply.data;
    if (r.id !== workId || r.work_id !== workId || r.tenant_id !== tenantId || r.scan_flavor !== "manual"
      || r.selected_runner_keys !== null || !record(r.triggered_by) || r.triggered_by.scope !== "tenant" || r.triggered_by.action_filing !== "none"
      || !time(r.started_at) || !time(r.completed_at) || Date.parse(r.started_at) < Date.parse(work.createdAt)
      || Date.parse(r.completed_at) < Date.parse(r.started_at) || Date.parse(r.completed_at) > Date.parse(work.settledAt)
      || !count(r.check_count) || !count(r.pass_count) || !count(r.fail_count) || r.pass_count + r.fail_count > r.check_count) return unconfirmed;
    const run = { id: workId, workId, startedAt: r.started_at, completedAt: r.completed_at,
      checkCount: r.check_count, passCount: r.pass_count, failCount: r.fail_count };
    const after = await awaitSystemsCheckRequest(() => caller.auth.getUser(), signal);
    if (after.error || after.data?.user?.id !== actorId || !live()) return unconfirmed;
    const scope = await awaitSystemsCheckRequest(() => caller.rpc("current_user_tenant_id"), signal);
    if (scope.error || scope.data !== tenantId || !live()) return unconfirmed;
    // Same native gate again: a tenant match alone cannot preserve an earlier
    // owner/admin read after authority or the original Work changes.
    const finalWork = await readManualSystemsWork(caller, workId, signal);
    if (!live() || JSON.stringify(finalWork) !== JSON.stringify(work)) return unconfirmed;
    return { readback: "available", run, receipt: "not_projected" };
  } catch { return unconfirmed; }
}
