// @vitest-environment node
// The Studio page tools are governed like every other write: declared through the capability kit,
// classified in the one risk policy, and registered in the Spine. A mismatch would throw at the
// chat function's first cold start (paige-ai-chat imports the registry), so pin it here instead.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
import { getSpineCapability } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import {
  GROWTH_PAGE_CAPABILITIES,
  GROWTH_PAGE_PUBLISH_CAPABILITY,
  GROWTH_PAGE_SAVE_CAPABILITY,
} from "../../supabase/functions/_shared/paige-spine/domains/growth_page.ts";
import { growthPagePublishToolDef } from "../../supabase/functions/_shared/growth-publish-command/chat-tools.ts";

// The save tool's JSON stays inline in the Chat handler; read its `required` list straight from the
// source so the declaration cannot drift from it unnoticed. Publish's JSON has one home since EXP08
// A2b (_shared/growth-publish-command/chat-tools.ts, which the handler and Team Hub both call), so its
// `required` list is read from the real definition, and the handler is pinned to call that factory.
const handler = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const chatRequired = (tool: string): string[] => {
  const at = handler.indexOf(`name: "${tool}",`);
  expect(at, `${tool} is declared in the Chat handler`).toBeGreaterThan(-1);
  const list = handler.slice(at).match(/required:\s*\[([^\]]*)\]/)?.[1] ?? "";
  return [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
};
// Open JSON objects are declared in their serialized form (`blocks` is declared as `blocks_json`).
const declaredAsChat = (required: readonly string[]) => required.map((k) => k.replace(/_json$/, ""));

describe("Studio page tools are governed", () => {
  it("save is ordinary and publish is high, matching the risk policy", () => {
    expect(GROWTH_PAGE_SAVE_CAPABILITY.governance.risk).toBe(classifyAction("growth_page_save"));
    expect(GROWTH_PAGE_PUBLISH_CAPABILITY.governance.risk).toBe(classifyAction("growth_page_publish"));
    expect(GROWTH_PAGE_SAVE_CAPABILITY.governance.risk).toBe("ordinary");
    expect(GROWTH_PAGE_PUBLISH_CAPABILITY.governance.risk).toBe("high");
  });

  it("both are registered in the Spine with a live chat binding on the canonical RPCs", () => {
    expect(getSpineCapability("growth_page.save")?.action).toMatchObject({ chatTool: "growth_page_save", executor: "public.growth_page_upsert", riskPolicyKey: "ordinary" });
    expect(getSpineCapability("growth_page.publish")?.action).toMatchObject({ chatTool: "growth_page_publish", executor: "public.growth_page_publish", riskPolicyKey: "high" });
    for (const c of GROWTH_PAGE_CAPABILITIES) expect([c.chatBinding, c.mindBinding, c.maturity]).toEqual(["LIVE", "UNAVAILABLE", "PARTIAL"]);
  });

  it("the declarations require what the model-facing tools require", () => {
    expect(declaredAsChat(GROWTH_PAGE_SAVE_CAPABILITY.input.required)).toEqual(chatRequired("growth_page_save"));
    expect(handler.includes(`name: "growth_page_publish",`), "publish is not re-declared inline").toBe(false);
    expect(handler.match(/^\s*growthPagePublishToolDef\(\),\s*$/gm)?.length, "the handler offers the shared publish definition").toBe(1);
    expect(declaredAsChat(GROWTH_PAGE_PUBLISH_CAPABILITY.input.required)).toEqual(growthPagePublishToolDef().function.parameters.required);
  });
});
