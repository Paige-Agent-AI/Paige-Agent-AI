import { describe, expect, it } from "vitest";
import { chatControlRetryDelay, chatIngressPolicy, matchesChatControlHint } from "../../../supabase/functions/_shared/paige-turn/control-transport";

const id = "00000000-0000-4000-8000-000000000001";
const input = { threadId: id, requestIntentId: id, messages: [{ role: "user", content: "Status" }], interactive: { kind: "status" } };
describe("canonical control transport helpers", () => {
  it.each([null, "", "message", "STATUS", "stop,status"])("retains the exact normal ingress for unrecognized hint %j", hint => {
    expect(chatIngressPolicy(hint)).toEqual({ key: "paige-ai-chat", maxRequests: 20 });
  });
  it("declares only bounded separate native keys", () => {
    expect(chatIngressPolicy("status")).toEqual({ key: "paige-ai-chat-status", maxRequests: 120 });
    expect(chatIngressPolicy("stop")).toEqual({ key: "paige-ai-chat-stop", maxRequests: 20 });
  });
  it("preserves legacy/no-hint behavior while requiring canonical hinted controls", () => {
    expect(matchesChatControlHint(null, { ordinary: true }, "message")).toBe(true);
    expect(matchesChatControlHint("status", input, "status")).toBe(true);
    expect(matchesChatControlHint("status", { ...input, interactive: { kind: "status", approvalTurnId: id }, messages: [{ role: "user", content: "Read pending approval status." }] }, "status")).toBe(true);
    expect(matchesChatControlHint("status", { ...input, surfaceContext: { kind: "customer_portal" } }, "status")).toBe(true);
    expect(matchesChatControlHint("stop", { ...input, interactive: { kind: "stop", supersedesIntentId: id }, messages: [{ role: "user", content: "Stop" }] }, "stop")).toBe(true);
  });
  it.each([null, [], { ...input, threadId: null }, { ...input, messages: [{ role: "user", content: "Status", documentFileName: "x" }] },
    { ...input, clientId: null }, { ...input, surfaceContext: { kind: "customer_portal", tenant: id } }, { ...input, interactive: { kind: "status", approved: true } },
  ])("rejects malformed/extra raw control shape %j", raw => expect(matchesChatControlHint("status", raw, "status")).toBe(false));
  it("rejects missing or different validated kind and foreign Stop supersession", () => {
    expect(matchesChatControlHint("status", input, undefined)).toBe(false);
    expect(matchesChatControlHint("status", input, "message")).toBe(false);
    expect(matchesChatControlHint("stop", { ...input, interactive: { kind: "stop", supersedesIntentId: "foreign" }, messages: [{ role: "user", content: "Stop" }] }, "stop")).toBe(false);
  });
  it.each([[null, 60_000], [undefined, 60_000], ["", 60_000], ["invalid", 60_000], ["-1", 60_000], ["Infinity", 60_000], ["0", 1_000], ["10", 10_000], ["0.5", 1_000], ["999999", 300_000]] as const)("bounds Retry-After %j", (raw, expected) => {
    expect(chatControlRetryDelay(raw, Date.UTC(2026, 9, 18))).toBe(expected);
  });
  it("honors bounded HTTP dates and holds a past date at the minimum delay", () => {
    const now = Date.UTC(2026, 9, 18);
    expect(chatControlRetryDelay(new Date(now + 12_000).toUTCString(), now)).toBe(12_000);
    expect(chatControlRetryDelay(new Date(now + 600_000).toUTCString(), now)).toBe(300_000);
    expect(chatControlRetryDelay(new Date(now - 60_000).toUTCString(), now)).toBe(1_000);
  });
});
