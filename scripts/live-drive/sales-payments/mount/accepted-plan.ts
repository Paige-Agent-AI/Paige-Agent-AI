// Neutral browser ports for the actual invoice workspace. No backend is contacted.
// Original default/customer render fixtures remain separate and unchanged.
import {acceptedPlanFixture,acceptedPlanFixtureIds as ids} from '../accepted-plan-fixture';
import {paymentRequestReviewSummary} from '../../../../supabase/functions/_shared/sales-payments/request-command';
const query=new URLSearchParams(location.search);
export const acceptedPlanEnabled=query.get('accepted-plan')==='true';
export const acceptedPlanState=query.get('plan-state')??'ready';
const fixture=acceptedPlanEnabled?acceptedPlanFixture():null;
type Session={user:{id:string};access_token:string}|null;
let session:Session=acceptedPlanState==='signed_out'?null:{user:{id:ids.actor},access_token:'synthetic-local-session-not-a-credential'};
const listeners=new Set<(event:string,value:Session)=>void>();
const operations:Array<Record<string,unknown>>=[];
export function expireAcceptedFixtureSession(){session=null;for(const listener of listeners)listener('SIGNED_OUT',null)}
export const acceptedPlanPorts={
 rpc:async(name:string)=>{
  const f=await fixture;if(!f)return{data:null,error:Error('LOCAL_FIXTURE_DISABLED')};
  if(name==='read_sales_invoice')return{data:f.raw,error:null};
  if(name==='list_sales_invoice_senders')return{data:[],error:null};
  if(name==='list_sales_invoice_payment_operations')return{data:{rows:operations},error:null};
  if(name==='read_sales_accepted_invoice_obligations'){
   if(acceptedPlanState==='read_error')return{data:null,error:Error('LOCAL_READ_FAILURE')};
   if(acceptedPlanState==='loading')return new Promise<{data:unknown;error:unknown}>(()=>{});
   const data=structuredClone(f.native);
   if(acceptedPlanState==='allocated'){data.payment_obligations.obligations[0].remaining_minor=0;data.payment_obligations.obligations[1].remaining_minor=10000;}
   if(acceptedPlanState==='stale')data.payment_obligations.invoice_version++;
   if(acceptedPlanState==='held'||acceptedPlanState==='test_evidence')return{data:{...data,payment_obligations:{...data.payment_obligations,state:'held',reason:acceptedPlanState==='held'?'allocation_required':'test_payment_evidence',obligations:[]}},error:null};
   return{data,error:null};
  }
  return{data:null,error:Error('LOCAL_RPC_NOT_IMPLEMENTED')};
 },
 auth:{getSession:async()=>({data:{session}}),onAuthStateChange:(callback:(event:string,value:Session)=>void)=>{listeners.add(callback);return{data:{subscription:{unsubscribe(){listeners.delete(callback)}}}}}},
 functions:{invoke:async(name:string,{body}:{body:{operation_id:string;command:Record<string,unknown>;approved_fingerprint?:string}})=>{
  const output=document.getElementById('e04-last-request');if(output)output.textContent=JSON.stringify(body,null,2);
  const f=await fixture,command=body.command;
  if(!f||name!=='sales-invoice-command'||command.action!=='invoice.payment_request')return{data:{outcome:'refused',message:'Local fixture: this action has no simulated implementation.'},error:null};
  if(acceptedPlanState==='review_refused')return{data:{outcome:'refused',message:'Local fixture: original source requires review.'},error:null};
  const reference=command.obligation_reference as {sequence?:number}|undefined;
  const obligation=f.view.obligations.find(row=>row.reference.sequence===reference?.sequence);
  if(!obligation)return{data:{outcome:'refused',message:'Local fixture: no exact accepted target.'},error:null};
  if(body.approved_fingerprint||operations.some(row=>row.id===body.operation_id)){
   if(!operations.length)operations.push({id:body.operation_id,provider:'stripe',purpose:command.purpose,obligation_reference:obligation.reference,invoice_version:2,amount_minor:obligation.remaining_minor,currency:'usd',state:'outcome_unknown'});
   return{data:{outcome:'outcome_unknown'},error:null};
  }
  const canonical:Record<string,unknown>={...command,issued_snapshot_version:1,client_id:ids.client,amount_minor:obligation.remaining_minor,currency:'usd',merchant_account_id:'acct_synthetic_fixture',merchant_binding_version:1,environment:'test',obligation};
  delete canonical.obligation_reference;
  return{data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:paymentRequestReviewSummary(canonical),preview:{invoice_number:'INV-1042',remaining_cents:350000,client_name:'Synthetic client',client_id:ids.client,invoice_id:ids.invoice,amount_minor:obligation.remaining_minor,currency:'usd',provider:'stripe',merchant_account_id:'acct_synthetic_fixture',environment:'test'}},error:null};
 }},
};

