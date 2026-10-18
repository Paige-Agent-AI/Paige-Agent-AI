import { describe, expect, it, vi } from "vitest";

// resolvePortalCatalog is pure; the supabase client is never touched.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { resolvePortalCatalog, catalogInputFromFeatures, resolveActivePlaybookFromFeatures } = await import("./resolve");
const { generalDefault, RESOLVABLE_PLAYBOOKS } = await import("./presets");

// The same tenant fixtures the pgTAP case 2 seeds (authored, slug-only, neither). Synthetic only.
const authoredModules = [{ key: "home", label: "Start here" }, { key: "sessions", label: "Coaching calls" }, { key: "resources", label: "Library" }];
const features = {
  authored: { playbook: "fitness", playbook_config: { persona: { name: "Guide", greeting: "Hi" }, portal: { modules: authoredModules }, intake: [{ key: "secret" }] } },
  authoredNoPortal: { playbook_config: { persona: { name: "Guide", greeting: "Hi" } } },
  slugOnly: { playbook: "funding" },
  unusableAuthored: { playbook: "consultant", playbook_config: { persona: { name: "Guide" }, portal: { modules: authoredModules } } },
  neither: {},
} as const;

describe("customer catalog parity with the owner's Playbook resolution (§57)", () => {
  it("derives the server's _catalog shape from tenants.features", () => {
    expect(catalogInputFromFeatures(features.authored)).toEqual({ slug: "fitness", authoredUsable: true, modules: authoredModules });
    expect(catalogInputFromFeatures(features.slugOnly)).toEqual({ slug: "funding", authoredUsable: false, modules: null });
    expect(catalogInputFromFeatures(features.neither)).toEqual({ slug: null, authoredUsable: false, modules: null });
    expect(catalogInputFromFeatures(features.unusableAuthored).authoredUsable).toBe(false);
  });

  it("follows coercePlaybook's precedence: authored and usable, then the slug, then the general default", () => {
    expect(resolvePortalCatalog(catalogInputFromFeatures(features.authored))).toEqual(authoredModules);
    expect(resolvePortalCatalog(catalogInputFromFeatures(features.authoredNoPortal))).toEqual(generalDefault.portal.modules);
    expect(resolvePortalCatalog(catalogInputFromFeatures(features.slugOnly))).toEqual(RESOLVABLE_PLAYBOOKS.find((p) => p.slug === "funding")!.portal.modules);
    // An authored Playbook that coercePlaybook would reject falls through to the slug, never its modules.
    expect(resolvePortalCatalog(catalogInputFromFeatures(features.unusableAuthored))).toEqual(RESOLVABLE_PLAYBOOKS.find((p) => p.slug === "consultant")!.portal.modules);
    expect(resolvePortalCatalog(catalogInputFromFeatures(features.neither))).toEqual(generalDefault.portal.modules);
    expect(resolvePortalCatalog(null)).toEqual(generalDefault.portal.modules);
  });

  it("equals the owner's full Playbook resolution for every fixture", () => {
    for (const f of Object.values(features)) {
      expect(resolvePortalCatalog(catalogInputFromFeatures(f))).toEqual(resolveActivePlaybookFromFeatures(f).portal.modules);
    }
  });

  it("bounds what it carries: string keys and labels only, at most 40 entries of 80 characters", () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ key: `k${i}`.padEnd(90, "x"), label: "L".repeat(90) }));
    const input = catalogInputFromFeatures({ playbook_config: { persona: { name: "a", greeting: "b" }, portal: { modules: [{ key: 1, label: "x" }, ...many] } } });
    expect(input.modules).toHaveLength(40);
    expect(input.modules!.every((m) => m.key.length === 80 && m.label.length === 80)).toBe(true);
  });
});
