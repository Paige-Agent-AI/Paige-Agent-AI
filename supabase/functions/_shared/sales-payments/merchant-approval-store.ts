import type {MerchantTool} from './merchant-admission.ts';
import {confirmFingerprint} from '../confirm-fingerprint.ts';
type Reply={data:unknown;error:unknown};
export interface MerchantApprovalResult extends PromiseLike<Reply>{maybeSingle():PromiseLike<Reply>;}
export interface MerchantApprovalQuery extends MerchantApprovalResult{
 select(columns:string):MerchantApprovalResult;
 eq(column:string,value:unknown):MerchantApprovalQuery;is(column:string,value:null):MerchantApprovalQuery;not(column:string,operator:string,value:null):MerchantApprovalQuery;
 neq(column:string,value:string):MerchantApprovalQuery;gt(column:string,value:string):MerchantApprovalQuery;lte(column:string,value:string):MerchantApprovalQuery;
 contains(column:string,value:Record<string,unknown>):MerchantApprovalQuery;order(column:string,options:{ascending:boolean}):MerchantApprovalQuery;limit(count:number):MerchantApprovalQuery;
}
export interface MerchantApprovalDatabase{from(table:string):{
 select(columns:string):MerchantApprovalQuery;update(values:Record<string,unknown>):MerchantApprovalQuery;insert(values:Record<string,unknown>):MerchantApprovalQuery;
};}
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
/** Existing one-gate store only. No approval token, new table or model-authored claim. */
export function merchantApprovalStore(db:MerchantApprovalDatabase,actor:string,tenant:string,requestNonce:string,now:()=>string){
 const scoped=(q:MerchantApprovalQuery,tool:MerchantTool)=>q.eq('user_id',actor).eq('tenant_id',tenant).eq('tool_name',tool).is('thread_id',null).is('scoped_client_id',null).is('consumed_at',null).not('server_issued_at','is',null).not('issued_in_request','is',null);
 return {
  async find(tool:MerchantTool,operation:string){
   const result=await scoped(db.from('paige_pending_confirmations').select('args'),tool).contains('args',{operation_id:operation}).gt('expires_at',now()).order('server_issued_at',{ascending:false}).limit(2);
   if(result.error)throw Error('APPROVAL_STORE_UNAVAILABLE');
   if(!Array.isArray(result.data)||result.data.length>1)throw Error('APPROVAL_STORE_UNAVAILABLE');
   return object(object(result.data[0])?.args);
  },
  async claim(tool:MerchantTool,fingerprint:string){
   const result=await scoped(db.from('paige_pending_confirmations').update({consumed_at:now()}),tool).eq('fingerprint',fingerprint).neq('issued_in_request',requestNonce).gt('expires_at',now()).select('args').maybeSingle();
   if(result.error)return null;
   return object(object(result.data)?.args);
  },
  async issue(tool:MerchantTool,fingerprint:string,args:Record<string,unknown>,summary:string){
   const timestamp=now();
   const expired=await scoped(db.from('paige_pending_confirmations').update({consumed_at:timestamp}),tool).eq('fingerprint',fingerprint).lte('expires_at',timestamp);
   if(expired.error)throw Error('APPROVAL_STORE_UNAVAILABLE');
   const result=await db.from('paige_pending_confirmations').insert({user_id:actor,tenant_id:tenant,thread_id:null,scoped_client_id:null,tool_name:tool,fingerprint,issued_in_request:requestNonce,server_issued_at:timestamp,args,summary,expires_at:new Date(Date.parse(timestamp)+600000).toISOString()}).select('expires_at').maybeSingle();
   if(result.error){
    if(object(result.error)?.code!=='23505')throw Error('APPROVAL_STORE_UNAVAILABLE');
    const existing=await scoped(db.from('paige_pending_confirmations').select('expires_at,args'),tool).eq('fingerprint',fingerprint).gt('expires_at',now()).maybeSingle();
    const row=object(existing.data);
    const savedArgs=object(row?.args);
    if(existing.error||!row||!savedArgs||await confirmFingerprint(tool,savedArgs)!==fingerprint||typeof row.expires_at!=='string')throw Error('APPROVAL_STORE_UNAVAILABLE');
    return {expires_at:row.expires_at};
   }
   const row=object(result.data);if(!row||typeof row.expires_at!=='string')throw Error('APPROVAL_STORE_UNAVAILABLE');
   return {expires_at:row.expires_at};
  },
 };
}
