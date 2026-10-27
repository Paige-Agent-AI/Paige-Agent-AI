import React, {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {MemoryRouter,Route,Routes,useLocation,useNavigate} from "react-router-dom";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {RecordedRunRead} from "@/hooks/useSystemsCheck";

const ports=vi.hoisted(()=>({systems:vi.fn(),command:vi.fn()}));
vi.mock("@/hooks/useSystemsCheck",()=>({useSystemsCheck:(...args:unknown[])=>ports.systems(...args)}));
vi.mock("./data/useCommandCenter",()=>({useCommandCenter:()=>ports.command()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:()=>{throw Error("NO_BACKEND_IN_SOURCE_TEST");}}}));
vi.mock("./data/useSoloActivityFeed",async original=>({...await original<typeof import("./data/useSoloActivityFeed")>(),useSoloActivityFeed:()=>({status:"ready",items:[],refresh:()=>undefined})}));
vi.mock("next-themes",()=>({useTheme:()=>({resolvedTheme:"light"})}));
import {SystemsCheckRunReview} from "./SystemsCheckRunReview";
import {SoloSystemsCheckWorkspace} from "./SoloSystemsCheckWorkspace";

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const ID="a1000000-0000-0000-0000-000000000001";
const ready=():Extract<RecordedRunRead,{state:"ready"}>=>({state:"ready",run:{id:ID,started_at:"2026-10-20T08:00:00Z",completed_at:"2026-10-20T08:01:00Z",check_count:10,pass_count:8,fail_count:2}});
let root:Root,host:HTMLDivElement,record:RecordedRunRead,epoch:number;
const refresh=vi.fn(),commandRefresh=vi.fn(),approve=vi.fn(),decline=vi.fn(),openPaige=vi.fn(),close=vi.fn(),returnFocus=vi.fn();
const dialog=()=>document.querySelector<HTMLElement>('[role="dialog"]');
const control=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.includes(text));
function Location(){const l=useLocation(),navigate=useNavigate();return <><output data-location>{l.search+l.hash}</output><button onClick={()=>navigate(-1)}>History back</button><button onClick={()=>navigate(1)}>History forward</button></>;}
function renderPage(entry="/solo/1234567/command-center/systems-check?keep=1#evidence"){
 act(()=>root.render(<MemoryRouter initialEntries={[entry]}><Location/><Routes><Route path="/solo/:account/*" element={<SoloSystemsCheckWorkspace accountContext={{accountName:"Example Services",accountType:"standalone"}} openPaige={openPaige}/>}/></Routes></MemoryRouter>));
}
function renderReview(){act(()=>root.render(<SystemsCheckRunReview open record={record} onClose={close} onRefresh={refresh} onReturnFocus={returnFocus}/>));}
async function waitFor(check:()=>void){const began=Date.now();for(;;){try{check();return;}catch(error){if(Date.now()-began>3000)throw error;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});}}}
beforeEach(()=>{
 vi.clearAllMocks();record=ready();epoch=1;
 ports.systems.mockImplementation(()=>({run:{...ready().run,check_count:7,pass_count:6,fail_count:1},findings:[],loading:false,isError:false,scanPending:false,scanInProgressSince:null,refresh,recordedRun:record}));
 ports.command.mockImplementation(()=>({accountEpoch:epoch,approvals:[],metrics:[],attention:{at_risk_clients:0,follow_ups_due:0},departments:[],greeting:{name:"Example",dateLabel:"Today",summary:""},counts:{approvals:0},loading:false,empty:true,isError:false,departmentsConfigured:false,approve,decline,refresh:commandRefresh}));
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();expect(approve).not.toHaveBeenCalled();expect(decline).not.toHaveBeenCalled();expect(openPaige).not.toHaveBeenCalled();});

describe("Original Systems Check run presentation",()=>{
 it("shows exact source counts and timestamps without current-health or receipt claims",()=>{
  renderReview();expect(dialog()?.querySelector('time')?.dateTime).toBe(ready().run.completed_at);
  expect([...dialog()!.querySelectorAll('dd')].map(node=>node.textContent)).toEqual(["10","8","2"]);
  expect(dialog()?.textContent).toContain("Current readiness is shown in the workspace");
  expect(dialog()?.textContent).not.toMatch(/verified receipt|repair completed|worker running/i);
 });
 it("keeps a genuine zero visible without implying readiness",()=>{
  record={...ready(),run:{...ready().run,check_count:0,pass_count:0,fail_count:0}};renderReview();
  expect([...dialog()!.querySelectorAll('dd')].map(node=>node.textContent)).toEqual(["0","0","0"]);expect(dialog()?.textContent).toContain("do not establish business readiness");
 });
 it("does not turn unknown counts into zero",()=>{
  record={...ready(),run:{...ready().run,check_count:null,pass_count:null,fail_count:null}};renderReview();
  expect([...dialog()!.querySelectorAll('dd')].map(node=>node.textContent)).toEqual(["—","—","—"]);
 });
 it("withholds unfinished tallies and makes no liveness claim",()=>{
  record={...ready(),run:{...ready().run,completed_at:null}};renderReview();expect(dialog()?.querySelector('dl')).toBeNull();expect(dialog()?.textContent).toContain("Current progress is unconfirmed");
 });
 it.each(["loading","error","unavailable"] as const)("withdraws previous result for %s",state=>{
  renderReview();record={state};renderReview();expect(dialog()?.querySelector('dl')).toBeNull();expect(dialog()?.querySelector('time')).toBeNull();
  if(state==="error"){act(()=>control("Read again")!.click());expect(refresh).toHaveBeenCalledTimes(1);}else expect(control("Read again")).toBeUndefined();
 });
 it("focuses the readable heading without moving to the footer",async()=>{renderReview();await waitFor(()=>expect(document.activeElement).toBe(dialog()?.querySelector('h2')));});
 it("returns the actual prior conversation control rather than inventing a Chat destination",async()=>{
  const composer=document.createElement('textarea');document.body.append(composer);composer.focus();renderReview();
  act(()=>root.render(<SystemsCheckRunReview open={false} record={record} onClose={close} onRefresh={refresh} onReturnFocus={returnFocus}/>));
  await waitFor(()=>expect(returnFocus).toHaveBeenCalledWith(composer));composer.remove();
 });
});

describe("Run inspection in the original workspace",()=>{
 it("opens only the run reference and retains other page context",()=>{
  renderPage();const trigger=control("View recorded check")!;act(()=>{trigger.focus();trigger.click();});
  expect(ports.systems).toHaveBeenLastCalledWith("tenant",{runId:ID});expect(host.querySelector('[data-location]')?.textContent).toBe(`?keep=1&run=${ID}#evidence`);
  expect(dialog()?.textContent).toContain("Recorded check");expect(host.querySelector('.sc-strip')?.textContent).toContain("7 checks");
 });
 it("returns to the original control and preserves the page scroll",async()=>{
  renderPage();const scroll=host.querySelector<HTMLElement>('.sc-scroll-owner')!;scroll.scrollTop=188;
  const trigger=control("View recorded check")!;act(()=>{trigger.focus();trigger.click();});act(()=>control("Return to Systems Check")!.click());
  await waitFor(()=>expect(dialog()).toBeNull());await waitFor(()=>expect(document.activeElement).toBe(trigger));
  expect(scroll.scrollTop).toBe(188);expect(host.querySelector('[data-location]')?.textContent).toBe("?keep=1#evidence");
 });
 it("retains native history return and forward without another action",async()=>{
  renderPage();act(()=>control("View recorded check")!.click());act(()=>control("History back")!.click());await waitFor(()=>expect(dialog()).toBeNull());
  act(()=>control("History forward")!.click());expect(dialog()).not.toBeNull();expect(refresh).not.toHaveBeenCalled();
 });
 it("restores a bookmarked source after a fresh mount",()=>{renderPage(`/solo/1234567/command-center/systems-check?run=${ID}`);expect(dialog()?.textContent).toContain("Recorded check");expect(ports.systems).toHaveBeenLastCalledWith("tenant",{runId:ID});});
 it.each([`run=${ID}&run=${ID}`,`run=${ID}&finding=${ID}`])("refuses ambiguous original source %s",query=>{
  record={state:"unavailable"};renderPage(`/solo/1234567/command-center/systems-check?${query}`);expect(ports.systems).toHaveBeenLastCalledWith("tenant",{runId:""});expect(dialog()?.querySelector('dl')??null).toBeNull();
 });
 it("refreshes only the original source without changing context or invoking an action",()=>{
  record={state:"error"};renderPage(`/solo/1234567/command-center/systems-check?run=${ID}`);act(()=>control("Read again")!.click());expect(refresh).toHaveBeenCalledTimes(1);expect(commandRefresh).not.toHaveBeenCalled();expect(host.querySelector('[data-location]')?.textContent).toBe(`?run=${ID}`);
 });
 it("withdraws source details after permission or workspace context changes",()=>{
  renderPage(`/solo/1234567/command-center/systems-check?run=${ID}`);record={state:"unavailable"};epoch=2;renderPage();expect(dialog()?.querySelector('dl')).toBeNull();expect(dialog()?.textContent).toContain("unavailable in this workspace");
 });
 it("does not restore a shared conversation control after the originating workspace unmounts",async()=>{
  const previous=document.createElement('textarea');document.body.append(previous);previous.focus();
  renderPage(`/solo/1234567/command-center/systems-check?run=${ID}`);
  const frames:FrameRequestCallback[]=[];vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
  const restore=vi.spyOn(previous,'focus');
  act(()=>root.render(<button>Current workspace control</button>));
  const current=host.querySelector('button')!;current.focus();
  await waitFor(()=>expect(frames.length).toBeGreaterThan(0));act(()=>{for(const callback of frames.splice(0))callback(0);});
  expect(restore).not.toHaveBeenCalled();expect(document.activeElement).toBe(current);previous.remove();
 });
});
