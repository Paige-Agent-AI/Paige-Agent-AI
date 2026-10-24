// @vitest-environment node
import { describe, expect, it } from "vitest";
import { executiveAreas, executivePriorities, formatReviewInstant, formatReviewMetric, reviewGapNote } from "./executive-review";
import type { BusinessReviewSnapshot } from "./data/useBusinessReview";
import { composeOperatingSnapshot, type DomainSnapshotAdapter } from "../../supabase/functions/_shared/paige-context/snapshot";
import { TEST_BUSINESS_REVIEW } from "@/test/fixtures/business-review";

const review = {
  requested: ["payments", "operations", "campaigns", "game_plan"],
  domains: {
    payments: { status: "available", data: { risks: [{ kind: "due", severity: "watch", summary: "A receivable needs review" }] } },
    operations: { status: "available", data: { risks: [{ kind: "readiness", severity: "act", summary: "2 blocking findings" }] } },
    campaigns: { status: "unavailable", reason: "no_adapter", data: null },
  },
} as unknown as BusinessReviewSnapshot;

describe("Executive presentation of canonical evidence", () => {
  it("explains an actual composer gap without declaring the originating source disconnected", async () => {
    const compose = (adapters: DomainSnapshotAdapter[]) => composeOperatingSnapshot({
      identity: { actorId: "test-owner", tenantId: TEST_BUSINESS_REVIEW.tenant_id, workspaceId: "test-workspace", role: "owner", actAsClientId: null, accountShape: "solo", scopeEpoch: 1 },
      period: TEST_BUSINESS_REVIEW.period, now: new Date(TEST_BUSINESS_REVIEW.composed_at),
      domains: ["communications"], adapters, currentScopeEpoch: () => 1,
    });
    const missing = (await compose([])).domains.communications;
    expect(missing.status).toBe("unavailable");
    expect(missing.reason).toBe("no_adapter: communications");
    expect(reviewGapNote(missing.reason)).toBe("This area is not included in this business review yet.");

    const source = (await compose([{ domain: "communications", owner: "communications", read: async () => ({ status: "unavailable", data: null, reason: "no_adapter" }) }])).domains.communications;
    expect(source.reason).toBe("adapter:no_adapter");
    expect(reviewGapNote(source.reason)).not.toBe(reviewGapNote(missing.reason));
  });
  it("retains disconnected, permission and scope-change guidance separately from a review gap", () => {
    expect(reviewGapNote("no_adapter")).toBe("This area is not included in this business review yet.");
    expect(reviewGapNote("not_connected")).toBe("Not connected. No figures are available from this source.");
    expect(reviewGapNote("authorization_denied")).toContain("not authorized");
    expect(reviewGapNote("scope_changed")).toContain("workspace changed");
    expect(reviewGapNote("no_adapter_extra")).not.toBe(reviewGapNote("no_adapter"));
  });
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
  it.each([
    ["JPY", "JPY 125,000"], ["KWD", "KWD 125.000"],
    ["CLF", "CLF 12.5000"], ["XYZ", "XYZ 125,000 minor units"],
  ])("preserves the canonical minor-unit representation for %s", (currency, expected) => {
    expect(formatReviewMetric({ value: 125000, unit: "currency_minor", currency } as never)).toBe(expected);
  });
});
