// @vitest-environment node
import { describe, expect, it } from "vitest";
import { targetPeriod, targetValue, formatTargetValue } from "./mission-target-form";
describe("target editor period and exact numeric input", () => {
  it.each([
    ["2026-03-08", "America/New_York", 23],
    ["2026-11-01", "America/New_York", 25],
    ["2026-10-14", "UTC", 24],
    ["2026-10-14", "Pacific/Kiritimati", 24],
  ])("uses real calendar midnights for %s in %s, not fixed 24-hour arithmetic", (date, zone, hours) => {
    const result = targetPeriod(String(date), String(date), String(zone));
    expect(result).not.toBeNull();
    expect((Date.parse(result!.end) - Date.parse(result!.start)) / 3600000).toBe(hours);
    expect(result!.time_zone).toBe(zone);
  });
  it.each([["2026-02-30", "2026-03-01", "UTC"], ["2026-10-15", "2026-10-14", "UTC"], ["2026-10-14", "2026-10-14", "invalid-zone"]])("rejects nonexistent dates, reversed bounds and invalid calendars", (start, end, zone) => {
    expect(targetPeriod(start, end, zone)).toBeNull();
  });
  it.each([["jpy", "9007199254740993001", "9007199254740993001"], ["usd", "90071992547409930.01", "9007199254740993001"], ["kwd", "-0.123", "-123"]])("converts %s amounts to exact issuer minor units", (currency, major, minor) => {
    expect(targetValue(major, "currency_totals", currency)).toBe(minor);
    expect(formatTargetValue(minor, "currency_totals", currency)).toBe(`${currency.toUpperCase()} ${major}`);
  });
  it.each(["1.001", "1e3", "NaN", "01", ""]) ("rejects unsupported currency input precision or syntax: %s", raw => {
    expect(targetValue(raw, "currency_totals", "usd")).toBeNull();
  });
  it("preserves exact count/decimal input and refuses fractional or negative counts", () => {
    expect(targetValue("9007199254740993001", "count", null)).toBe("9007199254740993001");
    expect(targetValue("-0.123", "decimal", null)).toBe("-0.123");
    expect(targetValue("1.1", "count", null)).toBeNull();
    expect(targetValue("-1", "count", null)).toBeNull();
  });
});
