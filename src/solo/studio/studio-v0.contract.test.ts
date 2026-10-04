/**
 * Vibe Studio V0 — the live-defect fixes, pinned.
 *
 * EVIDENCE CLASSES:
 *  - publishVerified and publishArtifact are driven BEHAVIOURALLY (real functions, mocked RPC).
 *  - The paige-ai-chat rules (ceiling-respecting Studio lift, funnel reachability, partial funnel
 *    outcomes, document_generate off the Studio surface, publish readback, content_save audit
 *    target) are a STATIC contract over the edge source — the repo's idiom for that 15k-line file.
 *    Each assertion fails on main 61473b7c. Whether production behaves so is owed to an
 *    authenticated drive.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishVerified, PUBLISH_UNVERIFIED_ERROR } from "../../../supabase/functions/_shared/artifact-receipt";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));

const chat = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const between = (from: string, to: string) => {
  const i = chat.indexOf(from);
  expect(i, `anchor not found: ${from}`).toBeGreaterThan(-1);
  const j = chat.indexOf(to, i + from.length);
  expect(j, `end anchor not found: ${to}`).toBeGreaterThan(-1);
  return chat.slice(i, j);
};

describe("publishVerified — live only on a readback that proves it", () => {
  const at = "2026-10-04T10:00:00Z";
  it("accepts each kind's live status with a publish time and an address", () => {
    expect(publishVerified("page", { status: "published", published_at: at, url: "/p/acme/offer" })).toBe(true);
    expect(publishVerified("form", { status: "active", published_at: at, url: "/form/1" })).toBe(true);
    expect(publishVerified("funnel", { status: "active", published_at: at, url: "/f/acme/launch" })).toBe(true);
    expect(publishVerified("image", { status: "published", published_at: at, url: "https://cdn.example/x.png" })).toBe(true);
  });
  it("refuses a missing or blank address — the no-public-slug case", () => {
    expect(publishVerified("page", { status: "published", published_at: at, url: null })).toBe(false);
    expect(publishVerified("funnel", { status: "active", published_at: at, url: "   " })).toBe(false);
  });
  it("refuses the wrong status, a missing publish time, and a non-object", () => {
    expect(publishVerified("page", { status: "draft", published_at: at, url: "/p/a/b" })).toBe(false);
    expect(publishVerified("form", { status: "published", published_at: at, url: "/form/1" })).toBe(false);
    expect(publishVerified("page", { status: "published", published_at: null, url: "/p/a/b" })).toBe(false);
    expect(publishVerified("page", null)).toBe(false);
    expect(PUBLISH_UNVERIFIED_ERROR).toMatch(/can't say it's live/);
  });
});

describe("Publish panel path (publishArtifact) — never 'Published' without an address", () => {
  beforeEach(() => rpcMock.mockReset());
  it("returns the address when the server proves the artifact is live", async () => {
    rpcMock.mockResolvedValue({ data: { id: "1", status: "published", published_at: "2026-10-04T10:00:00Z", url: "/p/acme/offer" }, error: null });
    const { publishArtifact } = await import("./studio-data");
    await expect(publishArtifact("page", "1")).resolves.toEqual({ url: "/p/acme/offer" });
  });
  it("throws a plain refusal when the readback has no address", async () => {
    rpcMock.mockResolvedValue({ data: { id: "1", status: "published", published_at: "2026-10-04T10:00:00Z", url: null }, error: null });
    const { publishArtifact } = await import("./studio-data");
    await expect(publishArtifact("page", "1")).rejects.toThrow(/didn't confirm a public address/);
  });
  it("throws when the status is not the kind's live state", async () => {
    rpcMock.mockResolvedValue({ data: { id: "1", status: "draft", published_at: "2026-10-04T10:00:00Z", url: "/form/1" }, error: null });
    const { publishArtifact } = await import("./studio-data");
    await expect(publishArtifact("form", "1")).rejects.toThrow(/didn't confirm a public address/);
  });
});

describe("D1 — the Studio auto-run list never runs above the Trust Compass ceiling", () => {
  it("keeps main PAIGE on the canonical resolver and asks the ceiling fact only for a lift, failing closed", () => {
    const mode = between("const resolveToolAutonomy = async", "const ceilingAllowsAutoCache");
    expect(mode).toContain('supabaseClient.rpc("resolve_tool_autonomy", {');
    const fact = between("const ceilingAllowsAuto = async", "return allowed;");
    expect(fact).toContain('supabaseClient.rpc("resolve_tool_autonomy_detail"');
    expect(fact).toContain("let allowed = false;");
    expect(fact).toContain("ceiling_allows_auto === true");
  });
  it("lifts confirm to auto only when the ceiling allows acting unread", () => {
    const lift = between("const STUDIO_AUTO_TOOLS = new Set([", 'autoMode = "auto";');
    expect(lift).toContain('studioSessionId && STUDIO_AUTO_TOOLS.has(tc.function.name) && autoMode === "confirm"');
    expect(lift).toContain('classifyAction(tc.function.name) === "ordinary"');
    expect(lift).toContain("&& (await ceilingAllowsAuto(tc.function.name))");
  });
});

describe("D4 — document_generate is off the Studio surface", () => {
  it("is not on the Studio auto-run list", () => {
    const list = between("const STUDIO_AUTO_TOOLS = new Set([", "]);");
    expect(list).not.toContain("document_generate");
  });
  it("is removed from the tools a Studio turn is shown", () => {
    const studioDefs = between("if (studioSessionId) {\n      // document_generate has no Studio execution path", 'name: "ask_choices"');
    expect(studioDefs).toContain('toolDefs.findIndex((d: any) => d?.function?.name === "document_generate")');
    expect(studioDefs).toContain("toolDefs.splice(docIdx, 1)");
  });
});

describe("D2 — funnel tools are reachable, and a partial build is never success", () => {
  it("routes the three funnel tools into the dispatch branch that handles them", () => {
    const gate = between('tc.function.name === "growth_form_publish" ||', "// Role gate: admin only");
    for (const t of ["growth_funnel_generate", "growth_funnel_build", "growth_funnel_publish"]) {
      expect(gate).toContain(`tc.function.name === "${t}" ||`);
    }
  });
  it("reports a build that failed after a write as partial, naming what was saved", () => {
    const build = between('} else if (tc.function.name === "growth_funnel_build") {', '} else if (tc.function.name === "growth_funnel_publish") {');
    expect(build).toContain("_fbWritten.page_id = _pageId;");
    expect(build).toContain("_fbWritten.form_id = _formId;");
    expect(build).toContain('if (!_formId) throw new Error("The funnel\'s intake form didn\'t save.");');
    expect(build).toContain("if (!_fbWritten.page_id) throw _fbErr;");
    expect(build).toMatch(/success: false,\s*outcome: "partial",[\s\S]*saved_drafts: _fbWritten/);
  });
});

describe("Publish truth in chat — no success without the published readback", () => {
  it.each([
    ["growth_page_publish", '"page", pub'],
    ["growth_form_publish", '"form", pub'],
    ["growth_funnel_publish", '"funnel", _pub'],
  ])("%s requires publishVerified", (tool, call) => {
    const start = `} else if (tc.function.name === "${tool}") {`;
    const handler = chat.slice(chat.indexOf(start), chat.indexOf("} else if (tc.function.name ===", chat.indexOf(start) + start.length));
    expect(handler).toContain(`publishVerified(${call})`);
    expect(handler).toContain('outcome: "unverified", error: PUBLISH_UNVERIFIED_ERROR');
  });
});

describe("content_save — its audit row names the table it writes", () => {
  it("maps content_save to marketing_content", () => {
    expect(chat).toContain('content_save: "marketing_content",');
    expect(chat).not.toContain('content_save: "studio_artifact_versions"');
  });
});
