import type { RelationshipPerson } from "./useTenantRelationshipsData";
import type { PortalInvitationDelivery } from "./portalInvitationEvidence";

/** Read-only projection of canonical invitation records. Never fetch the bearer token. */
export interface PortalInvitation {
  id: string;
  contact_id: string | null;
  email: string | null;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  delivery?: PortalInvitationDelivery;
}

export type PortalAccessState =
  | "linked"
  | "accepted"
  | "invited"
  | "expired"
  | "canceled"
  | "not-invited"
  | "unknown";
export const accessLabels: Record<PortalAccessState, string> = {
  linked: "Account linked",
  accepted: "Invitation accepted",
  invited: "Invitation pending",
  expired: "Invite expired",
  canceled: "Invite canceled",
  "not-invited": "Not invited",
  unknown: "Not checked",
};

export function portalAccessState(
  person: RelationshipPerson,
  invitations: PortalInvitation[] | undefined,
  now: number,
): PortalAccessState {
  // CRM identity linkage is evidence of linkage, never of a successful portal visit.
  if (person.linkedUserId) return "linked";
  if (!invitations) return "unknown";
  const invite = invitations.find((row) => row.contact_id === person.id);
  if (!invite) return "not-invited";
  if (invite.last_used_at) return "accepted";
  if (invite.revoked_at) return "canceled";
  const expires = Date.parse(invite.expires_at);
  return !Number.isFinite(expires)
    ? "unknown"
    : expires <= now
      ? "expired"
      : "invited";
}

export function portalNextStep(
  person: RelationshipPerson,
  access: PortalAccessState,
): string {
  if (person.status && person.status !== "active") return "Review client status";
  if (person.doNotContact) return "Review contact preferences";
  if (!person.email) return "Add an email address";
  if (access === "expired" || access === "canceled") return "Review invitation";
  if (access === "not-invited") return "Prepare an invitation";
  if (access === "invited") return "Awaiting invitation acceptance";
  return "Review client standing";
}
