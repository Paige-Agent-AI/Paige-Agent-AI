import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePortalConfig } from "@/hooks/useClientPortalConfig";
import type { ClientPortalConfig } from "@/hooks/useClientPortalConfig";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type ConfigArgs = { _tenant_id: string; _patch: Partial<ClientPortalConfig> };
const db = vi.hoisted(() => ({ tenant: "test-business-a", config: {} as ClientPortalConfig, calls: [] as { fn: string; args: ConfigArgs }[], fail: false, defer: null as null | (() => void), pending: false, disableAfterWrite: false }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: db.tenant, activeUserId: "test-owner" }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { name: "Test business", brand: {}, features: { portal_config: db.config } }, error: null }) };
  return { supabase: { from: () => chain, rpc: async (fn: string, args: ConfigArgs) => {
    if (fn === "resolve_tenant_brand") return { data: {}, error: null };
    db.calls.push({ fn, args });
    if (db.pending) await new Promise<void>(resolve => { db.defer = resolve; });
    if (db.fail) return { data: null, error: new Error("Save unavailable") };
    const patch = args._patch;
    db.config = { ...db.config, ...patch, ...(patch.assistant ? { assistant: { ...db.config.assistant, ...patch.assistant } } : {}) };
    const result = structuredClone(db.config);
    if (db.disableAfterWrite) db.config = { ...db.config, assistant: { ...db.config.assistant, enabled: false } };
    return { data: result, error: null };
  }, storage: { from: () => ({}) } } };
});
import PortalStudio from "./PortalStudio";
let container: HTMLDivElement, root: Root, qc: QueryClient;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const input = (name: string) => {
  const label = [...container.querySelectorAll("label")].find(el => el.textContent === name)!;
  return document.getElementById(label.htmlFor) as HTMLInputElement;
};
const change = (name: string, value: string) => act(() => {
  const el = input(name);
  Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const save = () => [...container.querySelectorAll("button")].find(el => el.textContent?.includes("Save portal"))!;
const render = () => act(() => { root.render(<QueryClientProvider client={qc}><PortalStudio embedded /></QueryClientProvider>); });
beforeEach(async () => {
  db.tenant = "test-business-a"; db.config = { assistant: { enabled: true, display_name: "Saved guide", tone: "Clear", service_scope: "Client services", human_handoff: "Contact the team" } };
  db.calls = []; db.fail = false; db.pending = false; db.defer = null; db.disableAfterWrite = false;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await render(); await flush();
});
afterEach(() => { act(() => root.unmount()); qc.clear(); container.remove(); });
describe("Customer assistant configuration through the real editor and config hook", () => {
  it("saves only changed fields and reloads the canonical returned configuration", async () => {
    await change("Assistant name", "Client guide");
    // Another legitimate writer disables the assistant while this draft remains open.
    db.config.assistant!.enabled = false;
    act(() => { qc.setQueryData(["portal-config", db.tenant], normalizePortalConfig(db.config)); });
    await flush();
    await act(async () => { save().click(); }); await flush();
    expect(db.calls).toEqual([{ fn: "set_tenant_portal_config", args: { _tenant_id: db.tenant, _patch: { assistant: { display_name: "Client guide" } } } }]);
    expect(db.config.assistant!.enabled).toBe(false);
    expect(container.querySelector('[role="switch"][id$="-enabled"]')?.getAttribute("aria-checked")).toBe("false");
    expect(save().disabled).toBe(true);
    await act(async () => { root.unmount(); root = createRoot(container); }); await render(); await flush();
    expect(input("Assistant name").value).toBe("Client guide");
  });
  it("keeps a failed draft and retries the same canonical operation", async () => {
    await change("What it helps with", "Program milestones"); db.fail = true;
    await act(async () => { save().click(); }); await flush();
    expect(input("What it helps with").value).toBe("Program milestones"); expect(save().disabled).toBe(false);
    db.fail = false; await act(async () => { save().click(); }); await flush();
    expect(db.config.assistant!.service_scope).toBe("Program milestones"); expect(save().disabled).toBe(true);
    expect(db.calls[0]).toEqual(db.calls[1]);
  });
  it("shows a newer canonical policy read rather than an older mutation response", async () => {
    await change("Assistant name", "Updated guide"); db.disableAfterWrite = true;
    await act(async () => { save().click(); }); await flush();
    expect(input("Assistant name").value).toBe("Updated guide");
    expect(container.querySelector('[role="switch"][id$="-enabled"]')?.getAttribute("aria-checked")).toBe("false");
    expect(save().disabled).toBe(true);
  });
  it("disables editing during a save and retires the draft on a business switch", async () => {
    await change("Tone", "Encouraging"); db.pending = true;
    await act(async () => { save().click(); }); await flush();
    expect(input("Tone").closest('fieldset[aria-label="Portal experience settings"]')?.hasAttribute("disabled")).toBe(true);
    db.tenant = "test-business-b"; db.config = { assistant: { display_name: "Business B guide", enabled: false } };
    await render(); await flush();
    expect(input("Assistant name").value).toBe("Business B guide"); expect(input("Tone").value).toBe("");
    await act(async () => { db.pending = false; db.defer?.(); }); await flush();
    expect(input("Assistant name").value).toBe("Business B guide");
  });
  it("does not write assistant policy when only Welcome is edited", async () => {
    await change("Headline", "Welcome to your program"); await act(async () => { save().click(); }); await flush();
    expect(db.calls[0].args._patch).toEqual({ welcome: { headline: "Welcome to your program" } });
  });
});
describe("Customer assistant policy normalization", () => {
  it.each([null, [], "invalid", { enabled: "yes" }])("fails closed for malformed assistant policy %j", assistant => {
    expect(normalizePortalConfig({ assistant }).assistant?.enabled).toBe(false);
  });
  it("bounds client-facing fields while preserving disabled status", () => {
    const a = normalizePortalConfig({ assistant: { enabled: false, display_name: "x".repeat(100), tone: "x".repeat(200), service_scope: "x".repeat(1800), human_handoff: "x".repeat(700) } }).assistant!;
    expect(a.enabled).toBe(false); expect([a.display_name?.length, a.tone?.length, a.service_scope?.length, a.human_handoff?.length]).toEqual([80, 180, 1600, 600]);
  });
});
