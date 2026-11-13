import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { socialScheduleChoices } from "../../supabase/functions/_shared/social-publish-command/schedule";
const h=vi.hoisted(()=>({rpc:vi.fn(),user:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:h.rpc,auth:{getUser:h.user}}}));
import { SocialCalendarProjection, socialCalendarItems } from "./social-calendar-projection";
const tenant="11111111-1111-4111-8111-111111111111",actor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",publication="33333333-3333-4333-8333-333333333333",content="22222222-2222-4222-8222-222222222222";
const schedule=socialScheduleChoices("2027-01-02T10:00","UTC")[0],from=new Date("2027-01-01T00:00Z"),until=new Date("2027-01-08T00:00Z"),account={account_type:"standalone",parent_tenant_id:null,account_number:1234567};
const row=()=>({id:publication,content_id:content,tenant_id:tenant,status:"scheduled",request_args:{content_revision:"2026-11-13T12:00:00Z",schedule:JSON.stringify(schedule),channel_label:"Original destination"},provider_response:{schedule:{current:schedule,version:1}}});
let root:Root,host:HTMLDivElement;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);h.user.mockResolvedValue({data:{user:{id:actor}},error:null});h.rpc.mockImplementation(async name=>({data:name==="is_tenant_admin"?true:[row()],error:null}));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
async function render(){await act(async()=>root.render(<MemoryRouter><SocialCalendarProjection tenantId={tenant} actorId={actor} account={account} from={from} until={until}/></MemoryRouter>));}
async function open(){await act(async()=>{const details=host.querySelector("details")!;details.open=true;details.dispatchEvent(new Event("toggle"));});}
it("stays collapsed with zero reads until requested, then opens only the original Social receipt",async()=>{
 await render();expect(h.rpc).not.toHaveBeenCalled();expect(host.querySelector("details")?.open).toBe(false);await open();
 expect(host.textContent).toContain("Scheduled at provider");expect(host.querySelector("a")?.getAttribute("href")).toBe(`/solo/1234567/growth/social?social_piece=${content}&publication=${publication}`);
 expect(h.rpc.mock.calls.map(c=>c[0])).toEqual(["is_tenant_admin","content_publication_list"]);
 expect(host.textContent).toContain("Appointments and availability stay separate");
});
it("distinguishes a permission refusal or failed source from an empty schedule",async()=>{
 h.rpc.mockResolvedValue({data:false,error:null});await render();await open();expect(host.textContent).toContain("workspace owner and admins");expect(host.textContent).not.toContain("No recorded");expect(h.rpc).toHaveBeenCalledTimes(1);
 await act(async()=>{h.rpc.mockResolvedValue({data:null,error:{message:"unavailable"}});window.dispatchEvent(new Event("focus"));});
 expect(host.textContent).toContain("could not be verified");expect(host.textContent).not.toContain("No recorded");
});
it("discards a closed view's late result and never runs a provider read or booking write",async()=>{
 let answer!:(value:unknown)=>void;h.rpc.mockImplementation(name=>name==="is_tenant_admin"?Promise.resolve({data:true,error:null}):new Promise(resolve=>{answer=resolve;}));
 await render();await open();await act(async()=>{const details=host.querySelector("details")!;details.open=false;details.dispatchEvent(new Event("toggle"));answer({data:[row()],error:null});});
 expect(host.querySelector("a")).toBeNull();expect(h.rpc.mock.calls.every(c=>["is_tenant_admin","content_publication_list"].includes(c[0]))).toBe(true);
});
it("does not expose a source after the authenticated actor changes during its read",async()=>{
 h.user.mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValue({data:{user:{id:"another-actor"}},error:null});await render();await open();
 expect(host.querySelector("a")).toBeNull();expect(host.textContent).toContain("could not be verified");expect(host.textContent).not.toContain("Original destination");
});
it("filters the real range, excludes immediate receipts and refuses a foreign tenant instead of inventing zero",()=>{
 expect(socialCalendarItems(tenant,[row()],from.getTime(),until.getTime())).toHaveLength(1);
 expect(socialCalendarItems(tenant,[row()],until.getTime(),until.getTime()+1)).toHaveLength(0);
 expect(socialCalendarItems(tenant,[{...row(),status:"published"}],from.getTime(),until.getTime())).toHaveLength(0);
 expect(()=>socialCalendarItems(tenant,[{...row(),tenant_id:"foreign"}],0,Infinity)).toThrow();
});
