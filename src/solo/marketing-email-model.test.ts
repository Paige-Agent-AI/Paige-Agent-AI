// Marketing › Email figures: a rate needs emails that report opens, a comparison needs an earlier period,
// and a status reads in the owner's words.
import { describe, expect, it } from "vitest";
import { activityDetail, ago, campaignState, costWords, deriveStats, pointsDelta, rate, ratePoints, unsent, type CampaignRow, type DashboardStats } from "./marketing-email-model";

const stats = (over: Partial<DashboardStats> = {}): DashboardStats => ({
  sent: 0, sent_prev: 0, tracked: 0, tracked_prev: 0, opened: 0, opened_prev: 0, clicked: 0, clicked_prev: 0, bounced: 0,
  conversions: 0, conversions_prev: 0, new_subscribers: 0, new_subscribers_prev: 0, unsubscribes: 0, ...over,
});

describe("email stats", () => {
  it("rates count only emails that report opens; the rest are named, never folded in as zero", () => {
    const s = deriveStats(stats({ sent: 300, tracked: 200, opened: 80, clicked: 10 }));
    expect(s.openRate.value).toBe(40);
    expect(s.clickRate.value).toBe(5);
    expect(s.untracked).toBe(100);
  });

  it("no tracked email means no rate, not 0%", () => {
    const s = deriveStats(stats({ sent: 50, tracked: 0 }));
    expect(s.openRate.value).toBeNull();
    expect(s.clickRate.value).toBeNull();
  });

  it("rates compare in percentage points, and only when both periods were measured", () => {
    expect(deriveStats(stats({ sent: 100, tracked: 100, opened: 40, sent_prev: 100, tracked_prev: 100, opened_prev: 30 })).openRate.points).toBe(10);
    expect(deriveStats(stats({ sent: 100, tracked: 100, opened: 40 })).openRate.points).toBeNull();
    expect(pointsDelta(null, 30)).toBeNull();
  });

  it("sent compares only when something was sent before", () => {
    expect(deriveStats(stats({ sent: 10 })).sent.delta).toBeNull();
    expect(deriveStats(stats({ sent: 15, sent_prev: 10 })).sent.delta).toEqual({ change: 5, percent: 50 });
  });

  it("two empty periods of subscribers or conversions have nothing to compare", () => {
    expect(deriveStats(stats()).subscribers.delta).toBeNull();
    expect(deriveStats(stats({ new_subscribers: 2 })).subscribers.delta).toEqual({ change: 2, percent: null });
    expect(deriveStats(stats({ conversions_prev: 3 })).conversions.delta).toEqual({ change: -3, percent: -100 });
  });

  it("rates round to one decimal", () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(0, 0)).toBeNull();
  });
});

describe("rate chart points", () => {
  it("a day with nothing sent has no rate", () => {
    const points = ratePoints([
      { day: "2026-10-01", sent: 0, tracked: 0, opened: 0, clicked: 0 },
      { day: "2026-10-02", sent: 10, tracked: 10, opened: 4, clicked: 1 },
    ], "en-US");
    expect(points[0].openRate).toBeNull();
    expect(points[1]).toMatchObject({ label: "Oct 2", openRate: 40, clickRate: 10, sent: 10 });
  });
});

const campaign = (over: Partial<CampaignRow>): CampaignRow => ({
  id: "c", name: "n", kind: "standard", status: "draft", blocked_reason: null, updated_at: "2026-10-01T00:00:00Z", version_id: "v",
  version_state: "draft", subject: "", scheduled_for: null, segment_name: null, conversion_goal: "none", recipients: null,
  first_sent_at: null, last_sent_at: null, sent: 0, tracked: 0, opened: 0, clicked: 0, failed: 0, not_confirmed: 0, skipped: 0, waiting: 0, ...over,
});

describe("campaign status words", () => {
  it("names each state and what it means", () => {
    expect(campaignState(campaign({ status: "pending_approval", recipients: 1 })).detail).toBe("Ready to send to 1 person once approved.");
    expect(campaignState(campaign({ status: "partially_completed", sent: 9, failed: 1, not_confirmed: 2 }))).toMatchObject({ label: "Partly sent", tone: "is-warn", detail: "Sent to 9 people; 1 failed; 2 not confirmed." });
    expect(campaignState(campaign({ status: "blocked", blocked_reason: "postal_address_missing" })).detail).toContain("postal address");
    expect(campaignState(campaign({ status: "scheduled", scheduled_for: new Date(Date.now() + 86_400_000).toISOString() })).label).toBe("Scheduled");
    expect(campaignState(campaign({ status: "scheduled", scheduled_for: null }))).toMatchObject({ label: "Approved", detail: "Approved, waiting to send." });
    expect(campaignState(campaign({ status: "scheduled", scheduled_for: new Date(Date.now() - 60_000).toISOString() })).label).toBe("Approved");
    expect(campaignState(campaign({ status: "cancelled", sent: 0 })).detail).toBe("Cancelled before sending.");
    expect(campaignState(campaign({ status: "draft", sent: 2 })).detail).toBe("A new version, not sent yet. Earlier versions reached 2 people.");
  });
});

describe("activity", () => {
  it("reads each event in words", () => {
    expect(activityDetail({ kind: "bounced", at: "", detail: "complaint" })).toBe("Marked an email as spam");
    expect(activityDetail({ kind: "subscribed", at: "", detail: "paige_form" })).toBe("From your form");
    expect(activityDetail({ kind: "campaign_sent", at: "", title: "October" })).toBe("October");
  });
  it("says how long ago", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(ago("2026-10-04T11:59:30Z", now)).toBe("Just now");
    expect(ago("2026-10-04T10:00:00Z", now)).toBe("2 hours ago");
    expect(ago("2026-10-03T12:00:00Z", now)).toBe("1 day ago");
  });
});

describe("what did not send, and what it costs", () => {
  it("a reported failure and an answer that never came are counted apart", () => {
    expect(unsent({ failed: 0, not_confirmed: 0 })).toBe("");
    expect(unsent({ failed: 2, not_confirmed: 0 })).toBe("; 2 failed");
    expect(unsent({ failed: 0, not_confirmed: 3 })).toBe("; 3 not confirmed");
  });
  it("under a cent never reads as free", () => {
    expect(costWords(0.0048)).toBe("less than $0.01");
    expect(costWords(0.2)).toBe("$0.20");
  });
});
