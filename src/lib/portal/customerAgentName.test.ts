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
  it("does not refuse an ordinary name that merely contains the letters", () => {
    expect(customerAgentName("Paiget")).toBe("Paiget");
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
  it("leaves everything that is not a self-introduction alone", () => {
    for (const t of ["Paige's tools stay internal.", "You are PaigeAgent staff.", "Ask Paige anything."]) expect(customerSeatIdentity(t)).toBe(t);
  });
});
