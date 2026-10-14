// @vitest-environment node
import { describe, expect, it } from "vitest";
import { executiveAreas, executivePriorities, formatReviewInstant, formatReviewMetric } from "./executive-review";
import type { BusinessReviewSnapshot } from "./data/useBusinessReview";

const review = {
  requested: ["payments", "operations", "campaigns", "game_plan"],
  domains: {
    payments: { status: "available", data: { risks: [{ kind: "due", severity: "watch", summary: "A receivable needs review" }] } },
    operations: { status: "available", data: { risks: [{ kind: "readiness", severity: "act", summary: "2 blocking findings" }] } },
    campaigns: { status: "unavailable", reason: "no_adapter", data: null },
  },
} as unknown as BusinessReviewSnapshot;

describe("Executive presentation of canonical evidence", () => {
  it("names every requested domain, including returned unavailable and missing entries", () => {
    const areas = executiveAreas(review);
    expect(areas.map((a) => a.key)).toEqual(["payments", "operations", "campaigns", "game_plan"]);
    expect(areas.find((a) => a.key === "campaigns")?.entry.reason).toBe("no_adapter");
    expect(areas.find((a) => a.key === "game_plan")?.entry.status).toBe("unavailable");
  });
  it("ranks act before watch across domains without rewriting their evidence", () => {
    const priorities = executivePriorities(review);
    expect(priorities.map((p) => p.summary)).toEqual(["2 blocking findings", "A receivable needs review"]);
    expect(priorities[0].area.destination).toBe("systems_check");
  });
  it("uses the reported zone, including dates crossing midnight, never the browser zone", () => {
    expect(formatReviewInstant("2026-10-13T04:00:00Z", "America/New_York")).toContain("Oct 13");
    expect(formatReviewInstant("2026-10-13T04:00:00Z", "America/Los_Angeles")).toContain("Oct 12");
    expect(formatReviewInstant("2026-10-13T04:00:00Z", "Mars/Olympus")).toBe("Date unavailable");
  });
  it("keeps currency, a real zero and unavailable values distinct", () => {
    expect(formatReviewMetric({ value: 0, unit: "count" } as never)).toBe("0");
    expect(formatReviewMetric({ value: null, unit: "count" } as never)).toBe("Unavailable");
    expect(formatReviewMetric({ value: 125000, unit: "currency_minor", currency: "USD" } as never)).toBe("USD 1,250.00");
  });
});
