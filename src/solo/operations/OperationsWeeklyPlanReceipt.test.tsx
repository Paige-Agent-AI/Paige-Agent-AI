import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const id = (n: number) => `e5020000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const f = vi.hoisted(() => ({ row: null as unknown, save: vi.fn() }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenant: null }) }));
vi.mock("./operations-weekly-plan-save", () => ({ saveWeeklyPlanReview: (...args: unknown[]) => f.save(...args) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({error:null,data:f.row}) }; return q; } } }));
import { OperationsWeeklyPlanReceipt } from "./OperationsWeeklyPlanReceipt";
let root: Root, host: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { host = document.createElement("div");document.body.append(host);root=createRoot(host);f.save.mockReset();f.row={id:id(3),tenant_id:id(2),created_by:id(1),metadata:{weekly_plan_review_v1:{request_id:id(4)}}}; });
afterEach(() => {act(() => root.unmount());host.remove();});
const mount = () => act(async () => root.render(<MemoryRouter><OperationsWeeklyPlanReceipt actorId={id(1)} tenantId={id(2)} planId={id(3)} /></MemoryRouter>));
it("reopens only the original read-only save identity and separates current changed/missing work from executed results", async () => {
  f.save.mockResolvedValue({kind:"verified",planId:id(3),receiptId:id(5),reviewZone:"UTC",currentWork:[{key:`crm:${id(6)}`,state:"available",id:id(6),source:"crm",title:"Current authorized task",status:"in_progress",dueAt:null,changedSinceReview:true},{key:`crm:${id(7)}`,state:"unavailable"}]});
  await mount(); expect(f.save).toHaveBeenCalledOnce();expect(f.save.mock.calls[0][1]).toBeNull();expect(f.save.mock.calls[0][3]).toBe(id(4));
  expect(host.textContent).toContain("Current authorized task");expect(host.textContent).toContain("changed since the plan");expect(host.textContent).toContain("Original work is unavailable");expect(host.textContent).toContain("does not prove");expect(host.textContent).toContain(id(5));
});
it("does not present a foreign receipt or uncertain save as verified completion", async () => {
  f.save.mockResolvedValue({kind:"verified",planId:id(9),currentWork:[]});await mount();expect(host.textContent).toContain("could not be verified");expect(host.textContent).not.toContain("Original Planning save verified");
});
it("ordinary Plans do not fabricate a weekly receipt", async () => {
  f.row={id:id(3),tenant_id:id(2),created_by:id(1),metadata:{}};await mount();expect(host.textContent).toBe("");expect(f.save).not.toHaveBeenCalled();
});
it("an inaccessible or different original creator cannot expose a private save result", async () => {
  f.row={id:id(3),tenant_id:id(2),created_by:id(8),metadata:{weekly_plan_review_v1:{request_id:id(4)}}};await mount();expect(f.save).not.toHaveBeenCalled();expect(host.textContent).toContain("could not be verified");
});
