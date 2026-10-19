import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeadReplyDrafts } from "./LeadReplyDrafts";
import {parseFollowupLocator,canReplaceFollowupDraft} from "./useLeadReplyReview";
import { ComposeThreadDialog } from "./ComposeThreadDialog";
vi.mock("@/components/paige/CustomerSelector",()=>({CustomerSelector:()=>null}));

const db=vi.hoisted(()=>({items:[] as Record<string,unknown>[],filters:[] as unknown[][],read:vi.fn(),role:vi.fn(),invoke:vi.fn(),getUser:vi.fn(),auth:new Set<(event:string)=>void>()}));
vi.mock("@/hooks/usePendingApprovals",()=>({usePendingApprovals:()=>({items:db.items,error:null,refresh:vi.fn()})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getUser:db.getUser,onAuthStateChange:(cb:(event:string)=>void)=>{db.auth.add(cb);return{data:{subscription:{unsubscribe:()=>db.auth.delete(cb)}}};}},rpc:db.role,functions:{invoke:db.invoke},from:(table:string)=>{
  db.filters.push(["table",table]);const q:Record<string,unknown>={};
  for(const method of ["select","eq","order","limit"])q[method]=(...args:unknown[])=>{db.filters.push([method,...args]);return q;};
  q.then=(done:(value:unknown)=>unknown,fail:(reason:unknown)=>unknown)=>db.read(table).then(done,fail);
  q.single=q.maybeSingle=()=>db.read(table);return q;
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
beforeEach(async()=>{db.items=[pending()];db.filters=[];db.read.mockReset().mockResolvedValue({data:[],error:null});db.getUser.mockReset().mockResolvedValue({data:{user:{id:"actor"}},error:null});db.role.mockReset().mockImplementation(async(name:string)=>({data:name==="current_user_tenant_id"?tenant:true,error:null}));db.invoke.mockReset();edit.mockReset();props={actorId:"actor",tenantId:tenant,contactId:contact,disabled:false,onEdit:edit};host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

const legacyComposer = () => ({ok:true,draft:{subject:"Your inquiry",body_text:"Hello <Dana>, thanks for asking.",body_html:"<p>Different untrusted HTML</p>"},recipient:{email:"untrusted@example.test"},summary:"Untrusted composer summary"});
describe("historical composer draft compatibility",()=>{
  it("opens the original nested plain-text draft for review without addressing or sending from composer output",async()=>{
    const original={...pending(),category:"client.followup",draft_content:legacyComposer()};db.items=[original];
    await render();expect(editButton()).toBeTruthy();expect(host.textContent).not.toContain("untrusted@example.test");expect(host.textContent).not.toContain("Different untrusted HTML");
    await act(async()=>{editButton()!.click();await flush();});
    expect(edit).toHaveBeenCalledWith(original,{subject:"Your inquiry",body:"Hello <Dana>, thanks for asking."});expect(db.invoke).not.toHaveBeenCalled();
  });
  it("reuses the canonical HTML-to-text projection for an older HTML-only result",async()=>{
    db.items=[{...pending(),category:"owner.followup_email",draft_content:{ok:true,draft:{subject:"Your inquiry",body_html:"<script>hidden()</script><p>Thanks &lt;Dana&gt;.</p>"}}}];
    await render();expect(editButton()).toBeTruthy();await act(async()=>{editButton()!.click();await flush();});
    expect(edit.mock.calls[0][1]).toEqual({subject:"Your inquiry",body:"Thanks <Dana>."});expect(host.querySelector("script")).toBeNull();expect(db.invoke).not.toHaveBeenCalled();
  });
  it.each([
    ["failed composer",{ok:false,draft:{subject:"Your inquiry",body_text:"Text"}}],
    ["unconfirmed composer",{draft:{subject:"Your inquiry",body_text:"Text"}}],
    ["non-email outer channel",{...legacyComposer(),channel:"sms"}],
    ["non-email nested channel",{ok:true,draft:{channel:"sms",subject:"Your inquiry",body_text:"Text"}}],
    ["competing subject",{...legacyComposer(),subject:"Ambiguous competing subject"}],
    ["competing body",{...legacyComposer(),body:"Ambiguous competing text"}],
    ["empty body",{ok:true,draft:{subject:"Your inquiry",body_text:""}}],
    ["oversized body",{ok:true,draft:{subject:"Your inquiry",body_text:"x".repeat(10001)}}],
    ["array draft",{ok:true,draft:[{subject:"Your inquiry",body_text:"Text"}]}],
  ])("keeps unsupported or ambiguous historical content unavailable: %s",async(_label,draft_content)=>{
    db.items=[{...pending(),category:"client.followup",draft_content}];await render();expect(editButton()).toBeUndefined();expect(host.textContent).toContain("No complete email draft");expect(edit).not.toHaveBeenCalled();expect(db.invoke).not.toHaveBeenCalled();
  });
  it("does not turn a historical unknown operation into a fresh editable draft",async()=>{
    db.items=[{...pending(),category:"client.followup",draft_content:legacyComposer(),metadata:{governed_send:{operation_id:operation,state:"unknown"}}}];
    await render();expect(editButton()).toBeUndefined();expect(host.textContent).toContain("Don't resend");expect(edit).not.toHaveBeenCalled();expect(db.invoke).not.toHaveBeenCalled();
  });
  it("keeps the same owner/member authority boundary for a readable historical draft",async()=>{
    db.items=[{...pending(),category:"client.followup",draft_content:legacyComposer()}];db.role.mockImplementation(async(name:string)=>({data:name==="current_user_tenant_id"?tenant:false,error:null}));
    await render();expect(editButton()).toBeUndefined();expect(host.textContent).toContain("An owner or admin");expect(edit).not.toHaveBeenCalled();expect(db.invoke).not.toHaveBeenCalled();
  });
});

function persistedReply(category="client.followup"){
  const actor="88888888-8888-4888-8888-888888888888",connector="33333333-3333-4333-8333-333333333333",action="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",fp="abcdef0123456789",threadKey=`contact:${tenant}:${contact}`;
  const ap={...pending(),category,metadata:{action_id:action}},act={id:action,tenant_id:tenant,contact_id:contact,approval_id:approval,action_kind:category};
  const command={action:"comms.email_send",contact_id:contact,connector_id:connector,subject:"Your inquiry",body:"Thanks for asking."};
  const binding={operation_id:operation,tenant_id:tenant,actor_user_id:actor,contact_id:contact,connector_id:connector,recipient:"lead@example.test",from_address:"hello@business.example",subject:command.subject,body_text:command.body,body_html:"<p>Thanks for asking.</p>",content_digest:"a".repeat(64),command,governance:{actor_user_id:actor,tenant_id:tenant,tool:"comms_send_email",action:"comms.email_send",approval_channel:"operator_card",approved_fingerprint:fp,decision_receipt_recorded:true,approval_id:approval},state:"provider_accepted",provider_message_id:"receipt",approval_id:approval,origin_action_id:action,origin_action_kind:category};
  const message=row({thread_key:threadKey,connector_id:connector,sender:{address:binding.from_address},recipients:[{address:binding.recipient}],subject:command.subject,body_text:command.body,body_html:binding.body_html,send_actor_id:actor,comms_email_state:"provider_accepted",status:"sent",provider_message_id:"receipt",original_binding:binding});
  db.items=[ap];db.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});db.read.mockImplementation(async(table:string)=>({data:table==="messages"?[message]:table==="paige_actions"?[act]:[ap],error:null}));db.role.mockImplementation(async(name:string)=>({data:name==="current_user_tenant_id"?tenant:name==="is_tenant_admin"?true:{ok:true,state:"provider_accepted",approval_id:approval,operation_id:operation,message_id:message.id,delivery_confirmed:false},error:null}));
  return {ap,act,message,binding,actor,threadKey,fp};
}
describe("the reloaded canonical original record",()=>{
  it("record eligibility cannot unlock fresh edit while fresh-send remains disabled",async()=>{await render({disabled:true,recordDisabled:false});expect(editButton()?.disabled).toBe(true);await act(async()=>editButton()!.click());expect(edit).not.toHaveBeenCalled();expect(db.invoke).not.toHaveBeenCalled();});
  it("omitting recordDisabled retains the incumbent disabled gate",async()=>{const value=persistedReply();await render({actorId:value.actor,threadKey:value.threadKey,disabled:true});expect([...host.querySelectorAll('button')].filter(b=>/Finish recording reply|Check sending status/.test(b.textContent??'')).every(b=>b.disabled)).toBe(true);expect(db.invoke).not.toHaveBeenCalled();});
  it("a governed fresh-send hold permits only separately eligible historical recording",async()=>{const value=persistedReply();await render({actorId:value.actor,threadKey:value.threadKey,disabled:true,recordDisabled:false});expect(editButton()).toBeUndefined();const finish=[...host.querySelectorAll('button')].find(b=>b.textContent==="Finish recording reply");expect(finish?.disabled).toBe(false);await act(async()=>{finish!.click();await flush();});expect(db.role).toHaveBeenCalledWith("lead_reply_record_send",{_approval_id:approval,_operation_id:operation});expect(db.invoke).not.toHaveBeenCalled();});
  it("a genuine record hold disables historical recording and status without changing original identity",async()=>{const value=persistedReply();await render({actorId:value.actor,threadKey:value.threadKey,disabled:false,recordDisabled:true});const buttons=[...host.querySelectorAll('button')];expect(buttons.find(b=>b.textContent==="Finish recording reply")?.disabled).toBe(true);expect(buttons.find(b=>b.textContent==="Check sending status")?.disabled).toBe(true);await render({recordDisabled:false});expect([...host.querySelectorAll('button')].find(b=>b.textContent==="Finish recording reply")?.disabled).toBe(false);expect(host.textContent).toContain("Thanks for asking.");expect(db.invoke).not.toHaveBeenCalled();});
  it("a cited original operation missing from Messages never becomes a fresh editable reply",async()=>{db.items=[{...pending(),metadata:{governed_send:{operation_id:operation,message_id:"55555555-5555-4555-8555-555555555555",state:"provider_accepted"}}}];await render();expect(editButton()).toBeUndefined();expect(host.textContent).toContain("Don't resend");expect(db.invoke).not.toHaveBeenCalled();});
  it.each(["failed","refused"])("a cited original with a proven %s receipt preserves deliberate fresh review",async state=>{db.items=[{...pending(),metadata:{governed_send:{operation_id:operation,state:"unknown"}}}];db.read.mockResolvedValue({data:[row({comms_email_state:state,status:state==="failed"?"failed":"blocked"})],error:null});await render();expect(editButton()).toBeTruthy();expect(db.invoke).not.toHaveBeenCalled();});
  it.each(["owner.lead_followup","client.followup","owner.followup_email"])("reopens %s and explicitly records only its persisted accepted operation",async kind=>{
    const value=persistedReply(kind);await render({actorId:value.actor,threadKey:value.threadKey} as Partial<typeof props>);expect(editButton()).toBeUndefined();expect(host.textContent).toContain("Finish recording reply");expect(host.textContent).not.toContain(value.fp);
    await act(async()=>root.unmount());root=createRoot(host);await render();const button=[...host.querySelectorAll('button')].find(b=>b.textContent==="Finish recording reply");expect(button).toBeTruthy();expect(db.invoke).not.toHaveBeenCalled();expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);
    await act(async()=>{button!.click();await flush();});expect(db.role).toHaveBeenCalledWith("lead_reply_record_send",{_approval_id:approval,_operation_id:operation});expect(db.invoke).not.toHaveBeenCalled();expect(host.textContent).toContain("recorded");expect(host.textContent).toContain("Delivery is not confirmed");
  });
  it.each([null,undefined,"other-thread"])("absent or mismatched current thread %j remains status-only",async threadKey=>{const value=persistedReply();await render({actorId:value.actor,threadKey} as Partial<typeof props>);expect(host.textContent).not.toContain("Finish recording reply");expect(host.textContent).toContain("Accepted by the email service");expect(db.invoke).not.toHaveBeenCalled();});
  it("never recovers a legacy message lacking protected original governance",async()=>{const value=persistedReply();Reflect.deleteProperty(value.message,"original_binding");await render({actorId:value.actor,threadKey:value.threadKey} as Partial<typeof props>);expect(host.textContent).not.toContain("Finish recording reply");expect(host.textContent).toContain("Approval recording is still unconfirmed");expect(db.invoke).not.toHaveBeenCalled();});
  it("a duplicate or truncated accepted history cannot expose record continuation",async()=>{const value=persistedReply();db.read.mockImplementation(async table=>({data:table==="messages"?[value.message,value.message]:table==="paige_actions"?[value.act]:[value.ap],error:null}));await render({actorId:value.actor,threadKey:value.threadKey} as Partial<typeof props>);expect(host.textContent).not.toContain("Finish recording reply");expect(editButton()).toBeUndefined();expect(db.invoke).not.toHaveBeenCalled();});
  it("a current actor refresh retires the old recovered control before its native call",async()=>{const value=persistedReply();await render({actorId:value.actor,threadKey:value.threadKey} as Partial<typeof props>);const old=[...host.querySelectorAll('button')].find(b=>b.textContent==="Finish recording reply");expect(old).toBeTruthy();await act(async()=>{for(const listener of db.auth)listener("SIGNED_OUT");old!.click();await flush();});expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);expect(db.invoke).not.toHaveBeenCalled();});
});

describe("returning to the same lead reply",()=>{
  it("revalidates the same actor after token refresh without permanently hiding the original draft",async()=>{
    await render();expect(editButton()).toBeTruthy();
    await act(async()=>{for(const listener of db.auth)listener("TOKEN_REFRESHED");await flush();});
    expect(editButton()).toBeTruthy();expect(host.textContent).not.toContain("Your account changed");expect(db.getUser.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it("a refreshed foreign auth result cannot enable the old actor draft",async()=>{
    await render();db.getUser.mockResolvedValue({data:{user:{id:"foreign"}},error:null});
    await act(async()=>{for(const listener of db.auth)listener("TOKEN_REFRESHED");await flush();});expect(editButton()).toBeUndefined();expect(edit).not.toHaveBeenCalled();
  });
  it("signout synchronously retires an old edit frame until fresh sign-in validation",async()=>{
    await render();const old=editButton()!;expect(old).toBeTruthy();
    await act(async()=>{for(const listener of db.auth)listener("SIGNED_OUT");old.click();await flush();});expect(edit).not.toHaveBeenCalled();expect(host.textContent).toContain("Your account changed");
    await act(async()=>{for(const listener of db.auth)listener("SIGNED_IN");await flush();});expect(editButton()).toBeTruthy();
  });
  it.each(["client.followup","owner.followup_email"])("offers the existing exact review for native-supported %s",async category=>{db.items=[{...pending(),category}];await render();expect(editButton()).toBeTruthy();await act(async()=>editButton()!.click());expect(edit.mock.calls[0][0].id).toBe(approval);expect(db.invoke).not.toHaveBeenCalled();});
  it("never substitutes a different approval on the same contact for an exact locator",async()=>{await render({approvalId:"77777777-7777-4777-8777-777777777777"} as Partial<typeof props>);expect(editButton()).toBeUndefined();expect(host.textContent).toMatch(/unavailable|checking/i);expect(edit).not.toHaveBeenCalled();});
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

describe("exact follow-up entry and dirty draft boundary",()=>{
  it("leaves ordinary contact navigation unbound",()=>{expect(parseFollowupLocator(new URLSearchParams(`contact=${contact}`))).toEqual({kind:"none"});});
  it("accepts only one exact contact and approval",()=>{expect(parseFollowupLocator(new URLSearchParams(`contact=${contact}&approval=${approval}`))).toEqual({kind:"bound",contactId:contact,approvalId:approval});});
  it.each([`approval=${approval}`,`contact=${contact}&approval=`,`contact=${contact}&approval=null`,`contact=${contact}&approval=not-a-uuid`,`contact=other&approval=${approval}`,`contact=${contact}&approval=${approval}&approval=${approval}`,`contact=${contact}&contact=${contact}&approval=${approval}`])("does not drop an invalid present locator into ordinary send: %s",search=>{expect(parseFollowupLocator(new URLSearchParams(search))).toEqual({kind:"invalid"});});
  const empty={subject:"",body:"",attachmentCount:0,scheduledFor:null,editingDraftId:null,approvalId:null,pending:false};
  it("permits a deliberate selection only into an empty composer",()=>{expect(canReplaceFollowupDraft(empty)).toBe(true);});
  it.each([{subject:"Subject only"},{body:"Words"},{attachmentCount:1},{scheduledFor:"2026-12-01T00:00:00Z"},{editingDraftId:"draft"},{approvalId:approval},{pending:true}])("holds existing words or original work %j",dirty=>{expect(canReplaceFollowupDraft({...empty,...dirty})).toBe(false);});
});

describe("the existing no-thread conversation composer",()=>{
  const actor="88888888-8888-4888-8888-888888888888",connector="33333333-3333-4333-8333-333333333333";
  const closed=vi.fn(),sent=vi.fn(),hold=vi.fn();
  function mount(approvalId:string=approval,over:Partial<Parameters<typeof ComposeThreadDialog>[0]>={}){return act(async()=>{root.render(<ComposeThreadDialog open actorId={actor} tenantId={tenant} approvalId={approvalId} initialContact={{id:contact}}
    activeConnectors={[{id:connector,channel_type:"email",display_name:"Business email",from_address:"hello@business.example"}]} onOpenChange={closed} onSent={sent} onHoldChange={hold} {...over}/>);await flush();});}
  const action=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button=>button.textContent?.trim()===text);
  async function press(text:string){expect(action(text)).toBeTruthy();await act(async()=>{action(text)!.click();await flush();});}
  function ports(category="client.followup"){
    closed.mockReset();sent.mockReset();hold.mockReset();db.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});
    db.read.mockImplementation(async(table:string)=>({data:table==="clients"?{id:contact,tenant_id:tenant,first_name:"Neutral",last_name:"Contact",client_contact_methods:[{id:"email",kind:"email",value:"lead@example.test",label:null,is_primary:true,position:0}]}:
      table==="profiles"?{full_name:"Reviewer"}:table==="paige_approval_queue_v"?[{...pending(),category}]:[],error:null}));
    db.invoke.mockImplementation(async(_name:string,options:{body:Record<string,unknown>})=>({data:{ok:false,outcome:"approval_required",operation_id:options.body.operation_id,fingerprint:"abcdef0123456789",summary:"Email this contact",expires_at:new Date(Date.now()+60000).toISOString(),preview:{kind:"email",to_address:"lead@example.test",from_address:"hello@business.example",subject:"Your inquiry",body_text:"Thanks for asking."}},error:null}));
  }
  function recoveredPorts(){ports();const ordinary=db.read.getMockImplementation()!;const value=persistedReply();const original=db.read.getMockImplementation()!;db.read.mockImplementation(table=>["clients","profiles"].includes(table)?ordinary(table):original(table));return value;}
  it.each(["loading","accountContextLoading","accountContextStatus:not-ready"])("historical dialog held click cannot record during %s",async()=>{recoveredPorts();await mount(approval,{isSolo:true,recordDisabled:true});await press("Finish recording reply");expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);expect(db.invoke).not.toHaveBeenCalled();});
  it.each(["loading","accountContextLoading","accountContextStatus:not-ready"])("historical dialog readiness holds and restores the same original for %s",async gate=>{recoveredPorts();await mount(approval,{isSolo:true});expect(action("Finish recording reply")?.disabled).toBe(false);await mount(approval,{isSolo:true,recordDisabled:true});expect(action("Finish recording reply")?.disabled,gate).toBe(true);expect(action("Check sending status")?.disabled,gate).toBe(true);await press("Finish recording reply");expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);await mount(approval,{isSolo:true,recordDisabled:false});expect(action("Finish recording reply")?.disabled).toBe(false);await press("Finish recording reply");expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send").map(([,args])=>args)).toEqual([{_approval_id:approval,_operation_id:operation}]);expect(db.invoke).not.toHaveBeenCalled();});
  it.each(["loading","accountContextLoading","accountContextStatus:not-ready"].flatMap(gate=>["actor-read","tenant-read"].map(read=>({gate,read}))))("historical dialog readiness $gate during $read retires its old request without stranding the original",async({read})=>{recoveredPorts();await mount(approval,{isSolo:true});let finish!:(v:unknown)=>void;if(read==="actor-read")db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));else db.role.mockReturnValueOnce(new Promise(done=>{finish=done;}));await act(async()=>{action("Finish recording reply")!.click();for(let i=0;i<8;i++)await Promise.resolve();});await mount(approval,{isSolo:true,recordDisabled:true});await mount(approval,{isSolo:true,recordDisabled:false});await act(async()=>{finish(read==="actor-read"?{data:{user:{id:actor}},error:null}:{data:tenant,error:null});await flush();});expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);expect(action("Finish recording reply")?.disabled).toBe(false);await press("Finish recording reply");expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send").map(([,args])=>args)).toEqual([{_approval_id:approval,_operation_id:operation}]);expect(db.invoke).not.toHaveBeenCalled();});
  it("historical dialog readiness holds legacy status without enabling record or sender",async()=>{const value=recoveredPorts();Reflect.deleteProperty(value.binding.governance,"approved_fingerprint");await mount(approval,{isSolo:true,recordDisabled:true});expect(action("Finish recording reply")).toBeUndefined();expect(action("Check sending status")?.disabled).toBe(true);await mount(approval,{isSolo:true,recordDisabled:false});expect(action("Check sending status")?.disabled).toBe(false);expect(action("Finish recording reply")).toBeUndefined();expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);expect(db.invoke).not.toHaveBeenCalled();});
  it.each(["owner.lead_followup","client.followup","owner.followup_email"])("the actual SOLO dialog supplies the native thread for reloaded %s recording only",async kind=>{const value=recoveredPorts();value.ap.category=kind;value.act.action_kind=kind;value.binding.origin_action_kind=kind;await mount(approval,{isSolo:true});expect(action("Finish recording reply")?.disabled).toBe(false);expect(action("Edit and review reply")).toBeUndefined();await press("Finish recording reply");expect(db.role).toHaveBeenCalledWith("lead_reply_record_send",{_approval_id:approval,_operation_id:operation});expect(db.invoke).not.toHaveBeenCalled();expect(document.body.textContent).toContain("The original accepted reply is recorded");});
  it.each([undefined,false])("non-SOLO/default %j dialog never enables persisted recording",async isSolo=>{recoveredPorts();await mount(approval,{isSolo});expect(action("Finish recording reply")).toBeUndefined();expect(action("Check sending status")).toBeTruthy();expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);expect(db.invoke).not.toHaveBeenCalled();});
  it("the actual dialog keeps a conflicted original locator held",async()=>{recoveredPorts();await mount(approval,{isSolo:true,locatorConflicted:true});expect(action("Finish recording reply")?.disabled).toBe(true);expect(action("Check sending status")?.disabled).toBe(true);await press("Finish recording reply");expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);expect(db.invoke).not.toHaveBeenCalled();});
  it.each(["locator","closed","non-SOLO-aba"])("the actual dialog retires a pending record request on %s",async kind=>{recoveredPorts();await mount(approval,{isSolo:true});let finish!:(v:unknown)=>void;db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));await act(async()=>{action("Finish recording reply")!.click();for(let i=0;i<8;i++)await Promise.resolve();});if(kind==="locator")await mount(approval,{isSolo:true,locatorConflicted:true});if(kind==="closed")await mount(approval,{isSolo:true,open:false});if(kind==="non-SOLO-aba"){await mount(approval,{isSolo:false});await mount(approval,{isSolo:true});}await act(async()=>{finish({data:{user:{id:actor}},error:null});await flush();});expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);expect(db.invoke).not.toHaveBeenCalled();});
  it.each(["thread","actor","tenant","role","client"])("the actual SOLO dialog refuses recovered foreign or unavailable %s",async kind=>{const value=recoveredPorts();if(kind==="thread")Object.assign(value.message,{thread_key:"other-thread"});if(kind==="actor")db.getUser.mockResolvedValue({data:{user:{id:contact}},error:null});if(kind==="tenant"||kind==="role")db.role.mockImplementation(async name=>({data:name==="current_user_tenant_id"?(kind==="tenant"?contact:tenant):false,error:null}));if(kind==="client"){const read=db.read.getMockImplementation()!;db.read.mockImplementation(table=>table==="clients"?Promise.resolve({data:{id:approval,tenant_id:tenant},error:null}):read(table));}await mount(approval,{isSolo:true});expect(action("Finish recording reply")?.disabled??true).toBe(true);expect(db.role.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);expect(db.invoke).not.toHaveBeenCalled();});
  it.each(["owner.lead_followup","client.followup","owner.followup_email"])("reviews exact %s without creating an empty thread or using ordinary Send",async category=>{
    ports(category);await mount();await press("Edit and review reply");await press("Review reply");
    expect(db.invoke).toHaveBeenCalledTimes(1);const call=db.invoke.mock.calls[0][1].body;
    expect(db.invoke.mock.calls[0][0]).toBe("comms-email-command");expect(call.approval_id).toBe(approval);expect(call.command).toEqual({action:"comms.email_send",contact_id:contact,connector_id:connector,subject:"Your inquiry",body:"Thanks for asking."});
    expect(db.filters.some(f=>f[0]==="insert"||f[0]==="update")).toBe(false);expect(hold).toHaveBeenCalledWith(true);
    db.invoke.mockResolvedValueOnce({data:{ok:true,outcome:"provider_accepted",operation_id:call.operation_id,approval_id:approval,provider_receipt_available:true,message_id:"99999999-9999-4999-8999-999999999999",delivery_confirmed:false,record_status:"recorded"},error:null});await press("Approve");
    expect(db.invoke.mock.calls[1][1].body).toEqual({...call,approved_fingerprint:"abcdef0123456789"});expect(sent).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Delivery is not confirmed");expect(closed).not.toHaveBeenCalled();
  });
  it("cannot use ordinary Send when the selected PPA is unavailable",async()=>{ports();await mount("77777777-7777-4777-8777-777777777777");expect(document.body.textContent).toContain("No replacement was selected");expect(action("Edit and review reply")).toBeUndefined();expect(action("Review reply")?.disabled).toBe(true);expect(db.invoke).not.toHaveBeenCalled();});
  it("retains an unknown original execution on Cancel or Escape",async()=>{ports();await mount();await press("Edit and review reply");await press("Review reply");db.invoke.mockRejectedValueOnce(new Error("lost ACK"));await press("Approve");await act(async()=>{document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await flush();});expect(action("Cancel reply edit")?.disabled).toBe(true);expect(closed).not.toHaveBeenCalled();expect(document.body.textContent).toContain("Don't resend");expect(db.invoke).toHaveBeenCalledTimes(2);});
  it("registers its bound words and unknown attempt with the existing unload guard",async()=>{ports();await mount();await press("Edit and review reply");
    const edited=new Event("beforeunload",{cancelable:true});window.dispatchEvent(edited);expect(edited.defaultPrevented).toBe(true);
    await press("Review reply");db.invoke.mockRejectedValueOnce(new Error("lost ACK"));await press("Approve");
    const unknown=new Event("beforeunload",{cancelable:true});window.dispatchEvent(unknown);expect(unknown.defaultPrevented).toBe(true);expect(closed).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="Subject"]')?.disabled).toBe(true);
  });
});
