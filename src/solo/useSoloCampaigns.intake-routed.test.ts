import { describe, expect, it } from "vitest";
import { intakeRouted } from "./useSoloCampaigns";

// A form routed through its own intake settings (Vibe Studio's form settings or the form panel:
// growth_form_set_intake writes auto_create_deal + pipeline_id) used to read "Not routed" because
// only automation rows counted. INT-342 grounding, 2026-10-10.
describe("intakeRouted", () => {
  const none = { routingConfigured: false, routingState: "No route" as const, extra: 1 };

  it("counts a form whose intake creates deals in a pipeline as routed", () => {
    expect(intakeRouted(none, { auto_create_deal: true, pipeline_id: "pipe-1" })).toEqual({ routingConfigured: true, routingState: "Active", extra: 1 });
  });

  it("does not count a pipeline without deal creation, or deal creation without a pipeline", () => {
    expect(intakeRouted(none, { auto_create_deal: false, pipeline_id: "pipe-1" })).toBe(none);
    expect(intakeRouted(none, { auto_create_deal: true, pipeline_id: null })).toBe(none);
    expect(intakeRouted(none, { auto_create_deal: null, pipeline_id: null })).toBe(none);
  });

  it("keeps automation-row evidence as it is, including its approval-gated state", () => {
    const gated = { routingConfigured: true, routingState: "Active + approval-gated" as const };
    expect(intakeRouted(gated, { auto_create_deal: true, pipeline_id: "pipe-1" })).toBe(gated);
  });
});
