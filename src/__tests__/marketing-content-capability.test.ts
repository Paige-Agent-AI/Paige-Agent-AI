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

  it("a save inserts a row, and an in-place update is reachable ONLY through the on-canvas clamp", () => {
    expect(getSpineCapability("marketing_content.save")?.outcome?.kinds).toEqual(["created", "updated", "refused", "failed"]);
  });

  it("the declaration requires what the model-facing tool requires", () => {
    expect([...MARKETING_CONTENT_SAVE_CAPABILITY.input.required]).toEqual(chatRequired("content_save"));
  });
});

describe("content_save in-place refine is clamped to the on-canvas copy row (EXP07 rows 5/7)", () => {
  // The refine path reuses save_marketing_content's p_id update arm, which is an UPDATE scoped to
  // (id, tenant). The only safe authority for that id is the server's own canvas state — the same
  // #292 clamp generate_image uses. These pins hold the executor to it: a model-echoed id that does
  // not match the server's canvas artifact can never reach the update arm.
  const executorAt = handler.indexOf(`tc.function.name === "content_save"`);
  const executor = handler.slice(executorAt, handler.indexOf(`tc.function.name === "document_generate"`, executorAt));

  it("honors target_content_id only when it names the exact on-canvas artifact", () => {
    expect(executor).toContain('canvasArtifact?.kind === "content" && args.target_content_id === canvasArtifact.id');
    expect(executor).toContain("refineTargetId");
  });

  it("refines only copy rows — an image/document id degrades to a fresh save", () => {
    expect(executor).toContain('targetRow?.kind === "text"');
  });

  it("passes the clamp result to the canonical RPC as p_id, never a model-supplied id directly", () => {
    expect(executor).toContain("...(refineTargetId ? { p_id: refineTargetId } : {})");
    expect(executor).not.toMatch(/p_id:\s*args\./);
  });

  it("appends the session version snapshot after every Studio save/revision", () => {
    expect(executor).toContain('save_artifact_version');
    expect(executor).toContain('p_kind: "content"');
  });

  it("the model-facing tool declares the optional refine target with the omit-for-new rule", () => {
    const at = handler.indexOf(`name: "content_save",`);
    const schema = handler.slice(at, handler.indexOf("required:", at));
    expect(schema).toContain("target_content_id");
    expect(schema).toContain("refining/revising the copy already on the canvas");
    expect(schema).toContain("OMIT it to create a brand-new/additional piece");
  });
});

describe("the CANVAS STATE hint steers copy refinement by the row's own kind (EXP07)", () => {
  // The Studio client maps images, copy AND documents to canvas kind "content"; the hint must not
  // tell the model an on-canvas COPY is an image. It resolves the row's kind and steers copy to
  // content_save, images to generate_image, documents to the one-line cannot-revise answer.
  const hintAt = handler.indexOf(`EXP07 — the canvas kind "content" spans images AND copy`);
  const hintBlock = handler.slice(hintAt, hintAt + 4200);

  it("resolves the on-canvas content row's own kind before steering", () => {
    expect(hintAt).toBeGreaterThan(-1);
    expect(hintBlock).toContain('from("marketing_content")');
    expect(hintBlock).toContain('canvasRow?.kind === "image" ? "image"');
  });

  it("copy on canvas steers to content_save with target_content_id", () => {
    expect(hintBlock).toContain(`pass target_content_id:"${"${canvasArtifact.id}"}" to content_save`);
  });

  it("images keep the generate_image steer and documents keep cannot-revise", () => {
    expect(hintBlock).toContain(`to ${"${canvasTool}"}`);
    expect(hintBlock).toContain("Documents can't be revised in this Studio session");
  });
});
