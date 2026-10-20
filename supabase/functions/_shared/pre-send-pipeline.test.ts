// runPreSend's human-readable reasons (E09 Slice 6): a portal opt-out has its own plain sentence, and the
// existing reasons are unchanged. The suppression/consent dispositions themselves are pinned against the
// shared fixture in consent-parity.test.ts.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runPreSend } from "./pre-send-pipeline.ts";

function admin(reason: string) {
  return {
    from(table: string) {
      const q = {
        select: () => q, eq: () => q, or: () => q, order: () => q,
        limit: async () => ({ data: table === "paige_suppressions" ? [{ id: "s1", reason }] : [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
  };
}

describe("runPreSend suppression reasons", () => {
  const cases: [string, string][] = [
    ["customer_request", "This contact turned off messages on this channel."],
    ["user_stop", "This contact replied STOP and can't be messaged."],
    ["unsubscribe_link", "This contact unsubscribed and can't be messaged."],
    ["complaint", "This contact reported a previous message, so we won't message them."],
    ["bounce_hard", "This address is undeliverable, so we won't retry it."],
    ["manual", "This contact is on the do-not-message list."],
  ];
  for (const [reason, sentence] of cases) {
    it(`${reason} blocks with its own sentence`, async () => {
      const r = await runPreSend(admin(reason) as unknown as Parameters<typeof runPreSend>[0], { tenantId: "t", channel: "email", to: "a@tests.invalid", contactId: null });
      assert.equal(r.outcome, "blocked_suppressed");
      assert.equal(r.reason, sentence);
    });
  }
});
