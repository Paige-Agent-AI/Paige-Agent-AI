/**
 * EXP08 Team Hub agents (A1b): the pure rules behind agent identity, mentions, the private-part line,
 * Bring in, and the agent-turn answer. jsdom-free; the workspace states are in the mocked-RPC suite.
 */
import { describe, expect, it } from "vitest";
import {
  agentMentionsIn,
  agentOutcomeLine,
  agentRuns,
  agentTurnBody,
  answers,
  askingMessageIds,
  bringInSuggestions,
  FIXED_PRIVATE_LINE,
  parseAgentTurn,
  parseBringIn,
  parseTurnStates,
  splitPrivateLine,
  TEAM_HUB_AGENT_PROFILES,
} from "./team-hub-agents";
import { TEAM_HUB_AGENT_KEYS } from "./team-hub-contract";

const agentRow = (over: Record<string, unknown> = {}) => ({
  id: "m-reply", author_user_id: "u-me", body: "Two hooks.", created_at: "2026-10-27T10:00:00Z", parent_message_id: null,
  reply_count: 0, last_reply_at: null, mentions: [], files: [], work_ref: null,
  author_kind: "agent", agent_key: "nexus", asked_in_message_id: "m-ask", agent_mentions: [], ...over,
});
const request = { conversationId: "c-launch", sourceMessageId: "m-ask", threadRootId: null, agent: "nexus" as const };

describe("the roster's presentation", () => {
  it("names all seven agents in capitals, each with a role line that starts with its short role", () => {
    expect(TEAM_HUB_AGENT_KEYS.map((key) => TEAM_HUB_AGENT_PROFILES[key].name)).toEqual(["PAIGE", "VERA", "NEXUS", "CURA", "MENTOR", "MERIT", "ZION"]);
    for (const key of TEAM_HUB_AGENT_KEYS) {
      const profile = TEAM_HUB_AGENT_PROFILES[key];
      expect(profile.role.startsWith(profile.short), key).toBe(true);
    }
    // MERIT is Sales & getting paid (owner-confirmed 2026-10-27).
    expect(TEAM_HUB_AGENT_PROFILES.merit.short).toBe("Sales & getting paid");
  });

  it("carries no funding or credit wording in any agent's default copy (§2)", () => {
    const all = JSON.stringify(TEAM_HUB_AGENT_PROFILES).toLowerCase();
    expect(all).not.toMatch(/\b(credit|funding|loan|lender|lending|financing)\b/);
  });
});

describe("agentMentionsIn", () => {
  it("finds @NAME in capitals as a whole word, in the order written, once each", () => {
    expect(agentMentionsIn("@CURA who's onboarding? and @NEXUS, @CURA again")).toEqual(["cura", "nexus"]);
    expect(agentMentionsIn("(@ZION) take this")).toEqual(["zion"]);
  });

  it("ignores lowercase names, longer words, email addresses and a picked person's label", () => {
    expect(agentMentionsIn("@vera can you check")).toEqual([]);
    expect(agentMentionsIn("@VERAS and @MERITS")).toEqual([]);
    expect(agentMentionsIn("write to ops@ZION.example")).toEqual([]);
    expect(agentMentionsIn("thanks @VERA Smith", ["VERA Smith"])).toEqual([]);
    expect(agentMentionsIn("thanks @VERA Smith and @MERIT", ["VERA Smith"])).toEqual(["merit"]);
  });
});

describe("agentRuns", () => {
  it("chips only the agents a person's message stored as asked", () => {
    expect(agentRuns("@CURA and @NEXUS, please", new Set(["cura"] as const))).toEqual([
      { text: "@CURA", agent: "cura" }, { text: " and @NEXUS, please" }]);
  });

  it("chips any of the seven in an agent's own text", () => {
    expect(agentRuns("I'd put @NEXUS on it.", "all")).toEqual([{ text: "I'd put " }, { text: "@NEXUS", agent: "nexus" }, { text: " on it." }]);
  });
});

describe("splitPrivateLine", () => {
  it("separates the post door's fixed line from the agent's own words", () => {
    expect(splitPrivateLine(`For the room: judge it on clients won.\n\n${FIXED_PRIVATE_LINE}`)).toEqual({ text: "For the room: judge it on clients won.", privatePart: true });
    expect(splitPrivateLine(FIXED_PRIVATE_LINE)).toEqual({ text: "", privatePart: true });
    expect(splitPrivateLine("No private part.")).toEqual({ text: "No private part.", privatePart: false });
  });
});

describe("bringInSuggestions (flow 3)", () => {
  it("offers only the agents the reply's agent suggested, each prefilled exactly as approved: the mention, then its one line", () => {
    const stored = [{ agent: "nexus" as const, context: "PAIGE suggested you take the workshop announcement." },
      { agent: "zion" as const, context: "PAIGE suggested you take the launch task plan." }];
    const out = bringInSuggestions({ agent_key: "paige" }, stored, ["cura"]);
    expect(out).toEqual([
      { agent: "nexus", prefill: "@NEXUS PAIGE suggested you take the workshop announcement." },
      { agent: "zion", prefill: "@ZION PAIGE suggested you take the launch task plan." }]);
    // The prefill asks exactly one agent.
    expect(agentMentionsIn(out[0].prefill)).toEqual(["nexus"]);
  });
  it("never offers the replying agent or one the question already asked, and never reads the reply's text", () => {
    expect(bringInSuggestions({ agent_key: "paige" }, [{ agent: "paige", context: "x" }, { agent: "cura", context: "y" }], ["cura"])).toEqual([]);
    // A reply that names agents in its text but suggested nobody offers nobody.
    expect(bringInSuggestions({ agent_key: "paige" }, [])).toEqual([]);
  });
  it("a suggestion without its line (another viewer's read) still names who; the asker's fallback is the approved default", () => {
    expect(bringInSuggestions({ agent_key: "merit" }, [{ agent: "nexus", context: null }])[0].prefill).toBe("@NEXUS MERIT suggested you take this.");
  });
});

describe("parseBringIn", () => {
  it("accepts at most three distinct agents of the seven, with one-line contexts for the asker or none for anyone else", () => {
    expect(parseBringIn([{ agent: "nexus", context: "A line." }], true)).toEqual([{ agent: "nexus", context: "A line." }]);
    expect(parseBringIn([{ agent: "nexus" }], false)).toEqual([{ agent: "nexus", context: null }]);
    expect(parseBringIn(undefined, true)).toEqual([]);
    for (const bad of [[{ agent: "bogus", context: "x" }], [{ agent: "nexus", context: "a\nb" }], [{ agent: "nexus", context: "" }],
      [{ agent: "nexus", context: "x" }, { agent: "nexus", context: "y" }], "nexus",
      [{ agent: "nexus", context: "a" }, { agent: "vera", context: "b" }, { agent: "zion", context: "c" }, { agent: "cura", context: "d" }]]) {
      expect(parseBringIn(bad, true)).toBeNull();
    }
    expect(parseBringIn([{ agent: "nexus", context: "x" }], false)).toBeNull();
  });
});

describe("parseTurnStates (the member-safe read)", () => {
  it("keys each row by question and agent, and drops a malformed row rather than guessing", () => {
    const states = parseTurnStates({ ok: true, states: [
      { message_id: "m-1", agent_key: "cura", state: "answering", private_part: false, asker_name: "Sam Lee" },
      { message_id: "m-2", agent_key: "merit", state: "replied_privately", private_part: true, asker_name: "Sam Lee" },
      { message_id: "m-3", agent_key: "paige", state: "replied", private_part: false, asker_name: "Sam Lee", bring_in: [{ agent: "nexus" }] },
      { message_id: "m-4", agent_key: "cura", state: "exploded", private_part: false, asker_name: "Sam Lee" },
      { message_id: "m-5", agent_key: "bogus", state: "none", private_part: false, asker_name: "Sam Lee" },
    ] }, null);
    expect(Object.keys(states ?? {})).toEqual(["m-1:cura", "m-2:merit", "m-3:paige"]);
    expect(states?.["m-3:paige"].bringIn).toEqual([{ agent: "nexus", context: null }]);
    expect(states?.["m-2:merit"]).toMatchObject({ state: "replied_privately", privatePart: true, askerName: "Sam Lee" });
  });
  it("a failed or refused read is null, so the screen never invents a state", () => {
    expect(parseTurnStates(null, { message: "boom" })).toBeNull();
    expect(parseTurnStates({ ok: false, code: "not_found" }, null)).toBeNull();
    expect(parseTurnStates({ ok: true }, null)).toBeNull();
  });
  it("asks about a person's questions that name agents, or every person message in an agent DM", () => {
    const msgs = [{ id: "a", author_kind: "user", agent_mentions: ["cura"] }, { id: "b", author_kind: "user", agent_mentions: [] },
      { id: "c", author_kind: "agent", agent_mentions: [] }] as unknown as Parameters<typeof askingMessageIds>[0];
    expect(askingMessageIds(msgs, false)).toEqual(["a"]);
    expect(askingMessageIds(msgs, true)).toEqual(["a", "b"]);
  });
});

describe("agentTurnBody", () => {
  it("sends exactly the documented keys, privateFollowUp only on the DM follow-up", () => {
    expect(Object.keys(agentTurnBody(request).teamHubAgentTurn)).toEqual(["conversationId", "sourceMessageId", "threadRootId", "agent"]);
    expect(agentTurnBody({ ...request, privateFollowUp: true }).teamHubAgentTurn.privateFollowUp).toBe(true);
  });
});

describe("parseAgentTurn", () => {
  it("accepts a posted answer only with the read-back agent message for this agent", () => {
    const posted = parseAgentTurn({ ok: true, outcome: "posted", agent: "nexus", intent: "reply", message: agentRow(), conversation_id: "c-launch", duplicate: false }, null, request);
    expect(posted).toMatchObject({ outcome: "posted", conversationId: "c-launch", duplicate: false, privateFollowUp: null });
    expect(posted.outcome === "posted" && posted.message.id).toBe("m-reply");
  });

  it("reads a posted answer that is not this agent's, or not an agent's, or has no message, as unconfirmed (never as posted)", () => {
    for (const message of [agentRow({ agent_key: "cura" }), agentRow({ author_kind: "user", agent_key: null, asked_in_message_id: null }), undefined]) {
      expect(parseAgentTurn({ ok: true, outcome: "posted", agent: "nexus", message, conversation_id: "c-launch" }, null, request).outcome).toBe("unconfirmed");
    }
    expect(parseAgentTurn({ ok: true, outcome: "posted", agent: "nexus", message: agentRow() }, null, request).outcome).toBe("unconfirmed");
    expect(parseAgentTurn({ ok: true, outcome: "no_reply", agent: "nexus" }, null, request).outcome).toBe("unconfirmed");
    expect(parseAgentTurn({ ok: false, outcome: "made_up" }, null, request).outcome).toBe("unconfirmed");
  });

  it("maps a transport error or a non-2xx answer to could_not_start", () => {
    expect(parseAgentTurn(null, { message: "Edge Function returned a non-2xx status code" }, request).outcome).toBe("could_not_start");
  });

  it("passes each refusal through", () => {
    for (const outcome of ["in_flight", "conversations_off", "not_visible", "rate_limited", "could_not_start", "no_reply", "cannot_post_here", "unconfirmed"]) {
      expect(parseAgentTurn({ ok: false, outcome, agent: "nexus" }, null, request).outcome).toBe(outcome);
    }
  });

  it("carries the private part's DM, and refuses a follow-up that names another question", () => {
    const follow = { conversationId: "c-launch", sourceMessageId: "m-ask", threadRootId: null, agent: "nexus", privateFollowUp: true, dm_conversation_id: "c-dm" };
    const answer = parseAgentTurn({ ok: true, outcome: "posted", agent: "nexus", message: agentRow(), conversation_id: "c-launch", private_followup: follow }, null, request);
    expect(answer.outcome === "posted" && answer.privateFollowUp).toEqual({ dmId: "c-dm" });
    const other = parseAgentTurn({ ok: true, outcome: "posted", agent: "nexus", message: agentRow(), conversation_id: "c-launch", private_followup: { ...follow, sourceMessageId: "m-x" } }, null, request);
    expect(other.outcome).toBe("unconfirmed");
  });
});

describe("agentOutcomeLine (flow 9 copy)", () => {
  it("says each outcome in the contract's words; the recovery is said once, by its button, never repeated in the line", () => {
    expect(agentOutcomeLine("no_reply", "mentor")).toEqual({ text: "MENTOR didn't reply.", action: "ask_again" });
    expect(agentOutcomeLine("could_not_start", "cura")).toEqual({ text: "CURA couldn't start just now.", action: "ask_again" });
    expect(agentOutcomeLine("unconfirmed", "cura")).toEqual({ text: "CURA's reply may not have posted.", action: "check_again" });
    // After a reload whose state is unknown: never a failure, only Check again.
    expect(agentOutcomeLine("unknown", "cura")).toEqual({ text: "CURA may still be replying.", action: "check_again" });
    expect(agentOutcomeLine("other_workspace", "cura")).toEqual({ text: "CURA couldn't reply: you're working in another workspace now.", action: null });
    for (const outcome of ["no_reply", "could_not_start", "unconfirmed", "unknown"] as const) {
      expect(agentOutcomeLine(outcome, "cura").text).not.toMatch(/Ask again|Check again/);
    }
    expect(agentOutcomeLine("not_visible", "cura").text).toBe("CURA couldn't reply: you can't see this conversation any more.");
    expect(agentOutcomeLine("rate_limited", "cura")).toEqual({ text: "Too many requests right now. Try again shortly.", action: null });
    expect(agentOutcomeLine("cannot_post_here", "cura").text).toBe("CURA can't post here.");
    expect(agentOutcomeLine("no_reply", "merit", true).text).toBe("MERIT couldn't finish your private answer.");
  });
});

describe("answers", () => {
  it("links an agent reply to the question and agent it answers", () => {
    expect(answers({ author_kind: "agent", agent_key: "cura", asked_in_message_id: "m-1" }, "m-1", "cura")).toBe(true);
    expect(answers({ author_kind: "agent", agent_key: "cura", asked_in_message_id: "m-1" }, "m-1", "nexus")).toBe(false);
    expect(answers({ author_kind: "user", agent_key: null, asked_in_message_id: null }, "m-1", "cura")).toBe(false);
  });
});
