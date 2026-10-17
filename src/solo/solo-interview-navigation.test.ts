import { describe, expect, it } from "vitest";
import { interviewConnectionPath, interviewSetupPath, interviewReturnPath, interviewThreadFromSearch } from "./solo-interview-navigation";

describe("existing interview record navigation", () => {
  const thread = "10000000-0000-4000-8000-000000000001";
  it("round-trips only the thread address, without profile values or authority", () => {
    const setup = interviewSetupPath(42, thread);
    expect(setup).toBe(`/solo/42/settings/setup/business-profile?interviewThread=${thread}`);
    expect(interviewReturnPath(42, setup.slice(setup.indexOf("?")))).toBe(`/solo/42/paige/chat?interviewThread=${thread}`);
  });
  it.each(["integrations", "connections", "vault"] as const)("returns from native %s through the current account, not a query-supplied account", destination => {
    const path = interviewConnectionPath("test-tenant-a", destination, thread);
    expect(path).toBe(`/solo/test-tenant-a/settings/${destination}?interviewThread=${thread}`);
    const search = path.slice(path.indexOf("?")) + "&tenantId=foreign&account=foreign&owner=true";
    expect(interviewReturnPath("test-tenant-b", search)).toBe(`/solo/test-tenant-b/paige/chat?interviewThread=${thread}`);
    expect(interviewConnectionPath("test-tenant-a", destination, "not-a-thread")).toBe(`/solo/test-tenant-a/settings/${destination}`);
  });
  it("lands the communications handoff on the Setup People & email subtab with the same thread pointer and return", () => {
    const path = interviewConnectionPath("test-tenant-a", "communications", thread);
    expect(path).toBe(`/solo/test-tenant-a/settings/setup/people-email?interviewThread=${thread}`);
    const search = path.slice(path.indexOf("?")) + "&tenantId=foreign&account=foreign&owner=true";
    expect(interviewReturnPath("test-tenant-b", search)).toBe(`/solo/test-tenant-b/paige/chat?interviewThread=${thread}`);
    expect(interviewConnectionPath("test-tenant-a", "communications", "not-a-thread")).toBe(`/solo/test-tenant-a/settings/setup/people-email`);
  });
  it.each(["?interviewThread=bad", "?interviewThread=", `?interviewThread=${thread}&interviewThread=${thread}`, "?tenantId=other&owner=true"])("rejects ambiguous or invalid pointer %s", search => {
    expect(interviewThreadFromSearch(search)).toBeNull();
    expect(interviewReturnPath(42, search)).toBeNull();
  });
});
