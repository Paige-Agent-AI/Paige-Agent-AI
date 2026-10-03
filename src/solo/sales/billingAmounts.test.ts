import { describe, expect, it } from "vitest";
import { parseMinorAmount, calculateBillingAmounts, remainingObligation } from "./billingAmounts";

describe("billing amount boundaries", () => {
  it("parses decimal input exactly without floating-point rounding", () => {
    expect(parseMinorAmount("10.29", 2)).toBe(1029);
    expect(parseMinorAmount("0.01", 2)).toBe(1);
    expect(parseMinorAmount("19", 0)).toBe(19);
    expect(parseMinorAmount("1.234", 3)).toBe(1234);
  });
  it.each(["1.001", "1e3", "-1", "NaN", "Infinity", "", ".", "1,000", "0x10"])("refuses ambiguous or overprecision input %s", value => {
    expect(() => parseMinorAmount(value, 2)).toThrow();
  });
  it("refuses unsafe amounts rather than losing precision", () => {
    expect(() => parseMinorAmount("90071992547409.92", 2)).toThrow();
    expect(() => calculateBillingAmounts(Number.MAX_SAFE_INTEGER, 2)).toThrow();
  });
  it("splits a deposit and remainder without double counting", () => {
    expect(calculateBillingAmounts(1001, 3, 2500)).toEqual({ totalMinor: 3003, dueNowMinor: 751, remainderMinor: 2252 });
  });
  it("keeps a one-time invoice entirely due now", () => {
    expect(calculateBillingAmounts(240000, 1)).toEqual({ totalMinor: 240000, dueNowMinor: 240000, remainderMinor: 0 });
  });
  it.each([0, -1, 1.5, 1001, NaN])("refuses invalid quantity %s", quantity => {
    expect(() => calculateBillingAmounts(100, quantity)).toThrow();
  });
  it.each([0, 10000, -1, 2500.5])("refuses invalid deposit basis points %s", deposit => {
    expect(() => calculateBillingAmounts(100, 1, deposit)).toThrow();
  });
  it("reopens only the refunded portion of an allocation", () => {
    expect(remainingObligation(400000, 100000, 25000)).toBe(325000);
  });
  it("rejects impossible allocation/refund evidence", () => {
    expect(() => remainingObligation(100, 101, 0)).toThrow();
    expect(() => remainingObligation(100, 50, 51)).toThrow();
  });
  it("supports repayment after a confirmed allocation reversal", () => {
    expect(remainingObligation(100, 150, 50)).toBe(0);
  });
  it("rounds half a minor unit up and refuses collapsed deposits", () => {
    expect(calculateBillingAmounts(3, 1, 5000)).toEqual({ totalMinor: 3, dueNowMinor: 2, remainderMinor: 1 });
    expect(() => calculateBillingAmounts(1, 1, 1)).toThrow();
    expect(() => calculateBillingAmounts(1, 1, 9999)).toThrow();
    expect(parseMinorAmount("90071992547409.91", 2)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
