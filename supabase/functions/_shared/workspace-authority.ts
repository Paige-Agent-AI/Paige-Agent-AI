// Workspace authority for PAIGE's owner/admin-only chat tools — ONE resolver, ONE tool set (C0a).
//
// Owner ruling 2026-10-04: "ADMIN IS A TENANT ROLE." The chat previously decided these tools on the
// GLOBAL `user_roles` row `admin`, which is tenant-agnostic (§59's global-role trap): an admin of
// workspace A who is a member of B passed the gate inside B, and a workspace's own owner without the
// global row was refused. This module asks the canonical tenant question instead — the same one the
// Studio build tools already ask (`studio_role_ok` = owner/admin of the ACTIVE workspace, or the agency
// managing it) — and keeps the Platform Operator (§53, global super_admin) as a separate, explicit
// admit, because acting-as a customer workspace grants no seat there by design.
//
// Measured on production 2026-10-04 before the switch: 0 workspace owners/admins lacked the global
// row and the only global admin without a workspace seat is the super_admin, so nobody's access
// changes today; the fix is for every multi-workspace person from here on.
//
// No new role semantics: owner/admin/member are the tenant_members roles; agency management is
// agency_can_manage_child; the operator is super_admin. This file only composes them.

/**
 * Every chat tool that routes into the owner-ops dispatch branch (paige-ai-chat). Kept here so the
 * branch router, the early refusal (before any approval card), and the capability projection all read
 * the SAME list. Some names are unreachable today (the CRM command door intercepts them first, or they
 * are no longer emitted); they stay so routing is unchanged, and C0b deletes them by domain.
 */
export const OWNER_OPS_BRANCH_TOOLS: ReadonlySet<string> = new Set([
  "crm_update_pipeline_stage", "crm_assign_coach", "crm_create_task", "crm_create_contact", "crm_update_contact",
  "propose_business_brief_update", "update_business_profile",
  "pipeline_catalogue", "pipeline_archive_preview", "pipeline_folder_archive_preview", "pipeline_configure",
  "deal_create", "deal_move_stage",
  "member_grant_role", "team_set_work_profile", "team_set_permission", "team_invite_member", "team_invite_resend",
  "team_invite_revoke", "member_revoke_role",
  "calendar_book_meeting", "generate_image", "draft_marketing_content", "content_save", "document_generate",
  "growth_list", "growth_page_generate", "growth_page_save", "growth_page_publish", "growth_form_save",
  "growth_form_publish", "growth_funnel_generate", "growth_funnel_build", "growth_funnel_publish",
  "action_file", "action_advance", "inbox_list", "integrations_list", "capability_status", "contact_event_status",
  "social_post", "social_analytics", "social_accounts",
  "improvement_propose", "improvement_list", "improvement_decide",
  "action_list", "action_get", "crm_list_team", "presence_who_online", "presence_is_online", "crm_assign_contact",
  "zapier_list_actions", "zapier_run_action", "ghl_list_actions", "ghl_run_action",
  "crm_log_activity", "crm_add_note", "crm_list_documents", "crm_file_document",
  "crm_search_contacts", "crm_get_contact_summary", "crm_list_deals", "crm_list_tasks", "crm_pipeline_summary",
  "comms_connection_summary", "comms_list_numbers", "comms_search_numbers", "comms_buy_number", "comms_name_number",
  "comms_set_primary_number", "comms_registration_status", "comms_draft_registration",
]);

/**
 * Inside the owner-ops branch, reads that need no workspace role: a person may always ask what PAIGE
 * can do for THEM. (Capability self-knowledge carries no business data; it was admin-only by accident
 * of sitting in this branch.)
 */
export const ROLE_FREE_BRANCH_TOOLS: ReadonlySet<string> = new Set(["capability_status"]);

/**
 * Admin-only chat tools gated OUTSIDE the owner-ops branch, each by its own (previously global-admin)
 * check. Listed so the projection and the early refusal know them; each site calls the same resolver.
 */
export const OUT_OF_BRANCH_ADMIN_TOOLS: ReadonlySet<string> = new Set([
  "list_subagents", "delegate_to_subagent", "forge_subagent", "propose_action",
]);

/** The tools a caller can use only as this workspace's owner/admin (or the platform operator). */
export function requiresWorkspaceAdmin(tool: string, n8nTools: ReadonlySet<string>): boolean {
  if (n8nTools.has(tool)) return false; // n8n carries its own owner/session/tenant lease check
  if (ROLE_FREE_BRANCH_TOOLS.has(tool)) return false;
  return OWNER_OPS_BRANCH_TOOLS.has(tool) || OUT_OF_BRANCH_ADMIN_TOOLS.has(tool);
}

export interface WorkspaceAuthority {
  /** Owner/admin of the ACTIVE workspace, or the agency managing it (`studio_role_ok`). */
  workspaceAdmin: boolean;
  /**
   * An ACTIVE owner/admin `tenant_members` seat in the acting workspace — exactly what the governed
   * CRM and Sales doors (crm-command, sales-invoice-command, sales-collection-command) admit. Stricter
   * than `workspaceAdmin`: no agency manager, no platform admin, no operator acting-as.
   */
  seat: boolean;
  /** The Platform Operator (§53, global super_admin) — admitted explicitly; it holds no seat. */
  platformOperator: boolean;
}

/** No authority at all — the fail-closed answer. */
export const NO_WORKSPACE_AUTHORITY: WorkspaceAuthority = Object.freeze({
  workspaceAdmin: false, seat: false, platformOperator: false,
});

/**
 * Resolve the caller's authority for workspace-admin tools. `callerClient` MUST carry the caller's JWT
 * (studio_role_ok pins `_caller = auth.uid()`); `serviceClient` reads the global super_admin row keyed
 * on the VERIFIED user id, never a body value. Fails closed: any error resolves to no authority.
 *
 * `actingTenantId` is the tenant the chat will actually act on (personaCtx). studio_role_ok answers for
 * current_user_tenant_id(); the two can differ (persona resolution prefers a linked-client tenant), so a
 * seat only counts when they are the same workspace — the guard the CRM service tools already carry.
 */
export async function resolveWorkspaceAuthority(
  // deno-lint-ignore no-explicit-any
  callerClient: any,
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  userId: string,
  actingTenantId: string | null,
): Promise<WorkspaceAuthority> {
  if (!userId) return NO_WORKSPACE_AUTHORITY;
  const [adminOk, activeTenant, roles, memberRole] = await Promise.all([
    callerClient.rpc("studio_role_ok", { _caller: userId }).then(
      (r: { data: unknown; error: unknown }) => !r.error && r.data === true,
      () => false,
    ),
    callerClient.rpc("current_user_tenant_id").then(
      (r: { data: unknown; error: unknown }) => (r.error || typeof r.data !== "string" ? null : r.data),
      () => null,
    ),
    serviceClient.from("user_roles").select("role").eq("user_id", userId).then(
      (r: { data: Array<{ role: string }> | null; error: unknown }) =>
        r.error ? [] : (r.data ?? []).map((x) => x.role),
      () => [] as string[],
    ),
    // The doors' own question, asked the doors' own way (service read keyed on the verified user and
    // the server-resolved workspace, never a body value).
    actingTenantId
      ? serviceClient.from("tenant_members").select("role,status").eq("tenant_id", actingTenantId)
        .eq("user_id", userId).eq("status", "active").maybeSingle().then(
          (r: { data: { role?: unknown } | null; error: unknown }) =>
            r.error || typeof r.data?.role !== "string" ? null : r.data.role,
          () => null,
        )
      : Promise.resolve(null),
  ]);
  const sameWorkspace = !!actingTenantId && activeTenant === actingTenantId;
  return {
    workspaceAdmin: adminOk === true && sameWorkspace,
    seat: sameWorkspace && (memberRole === "owner" || memberRole === "admin"),
    platformOperator: (roles as string[]).includes("super_admin"),
  };
}

/**
 * The SAME authority in its actor-EXPLICIT form, for a server path with no JWT (auth.uid() is NULL) —
 * the native-event engine (Layer C) resolving a decision for the person who authorized it. Owner/admin
 * seat in THIS tenant (is_tenant_admin_as) or the agency managing it (agency_can_manage_child) is
 * `workspaceAdmin`; the doors' active owner/admin membership is `seat`; global super_admin is the
 * operator. Both RPCs are service_role-only, which this client must be.
 *
 * Unlike the chat resolver this does NOT fail closed to "no authority": an error returns `ok:false`,
 * because the engine RETRIES an infra failure rather than settling a refusal that never happened (§32).
 */
export async function resolveWorkspaceAuthorityAs(
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  actorUserId: string,
  tenantId: string,
): Promise<{ ok: true; authority: WorkspaceAuthority } | { ok: false; error: string }> {
  const [adminSeat, agency, roleRead, member] = await Promise.all([
    serviceClient.rpc("is_tenant_admin_as", { _actor: actorUserId, _tenant: tenantId }),
    serviceClient.rpc("agency_can_manage_child", { _child: tenantId, _actor: actorUserId }),
    serviceClient.from("user_roles").select("role").eq("user_id", actorUserId),
    serviceClient.from("tenant_members").select("role,status").eq("tenant_id", tenantId)
      .eq("user_id", actorUserId).eq("status", "active").maybeSingle(),
  ]);
  const failed = adminSeat.error ?? agency.error ?? roleRead.error ?? member.error;
  if (failed) return { ok: false, error: `authority read failed: ${failed?.message ?? String(failed)}` };
  const roles = (Array.isArray(roleRead.data) ? roleRead.data : []).map((r: { role?: unknown }) => r.role);
  const memberRole = typeof member.data?.role === "string" ? member.data.role : null;
  return {
    ok: true,
    authority: {
      workspaceAdmin: adminSeat.data === true || agency.data === true,
      seat: memberRole === "owner" || memberRole === "admin",
      platformOperator: roles.includes("super_admin"),
    },
  };
}

/**
 * Does this authority admit this tool? Three rules, strictest first:
 *  - a governed-door tool (CRM/Sales doors) needs an active owner/admin SEAT — the doors admit nothing
 *    else, so neither may the description of them;
 *  - a Studio build tool needs the workspace's own owner/admin or managing agency (the operator does
 *    not build in a customer workspace from chat), exactly as the dispatch gate already enforced;
 *  - every other admin tool admits the workspace owner/admin or the Platform Operator.
 */
export function authorityAdmits(
  tool: string,
  authority: WorkspaceAuthority,
  workspaceBuildTools: ReadonlySet<string>,
  doorSeatTools: ReadonlySet<string> = EMPTY,
): boolean {
  if (doorSeatTools.has(tool)) return authority.seat;
  if (workspaceBuildTools.has(tool)) return authority.workspaceAdmin;
  return authority.workspaceAdmin || authority.platformOperator;
}
const EMPTY: ReadonlySet<string> = new Set();

/**
 * The person-facing refusals — each names who CAN do it, never an internal role string. A read gets
 * the read wording ("nothing was changed" is meaningless for a lookup); everything else the write one.
 * Both are addressed to the person through PAIGE, who relays them in her own words.
 */
export const WORKSPACE_ADMIN_REFUSAL =
  "This needs this workspace's owner or an admin. Nothing was changed — the owner or an admin can do it, or give this person access.";
export const WORKSPACE_ADMIN_READ_REFUSAL =
  "Looking this up needs this workspace's owner or an admin — they can look it up, or give this person access.";
export function workspaceAdminRefusal(isWrite: boolean): string {
  return isWrite ? WORKSPACE_ADMIN_REFUSAL : WORKSPACE_ADMIN_READ_REFUSAL;
}
