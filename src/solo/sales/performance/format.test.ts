import { describe, expect, it } from "vitest";
import { chartMaximum, chartRatio, formatMetricMoney } from "./format";

describe("Sales metric presentation precision",()=>{
  it("formats arbitrary aggregate precision without converting money to Number",()=>{
    expect(formatMetricMoney("900719925474099301", "USD")).toBe("$9,007,199,254,740,993.01");
  });
  it("uses canonical supported currency exponents",()=>{
    expect(formatMetricMoney("1250", "JPY")).toContain("1,250");
    expect(formatMetricMoney("1250", "KWD")).toContain("1.250");
  });
  it("retains signed corrections including a negative fraction",()=>{
    expect(formatMetricMoney("-1", "USD")).toBe("−$0.01");
    expect(formatMetricMoney("-1250", "USD")).toBe("−$12.50");
  });
  it("does not guess an unknown currency or malformed amount",()=>{
    expect(formatMetricMoney("1250", "ZZZ")).toBe("Amount unavailable (ZZZ)");
    expect(formatMetricMoney("1.25", "USD")).toBe("Amount unavailable (USD)");
  });
  it("bounds chart geometry independently of exact displayed values",()=>{
    expect(chartRatio("900719925474099301", "900719925474099301")).toBe(100);
    expect(chartRatio("-10", "100")).toBe(0);
    expect(chartRatio("100", "0")).toBe(0);
    expect(chartMaximum(["100", "99999999999999999999", "-200"])).toBe("99999999999999999999");
  });
});
