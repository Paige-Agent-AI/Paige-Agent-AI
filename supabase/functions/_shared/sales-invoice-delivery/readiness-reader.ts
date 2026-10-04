interface ReadinessResult {data:unknown;error:unknown}
interface ReadinessQuery extends PromiseLike<ReadinessResult> {eq(column:string,value:unknown):ReadinessQuery;maybeSingle():PromiseLike<ReadinessResult>}
export interface InvoiceReadinessAdmin {from(table:string):{select(columns:string):ReadinessQuery}}
import { runPreSend } from '../pre-send-pipeline.ts';
import type { SupabaseAdminLike } from '../twilio.ts';
import { invoiceDeliveryReadiness,type InvoiceDeliveryReadiness } from './readiness.ts';
type ObjectValue=Record<string,unknown>;
const object=(v:unknown):ObjectValue=>v&&typeof v==='object'&&!Array.isArray(v)?v as ObjectValue:{};
/** Caller must resolve authenticated actor/current tenant/admin first; this reads only safe setup metadata. */
export async function readInvoiceDeliveryReadiness(admin:InvoiceReadinessAdmin,input:{tenantId:string;invoice:unknown;channel:'email'|'sms'|'imessage';connectorId:string|null},env:(key:string)=>string|undefined):Promise<InvoiceDeliveryReadiness> {
 if(input.channel==='imessage')return invoiceDeliveryReadiness({channel:'imessage',tenantMatches:true,recipient:null,resendConfigured:false,googleConfigured:false});
 const row=object(input.invoice),snapshot=object(object(row.document).snapshot),tenantMatches=row.tenant_id===input.tenantId;
 const recipient=snapshot[input.channel==='email'?'recipient_email':'recipient_phone'];
 const facts={channel:input.channel,tenantMatches,recipient:typeof recipient==='string'?recipient:null,resendConfigured:!!env('RESEND_API_KEY'),googleConfigured:!!env('GOOGLE_OAUTH_CLIENT_ID')&&!!env('GOOGLE_OAUTH_CLIENT_SECRET')};
 if(!tenantMatches)return invoiceDeliveryReadiness(facts);
 if(typeof snapshot.client_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshot.client_id))return {eligible:false,state:'unavailable',reason:'INVOICE_CLIENT_UNVERIFIED',provider_execution_verified:false};
 try {
  let sender;
  let sms;
  if(input.channel==='email') {
   if(!input.connectorId)return invoiceDeliveryReadiness(facts);
   const {data,error}=await admin.from('channel_connectors').select('tenant_id,active,status,provider,from_address,credentials_vault_ref,config').eq('tenant_id',input.tenantId).eq('id',input.connectorId).eq('channel_type','email').maybeSingle();
   if(error)throw Error('setup_read_failed');const c=object(data),config=object(c.config);
   sender={tenantMatches:c.tenant_id===input.tenantId,active:c.active===true&&c.status==='active',provider:String(c.provider??''),fromAddress:typeof c.from_address==='string'?c.from_address:null,credentialReferencePresent:typeof c.credentials_vault_ref==='string'&&!!c.credentials_vault_ref,smtpConfigured:typeof config.host==='string'&&Number.isInteger(config.port)};
  }else {
   const [account,numbers,a2p]=await Promise.all([admin.from('tenant_twilio_subaccounts').select('subaccount_sid,api_key_sid,auth_token_vault_ref').eq('tenant_id',input.tenantId).maybeSingle(),admin.from('tenant_phone_numbers').select('phone_number,capabilities').eq('tenant_id',input.tenantId).eq('status','active'),admin.from('tenant_a2p_registrations').select('status').eq('tenant_id',input.tenantId).maybeSingle()]);
   if(account.error||numbers.error||a2p.error)throw Error('setup_read_failed');const a=object(account.data);
   sms={credentialsPresent:['subaccount_sid','api_key_sid','auth_token_vault_ref'].every(k=>typeof a[k]==='string'&&!!a[k]),numberPresent:Array.isArray(numbers.data)&&numbers.data.some(n=>{const r=object(n);return typeof r.phone_number==='string'&&(object(r.capabilities).sms===undefined||object(r.capabilities).sms===true)}),a2pApproved:object(a2p.data).status==='approved'};
  }
  const setup=invoiceDeliveryReadiness({...facts,sender,sms});
  if(setup.state==='needs_setup')return setup;
  const preSend=await runPreSend(admin as unknown as SupabaseAdminLike,{tenantId:input.tenantId,channel:input.channel,to:facts.recipient??'',contactId:typeof snapshot.client_id==='string'?snapshot.client_id:null});
  return invoiceDeliveryReadiness({...facts,sender,sms,preSend});
 }catch{return {eligible:false,state:'unavailable',reason:'DELIVERY_READINESS_UNVERIFIED',provider_execution_verified:false};}
}
