import { describe, expect, it } from "vitest";
import { interviewSetupPath, interviewReturnPath, interviewThreadFromSearch } from "./solo-interview-navigation";

describe("existing interview record navigation", () => {
  const thread = "10000000-0000-4000-8000-000000000001";
  it("round-trips only the thread address, without profile values or authority", () => {
    const setup = interviewSetupPath(42, thread);
    expect(setup).toBe(`/solo/42/settings/setup/business-profile?interviewThread=${thread}`);
    expect(interviewReturnPath(42, setup.slice(setup.indexOf("?")))).toBe(`/solo/42/paige/chat?interviewThread=${thread}`);
  });
  it.each(["?interviewThread=bad", "?interviewThread=", `?interviewThread=${thread}&interviewThread=${thread}`, "?tenantId=other&owner=true"])("rejects ambiguous or invalid pointer %s", search => {
    expect(interviewThreadFromSearch(search)).toBeNull();
    expect(interviewReturnPath(42, search)).toBeNull();
  });
});
