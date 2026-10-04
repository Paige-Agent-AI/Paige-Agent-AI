/**
 * Vibe Studio V0 — the live-defect fixes, pinned.
 *
 * EVIDENCE CLASSES:
 *  - publishVerified is driven BEHAVIOURALLY (the real function). The panel's publish path moved
 *    behind the publish door in V2b (studio-publish-door.contract.test.ts).
 *  - The paige-ai-chat rules (ceiling-respecting Studio lift, funnel reachability, partial funnel
 *    outcomes, document_generate off the Studio surface, publish readback, content_save audit
 *    target) are a STATIC contract over the edge source — the repo's idiom for that 15k-line file.
 *    Each assertion fails on main 61473b7c. Whether production behaves so is owed to an
 *    authenticated drive.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publishVerified, PUBLISH_UNVERIFIED_ERROR } from "../../../supabase/functions/_shared/artifact-receipt";

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

// The Publish panel's own path (V0's publishArtifact readback) moved behind the one publish door in
// V2b; its "never live without an address" rule is pinned in studio-publish-door.contract.test.ts.

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
  it("is outside the Studio scope, so a Studio turn is not shown it (V1 replaced the V0 splice)", () => {
    const migration = readFileSync("supabase/migrations/20270541000000_design_studio_capability_scope.sql", "utf8");
    const tools = migration.slice(migration.indexOf("jsonb_build_array("), migration.indexOf("))),"));
    expect(tools).not.toContain("'document_generate'");
    expect(chat).not.toContain('toolDefs.findIndex((d: any) => d?.function?.name === "document_generate")');
  });
});

describe("D2 — funnel tools are reachable, and a partial build is never success", () => {
  it("routes the funnel draft and build tools into the dispatch branch that handles them", () => {
    const gate = between('tc.function.name === "growth_form_save" ||', "// Role gate: admin only");
    for (const t of ["growth_funnel_generate", "growth_funnel_build"]) {
      expect(gate).toContain(`tc.function.name === "${t}" ||`);
    }
    // V2b: funnel publish is reachable through the one publish door instead (see below).
    expect(gate).not.toContain('tc.function.name === "growth_funnel_publish" ||');
  });
  it("reports a build that failed after a write as partial, naming what was saved", () => {
    const build = between('} else if (tc.function.name === "growth_funnel_build") {', '} else if (tc.function.name === "action_file") {');
    expect(build).toContain("_fbWritten.page_id = _pageId;");
    expect(build).toContain("_fbWritten.form_id = _formId;");
    expect(build).toContain('if (!_formId) throw new Error("The funnel\'s intake form didn\'t save.");');
    expect(build).toContain("if (!_fbWritten.page_id) throw _fbErr;");
    expect(build).toMatch(/success: false,\s*outcome: "partial",[\s\S]*saved_drafts: _fbWritten/);
  });
});

// V2b — ONE PUBLISH DOOR. Chat no longer runs its own publish RPC and readback; it hands the act to
// growth-publish-command (the Studio panel's door too), whose handler requires the readback. The
// door's behaviour is driven in src/__tests__/growth-publish-door.test.ts; this pins the wiring.
describe("Publish truth in chat — no success without the published readback", () => {
  const door = readFileSync("supabase/functions/_shared/growth-publish-command/door.ts", "utf8");
  it.each(["growth_page_publish", "growth_form_publish", "growth_funnel_publish"])("%s has no inline executor left in chat", (tool) => {
    expect(chat).not.toContain(`} else if (tc.function.name === "${tool}") {`);
    expect(chat).not.toContain(`supabaseClient.rpc("${tool}"`);
  });
  it("chat routes publishing through the door, and the door requires the readback", () => {
    expect(between("if (GROWTH_PUBLISH_DOOR_TOOL_NAMES.has(tc.function.name)) {", "// ── CANONICAL GOVERNED CRM/Pipeline DOOR"))
      .toContain('supabaseClient.functions.invoke("growth-publish-command"');
    expect(door).toContain("publishVerified(cmd.kind, data)");
    expect(door).toContain('outcome: "unverified"');
  });
});

describe("content_save — its audit row names the table it writes", () => {
  it("maps content_save to marketing_content", () => {
    expect(chat).toContain('content_save: "marketing_content",');
    expect(chat).not.toContain('content_save: "studio_artifact_versions"');
  });
});

describe("Review fixes — the Studio canvas hint and the audit label", () => {
  it("never steers the design agent to document_generate from the canvas hint", () => {
    const hint = between('if (canvasArtifact && canvasArtifact.kind === "document") {', '} else if (canvasArtifact && canvasArtifact.kind === "content") {');
    expect(hint).not.toContain('"document_generate"');
    expect(hint).toContain("Documents can't be revised in this Studio session");
  });
  it("labels a run studio_session_auto only when the Studio lift actually changed the lane", () => {
    expect(chat).toContain('approvalChannel.set(tc.id, studioLifted ? "studio_session_auto" : "standing_autonomy_setting");');
    const lift = between("const STUDIO_AUTO_TOOLS = new Set([", "studioLifted = true;");
    expect(lift).toContain('autoMode = "auto";');
  });
});
