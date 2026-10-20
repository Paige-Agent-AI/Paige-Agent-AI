import {PORTAL_INVITATION_CAPABILITY,PORTAL_INVITATION_TOOL} from '../paige-spine/domains/client_portal.ts';
import {CRM_APPROVAL_CANDIDATE_LIMIT,resolveCrmApprovedFingerprint} from '../crm-command/approval-resolution.ts';
import {stableRunId} from '../capability-record.ts';

const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fingerprint=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{16}$/.test(v);
export const PORTAL_INVITATION_TOOLS=[{type:'function',function:{
 name:"client_portal_invitation_send",
 description:'With the business owner’s approval, invite ONE existing CRM customer to this business’s portal. Resolve the exact contact first; never guess a name or email. The server verifies the saved recipient and shows the existing Needs your OK card before creating access or sending. A prior uncertain invitation is the original operation to recover, never a reason to create a new send. Report provider acceptance separately from delivery, opens and customer acceptance. This is a business-owner tool, never a customer-assistant action.',
 parameters:{type:'object',properties:{...PORTAL_INVITATION_CAPABILITY.input.properties},required:[...PORTAL_INVITATION_CAPABILITY.input.required],additionalProperties:false},
}}]as const;
export const PORTAL_INVITATION_TOOL_NAMES:ReadonlySet<string>=new Set(PORTAL_INVITATION_TOOLS.map(t=>t.function.name));
export type PortalInvitationApprovalQuery={
 eq(key:string,value:unknown):PortalInvitationApprovalQuery;in(key:string,values:string[]):PortalInvitationApprovalQuery;
 is(key:string,value:null):PortalInvitationApprovalQuery;not(key:string,operator:string,value:null):PortalInvitationApprovalQuery;
 gt(key:string,value:string):PortalInvitationApprovalQuery;
 limit(value:number):PromiseLike<{data:{fingerprint?:unknown;args?:unknown}[]|null;error:unknown}>;
};
type Context={tenantId:string|null;userId:string;toolName:string;args:Record<string,unknown>;approved:Set<string>;sameToolCalls:number;
 turn:{thread_id:string|null;user_turn_ordinal:number;user_turn:unknown}};
type Dependencies={admin:{from(name:string):{select(columns:string):PortalInvitationApprovalQuery}};
 caller:{functions:{invoke(name:string,options:{body:Record<string,unknown>}):Promise<{data:unknown;error:unknown}>}}};
type Result={content:Record<string,unknown>;tokens?:string[];spent?:string;refusal?:'ambiguous'|'unclaimable'|'lookup_failed'};
const refused=(reason:'ambiguous'|'unclaimable'|'lookup_failed'):Result=>({refusal:reason,content:{success:false,outcome:'refused',delivery_confirmed:false,note:'The invitation approval could not be verified in this workspace. No new invitation action was started; inspect the original status before asking again.'}});
function canonical(v:unknown):unknown{return Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v}

/** Selection/projection only. The incumbent sender's command is the sole approval consumer/executor. */
export async function dispatchPortalInvitationChat(ctx:Context,deps:Dependencies):Promise<Result>{
 if(ctx.toolName!==PORTAL_INVITATION_TOOL||!uuid(ctx.tenantId)||!uuid(ctx.userId)||!object(ctx.args))return refused('unclaimable');
 const args={...ctx.args};if(typeof args.confirm==='boolean')delete args.confirm;
 if(Object.keys(args).some(k=>k!=='contact_id'))return refused('unclaimable');
 const tokens:string[]=[];let stored:Record<string,unknown>|undefined,selectedFingerprint:string|undefined,spent:string|undefined;
 if(ctx.approved.size){
  try{
   const reply=await deps.admin.from('paige_pending_confirmations').select('fingerprint,args').eq('tenant_id',ctx.tenantId).eq('user_id',ctx.userId).eq('tool_name',PORTAL_INVITATION_TOOL)
    .in('fingerprint',[...ctx.approved].map(t=>t.split(':')[0])).is('thread_id',null).is('scoped_client_id',null).is('consumed_at',null)
    .not('server_issued_at','is',null).not('issued_in_request','is',null).gt('expires_at',new Date().toISOString()).limit(CRM_APPROVAL_CANDIDATE_LIMIT+1);
   if(reply.error||!Array.isArray(reply.data))return refused('lookup_failed');
   for(const row of reply.data)for(const token of ctx.approved)if(token.split(':')[0]===row.fingerprint)tokens.push(token);
   const candidates=reply.data.map(row=>({fingerprint:row.fingerprint,args:object(row.args)&&uuid(row.args.contact_id)?{approval_subject:`${PORTAL_INVITATION_TOOL}:${row.args.contact_id.toLowerCase()}`}:{}}));
   const selected=resolveCrmApprovedFingerprint(candidates,uuid(args.contact_id)?`${PORTAL_INVITATION_TOOL}:${args.contact_id.toLowerCase()}`:'',ctx.sameToolCalls);
   if(selected.kind==='ambiguous')return {...refused('ambiguous'),tokens};
   if(selected.kind==='claim'){
    spent=[...ctx.approved].find(t=>t.split(':')[0]===selected.fingerprint);
    const value=reply.data.find(row=>row.fingerprint===selected.fingerprint)?.args;
    if(!spent||!object(value))return {...refused('unclaimable'),tokens};stored=value;selectedFingerprint=selected.fingerprint;
   }
  }catch{return refused('lookup_failed')}
 }
 let body:Record<string,unknown>;
 try{
  if(stored){
   if(stored.expected_tenant_id!==ctx.tenantId||!uuid(stored.contact_id)||!uuid(stored.operation_id)||!fingerprint(selectedFingerprint))return {...refused('unclaimable'),tokens};
   body={expected_tenant_id:ctx.tenantId,contact_id:stored.contact_id,operation_id:stored.operation_id,approved_fingerprint:selectedFingerprint};
  }else{
   if(!uuid(args.contact_id)||!Number.isSafeInteger(ctx.turn.user_turn_ordinal)||ctx.turn.user_turn_ordinal<1)return refused('unclaimable');
   const operation=await stableRunId([PORTAL_INVITATION_TOOL,ctx.tenantId,ctx.userId,args.contact_id.toLowerCase(),ctx.turn.thread_id??'threadless',String(ctx.turn.user_turn_ordinal),JSON.stringify(canonical(ctx.turn.user_turn))]);
   body={expected_tenant_id:ctx.tenantId,contact_id:args.contact_id.toLowerCase(),operation_id:operation};
  }
  const reply=await deps.caller.functions.invoke('send-portal-invite',{body});let data=reply.data;
  if(reply.error){const error=reply.error as {context?:{json?:()=>Promise<unknown>}};if(!error.context?.json)throw Error('unanswered');data=await error.context.json()}
  if(!object(data))throw Error('unanswered');
  if(data.outcome==='approval_required'){
   if(data.capability!==PORTAL_INVITATION_TOOL||!fingerprint(data.fingerprint)||typeof data.summary!=='string'||!data.summary.trim()||data.summary.length>1200||!uuid(data.operation_id))throw Error('invalid_proposal');
   return {tokens,spent,content:{success:false,needs_confirm:true,requires_operator_approval:true,confirm_fingerprint:data.fingerprint,confirm_summary:data.summary,
    note:'Show the Needs your OK card for the exact saved recipient. This has not sent an email. A recovery can make the original provider request, so do not repeat it without the new approval.'}};
  }
  const safe:Record<string,unknown>={delivery_confirmed:false};
  for(const key of ['operation_id','delivery_operation_id','invitation_id','receipt_id'])if(uuid(data[key]))safe[key]=data[key];
  for(const key of ['replayed','invitation_prepared','rail_recorded'])if(typeof data[key]==='boolean')safe[key]=data[key];
  if(data.ok===true&&data.outcome==='provider_accepted'&&uuid(data.invitation_id)&&uuid(data.receipt_id))return {tokens,spent,content:{...safe,success:true,outcome:'provider_accepted',
   note:`${data.replayed===true?'This is the original recorded result. ':''}The email provider accepted the invitation for sending. Delivery, opens, human reading and customer acceptance are separate; do not claim them.`}};
  if(['refused','held','failed'].includes(String(data.outcome)))return {tokens,spent,content:{...safe,success:false,outcome:data.outcome,
   note:'The email was held or not accepted. An invitation record may already exist; review its original status before another action. Do not switch tools or automatically resend.'}};
  return {tokens,spent,content:{...safe,success:false,outcome:'outcome_unknown',note:'The original invitation outcome is unconfirmed. Do not mint a new invitation or resend. Check its canonical status; effectful recovery requires the existing confirmation gate.'}};
 }catch{return {tokens,spent,content:{success:false,outcome:'outcome_unknown',delivery_confirmed:false,note:'No verified response is available. The original request may have completed. Do not resend or create another invitation; inspect the original status.'}}}
}
