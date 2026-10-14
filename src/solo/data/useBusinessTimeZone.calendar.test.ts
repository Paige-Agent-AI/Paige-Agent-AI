import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { businessCalendarDay, businessCalendarHeldNote, businessDateLabel, businessZoneLabel, placeName, useBusinessCalendarDay, type BusinessTimeZoneLoad } from "./useBusinessTimeZone";

// Experience 04 E4-S3 (critique §2.6): "today" for a due or overdue judgement is the BUSINESS's
// calendar day, computed with the same function PAIGE's composer uses (localDateInZone). There is
// never a UTC or browser-zone fallback: without a usable zone the day is withheld.
const ready = (zone: string | null, state: "configured" | "missing" | "invalid" = zone ? "configured" : "missing", canSet = true): BusinessTimeZoneLoad =>
  ({ status: "ready", value: { state, zone, setAt: null, localDate: null, canSet } });

describe("businessCalendarDay", () => {
  it("is the business-local date west of UTC (UTC has already rolled over)", () => {
    expect(businessCalendarDay(ready("America/New_York"), Date.parse("2026-11-01T02:30:00Z")))
      .toEqual({ kind: "configured", zone: "America/New_York", date: "2026-10-31" });
  });
  it("is the business-local date east of UTC (the business has already rolled over)", () => {
    expect(businessCalendarDay(ready("Pacific/Kiritimati"), Date.parse("2026-10-31T12:00:00Z")))
      .toEqual({ kind: "configured", zone: "Pacific/Kiritimati", date: "2026-11-01" });
  });
  it("brackets the date line and survives a DST change", () => {
    expect(businessCalendarDay(ready("Pacific/Pago_Pago"), Date.parse("2026-10-31T09:00:00Z"))).toMatchObject({ date: "2026-10-30" });
    expect(businessCalendarDay(ready("America/New_York"), Date.parse("2026-03-08T07:59:59Z"))).toMatchObject({ date: "2026-03-08" });
  });
  it("never falls back: missing, invalid, refused, unreadable, no workspace and loading are withheld with no date", () => {
    const now = Date.parse("2026-10-31T12:00:00Z");
    expect(businessCalendarDay(ready(null), now)).toEqual({ kind: "withheld", reason: "missing", canSet: true });
    expect(businessCalendarDay(ready(null, "invalid", false), now)).toEqual({ kind: "withheld", reason: "invalid", canSet: false });
    expect(businessCalendarDay({ status: "refused" }, now)).toEqual({ kind: "withheld", reason: "refused", canSet: false });
    expect(businessCalendarDay({ status: "error" }, now)).toEqual({ kind: "withheld", reason: "unreadable", canSet: false });
    expect(businessCalendarDay({ status: "no_workspace" }, now)).toEqual({ kind: "withheld", reason: "no_workspace", canSet: false });
    expect(businessCalendarDay({ status: "loading" }, now)).toEqual({ kind: "withheld", reason: "loading", canSet: false });
  });
  it("a zone this browser cannot resolve is invalid, never UTC", () => {
    expect(businessCalendarDay(ready("Mars/Olympus_Mons"), Date.parse("2026-10-31T12:00:00Z")))
      .toEqual({ kind: "withheld", reason: "invalid", canSet: true });
  });
  it("does not depend on the viewer's own clock zone", () => {
    const at = Date.parse("2026-11-01T02:30:00Z");
    const before = process.env.TZ;
    try {
      for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        expect(businessCalendarDay(ready("America/Chicago"), at)).toMatchObject({ date: "2026-10-31" });
      }
    } finally { process.env.TZ = before; }
  });
});

describe("useBusinessCalendarDay", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("re-judges across the business midnight on a page left open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-31T04:59:30Z")); // 23:59:30 in Chicago (CDT, UTC-5)
    const seen: string[] = [];
    const reader = async () => ready("America/Chicago");
    function Probe() {
      const { day } = useBusinessCalendarDay("tenant-a", reader);
      seen.push(day.kind === "configured" ? day.date : day.kind);
      return null;
    }
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => { root.render(createElement(Probe)); });
    await act(async () => { await Promise.resolve(); });
    expect(seen.at(-1)).toBe("2026-10-30");
    await act(async () => { vi.advanceTimersByTime(61_000); });
    expect(seen.at(-1)).toBe("2026-10-31");
    act(() => root.unmount());
  });
});

// E4-S3 PR beta fix pass: ONE home for the words a surface uses about the business calendar, so
// Collections, the client record and Setup cannot drift (integrator decisions 4 and 6).
describe("business calendar words", () => {
  it("names a zone the way people say it, beside the place", () => {
    expect(businessZoneLabel("America/Chicago")).toBe("Central Time (Chicago)");
    expect(businessZoneLabel("America/Argentina/Buenos_Aires")).toMatch(/\(Buenos Aires, Argentina\)$/);
    expect(placeName("UTC")).toBe("Coordinated Universal Time");
  });
  it("writes a business date as a person reads it, never shifted through a zone", () => {
    expect(businessDateLabel("2026-10-13")).toBe("Oct 13, 2026");
    expect(businessDateLabel("2026-01-01")).toBe("Jan 1, 2026");
  });
  it("a held judgement says WHY: a missing zone and an unrecognised one are different sentences", () => {
    // Frozen wording for the missing case (cross-track contract §2.4) is unchanged.
    expect(businessCalendarHeldNote("missing", "record")).toBe("On hold until the business time zone is set");
    expect(businessCalendarHeldNote("missing", "tile", true)).toBe("Set your business time zone");
    expect(businessCalendarHeldNote("missing", "tile", false)).toBe("Until the business owner sets the business time zone");
    expect(businessCalendarHeldNote("invalid", "record")).toBe("On hold: the saved business time zone isn’t recognised");
    expect(businessCalendarHeldNote("invalid", "tile", true)).toBe("The saved business time zone isn’t recognised");
    expect(businessCalendarHeldNote("unreadable", "tile")).toBe("The business calendar couldn’t be read");
    expect(businessCalendarHeldNote("loading", "tile")).toBe("");
  });
});
