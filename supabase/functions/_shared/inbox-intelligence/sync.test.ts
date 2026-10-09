// #1140 two-mailbox pilot — the Gmail sync planner: bounded initial window,
// idempotent replay, missed-event reconciliation, never a destructive call.
// Deno-native (the ci.yml deno test step).
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  INITIAL_SYNC_MAX_MESSAGES, INITIAL_SYNC_WINDOW_DAYS, classifyHistoryEvents,
  deriveThreadKey, gmailHistoryIsExpired, normalizeGmailMessage,
  planInitialSync, type GmailHistoryEvent, type GmailMessageEnvelope,
} from "./sync.ts";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const TENANT = "10000000-0000-4000-8000-000000000001";
const CONNECTOR = "30000000-0000-4000-8000-000000000001";

Deno.test("initial sync: plans a 14-day, bounded-message window", () => {
  const plan = planInitialSync(NOW);
  assertEquals(plan.after.toISOString(), "2026-09-24T12:00:00.000Z");
  assertEquals(plan.maxMessages, INITIAL_SYNC_MAX_MESSAGES);
  assertEquals(INITIAL_SYNC_WINDOW_DAYS, 14);
  if (INITIAL_SYNC_MAX_MESSAGES > 200) throw new Error("initial window exceeds the 200-message bound");
});

Deno.test("normalize: maps to the unified insert shape with provider-id idempotency + unsubscribe capture", () => {
  const envelope: GmailMessageEnvelope = {
    id: "gmail-m1", threadId: "gmail-t1", internalDate: "1759900000000",
    labelIds: ["INBOX"], snippet: "Hello, when is our call?",
    headers: [
      { name: "From", value: "Dana <dana@client.test>" },
      { name: "To", value: "owner@personal.test" },
      { name: "List-Unsubscribe", value: "<https://news.vendor.test/u/abc>, <mailto:unsub@vendor.test>" },
    ],
  };
  const n = normalizeGmailMessage(envelope, { tenantId: TENANT, connectorId: CONNECTOR, ownerAddress: "owner@personal.test" });
  assertEquals(n.tenant_id, TENANT);
  assertEquals(n.connector_id, CONNECTOR);
  assertEquals(n.direction, "inbound");
  assertEquals(n.status, "received");
  assertEquals(n.provider_message_id, "gmail-m1");
  assertEquals(n.thread_key, deriveThreadKey(CONNECTOR, "dana@client.test"));
  assertEquals(n.sender, { address: "dana@client.test", display_name: "Dana" });
  assertEquals(n.recipients, [{ address: "owner@personal.test", display_name: null }]);
  const meta = n.meta as { list_unsubscribe?: { https: string; mailto: string }; gmail_thread_id: string };
  assertEquals(meta.list_unsubscribe?.https, "https://news.vendor.test/u/abc");
  assertEquals(meta.list_unsubscribe?.mailto, "unsub@vendor.test");
});

Deno.test("normalize: never stores a provider thread id as the canonical thread key", () => {
  const envelope: GmailMessageEnvelope = { id: "m", threadId: "gmail-t1", headers: [{ name: "From", value: "x@y.test" }] };
  const n = normalizeGmailMessage(envelope, { tenantId: TENANT, connectorId: CONNECTOR, ownerAddress: "owner@personal.test" });
  if (n.thread_key.includes("gmail-t1")) throw new Error("provider thread id leaked into thread_key");
  assertEquals((n.meta as { gmail_thread_id: string }).gmail_thread_id, "gmail-t1");
});

Deno.test("normalize: derives a stable counterparty thread key", () => {
  assertEquals(deriveThreadKey(CONNECTOR, "Dana@Client.Test"), deriveThreadKey(CONNECTOR, "dana@client.test"));
});

Deno.test("history: added events fetch, removed events soft-mark — never a delete", () => {
  const events: GmailHistoryEvent[] = [
    { id: 1, messagesAdded: [{ message: { id: "m2", threadId: "t1", labelIds: ["INBOX"] } }] },
    { id: 2, messagesDeleted: [{ message: { id: "m1", threadId: "t1" } }] },
  ];
  const plan = classifyHistoryEvents(events);
  assertEquals(plan.toFetch, ["m2"]);
  assertEquals(plan.toMarkRemoved, ["m1"]);
});

Deno.test("history: detects an expired window (404/410) so the engine falls back to bounded re-reconcile", () => {
  assertEquals(gmailHistoryIsExpired(404, {}), true);
  assertEquals(gmailHistoryIsExpired(410, { error: { message: "history expired" } }), true);
  assertEquals(gmailHistoryIsExpired(200, {}), false);
  assertEquals(gmailHistoryIsExpired(403, { error: { message: "quota" } }), false);
});
