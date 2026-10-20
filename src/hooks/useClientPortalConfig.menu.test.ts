import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { normalizePortalConfig } = await import("./useClientPortalConfig");

describe("normalizePortalConfig: Slice M menu fields", () => {
  it("keeps a module label, trimmed and bounded to 40 characters", () => {
    const out = normalizePortalConfig({ modules: [
      { key: "sessions", visible: true, order: 2, label: "  Coaching calls  " },
      { key: "progress", label: "x".repeat(60) },
      { key: "documents", label: "   " },
      { key: "resources", label: 7 },
    ] });
    expect(out.modules).toEqual([
      { key: "sessions", visible: true, order: 2, label: "Coaching calls" },
      { key: "progress", label: "x".repeat(40) },
      { key: "documents" },
      { key: "resources" },
    ]);
  });

  it("parses the server's _catalog into catalog {slug, authoredUsable, modules}", () => {
    const out = normalizePortalConfig({ welcome: { headline: "Hi" }, _catalog: { slug: "fitness", authored_usable: true, modules: [{ key: "home", label: "Home" }, { key: 2, label: "bad" }] } });
    expect(out.catalog).toEqual({ slug: "fitness", authoredUsable: true, modules: [{ key: "home", label: "Home" }] });
    expect(out.welcome).toEqual({ headline: "Hi" });
  });

  it("treats a malformed _catalog as unknown rather than inventing one", () => {
    expect(normalizePortalConfig({ _catalog: "x" }).catalog).toBeUndefined();
    expect(normalizePortalConfig({ _catalog: { slug: 3, authored_usable: "yes", modules: "no" } }).catalog).toEqual({ slug: null, authoredUsable: false, modules: null });
    expect(normalizePortalConfig({}).catalog).toBeUndefined();
  });
});
