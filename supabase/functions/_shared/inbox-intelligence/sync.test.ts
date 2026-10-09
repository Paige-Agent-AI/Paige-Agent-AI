// #1140 two-mailbox pilot — the Gmail sync planner: bounded initial window,
// idempotent replay, missed-event reconciliation, never a destructive call.
import { describe, expect, it } from "vitest";
import {
  INITIAL_SYNC_MAX_MESSAGES, INITIAL_SYNC_WINDOW_DAYS, classifyHistoryEvents,
  dedupeKey, deriveThreadKey, gmailHistoryIsExpired, normalizeGmailMessage,
  planInitialSync, type GmailHistoryEvent, type GmailMessageEnvelope,
} from "./sync.ts";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const TENANT = "10000000-0000-4000-8000-000000000001";
const CONNECTOR = "30000000-0000-4000-8000-000000000001";

describe("planInitialSync — bounded by policy", () => {
  it("plans a 14-day, 200-message window", () => {
    const plan = planInitialSync(NOW);
    expect(plan.after.toISOString()).toBe("2026-09-24T12:00:00.000Z");
    expect(plan.maxMessages).toBe(INITIAL_SYNC_MAX_MESSAGES);
    expect(INITIAL_SYNC_WINDOW_DAYS).toBe(14);
    expect(INITIAL_SYNC_MAX_MESSAGES).toBeLessThanOrEqual(200);
  });
});

describe("normalizeGmailMessage — canonical shape + unsubscribe capture", () => {
  const envelope: GmailMessageEnvelope = {
    id: "gmail-m1", threadId: "gmail-t1", internalDate: "1759900000000",
    labelIds: ["INBOX"], snippet: "Hello, when is our call?",
    headers: [
      { name: "From", value: "Dana <dana@client.test>" },
      { name: "To", value: "owner@personal.test" },
      { name: "List-Unsubscribe", value: "<https://news.vendor.test/u/abc>, <mailto:unsub@vendor.test>" },
    ],
  };

  it("maps to the unified NormalizedMessage insert shape with provider id idempotency", () => {
    const n = normalizeGmailMessage(envelope, { tenantId: TENANT, connectorId: CONNECTOR, ownerAddress: "owner@personal.test" });
    expect(n.tenant_id).toBe(TENANT);
    expect(n.connector_id).toBe(CONNECTOR);
    expect(n.direction).toBe("inbound");
    expect(n.status).toBe("received");
    expect(n.provider_message_id).toBe("gmail-m1");
    expect(n.thread_key).toBe(deriveThreadKey(CONNECTOR, "dana@client.test"));
    expect(n.sender).toEqual({ address: "dana@client.test", display_name: "Dana" });
    expect(n.recipients).toEqual([{ address: "owner@personal.test", display_name: null }]);
    expect(n.meta.list_unsubscribe.https).toBe("https://news.vendor.test/u/abc");
    expect(n.meta.list_unsubscribe.mailto).toBe("unsub@vendor.test");
  });

  it("never stores a thread_key from the provider (thread_key is locally derived)", () => {
    const n = normalizeGmailMessage(envelope, { tenantId: TENANT, connectorId: CONNECTOR, ownerAddress: "owner@personal.test" });
    expect(n.thread_key).not.toContain("gmail-t1");
    expect(n.meta.gmail_thread_id).toBe("gmail-t1");
  });

  it("derives a stable counterparty thread key", () => {
    expect(deriveThreadKey(CONNECTOR, "Dana@Client.Test")).toBe(deriveThreadKey(CONNECTOR, "dana@client.test"));
  });

  it("dedupe keys on the provider message id", () => {
    expect(dedupeKey("gmail-m1")).toBe("gmail-m1");
  });
});

describe("history reconciliation — missed events and replay safety", () => {
  it("classifies added/removed events; removed is a soft meta mark, never a delete", () => {
    const events: GmailHistoryEvent[] = [
      { id: 1, messagesAdded: [{ message: { id: "m2", threadId: "t1", labelIds: ["INBOX"] } }] },
      { id: 2, messagesDeleted: [{ message: { id: "m1", threadId: "t1" } }] },
    ];
    const plan = classifyHistoryEvents(events);
    expect(plan.toFetch).toEqual(["m2"]);
    expect(plan.toMarkRemoved).toEqual(["m1"]);
  });

  it("detects an expired history window (404/410) so the engine falls back to bounded re-reconcile", () => {
    expect(gmailHistoryIsExpired(404, {})).toBe(true);
    expect(gmailHistoryIsExpired(410, { error: { message: "history expired" } })).toBe(true);
    expect(gmailHistoryIsExpired(200, {})).toBe(false);
    expect(gmailHistoryIsExpired(403, { error: { message: "quota" } })).toBe(false);
  });
});
