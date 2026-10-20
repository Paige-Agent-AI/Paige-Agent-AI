import { describe, expect, it } from "vitest";
import { readPortalInvitationHistory, invitationDeliveryText } from "./portalInvitationEvidence";
const actor = "e0911000-0000-0000-0000-000000000001";
const tenant = "e0921000-0000-0000-0000-000000000001";
const id = "e0941000-0000-0000-0000-000000000001";
const at = "2026-10-15T12:00:00Z";
const event = { id, at, status: "sent", outcome: "accepted" };
const invite = { id, contact_id: "e0931000-0000-0000-0000-000000000001", email: "client@example.test", created_at: at,
  expires_at: at, last_used_at: null, revoked_at: null, delivery: { history: [event], truncated: false } };
const envelope = () => ({ actor_id: actor, tenant_id: tenant, invitations: [structuredClone(invite)] });
describe("closed owner invitation evidence", () => {
  it("accepts the exact native scope and separates provider acceptance from delivery", () => {
    const result = readPortalInvitationHistory(envelope(), actor, tenant);
    expect(result).toEqual([invite]);
    expect(invitationDeliveryText(result![0].delivery!.history[0])).toEqual({ label: "Accepted for sending", detail: "The email provider accepted this attempt. Delivery and customer sign-in are not confirmed." });
  });
  it("never infers no send from a missing receipt", () => expect(invitationDeliveryText()).toEqual({ label: "Delivery not recorded", detail: "Whether this invitation reached the recipient is unknown." }));
  it("keeps uncertain transport outcomes unknown", () => expect(invitationDeliveryText({ ...event, status: "failed", outcome: "unknown" })).toEqual({ label: "Delivery unknown", detail: "This attempt could not be confirmed. Check its saved history before another send." }));
  it.each(["token", "join_url", "metadata", "error_message", "provider_secret"])("rejects widened record %s", key => {
    const value = envelope(); Object.assign(value.invitations[0], { [key]: "private" });
    expect(readPortalInvitationHistory(value, actor, tenant)).toBeNull();
  });
  it.each(["actor_id", "tenant_id"])("rejects foreign %s", key => {
    const value = { ...envelope(), [key]: id }; expect(readPortalInvitationHistory(value, actor, tenant)).toBeNull();
  });
  it("rejects widened envelope, malformed rows, duplicate identities and truncated aggregates", () => {
    expect(readPortalInvitationHistory({ ...envelope(), token: "private" }, actor, tenant)).toBeNull();
    for (const patch of [{ id: "invalid" }, { expires_at: "invalid" }, { contact_id: "wrong" }, { email: {} }, { delivery: null }]) {
      const value = envelope(); Object.assign(value.invitations[0], patch); expect(readPortalInvitationHistory(value, actor, tenant)).toBeNull();
    }
    expect(readPortalInvitationHistory({ ...envelope(), invitations: [invite, invite] }, actor, tenant)).toBeNull();
    expect(readPortalInvitationHistory({ ...envelope(), invitations: Array(1001).fill(invite) }, actor, tenant)).toBeNull();
  });
  it("rejects malformed, widened, oversized or contradictory event histories", () => {
    for (const history of [[{ ...event, at: "invalid" }], [{ ...event, token: "secret" }], [{ ...event, status: "sent", outcome: "delivered" }], [event, event], Array(51).fill(event)]) {
      const value = envelope(); Object.assign(value.invitations[0].delivery, { history }); expect(readPortalInvitationHistory(value, actor, tenant)).toBeNull();
    }
  });
  it.each([
    ["delivered", "delivered", "Delivered"], ["opened", "opened", "Open reported"], ["clicked", "clicked", "Link click reported"],
    ["delivery_delayed", "delayed", "Delivery delayed"], ["failed", "failed", "Delivery failed"], ["bounced", "failed", "Delivery failed"],
    ["suppressed", "failed", "Delivery failed"], ["pending", "pending", "Sending pending"], ["unknown", "unknown", "Delivery unknown"],
  ])("renders saved %s without claiming customer acceptance", (status, outcome, label) => {
    const value = envelope(); Object.assign(value.invitations[0].delivery.history[0], { status, outcome });
    const read = readPortalInvitationHistory(value, actor, tenant); expect(read).not.toBeNull();
    expect(invitationDeliveryText(read![0].delivery!.history[0]).label).toBe(label);
  });
  it("preserves explicit bounded-history warning and nullable historic bindings", () => {
    const value = envelope(); Object.assign(value.invitations[0], { email: null, contact_id: null }); value.invitations[0].delivery.truncated = true;
    value.invitations[0].delivery.history = Array.from({ length: 50 }, (_, i) => ({ ...event, id: "e0951000-0000-0000-0000-" + String(i + 1).padStart(12, "0") }));
    expect(readPortalInvitationHistory(value, actor, tenant)?.[0].delivery?.truncated).toBe(true);
  });
  it("refuses an inconsistent truncation claim instead of showing a false count", () => {
    const value = envelope(); value.invitations[0].delivery.truncated = true;
    expect(readPortalInvitationHistory(value, actor, tenant)).toBeNull();
  });
});
