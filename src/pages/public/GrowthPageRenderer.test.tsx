import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GrowthPageRenderer from "./GrowthPageRenderer";

/**
 * The published landing page is what paige-browser screenshots in URL mode. Two things make that
 * capture truthful: the page says when its OWN data (the row and its brand) has settled, and the brand
 * lookup is a GET — the screenshot host's read-only egress fence aborts every POST.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  rows: {} as Record<string, unknown>,
}));

function query(table: string) {
  const result = { data: state.rows[table] ?? null, error: null };
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve(result);
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => query(t),
    rpc: (...args: unknown[]) => state.rpc(...args),
    functions: { invoke: vi.fn() },
  },
}));

const PAGE = {
  id: "p1", title: "Northwind", status: "published", tenant_id: "t1",
  blocks_json: [{ type: "hero", title: "Get your weekends back" }], theme_json: null, seo_json: {}, og_image_url: null,
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  state.rpc.mockReset();
  state.rows = { tenants: { id: "t1" }, growth_pages: PAGE };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function mount() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/p/northwind/home"]}>
        <Routes><Route path="/p/:tenantSlug/:pageSlug" element={<GrowthPageRenderer />} /></Routes>
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 20 && !container.querySelector("[data-growth-page-ready]"); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}

describe("published page readiness for URL-mode screenshots", () => {
  it("looks the brand up as a GET and marks ready only after it has settled", async () => {
    let resolveBrand!: (v: unknown) => void;
    state.rpc.mockReturnValue(new Promise((r) => { resolveBrand = r; }));
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/p/northwind/home"]}>
          <Routes><Route path="/p/:tenantSlug/:pageSlug" element={<GrowthPageRenderer />} /></Routes>
        </MemoryRouter>,
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(state.rpc).toHaveBeenCalledWith("peek_tenant_portal_brand", { _slug: "northwind" }, { get: true });
    // The row has loaded but the brand has not: not ready yet.
    expect(container.querySelector("[data-growth-page-ready]")).toBeNull();
    await act(async () => { resolveBrand({ data: [{ primary_color: "#1f2a5a", accent_color: "#c9a24a", font: null, logo_url: null }], error: null }); });
    expect(container.querySelector("[data-growth-page-ready]")?.getAttribute("data-growth-page-ready")).toBe("true");
    expect(container.textContent).toContain("Get your weekends back");
  });

  it("a brand lookup that throws still settles: ready, on the brand floor, and logged", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpc.mockRejectedValue(new Error("network down"));
    await mount();
    expect(container.querySelector("[data-growth-page-ready]")?.getAttribute("data-growth-page-ready")).toBe("true");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("a missing page says so with state=missing, never ready=true", async () => {
    state.rows = { tenants: { id: "t1" }, growth_pages: null };
    await mount();
    expect(container.querySelector("[data-growth-page-ready]")?.getAttribute("data-growth-page-ready")).toBe("missing");
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("supabase-js sends rpc({ get: true }) as a GET", () => {
  it("issues GET /rest/v1/rpc/peek_tenant_portal_brand with the slug in the query string", async () => {
    const seen: Array<{ method: string; url: string }> = [];
    const client = createClient("https://db.test", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          seen.push({ method: (init?.method ?? "GET").toUpperCase(), url: String(input) });
          return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
        }) as typeof fetch,
      },
    });
    await client.rpc("peek_tenant_portal_brand", { _slug: "northwind" }, { get: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("GET");
    expect(seen[0].url).toContain("/rest/v1/rpc/peek_tenant_portal_brand?_slug=northwind");
  });
});
