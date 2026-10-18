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
  // When set, the writer refuses with this PostgREST-shaped error.
  refuse: null as null | { code: string; message: string },
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "test-business-a", activeUserId: "test-owner" }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { name: "Northwind Studio", brand: {}, features: { ...db.features, portal_config: structuredClone(db.config) } }, error: null }) };
  return { supabase: { from: () => chain, auth: { getUser: async () => ({ data: { user: null } }) }, rpc: async (fn: string, args: ConfigArgs) => {
    if (fn === "resolve_tenant_brand") return { data: {}, error: null };
    db.calls.push(structuredClone(args));
    if (db.refuse) return { data: null, error: db.refuse };
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
const blur = (name: string) => act(() => { byLabel<HTMLInputElement>(name).dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
const row = (key: string) => card().querySelector<HTMLElement>(`[data-menu-row="${key}"]`)!;
const render = async () => { await act(() => { root.render(<QueryClientProvider client={qc}><PortalStudio embedded /></QueryClientProvider>); }); await flush(); };

beforeEach(async () => {
  db.config = {}; db.features = {}; db.calls = []; db.corrupt = null; db.refuse = null;
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

  it("shows each entry's real name as the field's value, and clearing it returns to the default", async () => {
    const input = byLabel<HTMLInputElement>("Name for Sessions");
    expect(input.value).toBe("Sessions");
    expect(input.placeholder).toBe("");
    await type("Name for Sessions", "");
    await blur("Name for Sessions");
    expect(byLabel<HTMLInputElement>("Name for Sessions").value).toBe("Sessions");
    expect(row("sessions").textContent).not.toContain("Renamed from");
    // Typing the default back is not a rename, and is not stored as one.
    await type("Name for Sessions", "Coaching calls");
    await type("Name for Sessions", "Sessions");
    expect(button("Save menu").disabled).toBe(true);
  });

  it("dims a hidden row and says it is hidden", async () => {
    expect(row("documents").getAttribute("data-hidden")).toBeNull();
    await click(byLabel("Show Documents"));
    expect(row("documents").getAttribute("data-hidden")).toBe("true");
    expect(row("documents").className).toMatch(/bg-muted/);
    const dimText = /(^|\s)text-muted-foreground(\s|$)/;
    expect(byLabel<HTMLInputElement>("Name for Documents").className).toMatch(dimText);
    expect(row("documents").textContent).toContain("Hidden from clients");
    expect(byLabel<HTMLInputElement>("Name for Progress").className).not.toMatch(dimText);
  });

  it("bounds a name to 40 characters, counts from 30, and says what it was renamed from", async () => {
    const input = byLabel<HTMLInputElement>("Name for Sessions");
    expect(input.maxLength).toBe(40);
    await type("Name for Sessions", "Calls");
    expect(card().querySelector('[data-menu-row="sessions"]')?.textContent).toContain("Renamed from Sessions");
    expect(card().querySelector('[data-menu-row="sessions"] [data-testid="label-counter"]')).toBeNull();
    await type("Name for Sessions", "x".repeat(30));
    expect(card().querySelector('[data-menu-row="sessions"] [data-testid="label-counter"]')?.textContent).toBe("30/40");
  });

  it("never lets an old bad stored row block the save: one entry per key, and only names the writer accepts", async () => {
    db.config = { modules: [
      { key: "legacy-key", visible: false }, { key: "legacy-key", visible: true },
      { key: "other-key", label: "Tab\there" }, { key: "third-key", label: "y".repeat(39) },
    ] };
    await act(async () => { await qc.invalidateQueries(); }); await flush();
    await click(byLabel("Show Resources"));
    await click(button("Save menu"));
    const kept = db.calls[0]._patch.modules!.slice(5);
    expect(kept).toEqual([{ key: "legacy-key", visible: false }, { key: "other-key" }, { key: "third-key", label: "y".repeat(39) }]);
    expect(status()?.textContent).toMatch(/Menu saved/);
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

  it("maps a refused save to a plain sentence — never backend wording — and keeps the draft", async () => {
    for (const [refuse, expected] of [
      [{ code: "42501", message: "portal_config_forbidden" }, "Your account can't change this menu."],
      [{ code: "22023", message: "invalid_portal_config" }, "One of the names isn't accepted."],
      [{ code: "XX000", message: "relation \"tenants\" does not exist" }, "Couldn't save the menu. Try again. Your changes are still here."],
    ] as const) {
      db.refuse = refuse;
      await type("Name for Sessions", `Calls ${refuse.code}`);
      await click(button("Save menu"));
      expect(status()?.getAttribute("role")).toBe("alert");
      expect(status()?.textContent).toContain(expected);
      expect(status()?.textContent).not.toMatch(/portal_config|invalid_|relation|tenants|42501|22023|XX000/);
      expect(byLabel<HTMLInputElement>("Name for Sessions").value).toBe(`Calls ${refuse.code}`);
    }
  });

  it("resets to the default menu without saving, and offers no reset when already at default", async () => {
    expect(button("Reset to default").disabled).toBe(true);
    await type("Name for Sessions", "Coaching calls");
    await click(byLabel("Show Documents"));
    expect(button("Reset to default").disabled).toBe(false);
    await click(button("Reset to default"));
    expect(byLabel<HTMLInputElement>("Name for Sessions").value).toBe("Sessions");
    expect(byLabel("Show Documents").getAttribute("aria-checked")).toBe("true");
    expect(db.calls).toEqual([]);
  });

  it("spends gold on Save menu alone — on the whole page, and the header save names what it writes", async () => {
    const gold = Array.from(container.querySelectorAll("button")).filter((b) => /bg-gradient-gold|\bbg-accent\b/.test(b.className));
    expect(gold.map((b) => b.textContent?.trim())).toEqual(["Save menu"]);
    expect(Array.from(container.querySelectorAll("button")).map((b) => b.textContent?.trim())).toContain("Save brand, greeting & agent");
    expect(container.textContent).not.toContain("Save portal");
  });

  it("names unsaved menu edits in the header too, so nothing reads as saved when it isn't", async () => {
    expect(container.querySelector('[data-testid="portal-unsaved"]')).toBeNull();
    await type("Name for Sessions", "Coaching calls");
    expect(container.querySelector('[data-testid="portal-unsaved"]')?.textContent).toBe("Unsaved menu changes — use Save menu");
  });

  it("renders View as client as the grouped menu, from the same assembly as the editor's preview", async () => {
    await type("Name for Sessions", "Coaching calls");
    const nav = container.querySelector('[data-testid="portal-view-as-client-nav"]')!;
    const headings = Array.from(nav.querySelectorAll("p")).map((p) => p.textContent);
    expect(headings).toEqual(["Your work", "Paperwork", "Learn"]);
    expect(Array.from(nav.querySelectorAll("[data-portal-label]")).map((e) => e.textContent)).toEqual(preview());
  });

  it("hides both keys of a shared route when the owner hides the row that speaks for it", async () => {
    act(() => root.unmount()); qc.clear(); root = createRoot(container);
    db.features = { playbook_config: { persona: { name: "Guide", greeting: "Hi" }, portal: { modules: [{ key: "home", label: "Home" }, { key: "learn", label: "Library" }, { key: "resources", label: "Resources" }] } } };
    await render();
    expect(editorRows().slice(-2)).toEqual(["# Learn", "learn"]);
    await click(byLabel("Show Library"));
    expect(preview()).not.toContain("Library");
    expect(preview()).not.toContain("Resources");
  });

  it("offers the rows the business's own Playbook lists (owner-side catalog read)", async () => {
    act(() => root.unmount()); qc.clear(); root = createRoot(container);
    db.features = { playbook_config: { persona: { name: "Guide", greeting: "Hi" }, portal: { modules: [{ key: "home", label: "Home" }, { key: "approvals", label: "Sign-offs" }, { key: "agreements", label: "Agreements" }] } } };
    await render();
    // Agreements is listed, but its route is still the platform-terms page: no row until Slice A (held from clients).
    expect(editorRows()).toEqual(["# Always shown", "home", "messages", "# Your work", "progress", "actions", "sessions", "approvals", "# Paperwork", "documents"]);
    expect(byLabel<HTMLInputElement>("Name for Sign-offs").value).toBe("Sign-offs");
  });
});
