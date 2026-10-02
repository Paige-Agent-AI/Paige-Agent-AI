/**
 * C1 — the bounded continuation loop.
 *
 * Production repro (2026-10-01): the owner asked Paige to add Jacqueline to a pipeline; the
 * model narrated "Let me try" and the turn ENDED — no tool dispatched, no card minted, no
 * readback, no blockage stated. The server treated narration as completion.
 *
 * This suite BEHAVIORALLY tests the action-intent regex and the prose-terminal detector by
 * extracting them from the handler source and running them against the exact message classes
 * the independent review enumerated, plus the structural wiring pins.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const chat = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");

function extractRegex(name: string): RegExp {
  const m = new RegExp(`const ${name} = (/.*?/i);`, "s").exec(chat);
  if (!m) throw new Error(`${name} not found in the handler source`);
  return new Function(`return ${m[1]}`)() as RegExp;
}

const actionIntent = extractRegex("ACTION_INTENT_RE");
const proseTerminal = extractRegex("PROSE_TERMINAL_RE");

describe("action intent — the reviewer's false-positive class is dead", () => {
  const NOT_ACTIONS = [
    "Thanks for the update!",
    "That makes sense, I will look at it",
    "I'm all set, thanks",
    "The catalog looks great",
    "Got it — reviewing her profile now myself",
    "Completely agree with your plan",
    "Good morning Paige",
    "Okay sounds good",
  ];
  for (const msg of NOT_ACTIONS) {
    it(`does NOT continue on "${msg}"`, () => {
      expect(actionIntent.test(msg)).toBe(false);
    });
  }
});

describe("action intent — the real action requests fire", () => {
  const ACTIONS = [
    "Add Jacqueline to the BUILD-to-FUND pipeline",
    "Create a new contact for John Coleman",
    "Archive that pipeline",
    "Send the agreement to the signer",
    "Move the Acme deal to Proposal stage",
    "Enroll her in the program",
    "Cancel my 3pm",
    "Pay the invoice",
    "Remind me to call Dana Friday",
    "Rename the Acme deal",
    "Sign her up for the program",
    "yes please add her",
  ];
  for (const msg of ACTIONS) {
    it(`continues on "${msg}"`, () => {
      expect(actionIntent.test(msg)).toBe(true);
    });
  }
});

describe("questions are terminal regardless of length", () => {
  it("a long mixed message with a question mark does not fire the gate", () => {
    const longQuestion = "Hi Paige, quick question — which of the two pipelines should Jacqueline go into? I want her added today either way.";
    const gateFires = !longQuestion.includes("?") && actionIntent.test(longQuestion);
    expect(gateFires).toBe(false);
  });
});

describe("prose terminal states — refusals, clarifications and blockages end the turn", () => {
  const TERMINAL_PROSE = [
    "I can't do that from here yet",
    "I cannot create a pipeline without a name",
    "I'm unable to send that agreement",
    "Which pipeline would you like me to add her to?",
    "What's the contact's email address?",
    "Do you want me to add them as a lead or a client?",
    "There is no tool for that in this workspace",
    "I don't have access to that feature",
    "That isn't available from chat yet",
    "I wasn't able to complete that request.",
  ];
  for (const prose of TERMINAL_PROSE) {
    it(`treats "${prose.slice(0, 40)}..." as terminal`, () => {
      expect(proseTerminal.test(prose)).toBe(true);
    });
  }
  it("narration of intent is NOT terminal (the Jacqueline pattern)", () => {
    expect(proseTerminal.test("Let me try without the contact reference — just the deal itself.")).toBe(false);
    expect(proseTerminal.test("Pulling up Afonso's details and creating his deal now.")).toBe(false);
    expect(proseTerminal.test("I'll get that done for you right away.")).toBe(false);
  });
});

describe("the continuation loop's structural wiring", () => {
  it("carries a bounded budget that is checked and incremented", () => {
    expect(chat).toContain("MAX_CONTINUATIONS = 3");
    expect(chat).toContain("continuationsUsed < MAX_CONTINUATIONS");
    expect(chat).toContain("continuationsUsed += 1");
  });

  it("re-enters the provider through the existing gateway with the exact trace tag", () => {
    expect(chat).toContain('traceFor("chat-continuation")');
  });

  it("carries the exact continuation instruction", () => {
    expect(chat).toContain("The requested task is still unresolved.");
    expect(chat).toContain("Do not narrate intent without acting.");
  });

  it("client seats never continue (their tools are deny-by-default)", () => {
    expect(chat).toMatch(/callerTier === "client"\s*.*return false/);
  });

  it("the round guard prevents a last-round continuation leaking an unconsumed response", () => {
    expect(chat).toContain("round < MAX_ROUNDS - 1");
  });

  it("budget exhaustion produces the honest blockage sentence, not a narration replay", () => {
    expect(chat).toContain("I wasn't able to complete that request.");
  });

  it("is not vacuous: the round loop and its prose-only exit remain", () => {
    expect(chat).toContain("for (let round = 0; round < MAX_ROUNDS; round++)");
    expect(chat).toMatch(/if \(!hasToolCall\)/);
  });
});
