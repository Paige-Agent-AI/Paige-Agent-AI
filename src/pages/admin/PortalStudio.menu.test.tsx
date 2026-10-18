import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientPortalConfig, PortalModuleOverlay } from "@/hooks/useClientPortalConfig";

// E09 Slice M — the owner's "Customer portal menu" card inside PortalStudio (Solo: Clients → Portal → Customize
// experience). Synthetic tenant only. The Supabase transport is a fake whose read-back can be made to disagree.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type ConfigArgs = { _tenant_id: string; _patch: Partial<ClientPortalConfig> };
const db = vi.hoisted(() => ({
  config: {} as ClientPortalConfig & Record<string, unknown>,
  features: {} as Record<string, unknown>,
  calls: [] as ConfigArgs[],
  // When set, the server stores something other than what was sent (e.g. it drops labels).
  corrupt: null as null | ((modules: PortalModuleOverlay[]) => PortalModuleOverlay[]),
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "test-business-a", activeUserId: "test-owner" }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { name: "Northwind Studio", brand: {}, features: { ...db.features, portal_config: structuredClone(db.config) } }, error: null }) };
  return { supabase: { from: () => chain, auth: { getUser: async () => ({ data: { user: null } }) }, rpc: async (fn: string, args: ConfigArgs) => {
    if (fn === "resolve_tenant_brand") return { data: {}, error: null };
    db.calls.push(structuredClone(args));
    const patch = structuredClone(args._patch);
    if (patch.modules && db.corrupt) patch.modules = db.corrupt(patch.modules);
    db.config = { ...db.config, ...patch };
    return { data: structuredClone(db.config), error: null };
  }, storage: { from: () => ({}) } } };
});
const { default: PortalStudio } = await import("./PortalStudio");
const { assemblePortalNav, flattenPortalNav, PORTAL_CUSTOMER_PREVIEW_VIEWER } = await import("@/lib/portal/portalMenu");
const { generalDefault } = await import("@/lib/playbook/presets");

let container: HTMLDivElement, root: Root, qc: QueryClient;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const card = () => container.querySelector<HTMLElement>('[data-testid="portal-menu-editor"]')!;
const byLabel = <T extends HTMLElement>(name: string) => card().querySelector<T>(`[aria-label="${name}"]`)!;
const button = (text: string) => Array.from(card().querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;
const type = (name: string, value: string) => act(() => {
  const el = byLabel<HTMLInputElement>(name);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await flush(); };
const preview = () => Array.from(card().querySelectorAll('[data-testid="portal-menu-preview"] [data-portal-label]')).map((e) => e.textContent);
const editorRows = () => Array.from(card().querySelectorAll<HTMLElement>("[data-menu-heading], [data-menu-row]")).map((el) =>
  el.hasAttribute("data-menu-heading") ? `# ${el.textContent?.trim()}` : el.getAttribute("data-menu-row"));
const status = () => card().querySelector('[data-testid="portal-menu-status"]');
const render = async () => { await act(() => { root.render(<QueryClientProvider client={qc}><PortalStudio embedded /></QueryClientProvider>); }); await flush(); };

beforeEach(async () => {
  db.config = {}; db.features = {}; db.calls = []; db.corrupt = null;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await render();
});
afterEach(() => { act(() => root.unmount()); qc.clear(); container.remove(); });

describe("Customer portal menu editor", () => {
  it("lists the fixed entries as always on and every configurable entry this business can offer, by group", async () => {
    expect(card().querySelector("h2")?.textContent).toBe("Customer portal menu");
    expect(editorRows()).toEqual(["# Always shown", "home", "messages", "# Your work", "progress", "actions", "sessions", "# Paperwork", "documents", "# Learn", "resources"]);
    for (const key of ["home", "messages"]) {
      const row = card().querySelector(`[data-menu-row="${key}"]`)!;
      expect(row.textContent).toContain("Always on");
      expect(row.querySelector('[role="switch"]')).toBeNull();
      expect(row.querySelector("input")).toBeNull();
    }
    // Payments has no live route yet and the generic catalog lists no Agreements: no row, no "Coming soon".
    expect(card().textContent).not.toMatch(/Payments|Agreements|Coming soon/);
    expect(card().textContent).toContain("Get help, Account, Settings and Sign out are always at the bottom");
    expect(card().textContent).toMatch(/tell Paige/i);
  });

  it("previews exactly what assemblePortalNav gives a customer, from the unsaved rows", async () => {
    const expected = (overlay: PortalModuleOverlay[] | undefined) =>
      flattenPortalNav(assemblePortalNav({ catalog: generalDefault.portal.modules, overlay, viewer: PORTAL_CUSTOMER_PREVIEW_VIEWER })).map((i) => i.label);
    expect(preview()).toEqual(expected(undefined));
    await type("Name for Sessions", "Coaching calls");
    await click(byLabel("Show Documents"));
    await click(byLabel("Move Progress down"));
    expect(preview()).toEqual(["Home", "Messages", "Action items", "Progress", "Coaching calls", "Resources"]);
    expect(preview()).toEqual(expected([{ key: "actions", order: 0 }, { key: "progress", order: 1 }, { key: "sessions", order: 2, label: "Coaching calls" }, { key: "documents", visible: false }, { key: "resources", order: 4 }]));
    expect(db.calls).toEqual([]);
  });

  it("moves only within a group", async () => {
    expect(byLabel<HTMLButtonElement>("Move Progress up").disabled).toBe(true);
    expect(byLabel<HTMLButtonElement>("Move Sessions down").disabled).toBe(true);
    expect(byLabel<HTMLButtonElement>("Move Documents up").disabled).toBe(true);
    await click(byLabel("Move Sessions up"));
    expect(editorRows().slice(3, 7)).toEqual(["# Your work", "progress", "sessions", "actions"]);
  });

  it("bounds a name to 40 characters, counts from 30, and says what it was renamed from", async () => {
    const input = byLabel<HTMLInputElement>("Name for Sessions");
    expect(input.maxLength).toBe(40);
    expect(input.placeholder).toBe("Sessions");
    await type("Name for Sessions", "Calls");
    expect(card().querySelector('[data-menu-row="sessions"]')?.textContent).toContain("Renamed from Sessions");
    expect(card().querySelector('[data-menu-row="sessions"] [data-testid="label-counter"]')).toBeNull();
    await type("Name for Sessions", "x".repeat(30));
    expect(card().querySelector('[data-menu-row="sessions"] [data-testid="label-counter"]')?.textContent).toBe("30/40");
  });

  it("saves the full modules array, re-reads it, and says saved only when the read-back matches (§70.1)", async () => {
    // An older editor stored Home (and could hide it); the seam now refuses that, so it is carried inert.
    db.config = { modules: [{ key: "legacy-key", visible: false, order: 9 }, { key: "home", visible: false, order: 0, label: "Start" }] };
    await act(async () => { await qc.invalidateQueries(); }); await flush();
    await type("Name for Sessions", "Coaching calls");
    await click(byLabel("Show Resources"));
    await click(button("Save menu"));
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toEqual({ _tenant_id: "test-business-a", _patch: { modules: [
      { key: "progress", visible: true, order: 0 },
      { key: "actions", visible: true, order: 1 },
      { key: "sessions", visible: true, order: 2, label: "Coaching calls" },
      { key: "documents", visible: true, order: 3 },
      { key: "resources", visible: false, order: 4 },
      { key: "legacy-key", visible: false, order: 9 },
      { key: "home", order: 0 },
    ] } });
    expect(status()?.getAttribute("role")).toBe("status");
    expect(status()?.textContent).toMatch(/Menu saved/);
    expect(button("Save menu").disabled).toBe(true);
  });

  it("shows an honest error, keeps the draft, and never says saved when the read-back disagrees", async () => {
    db.corrupt = (modules) => modules.map(({ label: _drop, ...rest }) => rest);
    await type("Name for Sessions", "Coaching calls");
    await click(button("Save menu"));
    expect(status()?.getAttribute("role")).toBe("alert");
    expect(status()?.textContent).not.toMatch(/Menu saved/);
    expect(status()?.textContent).toMatch(/doesn't match/);
    expect(byLabel<HTMLInputElement>("Name for Sessions").value).toBe("Coaching calls");
    expect(button("Save menu").disabled).toBe(false);
  });

  it("resets to the default menu without saving", async () => {
    await type("Name for Sessions", "Coaching calls");
    await click(byLabel("Show Documents"));
    await click(button("Reset to default"));
    expect(byLabel<HTMLInputElement>("Name for Sessions").value).toBe("");
    expect(byLabel("Show Documents").getAttribute("aria-checked")).toBe("true");
    expect(db.calls).toEqual([]);
  });

  it("spends gold on Save menu alone", async () => {
    const gold = Array.from(card().querySelectorAll("button")).filter((b) => /bg-gradient-gold|\bbg-accent\b/.test(b.className));
    expect(gold.map((b) => b.textContent?.trim())).toEqual(["Save menu"]);
  });

  it("offers the rows the business's own Playbook lists (owner-side catalog read)", async () => {
    act(() => root.unmount()); qc.clear(); root = createRoot(container);
    db.features = { playbook_config: { persona: { name: "Guide", greeting: "Hi" }, portal: { modules: [{ key: "home", label: "Home" }, { key: "approvals", label: "Sign-offs" }, { key: "agreements", label: "Agreements" }] } } };
    await render();
    expect(editorRows()).toEqual(["# Always shown", "home", "messages", "# Your work", "progress", "actions", "sessions", "approvals", "# Paperwork", "documents", "agreements"]);
    expect(byLabel<HTMLInputElement>("Name for Sign-offs").placeholder).toBe("Sign-offs");
  });
});
