import { describe, expect, it } from "vitest";
import { agentNameNotice, assistantFields } from "./assistantSettings";

// Round 2 (verifier §58 #9): an owner whose saved agent name included PAIGE saw Cura with no explanation.
describe("agentNameNotice", () => {
  it("says nothing for a name clients will read as typed", () => {
    expect(agentNameNotice("Ava")).toBeNull();
    expect(agentNameNotice("")).toBeNull();
    expect(agentNameNotice("Cura", "Cura")).toBeNull();
  });
  it("explains a typed name that reads like Paige", () => {
    expect(agentNameNotice("AskPaige")).toBe("Clients will see “Cura”. A name that reads like Paige stays with your own assistant, so the portal uses Cura instead.");
    expect(agentNameNotice("P a i g e")).toMatch(/^Clients will see “Cura”/);
  });
  // Round 4 (verifier 5): the notice compared the refused name with the raw typed text, so an invisible character
  // or a name past 80 characters claimed the name "includes Paige" when it did not.
  it("says nothing when only invisible characters or the length differ", () => {
    expect(agentNameNotice("Ava\u200B")).toBeNull();
    expect(agentNameNotice("\u200BNorthwind\u00AD Concierge")).toBeNull();
    expect(agentNameNotice("A".repeat(95))).toBeNull();
    expect(agentNameNotice("Ava", "Ava\u200B")).toBeNull();
    expect(agentNameNotice("A".repeat(80), "A".repeat(95))).toBeNull();
  });
  it("explains a saved name that was replaced, while the field still shows the replacement", () => {
    const loaded = assistantFields({ display_name: "Paige Assistant" });
    expect(loaded.display_name).toBe("Cura");
    expect(agentNameNotice(loaded.display_name, "Paige Assistant")).toBe("Your saved name “Paige Assistant” reads like Paige, so clients see “Cura”. Paige is your own assistant; your clients’ agent has its own name.");
    // Once the owner types a name of their own, the old one no longer matters.
    expect(agentNameNotice("Ava", "Paige Assistant")).toBeNull();
  });
});
