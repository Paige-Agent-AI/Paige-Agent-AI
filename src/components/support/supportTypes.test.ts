import { describe, expect, it } from "vitest";
import { FEATURE_CATEGORIES, TICKET_CATEGORIES, featureCategoryLabel, ticketCategoryLabel } from "./supportTypes";

const FINANCE = /credit|funding|broker|lend|loan/i;

describe("platform support categories", () => {
  it("offers no finance or credit category as a platform default", () => {
    for (const c of [...TICKET_CATEGORIES, ...FEATURE_CATEGORIES]) {
      expect(c.value).not.toMatch(FINANCE);
      expect(c.label).not.toMatch(FINANCE);
    }
  });

  it("still reads historical rows stored with retired categories", () => {
    expect(ticketCategoryLabel("credit_report")).toBe("Credit Report Issue");
    expect(featureCategoryLabel("broker_workspace")).toBe("Broker Workspace");
    expect(ticketCategoryLabel("general")).toBe("General Question");
  });
});
