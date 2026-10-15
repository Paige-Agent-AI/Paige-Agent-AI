/**
 * Vibe Studio V1 — the capability-scope resolver, driven behaviourally (pure functions).
 * The runtime enforcement in paige-ai-chat is proven against the real handler in
 * scripts/client-memory-authz/check.mjs section 33 (each guard mutation-tested).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { narrowToolDefs, outsideStudioScope, resolveRoleToolScope, STUDIO_SCOPE_FAIL_CLOSED } from "../../../supabase/functions/_shared/studio-scope";

const def = (name: string) => ({ type: "function", function: { name } });

describe("resolveRoleToolScope", () => {
  it("reads a valid allowlist", () => {
    const s = resolveRoleToolScope({ capability_scope: { mode: "allowlist", tools: ["growth_page_save", "ask_choices"] } });
    expect(s.valid).toBe(true);
    expect([...s.allowed].sort()).toEqual(["ask_choices", "growth_page_save"]);
  });
  it.each([
    ["no config", null],
    ["no scope", {}],
    ["wrong mode", { capability_scope: { mode: "everything", tools: ["crm_create_contact"] } }],
    ["empty list", { capability_scope: { mode: "allowlist", tools: [] } }],
    ["wildcard name", { capability_scope: { mode: "allowlist", tools: ["*"] } }],
    ["non-string name", { capability_scope: { mode: "allowlist", tools: [42] } }],
  ])("fails closed on %s — no writes", (_label, config) => {
    const s = resolveRoleToolScope(config);
    expect(s.valid).toBe(false);
    expect([...s.allowed].sort()).toEqual([...STUDIO_SCOPE_FAIL_CLOSED].sort());
    expect(s.reason).toBeTruthy();
  });
});

describe("narrowToolDefs — the scope only narrows", () => {
  it("removes every tool outside the scope and keeps the rest in order", () => {
    const defs = [def("crm_create_contact"), def("growth_page_save"), def("ghl_run_action"), def("ask_choices")];
    const removed = narrowToolDefs(defs, new Set(["growth_page_save", "ask_choices"]));
    expect(defs.map((d) => d.function.name)).toEqual(["growth_page_save", "ask_choices"]);
    expect(removed).toEqual(["crm_create_contact", "ghl_run_action"]);
  });
  it("never adds a tool the turn did not carry", () => {
    const defs = [def("growth_page_save")];
    narrowToolDefs(defs, new Set(["growth_page_save", "crm_create_contact"]));
    expect(defs.map((d) => d.function.name)).toEqual(["growth_page_save"]);
  });
});

describe("the refusal and the stored scope", () => {
  it("names the tool and says nothing changed", () => {
    const r = outsideStudioScope("crm_update_deal");
    expect(r).toMatchObject({ success: false, error: "outside_studio_scope" });
    expect(r.message).toContain('"crm_update_deal"');
    expect(r.message).toContain("Nothing was changed");
  });
  it("Migration B stores exactly the owner's allowlist — no CRM, team, calendar, provider, comms, sub-agent, funding or Knowledge-write tool", () => {
    const sql = readFileSync("supabase/migrations/20270541000000_design_studio_capability_scope.sql", "utf8");
    const tools = [...sql.slice(sql.indexOf("jsonb_build_array("), sql.indexOf("))),")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(tools.sort()).toEqual([
      "ask_choices", "capability_status", "content_save", "draft_marketing_content", "generate_image", "growth_form_publish",
      "growth_form_save", "growth_funnel_build", "growth_funnel_generate", "growth_funnel_publish", "growth_list",
      "growth_page_generate", "growth_page_publish", "growth_page_save", "web_fetch", "web_search",
    ]);
    expect(sql).toContain("WHERE slug = 'design-studio' AND tenant_id IS NULL");
    expect(resolveRoleToolScope({ capability_scope: { mode: "allowlist", tools } }).valid).toBe(true);
  });
});
