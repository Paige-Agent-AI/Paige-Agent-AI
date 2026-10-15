// @vitest-environment node
// The Studio funnel tools are governed like every other write: declared through the capability kit,
// classified in the one risk policy, and registered in the Spine. A mismatch would throw at the
// chat function's first cold start (paige-ai-chat imports the registry), so pin it here instead.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
import { getSpineCapability } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import {
  GROWTH_FUNNEL_BUILD_CAPABILITY,
  GROWTH_FUNNEL_CAPABILITIES,
  GROWTH_FUNNEL_PUBLISH_CAPABILITY,
} from "../../supabase/functions/_shared/paige-spine/domains/growth_funnel.ts";

// The tool JSON the model sees stays inline in the Chat handler in this slice; read its `required`
// list straight from the source so the declaration cannot drift from it unnoticed.
const handler = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const chatRequired = (tool: string): string[] => {
  const at = handler.indexOf(`name: "${tool}",`);
  expect(at, `${tool} is declared in the Chat handler`).toBeGreaterThan(-1);
  const list = handler.slice(at).match(/required:\s*\[([^\]]*)\]/)?.[1] ?? "";
  return [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
};
// Open JSON objects are declared in their serialized form (`page` is declared as `page_json`).
const declaredAsChat = (required: readonly string[]) => required.map((k) => k.replace(/_json$/, ""));

describe("Studio funnel tools are governed", () => {
  it("build is ordinary and publish is high, matching the risk policy", () => {
    expect(GROWTH_FUNNEL_BUILD_CAPABILITY.governance.risk).toBe(classifyAction("growth_funnel_build"));
    expect(GROWTH_FUNNEL_PUBLISH_CAPABILITY.governance.risk).toBe(classifyAction("growth_funnel_publish"));
    expect(GROWTH_FUNNEL_BUILD_CAPABILITY.governance.risk).toBe("ordinary");
    expect(GROWTH_FUNNEL_PUBLISH_CAPABILITY.governance.risk).toBe("high");
  });

  it("both are registered in the Spine with a live chat binding on the canonical RPCs", () => {
    expect(getSpineCapability("growth_funnel.build")?.action).toMatchObject({ chatTool: "growth_funnel_build", executor: "public.growth_funnel_upsert", riskPolicyKey: "ordinary" });
    expect(getSpineCapability("growth_funnel.publish")?.action).toMatchObject({ chatTool: "growth_funnel_publish", executor: "public.growth_funnel_publish", riskPolicyKey: "high" });
    for (const c of GROWTH_FUNNEL_CAPABILITIES) expect([c.chatBinding, c.mindBinding, c.maturity]).toEqual(["LIVE", "UNAVAILABLE", "PARTIAL"]);
  });

  it("a partial build is not a success kind — it is recorded as failed", () => {
    expect(getSpineCapability("growth_funnel.build")?.outcome?.kinds).toEqual(["created", "updated", "refused", "failed"]);
  });

  it("the declarations require what the model-facing tools require", () => {
    expect(declaredAsChat(GROWTH_FUNNEL_BUILD_CAPABILITY.input.required)).toEqual(chatRequired("growth_funnel_build"));
    expect(declaredAsChat(GROWTH_FUNNEL_PUBLISH_CAPABILITY.input.required)).toEqual(chatRequired("growth_funnel_publish"));
  });
});
