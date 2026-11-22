import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarViewPreferenceKey, readCalendarDefaultView, saveCalendarDefaultView } from "./calendarViewPreference";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("Calendar display preference", () => {
  it("defaults to Month without writing any preference", () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(readCalendarDefaultView("person", "business")).toBe("month");
    expect(write).not.toHaveBeenCalled();
  });
  it("keeps each person's business preference separate", () => {
    expect(saveCalendarDefaultView("person", "business", "week")).toBe(true);
    expect(readCalendarDefaultView("person", "business")).toBe("week");
    expect(readCalendarDefaultView("other-person", "business")).toBe("month");
    expect(readCalendarDefaultView("person", "other-business")).toBe("month");
    expect(saveCalendarDefaultView("person", "business", "agenda")).toBe(true);
    expect(readCalendarDefaultView("person", "business")).toBe("agenda");
  });
  it("ignores malformed or unavailable preferences", () => {
    localStorage.setItem(calendarViewPreferenceKey("person", "business")!, "invalid");
    expect(readCalendarDefaultView("person", "business")).toBe("month");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readCalendarDefaultView("person", "business")).toBe("month");
  });
  it("cannot save without the signed-in person and business or when storage fails", () => {
    expect(saveCalendarDefaultView(null, "business", "week")).toBe(false);
    expect(saveCalendarDefaultView("person", "", "week")).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(saveCalendarDefaultView("person", "business", "week")).toBe(false);
  });
});
