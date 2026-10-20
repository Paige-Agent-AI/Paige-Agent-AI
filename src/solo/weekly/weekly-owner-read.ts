import { readWeeklyCommitmentProjection } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-read";
import type { WeeklyCommitmentSnapshot } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";
import type { ContextIdentity } from "../../../supabase/functions/_shared/paige-context/mod";
import { createWeeklyDraftDeadline } from "../../../supabase/functions/_shared/paige-orchestration/weekly-draft-deadline";

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
