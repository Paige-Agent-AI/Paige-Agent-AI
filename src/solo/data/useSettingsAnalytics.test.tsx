import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_METRICS, useSettingsAnalytics } from "./useSettingsAnalytics";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mock = vi.hoisted(() => ({ context: { activeTenantId: "a3400000-0000-4000-8000-000000000011", activeUserId: "actor-a", loading: false, accountContextStatus: "ready" }, rpc: vi.fn() }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => mock.context }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
const mounted: Root[] = [];
function renderHook(callback: () => ReturnType<typeof useSettingsAnalytics>) {
  const result = { current: undefined as unknown as ReturnType<typeof useSettingsAnalytics> };
  function Probe() { result.current = callback(); return null; }
  const root = createRoot(document.createElement("div")); mounted.push(root);
  const rerender = () => act(() => root.render(<Probe/>));
  rerender();
  return { result, rerender };
}
async function waitFor(assert: () => void) {
  await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); assert(); });
}
afterEach(() => { mounted.splice(0).forEach(root => act(() => root.unmount())); });
function bundle(args: Record<string, string>) {
  const asOf = new Date().toISOString();
  return { metric_key: args.p_metric_key, metric_version: "1.0.0", owner_department: "operations_pmo", label: "Measurement", definition: "Canonical current records", formula: "Count eligible records", range: { key: args.p_range_key, start: args.p_range_start, end: args.p_range_end, bounds: "[start,end)", timezone: "UTC", semantics: "current_snapshot" }, dimensions: {}, values: { kind: "count", count: 3 }, unit: "count", source_refs: ["public.tenant_members"], as_of: asOf, freshness: { queried_at: asOf, source_updated_through: null }, coverage: { state: "complete", candidate_count: 3, contributing_count: 3, excluded_count: 0 }, exclusions: [], truth_state: "LIVE", caveats: [], source_revision_ref: `sr_v1_${"a".repeat(64)}`, account_epoch: args.p_account_epoch, account_epoch_ref: `ae_v1_${"b".repeat(64)}`, evidence_ref: `aneb_v1_${"c".repeat(64)}`, reference_expires_at: new Date(Date.now() + 900000).toISOString() };
}
beforeEach(() => {
  mock.context = { activeTenantId: "a3400000-0000-4000-8000-000000000011", activeUserId: "actor-a", loading: false, accountContextStatus: "ready" };
  mock.rpc.mockReset().mockImplementation(async (_: string, args: Record<string, string>) => ({ data: bundle(args), error: null }));
});
describe("Settings Analytics request lifecycle", () => {
  it("clears readings while authoritative references are revalidated on focus", async () => {
    const { result } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mock.rpc.mockImplementation(() => new Promise(() => {}));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(result.current.reads).toEqual({});
    expect(mock.rpc.mock.calls.some(([name]) => name === "resolve_analytics_evidence_reference")).toBe(true);
  });
  it("clears expired readings before a pending replacement can complete", async () => {
    mock.rpc.mockImplementation(async (_: string, args: Record<string, string>) => ({ data: { ...bundle(args), reference_expires_at: new Date(Date.now() + 100).toISOString() }, error: null }));
    const { result } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mock.rpc.mockImplementation(() => new Promise(() => {}));
    await waitFor(() => expect(result.current.reads).toEqual({}));
    expect(mock.rpc.mock.calls.length).toBeGreaterThan(22);
  });
  it("reissues a changed source reference within the original scope and range", async () => {
    const { result } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const original = result.current.reads[SETTINGS_METRICS[0]]!.result!;
    mock.rpc.mockImplementation(async (name: string, args: Record<string, string>) => name === "resolve_analytics_evidence_reference"
      ? { data: null, error: { code: "42501" } }
      : { data: { ...bundle(args), values: { kind: "count", count: 7 } }, error: null });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.reads[SETTINGS_METRICS[0]]?.result?.values).toEqual({ kind: "count", count: 7 }));
    expect(result.current.reads[SETTINGS_METRICS[0]]!.result!.range).toEqual(original.range);
  });
  it("membership loss clears every value and becomes an explicit permission refusal", async () => {
    const { result } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.permissionDenied).toBe(true));
    expect(result.current.reads).toEqual({});
  });
  it("does not present cached LIVE on resolver network failure or malformed data", async () => {
    const { result } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const validatedKeys = Object.entries(result.current.reads).filter(([, read]) => read?.result).map(([key]) => key);
    mock.rpc.mockResolvedValue({ data: null, error: { code: "NETWORK" } });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Object.values(result.current.reads).every(read => read?.error && read.result === null)).toBe(true);
    expect(mock.rpc.mock.calls.slice(22).filter(([name, args]) => name === "issue_analytics_evidence_bundle" && validatedKeys.includes(args.p_metric_key))).toHaveLength(0);
  });
  it("coalesces wakes and rejects late resolver results after actor switch", async () => {
    const { result, rerender } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const pending: Array<() => void> = [];
    mock.rpc.mockImplementation(() => new Promise(resolve => pending.push(() => resolve({ data: null, error: { code: "42501" } }))));
    act(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
    expect(pending).toHaveLength(4);
    mock.context.activeUserId = "actor-b";
    rerender();
    expect(result.current.reads).toEqual({});
    await act(async () => pending.slice(0,4).forEach(finish => finish()));
    expect(result.current.reads).toEqual({});
    expect(pending).toHaveLength(8);
  });
  it("does not fan out all measurements after authoritative permission denial", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const { result } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.permissionDenied).toBe(true));
    expect(mock.rpc.mock.calls.length).toBeLessThanOrEqual(4);
    expect(result.current.reads).toEqual({});
  });
  it("preserves exact range bounds on reconnect and discards late offline responses", async () => {
    const { result } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const original = result.current.reads[SETTINGS_METRICS[0]]!.result!.range;
    const pending: Array<() => void> = [];
    mock.rpc.mockImplementation(() => new Promise(resolve => pending.push(() => resolve({ data: null, error: { code: "42501" } }))));
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => window.dispatchEvent(new Event("offline")));
    expect(result.current.reads).toEqual({});
    mock.rpc.mockImplementation(async (_: string, args: Record<string, string>) => ({ data: bundle(args), error: null }));
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => pending.forEach(finish => finish()));
    expect(result.current.permissionDenied).toBe(false);
    expect(result.current.reads[SETTINGS_METRICS[0]]!.result!.range).toEqual(original);
  });
  it("uses only the shared issuer and validates the active account and requested dates", async () => {
    const { result } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Object.keys(result.current.reads)).toHaveLength(SETTINGS_METRICS.length);
    expect(mock.rpc.mock.calls.every(([name, args]) => name === "issue_analytics_evidence_bundle" && args.p_account_epoch === mock.context.activeTenantId && !('tenant_id' in args))).toBe(true);
  });
  it("immediately clears old values and ignores late requests after switching workspace", async () => {
    const { result, rerender } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let finish!: () => void;
    mock.rpc.mockImplementation((_n: string, args: Record<string, string>) => new Promise(resolve => { finish = () => resolve({ data: bundle(args), error: null }); }));
    act(() => result.current.refresh());
    mock.context.activeTenantId = "a3400000-0000-4000-8000-000000000012";
    rerender();
    expect(result.current.reads).toEqual({});
    act(() => finish());
    expect(result.current.reads).toEqual({});
  });
  it("does not turn a failed authorization read into a broad query or zero", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const { result } = renderHook(() => useSettingsAnalytics("month"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Object.values(result.current.reads).every(r => r?.error && r.result === null)).toBe(true);
    expect(mock.rpc.mock.calls.every(([name]) => name === "issue_analytics_evidence_bundle")).toBe(true);
  });
  it("rejects mismatched response identities", async () => {
    mock.rpc.mockImplementation(async (_: string, args: Record<string, string>) => ({ data: { ...bundle(args), account_epoch: "foreign" }, error: null }));
    const { result } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Object.values(result.current.reads).every(r => r?.result === null)).toBe(true);
  });
  it("finishes with no values when identity resolution fails", async () => {
    mock.context.accountContextStatus = "error";
    const { result } = renderHook(() => useSettingsAnalytics("week"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reads).toEqual({});
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
