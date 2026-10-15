import { describe, expect, it } from "vitest";
import { accessLabels, portalAccessState, portalNextStep, type PortalInvitation } from "./portalDashboardModel";
import type { RelationshipPerson } from "./useTenantRelationshipsData";
const person = { id: "client-a", email: "client@example.test", linkedUserId: null, doNotContact: false } as RelationshipPerson;
const now = Date.parse("2026-10-15T12:00:00Z");
const invite: PortalInvitation = { id: "invite-a", contact_id: "client-a", email: person.email, created_at: "2026-10-14T12:00:00Z", expires_at: "2026-10-16T12:00:00Z", last_used_at: null, revoked_at: null };
describe("Portal projects canonical evidence without inferring access", () => {
  it("distinguishes a failed/unresolved read from no invitation", () => {
    expect(portalAccessState(person, undefined, now)).toBe("unknown");
    expect(portalAccessState(person, [], now)).toBe("not-invited");
  });
  it("never equates CRM linkage with a portal visit", () => {
    const state = portalAccessState({ ...person, linkedUserId: "user-a" }, undefined, now);
    expect(accessLabels[state]).toBe("Account linked");
  });
  it("does not attach another contact’s invitation", () => expect(portalAccessState(person, [{ ...invite, contact_id: "client-b" }], now)).toBe("not-invited"));
  it.each([
    [invite, "invited"],
    [{ ...invite, expires_at: "2026-10-15T12:00:00Z" }, "expired"],
    [{ ...invite, revoked_at: "2026-10-14T13:00:00Z" }, "canceled"],
    [{ ...invite, last_used_at: "2026-10-14T13:00:00Z" }, "accepted"],
    [{ ...invite, expires_at: "invalid" }, "unknown"],
  ] as const)("projects the saved invitation state %#", (row, state) => expect(portalAccessState(person, [row], now)).toBe(state));
  it("uses the latest ordered record, including a cancellation", () => expect(portalAccessState(person, [{ ...invite, revoked_at: "2026-10-15T10:00:00Z" }, invite], now)).toBe("canceled"));
  it("prioritizes contact preferences over an invitation", () => expect(portalNextStep({ ...person, doNotContact: true }, "not-invited")).toBe("Review contact preferences"));
  it("requires an email before preparing an invitation", () => expect(portalNextStep({ ...person, email: null }, "not-invited")).toBe("Add an email address"));
});
