import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({actor:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",rpc:vi.fn(),invoke:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:h.rpc,functions:{invoke:h.invoke}}}));
vi.mock("@/hooks/useTenantContext",()=>({useTenantContext:()=>({activeUserId:h.actor,activeTenantId:"11111111-1111-4111-8111-111111111111",loading:false,accountContextLoading:false})}));
import { PublishPiece } from "./publish-piece";
const tenant="11111111-1111-4111-8111-111111111111",publication="33333333-3333-4333-8333-333333333333";
const piece={id:"22222222-2222-4222-8222-222222222222",kind:"text",channel:"social_post",status:"draft",title:"Original saved post",body:"Exact saved caption",image_url:null,size:null,brief:null,updated_at:"2026-11-13T12:00:00Z"};
let host:HTMLDivElement,root:Root;
const recorded=vi.fn();
beforeEach(()=>{h.actor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";vi.spyOn(Date,"now").mockReturnValue(Date.parse("2027-01-01T00:00Z"));host=document.createElement("div");document.body.append(host);root=createRoot(host);recorded.mockReset();h.invoke.mockReset();h.rpc.mockImplementation(async name=>({data:name==="get_social_presence_evidence"?[{tenant_id:tenant,network:"threads",status:"on_record",handle:"fixture",connection_status:"connected",connection_profiles:1}]:[],error:null}));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function render(){await act(async()=>root.render(<PublishPiece piece={piece} tenantId={tenant} captionReadOnly onPublicationRecorded={recorded}/>));}
async function click(label:string){await act(async()=>{const button=[...host.querySelectorAll("button")].find(b=>b.textContent?.trim()===label);if(!button)throw Error(`Missing ${label}`);button.click();});}
async function input(element:HTMLInputElement|HTMLTextAreaElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});}
function answer(body:Record<string,unknown>){return {data:{state:"approval_required",approval:{fingerprint:"0123456789abcdef",summary:"Exact future post and destination",expires_at:"2099-01-01T00:00:00Z"},preview:{piece_id:piece.id,content_revision:piece.updated_at,piece_title:piece.title,platform:"threads",channel_label:"Original connected destination",caption:piece.body,schedule:body.schedule}},error:null};}
it("reviews and sends only the exact schedule through the original post approval",async()=>{
 h.invoke.mockImplementation(async(_,options)=>options.body.approved_fingerprint?{data:{ok:true,state:"scheduled",publication_id:publication,schedule:options.body.schedule},error:null}:answer(options.body));
 await render();await click("ThreadsConnected");await click("Schedule for later");
 const fields=host.querySelectorAll("fieldset input");await input(fields[1] as HTMLInputElement,"UTC");await input(fields[0] as HTMLInputElement,"2027-01-02T10:00");
 await click("Review schedule");expect(h.invoke).toHaveBeenCalledTimes(1);expect(host.textContent).toContain("Original connected destination");expect(host.textContent).toContain("2027-01-02 10:00 UTC");
 await click("Approve this schedule once");expect(h.invoke.mock.calls[1][1].body).toMatchObject({action:"publish",approved_fingerprint:"0123456789abcdef",expected_content_revision:piece.updated_at,schedule:{scheduled_for:"2027-01-02T10:00:00.000Z",timezone:"UTC",civil_time:"2027-01-02T10:00",offset_minutes:0,disambiguation:"unique"}});
 expect(host.textContent).toContain("Publication has not been confirmed");expect(recorded).toHaveBeenCalledExactlyOnceWith(publication);
});
it.each(["omitted","changed"] as const)("refuses a requested future post when the original approval time is %s",async variant=>{
 h.invoke.mockImplementation(async(_,options)=>{
  const reply=answer(options.body);
  if(variant==="omitted")delete reply.data.preview.schedule;
  else reply.data.preview.schedule={...options.body.schedule,scheduled_for:"2027-01-02T11:00:00.000Z",civil_time:"2027-01-02T11:00"};
  return reply;
 });
 await render();await click("ThreadsConnected");await click("Schedule for later");
 const fields=host.querySelectorAll("fieldset input");await input(fields[1] as HTMLInputElement,"UTC");await input(fields[0] as HTMLInputElement,"2027-01-02T10:00");
 await click("Review schedule");
 expect(host.textContent).toContain("did not match the requested publishing time");
 expect([...host.querySelectorAll("button")].some(b=>/^Approve/.test(b.textContent??""))).toBe(false);
 expect(h.invoke).toHaveBeenCalledTimes(1);expect(recorded).not.toHaveBeenCalled();
});
it("requires an explicit DST-fold occurrence instead of selecting one silently",async()=>{
 await render();await click("ThreadsConnected");await click("Schedule for later");const fields=host.querySelectorAll("fieldset input");
 await input(fields[1] as HTMLInputElement,"America/New_York");await input(fields[0] as HTMLInputElement,"2027-11-07T01:30");
 const review=()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="Review schedule")!;
 expect(review().disabled).toBe(true);expect(host.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0);
 await act(async()=>{(host.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).click();});
 expect(review().disabled).toBe(false);h.invoke.mockImplementation(async(_,options)=>answer(options.body));await click("Review schedule");
 expect(h.invoke.mock.calls[0][1].body.schedule).toMatchObject({scheduled_for:"2027-11-07T06:30:00.000Z",disambiguation:"later",offset_minutes:-300});
});
it("clears the original approval view when its actor changes and ignores the late response",async()=>{
 let resolve!:(value:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(answer=>{resolve=answer;}));await render();await click("ThreadsConnected");await click("Prepare to publish");
 h.actor="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";await render();await act(async()=>resolve(answer({})));
 expect(host.textContent).not.toContain("Original connected destination");expect(host.textContent).not.toContain("Approve and post once");expect(recorded).not.toHaveBeenCalled();
});
const originalSchedule={scheduled_for:"2027-01-02T10:00:00.000Z",timezone:"UTC",civil_time:"2027-01-02T10:00",offset_minutes:0,disambiguation:"unique"};
async function renderScheduledAttempt(){
 const row={id:publication,platform:"threads",status:"scheduled",request_args:{channel_label:"Original connected destination",schedule:JSON.stringify(originalSchedule)},provider_response:{schedule:{current:originalSchedule,version:3}},created_at:"2026-12-01T00:00Z"};
 h.rpc.mockImplementation(async name=>({data:name==="content_publication_list"?[row]:[],error:null}));
 await act(async()=>root.render(<PublishPiece tenantId={tenant} originalAttempt={{contentId:piece.id,publicationId:publication}} onPublicationRecorded={recorded}/>));
}
function changeAnswer(operation:string,schedule:unknown){const reply=answer({schedule});Object.assign(reply.data.preview,{operation,publication_id:publication,publication_version:3});return reply;}
async function renderLegacyWithSchedules(){
 const second="44444444-4444-4444-8444-444444444444";
 const rows=[{id:publication,platform:"facebook",status:"scheduled",request_args:{channel_label:"First destination",schedule:JSON.stringify(originalSchedule)},provider_response:{schedule:{current:originalSchedule,version:3}},created_at:"2026-12-01T00:00Z"},
  {id:second,platform:"threads",status:"scheduled",request_args:{channel_label:"Second destination",schedule:JSON.stringify(originalSchedule)},provider_response:{schedule:{current:originalSchedule,version:7}},created_at:"2026-12-02T00:00Z"}];
 h.rpc.mockImplementation(async name=>({data:name==="content_publication_list"?rows:[{tenant_id:tenant,network:"threads",status:"on_record",handle:"fixture",connection_status:"connected",connection_profiles:1}],error:null}));
 await act(async()=>root.render(<PublishPiece piece={piece} tenantId={tenant}/>));
 return second;
}
async function manageSecondSchedule(){await act(async()=>{const row=[...host.querySelectorAll("li")].find(e=>e.textContent?.includes("Second destination"));const button=[...row!.querySelectorAll("button")].find(e=>e.textContent==="Manage this schedule");if(!button)throw Error("Missing original schedule management from Content");button.click();});}
it.each(["reschedule","cancel_schedule"] as const)("manages only the selected original %s from the actual legacy Content caller",async operation=>{
 const second=await renderLegacyWithSchedules();
 h.invoke.mockImplementation(async(_,options)=>{
  const body=options.body,scheduled=body.schedule??originalSchedule;
  if(body.approved_fingerprint)return {data:{state:operation==="cancel_schedule"?"cancelled":"scheduled",publication_id:second,schedule:scheduled},error:null};
  const reply=answer({schedule:scheduled});Object.assign(reply.data.preview,{operation,publication_id:second,publication_version:7});return reply;
 });
 await manageSecondSchedule();expect(host.textContent).not.toContain("First destination");expect(host.textContent).toContain("Second destination");
 if(operation==="reschedule"){
  await click("Change scheduled time");const fields=host.querySelectorAll("fieldset input");await input(fields[1] as HTMLInputElement,"UTC");await input(fields[0] as HTMLInputElement,"2027-01-03T10:00");await click("Review new time");
 }else await click("Review cancellation");
 await click(operation==="reschedule"?"Approve this schedule once":"Approve stopping this schedule");
 expect(h.invoke).toHaveBeenCalledTimes(2);expect(h.invoke.mock.calls[1][1].body).toMatchObject({action:operation,publication_id:second,publication_version:7,approved_fingerprint:"0123456789abcdef",schedule:{scheduled_for:operation==="reschedule"?"2027-01-03T10:00:00.000Z":originalSchedule.scheduled_for}});
});
it("returns from an original schedule to the same Content caption without a provider call",async()=>{
 await renderLegacyWithSchedules();await click("ThreadsConnected");await input(host.querySelector("textarea")!,"Keep this pending caption");
 await manageSecondSchedule();await click("Back to this post");
 expect(host.querySelector("textarea")?.value).toBe("Keep this pending caption");expect(h.invoke).not.toHaveBeenCalled();
});
it("refuses an unexpected future approval for an immediate post",async()=>{
 h.invoke.mockImplementation(async()=>answer({schedule:originalSchedule}));
 await render();await click("ThreadsConnected");await click("Prepare to publish");
 expect(host.textContent).toContain("did not match the requested publishing time");
 expect([...host.querySelectorAll("button")].some(b=>/^Approve/.test(b.textContent??""))).toBe(false);
 expect(h.invoke).toHaveBeenCalledTimes(1);expect(recorded).not.toHaveBeenCalled();
});
it.each(["operation","time","publication","version"] as const)("refuses a cancellation approval that changes the original %s",async variant=>{
 h.invoke.mockImplementation(async()=>{
  const reply=changeAnswer("cancel_schedule",originalSchedule),preview=reply.data.preview as Record<string,unknown>;
  if(variant==="operation")delete preview.operation;
  if(variant==="time")delete preview.schedule;
  if(variant==="publication")preview.publication_id="44444444-4444-4444-8444-444444444444";
  if(variant==="version")preview.publication_version=4;
  return reply;
 });
 await renderScheduledAttempt();await click("Review cancellation");
 expect(host.textContent).toContain("did not match this original schedule change");
 expect([...host.querySelectorAll("button")].some(b=>/^Approve/.test(b.textContent??""))).toBe(false);
 expect(h.invoke).toHaveBeenCalledTimes(1);expect(recorded).not.toHaveBeenCalled();
});
it("retains a matching original cancellation through its one existing approval",async()=>{
 h.invoke.mockImplementation(async(_,options)=>options.body.approved_fingerprint?{data:{state:"cancelled",publication_id:publication,schedule:originalSchedule},error:null}:changeAnswer("cancel_schedule",originalSchedule));
 await renderScheduledAttempt();await click("Review cancellation");await click("Approve stopping this schedule");
 expect(h.invoke.mock.calls[1][1].body).toMatchObject({action:"cancel_schedule",publication_id:publication,publication_version:3,schedule:originalSchedule,approved_fingerprint:"0123456789abcdef"});
 expect(recorded).toHaveBeenCalledExactlyOnceWith(publication);
});
it("retains a matching new time on the same original publication/version",async()=>{
 h.invoke.mockImplementation(async(_,options)=>options.body.approved_fingerprint?{data:{state:"scheduled",publication_id:publication,schedule:options.body.schedule},error:null}:changeAnswer("reschedule",options.body.schedule));
 await renderScheduledAttempt();await click("Change scheduled time");const fields=host.querySelectorAll("fieldset input");
 await input(fields[1] as HTMLInputElement,"UTC");await input(fields[0] as HTMLInputElement,"2027-01-03T10:00");await click("Review new time");await click("Approve this schedule once");
 expect(h.invoke.mock.calls[1][1].body).toMatchObject({action:"reschedule",publication_id:publication,publication_version:3,approved_fingerprint:"0123456789abcdef",schedule:{scheduled_for:"2027-01-03T10:00:00.000Z"}});
 expect(recorded).toHaveBeenCalledExactlyOnceWith(publication);
});
it("keeps an explicitly selected old stopped receipt beyond five newer terminal attempts",async()=>{
 const schedule={scheduled_for:"2027-01-02T10:00:00.000Z",timezone:"UTC",civil_time:"2027-01-02T10:00",offset_minutes:0,disambiguation:"unique"};
 const old={id:publication,platform:"threads",status:"cancelled",request_args:{channel_label:"ORIGINAL_STOPPED",schedule:JSON.stringify(schedule)},provider_response:{schedule:{current:schedule,version:1}},created_at:"2026-01-01T00:00Z"};
 h.rpc.mockImplementation(async name=>({data:name==="content_publication_list"?[...Array.from({length:6},(_,i)=>({...old,id:`new-${i}`,status:"published",request_args:{channel_label:"Newer terminal"}})),old]:[],error:null}));
 await act(async()=>root.render(<PublishPiece tenantId={tenant} originalAttempt={{contentId:piece.id,publicationId:publication}}/>));
 expect(host.textContent).toContain("ORIGINAL_STOPPED");expect(host.textContent).toContain("2027-01-02 10:00 UTC");expect([...host.querySelectorAll("button")].some(b=>b.textContent==="Check this attempt")).toBe(true);expect(host.textContent).not.toContain("Newer terminal");
});
