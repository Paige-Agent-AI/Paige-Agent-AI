import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSoloCampaigns, type SoloCampaignsState } from "./useSoloCampaigns";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(),
  context: { activeTenantId: "test-tenant-a" as string | null, activeTenant: { slug: "a" }, accountContextLoading: false },
  channels: [] as { onChange: (() => void)[] }[], removeChannel: vi.fn(),
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => fixture.context }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...args: unknown[]) => fixture.rpc(...args), from: fixture.from,
  channel: () => { const entry = { onChange: [] as (() => void)[] }; fixture.channels.push(entry);
    const chain = { on: (_event: unknown, _filter: unknown, callback: () => void) => { entry.onChange.push(callback); return chain; }, subscribe: () => chain }; return chain; },
  removeChannel: (...args: unknown[]) => fixture.removeChannel(...args),
} }));
beforeEach(() => { fixture.rpc.mockReset(); fixture.from.mockReset(); fixture.removeChannel.mockReset(); fixture.channels.length = 0;
  fixture.context = { activeTenantId: "test-tenant-a", activeTenant: { slug: "a" }, accountContextLoading: false }; });
afterEach(() => { vi.useRealTimers(); });
it("reads Sales deals independently of Marketing and fails closed on retry", async () => {
  fixture.from.mockImplementation(() => { throw Error("Marketing unavailable"); });
  fixture.rpc.mockResolvedValue({ data: { can_manage: true, deals: [{ id: "deal-a", title: "Canonical deal", pipeline_id: "p", stage_id: "s", updated_at: "2026-10-03" }] }, error: null });
  let state!: SoloCampaignsState;
  function Probe() { state = useSoloCampaigns({ scope: "pipeline" }); return null; }
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<Probe />));
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.rpc).toHaveBeenCalledWith("get_pipeline_workspace", { _tenant_id: "test-tenant-a" });
    expect(fixture.rpc).not.toHaveBeenCalledWith("get_pipeline_routing_evidence", expect.anything());
    expect(state.phase).toBe("ready");
    expect(state.pipelineWorkspace.deals[0].id).toBe("deal-a");
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Read unavailable" } });
    await act(async () => state.retry());
    expect(state.phase).toBe("error");
    expect(state.pipelineWorkspace.deals).toEqual([]);
    expect(state.pipelineWorkspace.canManage).toBe(false);
  } finally { act(() => root.unmount()); }
});

const workspace = (client: string) => ({ data: { can_manage: true, deals: [{ id: "test-deal", title: "Protected deal", pipeline_id: "test-pipeline", stage_id: "test-stage", client_id: "test-contact", client_name: client, updated_at: "2026-10-16" }] }, error: null });

it("coalesces Chat completion into the existing reader without realtime delivery, then cleans up", async () => {
  vi.useFakeTimers(); fixture.rpc.mockResolvedValue(workspace("Before"));
  let state!: SoloCampaignsState;
  function Probe() { state = useSoloCampaigns({ scope: "pipeline" }); return null; }
  const root = createRoot(document.createElement("div")); let mounted = true;
  try {
    await act(async () => root.render(<Probe />));
    expect(state.pipelineWorkspace.deals[0].clientName).toBe("Before");
    fixture.rpc.mockResolvedValue(workspace("Linked contact"));
    await act(async () => { for (let n = 0; n < 3; n++) window.dispatchEvent(new Event("paige:turn-settled")); vi.advanceTimersByTime(199); });
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(fixture.rpc).toHaveBeenLastCalledWith("get_pipeline_workspace", { _tenant_id: "test-tenant-a" });
    expect(state.pipelineWorkspace.deals[0].clientName).toBe("Linked contact");
    expect(fixture.from).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("paige:turn-settled")); root.unmount(); mounted = false; vi.advanceTimersByTime(250); window.dispatchEvent(new Event("paige:turn-settled")); vi.advanceTimersByTime(250); });
    expect(fixture.rpc).toHaveBeenCalledTimes(2);
  } finally { if (mounted) act(() => root.unmount()); }
});

it("retires queued and late old-workspace notifications and reads only the current workspace", async () => {
  vi.useFakeTimers(); fixture.rpc.mockResolvedValue(workspace("Workspace A"));
  let state!: SoloCampaignsState;
  function Probe() { state = useSoloCampaigns({ scope: "pipeline" }); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Probe />)); const oldChannel = fixture.channels[0];
    await act(async () => { window.dispatchEvent(new Event("paige:turn-settled")); });
    fixture.context = { activeTenantId: "test-tenant-b", activeTenant: { slug: "b" }, accountContextLoading: false };
    fixture.rpc.mockResolvedValue(workspace("Workspace B"));
    await act(async () => root.render(<Probe />));
    const readsAfterSwitch = fixture.rpc.mock.calls.length;
    await act(async () => { oldChannel.onChange.forEach(callback => callback()); vi.advanceTimersByTime(250); });
    expect(fixture.rpc).toHaveBeenCalledTimes(readsAfterSwitch);
    await act(async () => { window.dispatchEvent(new Event("paige:turn-settled")); vi.advanceTimersByTime(200); });
    expect(fixture.rpc).toHaveBeenCalledTimes(readsAfterSwitch + 1);
    expect(fixture.rpc).toHaveBeenLastCalledWith("get_pipeline_workspace", { _tenant_id: "test-tenant-b" });
    expect(state.tenantId).toBe("test-tenant-b"); expect(state.pipelineWorkspace.deals[0].clientName).toBe("Workspace B");
    expect(fixture.removeChannel).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); }
});

it("does not read while identity is resolving or no workspace is selected", async () => {
  vi.useFakeTimers(); fixture.context.accountContextLoading = true;
  function Probe() { useSoloCampaigns({ scope: "pipeline" }); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => { window.dispatchEvent(new Event("paige:turn-settled")); vi.advanceTimersByTime(200); });
    fixture.context = { activeTenantId: null, activeTenant: { slug: "" }, accountContextLoading: false };
    await act(async () => root.render(<Probe />));
    await act(async () => { window.dispatchEvent(new Event("paige:turn-settled")); vi.advanceTimersByTime(200); });
    expect(fixture.rpc).not.toHaveBeenCalled(); expect(fixture.channels).toHaveLength(0);
  } finally { act(() => root.unmount()); }
});

it("does not retain a successful-looking pipeline when the completion read is refused", async () => {
  vi.useFakeTimers(); fixture.rpc.mockResolvedValue(workspace("Earlier contact"));
  let state!: SoloCampaignsState;
  function Probe() { state = useSoloCampaigns({ scope: "pipeline" }); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Probe />));
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Read refused" } });
    await act(async () => { window.dispatchEvent(new Event("paige:turn-settled")); vi.advanceTimersByTime(200); });
    expect(state.phase).toBe("error"); expect(state.pipelineWorkspace.deals).toEqual([]); expect(state.pipelineWorkspace.canManage).toBe(false);
  } finally { act(() => root.unmount()); }
});
