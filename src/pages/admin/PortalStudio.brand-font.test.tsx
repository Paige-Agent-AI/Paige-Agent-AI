import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND_FONT_STYLE_ATTR } from "@/lib/brand-fonts";

/**
 * The brand typeface picker in Client Portal (the live Solo brand surface, mounted by
 * TenantRelationshipsClientsWorkspace). Its contract with the backend must not move: it writes the
 * family name into the existing `brand.font` key through set_tenant_brand — no new key, no body-font
 * value, "" for System default — and a stored value it did not write is shown and left alone.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const db = vi.hoisted(() => ({ brand: {} as Record<string, unknown>, rpcCalls: [] as { fn: string; args: Record<string, unknown> }[] }));

vi.mock("@/integrations/supabase/client", () => {
  const tenantRow = () => ({ data: { name: "Northwind Advisory", slug: "northwind", brand: db.brand, features: {} }, error: null });
  const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve(tenantRow()) };
  return {
    supabase: {
      from: () => chain,
      rpc: (fn: string, args: Record<string, unknown>) => {
        db.rpcCalls.push({ fn, args });
        if (fn === "resolve_tenant_brand") return Promise.resolve({ data: { font: db.brand.font ?? null }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      storage: { from: () => ({}) },
    },
  };
});
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "00000000-0000-4000-8000-000000000001" }) }));

import PortalStudio from "./PortalStudio";

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  // jsdom gaps Radix Select touches.
  Element.prototype.scrollIntoView ||= () => {};
  Element.prototype.hasPointerCapture ||= () => false;
  Element.prototype.releasePointerCapture ||= () => {};
  globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} } as never;
});

beforeEach(() => {
  db.rpcCalls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  document.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).forEach((n) => n.remove());
});

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={qc}><PortalStudio /></QueryClientProvider>); });
  await flush();
}

const trigger = () => document.getElementById("portal-brand-typeface") as HTMLButtonElement;
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
const options = () => [...document.querySelectorAll('[role="option"]')] as HTMLElement[];

async function choose(label: string) {
  await key(trigger(), "Enter");
  await flush();
  const opt = options().find((o) => o.textContent === label);
  expect(opt, `option ${label}`).toBeTruthy();
  await key(opt!, "Enter");
  await flush();
}

const saveButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Save portal")) as HTMLButtonElement;
const brandWrites = () => db.rpcCalls.filter((c) => c.fn === "set_tenant_brand");

describe("Client Portal typeface picker", () => {
  it("offers the library grouped by character, each option drawn in its own face", async () => {
    db.brand = {};
    await mount();
    expect(trigger().textContent).toBe("System default");
    await key(trigger(), "Enter");
    await flush();
    const groups = [...document.querySelectorAll('[role="group"]')].map((g) => g.firstElementChild?.nextElementSibling?.textContent ?? g.textContent);
    expect(groups.join("|")).toMatch(/Editorial serif.*Premium serif.*Humanist sans.*Geometric sans.*Product sans.*Condensed display.*Expressive display.*Classic/);
    const literata = options().find((o) => o.textContent === "Literata")!;
    expect((literata.querySelector("span[style]") as HTMLElement).style.fontFamily).toContain("brand-literata");
    // Opening the list loads the library faces for the previews.
    expect(document.head.querySelector(`style[${BRAND_FONT_STYLE_ATTR}="literata"]`)).not.toBeNull();
  });

  it("selecting a library face writes ONLY the family name to brand.font through set_tenant_brand", async () => {
    db.brand = {};
    await mount();
    await choose("Literata");
    expect(trigger().textContent).toBe("Literata");
    expect(container.textContent).toContain("Headings use Literata; body text uses Public Sans.");
    await act(async () => { saveButton().click(); });
    await flush();
    expect(brandWrites()).toEqual([{ fn: "set_tenant_brand", args: { _tenant_id: "00000000-0000-4000-8000-000000000001", _patch: { font: "Literata" } } }]);
  });

  it("System default stores the empty string, exactly as before", async () => {
    db.brand = { font: "Poppins" };
    await mount();
    expect(trigger().textContent).toBe("Poppins");
    await choose("System default");
    await act(async () => { saveButton().click(); });
    await flush();
    expect(brandWrites().map((c) => c.args._patch)).toEqual([{ font: "" }]);
  });

  it("a stored classic pick shows as selected and is not rewritten when untouched", async () => {
    db.brand = { font: "Playfair Display" };
    await mount();
    expect(trigger().textContent).toBe("Playfair Display");
    expect(container.textContent).toContain("Headings and body text use Playfair Display.");
    expect(saveButton().disabled).toBe(true);
    expect(brandWrites()).toHaveLength(0);
  });

  it("a stored value outside the library is shown honestly and kept until the owner picks another", async () => {
    db.brand = { font: "Georgia" };
    await mount();
    expect(trigger().textContent).toBe("Georgia");
    expect(container.textContent).toContain("Georgia isn't in the font library");
    expect(saveButton().disabled).toBe(true);
    // Nothing was loaded for it — an unknown name never becomes a font request.
    expect(document.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).length).toBe(0);
  });

  it("the live preview loads the chosen faces and sets the greeting in the display face", async () => {
    db.brand = {};
    await mount();
    await choose("Gloock");
    const greeting = [...container.querySelectorAll("p")].find((p) => p.textContent === "Welcome back") as HTMLElement;
    expect(greeting.style.fontFamily).toContain("brand-gloock");
    expect(document.head.querySelector(`style[${BRAND_FONT_STYLE_ATTR}="urbanist"]`)).not.toBeNull();
  });
});
