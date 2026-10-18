import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter, MemoryRouter, Router, NavigationType, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ reason: null as string | null }));
vi.mock("@/lib/routing/useSubtabRoute", () => ({ useSubtabRoute: () => {
  const location = useLocation(); const navigate = useNavigate();
  return [location.pathname.endsWith("/capacity") ? "capacity" : "work", (view: string) => navigate(`/solo/123/operations/${view}`)];
} }));
vi.mock("./OperationsWorkspace", () => ({ OperationsWorkspace: ({ view, weeklySourceSearch, onNavigationGuardChange, onViewChange, onWeeklySourceDismiss, onTaskFocusDismiss }: {
  view: string; weeklySourceSearch: string; onViewChange: (view: string) => void; onWeeklySourceDismiss: () => void;
  onNavigationGuardChange: (guard: (() => string | null) | null) => void;
  onTaskFocusDismiss: () => void;
}) => {
  React.useLayoutEffect(() => { onNavigationGuardChange(() => harness.reason); return () => onNavigationGuardChange(null); }, [onNavigationGuardChange]);
  return <div data-view={view} data-query={weeklySourceSearch}><button onClick={() => onViewChange("capacity")}>Capacity</button>
    <button onClick={onWeeklySourceDismiss}>Dismiss source</button><button onClick={onTaskFocusDismiss}>Dismiss Task focus</button></div>;
} }));
import { OperationsRoute } from "./OperationsRoute";
function HistoryControls() {
  const navigate = useNavigate(); const location = useLocation();
  return <div><output>{location.pathname}{location.search}{location.hash}</output><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button>
    <button onClick={() => navigate("/solo/123/operations/work?weeklySource=planning_item&item=40000000-0000-4000-8000-000000000001")}>Another source</button></div>;
}
let root: Root; let container: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const search = "?weeklySource=planning_item&item=30000000-0000-4000-8000-000000000001";
beforeEach(() => { harness.reason = null; container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(entries=["/solo/123/operations/work", `/solo/123/operations/work${search}`],initialIndex=1) {
  await act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
    <HistoryControls /><OperationsRoute openPaige={vi.fn()} /></MemoryRouter>));
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(candidate => candidate.textContent === label)!;
  await act(async () => button.click());
}
it("keeps the accepted query through dirty Back and repeated-source transitions without a replace loop", async () => {
  await render(); harness.reason = "Unsaved draft";
  await click("Back"); expect(container.querySelector("output")?.textContent).toContain(search);
  expect(container.querySelector("[data-query]")?.getAttribute("data-query")).toBe(search);
  await click("Another source"); expect(container.querySelector("output")?.textContent).toContain(search);
  await click("Capacity"); expect(container.querySelector("[data-view]")?.getAttribute("data-view")).toBe("work");
});
it("accepts clean Back and clears only typed source parameters when the inspection closes", async () => {
  await render(); await click("Dismiss source");
  expect(container.querySelector("output")?.textContent).toBe("/solo/123/operations/work");
  expect(container.querySelector("[data-query]")?.getAttribute("data-query")).toBe("");
  await click("Capacity"); expect(container.querySelector("[data-view]")?.getAttribute("data-view")).toBe("capacity");
});

it("preserves the original Back entry after rejecting dirty Back (E05 intent)",async()=>{
 await render();harness.reason="Unsaved input";await click("Back");expect(container.querySelector("output")?.textContent).toContain(search);
 harness.reason=null;await click("Back");expect(container.querySelector("output")?.textContent).toBe("/solo/123/operations/work");
});
it("preserves Forward after rejecting unconfirmed navigation (E05 intent)",async()=>{
 await render(["/solo/123/operations/work",`/solo/123/operations/work${search}`,"/solo/123/operations/capacity"]);harness.reason="Unconfirmed work";
 await click("Forward");expect(container.querySelector("output")?.textContent).toContain(search);harness.reason=null;await click("Forward");expect(container.querySelector("output")?.textContent).toBe("/solo/123/operations/capacity");
});
it("does not discard a guarded Planning source through its dismiss callback",async()=>{
 await render();harness.reason="Unsaved input";await click("Dismiss source");expect(container.querySelector("output")?.textContent).toContain(search);
 harness.reason=null;await click("Dismiss source");expect(container.querySelector("output")?.textContent).toBe("/solo/123/operations/work");
});
it("clears only the Task address on explicit dismissal, keeping unrelated query/hash",async()=>{
 await render(["/solo/123/operations/work","/solo/123/operations/work?task=33333333-3333-4333-8333-333333333333&filter=active#current"]);
 await click("Dismiss Task focus");expect(container.querySelector("output")?.textContent).toBe("/solo/123/operations/work?filter=active#current");
});
it("restores BrowserRouter's accepted index without overwriting its Back destination",async()=>{
 const originalUrl=window.location.href,originalState=window.history.state;window.history.replaceState({idx:0},"","/solo/123/operations/work");
 const indices:number[]=[];let first=()=>{},restored=()=>{};
 const firstPop=new Promise<void>(resolve=>{first=resolve;});const restoredPop=new Promise<void>(resolve=>{restored=resolve;});
 const observed=()=>{indices.push(window.history.state.idx);if(indices.length===1)first();if(indices.length===2)restored();};
 try{
  await act(async()=>root.render(<BrowserRouter><HistoryControls/><OperationsRoute openPaige={vi.fn()}/></BrowserRouter>));await click("Another source");harness.reason="Unsaved input";window.addEventListener("popstate",observed);
  const back=Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button=>button.textContent==="Back")!;
  await act(async()=>{back.click();await firstPop;});await act(async()=>{await restoredPop;});expect(indices).toEqual([0,1]);
  harness.reason=null;const cleanPop=new Promise<void>(resolve=>window.addEventListener("popstate",()=>resolve(),{once:true}));await act(async()=>{back.click();await cleanPop;});
  expect(container.querySelector("output")?.textContent).toBe("/solo/123/operations/work");expect(window.history.state.idx).toBe(0);
 }finally{window.removeEventListener("popstate",observed);window.history.replaceState(originalState,"",originalUrl);}
});
it.each([NavigationType.Pop,NavigationType.Push])("makes an unindexed %s address mismatch explicit and keeps the accepted inspection",async navigationType=>{
 const originalState=window.history.state;window.history.replaceState(null,"");
 const navigator={createHref:()=>"/",go:vi.fn(),push:vi.fn(),replace:vi.fn()};
 const mount=async(pathname:string,key:string)=>{await act(async()=>root.render(<Router navigator={navigator} navigationType={navigationType} location={{pathname,search:"",hash:"",state:null,key}}><HistoryControls/><OperationsRoute openPaige={vi.fn()}/></Router>));};
 try{
  await mount("/solo/123/operations/work","accepted");harness.reason="Unsaved Task";await mount("/solo/123/operations/capacity","unaccepted");
  expect(container.querySelector("[data-view]")?.getAttribute("data-view")).toBe("work");expect(container.textContent).toContain("address changed");expect(container.textContent).toContain("Explicitly close");expect(navigator.go).not.toHaveBeenCalled();expect(navigator.replace).not.toHaveBeenCalled();
  harness.reason=null;await mount("/solo/123/operations/capacity","clean");expect(container.querySelector("[data-view]")?.getAttribute("data-view")).toBe("capacity");expect(container.textContent).not.toContain("address changed");
 }finally{window.history.replaceState(originalState,"");}
});
