// Provider-specific retirement on the canonical Twilio HTTP/credential seam.
// Target identities come only from the protected canonical lifecycle operation.
import { twilioRequest, type TwilioCreds } from './twilio.ts';
export type RetirementResult = { state:'verified'; provider_status:'suspended'|'closed' }
 | { state:'blocked'|'unknown'; reason:string };
type Account = { sid?:string; owner_account_sid?:string; status?:string };
export async function retireTwilioSubaccount(
 sid:string, desired:'suspended'|'closed', master:TwilioCreds|null, readOnly=false,
 authorizeWrite:()=>Promise<boolean>=async()=>true,
 resolveCallCreds?:()=>Promise<TwilioCreds|null>,
):Promise<RetirementResult> {
 if(!master)return {state:'blocked',reason:'twilio_management_credentials_unavailable'};
 if(!/^AC[0-9a-f]{32}$/i.test(sid)||sid===master.accountSid)return {state:'blocked',reason:'twilio_parent_or_invalid_identity'};
 const path=`/2010-04-01/Accounts/${sid}.json`;
 // Accounts management requires the parent Auth Token or a Main API key. A Standard
 // API key may be configured for ordinary Comms but will truthfully receive refusal.
 const request=<T>(p:string,method:'GET'|'POST',params:Record<string,string>={})=>
  twilioRequest<T>(master.accountSid,master.authToken,p,method,params,master.apiKeySid,{retryTransient:false,timeoutMs:10000});
 const read=()=>request<Account>(path,'GET');
 const bound=(a:Account|null)=>a?.sid===sid&&a?.owner_account_sid===master.accountSid;
 const satisfies=(a:Account|null)=>bound(a)&&(a?.status===desired||(desired==='suspended'&&a?.status==='closed'));
 // A Main API key can manage Accounts but cannot read child Calls. Reuse the
 // existing server-only tenant Vault resolver after validating parent ownership.
 // Parent Auth Token callers retain Twilio's documented v2010 access behavior.
 let callCreds:TwilioCreds|null|undefined;
 const quiescence=async():Promise<string|null>=>{
  if(callCreds===undefined){
   try{callCreds=master.apiKeySid?await resolveCallCreds?.()??null:master;}
   catch{return 'twilio_call_credentials_unavailable';}
  }
  if(!callCreds)return 'twilio_call_credentials_unavailable';
  if(master.apiKeySid&&callCreds.accountSid!==sid)return 'twilio_call_credential_binding_mismatch';
  for(const status of ['queued','ringing','in-progress']) {
   const calls=await twilioRequest<{calls?:unknown[]}>(callCreds.accountSid,callCreds.authToken,`/2010-04-01/Accounts/${sid}/Calls.json`,'GET',{Status:status,PageSize:'1'},callCreds.apiKeySid,{retryTransient:false,timeoutMs:10000});
   if(!calls.ok&&[401,403].includes(calls.status))return 'twilio_call_access_refused';
   if(!calls.ok||!Array.isArray(calls.data?.calls))return 'twilio_call_quiescence_unverified';
   if(calls.data.calls.length)return 'twilio_calls_in_flight';
  }
  return null;
 };
 const initial=await read();
 if(!initial.ok)return {state:readOnly?'unknown':'blocked',reason:'twilio_account_read_unavailable'};
 if(!bound(initial.data))return {state:'blocked',reason:'twilio_identity_not_owned_by_platform'};
 // Authoritative closure shuts down the child entirely and releases its numbers.
 // Its keys may already be retired; querying Calls again must not prevent recovery.
 if(initial.data!.status==='closed')return {state:'verified',provider_status:'closed'};
 if(satisfies(initial.data)){
  const pending=await quiescence();
  return pending?{state:'unknown',reason:pending}:{state:'verified',provider_status:initial.data!.status as 'suspended'|'closed'};
 }
 if(readOnly)return {state:'unknown',reason:'twilio_retirement_not_verified'};
 if(!['active','suspended'].includes(initial.data!.status??''))return {state:'blocked',reason:'twilio_account_state_unsupported'};
 // Suspension alone does not end current calls. Never hang up a real call as a side
 // effect of lifecycle cleanup; quiescence must be proven before a status mutation.
 const pending=await quiescence();if(pending)return {state:'blocked',reason:pending};
 if(!await authorizeWrite())return {state:'blocked',reason:'operator_authority_changed'};
 await request<Account>(path,'POST',{Status:desired});
 // Even on a lost POST response, reconcile by GET. No consequential automatic retry.
 const verified=await read();
 if(!verified.ok)return {state:'unknown',reason:'twilio_readback_unavailable'};
 if(!bound(verified.data))return {state:'unknown',reason:'twilio_readback_identity_mismatch'};
 if(!satisfies(verified.data))return {state:'unknown',reason:'twilio_retirement_not_verified'};
 if(verified.data!.status==='closed')return {state:'verified',provider_status:'closed'};
 const remaining=await quiescence();
 return remaining?{state:'unknown',reason:remaining}:{state:'verified',provider_status:verified.data!.status as 'suspended'|'closed'};
}
