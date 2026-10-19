import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { describeBlockedReason, type ClientOnboardingStatus } from "./useClientOnboardingStatus";

// E09 Slice 7 (review MEDIUM-7e): an ENDED client has no link, so "hasn't accepted their invite yet"
// would misdescribe them. The owner reads what actually happened.
const base: ClientOnboardingStatus = { contact_id: "c", linked_user_id: null, invite_accepted_at: "2026-10-01T00:00:00Z", password_set_at: null, agreement_signed_at: null, intake_submitted_at: null, stage: null, ready: false };
describe("View as Client — why it is unavailable", () => {
  it("names ended access instead of a never-accepted invitation", () => {
    expect(describeBlockedReason({ ...base, portal_access_state: "ended" })).toBe("Their portal access has ended");
  });
  it("names paused access when the view is unavailable", () => {
    expect(describeBlockedReason({ ...base, linked_user_id: "u", portal_access_state: "paused" })).toBe("Their portal access is paused");
  });
  it("is unchanged for an open client", () => {
    expect(describeBlockedReason({ ...base, portal_access_state: "open" })).toBe("Client hasn't accepted their invite yet");
    expect(describeBlockedReason({ ...base, linked_user_id: "u", ready: true, portal_access_state: "open" })).toBeNull();
  });
});
