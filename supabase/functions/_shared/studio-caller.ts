// The one authority check for a Studio generation backend called with a person's session.
//
// The workspace is the one the caller is signed in to (current_user_tenant_id, from the JWT), never a
// tenant id in the request body, and the caller must be that workspace's owner or admin, or the agency
// that manages it — the rule `studio_role_ok` applies, asked here of the exact workspace this returns so
// a workspace switch between two reads can never check one workspace and write another. A body tenant
// id that names a different workspace is refused, not quietly swapped, so a caller is never told an
// image landed where they asked when it landed somewhere else.
//
// A platform-wide role grants nothing here: user_roles has no tenant, so "admin" there says nothing
// about which workspace the person may write into.

export interface StudioCallerOk { ok: true; tenantId: string }
export interface StudioCallerRefused { ok: false; status: 403 | 500; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNCONFIRMED = "Couldn't confirm your workspace just now. Nothing was created. Try again.";

// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export async function resolveStudioCaller(
  authed: RpcClient,
  requestedTenant: unknown,
): Promise<StudioCallerOk | StudioCallerRefused> {
  const { data: active, error: tErr } = await authed.rpc("current_user_tenant_id");
  if (tErr) return { ok: false, status: 500, error: UNCONFIRMED };
  const tenantId = typeof active === "string" && UUID_RE.test(active) ? active.toLowerCase() : null;
  if (!tenantId) return { ok: false, status: 403, error: "Open one of your workspaces first, then try again." };

  if (requestedTenant != null && requestedTenant !== "" && String(requestedTenant).toLowerCase() !== tenantId) {
    return { ok: false, status: 403, error: "That isn't the workspace you're signed in to. Nothing was created." };
  }

  const { data: isAdmin, error: aErr } = await authed.rpc("is_tenant_admin", { _tenant: tenantId });
  if (aErr) return { ok: false, status: 500, error: UNCONFIRMED };
  if (isAdmin !== true) {
    const { data: manages, error: mErr } = await authed.rpc("agency_can_manage_child", { _child: tenantId });
    if (mErr) return { ok: false, status: 500, error: UNCONFIRMED };
    if (manages !== true) {
      return { ok: false, status: 403, error: "Only this workspace's owner or an admin can use the Studio." };
    }
  }
  return { ok: true, tenantId };
}
