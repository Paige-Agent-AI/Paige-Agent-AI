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
  bringInSuggestions,
  FIXED_PRIVATE_LINE,
  parseAgentTurn,
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
  it("offers each agent the reply names, except the author and anyone the question already asked, with the naming sentence as context", () => {
    const reply = { agent_key: "paige" as const, body: "Okay, tight but doable. @CURA already has the welcome emails. I'd put @NEXUS on the announcement and @ZION on the task plan. Want me to bring them in?" };
    const out = bringInSuggestions(reply, ["cura"]);
    expect(out.map((item) => item.agent)).toEqual(["nexus", "zion"]);
    expect(out[0].prefill).toBe("@NEXUS PAIGE suggested: “I'd put NEXUS on the announcement and ZION on the task plan.”");
    // The prefill asks exactly one agent.
    expect(agentMentionsIn(out[0].prefill)).toEqual(["nexus"]);
    expect(bringInSuggestions({ agent_key: "paige", body: "Ask @PAIGE again." })).toEqual([]);
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
  it("says each outcome in the contract's words, with Ask again or Check again where they help", () => {
    expect(agentOutcomeLine("no_reply", "mentor")).toEqual({ text: "MENTOR didn't reply. Ask again.", action: "ask_again" });
    expect(agentOutcomeLine("could_not_start", "cura")).toEqual({ text: "CURA couldn't start just now. Ask again.", action: "ask_again" });
    expect(agentOutcomeLine("unconfirmed", "cura")).toEqual({ text: "CURA's reply may not have posted. Check again.", action: "check_again" });
    expect(agentOutcomeLine("not_visible", "cura").text).toBe("CURA couldn't reply: you can't see this conversation any more.");
    expect(agentOutcomeLine("rate_limited", "cura")).toEqual({ text: "You've reached 30 agent replies this hour. Try again later.", action: null });
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
