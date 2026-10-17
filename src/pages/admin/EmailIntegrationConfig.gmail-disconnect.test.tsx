// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailIntegrationConfig from "./EmailIntegrationConfig";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ID = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION = "2026-10-16T00:00:00.123456Z";
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], invoke: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/components/admin/EmailDomainsPanel", () => ({ EmailDomainsPanel: () => null }));
vi.mock("@/components/admin/TenantDomainIdentityCard", () => ({ TenantDomainIdentityCard: () => null }));
vi.mock("@/components/ui/page", () => ({
  PageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  SectionCard: ({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) => <section><h2>{title}</h2>{actions}{children}</section>,
  StatePill: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: state.invoke },
  from: () => {
    const filters: Record<string, unknown> = {}; let limit = 100;
    const answer = () => ({ data: filters.provider === "gmail" ? state.rows.slice(0, limit) : [], error: null });
    const b = { select: () => b, eq: (key: string, value: unknown) => { filters[key] = value; return b; }, order: () => b,
      limit: (count: number) => { limit = count; return b; },
      maybeSingle: async () => { const { data } = answer(); return data.length > 1 ? { data: null, error: { code: "PGRST116" } } : { data: data[0] ?? null, error: null }; },
      then: (done: (value: unknown) => unknown) => Promise.resolve(answer()).then(done) };
    return b;
  },
} }));
const roots: Root[] = [];
beforeEach(() => {
  state.rows = [{ id: ID, tenant_id: TENANT, updated_at: VERSION, from_address: "shown@example.invalid", display_name: "Shown" },
    { id: OTHER, tenant_id: TENANT, updated_at: VERSION, from_address: "other@example.invalid", display_name: "Other" }];
  state.invoke.mockReset().mockResolvedValue({ data: { ok: true, disconnected: true, connector_id: ID }, error: null });
  state.success.mockClear(); state.error.mockClear();
});
afterEach(() => { roots.splice(0).forEach(root => act(() => root.unmount())); document.body.replaceChildren(); });
async function mount() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => { root.render(<EmailIntegrationConfig />); });
  await vi.waitFor(() => expect(host.textContent).toContain("shown@example.invalid"));
  return host;
}
function button(host: HTMLElement) { return [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Disconnect")!; }
describe("existing Gmail email callsite preserves exact visible connector compatibility", () => {
  it("sends only the displayed connector and raw version with two connections", async () => {
    const host = await mount(); await act(async () => { button(host).click(); });
    expect(state.invoke).toHaveBeenCalledExactlyOnceWith("gmail-disconnect", { body: { expected_tenant_id: TENANT, connector_id: ID, expected_updated_at: VERSION } });
    expect(state.success).toHaveBeenCalledExactlyOnceWith("Gmail disconnected");
  });
  it.each([{}, { connector_id: OTHER }, { disconnected: false }])("does not toast success for an unconfirmed or wrong target %j", async extra => {
    const host = await mount();
    state.invoke.mockResolvedValue({ data: { ok: true, disconnected: true, ...extra }, error: null });
    await act(async () => { button(host).click(); });
    expect(state.success).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining("could not be confirmed"));
    expect(state.invoke).toHaveBeenCalledTimes(1);
  });
  it("a lost acknowledgement settles unknown without another disconnect", async () => {
    const host = await mount(); state.invoke.mockRejectedValue(new TypeError("lost acknowledgement"));
    await act(async () => { button(host).click(); });
    expect(state.success).not.toHaveBeenCalled(); expect(state.error).toHaveBeenCalledWith(expect.stringContaining("could not be confirmed"));
    expect(button(host).disabled).toBe(false); expect(state.invoke).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch from a displayed record without a version", async () => {
    delete state.rows[0].updated_at; const host = await mount();
    await act(async () => { button(host).click(); });
    expect(state.invoke).not.toHaveBeenCalled(); expect(state.success).not.toHaveBeenCalled();
  });
});
