import { describe, expect, it } from "vitest";
import {
  inviteLifecycle,
  memberVisibleIdentity,
  permissionPresentation,
  validateWorkProfile,
} from "./team-workspace-contract";

describe("Solo Team workspace contract", () => {
  it("uses a verified stored name and otherwise identifies the real member by email", () => {
    expect(memberVisibleIdentity({ full_name: "  Avery Brooks  ", email: "avery@example.com" })).toEqual({
      primary: "Avery Brooks",
      secondary: "avery@example.com",
    });
    expect(memberVisibleIdentity({ full_name: "   ", email: "member@example.com" })).toEqual({
      primary: "member@example.com",
      secondary: null,
    });
    expect(memberVisibleIdentity({ full_name: null, email: "  member@example.com  " })).toEqual({
      primary: "member@example.com",
      secondary: null,
    });
  });
  it("keeps custom work identity separate from enforced permission", () => {
    expect(permissionPresentation("admin", false)).toEqual({ label: "Admin", mutable: true });
    expect(permissionPresentation("member", false)).toEqual({ label: "Member", mutable: true });
    expect(permissionPresentation("owner", true)).toEqual({ label: "Owner", mutable: false });
    expect(permissionPresentation("coach", false)).toEqual({ label: "Coach", mutable: false });
  });

  it("validates title and responsibilities without treating either as authority", () => {
    expect(validateWorkProfile("Operations Lead", "Owns delivery quality and weekly planning.")).toEqual({});
    expect(validateWorkProfile("x".repeat(121), "Clear work")).toEqual({ title: "Keep the title to 120 characters or fewer." });
    expect(validateWorkProfile("Client Success", "x".repeat(2001))).toEqual({ responsibilities: "Keep responsibilities to 2,000 characters or fewer." });
  });

  it("derives every invitation lifecycle state deterministically", () => {
    const now = new Date("2026-08-31T12:00:00Z");
    expect(inviteLifecycle({ uses: 1, revoked_at: null, expires_at: "2026-09-01T12:00:00Z" }, now)).toBe("accepted");
    expect(inviteLifecycle({ uses: 0, revoked_at: "2026-08-30T12:00:00Z", expires_at: "2026-09-01T12:00:00Z" }, now)).toBe("revoked");
    expect(inviteLifecycle({ uses: 0, revoked_at: null, expires_at: "2026-08-30T12:00:00Z" }, now)).toBe("expired");
    expect(inviteLifecycle({ uses: 0, revoked_at: null, expires_at: "2026-09-01T12:00:00Z" }, now)).toBe("pending");
  });
});
