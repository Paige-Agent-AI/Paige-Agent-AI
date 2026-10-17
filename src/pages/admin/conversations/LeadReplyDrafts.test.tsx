import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeadReplyDrafts } from "./LeadReplyDrafts";

const db=vi.hoisted(()=>({items:[] as Record<string,unknown>[],filters:[] as unknown[][],read:vi.fn(),role:vi.fn(),invoke:vi.fn()}));
vi.mock("@/hooks/usePendingApprovals",()=>({usePendingApprovals:()=>({items:db.items,error:null,refresh:vi.fn()})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:db.role,functions:{invoke:db.invoke},from:(table:string)=>{
  db.filters.push(["table",table]);const q:Record<string,unknown>={};
  for(const method of ["select","eq","order","limit"])q[method]=(...args:unknown[])=>{db.filters.push([method,...args]);return q;};
  q.then=(done:(value:unknown)=>unknown,fail:(reason:unknown)=>unknown)=>db.read().then(done,fail);return q;
}}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const tenant="11111111-1111-4111-8111-111111111111",contact="22222222-2222-4222-8222-222222222222",approval="44444444-4444-4444-8444-444444444444";
const operation="66666666-6666-4666-8666-666666666666";
const pending=()=>({id:approval,tenant_id:tenant,contact_id:contact,status:"pending",category:"owner.lead_followup",draft_content:{channel:"email",subject:"Your inquiry",body:"Thanks for asking."}});
const row=(over:Record<string,unknown>={})=>({id:"55555555-5555-4555-8555-555555555555",tenant_id:tenant,contact_id:contact,lead_reply_approval_id:approval,comms_email_operation:operation,comms_email_state:"unknown",channel_type:"email",direction:"outbound",status:"draft",provider_message_id:null,...over});
let host:HTMLDivElement,root:Root,props:Parameters<typeof LeadReplyDrafts>[0];
const edit=vi.fn();
const flush=async()=>{for(let n=0;n<15;n++)await Promise.resolve();};
async function render(next:Partial<typeof props>={}){props={...props,...next};await act(async()=>{root.render(<LeadReplyDrafts {...props}/>);await flush();});}
const editButton=()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="Edit and review reply");
async function check(){const button=[...host.querySelectorAll("button")].find(b=>b.textContent==="Check sending status");expect(button).toBeTruthy();await act(async()=>{button!.click();await flush();});}
beforeEach(async()=>{db.items=[pending()];db.filters=[];db.read.mockReset().mockResolvedValue({data:[],error:null});db.role.mockReset().mockResolvedValue({data:true,error:null});db.invoke.mockReset();edit.mockReset();props={tenantId:tenant,contactId:contact,disabled:false,onEdit:edit};host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

describe("returning to the same lead reply",()=>{
  it("does not offer fresh editing for a reopened unconfirmed canonical send",async()=>{
    db.read.mockResolvedValue({data:[row()],error:null});await render();
    expect(editButton()).toBeUndefined();expect(host.textContent).toContain("Don't resend");
    expect(db.filters).toContainEqual(["eq","tenant_id",tenant]);expect(db.filters).toContainEqual(["eq","contact_id",contact]);expect(db.filters).toContainEqual(["eq","meta->comms_email_binding->>approval_id",approval]);
    expect(db.invoke).not.toHaveBeenCalled();
  });
  it("keeps a fresh complete draft editable after an empty canonical read",async()=>{await render();expect(editButton()).toBeTruthy();await act(async()=>editButton()!.click());expect(edit).toHaveBeenCalledTimes(1);});
  it.each(["failed","refused"])("permits review after a proven %s attempt",async state=>{db.read.mockResolvedValue({data:[row({comms_email_state:state,status:state==="failed"?"failed":"blocked"})],error:null});await render();expect(editButton()).toBeTruthy();});
  it("never asserts Nothing was sent from an incomplete approval payload",async()=>{db.items=[{...pending(),draft_content:{}}];await render();expect(host.textContent).not.toContain("Nothing was sent");expect(editButton()).toBeUndefined();});
  it.each(["prepared","dispatching"])("keeps a recorded %s operation read-only",async state=>{db.read.mockResolvedValue({data:[row({comms_email_state:state})],error:null});await render();expect(editButton()).toBeUndefined();expect(host.textContent).toContain("recorded sending attempt");});
  it.each(["sent","read","delivered"])("labels accepted %s from its canonical provider receipt",async status=>{db.read.mockResolvedValue({data:[row({comms_email_state:"provider_accepted",status,provider_message_id:"receipt"})],error:null});await render();expect(editButton()).toBeUndefined();expect(host.textContent).toContain(status==="delivered"?"Delivery confirmed":"Delivery is not confirmed");});
  it.each([
    ["foreign tenant",{tenant_id:"foreign"}], ["other contact",{contact_id:"other"}], ["other approval",{lead_reply_approval_id:"other"}],
    ["missing operation",{comms_email_operation:null}], ["malformed operation",{comms_email_operation:"invalid"}], ["missing state",{comms_email_state:null}],
    ["inbound copy",{direction:"inbound"}], ["other channel",{channel_type:"sms"}],
  ])("refuses an unreadable %s binding",async(_name,over)=>{db.read.mockResolvedValue({data:[row(over as Record<string,unknown>)],error:null});await render();expect(editButton()).toBeUndefined();expect(host.textContent).toContain("couldn't be verified");});
  it.each([
    ["error",{data:[],error:{message:"private payload"}}], ["missing rows",{data:null,error:null}], ["missing error envelope",{data:[]}],
    ["non-object row",{data:[null],error:null}], ["truncated history",{data:Array.from({length:21},()=>row()),error:null}],
  ])("does not enable review after a %s read",async(_name,result)=>{db.read.mockResolvedValue(result);await render();expect(editButton()).toBeUndefined();expect(host.textContent).toContain("couldn't be verified");expect(host.textContent).not.toContain("private payload");});
  it("handles a transport rejection without exposing it or enabling review",async()=>{db.read.mockRejectedValue(new Error("private details"));await render();expect(editButton()).toBeUndefined();expect(host.textContent).not.toContain("private details");expect(host.textContent).toContain("couldn't be verified");});
  it("never retries an accepted or contradictory failed receipt",async()=>{db.read.mockResolvedValue({data:[row({comms_email_state:"failed",status:"sent",provider_message_id:"receipt"})],error:null});await render();expect(editButton()).toBeUndefined();expect(host.textContent).toContain("Don't resend");});
  it("refreshes an unknown to accepted using Messages reads only",async()=>{
    db.read.mockResolvedValueOnce({data:[row()],error:null}).mockResolvedValueOnce({data:[row({comms_email_state:"provider_accepted",status:"sent",provider_message_id:"receipt"})],error:null});
    await render();await check();expect(host.textContent).toContain("Accepted by the email service");expect(db.read).toHaveBeenCalledTimes(2);expect(db.invoke).not.toHaveBeenCalled();expect(db.filters.filter(f=>f[0]==="table")).toEqual([["table","messages"],["table","messages"]]);
  });
  it.each(["member","unavailable"])("keeps the %s role from initiating message reads or editing",async kind=>{if(kind==="member")db.role.mockResolvedValue({data:false,error:null});else db.role.mockRejectedValue(new Error("offline"));await render();expect(editButton()).toBeUndefined();expect(db.read).not.toHaveBeenCalled();});
  it("keeps editing unavailable while readback is in flight",async()=>{db.read.mockImplementation(()=>new Promise(()=>{}));await render();expect(editButton()).toBeUndefined();expect(host.textContent).toContain("Checking this reply's recorded status");});
  it("does not paint old A readback after switching A-B-A",async()=>{
    let finish!:(value:unknown)=>void;db.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await render();
    db.items=[];await render({tenantId:"other-tenant"});db.items=[pending()];db.read.mockImplementationOnce(()=>new Promise(()=>{}));await render({tenantId:tenant});
    await act(async()=>{finish({data:[],error:null});await flush();});expect(editButton()).toBeUndefined();expect(host.textContent).toContain("Checking this reply's recorded status");
  });
});
