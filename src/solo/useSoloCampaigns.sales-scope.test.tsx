import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useSoloCampaigns, type SoloCampaignsState } from "./useSoloCampaigns";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "tenant-a", activeTenant: { slug: "a" }, accountContextLoading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...args: unknown[]) => fixture.rpc(...args), from: fixture.from,
  channel: () => { const chain = { on: () => chain, subscribe: () => chain }; return chain; }, removeChannel: vi.fn(),
} }));
it("reads Sales deals independently of Marketing and fails closed on retry", async () => {
  fixture.from.mockImplementation(() => { throw Error("Marketing unavailable"); });
  fixture.rpc.mockResolvedValue({ data: { can_manage: true, deals: [{ id: "deal-a", title: "Canonical deal", pipeline_id: "p", stage_id: "s", updated_at: "2026-10-03" }] }, error: null });
  let state!: SoloCampaignsState;
  function Probe() { state = useSoloCampaigns({ scope: "pipeline" }); return null; }
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<Probe />));
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.rpc).toHaveBeenCalledWith("get_pipeline_workspace", { _tenant_id: "tenant-a" });
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
