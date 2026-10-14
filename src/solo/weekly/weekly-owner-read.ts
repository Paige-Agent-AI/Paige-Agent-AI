import { readWeeklyCommitmentProjection } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-read";
import type { WeeklyCommitmentSnapshot } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";
import type { ContextIdentity } from "../../../supabase/functions/_shared/paige-context/mod";

export type WeeklyOwnerRead = { status: "ready"; snapshot: WeeklyCommitmentSnapshot }
  | { status: "loading" | "unavailable" | "refused" };
export type WeeklyBrowserScope = { actorId: string; tenantId: string; epoch: number };
type Caller = {
  auth: { getSession(): PromiseLike<{ data: { session: { user: { id: string } } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
/** Browser inspection, never model admission. Identity is re-proven, not inferred from a route/role label. */
export async function readWeeklyOwner(scope: WeeklyBrowserScope, caller: Caller, current: () => WeeklyBrowserScope | null): Promise<WeeklyOwnerRead> {
  const matches = () => { const now = current(); return now?.actorId === scope.actorId && now.tenantId === scope.tenantId && now.epoch === scope.epoch; };
  const refused: WeeklyOwnerRead = { status: "refused" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inspect = async (): Promise<WeeklyOwnerRead> => {
    try {
      if (!matches()) return refused;
      const session = await caller.auth.getSession();
      if (session.error || session.data.session?.user.id !== scope.actorId || !matches()) return refused;
      const owner = await caller.rpc("weekly_commitment_owner", { _tenant: scope.tenantId, _actor: scope.actorId });
      if (!matches()) return refused;
      if (owner.error) return { status: "unavailable" };
      if (owner.data !== true) return refused;
      // This role is assigned only after the canonical owner predicate succeeded.
      // The shared reader independently re-checks tenant and ownership before and after its read.
      const identity: ContextIdentity = { actorId: scope.actorId, tenantId: scope.tenantId, workspaceId: scope.tenantId,
        role: "owner", accountShape: "solo", actAsClientId: null, scopeEpoch: scope.epoch };
      const result = await readWeeklyCommitmentProjection(identity, { caller, currentIdentity: () => matches() ? identity : { ...identity, role: null, scopeEpoch: -1 } });
      if (!matches()) return refused;
      const after = await caller.auth.getSession();
      if (after.error || after.data.session?.user.id !== scope.actorId || !matches()) return refused;
      return result.status === "available" && result.data ? { status: "ready", snapshot: result.data } : { status: "unavailable" };
    } catch { return { status: "unavailable" }; }
  };
  try {
    return await Promise.race([inspect(), new Promise<WeeklyOwnerRead>(resolve => { timer = setTimeout(() => resolve({ status: "unavailable" }), 8000); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
