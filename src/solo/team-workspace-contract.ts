export type TeamPermission = "owner" | "admin" | "member" | string;
export type InviteLifecycle = "pending" | "accepted" | "expired" | "revoked";

export type TeamMemberRecord = {
  membership_id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  status: string;
  permission: TeamPermission;
  is_owner: boolean;
  job_title: string | null;
  responsibilities: string | null;
  last_sign_in_at: string | null;
};

/**
 * What the provider told us about one invitation email, joined server-side by
 * `get_solo_team_workspace`. NULL is a real and common answer: an invitation created before the
 * send was ever recorded has no delivery, and saying so is the honest reading. It must never be
 * rendered as "sent" — the whole reason this exists is that "the POST was accepted" was being
 * shown as though it meant delivered.
 */
export type InviteDelivery = {
  status: string;
  at: string;
  error: string | null;
  history: { status: string; at: string }[];
};

export type TeamInviteRecord = {
  id: string;
  email: string | null;
  permission: TeamPermission;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  uses: number;
  token?: string | null;
  delivery?: InviteDelivery | null;
};

/** The stages an invitation email passes through, in the order a person reads them. */
export const DELIVERY_STEPS = ["sent", "delivered", "opened", "clicked"] as const;

/**
 * What to SAY about a delivery state, and whether it is a problem.
 *
 * Deliberately not a lookup that falls through to the raw provider word: an unrecognised status
 * shown verbatim would put provider vocabulary in front of an operator, and this surface has
 * already had to remove backend text from its refusals once.
 */
export function deliveryPresentation(delivery: InviteDelivery | null | undefined): {
  label: string;
  tone: "none" | "progress" | "good" | "bad";
  detail: string | null;
} {
  if (!delivery) {
    // "Not sent yet" was a FALSE claim, and the owner's own revoked invitation is the case that
    // proves it: every invitation emailed before this feature existed has no `email_send_log` row,
    // because the previous sender never wrote one. Absence of a record cannot distinguish an email
    // that was never sent from one that was sent and never observed — so say exactly that, and
    // nothing stronger. Asserting "not sent" about an email that WAS sent is the same class of
    // over-claim this whole surface was built to remove.
    return {
      label: "Delivery not recorded",
      tone: "none",
      detail: "Nothing was recorded for this invitation, so whether it reached anyone is unknown.",
    };
  }
  switch (delivery.status) {
    case "sent":
      return { label: "Sent", tone: "progress", detail: "Handed to the email provider. Not yet confirmed as delivered." };
    case "delivered":
      return { label: "Delivered", tone: "good", detail: "Accepted by the recipient's mail server." };
    case "opened":
      return { label: "Opened", tone: "good", detail: "The invitation email was opened." };
    case "clicked":
      return { label: "Link clicked", tone: "good", detail: "The recipient opened the join link." };
    case "delivery_delayed":
      return { label: "Delayed", tone: "progress", detail: "The mail server is retrying. This often clears on its own." };
    case "bounced":
      return { label: "Bounced", tone: "bad", detail: delivery.error ?? "The address rejected it. Check the spelling and invite again." };
    case "complained":
      return { label: "Marked as spam", tone: "bad", detail: "The recipient reported it. Reach them another way before resending." };
    case "suppressed":
      return { label: "Not sent — address suppressed", tone: "bad", detail: "This address previously bounced or complained, so it was not emailed." };
    case "failed":
      return { label: "Could not send", tone: "bad", detail: delivery.error ?? "The provider refused it. Try again, or share the link directly." };
    default:
      // An unmodelled status is reported as unknown rather than printed raw.
      return { label: "Unknown", tone: "none", detail: "The provider reported a status this screen does not recognise." };
  }
}

export type TeamWorkspaceRecord = {
  tenant_id: string;
  tenant_name: string;
  viewer_permission: TeamPermission;
  can_manage_profiles: boolean;
  can_manage_invitations: boolean;
  can_change_permissions: boolean;
  total_members: number;
  members: TeamMemberRecord[];
  invitations: TeamInviteRecord[];
};

/** Who may change this person's addresses. The server decides for real (`set_user_contact_methods`);
 *  this only decides what to offer, and mirrors the same rule: yourself; an owner, anyone on the team;
 *  an admin, anyone but the owner. */
export function contactAccess(member: Pick<TeamMemberRecord, "user_id" | "is_owner">, workspace: Pick<TeamWorkspaceRecord, "viewer_permission">, viewerId: string | null): "edit" | "read" | "hidden" {
  if (viewerId && member.user_id === viewerId) return "edit";
  if (workspace.viewer_permission === "owner") return "edit";
  if (workspace.viewer_permission === "admin") return member.is_owner ? "read" : "edit";
  return "hidden";
}

export function memberVisibleIdentity(member: Pick<TeamMemberRecord, "full_name" | "email">): { primary: string; secondary: string | null } {
  const verifiedName = member.full_name?.trim();
  const email = member.email?.trim();
  if (verifiedName) return { primary: verifiedName, secondary: email || null };
  if (email) return { primary: email, secondary: null };
  return { primary: "Team member", secondary: null };
}

export function permissionPresentation(permission: TeamPermission, isOwner: boolean): { label: string; mutable: boolean } {
  if (isOwner || permission === "owner") return { label: "Owner", mutable: false };
  if (permission === "admin") return { label: "Admin", mutable: true };
  if (permission === "member") return { label: "Member", mutable: true };
  // Existing specialized permissions remain truthful and visible, but this Solo
  // surface does not invent or reassign capabilities it does not own.
  return { label: permission ? permission.charAt(0).toUpperCase() + permission.slice(1).replace(/_/g, " ") : "Member", mutable: false };
}

/**
 * What the screen says when a removal does not go through.
 *
 * WHY THIS EXISTS RATHER THAN PRINTING `error.message`. The neighbouring controls surface the raw
 * Postgres string, which is fine while the refusal is one this product authored and wrong the
 * moment it is not: a trigger deeper down answers with things like
 * `OWNER_GUARD: tenant ownership may only be changed via grant_co_owner()/revoke_co_owner()`, and
 * backend identifiers are not product copy. So the reasons this seam authors are recognised, and
 * everything else degrades to an honest sentence that promises nothing about the cause.
 *
 * `reconciled` marks the one refusal that is not a failure: the person was already gone, so the
 * roster is simply behind. It must never be reported as a removal this owner performed.
 * `retryable` is false wherever trying again would refuse identically — offering a Try again that
 * cannot succeed is a worse answer than saying so.
 */
export type RemovalRefusal = { message: string; retryable: boolean; reconciled: boolean };

export function removalRefusal(raw: string | null | undefined, personName: string, workspaceName: string): RemovalRefusal {
  const text = (raw ?? "").toLowerCase();
  const known: Array<[RegExp, RemovalRefusal]> = [
    [/only the workspace owner/, { message: "Only the workspace owner can remove people from this workspace.", retryable: false, reconciled: false }],
    [/an owner cannot be removed/, { message: `${personName} is an owner of ${workspaceName}, and an owner can't be removed here.`, retryable: false, reconciled: false }],
    [/cannot remove yourself/, { message: "You can't remove yourself from this workspace.", retryable: false, reconciled: false }],
    // Named, not located. This sentence can outlive the dialog it was raised in, so "on this
    // screen" stops being true the moment it does; the workspace it is about never stops being true.
    [/only an admin or a member/, { message: `${personName}'s access level isn't one ${workspaceName}'s team settings can change, so nothing was changed.`, retryable: false, reconciled: false }],
    [/active workspace changed/, { message: `Your active workspace changed before this could run, so nothing was removed. Open ${workspaceName} again to try.`, retryable: false, reconciled: false }],
    // The seam raises this for a missing ACTOR *or* a missing active WORKSPACE, and they are not the
    // same thing: platform staff who used Exit tenant, or an owner whose membership went inactive,
    // still have a perfectly good session. Telling them to sign in again is both untrue and useless.
    // One sentence that is true of both, rather than a guess at which.
    [/authentication required/, { message: "This did not run, and nothing was removed. Reopen Team — or sign in again if you have been signed out.", retryable: false, reconciled: false }],
    [/not on this workspace/, { message: `${personName} is no longer on this team. Nothing further was changed.`, retryable: false, reconciled: true }],
    [/cannot remove admin role from platform owner/, { message: `${personName} holds a platform role that can't be given up here, so nothing was changed.`, retryable: false, reconciled: false }],
  ];
  for (const [pattern, refusal] of known) if (pattern.test(text)) return refusal;

  // THE DEFAULT IS NOT RETRYABLE, and that is the opposite of what it was. An unrecognised message
  // is, by definition, one we cannot promise will clear — and a real one proves it: removing a
  // tenant Admin cascades into trg_sync_tenant_member_to_user_roles, which deletes their global
  // `admin` grant, which fires protect_owner_admin. When the target is the platform owner that
  // raises and the whole removal aborts, every time. Offering "Try again" there is an invitation to
  // press a button that cannot work.
  //
  // Only a TRANSPORT failure earns a retry, because only a transport failure is plausibly
  // transient. Everything else is the server having decided something, and deciding again will
  // decide the same.
  //
  // ...and this branch must NOT claim that nothing changed, which is what it used to say. These are
  // exactly the failures where the DELETE may have COMMITTED and only the reply was lost — a lost
  // response is not a refused write. "Nothing changed" is a statement about the database that the
  // client is in no position to make here, and it is the same class of false sentence this surface
  // keeps having to close. The unrecognised-server-refusal branch below DOES keep it, because there
  // the server decided and nothing was written. Retrying is still safe and still offered: a second
  // call against an already-removed person answers "not on this workspace's team", which maps to the
  // reconciled branch and tells the truth either way.
  // A statement timeout is the SERVER deciding, not the network failing: Postgres cancels the
  // statement and the whole function's transaction rolls back, so nothing was written and we can say
  // so. It has to be told apart from a lost response BEFORE the transport test below, whose
  // `timeout|timed out` would otherwise swallow it and assert a network fact that is simply untrue —
  // the same lie this branch was just repaired to stop telling, one case over. Reachable here rather
  // than theoretical: the RPC takes `FOR UPDATE` on the membership row, which blocks behind a
  // concurrent co-owner grant, which is exactly what that lock is for.
  // BOTH cancellations, not just the one named in the comment below. `lock_timeout` is what cuts
  // the FOR UPDATE wait this branch exists for, and its message says "lock timeout" — which misses
  // /statement timeout/ and hits /timeout/ in the transport test, putting it straight back into the
  // sentence this branch was written to stop telling. Fixing one and leaving its named sibling was
  // the miss.
  if (/canceling statement due to (statement|lock) timeout/i.test(text)) {
    return { message: `That took too long and was cancelled, so nothing changed — ${personName} is still on this team.`, retryable: true, reconciled: false };
  }
  if (/failed to fetch|networkerror|network request|network error|timeout|timed out|aborted|econnreset|load failed/i.test(text)) {
    return { message: `We could not reach the server, so we can't say whether ${personName} was removed. Try again, or reopen Team to see the current roster.`, retryable: true, reconciled: false };
  }
  return { message: `Nothing changed — ${personName} is still on this team. Reopen Team to see the current roster.`, retryable: false, reconciled: false };
}

export function validateWorkProfile(title: string, responsibilities: string): { title?: string; responsibilities?: string } {
  const errors: { title?: string; responsibilities?: string } = {};
  if (title.trim().length > 120) errors.title = "Keep the title to 120 characters or fewer.";
  if (responsibilities.trim().length > 2_000) errors.responsibilities = "Keep responsibilities to 2,000 characters or fewer.";
  return errors;
}

/**
 * Whether an invitation is finished with — the test the screen uses to move it out of the active
 * list, and the same test the database uses to decide whether it may be cleared. Kept as one
 * expression so the two cannot drift: a row the screen files under "past" that the server then
 * refuses to archive would be a dead button.
 */
export function inviteIsFinished(invite: Pick<TeamInviteRecord, "uses" | "revoked_at" | "expires_at">, now = new Date()): boolean {
  return inviteLifecycle(invite, now) !== "pending";
}

export function inviteLifecycle(invite: Pick<TeamInviteRecord, "uses" | "revoked_at" | "expires_at">, now = new Date()): InviteLifecycle {
  if (invite.uses > 0) return "accepted";
  if (invite.revoked_at) return "revoked";
  if (new Date(invite.expires_at).getTime() <= now.getTime()) return "expired";
  return "pending";
}

export function normalizeTeamWorkspace(value: unknown): TeamWorkspaceRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TeamWorkspaceRecord>;
  if (!row.tenant_id || !Array.isArray(row.members) || !Array.isArray(row.invitations)) return null;
  return {
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name || "This workspace",
    viewer_permission: row.viewer_permission || "member",
    can_manage_profiles: row.can_manage_profiles === true,
    can_manage_invitations: row.can_manage_invitations === true,
    can_change_permissions: row.can_change_permissions === true,
    total_members: Number(row.total_members) || 0,
    members: row.members,
    invitations: row.invitations,
  };
}

/**
 * The server's own sentence for a refused invitation.
 *
 * WHY THIS IS NEEDED AT ALL. `supabase.functions.invoke()` returns every non-2xx as
 * `{ data: null, error }` where `error.message` is the FRAMEWORK CONSTANT
 * "Edge Function returned a non-2xx status code" and the honest body sits on
 * `error.context`. A call site that reads `data?.error || error?.message` therefore shows
 * that constant for EVERY refusal — so the operator who used to be told something false was,
 * after the seam was repaired, going to be told nothing at all. Extracting the body is
 * `readFunctionErrorBody`'s job (§18, one home); this decides what to SAY with it.
 *
 * The refusals this seam raises are already written for a person ("only an owner or admin may
 * manage team invitations in that workspace"), so they are shown verbatim rather than mapped
 * to generic copy — mapping them would throw away the precision the repair exists to provide.
 */
export function invitationRefusalMessage(
  body: Record<string, unknown> | null,
  fallback: string,
): string {
  const raw = body?.error;
  const sentence = typeof raw === "string" ? raw.trim() : "";
  // Never echo the framework constant back at a person, whatever path it arrived by.
  if (sentence && !/non-2xx status code/i.test(sentence)) return sentence;
  return fallback;
}
