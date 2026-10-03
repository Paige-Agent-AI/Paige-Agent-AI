/**
 * The two server behaviours the Studio stage depends on, pinned at their source.
 * EVIDENCE CLASS: static contract over the edge source. It proves the instruction and the frame are
 * there; whether the model follows the instruction is owed to an authenticated drive.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STUDIO_OPERATING_CORE } from "../../../supabase/functions/_shared/design-agent-prompt";

const chat = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");

describe("Studio edge contract", () => {
  it("tells the Studio designer to save a designed page or funnel in the same turn, never to ask", () => {
    expect(STUDIO_OPERATING_CORE).toContain("SAVE WHAT YOU BUILD, IN THE SAME TURN");
    expect(STUDIO_OPERATING_CORE).toContain("after growth_page_generate, call growth_page_save");
    expect(STUDIO_OPERATING_CORE).toContain("after growth_funnel_generate, call growth_funnel_build");
    expect(STUDIO_OPERATING_CORE).toContain('Never end a turn asking "want me to save it?"');
  });

  it("sends a designed-but-unsaved page to the stage as a preview, only when nothing was saved", () => {
    expect(chat).toContain("let studioPreview:");
    const emit = chat.slice(chat.indexOf("if (studioLinked.length) emitContent"), chat.indexOf("if (studioLinked.length) emitContent") + 400);
    expect(emit).toContain("else if (studioPreview) emitContent");
    expect(emit).toContain("paige_preview: studioPreview");
    // Only inside a Studio project: the preview is set behind studioSessionId.
    expect(chat).toMatch(/if \(studioSessionId && Array\.isArray\(\(gd as any\)\?\.blocks\)/);
  });
});
