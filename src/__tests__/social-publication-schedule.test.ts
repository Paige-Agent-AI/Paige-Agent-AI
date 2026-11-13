import { describe, expect, it } from "vitest";
import { readSocialSchedule, socialScheduleChoices, socialScheduleLabel } from "../../supabase/functions/_shared/social-publish-command/schedule";
describe("the exact original Social future instruction", () => {
  it("keeps civil time, UTC, zone and chosen offset together", () => {
    const [choice] = socialScheduleChoices("2027-07-20T10:15", "America/New_York");
    expect(choice).toEqual({ scheduled_for: "2027-07-20T14:15:00.000Z", timezone: "America/New_York", civil_time: "2027-07-20T10:15", offset_minutes: -240, disambiguation: "unique" });
    expect(readSocialSchedule(choice, Date.parse("2027-07-19T00:00Z"))).toEqual(choice);
    expect(socialScheduleLabel(choice)).toContain("UTC-04:00");
  });
  it("rejects the skipped spring time and keeps both fall occurrences explicit", () => {
    expect(socialScheduleChoices("2027-03-14T02:30", "America/New_York")).toEqual([]);
    const choices = socialScheduleChoices("2027-11-07T01:30", "America/New_York");
    expect(choices.map(x => [x.scheduled_for, x.disambiguation])).toEqual([["2027-11-07T05:30:00.000Z", "earlier"], ["2027-11-07T06:30:00.000Z", "later"]]);
    expect(readSocialSchedule({ ...choices[0], disambiguation: "unique" })).toBeNull();
  });
  it("does not turn a stale time, forged offset or added instruction into publish now", () => {
    const [choice] = socialScheduleChoices("2027-07-20T10:15", "UTC");
    expect(readSocialSchedule(choice, Date.parse("2027-07-20T10:14Z"))).toBeNull();
    expect(readSocialSchedule({ ...choice, offset_minutes: 60 })).toBeNull();
    expect(readSocialSchedule({ ...choice, publishNow: true })).toBeNull();
    expect(readSocialSchedule({ ...choice, scheduled_for: "2027-07-20T10:15Z" })).toBeNull();
  });
  it("refuses invalid dates and zones and handles a fractional-hour zone", () => {
    expect(() => socialScheduleChoices("2027-02-30T12:00", "UTC")).toThrow();
    expect(() => socialScheduleChoices("2027-02-20T12:00", "browser time")).toThrow();
    expect(socialScheduleChoices("2027-07-20T10:15", "Asia/Kathmandu")[0].scheduled_for).toBe("2027-07-20T04:30:00.000Z");
  });
});
