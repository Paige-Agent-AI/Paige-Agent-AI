// The one authority check for a Studio generation backend called with a person's session.
//
// The workspace is the one the caller is signed in to (current_user_tenant_id, from the JWT), never a
// tenant id in the request body, and the caller must be that workspace's owner or admin, or the agency
// that manages it (studio_role_ok — the same rule the growth save and publish RPCs apply). A body
// tenant id that names a different workspace is refused, not quietly swapped, so a caller is never told
// an image landed where they asked when it landed somewhere else.
//
// A platform-wide role grants nothing here: user_roles has no tenant, so "admin" there says nothing
// about which workspace the person may write into.

export interface StudioCallerOk { ok: true; tenantId: string }
export interface StudioCallerRefused { ok: false; status: 403; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export async function resolveStudioCaller(
  authed: RpcClient,
  userId: string,
  requestedTenant: unknown,
): Promise<StudioCallerOk | StudioCallerRefused> {
  const { data: active, error: tErr } = await authed.rpc("current_user_tenant_id");
  const tenantId = typeof active === "string" && UUID_RE.test(active) ? active : null;
  if (tErr || !tenantId) {
    return { ok: false, status: 403, error: "Open one of your workspaces first, then try again." };
  }
  const { data: allowed, error: rErr } = await authed.rpc("studio_role_ok", { _caller: userId });
  if (rErr || allowed !== true) {
    return { ok: false, status: 403, error: "Only this workspace's owner or an admin can use the Studio." };
  }
  if (requestedTenant != null && requestedTenant !== "" && String(requestedTenant).toLowerCase() !== tenantId.toLowerCase()) {
    return { ok: false, status: 403, error: "That isn't the workspace you're signed in to. Nothing was created." };
  }
  return { ok: true, tenantId };
}
