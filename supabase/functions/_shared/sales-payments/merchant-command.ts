export const MERCHANT_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MERCHANT_FINGERPRINT=/^[0-9a-f]{16}$/;
export type MerchantAction='status'|'refresh_status'|'start_onboarding'|'login_link';
export type MerchantCommand={action:`merchant.${MerchantAction}`;provider:'stripe'};
export type MerchantRequest={action:MerchantAction;command:MerchantCommand;expected_tenant_id?:string;operation_id?:string;approved_fingerprint?:string;return_url?:string;refresh_url?:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Intent only. Actor, environment, binding, Trust lane and approval evidence are never inputs. */
export function parseMerchantRequest(raw:unknown):MerchantRequest{
 if(!object(raw)||Object.keys(raw).some(k=>!['action','command','expected_tenant_id','operation_id','approved_fingerprint','return_url','refresh_url'].includes(k)))throw new TypeError('MERCHANT_COMMAND_INVALID');
 let action:unknown=raw.action;
 if(raw.command!==undefined){
  if(action!==undefined||!object(raw.command)||Object.keys(raw.command).some(k=>!['action','provider'].includes(k))||raw.command.provider!=='stripe'||typeof raw.command.action!=='string'||!raw.command.action.startsWith('merchant.'))throw new TypeError('MERCHANT_COMMAND_INVALID');
  action=raw.command.action.slice('merchant.'.length);
 }
 if(!['status','refresh_status','start_onboarding','login_link'].includes(String(action)))throw new TypeError('MERCHANT_COMMAND_INVALID');
 for(const key of ['expected_tenant_id','operation_id'])if(raw[key]!==undefined&&(typeof raw[key]!=='string'||!MERCHANT_UUID.test(raw[key])))throw new TypeError('MERCHANT_COMMAND_INVALID');
 if(raw.approved_fingerprint!==undefined&&(typeof raw.approved_fingerprint!=='string'||!MERCHANT_FINGERPRINT.test(raw.approved_fingerprint)))throw new TypeError('MERCHANT_COMMAND_INVALID');
 if(action==='start_onboarding'||action==='login_link'){
  if(raw.expected_tenant_id===undefined||raw.operation_id===undefined)throw new TypeError('MERCHANT_SCOPE_OPERATION_REQUIRED');
 }else if(raw.approved_fingerprint!==undefined||raw.operation_id!==undefined||raw.return_url!==undefined||raw.refresh_url!==undefined)throw new TypeError('MERCHANT_COMMAND_INVALID');
 for(const key of ['return_url','refresh_url'])if(raw[key]!==undefined&&(typeof raw[key]!=='string'||raw[key].length>500))throw new TypeError('MERCHANT_COMMAND_INVALID');
 return {...raw,action,...(typeof raw.expected_tenant_id==='string'?{expected_tenant_id:raw.expected_tenant_id.toLowerCase()}:{}),...(typeof raw.operation_id==='string'?{operation_id:raw.operation_id.toLowerCase()}:{}),command:{action:`merchant.${action}`,provider:'stripe'}} as MerchantRequest;
}
export const MERCHANT_SUMMARIES={start_onboarding:'Open hosted Stripe Express merchant setup for this workspace. This does not connect an existing Stripe account or prove payment readiness.',login_link:'Open a hosted Stripe dashboard link for this workspace merchant. This does not change payment readiness.'} as const;
export type MerchantStage='admission'|'reservation'|'account_create'|'account_recovery'|'binding_persist'|'account_readback'|'hosted_link'|'readback_persist'|'receipt';
/** Closed safe telemetry. A refusal does not release a reservation or authorize redispatch. */
export function classifyMerchantFailure(stage:MerchantStage,error:unknown){
 const value=object(error)?error:{};
 const status=typeof value.statusCode==='number'&&Number.isInteger(value.statusCode)&&value.statusCode>=400&&value.statusCode<=599?value.statusCode:null;
 const type=typeof value.type==='string'?value.type:null;
 const message=error instanceof Error?error.message:null;
 if(message==='WORKSPACE_CHANGED'||message==='BINDING_CHANGED')return {stage,outcome:'refused' as const,code:message,http_status:null};
 const configuration=type==='StripeAuthenticationError'&&status===401||type==='StripePermissionError'&&status===403||type==='StripeInvalidRequestError'&&status===400&&value.code==='account_invalid';
 if(configuration)return {stage,outcome:'refused' as const,code:'PROVIDER_CONFIGURATION_REQUIRED',http_status:status};
 return {stage,outcome:stage==='account_create'||stage==='binding_persist'?'outcome_unknown' as const:'unverified' as const,code:stage==='account_create'||stage==='binding_persist'?'ONBOARDING_OUTCOME_UNKNOWN':'MERCHANT_READBACK_REQUIRED',http_status:status};
}
