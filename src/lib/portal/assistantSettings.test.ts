import { describe, expect, it } from "vitest";
import { agentNameNotice, assistantFields } from "./assistantSettings";

// Round 2 (verifier §58 #9): an owner whose saved agent name included PAIGE saw Cura with no explanation.
describe("agentNameNotice", () => {
  it("says nothing for a name clients will read as typed", () => {
    expect(agentNameNotice("Ava")).toBeNull();
    expect(agentNameNotice("")).toBeNull();
    expect(agentNameNotice("Cura", "Cura")).toBeNull();
  });
  it("explains a typed name that includes Paige", () => {
    expect(agentNameNotice("AskPaige")).toMatch(/^Clients will see “Cura”/);
  });
  it("explains a saved name that was replaced, while the field still shows the replacement", () => {
    const loaded = assistantFields({ display_name: "Paige Assistant" });
    expect(loaded.display_name).toBe("Cura");
    expect(agentNameNotice(loaded.display_name, "Paige Assistant")).toBe("Your saved name “Paige Assistant” includes Paige, so clients see “Cura”. Paige is your own assistant; your clients’ agent has its own name.");
    // Once the owner types a name of their own, the old one no longer matters.
    expect(agentNameNotice("Ava", "Paige Assistant")).toBeNull();
  });
});
