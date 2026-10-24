import { describe, expect, it } from "vitest";
import {
  channelNameProblem,
  incomingAnnouncement,
  mentionCandidates,
  mentionLabel,
  mentionRuns,
  mentionScope,
  newDividerBefore,
  normalizeChannelName,
  parseAdded,
  parseChannelId,
  parseConversationList,
  parseMessagePage,
  parsePosted,
  parseThreadPage,
  refreshLeavesGap,
  refusalMessage,
  resolveMentions,
  type TeamHubConversation,
  type TeamHubMessage,
  type TeamHubPerson,
} from "./team-hub-contract";

const TENANT = "tenant-a";
const person = (over: Partial<TeamHubPerson> = {}): TeamHubPerson => ({
  user_id: "u-dana", display_name: "Dana Reyes", title: "Client lead", permission: "member", ...over,
});
const conversation = (over: Partial<TeamHubConversation> = {}): TeamHubConversation => ({
  id: "c-general", kind: "channel", name: "general", visibility: "team", joined: true,
  member_count: null, member_ids: null, dm_user_id: null, unread: 0, last_message_at: null, ...over,
});
const message = (over: Partial<TeamHubMessage> = {}): TeamHubMessage => ({
  id: "m-1", author_user_id: "u-dana", body: "Hello", created_at: "2026-10-24T10:00:00.000Z",
  parent_message_id: null, reply_count: 0, last_reply_at: null, mentions: [], ...over,
});
const list = (over: Record<string, unknown> = {}) => ({
  ok: true, tenant_id: TENANT, me: { user_id: "u-me" },
  people: [person(), person({ user_id: "u-me", display_name: "Morgan Hale", permission: "owner" })],
  conversations: [conversation()], ...over,
});

describe("response validation", () => {
  it("accepts the documented conversation list", () => {
    const result = parseConversationList(list(), null, TENANT);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.people.map((p) => p.display_name)).toEqual(["Dana Reyes", "Morgan Hale"]);
      expect(result.value.conversations[0]).toMatchObject({ id: "c-general", unread: 0 });
    }
  });

  it("passes refusals through by their documented code", () => {
    for (const code of ["not_member", "unavailable", "scope_changed", "not_found", "invalid", "name_taken", "not_allowed", "too_long"]) {
      expect(parseConversationList({ ok: false, code }, null, TENANT)).toEqual({ kind: "refused", code });
    }
  });

  it("treats anything unexpected as unavailable, never as partial data", () => {
    expect(parseConversationList(null, null, TENANT).kind).toBe("unavailable");
    expect(parseConversationList(list(), { message: "network" }, TENANT).kind).toBe("unavailable");
    expect(parseConversationList({ ok: false, code: "who_knows" }, null, TENANT).kind).toBe("unavailable");
    expect(parseConversationList({ ok: "true" }, null, TENANT).kind).toBe("unavailable");
    // Another workspace's list is never shown.
    expect(parseConversationList(list({ tenant_id: "tenant-b" }), null, TENANT).kind).toBe("unavailable");
    // One malformed row rejects the whole answer.
    expect(parseConversationList(list({ people: [person(), { user_id: "u-x" }] }), null, TENANT).kind).toBe("unavailable");
    expect(parseConversationList(list({ conversations: [conversation({ unread: -1 })] }), null, TENANT).kind).toBe("unavailable");
    expect(parseConversationList(list({ conversations: [conversation({ kind: "dm", dm_user_id: null, visibility: "private", name: null })] }), null, TENANT).kind).toBe("unavailable");
    expect(parseConversationList(list({ conversations: [conversation({ name: null })] }), null, TENANT).kind).toBe("unavailable");
  });

  it("requires member ids on private channels and DMs, and never on team channels (A4)", () => {
    const privateRow = conversation({ id: "c-p", visibility: "private", member_count: 2, member_ids: ["u-me", "u-dana"] });
    const ok = parseConversationList(list({ conversations: [privateRow] }), null, TENANT);
    expect(ok.kind === "ok" && ok.value.conversations[0].member_ids).toEqual(["u-me", "u-dana"]);
    expect(parseConversationList(list({ conversations: [{ ...privateRow, member_ids: undefined }] }), null, TENANT).kind).toBe("unavailable");
    expect(parseConversationList(list({ conversations: [{ ...privateRow, member_ids: ["u-me", 7] }] }), null, TENANT).kind).toBe("unavailable");
    expect(parseConversationList(list({ conversations: [{ ...privateRow, member_count: null }] }), null, TENANT).kind).toBe("unavailable");
    expect(parseConversationList(list({ conversations: [conversation({ member_ids: ["u-me"] })] }), null, TENANT).kind).toBe("unavailable");
    // A team channel row that omits both fields entirely is still the documented shape.
    const { member_count: _count, member_ids: _ids, ...bare } = conversation();
    expect(parseConversationList(list({ conversations: [bare] }), null, TENANT).kind).toBe("ok");
  });

  it("reads thread pages as root plus replies, rejecting a reply from another thread (A7)", () => {
    const channel = { id: "c-general", kind: "channel", name: "general", visibility: "team", joined: true };
    const root = message({ id: "m-root", reply_count: 2 });
    const replies = [message({ id: "r-2", parent_message_id: "m-root" }), message({ id: "r-1", parent_message_id: "m-root" })];
    const page = { ok: true, channel, root, messages: replies, has_more: true };
    const result = parseThreadPage(page, null, "c-general", "m-root");
    expect(result.kind === "ok" && result.value.replies.map((reply) => reply.id)).toEqual(["r-2", "r-1"]);
    expect(result.kind === "ok" && result.value.has_more).toBe(true);
    expect(parseThreadPage(page, null, "c-general", "m-other").kind).toBe("unavailable");
    expect(parseThreadPage({ ...page, messages: [message({ id: "r-x", parent_message_id: "m-elsewhere" })] }, null, "c-general", "m-root").kind).toBe("unavailable");
    expect(parseThreadPage({ ...page, root: message({ id: "m-root", parent_message_id: "m-up" }) }, null, "c-general", "m-root").kind).toBe("unavailable");
    expect(parseThreadPage({ ok: false, code: "not_found" }, null, "c-general", "m-root")).toEqual({ kind: "refused", code: "not_found" });
  });

  it("keeps the server's unavailable apart from a missing answer", () => {
    expect(refusalMessage("unavailable", "read")).toBe("Team Hub isn't available for this account type yet.");
    expect(refusalMessage("no_answer", "create")).toBe("Team Hub couldn't complete that. Try again.");
  });

  it("validates message pages against the channel that was asked for", () => {
    const page = { ok: true, channel: { id: "c-general", kind: "channel", name: "general", visibility: "team", joined: true }, messages: [message()], has_more: false };
    expect(parseMessagePage(page, null, "c-general").kind).toBe("ok");
    expect(parseMessagePage(page, null, "c-other").kind).toBe("unavailable");
    expect(parseMessagePage({ ...page, has_more: "no" }, null, "c-general").kind).toBe("unavailable");
    expect(parseMessagePage({ ...page, messages: [message({ created_at: "not a date" })] }, null, "c-general").kind).toBe("unavailable");
    expect(parseMessagePage({ ...page, messages: [message({ mentions: [42 as unknown as string] })] }, null, "c-general").kind).toBe("unavailable");
  });

  it("reads post, create and add answers strictly", () => {
    expect(parsePosted({ ok: true, message: message(), duplicate: true }, null)).toEqual({ kind: "ok", value: { message: message(), duplicate: true } });
    expect(parsePosted({ ok: true, message: { id: "m-1" } }, null).kind).toBe("unavailable");
    expect(parseChannelId({ ok: true, channel_id: "c-new" }, null)).toEqual({ kind: "ok", value: "c-new" });
    expect(parseChannelId({ ok: true }, null).kind).toBe("unavailable");
    expect(parseAdded({ ok: true, added: 2 }, null)).toEqual({ kind: "ok", value: 2 });
    expect(parseAdded({ ok: true, added: 1.5 }, null).kind).toBe("unavailable");
  });
});

describe("channel names", () => {
  it("normalizes like the server and refuses what it would refuse", () => {
    expect(normalizeChannelName("Kickoff Week")).toBe("kickoff-week");
    expect(channelNameProblem("kickoff-week")).toBeNull();
    expect(channelNameProblem("k")).not.toBeNull();
    expect(channelNameProblem("-kickoff")).not.toBeNull();
    expect(channelNameProblem("a".repeat(31))).not.toBeNull();
    expect(channelNameProblem("")).toBeNull();
  });
});

describe("mentions", () => {
  const samDesign = person({ user_id: "u-sam-d", display_name: "Sam Lee", title: "Designer" });
  const samSales = person({ user_id: "u-sam-s", display_name: "Sam Lee", title: "Sales" });
  const me = person({ user_id: "u-me", display_name: "Morgan Hale", permission: "owner", title: null });
  const people = [person(), samDesign, samSales, me];

  it("tells namesakes apart by title and leaves unique names alone", () => {
    expect(mentionLabel(samDesign, people)).toBe("Sam Lee (Designer)");
    expect(mentionLabel(samSales, people)).toBe("Sam Lee (Sales)");
    expect(mentionLabel(person(), people)).toBe("Dana Reyes");
  });

  it("falls back to permission when namesakes share or lack a title", () => {
    const a = person({ user_id: "a", display_name: "Alex", title: null, permission: "admin" });
    const b = person({ user_id: "b", display_name: "Alex", title: null, permission: "member" });
    expect(mentionLabel(a, [a, b])).toBe("Alex (Admin)");
    expect(mentionLabel(b, [a, b])).toBe("Alex (Member)");
  });

  it("lists only people who can see the conversation, never the author", () => {
    const team = mentionCandidates(mentionScope(conversation()), people, "u-me", "");
    expect(team.map((p) => p.user_id).sort()).toEqual(["u-dana", "u-sam-d", "u-sam-s"]);
    const dm = mentionCandidates(mentionScope(conversation({ kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: ["u-me", "u-dana"], dm_user_id: "u-dana" })), people, "u-me", "");
    expect(dm.map((p) => p.user_id)).toEqual(["u-dana"]);
    // A private channel offers exactly its members (member_ids, A4), never the whole team.
    const leadership = conversation({ visibility: "private", member_count: 2, member_ids: ["u-me", "u-sam-s"] });
    expect(mentionCandidates(mentionScope(leadership), people, "u-me", "").map((p) => p.user_id)).toEqual(["u-sam-s"]);
    expect(mentionCandidates(mentionScope(conversation({ visibility: "private", member_count: 1, member_ids: ["u-me"] })), people, "u-me", "")).toEqual([]);
    expect(mentionCandidates(mentionScope(conversation()), people, "u-me", "sal").map((p) => p.user_id)).toEqual(["u-sam-s"]);
  });

  it("sends only picked people whose label is still in the text", () => {
    const picked = [{ user_id: "u-sam-d", label: "Sam Lee (Designer)" }, { user_id: "u-dana", label: "Dana Reyes" }];
    expect(resolveMentions("@Sam Lee (Designer) can you look?", picked, people)).toEqual({ ok: true, ids: ["u-sam-d"] });
  });

  it("refuses a typed name that matches two people and was not picked", () => {
    const result = resolveMentions("@Sam Lee can you look?", [], people);
    expect(result.ok).toBe(false);
    // A picked namesake does not license an unpicked one in the same message.
    expect(resolveMentions("@Sam Lee (Designer) and @Sam Lee", [{ user_id: "u-sam-d", label: "Sam Lee (Designer)" }], people).ok).toBe(false);
    // A typed unique name without a pick is plain text, not a mention.
    expect(resolveMentions("@Dana Reyes hi", [], people)).toEqual({ ok: true, ids: [] });
  });

  it("highlights only the mentions the server stored", () => {
    expect(mentionRuns("Hi @Dana Reyes and @Sam Lee (Designer)", ["u-dana"], people)).toEqual([
      { text: "Hi ", mention: false }, { text: "@Dana Reyes", mention: true }, { text: " and @Sam Lee (Designer)", mention: false },
    ]);
  });
});

describe("the new divider", () => {
  it("sits above the oldest of the unread messages written by someone else", () => {
    const messages = [
      message({ id: "a" }), message({ id: "b", author_user_id: "u-other" }),
      message({ id: "c", author_user_id: "u-me" }), message({ id: "d", author_user_id: "u-other" }),
    ];
    expect(newDividerBefore(messages, 2, "u-me")).toBe("b");
    expect(newDividerBefore(messages, 1, "u-me")).toBe("d");
    expect(newDividerBefore(messages, 0, "u-me")).toBeNull();
  });
});

describe("refresh joining (A6 order)", () => {
  const held = [message({ id: "m-a", created_at: "2026-10-24T10:00:00.000Z" }), message({ id: "m-b", created_at: "2026-10-24T10:05:00.000Z" })];
  it("finds a gap only when the newest page has more and is entirely newer than what is held", () => {
    const newer = [message({ id: "m-d", created_at: "2026-10-24T11:00:00.000Z" }), message({ id: "m-c", created_at: "2026-10-24T10:30:00.000Z" })];
    expect(refreshLeavesGap(held, newer, true)).toBe(true);
    expect(refreshLeavesGap(held, newer, false)).toBe(false);
    const overlapping = [newer[0], held[1]];
    expect(refreshLeavesGap(held, overlapping, true)).toBe(false);
    expect(refreshLeavesGap([], newer, true)).toBe(true);
    expect(refreshLeavesGap(held, [], true)).toBe(false);
  });
  it("breaks a created_at tie by id, as the server's cursor does", () => {
    const tie = [message({ id: "m-c", created_at: "2026-10-24T10:05:00.000Z" })];
    expect(refreshLeavesGap(held, tie, true)).toBe(true);
    expect(refreshLeavesGap(held, [message({ id: "m-a2", created_at: "2026-10-24T10:05:00.000Z" })], true)).toBe(false);
  });
  it("announces counts, never text, and a floor after a gap", () => {
    expect(incomingAnnouncement(0, 0)).toBeNull();
    expect(incomingAnnouncement(1, 0)).toBe("1 new message");
    expect(incomingAnnouncement(2, 1)).toBe("2 new messages, 1 new reply in the thread");
    expect(incomingAnnouncement(50, 0, true)).toBe("50 or more new messages");
  });
});
