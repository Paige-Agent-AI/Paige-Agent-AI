// Who hears about a new approval (EXP08 stage 0, owner ruling 2026-10-26).
//
// An unassigned approval used to go to EVERY holder of the GLOBAL `admin` / `super_admin` role —
// and `admin` is written for an owner/admin seat in ANY workspace, so one business's approval
// summary and client name were emailed to the owners of every other business. The function is
// dormant today only because its database trigger posts to a different project URL; this is fixed
// before anyone repoints that trigger.
//
// The approval belongs to `approval.tenant_id`, so its audience is that workspace's people:
//   - assigned: the assignee, when they hold an active seat in that workspace (any seat role) or
//     are a Platform Operator; an assignee with neither is dropped and the workspace's
//     owners/admins are told instead, so the approval is never silently lost;
//   - requires_role 'owner': the workspace's active owner seats;
//   - requires_role 'super_admin' / 'platform_admin': the Platform Operators holding that role;
//   - otherwise (none, 'any', 'admin', or a legacy title role): the workspace's active owner and
//     admin seats;
//   - an approval with NO workspace (tenant_id null) is platform work: the Platform Operators only.
//
// Pure over injected reads; a read that fails throws (no recipients is never inferred from an
// error).

export interface ApprovalAudienceInput {
  tenant_id: string | null;
  assigned_to_user_id: string | null;
  requires_role: string | null;
}

export interface Recipient {
  user_id: string;
  /** Seat role ('owner' | 'admin' | 'member') or operator role ('super_admin' | 'platform_admin'). */
  role: string;
}

export interface RecipientDeps {
  /** Active seats of `tenantId` whose role is in `roles`. */
  seats: (tenantId: string, roles: string[]) => Promise<Recipient[]>;
  /** The active seat role of `userId` in `tenantId`, or null. */
  seatRole: (tenantId: string, userId: string) => Promise<string | null>;
  /** Platform Operators (user_roles) holding one of `roles`. */
  operators: (roles: string[]) => Promise<Recipient[]>;
}

export const OPERATOR_ROLES = ["super_admin", "platform_admin"] as const;

function dedupe(list: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return list.filter((r) => (seen.has(r.user_id) ? false : (seen.add(r.user_id), true)));
}

async function broadcast(approval: ApprovalAudienceInput, deps: RecipientDeps): Promise<Recipient[]> {
  const required = approval.requires_role && approval.requires_role !== "any" ? approval.requires_role : null;
  if (required && (OPERATOR_ROLES as readonly string[]).includes(required)) return deps.operators([required]);
  if (!approval.tenant_id) return deps.operators([...OPERATOR_ROLES]);
  return deps.seats(approval.tenant_id, required === "owner" ? ["owner"] : ["owner", "admin"]);
}

export async function approvalCreatedRecipients(
  approval: ApprovalAudienceInput,
  deps: RecipientDeps,
): Promise<Recipient[]> {
  const assignee = approval.assigned_to_user_id;
  if (assignee) {
    if (approval.tenant_id) {
      const seat = await deps.seatRole(approval.tenant_id, assignee);
      if (seat) return [{ user_id: assignee, role: seat }];
    }
    const op = (await deps.operators([...OPERATOR_ROLES])).find((r) => r.user_id === assignee);
    if (op) return [op];
  }
  return dedupe(await broadcast(approval, deps));
}
