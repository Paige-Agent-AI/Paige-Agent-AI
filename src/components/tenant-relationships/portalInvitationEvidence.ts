import type { PortalInvitation } from "./portalDashboardModel";

export type InvitationDeliveryOutcome = "accepted" | "delivered" | "opened" | "clicked" | "delayed" | "failed" | "pending" | "unknown";
export type InvitationDeliveryEvent = { id: string; status: string; at: string; outcome: InvitationDeliveryOutcome };
export type PortalInvitationDelivery = { history: InvitationDeliveryEvent[]; truncated: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const date = (value: unknown): value is string => typeof value === "string" && value.length <= 64 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const identity = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const outcomes: Record<string, readonly string[]> = {
  sent: ["accepted", "unknown"], delivered: ["delivered"], opened: ["opened"], clicked: ["clicked"],
  delivery_delayed: ["delayed"], failed: ["failed", "unknown"], bounced: ["failed"], complained: ["failed"],
  suppressed: ["failed"], dlq: ["failed"], dropped: ["failed"], pending: ["pending"], unknown: ["unknown"],
};

/** Closed readback only. Native authority owns access; no bearer or provider payload is accepted. */
export function readPortalInvitationHistory(value: unknown, actorId: string, tenantId: string): PortalInvitation[] | null {
  if (!identity(actorId) || !identity(tenantId) || !record(value) || !exact(value, ["actor_id", "tenant_id", "invitations"])
    || value.actor_id !== actorId || value.tenant_id !== tenantId || !Array.isArray(value.invitations) || value.invitations.length > 1000) return null;
  const result: PortalInvitation[] = [], ids = new Set<string>();
  for (const row of value.invitations) {
    if (!record(row) || !exact(row, ["id", "contact_id", "email", "created_at", "expires_at", "last_used_at", "revoked_at", "delivery"])
      || !identity(row.id) || ids.has(row.id) || (row.contact_id !== null && !identity(row.contact_id))
      || (row.email !== null && (typeof row.email !== "string" || row.email.length > 1000))
      || !date(row.created_at) || !date(row.expires_at) || (row.last_used_at !== null && !date(row.last_used_at))
      || (row.revoked_at !== null && !date(row.revoked_at)) || !record(row.delivery)
      || !exact(row.delivery, ["history", "truncated"]) || typeof row.delivery.truncated !== "boolean"
      || !Array.isArray(row.delivery.history) || row.delivery.history.length > 50
      || (row.delivery.truncated && row.delivery.history.length !== 50)) return null;
    const history: InvitationDeliveryEvent[] = [], eventIds = new Set<string>();
    for (const event of row.delivery.history) {
      if (!record(event) || !exact(event, ["id", "status", "at", "outcome"]) || !identity(event.id) || eventIds.has(event.id)
        || !date(event.at) || typeof event.status !== "string" || !Object.prototype.hasOwnProperty.call(outcomes, event.status)
        || typeof event.outcome !== "string" || !outcomes[event.status].includes(event.outcome)) return null;
      eventIds.add(event.id);
      history.push({ id: event.id, status: event.status, at: event.at, outcome: event.outcome as InvitationDeliveryOutcome });
    }
    ids.add(row.id);
    result.push({ id: row.id, contact_id: row.contact_id as string | null, email: row.email as string | null,
      created_at: row.created_at, expires_at: row.expires_at, last_used_at: row.last_used_at as string | null,
      revoked_at: row.revoked_at as string | null, delivery: { history, truncated: row.delivery.truncated } });
  }
  return result;
}

/** A provider report never proves which human opened a message or accepted an invitation. */
export function invitationDeliveryText(event?: InvitationDeliveryEvent): { label: string; detail: string } {
  if (!event) return { label: "Delivery not recorded", detail: "Whether this invitation reached the recipient is unknown." };
  switch (event.outcome) {
    case "accepted": return { label: "Accepted for sending", detail: "The email provider accepted this attempt. Delivery and customer sign-in are not confirmed." };
    case "delivered": return { label: "Delivered", detail: "The recipient’s mail server accepted the email. Customer sign-in is not confirmed." };
    case "opened": return { label: "Open reported", detail: "The email system reported an open. This does not verify the recipient’s identity or sign-in." };
    case "clicked": return { label: "Link click reported", detail: "The email system reported a link click. This does not confirm invitation acceptance or sign-in." };
    case "delayed": return { label: "Delivery delayed", detail: "The email system reported a delay. Delivery is not confirmed." };
    case "failed": return { label: "Delivery failed", detail: "This attempt has a recorded delivery problem. Review the recipient and saved history before another send." };
    case "pending": return { label: "Sending pending", detail: "This attempt is pending. Delivery is not confirmed." };
    default: return { label: "Delivery unknown", detail: "This attempt could not be confirmed. Check its saved history before another send." };
  }
}
