/**
 * EXP08 Team Hub agents, A2b: the pure rules behind a Team Hub card on screen — the member-safe card read
 * (`team_hub_card_states`) mapped into the approved card's shape, the card act's request and answer
 * (`{ teamHubCardAct }` through `paige-ai-chat`), the agent turn's `card` hint, and the redirect line the
 * asker's Open DM keys on. jsdom-free; the workspace states are in TeamHubAgents.mocked-rpc.test.tsx.
 * They prove what the screen does with each documented answer, nothing about the server.
 */
import { describe, expect, it } from "vitest";
import {
  CARD_KIND_LABEL,
  cardActBody,
  cardActLine,
  cardExpiryNote,
  cardMessageIds,
  endsWithRedirect,
  parseAgentTurn,
  parseCardAct,
  parseCardStates,
  REDIRECT_LINE,
} from "./team-hub-agents";
import { parseApproval, type TeamHubMessage } from "./team-hub-contract";

const ME = "u-me";
const EXPIRES = "2026-10-28T15:42:00Z";
const card = (over: Record<string, unknown> = {}) => ({
  state: "waiting", kind: "task_cancel", asker_user_id: ME, decided_by_name: null, decided_at: null, expires_at: EXPIRES,
  actions: [{ summary: "ZION wants to cancel the task “Prepare the onboarding packet”.", fingerprint: "a1b2c3d4e5f60718" }], ...over,
});
const row = (over: Record<string, unknown> = {}, cardOver: Record<string, unknown> = {}) => ({
  message_id: "m-card", card: card(cardOver), outcome_message_id: null, record: null, ...over,
});
const agentRow = (over: Record<string, unknown> = {}) => ({
  id: "m-reply", author_user_id: ME, body: "Done.", created_at: "2026-10-28T15:40:00Z", parent_message_id: "m-card",
  reply_count: 0, last_reply_at: null, mentions: [], files: [], work_ref: null,
  author_kind: "agent", agent_key: "zion", asked_in_message_id: null, agent_mentions: [], ...over,
});
const actRequest = { conversationId: "c-dm-zion", messageId: "m-card", act: "approve" as const, fingerprint: "a1b2c3d4e5f60718" };

describe("parseCardStates: the server's card, in the shape the approved card draws", () => {
  it("maps the card key into parseApproval's shape: the kind's label, the binding, and the expiry as a time", () => {
    const states = parseCardStates({ ok: true, cards: [row()] }, null)!;
    const read = states["m-card"];
    expect(read.approval).toEqual({
      state: "waiting", kind: "Task cancel", asker_user_id: ME, decided_by_name: null, decided_at: null, covered_by: null,
      actions: [{ summary: "ZION wants to cancel the task “Prepare the onboarding packet”.", fingerprint: "a1b2c3d4e5f60718", note: cardExpiryNote(EXPIRES) }],
    });
    // The very shape the frozen card's own parser accepts, unchanged.
    expect(parseApproval(read.approval)).toEqual(read.approval);
    expect(read).toMatchObject({ outcomeMessageId: null, record: null, expiresAt: EXPIRES });
    expect(cardExpiryNote(EXPIRES)).toMatch(/^Expires at \d{1,2}:\d{2}( ?[AP]M)?\.$/i);
    expect(cardExpiryNote(EXPIRES)).not.toMatch(/minute/);
  });

  it("labels each of A2b's three kinds, and drops a kind this build does not know", () => {
    expect(CARD_KIND_LABEL).toEqual({ task_handover: "Task hand-over", task_cancel: "Task cancel", page_publish: "Page publish" });
    for (const [kind, label] of Object.entries(CARD_KIND_LABEL)) {
      expect(parseCardStates({ ok: true, cards: [row({}, { kind })] }, null)!["m-card"].approval.kind).toBe(label);
    }
    expect(parseCardStates({ ok: true, cards: [row({}, { kind: "crm_delete_task" })] }, null)).toEqual({});
  });

  it("keeps the binding only while the card waits, and says the expiry only then", () => {
    for (const state of ["working", "done", "failed", "unconfirmed", "declined", "expired"]) {
      const read = parseCardStates({ ok: true, cards: [row({}, { state, decided_at: "2026-10-28T15:41:00Z", decided_by_name: "Morgan Reyes" })] }, null)!["m-card"];
      expect(read.approval.state).toBe(state);
      expect(read.approval.actions[0]).toEqual({ summary: expect.any(String) });
    }
    // The server sends no binding to anyone but the asker: the card then refuses, never a dead Approve.
    const theirs = parseCardStates({ ok: true, cards: [row({}, { asker_user_id: "u-priya", actions: [{ summary: "ZION wants to cancel a task." }] })] }, null)!["m-card"];
    expect(theirs.approval.actions[0].fingerprint).toBeUndefined();
    expect(theirs.approval.asker_user_id).toBe("u-priya");
  });

  it("refuses standing (A2c's), an unknown state, a bad expiry, a malformed record or a missing asker, row by row", () => {
    const bad = [row({}, { state: "standing", covered_by: "x" }), row({}, { state: "pending" }), row({}, { expires_at: "soon" }),
      row({ record: { destination: "Plan Items", record_id: "x" } }), row({ record: { destination: "plan_items", record_id: "8b8f5b0e-2e1c-4d3a-9f5e-1a2b3c4d5e6f", args: {} } }),
      row({}, { asker_user_id: null }), row({}, { actions: [] }), { message_id: "m-x" }, "nope"];
    const states = parseCardStates({ ok: true, cards: [...bad, row({ message_id: "m-ok" })] }, null)!;
    expect(Object.keys(states)).toEqual(["m-ok"]);
  });

  it("carries the outcome message and the record by reference only", () => {
    const record = { destination: "plan_items", record_id: "8b8f5b0e-2e1c-4d3a-9f5e-1a2b3c4d5e6f" };
    const read = parseCardStates({ ok: true, cards: [row({ outcome_message_id: "m-out", record }, { state: "done" })] }, null)!["m-card"];
    expect(read.outcomeMessageId).toBe("m-out");
    expect(read.record).toEqual({ destination: "plan_items", recordId: record.record_id });
  });

  it("is null when the read failed, so the screen keeps what it had", () => {
    expect(parseCardStates(null, { message: "boom" })).toBeNull();
    expect(parseCardStates({ ok: false, code: "not_found" }, null)).toBeNull();
    expect(parseCardStates({ ok: true }, null)).toBeNull();
  });

  it("reads only agent messages, newest 100", () => {
    const messages = Array.from({ length: 130 }, (_, index) => ({ id: `m-${index}`, author_kind: index % 2 ? "agent" : "user" })) as TeamHubMessage[];
    const ids = cardMessageIds(messages);
    expect(ids).toHaveLength(65);
    expect(ids.every((id) => Number(id.slice(2)) % 2 === 1)).toBe(true);
    expect(cardMessageIds(Array.from({ length: 250 }, (_, index) => ({ id: `a-${index}`, author_kind: "agent" })) as TeamHubMessage[])).toHaveLength(100);
  });
});

describe("the card act", () => {
  it("sends exactly the four keys under teamHubCardAct", () => {
    expect(cardActBody({ ...actRequest, extra: "x" } as typeof actRequest)).toEqual({ teamHubCardAct: actRequest });
    expect(Object.keys(cardActBody(actRequest).teamHubCardAct)).toEqual(["conversationId", "messageId", "act", "fingerprint"]);
  });

  it("parses each documented outcome, with the card as it now stands and the outcome message", () => {
    const answer = parseCardAct({ ok: true, outcome: "done", card: card({ state: "done", decided_at: "2026-10-28T15:41:00Z", decided_by_name: "Morgan Reyes" }),
      outcome_message: agentRow() }, null, actRequest);
    expect(answer.outcome).toBe("done");
    if (answer.outcome === "no_answer") throw new Error("parsed as no_answer");
    expect(answer.card!.approval).toMatchObject({ state: "done", kind: "Task cancel", decided_by_name: "Morgan Reyes" });
    expect(answer.outcomeMessage!.id).toBe("m-reply");
    // The whole state row is accepted too, but only for this card.
    expect(parseCardAct({ ok: true, outcome: "done", card: row({}, { state: "done" }) }, null, actRequest).outcome).toBe("done");
    expect(parseCardAct({ ok: true, outcome: "done", card: row({ message_id: "m-other" }, { state: "done" }) }, null, actRequest).outcome).toBe("no_answer");
    for (const outcome of ["failed", "unconfirmed", "declined", "expired", "already_decided", "not_yours", "not_visible", "conversations_off", "could_not_start"]) {
      expect(parseCardAct({ ok: false, outcome, card: null, outcome_message: null }, null, actRequest)).toEqual({ outcome, card: null, outcomeMessage: null });
    }
  });

  it("is no_answer for a transport error, a non-2xx answer or anything not documented — never a claim that it ran", () => {
    expect(parseCardAct(null, { message: "Edge Function returned a non-2xx status code" }, actRequest)).toEqual({ outcome: "no_answer" });
    expect(parseCardAct({ ok: true, outcome: "posted" }, null, actRequest)).toEqual({ outcome: "no_answer" });
    expect(parseCardAct({ outcome: "done" }, null, actRequest)).toEqual({ outcome: "no_answer" });
    expect(parseCardAct({ ok: true, outcome: "done", card: { state: "done" } }, null, actRequest)).toEqual({ outcome: "no_answer" });
    expect(parseCardAct({ ok: true, outcome: "done", outcome_message: agentRow({ author_kind: "user", agent_key: null }) }, null, actRequest)).toEqual({ outcome: "no_answer" });
  });
});

describe("parseAgentTurn tolerates the card hint", () => {
  const turn = { conversationId: "c-dm-zion", sourceMessageId: "m-ask", threadRootId: null, agent: "zion" as const };
  const posted = (over: Record<string, unknown> = {}) => ({ ok: true, outcome: "posted", agent: "zion", intent: "dm",
    message: agentRow({ id: "m-card", parent_message_id: null, asked_in_message_id: "m-ask" }), conversation_id: "c-dm-zion", duplicate: false, ...over });
  it("still reads a reply as posted whatever its card key says: naming it, null, absent or malformed", () => {
    for (const value of [{ message_id: "m-card" }, null, undefined, { message_id: "m-other" }, "m-card", []]) {
      const answer = parseAgentTurn(posted({ card: value }), null, turn);
      expect(answer.outcome).toBe("posted");
      expect(answer.outcome === "posted" && answer.message.id).toBe("m-card");
    }
  });
});

describe("the redirect line", () => {
  it("is the server's exact line at the end of a reply, and nothing else", () => {
    expect(REDIRECT_LINE).toBe("I can do that with you in our DM.");
    expect(endsWithRedirect("Cancel the packet task, and reassign the rest to Priya.\n\nI can do that with you in our DM.")).toBe(true);
    expect(endsWithRedirect("I can do that with you in our DM.  \n")).toBe(true);
    expect(endsWithRedirect("I can do that with you in our DM. Want me to?")).toBe(false);
    expect(endsWithRedirect("I can do that with you in our DM")).toBe(false);
  });
});

describe("A2b fixes: the outcome note and the act's spoken line", () => {
  it("a done or failed card keeps the server's note; a waiting card says only its expiry; any other state drops a note", () => {
    const note = "“Prepare the onboarding packet” is cancelled.";
    for (const state of ["done", "failed"]) {
      const read = parseCardStates({ ok: true, cards: [row({}, { state, decided_at: "2026-10-28T15:35:00Z", actions: [{ summary: "s", note }] })] }, null)!["m-card"];
      expect(read.approval.actions[0]).toEqual({ summary: "s", note });
    }
    for (const state of ["declined", "unconfirmed", "expired", "working"]) {
      const read = parseCardStates({ ok: true, cards: [row({}, { state, decided_at: "2026-10-28T15:35:00Z", actions: [{ summary: "s", note }] })] }, null)!["m-card"];
      expect(read.approval.actions[0]).toEqual({ summary: "s" });
    }
    const waiting = parseCardStates({ ok: true, cards: [row({}, { actions: [{ summary: "s", fingerprint: "a1b2c3d4e5f60718", note }] })] }, null)!["m-card"];
    expect(waiting.approval.actions[0].note).toBe(cardExpiryNote(EXPIRES));
  });
  it("every turned-down outcome has a line; what the card itself says has none", () => {
    for (const outcome of ["not_yours", "not_visible", "already_decided", "expired", "conversations_off", "could_not_start", "no_answer"] as const) {
      expect(cardActLine(outcome)).toMatch(/\S/);
    }
    for (const outcome of ["done", "failed", "unconfirmed", "declined"] as const) expect(cardActLine(outcome)).toBeNull();
  });
});
