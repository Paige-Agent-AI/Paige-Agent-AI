/** Gmail connection checkpoints reuse the canonical workspace/tenant-admin RPCs.
 * Each read observes current authority; it is not an atomic snapshot or future lease.
 * The optional expected tenant is only a stale-request guard, never a target selector.
 */
type RpcResult = { data: unknown; error: unknown };
interface AuthorityClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
}
interface CallerClient extends AuthorityClient {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
}
type Authority = { ok: true; tenantId: string; actorId: string }
  | { ok: false; status: number; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readGmailConnectionAuthority(
  caller: CallerClient,
  admin: AuthorityClient,
  expectedActorId?: string,
  expectedTenantId?: unknown,
): Promise<Authority> {
  try {
    const { data: { user }, error: actorError } = await caller.auth.getUser();
    if (actorError || !user || (expectedActorId !== undefined && user.id !== expectedActorId)) {
      return { ok: false, status: 401, error: "unauthorized" };
    }
    const { data: tenant, error: tenantError } = await caller.rpc("current_user_tenant_id");
    if (tenantError) return { ok: false, status: 503, error: "gmail_authority_unavailable" };
    if (typeof tenant !== "string" || !UUID.test(tenant)) return { ok: false, status: 409, error: "workspace_changed" };
    const tenantId = tenant.toLowerCase();
    if (expectedTenantId !== undefined && (typeof expectedTenantId !== "string"
      || !UUID.test(expectedTenantId) || expectedTenantId.toLowerCase() !== tenantId)) {
      return { ok: false, status: 409, error: "workspace_changed" };
    }
    // Same incumbent predicate used by SOLO Settings and native A2P. This keeps
    // its existing authorized company-workspace exception; a global admin role
    // alone grants no authority over an unrelated ordinary tenant.
    const { data: allowed, error: roleError } = await admin.rpc("is_tenant_admin_as", {
      _actor: user.id, _tenant: tenantId,
    });
    if (roleError) return { ok: false, status: 503, error: "gmail_authority_unavailable" };
    if (allowed !== true) return { ok: false, status: 403, error: "forbidden" };
    const { data: current, error: currentError } = await caller.rpc("current_user_tenant_id");
    if (currentError) return { ok: false, status: 503, error: "gmail_authority_unavailable" };
    if (typeof current !== "string" || current.toLowerCase() !== tenantId) {
      return { ok: false, status: 409, error: "workspace_changed" };
    }
    return { ok: true, tenantId, actorId: user.id };
  } catch {
    return { ok: false, status: 503, error: "gmail_authority_unavailable" };
  }
}
