import {MERCHANT_KIT_BY_TOOL,MERCHANT_TOOL_ACTIONS,MERCHANT_STATUS_READ_CAPABILITY,MERCHANT_REFRESH_READ_CAPABILITY} from './merchant-capability.ts';
import {parseMerchantRequest,MERCHANT_SUMMARIES} from './merchant-command.ts';
import {UUID,FINGERPRINT} from '../sales-invoice-command/contract.ts';
import type {Context,Dependencies,Result} from '../sales-invoice-chat.ts';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const tools=['read_sales_merchant_status','read_sales_merchant_refresh','sales_start_merchant_onboarding','sales_create_merchant_login_link'] as const;
export const SALES_MERCHANT_TOOL_NAMES=new Set<string>(tools);
const writeInput=(declaration:typeof MERCHANT_KIT_BY_TOOL[keyof typeof MERCHANT_KIT_BY_TOOL])=>({type:'object',properties:Object.fromEntries(Object.entries(declaration.input.properties).filter(([k])=>k!=='action')),required:[],additionalProperties:false});
const readDescription='Read this workspace Stripe merchant status through its shared connection door. A status read does not complete human setup.';
const writeDescription='Prepare governed Stripe merchant setup or resume with canonical approval. The human must open Settings / Integrations to complete secure provider setup. Never claim this tool completes login or makes the account ready.';
export const SALES_MERCHANT_TOOLS=[
 {type:'function' as const,function:{name:'read_sales_merchant_status',description:readDescription,parameters:MERCHANT_STATUS_READ_CAPABILITY.input}},
 {type:'function' as const,function:{name:'read_sales_merchant_refresh',description:readDescription,parameters:MERCHANT_REFRESH_READ_CAPABILITY.input}},
 {type:'function' as const,function:{name:'sales_start_merchant_onboarding',description:writeDescription,parameters:writeInput(MERCHANT_KIT_BY_TOOL.sales_start_merchant_onboarding)}},
 {type:'function' as const,function:{name:'sales_create_merchant_login_link',description:writeDescription,parameters:writeInput(MERCHANT_KIT_BY_TOOL.sales_create_merchant_login_link)}},
];
/** Closed status facts only. Hosted URLs, account IDs, free text and credentials never enter Chat. */
export function merchantChatSafeResult(value:unknown,now=Date.now()):Record<string,unknown>{
 if(!object(value))return {};const out:Record<string,unknown>={};
 for(const k of ['connected','can_manage','charges_enabled','payouts_enabled','details_submitted','sales_payment_permission'])if(typeof value[k]==='boolean')out[k]=value[k];
 if(value.provider_environment===null||value.provider_environment==='test'||value.provider_environment==='live')out.provider_environment=value.provider_environment;
 if(value.binding_version===null||(Number.isSafeInteger(value.binding_version)&&Number(value.binding_version)>=0))out.binding_version=value.binding_version;
 if(value.checked_at===null||(typeof value.checked_at==='string'&&/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(value.checked_at)&&Number.isFinite(Date.parse(value.checked_at))))out.checked_at=value.checked_at;
 if(['not_connected','setup_incomplete','restricted','ready','unverified','outcome_unknown'].includes(String(value.state)))out.state=value.state;
 if(['available','customer_action_required','refused','outcome_unknown','unverified'].includes(String(value.outcome)))out.outcome=value.outcome;
 if(value.recovery_reason===null||['ONBOARDING_OUTCOME_UNKNOWN','PROVIDER_ENVIRONMENT_UNVERIFIED','MERCHANT_READBACK_REQUIRED','MERCHANT_SETUP_REQUIRED','MERCHANT_PAYMENTS_RESTRICTED'].includes(String(value.recovery_reason)))out.recovery_reason=value.recovery_reason;
 if(out.state==='ready'){
  const checked=typeof out.checked_at==='string'?Date.parse(out.checked_at):NaN;
  if(out.connected!==true||!['test','live'].includes(String(out.provider_environment))||!Number.isSafeInteger(out.binding_version)||Number(out.binding_version)<1||out.charges_enabled!==true||out.details_submitted!==true||out.sales_payment_permission!==true||!Number.isFinite(checked)||checked>now||now-checked>300000){out.state='unverified';out.recovery_reason='MERCHANT_READBACK_REQUIRED';}
 }
 return out;
}
type Common={operationId:(tenant:string,actor:string,command:unknown,turn:Context['turn'])=>Promise<string>};
/** C4b selection only. The shared domain endpoint remains the sole approval consumer. */
export async function dispatchMerchantChat(ctx:Context,deps:Dependencies,common:Common):Promise<Result>{
 const tokens:string[]=[];let spent:string|undefined,op:string|undefined,attempted=false;
 const refuse=():Result=>({tokens,content:{success:false,error:'Merchant request unavailable in this scope.',note:'Nothing was executed. Ask for a fresh merchant request; do not retry automatically.'}});
 try{
  if(!ctx.tenantId||!UUID.test(ctx.tenantId)||!ctx.userId||!SALES_MERCHANT_TOOL_NAMES.has(ctx.toolName)||!object(ctx.args)||Object.keys(ctx.args).some(k=>k!=='provider')||(ctx.args.provider!==undefined&&ctx.args.provider!=='stripe'))return refuse();
  const action=MERCHANT_TOOL_ACTIONS[ctx.toolName as keyof typeof MERCHANT_TOOL_ACTIONS];
  let command={action,provider:'stripe' as const};const read=action==='merchant.status'||action==='merchant.refresh_status';let fingerprint:string|undefined;
  if(!read&&(ctx.pinned||ctx.approved.size)){
   const approved=ctx.pinned?new Set([ctx.pinned.fingerprint]):ctx.approved;let rows:{fingerprint?:unknown;args?:unknown}[];
   if(ctx.pinned)rows=[{fingerprint:ctx.pinned.fingerprint,args:ctx.pinned.args}];
   else{const reply=await deps.admin.from('paige_pending_confirmations').select('fingerprint,args').eq('tenant_id',ctx.tenantId).eq('user_id',ctx.userId).eq('tool_name',ctx.toolName)
    .in('fingerprint',[...approved].map(t=>t.split(':')[0])).is('thread_id',null).is('scoped_client_id',null).is('consumed_at',null)
    .not('server_issued_at','is',null).not('issued_in_request','is',null).gt('expires_at',new Date().toISOString()).limit(9);
    if(reply.error)return refuse();rows=reply.data??[];}
   for(const row of rows)for(const token of approved)if(token.split(':')[0]===row.fingerprint)tokens.push(token);
   if(rows.length!==1||(!ctx.pinned&&ctx.sameToolCalls!==1))return refuse();const row=rows[0],stored=row.args;
   if(typeof row.fingerprint!=='string'||!FINGERPRINT.test(row.fingerprint)||!approved.has(row.fingerprint)||!object(stored)||stored.expected_tenant_id!==ctx.tenantId||typeof stored.operation_id!=='string'||!UUID.test(stored.operation_id))return refuse();
   const exact=parseMerchantRequest({command:stored.command,operation_id:stored.operation_id,expected_tenant_id:stored.expected_tenant_id});
   if(exact.command.action!==action)return refuse();command=exact.command;op=stored.operation_id;fingerprint=row.fingerprint;
  }
  if(!read&&!op)op=await common.operationId(ctx.tenantId,ctx.userId,command,ctx.turn);
  const body=read?{action:action==='merchant.status'?'status':'refresh_status',expected_tenant_id:ctx.tenantId}:{command,operation_id:op,expected_tenant_id:ctx.tenantId,...(fingerprint?{approved_fingerprint:fingerprint}:{})};
  parseMerchantRequest(body);attempted=true;if(ctx.pinned&&fingerprint)spent=fingerprint;
  const reply=await deps.caller.functions.invoke('tenant-stripe-connect',{body});let data=reply.data;
  if(reply.error){const e=reply.error as {context?:{json?:()=>Promise<unknown>}};if(!e.context?.json)throw Error();data=await e.context.json();}if(!object(data))throw Error();
  const safe=merchantChatSafeResult(data);
  if(data.tenant_id!==ctx.tenantId||typeof safe.state!=='string')return {tokens,spent,content:{success:false,outcome:'outcome_unknown',note:'Merchant readback was not verified in this workspace. Check Integrations; do not retry automatically.'}};
  if(!read&&data.outcome==='approval_required'){
   const preview=data.preview;
   if(data.operation_id!==op||data.capability!==ctx.toolName||typeof data.fingerprint!=='string'||!FINGERPRINT.test(data.fingerprint)||typeof data.expires_at!=='string'||!(Date.parse(data.expires_at)>Date.now())||!['test','live'].includes(String(safe.provider_environment))||!object(preview)||Object.keys(preview).length!==4||Object.keys(preview).some(k=>!['action','provider','environment','binding_version'].includes(k))||preview.action!==command.action||preview.provider!=='stripe'||preview.environment!==safe.provider_environment||preview.binding_version!==safe.binding_version||(preview.binding_version!==null&&(!Number.isSafeInteger(preview.binding_version)||Number(preview.binding_version)<1)))return {tokens,spent,content:{success:false,outcome:'outcome_unknown',note:'Merchant approval readback was not verified. Check Integrations and recover this operation; do not retry automatically.'}};
   return {tokens,spent,content:{success:false,needs_confirm:true,requires_operator_approval:true,confirm_fingerprint:data.fingerprint,confirm_summary:MERCHANT_SUMMARIES[action==='merchant.start_onboarding'?'start_onboarding':'login_link'],note:'Show Needs your OK. Nothing changed yet. Wait for canonical approval.'}};
  }
  return {tokens,spent,content:{...safe,success:data.ok===true,note:read?'Report only the returned merchant status; this does not complete human login or setup.':'Open Settings / Integrations to complete secure provider setup. This response does not establish completed human login or merchant readiness.'}};
 }catch{return {tokens,spent,content:{success:false,outcome:attempted?'outcome_unknown':'needs_input',...(attempted&&op?{operation_id:op}:{}),note:attempted?'No verified merchant outcome. Check Integrations and recover this operation; never retry automatically.':'No merchant command dispatched. Ask for a valid Stripe merchant request.'}};}
}
