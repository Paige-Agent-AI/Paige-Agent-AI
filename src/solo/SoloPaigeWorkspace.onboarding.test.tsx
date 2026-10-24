import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SoloPaigeWorkspace } from "./SoloPaigeWorkspace";
import { SoloOnboardingStage } from "./SoloOnboardingStage";
import { cleanSoloSetupBrief } from "./settings-setup-contract";
const id = "11111111-1111-4111-8111-111111111111";
const fixture = vi.hoisted(() => ({ tenant: "test-tenant-a", staff: false, tierAllows: true, features: undefined as Record<string, unknown> | undefined, rpc: vi.fn(), context: {} as Record<string, unknown>, renders: [] as (string|null|undefined)[], chips: [] as {label:string;prompt:string;autoSend?:boolean}[] }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: fixture.tenant, isPlatformStaff: fixture.staff, activeTenant: { account_number: "10001", features: fixture.features } }) }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => fixture.tierAllows, loading: false }) }));
vi.mock("./data/useSoloBusinessContext", () => ({ useSoloBusinessContext: () => fixture.context }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock("@/components/paige/live/PaigePresence", () => ({ PaigePresence: ({ state }: {state: string}) => <span data-presence={state} /> }));
vi.mock("@/components/dashboard/PaigeAIChat", () => ({ PaigeAIChat: ({ conversationHeader, activeThreadId, surfaceContext, liveConversation, chips }: {conversationHeader:ReactNode;activeThreadId?:string|null;surfaceContext?:{kind:string};liveConversation:boolean;chips?:typeof fixture.chips}) => { fixture.renders.push(activeThreadId); fixture.chips=chips??[]; return <div data-chat data-thread={activeThreadId} data-context={surfaceContext?.kind} data-live={String(liveConversation)}>{conversationHeader}</div>; } }));
let host: HTMLDivElement, root: Root;
const Probe = () => { const route = useLocation(); const navigate = useNavigate(); return <><output data-route>{route.pathname+route.search}</output><button type="button" data-leave-onboarding onClick={() => navigate("/solo/10001/paige/chat")}>Leave onboarding</button></>; };
const render = async (search="?onboarding=1") => act(async () => { root.render(<MemoryRouter initialEntries={["/solo/10001/paige/chat"+search]}><SoloPaigeWorkspace full /><Probe /></MemoryRouter>); });
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; fixture.tenant="test-tenant-a"; fixture.staff=false; fixture.tierAllows=true; fixture.features=undefined; fixture.rpc.mockReset(); fixture.renders=[]; fixture.context={ loading:false, saving:false, error:null, resolvedTenantId:fixture.tenant, accessScope:"owner_full", contextRevision:1, brief:cleanSoloSetupBrief({ publicName:"Example services", industry:"Consulting", provenance:{ publicName:{source:"owner_confirmed",confidence:"confirmed"}, industry:{source:"connection_sourced",confidence:"observed"} } }), refresh:vi.fn(), pendingProposal:null }; fixture.rpc.mockImplementation(async (name: string) => ({data: name==="get_solo_business_context" ? {tenantId:fixture.tenant,accessScope:"owner_full"} : null,error:null})); host=document.createElement("div"); document.body.append(host); root=createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
it("offers editable next-step prompts only from current confirmed priority and retires them on unknown state or tenant switch",async()=>{
  fixture.context.brief=cleanSoloSetupBrief({currentPriority:"Improve delivery",provenance:{currentPriority:{source:"owner_confirmed",confidence:"confirmed"}}});
  await render(); expect(fixture.chips.map(c=>c.label)).toContain("Choose a first action"); expect(fixture.chips.every(c=>!/interview/i.test(c.label))).toBe(true);
  expect(fixture.chips.every(c=>!c.autoSend)).toBe(true);
  expect(fixture.chips.find(c=>c.label==="Choose a first action")?.prompt).toContain("Do not execute it yet");
  fixture.context.saveOutcomeUnknown=true; await render(); expect(fixture.chips.every(c=>!/interview/i.test(c.label))).toBe(true);
  fixture.context.saveOutcomeUnknown=false; fixture.tenant="test-tenant-b"; await render();
  expect(fixture.chips.every(c=>!/interview/i.test(c.label))).toBe(true);
});
it("opens first-run conversation and shows only confirmed canonical progress",async()=>{ await render(); expect(host.querySelector("[data-context]")?.getAttribute("data-context")).toBe("solo_business_interview"); expect(host.textContent).not.toContain("Meet PAIGE."); expect(host.textContent).toContain("1 confirmed business detail in Setup"); expect(host.querySelector("[data-presence]")?.getAttribute("data-presence")).toBe("ready"); expect(host.querySelector("[data-live]")?.getAttribute("data-live")).toBe("true"); expect(host.querySelector(".sbi-facts")).toBeNull(); await act(async()=>{[...host.querySelectorAll("button")].find(b=>b.textContent==="Review profile")!.click();}); expect(host.querySelector(".sbi-facts")?.textContent).toContain("Example services"); });
it("keeps an unobtrusive resume control on the onboarding stage",async()=>{
  await render("?onboarding=1");
  const resume = host.querySelector<HTMLButtonElement>(".sos-progress--link");
  expect(resume).not.toBeNull();
  expect(resume!.getAttribute("aria-expanded")).toBe("true");
  await act(async()=>{resume!.click();});
  expect(host.querySelector(".sos-progress--link")?.getAttribute("aria-expanded")).toBe("true");
  expect(host.textContent).not.toContain("Meet PAIGE.");
  expect(host.textContent).not.toContain("Business interview");
});
it("offers the voice-first entry on first run and requests the existing Live surface",async()=>{
  const requests:string[]=[];
  const hear=(event:Event)=>requests.push(event.type);
  window.addEventListener("paige-live-open-request",hear);
  try{
    await render("?onboarding=1");
    const talk=host.querySelector<HTMLButtonElement>(".sos-voice");
    expect(talk).not.toBeNull();
    expect(talk!.textContent).toContain("Talk with Paige live");
    // The copy must not promise typing DURING Live — the immersive stage is modal
    // (focus-trapped, rest inert). It promises the honest path back to typing.
    expect(host.textContent).toContain("Minimize Live any time to keep typing");
    expect(host.textContent).not.toContain("typing works the whole time");
    expect(host.textContent).not.toContain("Meet PAIGE.");
    await act(async()=>{talk!.click();});
    expect(requests).toEqual(["paige-live-open-request"]);
    // The affordance exists only on the first-run stage; once the URL leaves onboarding
    // (real navigation), the stage — and the voice entry with it — unmounts.
    await act(async()=>{ host.querySelector<HTMLButtonElement>("[data-leave-onboarding]")!.click(); });
    expect(host.querySelector(".sos-voice")).toBeNull();
    expect(host.querySelector(".sos")).toBeNull();
  } finally { window.removeEventListener("paige-live-open-request",hear); }
});
it("holds the voice entry back while PAIGE is preparing a response",async()=>{
  await render("?onboarding=1");
  expect(host.querySelector<HTMLButtonElement>(".sos-voice")!.disabled).toBe(false);
  // The workspace drives the stage's `thinking` from real chat work; check the
  // busy mapping on the stage itself (the harness chat mock does not trace).
  const stageHost=document.createElement("div"); host.append(stageHost);
  const stageRoot=createRoot(stageHost);
  try{
    await act(async()=>{stageRoot.render(<SoloOnboardingStage thinking onTalkLive={()=>{}} profile={null}/>);});
    expect(stageHost.querySelector<HTMLButtonElement>(".sos-voice")!.disabled).toBe(true);
    await act(async()=>{stageRoot.render(<SoloOnboardingStage thinking={false} onTalkLive={()=>{}} profile={null}/>);});
    expect(stageHost.querySelector<HTMLButtonElement>(".sos-voice")!.disabled).toBe(false);
  } finally { await act(async()=>{stageRoot.unmount();}); stageHost.remove(); }
});
it("hides the voice entry when the tier does not carry Live Conversation",async()=>{
  fixture.tierAllows=false;
  await render("?onboarding=1");
  expect(host.querySelector(".sos-voice")).toBeNull();
  expect(host.querySelector(".sos-progress--link")).not.toBeNull();
});
it("re-enters an unfinished onboarding into the caller's own interview thread",async()=>{
  fixture.rpc.mockImplementation(async(name:string)=>({data:
    name==="latest_solo_business_interview_thread" ? {threadId:id,phase:"active",checkpointUpdatedAt:"2026-10-22T00:00:00Z"}
    : name==="get_solo_business_interview_checkpoint" ? {tenantId:fixture.tenant,threadId:id,phase:"active",nextField:"industry",sourceTurnId:"44444444-4444-4444-8444-444444444444",sourceTurnSeq:1,checkpointUpdatedAt:"2026-10-22T00:00:00Z",contextRevisionAtCheckpoint:null}
    : name==="get_solo_business_context" ? {tenantId:fixture.tenant,accessScope:"owner_full"} : null,error:null}));
  await render("?onboarding=1");
  await act(async()=>{ await Promise.resolve(); });
  // The lookup adopted the SAME verified deep-link path: the URL now carries the thread.
  expect(host.querySelector("[data-route]")?.textContent).toBe("/solo/10001/paige/chat?onboarding=1&interviewThread="+id);
  await act(async()=>{ await Promise.resolve(); await Promise.resolve(); });
  // Verification passed through the existing machinery and the chat adopted the thread.
  expect(fixture.renders).toContain(id);
  expect(host.textContent).not.toContain("could not be verified");
});
it("a completed setup retires first-run presentation even through a stale ?onboarding=1 link",async()=>{
  fixture.features={solo_setup_complete:true};
  fixture.rpc.mockImplementation(async(name:string)=>({data:name==="latest_solo_business_interview_thread"?null:name==="get_solo_business_context"?{tenantId:fixture.tenant,accessScope:"owner_full"}:null,error:null}));
  await render("?onboarding=1");
  await act(async()=>{ await Promise.resolve(); });
  expect(host.querySelector(".sos")).toBeNull();
  expect(host.querySelector(".sos-voice")).toBeNull();
  expect(host.textContent).not.toContain("Your business interview");
  expect(host.querySelector("[data-context]")?.getAttribute("data-context")).not.toBe("solo_business_interview");
  // The URL stops claiming a first-run state the workspace has outgrown.
  expect(host.querySelector("[data-route]")?.textContent).toBe("/solo/10001/paige/chat");
});
it("does not auto-open customer onboarding for Platform Operator entry",async()=>{fixture.staff=true;await render();expect(host.querySelector("[data-context]")).toBeNull();expect(host.textContent).not.toContain("Meet PAIGE.");});
it("holds transcript selection until caller-owned interview and canonical tenant resolve",async()=>{let finish!: (value: unknown)=>void;fixture.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await render("?interviewThread="+id);expect(host.querySelector("[data-chat]")).toBeNull();expect(host.textContent).toContain("Opening the owned interview");await act(async()=>{finish({data:null,error:null});});expect(fixture.rpc.mock.calls.slice(0,2).map(([name])=>name)).toEqual(["get_solo_business_interview_checkpoint","get_solo_business_context"]);expect(host.querySelector("[data-thread]")?.getAttribute("data-thread")).toBe(id);});
it("never selects an unverified thread when canonical owner scope differs",async()=>{fixture.rpc.mockImplementation(async(name:string)=>({data:name==="get_solo_business_context"?{tenantId:"test-tenant-b",accessScope:"owner_full"}:null,error:null}));await render("?interviewThread="+id);expect(fixture.renders).not.toContain(id);expect(host.textContent).toContain("could not be verified for this workspace");});
it("suppresses stale return readback after tenant switch",async()=>{let finish!: (value:unknown)=>void;fixture.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await render("?interviewThread="+id);fixture.tenant="test-tenant-b";fixture.rpc.mockResolvedValue({data:null,error:{code:"42501"}});await render("?interviewThread="+id);await act(async()=>{finish({data:null,error:null});});expect(fixture.renders).not.toContain(id);expect(host.textContent).toContain("could not be verified");});
it("maps unknown and reconciliation to actual held and working states",async()=>{fixture.context.saveOutcomeUnknown=true;fixture.context.reconcileSave=vi.fn();await render();expect(host.querySelector("[data-presence]")?.getAttribute("data-presence")).toBe("held");expect(host.textContent).toContain("Last verified: 1");fixture.context.reconciling=true;await render();expect(host.querySelector("[data-presence]")?.getAttribute("data-presence")).toBe("working");expect(host.textContent).toContain("Checking the saved Setup record");});

it.each(["get_solo_business_interview_checkpoint","get_solo_business_context"])("bounds hung %s and ignores a late verification result",async hung=>{vi.useFakeTimers();let finish!:(value:unknown)=>void;fixture.rpc.mockImplementation(async(name:string)=>name===hung?await new Promise(resolve=>{finish=resolve;}):{data:null,error:null});await render("?interviewThread="+id);expect(host.querySelector("[data-chat]")).toBeNull();await act(async()=>{await vi.advanceTimersByTimeAsync(30001);});expect(host.textContent).toContain("could not be verified");expect(host.querySelector("[data-chat]")).not.toBeNull();await act(async()=>{finish({data:hung==="get_solo_business_context"?{tenantId:fixture.tenant,accessScope:"owner_full"}:null,error:null});});expect(fixture.renders).not.toContain(id);if(hung==="get_solo_business_interview_checkpoint")expect(fixture.rpc).toHaveBeenCalledTimes(1);});
it("offers history exit during pending verification and suppresses cancelled completion",async()=>{let finish!:(value:unknown)=>void;fixture.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await render("?onboarding=1&interviewThread="+id);await act(async()=>{[...host.querySelectorAll("button")].find(b=>b.textContent==="Back to conversation history")!.click();});expect(host.querySelector("[data-route]")?.textContent).toBe("/solo/10001/paige/chat?onboarding=1");await act(async()=>{finish({data:null,error:null});});expect(fixture.renders).not.toContain(id);});
it("retries a failed owner verification through the same existing reads",async()=>{fixture.rpc.mockResolvedValueOnce({data:null,error:{code:"42501"}});await render("?interviewThread="+id);expect(fixture.renders).not.toContain(id);await act(async()=>{[...host.querySelectorAll("button")].find(b=>b.textContent==="Retry interview verification")!.click();});expect(host.querySelector("[data-thread]")?.getAttribute("data-thread")).toBe(id);});
