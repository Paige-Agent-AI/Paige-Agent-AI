// Email series (E3): the pure wording of waits, timelines, states and the approval summary.
import { describe, expect, it } from "vitest";
import { dayWords, hoursFromJoin, joinWait, seriesState, spanWords, splitWait, startSummary, waitWords } from "../solo/marketing-email-series-model";

describe("waits", () => {
  it("read in words, from joining for the first email and from the one before for the rest", () => {
    expect(waitWords(0, 0)).toBe("Right away");
    expect(waitWords(0, 2)).toBe("Right after the email before");
    expect(waitWords(2880, 1)).toBe("2 days later");
    expect(waitWords(10080, 1)).toBe("1 week later");
    expect(waitWords(1440 + 180, 0)).toBe("1 day 3 hours after they join");
    expect(waitWords(60, 1)).toBe("1 hour later");
  });
  it("split into days and hours and join back, clamped to 90 days and 23 hours", () => {
    expect(splitWait(1440 * 2 + 300)).toEqual({ days: 2, hours: 5 });
    expect(joinWait(2, 5)).toBe(1440 * 2 + 300);
    expect(joinWait(500, 0)).toBe(90 * 1440);
    expect(joinWait(1, 40)).toBe(1440 + 23 * 60);
    expect(joinWait(-3, -1)).toBe(0);
  });
  it("add up to where each email lands", () => {
    const steps = [{ delay_minutes: 0 }, { delay_minutes: 2880 }, { delay_minutes: 7200 }];
    expect(hoursFromJoin(steps)).toEqual([0, 48, 168]);
    expect(dayWords(0)).toBe("when they join");
    expect(dayWords(5)).toBe("within the first day");
    expect(dayWords(168)).toBe("about day 7");
    expect(spanWords(steps)).toBe("over about 7 days");
    expect(spanWords([{ delay_minutes: 0 }])).toBe("all at once");
  });
});

describe("states and the approval summary", () => {
  it("name each state in the owner's words", () => {
    expect(seriesState("active")).toEqual({ label: "Running", tone: "is-live" });
    expect(seriesState("blocked").label).toBe("Needs attention");
    expect(seriesState("pending_approval").label).toBe("Waiting for approval");
  });
  it("says who it reaches, from whom, and the shared daily limit", () => {
    expect(startSummary({ name: "Win back", emails: 3, mode: "matching", matching: 42, from: "a@b.c", cap: 500, change: false }))
      .toBe("Start “Win back”: 3 emails to the 42 people who match today, and anyone who matches later. From a@b.c. Up to 500 emails a day across all your marketing email.");
    expect(startSummary({ name: "Welcome", emails: 1, mode: "new_contacts", matching: null, from: "a@b.c", cap: 500, change: false }))
      .toContain("1 email to new contacts as they arrive.");
    expect(startSummary({ name: "Welcome", emails: 2, mode: "new_contacts", matching: null, from: "a@b.c", cap: 500, change: true }))
      .toContain("carry on with the new emails from where they are");
  });
});
