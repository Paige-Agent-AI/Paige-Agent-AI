// Who may approve-and-act on an approval row — EXP08 stage 0 (owner ruling 2026-10-26).
//
// "Being owner or admin of one business must never give admin power in another." The door used to
// admit the GLOBAL `user_roles` `admin` row plus ANY active seat in the approval's workspace. That
// global row is written for an owner/admin seat in ANY workspace, so the owner of A who is a plain
// member of B could approve and execute B's drafted actions. The answer is now asked about the
// approval's OWN workspace through the one resolver PAIGE already uses for workspace-admin tools
// (resolveWorkspaceAuthorityAs: an owner/admin seat there, or the agency managing it), with the
// Platform Operator (§53, super_admin) admitted explicitly. An approval with no workspace is the
// operator's alone — the same rule the paige_pending_approvals policies apply after stage 0.
//
// The canonical owner.task companion keeps its own, stricter current-workspace seat check in
// index.ts (taskSeat); this only replaces the "legacy global admin" admission.

import { resolveWorkspaceAuthorityAs } from "../_shared/workspace-authority.ts";

export type ApprovalAdmission = "admit" | "refuse" | "unavailable";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is the caller the Platform Operator (super_admin)? Fails closed to false. */
// deno-lint-ignore no-explicit-any
export async function isApprovalOperator(serviceClient: any, userId: string): Promise<boolean> {
  try {
    const { data, error } = await serviceClient.rpc("is_platform_owner", { _user_id: userId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Admit the caller for an approval in `tenantId`: the workspace's own owner/admin or managing agency,
 * or the Platform Operator. `unavailable` when the authority read fails, so the caller can answer 503
 * rather than settle a refusal that never happened (§32).
 */
export async function approvalAdmission(
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  userId: string,
  tenantId: unknown,
  operator: boolean,
): Promise<ApprovalAdmission> {
  if (operator) return "admit";
  if (!userId || typeof tenantId !== "string" || !UUID.test(tenantId)) return "refuse";
  let read;
  try {
    read = await resolveWorkspaceAuthorityAs(serviceClient, userId, tenantId);
  } catch {
    return "unavailable";
  }
  if (!read.ok) return "unavailable";
  return read.authority.workspaceAdmin || read.authority.platformOperator ? "admit" : "refuse";
}
