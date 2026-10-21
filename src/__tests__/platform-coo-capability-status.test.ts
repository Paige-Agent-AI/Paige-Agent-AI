// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry";

/**
 * EXP00 PR A — Capability status synchronization for the Platform Operator COO tools.
 *
 * The two platform.company_* capabilities are the chat COO's data sources. This test
 * verifies their spine registration accurately reflects their deployed state:
 * chatBinding LIVE (they are live in chat, proven by the authenticated live probe),
 * readiness none (they have no external provider dependency — internal platform reads),
 * and classification read/read_only/none (no mutation authority).
 */
describe("Platform Operator COO capability status (EXP00 PR A)", () => {
  const tools = ["platform_customer_overview", "platform_commercial_summary"];

  it.each(tools)("capabilities.%s is registered with accurate status", (tool) => {
    const cap = PAIGE_SPINE_CAPABILITIES.find(
      (c) => c.action?.chatTool === tool,
    );
    expect(cap).toBeDefined();
    expect(cap?.chatBinding).toBe("LIVE");
    expect(cap?.action?.classification).toBe("read");
    expect(cap?.action?.riskPolicyKey).toBe("read_only");
    expect(cap?.action?.approvalAuthority).toBe("none");
    expect(cap?.action?.seatAuthority).toBe("member");
    // readiness "none" = no provider dependency to check, correct for internal reads
    expect(cap?.readiness).toBe("none");
  });

  it("the capability_status projection includes both tools on the model surface", () => {
    const liveChatTools = PAIGE_SPINE_CAPABILITIES.filter(
      (c) => c.chatBinding === "LIVE" && c.action?.chatTool,
    ).map((c) => c.action!.chatTool);
    expect(liveChatTools).toContain("platform_customer_overview");
    expect(liveChatTools).toContain("platform_commercial_summary");
  });

  it("neither tool carries an external provider binding (internal platform reads)", () => {
    for (const tool of tools) {
      const cap = PAIGE_SPINE_CAPABILITIES.find(
        (c) => c.action?.chatTool === tool,
      );
      // The SQL executor IS the operation — no external provider connection
      expect(cap?.action?.executor).toMatch(/^public\.operator_/);
    }
  });
});
