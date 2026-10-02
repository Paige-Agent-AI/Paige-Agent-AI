/**
 * D2 — check your own hands before describing them.
 *
 * Production incident (2026-10-02, owner report): asked "can you read your connection to my
 * n8n account via MCP?", Paige answered "I can't execute workflows or make API calls until
 * either: (1) you approve specific workflows…" — stated from the N8N CONNECTION READINESS
 * block ("Approved workflows: 0") without ever looking at her live tool manifest. The n8n
 * management tools (list/get/create/update/validate/activate/deactivate/archive/run) were in
 * her manifest the entire time and run propose-first; only operator pushback ("you're telling
 * me you don't have the ability to read, write, create, archive…?") made her check, whereupon
 * she listed 196 workflows and admitted "I undersold that earlier."
 *
 * The owner's ruling: a user takes her first word as the truth — she must check her tools and
 * their full capabilities BEFORE answering, and even a passing comment about a connection
 * should make her proactively ground herself and offer what she can do.
 *
 * This suite pins:
 *  1. the prompt rule (CHECK YOUR OWN HANDS) — including the preemptive-comment trigger;
 *  2. the state-not-capability distinction (readiness blocks describe standing approvals,
 *     never which tools she holds — reads ungated, writes propose-first);
 *  3. the readiness block's own interpretive line;
 *  4. the mechanical under-claim flag — a prior turn claiming inability about a tool domain
 *     with no tool call anywhere in the conversation is marked for the rounds that read
 *     flagged history (round-2+, continuations, the final tools-free answer; the FIRST
 *     model call reads unflagged history — a pre-existing property — so single-round
 *     answers are covered by the prompt rule and readiness line, injected every request);
 *  5. the flag's regexes actually match the incident's transcript phrasings.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const chat = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");
const n8nEvidence = readFileSync(
  join(root, "supabase/functions/_shared/paige-spine/domains/n8nChatEvidence.ts"),
  "utf8",
);

describe("the capability self-check prompt rule", () => {
  it("CHECK YOUR OWN HANDS is stated as a named rule", () => {
    expect(chat).toContain("CHECK YOUR OWN HANDS BEFORE DESCRIBING THEM");
  });

  it("capability answers come from the live tool manifest, enumerated before speaking", () => {
    expect(chat).toMatch(/live tool manifest in this turn, enumerated before you speak/i);
  });

  it("readiness blocks are STATE, never CAPABILITY — approval counts are not tool absence", () => {
    expect(chat).toMatch(/describes STATE \(connected or not, approved counts, last check\), never CAPABILITY/i);
    expect(chat).toMatch(/"0 approved workflows" does not mean you lack workflow tools/i);
  });

  it("propose-first is the 'can' for WRITES; reads run ungated so the cheapest read is free", () => {
    expect(chat).toMatch(/reads run ungated; their writes run propose-first — you offer, the operator approves the specific action right here/i);
  });

  it("an ungrounded 'I can't' is named a fabrication at the operator's trust's cost", () => {
    expect(chat).toMatch(/is a fabrication with the operator's trust as its cost/i);
  });

  it("the cheapest read proves the lane live before describing it", () => {
    expect(chat).toMatch(/enumerate X's tools from the manifest AND run the cheapest read to prove the lane live/i);
  });
});

describe("the preemptive trigger — comments, not just questions", () => {
  it("a passing mention of connecting an integration cues the same grounding", () => {
    expect(chat).toMatch(/even in passing \("I just connected my n8n account"\)/i);
  });

  it("she proactively OFFERS what she can now do rather than waiting to be asked", () => {
    expect(chat).toMatch(/proactively offer what you can now do, rather than waiting to be asked/i);
  });
});

describe("the readiness block states state-not-capability itself", () => {
  it("the n8n readiness render carries the STATE, NOT CAPABILITY line", () => {
    expect(n8nEvidence).toContain("STATE, NOT CAPABILITY: every line in this block describes connection state and standing pre-approvals");
    expect(n8nEvidence).toContain("regardless of the approval counts above");
    expect(n8nEvidence).toContain("Never translate this block into 'I can't'");
  });
});

describe("the mechanical under-claim flag (corrects open chats on the next message)", () => {
  it("the flag function exists and is composed into the conversation build", () => {
    expect(chat).toContain("const flagUngroundedCapabilityClaims");
    expect(chat).toContain("flagUnverifiedOutcomes(flagUngroundedCapabilityClaims(aiMessages))");
  });

  it("a turn with tool calls anywhere does NOT get flagged (claims may be grounded in results)", () => {
    expect(chat).toContain("if (anyToolCall) return m; // she checked something this conversation");
  });

  it("the flag's note directs a manifest re-check and a propose-first offer, not silence", () => {
    expect(chat).toContain("enumerate the manifest for THIS turn: the earlier claim may understate what you can do");
    expect(chat).toContain("offer them propose-first instead of describing limits");
  });

  it("the under-claim regex bites on the incident's actual phrasings", () => {
    const match = chat.match(/const UNDERCLAIM_RE = (\/.*?\/i);/s);
    expect(match).toBeTruthy();
    // deno-lint isn't run here; eval the literal to exercise it against the transcript
    const re = eval(match![1]) as RegExp;
    expect(re.test("I can't execute workflows or make API calls until either: (1) you approve specific workflows")).toBe(true);
    expect(re.test("Sir, you're telling me I don't have the ability to read your n8n account?")).toBe(true);
    expect(re.test("I'm unable to archive that workflow for you")).toBe(true);
    expect(re.test("You'll need to approve specific workflows before I can run anything")).toBe(true);
    expect(re.test("I can do that — let me list your workflows")).toBe(false);
  });

  it("the tool-domain gate matches the integration domains and not ordinary prose", () => {
    const match = chat.match(/const TOOL_DOMAIN_RE = (\/.*?\/i);/s);
    expect(match).toBeTruthy();
    const re = eval(match![1]) as RegExp;
    expect(re.test("read your connection to my n8n account via MCP")).toBe(true);
    expect(re.test("your Zapier actions")).toBe(true);
    expect(re.test("I can't come to the meeting tomorrow")).toBe(false);
  });
});
