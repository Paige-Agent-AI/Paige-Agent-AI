// @vitest-environment node
// The Studio form tools file an honest receipt: a server refusal is a refusal, an answer that never
// arrived is unknown (the save may have landed), and only a real success is a success.
import { describe, expect, it } from "vitest";
import { classifyGrowthFormRun } from "../../supabase/functions/_shared/growth-form-outcome.ts";

describe("Studio form receipts", () => {
  it("records a success only when the act says it succeeded", () => {
    expect(classifyGrowthFormRun({ capability: "growth_form_save", result: { success: true, form_id: "f" } })).toBe("capability_succeeded");
    expect(classifyGrowthFormRun({ capability: "growth_form_publish", result: { success: false, error: "x" } })).toBe("capability_refused");
  });
  it("tells a server refusal from a failure from a lost answer", () => {
    expect(classifyGrowthFormRun({ capability: "growth_form_publish", threw: true, thrown: { code: "42501", message: "GROWTH_FORBIDDEN" } })).toBe("capability_refused");
    expect(classifyGrowthFormRun({ capability: "growth_form_save", threw: true, thrown: { code: "22023", message: "GROWTH_FORM_LIVE_SLUG" } })).toBe("capability_refused");
    expect(classifyGrowthFormRun({ capability: "growth_form_save", threw: true, thrown: { code: "XX000", message: "boom" } })).toBe("capability_failed");
    expect(classifyGrowthFormRun({ capability: "growth_form_save", threw: true, thrown: new Error("TypeError: fetch failed") })).toBe("capability_outcome_unknown");
  });
  it("ignores every other tool", () => {
    expect(classifyGrowthFormRun({ capability: "growth_page_save", result: { success: true } })).toBeNull();
  });
});
