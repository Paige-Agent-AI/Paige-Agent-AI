import { describe, expect, it, vi } from "vitest";
import { readLocatedSavedEmail, savedEmailRow } from "./savedEmailLocator";
import { parseSavedEmailLocator } from "@/solo/team-hub/team-hub-email-links";

const [tenant,actor,message,contact,connector,hub,turn,conversation,source,receipt,operation]=Array.from({length:11},(_,i)=>`${String(i+1).padStart(8,"0")}-1111-4111-8111-111111111111`);
const version="2026-11-03T03:00:00.123456+00:00";
const locator={kind:"bound" as const,contactId:contact,messageId:message,hubMessageId:hub};
const row=()=>({tenant_id:tenant,id:message,contact_id:contact,thread_key:`contact:${tenant}:${contact}`,connector_id:connector,
  channel_type:"email",direction:"outbound",status:"draft",provider_message_id:null,subject:"Saved subject",body_text:"Complete original body",body_html:null,updated_at:version});
const native=()=>({ok:true,id:message,contact_id:contact,thread_key:row().thread_key,channel:"email",direction:"outbound",status:"draft",subject:row().subject,
  saved_email_draft:{source:{message_id:message,updated_at:version},body_text:row().body_text,body_html:null}});
const hubResult=()=>({ok:true,tenant_id:tenant,actor_id:actor,turn_id:turn,conversation_id:conversation,source_message_id:source,message_id:hub,
  draft:{subject:"Original preparation",body:"Original preparation before later Messages edits",contact_id:contact,connector_id:connector,
    result:{message_id:message,updated_at:"2026-11-03T02:00:00.123456+00:00",receipt_id:receipt,operation_id:operation}}});
function ports(){return{current:()=>true,identity:vi.fn(async()=>true),readContent:vi.fn(async()=>({data:native()})),
  readRow:vi.fn(async()=>({data:row()})),readHub:vi.fn(async()=>({data:hubResult()}))};}

describe("original saved email navigation",()=>{
  it("reopens the SAME provider-accepted original message after Save became a send, without an editable source",async()=>{
    const m={...row(),status:"sent",provider_message_id:"provider-result",comms_email_operation:operation,comms_email_state:"provider_accepted"};
    const n={...native(),status:"sent",saved_email_draft:null,body_text:m.body_text,body_truncated:false};
    const p=ports();p.readRow.mockResolvedValue({data:m});p.readContent.mockResolvedValue({data:n} as never);
    expect(await readLocatedSavedEmail(locator,tenant,actor,p)).toEqual(m);
    expect(p.readHub).toHaveBeenCalledWith(hub);expect(p.readContent).toHaveBeenCalledTimes(2);
  });

  it("preserves the current complete original body and raw microsecond source after a later Messages edit",async()=>{
    const p=ports();expect(await readLocatedSavedEmail(locator,tenant,actor,p)).toEqual(row());
    expect(p.readContent).toHaveBeenCalledTimes(2);expect(p.identity).toHaveBeenCalledTimes(2);
    expect(p.readRow).toHaveBeenCalledWith(message);expect(p.readHub).toHaveBeenCalledWith(hub);
  });
  it("reopens uncertain, failed and scheduled ORIGINAL effects as read-only results, never an editable source",async()=>{
    for(const state of ["prepared","dispatching","unknown","failed","refused","blocked"]){
      const m={...row(),comms_email_operation:operation,comms_email_state:state};
      const n={...native(),saved_email_draft:null,body_text:m.body_text,body_truncated:false};
      const p=ports();p.readRow.mockResolvedValue({data:m});p.readContent.mockResolvedValue({data:n} as never);
      expect(await readLocatedSavedEmail(locator,tenant,actor,p)).toEqual(m);
      expect(savedEmailRow(n,m,locator,tenant)).toBeNull();
    }
  });
  it("never turns an unbound, malformed, foreign or mismatched result envelope into a readable source",async()=>{
    const m={...row(),status:"sent",comms_email_operation:operation,comms_email_state:"provider_accepted"};
    const n={...native(),status:"sent",saved_email_draft:null,body_text:m.body_text,body_truncated:false};
    for(const change of [{tenant_id:actor},{id:hub},{contact_id:hub},{connector_id:null},{comms_email_operation:null},
      {comms_email_operation:"not-an-operation"},{comms_email_state:"invented"},{subject:"Other subject"},{body_text:"Other words"},{status:"draft"}]){
      const p=ports();p.readRow.mockResolvedValue({data:{...m,...change}} as never);p.readContent.mockResolvedValue({data:n} as never);
      expect(await readLocatedSavedEmail(locator,tenant,actor,p)).toBeNull();
    }
    const p=ports();p.readRow.mockResolvedValue({data:m});p.readContent.mockResolvedValueOnce({data:n} as never).mockResolvedValueOnce({data:{ok:false}} as never);
    expect(await readLocatedSavedEmail(locator,tenant,actor,p)).toBeNull();
  });
  it("a plain original Messages locator needs mailbox permission without inventing a Hub receipt",async()=>{
    const p=ports();expect(await readLocatedSavedEmail({...locator,hubMessageId:null},tenant,actor,p)).toEqual(row());
    expect(p.readHub).not.toHaveBeenCalled();
  });
  it("refuses wrong actor/workspace, revoked mailbox, moved record and stale source; never falls back to raw rows",async()=>{
    const invalids=[{...native(),ok:false},{...native(),id:source},{...native(),contact_id:source},{...native(),status:"sent"},
      {...native(),saved_email_draft:null},{...native(),saved_email_draft:{...native().saved_email_draft,source:{message_id:message,updated_at:"2026-11-03T03:00:00.123+00:00"}}}];
    for(const n of invalids)expect(savedEmailRow(n,row(),locator,tenant)).toBeNull();
    for(const m of [{...row(),tenant_id:actor},{...row(),contact_id:source},{...row(),body_text:"Newer body"},{...row(),connector_id:null},{...row(),provider_message_id:"accepted"}])
      expect(savedEmailRow(native(),m,locator,tenant)).toBeNull();
    const p=ports();p.identity.mockResolvedValue(false);expect(await readLocatedSavedEmail(locator,tenant,actor,p)).toBeNull();expect(p.readHub).not.toHaveBeenCalled();
  });
  it("refuses a foreign or changed original Hub backlink even when Messages is readable",async()=>{
    for(const change of [{actor_id:tenant},{tenant_id:actor},{message_id:source},{draft:{...hubResult().draft,contact_id:source}},
      {draft:{...hubResult().draft,result:{...hubResult().draft.result,message_id:source}}}]){
      const p=ports();p.readHub.mockResolvedValue({data:{...hubResult(),...change}} as never);
      expect(await readLocatedSavedEmail(locator,tenant,actor,p)).toBeNull();expect(p.readRow).not.toHaveBeenCalled();
    }
  });
  it("rechecks mailbox authority after reading the row and withholds revoked complete text",async()=>{
    const p=ports();p.readContent.mockResolvedValueOnce({data:native()}).mockResolvedValueOnce({data:{ok:false,code:"MAILBOX_INACTIVE"}} as never);
    expect(await readLocatedSavedEmail(locator,tenant,actor,p)).toBeNull();
  });
  it("retires each async continuation after a workspace or actor change, including an A→B→A view epoch",async()=>{
    for(const step of ["identity","readHub","readContent","readRow"] as const){
      const p=ports();let current=true;p.current=()=>current;
      const original=p[step];p[step]=vi.fn(async(...args:never[])=>{const result=await (original as (...a:never[])=>Promise<unknown>)(...args);current=false;return result;}) as never;
      expect(await readLocatedSavedEmail(locator,tenant,actor,p)).toBeNull();
    }
  });
  it("read errors never create a replacement or become permission",async()=>{
    for(const method of ["readHub","readContent","readRow"] as const){const p=ports();p[method].mockRejectedValue(new Error("unavailable"));
      expect(await readLocatedSavedEmail(locator,tenant,actor,p)).toBeNull();}
  });
  it("closes malformed, duplicate, approval/compose-conflicting and partial locators",()=>{
    const query=`contact=${contact}&email_draft=${message}&hub_message=${hub}`;
    expect(parseSavedEmailLocator(new URLSearchParams(query))).toEqual(locator);
    expect(parseSavedEmailLocator(new URLSearchParams())).toEqual({kind:"none"});
    for(const q of [query+`&contact=${contact}`,query+`&email_draft=${message}`,query+`&hub_message=${hub}`,query+"&approval=",query+"&compose=0",
      `hub_message=${hub}`,`contact=${contact}&email_draft=invalid`,`email_draft=${message}`])expect(parseSavedEmailLocator(new URLSearchParams(q))).toEqual({kind:"invalid"});
  });
});
