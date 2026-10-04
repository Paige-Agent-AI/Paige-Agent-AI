// @vitest-environment node
// Saving copy to the content library is governed like every other write: declared through the
// capability kit, classified in the one risk policy, and registered in the Spine. A mismatch would
// throw at the chat function's first cold start (paige-ai-chat imports the registry), so pin it here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
import { getSpineCapability } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import {
  MARKETING_CONTENT_CAPABILITIES,
  MARKETING_CONTENT_SAVE_CAPABILITY,
} from "../../supabase/functions/_shared/paige-spine/domains/marketing_content.ts";

const handler = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const chatRequired = (tool: string): string[] => {
  const at = handler.indexOf(`name: "${tool}",`);
  expect(at, `${tool} is declared in the Chat handler`).toBeGreaterThan(-1);
  const list = handler.slice(at).match(/required:\s*\[([^\]]*)\]/)?.[1] ?? "";
  return [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
};

describe("content_save is governed", () => {
  it("is ordinary, matching the risk policy", () => {
    expect(MARKETING_CONTENT_SAVE_CAPABILITY.governance.risk).toBe(classifyAction("content_save"));
    expect(MARKETING_CONTENT_SAVE_CAPABILITY.governance.risk).toBe("ordinary");
  });

  it("is registered in the Spine with a live chat binding on the canonical RPC", () => {
    expect(getSpineCapability("marketing_content.save")?.action).toMatchObject({ chatTool: "content_save", executor: "public.save_marketing_content", riskPolicyKey: "ordinary" });
    for (const c of MARKETING_CONTENT_CAPABILITIES) expect([c.chatBinding, c.mindBinding, c.maturity]).toEqual(["LIVE", "UNAVAILABLE", "PARTIAL"]);
  });

  it("every save creates a row from Chat, so the outcome never claims an update", () => {
    expect(getSpineCapability("marketing_content.save")?.outcome?.kinds).toEqual(["created", "refused", "failed"]);
  });

  it("the declaration requires what the model-facing tool requires", () => {
    expect([...MARKETING_CONTENT_SAVE_CAPABILITY.input.required]).toEqual(chatRequired("content_save"));
  });
});
