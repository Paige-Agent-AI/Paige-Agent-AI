// @vitest-environment node
// Every Vibe Studio act files one honest receipt: a server refusal is a refusal, a publish the
// readback could not prove live or an answer that never arrived is unknown (it may have landed), a
// funnel that stopped after an earlier write is a failure, and only a real success is a success.
import { describe, expect, it } from "vitest";
import { classifyStudioRun, STUDIO_RECEIPT_KEYS, studioReceiptDetail } from "../../supabase/functions/_shared/studio-run-outcome.ts";

const outcome = (capability: string, input: Record<string, unknown>) => classifyStudioRun({ capability, ...input })?.outcome ?? null;

describe("Studio receipts", () => {
  it("covers every Studio save and publish, and files images under one key", () => {
    expect([...STUDIO_RECEIPT_KEYS.keys()].sort()).toEqual([
      "content_save", "generate_image", "growth_form_publish", "growth_form_save", "growth_funnel_build",
      "growth_funnel_publish", "growth_page_publish", "growth_page_save",
    ]);
    expect(classifyStudioRun({ capability: "generate_image", result: { success: true, url: "u" } })).toEqual({ key: "vibe_media_image", outcome: "capability_succeeded" });
  });

  it("records a success only when the act says it succeeded", () => {
    expect(outcome("growth_page_save", { result: { success: true, page_id: "p" } })).toBe("capability_succeeded");
    expect(outcome("growth_form_publish", { result: { success: false, error: "x" } })).toBe("capability_refused");
  });

  it("records an unproven publish and a lost answer as unknown, never as refused", () => {
    expect(outcome("growth_page_publish", { result: { success: false, outcome: "unverified" } })).toBe("capability_outcome_unknown");
    expect(outcome("growth_funnel_build", { result: { success: false, outcome: "unknown", outcome_unknown: true } })).toBe("capability_outcome_unknown");
  });

  it("records a funnel build that stopped after an earlier write as failed", () => {
    expect(outcome("growth_funnel_build", { result: { success: false, outcome: "partial", saved_drafts: { page_id: "p" } } })).toBe("capability_failed");
  });

  it("records an image with no provider configured as unreachable, and files nothing for a render in progress", () => {
    expect(outcome("generate_image", { result: { success: false, needs_config: true } })).toBe("capability_unreachable");
    expect(classifyStudioRun({ capability: "generate_image", result: { success: true, pending: true, job_id: "j" } })).toBeNull();
  });

  it("tells a server refusal from a failure from a lost answer", () => {
    expect(outcome("growth_form_publish", { threw: true, thrown: { code: "42501", message: "GROWTH_FORBIDDEN" } })).toBe("capability_refused");
    expect(outcome("growth_form_save", { threw: true, thrown: { code: "22023", message: "GROWTH_FORM_LIVE_SLUG" } })).toBe("capability_refused");
    expect(outcome("content_save", { threw: true, thrown: { code: "XX000", message: "boom" } })).toBe("capability_failed");
    expect(outcome("growth_page_save", { threw: true, thrown: new Error("TypeError: fetch failed") })).toBe("capability_outcome_unknown");
    // The shape postgrest-js actually throws when the request never got an answer.
    expect(outcome("growth_form_publish", { threw: true, thrown: { code: "", message: "TypeError: fetch failed", details: "", hint: "" } })).toBe("capability_outcome_unknown");
  });

  it("ignores every other tool, including drafts that save nothing", () => {
    expect(classifyStudioRun({ capability: "draft_marketing_content", result: { success: true } })).toBeNull();
    expect(classifyStudioRun({ capability: "growth_page_generate", result: { success: true } })).toBeNull();
    expect(classifyStudioRun({ capability: "crm_create_contact", result: { success: true } })).toBeNull();
  });

  it("carries how the act was approved and the record it touched — ids only, never copy", () => {
    expect(studioReceiptDetail({ success: true, page_id: "p1", slug: "s", body: "secret copy", status: "draft" }, "operator_card"))
      .toEqual({ approval: "operator_card", page_id: "p1", status: "draft" });
    expect(studioReceiptDetail(null, undefined)).toEqual({});
  });
});
