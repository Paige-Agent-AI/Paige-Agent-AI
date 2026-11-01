// @vitest-environment node
import {describe,it,expect,vi} from "vitest";
import {saveOriginalEmailDraft} from "../../supabase/functions/comms-email-command/save-draft";
import {parseCommsEmailActionDraftSource} from "../../supabase/functions/_shared/comms-email/draft-source";
import type {CommsEmailAdmin} from "../../supabase/functions/_shared/comms-email/readiness";
import type {LeadReplyApprovalAdmin} from "../../supabase/functions/comms-email-command/lead-reply-approval";
import type {CommsEmailStorage} from "../../supabase/functions/_shared/comms-email/attachments";
const id=(n:number)=>`${n}0000000-0000-4000-8000-000000000001`;
const tenant=id(1),contact=id(2),connector=id(3),message=id(4),operation=id(5),actor=id(7),approval=id(8),action=id(9);
const updated_at="2026-10-31T20:00:00.123456+00:00";
const input={tenantId:tenant,actorUserId:actor,operationId:operation,actionSource:{approval_id:approval,updated_at},approvalId:approval,
 command:{action:"comms.email_send" as const,contact_id:contact,connector_id:connector,subject:"Saved follow-up",body:"Edited unsent words."}};
function ports(change?:{status?:string;kind?:string;personal?:boolean;current?:boolean;rpc?:unknown}){
 const reads:{table:string;columns:string}[]=[];
 const rpc=vi.fn(async()=>({data:change?.rpc??{ok:true,outcome:"draft_saved",message_id:message,updated_at,receipt_id:operation,replayed:false},error:null}));
 const from=(table:string)=>({select:(columns:string)=>{
  reads.push({table,columns});
  const result=()=>({data:table==="paige_pending_approvals"?{id:approval,tenant_id:tenant,contact_id:contact,status:change?.status??"pending",metadata:{action_id:action}}:
   table==="paige_actions"?{id:action,tenant_id:tenant,approval_id:approval,contact_id:contact,action_kind:change?.kind??"owner.followup_email",status:"pending_approval"}:
   table==="messages"?[]:table==="clients"?{id:contact,tenant_id:tenant,first_name:"Client",client_contact_methods:[{kind:"email",value:"client@tests.invalid",is_primary:true}]}:
   {id:connector,tenant_id:tenant,active:true,status:"active",mailbox_class:change?.personal?"personal":"shared_support",mailbox_owner_user_id:change?.personal?id(6):null,from_address:"business@tests.invalid"},error:null});
  const query={eq:()=>query,limit:async()=>result(),maybeSingle:async()=>result()};return query;
 }});
 const admin={from,rpc} as unknown as CommsEmailAdmin&LeadReplyApprovalAdmin;
 const storage={} as CommsEmailStorage;
 return{rpc,reads,d:{admin,caller:admin,storage,stillCurrent:async()=>change?.current!==false}};
}
describe("original action's first unsent save",()=>{
 it("keeps the approval's raw microsecond version and refuses guessed or widened navigation claims",()=>{
  expect(parseCommsEmailActionDraftSource(input.actionSource)).toEqual(input.actionSource);
  for(const value of [null,{},[],{...input.actionSource,tenant_id:tenant},{...input.actionSource,updated_at:"yesterday"},{message_id:message,updated_at}])expect(()=>parseCommsEmailActionDraftSource(value)).toThrow();
 });
 it("uses only the existing native save writer, with original approval/version and no Messages source invented by the caller",async()=>{
  const p=ports();const result=await saveOriginalEmailDraft({...input,attachments:[]},p.d);
  expect(result).toMatchObject({ok:true,outcome:"draft_saved",draft_source:{message_id:message,updated_at}});
  expect(p.rpc).toHaveBeenCalledExactlyOnceWith("save_comms_email_draft",expect.objectContaining({_actor:actor,_tenant:tenant,_message_id:null,_expected_updated_at:updated_at,_approval:approval,_text:input.command.body,_attachments:[]}));
  expect(p.reads.some(r=>/body_text|draft_content/.test(r.columns))).toBe(false);
 });
 it.each([{status:"approved"},{kind:"comms-draft-reply"},{personal:true},{current:false}])("refuses changed origin, private mailbox or workspace before writing: %j",async change=>{
  const p=ports(change);expect(await saveOriginalEmailDraft(input,p.d)).toMatchObject({ok:false,outcome:"refused"});expect(p.rpc).not.toHaveBeenCalled();
 });
 it("does not accept two sources or another approval for the first save",async()=>{
  const p=ports();
  for(const bad of [{...input,source:{message_id:message,updated_at}},{...input,approvalId:action}])expect(await saveOriginalEmailDraft(bad,p.d)).toMatchObject({ok:false,outcome:"refused"});
  expect(p.rpc).not.toHaveBeenCalled();
 });
 it("retains uncertainty when the native result lacks a valid original save receipt",async()=>{
  const p=ports({rpc:{ok:true,outcome:"draft_saved",message_id:message,updated_at}});
  expect(await saveOriginalEmailDraft(input,p.d)).toMatchObject({ok:false,outcome:"outcome_unknown",operation_id:operation});
 });
});
