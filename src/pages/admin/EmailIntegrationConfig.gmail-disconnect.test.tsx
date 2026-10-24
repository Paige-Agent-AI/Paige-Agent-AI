// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailIntegrationConfig from "./EmailIntegrationConfig";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ID = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VERSION = "2026-10-16T00:00:00.123456Z";
type QueryResult = { data: Record<string, unknown>[] | null; error: { message: string } | null };
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[], smtpRows: [] as Record<string, unknown>[],
  context: { activeTenantId: "" as string | null, activeUserId: "" as string | null,
    loading: false, accountContextLoading: false, accountContextStatus: "ready", isPlatformOwner: true },
  reads: [] as Record<string, unknown>[], defer: false,
  pending: [] as { filters: Record<string, unknown>; answer: QueryResult; resolve: (value: QueryResult) => void }[],
  readError: false, foreignReply: false,
  invoke: vi.fn(), success: vi.fn(), error: vi.fn(),
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => state.context }));
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
    const orders: { key: string; ascending: boolean }[] = [];
    const answer = (): QueryResult => ({ data: state.readError ? null : (filters.provider === "gmail" ? state.rows : state.smtpRows)
      .filter(row => Object.entries(filters).every(([key, value]) => key === "tenant_id" && state.foreignReply || row[key] === value))
      .sort((left, right) => {
        for (const order of orders) {
          const compared = String(left[order.key]).localeCompare(String(right[order.key]));
          if (compared) return order.ascending ? compared : -compared;
        }
        return 0;
      })
      .slice(0, limit), error: state.readError ? { message: "protected read unavailable" } : null });
    const b = { select: () => b, eq: (key: string, value: unknown) => { filters[key] = value; return b; },
      order: (key: string, options: { ascending?: boolean }) => { orders.push({ key, ascending: options.ascending !== false }); return b; },
      limit: (count: number) => { limit = count; return b; },
      maybeSingle: () => run().then(({ data, error }) => error ? { data: null, error }
        : data!.length > 1 ? { data: null, error: { code: "PGRST116" } } : { data: data![0] ?? null, error: null }),
      then: (done: (value: unknown) => unknown) => run().then(done) };
    function run(): Promise<QueryResult> {
      const captured = { ...filters }; const result = answer(); state.reads.push(captured);
      return state.defer ? new Promise(resolve => state.pending.push({ filters: captured, answer: result, resolve })) : Promise.resolve(result);
    }
    return b;
  },
} }));
const roots: Root[] = [];
beforeEach(() => {
  const fields = { channel_type: "email", provider: "gmail", active: true, status: "active" };
  state.rows = [{ ...fields, id: ID, tenant_id: TENANT, updated_at: VERSION, from_address: "shown@example.invalid", display_name: "Shown" },
    { ...fields, id: OTHER, tenant_id: TENANT, updated_at: VERSION, from_address: "other@example.invalid", display_name: "Other" }];
  state.smtpRows = []; state.reads = []; state.pending = []; state.defer = false; state.readError = false; state.foreignReply = false;
  state.context = { activeTenantId: TENANT, activeUserId: "ordinary-owner", loading: false,
    accountContextLoading: false, accountContextStatus: "ready", isPlatformOwner: true };
  state.invoke.mockReset().mockResolvedValue({ data: { ok: true, disconnected: true, connector_id: ID }, error: null });
  state.success.mockClear(); state.error.mockClear();
});
afterEach(() => { roots.splice(0).forEach(root => act(() => root.unmount())); document.body.replaceChildren(); });
async function mount(waitForAddress = true, strict = false) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => { root.render(strict ? <StrictMode><EmailIntegrationConfig /></StrictMode> : <EmailIntegrationConfig />); });
  if (waitForAddress) await vi.waitFor(() => expect(host.textContent).toContain("shown@example.invalid"));
  return host;
}
async function rerender() { await act(async () => roots[0].render(<EmailIntegrationConfig />)); }
async function settleReads(indices = state.pending.map((_, index) => index)) {
  await act(async () => { for (const index of indices) state.pending[index].resolve(state.pending[index].answer); });
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
  it("explicitly scopes both reads even when platform RLS permits every tenant", async () => {
    state.rows.unshift({ ...state.rows[0], tenant_id: FOREIGN, id: OTHER, updated_at: "2026-10-17T00:00:00Z", from_address: "foreign@example.invalid" });
    state.smtpRows = [{ channel_type: "email", provider: "smtp", active: true, status: "active", tenant_id: FOREIGN, from_address: "foreign-smtp@example.invalid" }];
    const host = await mount(false);
    expect(state.reads).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenant_id: TENANT, provider: "gmail" }), expect.objectContaining({ tenant_id: TENANT, provider: "smtp" }),
    ]));
    expect(host.textContent).toContain("shown@example.invalid");
    expect(host.textContent).not.toContain("foreign@example.invalid");
    expect(host.textContent).not.toContain("foreign-smtp@example.invalid");
    await act(async () => button(host).click());
    expect(state.invoke).toHaveBeenCalledExactlyOnceWith("gmail-disconnect", { body: { expected_tenant_id: TENANT, connector_id: ID, expected_updated_at: VERSION } });
  });
  it.each([
    { activeTenantId: null }, { activeUserId: null }, { loading: true },
    { accountContextLoading: true }, { accountContextStatus: "error" },
  ])("does not query or offer a disconnect with unresolved scope %j", async context => {
    Object.assign(state.context, context);
    const host = await mount(false);
    expect(state.reads).toEqual([]); expect(button(host)).toBeUndefined();
    expect(host.textContent).not.toContain("shown@example.invalid"); expect(state.invoke).not.toHaveBeenCalled();
  });
  it("withholds foreign results even if a read port returns them despite the tenant predicate", async () => {
    state.foreignReply = true; state.rows = [{ ...state.rows[0], tenant_id: FOREIGN }];
    state.smtpRows = [{ channel_type: "email", provider: "smtp", active: true, status: "active", tenant_id: FOREIGN, from_address: "foreign-smtp@example.invalid" }];
    const host = await mount(false);
    expect(host.textContent).not.toContain("shown@example.invalid"); expect(host.textContent).not.toContain("foreign-smtp@example.invalid");
    expect(button(host)).toBeUndefined(); expect(state.invoke).not.toHaveBeenCalled();
  });
  it("does not turn a denied read into a connected state or disconnect request", async () => {
    state.readError = true; const host = await mount(false);
    expect(button(host)).toBeUndefined(); expect(host.textContent).toContain("could not be read"); expect(state.invoke).not.toHaveBeenCalled();
  });
  it("hides the old workspace immediately and reads the new exact workspace", async () => {
    const host = await mount(); state.defer = true;
    state.context.activeTenantId = FOREIGN; await rerender();
    expect(host.textContent).not.toContain("shown@example.invalid"); expect(button(host)).toBeUndefined();
    expect(state.pending.filter(query => query.filters.tenant_id === FOREIGN)).toHaveLength(2);
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("rejects A-to-B-to-A old reads instead of borrowing the returned workspace identity", async () => {
    state.defer = true; const host = await mount(false);
    state.context.activeTenantId = FOREIGN; await rerender();
    state.rows = [{ ...state.rows[0], from_address: "fresh-a@example.invalid" }];
    state.context.activeTenantId = TENANT; await rerender();
    expect(state.pending).toHaveLength(6);
    await settleReads([4, 5]); expect(host.textContent).toContain("fresh-a@example.invalid");
    await settleReads([0, 1, 2, 3]);
    expect(host.textContent).toContain("fresh-a@example.invalid"); expect(host.textContent).not.toContain("shown@example.invalid");
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it.each(["workspace", "actor", "leave-return"])("withholds a late disconnect acknowledgement after %s changes", async transition => {
    const host = await mount(); let finish!: (value: unknown) => void;
    state.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button(host).click());
    if (transition === "actor") state.context.activeUserId = "other-owner";
    else state.context.activeTenantId = FOREIGN;
    await rerender();
    if (transition === "leave-return") { state.context.activeTenantId = TENANT; await rerender(); }
    const readCount = state.reads.length;
    await act(async () => finish({ data: { ok: true, disconnected: true, connector_id: ID }, error: null }));
    expect(state.success).not.toHaveBeenCalled(); expect(state.invoke).toHaveBeenCalledTimes(1);
    expect(state.reads).toHaveLength(readCount);
  });
  it("suppresses late native acknowledgement after unmount without retry", async () => {
    const host = await mount(); let finish!: (value: unknown) => void;
    state.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button(host).click()); act(() => roots.splice(0)[0].unmount());
    await act(async () => finish({ data: { ok: true, disconnected: true, connector_id: ID }, error: null }));
    expect(state.success).not.toHaveBeenCalled(); expect(state.invoke).toHaveBeenCalledTimes(1);
  });
  it("preserves the same-workspace SMTP read while excluding another tenant's row", async () => {
    const smtp = { channel_type: "email", provider: "smtp", active: true, status: "active" };
    state.smtpRows = [{ ...smtp, tenant_id: FOREIGN, from_address: "foreign-smtp@example.invalid" },
      { ...smtp, tenant_id: TENANT, from_address: "own-smtp@example.invalid" }];
    const host = await mount();
    expect(host.textContent).toContain("own-smtp@example.invalid"); expect(host.textContent).not.toContain("foreign-smtp@example.invalid");
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("preserves current-scope reads through StrictMode cleanup and remount", async () => {
    const host = await mount(true, true);
    expect(host.textContent).toContain("shown@example.invalid");
    expect(state.reads.every(read => read.tenant_id === TENANT)).toBe(true); expect(state.invoke).not.toHaveBeenCalled();
  });
  it("does not publish a lost response into a later actor's workspace", async () => {
    const host = await mount(); let fail!: (error: unknown) => void;
    state.invoke.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    await act(async () => button(host).click());
    state.context.activeUserId = "other-owner"; await rerender();
    await act(async () => fail(new TypeError("lost response")));
    expect(state.error).not.toHaveBeenCalled(); expect(state.success).not.toHaveBeenCalled(); expect(state.invoke).toHaveBeenCalledTimes(1);
  });
});
