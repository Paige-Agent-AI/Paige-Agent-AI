import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_METRICS, useSettingsAnalytics } from "./useSettingsAnalytics";
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
