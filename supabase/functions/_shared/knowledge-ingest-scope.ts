/** Bind intake to the verified actor's explicitly selected workspace. This is a
 * checkpoint guard, not an atomic transaction across provider/HTTP calls. */
export class KnowledgeIngestScopeError extends Error {
  constructor(public readonly status = 403) {
    super(status === 401 ? "Sign in again before adding knowledge." : "Workspace access could not be verified. Select your workspace and try again.");
  }
}

export type KnowledgeScopeCaller = {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  // Plain function members, not client pieces: relating supabase-js's generic from()/rpc()
  // signatures to a structural port trips TS2589 under deno check, so the edge fn passes the
  // one profiles read it needs as an already-instantiated query.
  readActiveTenant(userId: string): PromiseLike<{data: {active_tenant_id?: unknown} | null; error: unknown}>;
  rpc(name: string,args?: Record<string,unknown>): PromiseLike<{data: unknown; error: unknown}>;
};
export async function bindKnowledgeIngestScope(caller: KnowledgeScopeCaller, suppliedTenant?: string, path?: string) {
  let actorId: string | undefined;
  let tenantId: string | undefined;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const denied = () => new KnowledgeIngestScopeError();
  const assert = async (): Promise<void> => {
    const identity = await caller.auth.getUser();
    const userId = identity?.data?.user?.id;
    if (identity?.error || typeof userId !== "string" || !userId || (actorId && actorId !== userId)) throw new KnowledgeIngestScopeError(401);
    const profile = await caller.readActiveTenant(userId);
    const active = profile?.data?.active_tenant_id;
    if (profile?.error || typeof active !== "string" || !uuid.test(active) ||
        (tenantId && tenantId !== active) || (suppliedTenant !== undefined && suppliedTenant !== active)) throw denied();
    // Invoke the established predicates AS THE USER. Company-workspace operator
    // authority belongs to is_tenant_member, never a duplicated role-name check.
    const owner = await caller.rpc("is_platform_owner");
    const member = await caller.rpc("is_tenant_member", { _tenant: active });
    if (owner?.error || member?.error || typeof owner?.data !== "boolean" || typeof member?.data !== "boolean" ||
        (!owner.data && !member.data)) throw denied();
    if (path !== undefined && (path.split("/")[0] !== active || path.includes("\\") || /%(?:2e|2f|5c)/i.test(path) ||
        path.split("/").some(part => !part || part === "." || part === ".."))) throw denied();
    actorId = userId;
    tenantId = active;
  };
  await assert();
  return { userId: actorId!, tenantId: tenantId!, assert };
}
