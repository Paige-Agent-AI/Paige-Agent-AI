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

export type StudioCallerRefusal = "lookup_failed" | "no_workspace" | "other_workspace" | "not_admin";
export interface StudioCallerOk { ok: true; tenantId: string }
export interface StudioCallerRefused { ok: false; status: 403 | 500; error: string; reason: StudioCallerRefusal }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNCONFIRMED = "Couldn't confirm your workspace just now. Nothing was created. Try again.";

// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export async function resolveStudioCaller(
  authed: RpcClient,
  requestedTenant: unknown,
): Promise<StudioCallerOk | StudioCallerRefused> {
  const { data: active, error: tErr } = await authed.rpc("current_user_tenant_id");
  if (tErr) return { ok: false, status: 500, error: UNCONFIRMED, reason: "lookup_failed" };
  const tenantId = typeof active === "string" && UUID_RE.test(active) ? active.toLowerCase() : null;
  if (!tenantId) {
    return { ok: false, status: 403, error: "Open one of your workspaces first, then try again.", reason: "no_workspace" };
  }

  if (requestedTenant != null && requestedTenant !== "" && String(requestedTenant).toLowerCase() !== tenantId) {
    return {
      ok: false, status: 403, reason: "other_workspace",
      error: "That isn't the workspace you're signed in to. Nothing was created.",
    };
  }

  const { data: isAdmin, error: aErr } = await authed.rpc("is_tenant_admin", { _tenant: tenantId });
  if (aErr) return { ok: false, status: 500, error: UNCONFIRMED, reason: "lookup_failed" };
  if (isAdmin !== true) {
    const { data: manages, error: mErr } = await authed.rpc("agency_can_manage_child", { _child: tenantId });
    if (mErr) return { ok: false, status: 500, error: UNCONFIRMED, reason: "lookup_failed" };
    if (manages !== true) {
      return {
        ok: false, status: 403, reason: "not_admin",
        error: "Only this workspace's owner or an admin can use the Studio.",
      };
    }
  }
  return { ok: true, tenantId };
}

// The same rule for a request about a row that already belongs to a workspace (an artifact being
// learned from): the row's workspace must be the one the caller is signed in to, and the caller its
// owner, admin or managing agency. A row from any other workspace is refused and the caller told to
// switch — never served from whichever workspace they happen to be in. The row's tenant goes in as
// the requested workspace, so this is resolveStudioCaller's own check rather than a second copy of
// it; a row without a valid tenant is refused instead of reading as "no workspace was named".
export async function resolveStudioCallerForArtifact(
  authed: RpcClient,
  artifactTenant: unknown,
): Promise<StudioCallerOk | StudioCallerRefused> {
  if (typeof artifactTenant !== "string" || !UUID_RE.test(artifactTenant)) {
    return {
      ok: false, status: 403, reason: "other_workspace",
      error: "That item has no workspace I can check you against. Nothing was learned.",
    };
  }
  const caller = await resolveStudioCaller(authed, artifactTenant);
  if (caller.ok) return caller;
  // An explicit annotation: the app tsconfig runs without strictNullChecks, where `ok` does not narrow.
  const refused = caller as StudioCallerRefused;
  if (refused.reason === "other_workspace") {
    return { ...refused, error: "Switch into that workspace to teach its Paige from this artifact." };
  }
  if (refused.reason === "lookup_failed") {
    return { ...refused, error: "Couldn't confirm your workspace just now. Nothing was learned. Try again." };
  }
  return refused;
}
