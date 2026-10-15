// @vitest-environment node
// The Studio form tools are governed like every other write: declared through the capability kit,
// classified in the one risk policy, and registered in the Spine. A mismatch would throw at the
// chat function's first cold start, so pin it here instead.
import { describe, expect, it } from "vitest";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
import { getSpineCapability } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import {
  GROWTH_FORM_PUBLISH_CAPABILITY,
  GROWTH_FORM_SAVE_CAPABILITY,
  GROWTH_FORM_TOOLS,
} from "../../supabase/functions/_shared/paige-spine/domains/growth_form.ts";

describe("Studio form tools are governed", () => {
  it("save is ordinary and publish is high, matching the risk policy", () => {
    expect(GROWTH_FORM_SAVE_CAPABILITY.governance.risk).toBe(classifyAction("growth_form_save"));
    expect(GROWTH_FORM_PUBLISH_CAPABILITY.governance.risk).toBe(classifyAction("growth_form_publish"));
    expect(classifyAction("growth_form_publish")).toBe("high");
  });

  it("both are registered in the Spine with a live chat binding", () => {
    expect(getSpineCapability("growth_form.save")?.action?.chatTool).toBe("growth_form_save");
    expect(getSpineCapability("growth_form.publish")?.action?.riskPolicyKey).toBe("high");
  });

  it("the tools the model sees are exactly these two", () => {
    expect(GROWTH_FORM_TOOLS.map((t) => t.function.name)).toEqual(["growth_form_save", "growth_form_publish"]);
  });
});
