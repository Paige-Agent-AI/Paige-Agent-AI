import {decideDeclaredCapability} from '../capability-kit/decision.ts';
import {confirmFingerprint} from '../confirm-fingerprint.ts';
import type {GovernedAudit} from '../paige-spine/governedExecution.ts';
import {MERCHANT_KIT_BY_TOOL} from './merchant-capability.ts';
import {MERCHANT_UUID,MERCHANT_SUMMARIES,parseMerchantRequest,type MerchantRequest} from './merchant-command.ts';
export type MerchantTool=keyof typeof MERCHANT_KIT_BY_TOOL;
export interface MerchantAdmissionContext{actor:string;tenant:string;environment:'test'|'live';provider_configuration:string;binding_version:number|null;merchant_id:string|null;onboarding_id:string|null;return_url:string;refresh_url:string;}
export interface MerchantAdmissionPort{
 /** Real authenticated active-workspace/owner and canonical binding revalidation. */
 scope():Promise<void>;
 lane(tool:MerchantTool):Promise<string>;
 find(tool:MerchantTool,operation:string):Promise<Record<string,unknown>|null>;
 /** Endpoint must atomically consume trusted, earlier, live, actor/tenant/tool scoped row. */
 claim(tool:MerchantTool,fingerprint:string):Promise<Record<string,unknown>|null>;
 issue(tool:MerchantTool,fingerprint:string,args:Record<string,unknown>,summary:string):Promise<{expires_at:string}>;
 audit(audit:GovernedAudit):Promise<boolean>;
}
export type MerchantAdmissionResult={kind:'execute';capability:MerchantTool;args:Record<string,unknown>}|{kind:'refuse';code:string}|{kind:'propose';capability:MerchantTool;fingerprint:string;operation_id:string;summary:string;expires_at:string;preview:{action:string;provider:'stripe';environment:'test'|'live';binding_version:number|null}};
function matches(args:Record<string,unknown>,req:MerchantRequest,ctx:MerchantAdmissionContext):boolean{
 if(Object.keys(args).some(k=>!['command','operation_id','expected_tenant_id','approval_subject','approval_cycle_nonce','merchant_binding'].includes(k)))return false;
 try{const parsed=parseMerchantRequest({command:args.command,operation_id:args.operation_id,expected_tenant_id:args.expected_tenant_id});
  if(parsed.operation_id!==req.operation_id||parsed.expected_tenant_id!==ctx.tenant||JSON.stringify(parsed.command)!==JSON.stringify(req.command)||typeof args.approval_cycle_nonce!=='string'||!MERCHANT_UUID.test(args.approval_cycle_nonce)||args.approval_subject!==`${req.command.action}:${ctx.tenant}`)return false;
 }catch{return false;}
 const binding=args.merchant_binding;if(!binding||typeof binding!=='object'||Array.isArray(binding))return false;
 const actual=binding as Record<string,unknown>;
 return Object.keys(actual).length===Object.keys(ctx).length&&Object.entries(ctx).every(([key,value])=>actual[key]===value);
}
/** Domain adapter, not another approval engine: admission delegates to the shared Kit/Trust gate. */
export async function admitMerchantCommand(req:MerchantRequest,ctx:MerchantAdmissionContext,port:MerchantAdmissionPort):Promise<MerchantAdmissionResult>{
 if((req.action!=='start_onboarding'&&req.action!=='login_link')||!req.operation_id||req.expected_tenant_id!==ctx.tenant)throw new TypeError('MERCHANT_COMMAND_INVALID');
 const tool:MerchantTool=req.action==='start_onboarding'?'sales_start_merchant_onboarding':'sales_create_merchant_login_link';
 await port.scope();const lane=await port.lane(tool);await port.scope();
 let args:Record<string,unknown>,claimed:Record<string,unknown>|null|undefined;
 if(req.approved_fingerprint){
  claimed=await port.claim(tool,req.approved_fingerprint);
  if(!claimed)return {kind:'refuse',code:'APPROVAL_NOT_CLAIMABLE'};
  if(!matches(claimed,req,ctx)||await confirmFingerprint(tool,claimed)!==req.approved_fingerprint)return {kind:'refuse',code:'MERCHANT_APPROVAL_BINDING_CHANGED'};
  args=claimed;
 }else{
  const existing=await port.find(tool,req.operation_id);
  if(existing&&!matches(existing,req,ctx))return {kind:'refuse',code:'MERCHANT_APPROVAL_BINDING_CHANGED'};
  args=existing??{command:req.command,operation_id:req.operation_id,expected_tenant_id:ctx.tenant,approval_subject:`${req.command.action}:${ctx.tenant}`,approval_cycle_nonce:crypto.randomUUID(),merchant_binding:{...ctx}};
 }
 const decision=decideDeclaredCapability(MERCHANT_KIT_BY_TOOL[tool],{
  caller:{authenticated:true,userId:ctx.actor,principal:'person',tenantId:ctx.tenant,tenantSource:'server',door:'other',access:{allowed:true,reason:'Revalidated active workspace owner or admin.'}},
  capability:{id:tool,effect:'mutate',outcomeChannel:'record_capability_run',availability:'needs_approval'},
  approval:{autonomyLane:lane,...(claimed!==undefined?{claimedArgs:claimed,claimedFor:tool}:{})},requestArgs:args,
 });
 if(!await port.audit(decision.audit))return {kind:'refuse',code:'MERCHANT_DECISION_RECEIPT_FAILED'};
 if(decision.kind==='refuse')return {kind:'refuse',code:decision.code};
 await port.scope();
 if(decision.kind==='propose'){
  const fingerprint=await confirmFingerprint(tool,args),summary=MERCHANT_SUMMARIES[req.action];
  const proposal=await port.issue(tool,fingerprint,args,summary);
  return {kind:'propose',capability:tool,fingerprint,operation_id:req.operation_id,summary,expires_at:proposal.expires_at,preview:{action:req.command.action,provider:'stripe',environment:ctx.environment,binding_version:ctx.binding_version}};
 }
 return {kind:'execute',capability:tool,args:decision.args as Record<string,unknown>};
}
