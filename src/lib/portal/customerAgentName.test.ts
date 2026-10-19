import { describe, expect, it } from "vitest";
import { customerAgentName } from "../../../supabase/functions/_shared/client-portal-identity";

// Owner ruling 2026-10-19: Cura is the customer's agent, assigned under PAIGE. PAIGE is the owner's
// COO and never the name a customer reads, whatever a business types into its assistant settings.
describe("customerAgentName", () => {
  it("keeps a business's own name for its agent", () => {
    expect(customerAgentName("Ava")).toBe("Ava");
    expect(customerAgentName("  Northwind Concierge ")).toBe("Northwind Concierge");
  });
  it("falls back to Cura when nothing usable is set", () => {
    for (const v of [undefined, null, "", "   ", 42]) expect(customerAgentName(v)).toBe("Cura");
  });
  it("never lets a customer read PAIGE, in any spelling or wrapped in other words", () => {
    for (const v of ["Paige", "PAIGE", "paige", "Paige AI", "Paige Assistant", "Ask Paige", "PaigeAgent", "Paige-bot", "Northwind's Paige"])
      expect(customerAgentName(v)).toBe("Cura");
  });
  // Round 2 (compliance 6): the rule used to need a non-letter before "paige", so joined and disguised
  // spellings passed straight through to the customer.
  it("refuses joined, plural and disguised spellings", () => {
    for (const v of ["AskPaige", "MyPaige", "NorthwindPaige", "Paiges", "PAIGEbot", "Pa\u200Bige", "Pai\u00ADge", "P a i g e", "P.A.I.G.E", "Ｐａｉｇｅ", "P\u0430ige"])
      expect(customerAgentName(v), JSON.stringify(v)).toBe("Cura");
  });
  // Round 3 (verifier 1): the "Paiget" exception was checked after spaces were removed, so any name where
  // PAIGE ran into a T passed ("Paige Team"), ™ folded into the letters "tm", and accents were kept.
  it("refuses PAIGE followed by a T-word, a mark or an accent", () => {
    for (const v of ["Paige Team", "Paige Today", "Paige Tutor", "Paige Taylor", "Ask Paige Today", "PAIGE-T", "PaigeTalk", "Paigeton", "Paige\u2122", "Paige\u2120", "Paig\u00E9", "Paige\u0301", "PAIG\u00C9", "Paige\u00AE", "Paiget Paige", "P a i g e t"])
      expect(customerAgentName(v), JSON.stringify(v)).toBe("Cura");
  });
  it("keeps Paiget only as a word of its own", () => {
    for (const v of ["Paiget", "PAIGET", "Paiget Team", "Paiget\u2122"]) expect(customerAgentName(v), JSON.stringify(v)).toBe(v);
  });
  it("does not refuse an ordinary name that merely contains the letters", () => {
    expect(customerAgentName("Paiget")).toBe("Paiget");
    expect(customerAgentName("Page")).toBe("Page");
    expect(customerAgentName("Paisley")).toBe("Paisley");
    expect(customerAgentName("Ava")).toBe("Ava");
  });
});

import { customerSeatIdentity } from "../../../supabase/functions/_shared/client-portal-identity";
describe("customerSeatIdentity", () => {
  it("re-voices every way the owner's prompts introduce PAIGE", () => {
    expect(customerSeatIdentity("You are Paige. This is HOW you talk.")).toBe("You are Cura. This is HOW you talk.");
    expect(customerSeatIdentity("be honest — you're Paige, an AI assistant working with the team.")).toBe("be honest — you're Cura, an AI assistant working with the team.");
    expect(customerSeatIdentity("\"Hey [first name]! I'm Paige — your personal advisor.")).toBe("\"Hey [first name]! I'm Cura — your personal advisor.");
    expect(customerSeatIdentity("You are Paige, your team's assistant for Northwind Studio", "Ava")).toBe("You are Ava, your team's assistant for Northwind Studio");
  });
  // Round 2 (compliance 7): lowercase, "Your name is", "Paige here" and a suffixed name all slipped past.
  it("re-voices lowercase and other self-introductions, and swallows a suffixed name", () => {
    expect(customerSeatIdentity("you are paige, a helper.")).toBe("you are Cura, a helper.");
    expect(customerSeatIdentity("Your name is Paige.")).toBe("Your name is Cura.");
    expect(customerSeatIdentity("Paige here! How can I help?")).toBe("Cura here! How can I help?");
    expect(customerSeatIdentity("paige here.")).toBe("Cura here.");
    expect(customerSeatIdentity("You are Paige Assistant for the team.", "Ava")).toBe("You are Ava for the team.");
    expect(customerSeatIdentity("This is Paige AI speaking.")).toBe("This is Cura speaking.");
  });
  it("names the customer's agent wherever the owner's prompt names PAIGE, so the model has nothing to repeat", () => {
    expect(customerSeatIdentity("Paige's Predictive Engine flagged this.", "Ava")).toBe("Ava's Predictive Engine flagged this.");
    expect(customerSeatIdentity("Ask Paige anything. PAIGE stays calm.")).toBe("Ask Cura anything. Cura stays calm.");
  });
  // Round 3 (verifier 2): a name used as a replacement string expanded $& / $' / $` into prompt text.
  it("writes the agent's name literally, never as a replacement pattern", () => {
    expect(customerSeatIdentity("Talk to Paige. Paige here! You are Paige.", "Ava$'")).toBe("Talk to Ava$'. Ava$' here! You are Ava$'.");
    expect(customerSeatIdentity("Ask Paige now.", "Ava$&$`")).toBe("Ask Ava$&$` now.");
  });
  it("leaves identifiers, lowercase prose and the platform's legal name alone", () => {
    for (const t of ["You are PaigeAgent staff.", "call paige_tasks_list first", "the paige-ai-chat function", "visit paigeagent.ai", "PAIGE_VOICE_BLOCK", "a pageant"])
      expect(customerSeatIdentity(t)).toBe(t);
  });
});
