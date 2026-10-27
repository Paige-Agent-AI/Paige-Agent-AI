// supabase/functions/accept-invite/team-seat.ts
//
// What accepting an internal team invitation writes, and in which order (EXP08 lifecycle, review
// round 3's B3). The edge function's consume path used to write the global role first and the seat
// second, as two unchecked service-role statements. For a SUSPENDED member holding an admin
// invitation, the seat write is a role change on a suspended seat, which the consent trigger's rule
// 1b refuses — and the global `admin` already written stayed, so the suspended person could act
// through every reader of the global role (change_user_role demoting the workspace's active admins).
//
// The contract now, in order:
//   1. checkTeamSeat — BEFORE any write (the caller runs it before the password is set): a person who
//      already has a seat in the invitation's workspace that is not 'active' (suspended, pending,
//      revoked, archived) is refused 409. An invitation does not lift a hold or revive an ended seat;
//      only reinstatement lifts a suspension (owner ruling 2026-10-26), and only the owner changes a
//      suspended seat.
//   2. grantTeamSeat — the SEAT first, its result checked and read back as 'active'; only then the
//      global role, its result checked. If the role write fails, the seat write is undone (a seat this
//      call created is deleted; a role this call raised is put back). After the role write the seat is
//      read once more: if it stopped being active in between (a suspension landed), a role this call
//      added is taken away again and the accept is refused 409.
//   An already-active seat is never lowered by an invitation (the owner stays owner, an admin
//   invitation raises a member to admin, anything else keeps the seat's role), the same rule as
//   accept_invitation and grant_tenant_member_role.
//
// Only the supabase-js calls below are used, so the tests drive this file with a recording fake.

// The seat roles a row can hold (tenant_members_role_not_retired_title_role keeps the retired one out).
export type TenantRole = "owner" | "admin" | "member";

export interface ExistingSeat {
  id: string;
  status: string;
  role: TenantRole;
  is_owner: boolean;
}

export type SeatRefusal = { ok: false; status: number; code: string; error: string };

export type SeatCheck = { ok: true; existing: ExistingSeat | null } | SeatRefusal;

export type SeatGrant = { ok: true } | SeatRefusal;

// deno-lint-ignore no-explicit-any
export type ServiceClient = { from(table: string): any };

const SEAT_COLUMNS = "id,status,role,is_owner";

export function seatNotActiveMessage(status: string): string {
  if (status === "suspended") {
    return "Your access to this workspace is on hold, and an invite can't lift it. Ask the workspace owner to reinstate you.";
  }
  return "You already have a place in this workspace that isn't active, and an invite can't change it. Ask the workspace owner.";
}

function notActive(status: string): SeatRefusal {
  return { ok: false, status: 409, code: "seat_not_active", error: seatNotActiveMessage(status) };
}

/** The seat role an invitation lands: never lower than the seat already is. */
export function landedTenantRole(invited: "admin" | "member", existing: ExistingSeat | null): TenantRole {
  if (!existing) return invited;
  if (existing.is_owner || existing.role === "owner") return existing.role;
  if (invited === "admin") return "admin";
  return existing.role;
}

/** Step 1, before ANY write: refuse a person whose seat in this workspace is not active. */
export async function checkTeamSeat(
  db: ServiceClient,
  args: { userId: string; tenantId: string | null },
): Promise<SeatCheck> {
  if (!args.tenantId) return { ok: true, existing: null };
  const { data, error } = await db
    .from("tenant_members")
    .select(SEAT_COLUMNS)
    .eq("tenant_id", args.tenantId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      code: "seat_check_failed",
      error: "Could not check your place on the team. Nothing was changed. Try again.",
    };
  }
  const existing = (data ?? null) as ExistingSeat | null;
  if (existing && existing.status !== "active") return notActive(existing.status);
  return { ok: true, existing };
}

async function readSeatStatus(db: ServiceClient, tenantId: string, userId: string): Promise<string | null | undefined> {
  const { data, error } = await db
    .from("tenant_members")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return undefined; // unknown
  return (data as { status?: string } | null)?.status ?? null;
}

async function roleHeld(db: ServiceClient, userId: string, role: string): Promise<boolean | undefined> {
  const { data, error } = await db
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", role)
    .maybeSingle();
  if (error) return undefined;
  return !!data;
}

/**
 * Step 2: the seat, then the global role, each checked. `existing` is what checkTeamSeat returned.
 * With no tenant (a platform-wide invitation) only the global role is written.
 */
export async function grantTeamSeat(
  db: ServiceClient,
  args: {
    userId: string;
    tenantId: string | null;
    appRole: string;
    invitedRole: "admin" | "member";
    invitedAt: string;
    nowIso: string;
    existing: ExistingSeat | null;
  },
): Promise<SeatGrant> {
  const failedRole: SeatRefusal = {
    ok: false,
    status: 500,
    code: "role_write_failed",
    error: "Could not finish accepting the invite. Your access wasn't changed. Try again.",
  };

  if (!args.tenantId) {
    const { error } = await db
      .from("user_roles")
      .upsert({ user_id: args.userId, role: args.appRole }, { onConflict: "user_id,role" });
    return error ? failedRole : { ok: true };
  }

  // Whether the global role was already held, so a later undo only removes what this call added.
  const hadRole = await roleHeld(db, args.userId, args.appRole);
  if (hadRole === undefined) return failedRole;

  const landed = landedTenantRole(args.invitedRole, args.existing);
  let seatId = args.existing?.id ?? null;
  const seatChanged = !args.existing || landed !== args.existing.role;

  if (seatChanged) {
    const { data, error } = await db
      .from("tenant_members")
      .upsert(
        {
          tenant_id: args.tenantId,
          user_id: args.userId,
          role: landed,
          status: "active",
          invited_at: args.invitedAt,
          joined_at: args.nowIso,
        },
        { onConflict: "tenant_id,user_id" },
      )
      .select(SEAT_COLUMNS)
      .single();
    if (error) {
      // 42501: a membership guard refused the write. Rule 1b is one (the seat became suspended after
      // the check); the archived-workspace and company-workspace guards are others. Say which.
      if (String(error.code ?? "") === "42501") {
        // EXP08 owner invitations (20271118200008, round 4): the person has an owner invitation to
        // this business waiting, so a seat from any other invitation is refused. The database's own
        // sentence (recognised by its HINT, never by its text) tells them to open that invitation.
        if (error.hint === "OWNER_INVITE_WAITING" && typeof error.message === "string" && error.message.trim()) {
          return { ok: false, status: 409, code: "owner_invite_waiting", error: error.message };
        }
        const now = await readSeatStatus(db, args.tenantId, args.userId);
        if (now && now !== "active") return notActive(now);
        return {
          ok: false,
          status: 403,
          code: "seat_refused",
          error: "This invite can't add you to this workspace. Your access wasn't changed. Ask the workspace owner.",
        };
      }
      return {
        ok: false,
        status: 500,
        code: "seat_write_failed",
        error: "Could not add you to the team. Your access wasn't changed. Try again.",
      };
    }
    const row = data as ExistingSeat | null;
    if (!row || row.status !== "active") return notActive(row?.status ?? "pending");
    seatId = row.id;
  }

  const { error: roleErr } = await db
    .from("user_roles")
    .upsert({ user_id: args.userId, role: args.appRole }, { onConflict: "user_id,role" });
  if (roleErr) {
    // Undo the seat write, so a failed accept leaves the workspace as it was.
    let undone = true;
    if (seatChanged && seatId) {
      if (!args.existing) {
        const { error } = await db.from("tenant_members").delete().eq("id", seatId);
        undone = !error;
      } else {
        const { error } = await db.from("tenant_members").update({ role: args.existing.role }).eq("id", seatId);
        undone = !error;
      }
    }
    if (!undone) {
      return {
        ok: false,
        status: 500,
        code: "partial_accept",
        error: "You were added to the team, but your access level could not be saved. Ask the workspace owner to check your permission.",
      };
    }
    return failedRole;
  }

  // The seat once more: a suspension may have landed between the two writes. A suspension strips the
  // seat's mapped role, but not one written afterwards, so take back what this call added.
  const after = await readSeatStatus(db, args.tenantId, args.userId);
  if (after === undefined) {
    // Unknown, so nothing is taken back on a guess.
    return {
      ok: false,
      status: 500,
      code: "seat_readback_failed",
      error: "Could not confirm your place on the team. Sign in to check, or ask the workspace owner.",
    };
  }
  if (after !== "active") {
    if (!hadRole) {
      const { error } = await db.from("user_roles").delete().eq("user_id", args.userId).eq("role", args.appRole);
      if (error) {
        return {
          ok: false,
          status: 500,
          code: "role_undo_failed",
          error: "Your place on this team is no longer active, and access this invite added could not be taken back. Ask the workspace owner.",
        };
      }
    }
    return notActive(after ?? "pending");
  }
  return { ok: true };
}
