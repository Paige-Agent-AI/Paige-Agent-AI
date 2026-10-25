// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as addressing from "../../supabase/functions/_shared/paige-context/vp-address";

const chat = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");

describe("Operations review instruction contract", () => {
  it("gives PAIGE and ZION the same bounded read-first guidance", () => {
    const guidance = (addressing as unknown as Record<string, string>).OPERATIONS_REVIEW_GUIDANCE;
    expect(typeof guidance).toBe("string");
    expect(chat.includes("OPERATIONS_REVIEW_GUIDANCE}")).toBe(true);
    const block = addressing.buildVpAddressBlock(addressing.detectVpAddress("ZION, review this week read-only")!, "Test studio");
    expect(block).toContain(guidance);
    for (const reader of ["crm_list_tasks", "plan_list", "crm_list_team", "read_business_time_zone", "crm_get_task"]) {
      expect(guidance).toContain(reader);
    }
  });

  it("does not require a specialist/action-queue detour for an ordinary read", () => {
    expect(chat.includes("When a real job arrives, FIRST call list_subagents")).toBe(false);
    expect(chat.includes("Delegate by default; you integrate the results")).toBe(false);
    const guidance = (addressing as unknown as Record<string, string>).OPERATIONS_REVIEW_GUIDANCE ?? "";
    expect(guidance).toContain("Do not enumerate the action queue or specialist roster");
    expect(guidance).toContain("Do not repeat a list read with overlapping filters");
  });
  it("uses one offered bounded agenda without inventing the business zone or hiding partial coverage", () => {
    const guidance = addressing.OPERATIONS_REVIEW_GUIDANCE;
    for (const rule of ["read_calendar_agenda at most once", "only when offered", "explicit window", "confirmed business zone", "title previews", "narrower", "read_calendar_booking"]) expect(guidance).toContain(rule);
    expect(guidance).not.toContain("Read only a known exact booking when needed and offered; otherwise say Calendar coverage is unavailable");
  });

  it("preserves missing-source truth and does not turn a review into an action", () => {
    const guidance = (addressing as unknown as Record<string, string>).OPERATIONS_REVIEW_GUIDANCE ?? "";
    for (const rule of ["not a complete Calendar agenda", "unavailable, not empty", "no action authority", "original record controls", "at most three priorities"]) {
      expect(guidance).toContain(rule);
    }
    expect(chat).toContain("const MAX_ROUNDS = 5, MAX_TOTAL_TOOL_CALLS = 12;");
    expect(chat).toContain("const WALL_CLOCK_MS = PAIGE_INTERACTIVE_TURN_BUDGET_MS;");
    expect(chat).toContain("if (seenSignatures.has(sig))");
    expect(guidance).toContain("apply this section only when the customer requests inspection");
    expect(guidance).toContain("must not disable those authorized action pathways");
  });

  it("keeps this instruction out of unrelated specialist identities", () => {
    const guidance = (addressing as unknown as Record<string, string>).OPERATIONS_REVIEW_GUIDANCE;
    expect(typeof guidance).toBe("string");
    for (const vp of ["VERA", "CURA", "NEXUS", "MENTOR", "MERIT"]) {
      expect(addressing.buildVpAddressBlock(addressing.detectVpAddress(`${vp}, review my work`)!, "Test studio")).not.toContain(guidance);
    }
  });
});
