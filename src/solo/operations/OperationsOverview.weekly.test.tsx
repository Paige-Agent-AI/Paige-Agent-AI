import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WeeklyOwnerRead } from "../weekly/weekly-owner-read";
const h=vi.hoisted(()=>({eligible:true,read:{status:"unavailable"} as WeeklyOwnerRead,enabled:[] as boolean[],refresh:vi.fn()}));
vi.mock("../weekly/useWeeklyResponsibility",()=>({
  useWeeklyOwnerAudience:()=>({eligible:h.eligible,key:"synthetic-owner:tenant:epoch"}),
  useWeeklyResponsibility:(enabled:boolean)=>{h.enabled.push(enabled);return{read:h.read,refresh:h.refresh};},
}));
import { OperationsOverview } from "./OperationsOverview";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let cleanup:(()=>void)|null=null;
beforeEach(()=>{h.eligible=true;h.read={status:"unavailable"};h.enabled=[];h.refresh.mockReset();});
afterEach(()=>{cleanup?.();cleanup=null;});
const button=(name:string)=>[...document.querySelectorAll("button")].find(b=>(b.getAttribute("aria-label")??b.textContent?.trim())===name);
async function mount(review=vi.fn()){
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  await act(async()=>root.render(<MemoryRouter initialEntries={["/solo/123/operations/overview"]}><div data-pg="light"><OperationsOverview tenantId="test-tenant" plans={[]} items={[]} members={[]} onInspectItem={vi.fn()} onInspectPlan={vi.fn()} onReviewWithPaige={review}/></div></MemoryRouter>));
  cleanup=()=>act(()=>{root.unmount();host.remove();});return{host,review};
}
it("opens the original weekly inspection from Overview without reading until requested or replacing Plan with PAIGE",async()=>{
  const {review}=await mount();expect(button("Weekly responsibility")).toBeTruthy();expect(h.enabled).toEqual([false]);
  await act(async()=>button("Plan with PAIGE")!.click());expect(review).toHaveBeenCalledTimes(1);expect(h.enabled).not.toContain(true);
  await act(async()=>button("Weekly responsibility")!.click());expect(h.enabled).toContain(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Current status couldn’t be verified");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("No weekly responsibility is registered");
  expect(button("Enable")).toBeUndefined();expect(h.refresh).not.toHaveBeenCalled();
});
it("keeps a noneligible audience out of the weekly reader while retaining the original operating work",async()=>{
  h.eligible=false;await mount();expect(button("Weekly responsibility")).toBeUndefined();expect(h.enabled).toEqual([]);
  expect(document.body.textContent).toContain("Start with one real commitment");expect(button("Plan with PAIGE")).toBeTruthy();
});
it("shows an original server refusal without planning or exposing another owner's records",async()=>{
  h.read={status:"refused"};await mount();expect(button("Weekly responsibility")).toBeTruthy();
  await act(async()=>button("Weekly responsibility")!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("No other account’s records are shown");
  expect(button("Prepare a weekly responsibility")).toBeUndefined();
  await act(async()=>button("Close")!.click());expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("uses the same current SOLO Calendar and Work destinations without a new schedule or booking",async()=>{
  h.read={status:"ready",snapshot:{source:"canonical_process_and_act_receipts",
    read_at:"2026-10-20T08:00:00Z",limit:50,has_more:false,business_time_zone:{state:"configured",zone:"America/New_York"},checks:[]}};
  await mount();await act(async()=>button("Weekly responsibility")!.click());
  const dialog=document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("No weekly responsibility is registered");expect(dialog.textContent).toContain("Recurring execution is currently unavailable");
  expect([...dialog.querySelectorAll("a")].map(a=>a.getAttribute("href"))).toEqual(["/solo/123/clients/calendar","/solo/123/operations/work"]);
  expect(h.refresh).not.toHaveBeenCalled();
});
