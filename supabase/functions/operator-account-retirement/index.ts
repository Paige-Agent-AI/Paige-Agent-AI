// Operator lifecycle's provider adapter. No provider identity or credentials are accepted
// from a browser. The canonical private operation supplies every resource binding.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { masterCreds, resolveTwilioCreds } from '../_shared/twilio.ts';
import { retireTwilioSubaccount } from '../_shared/operator-retirement.ts';
import { retireTenantTtsCache, retireTenantGeneratedMedia } from '../_shared/operator-storage-retirement.ts';

const cors={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store' };
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
type Resource={key:string;provider:'twilio'|'n8n'|'tts_cache'|'generated_media';tenant_id:string;sid?:string;external_retention?:boolean;objects?:{id:string;name:string;fingerprint:string}[]};
type Plan={complete:boolean;mode:'archive'|'delete';resources:Resource[];results:Record<string,{state:string}>};

Deno.serve(async(req)=>{
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 const authorization=req.headers.get('Authorization')??'';
 if(!authorization.startsWith('Bearer '))return json({error:'unauthorized'},401);
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!anon||!secret)return json({error:'operator_lifecycle_unavailable'},503);
 const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await caller.auth.getUser();
 if(authError||!user)return json({error:'unauthorized'},401);
 const authority=await caller.rpc('operator_can_retire_accounts');
 if(authority.error||authority.data!==true)return json({error:'platform_administrator_only'},403);
 let input:Record<string,unknown>;
 try{const text=await req.text();if(text.length>8192)return json({error:'request_too_large'},413);input=JSON.parse(text);}
 catch{return json({error:'invalid_request'},400);}
 if(!input||Array.isArray(input)||!uuid(input.tenant_id)||!uuid(input.operation_id)||!['prepare','continue','read'].includes(String(input.action)))return json({error:'invalid_request'},400);
 const tenant=input.tenant_id,operation=input.operation_id,action=String(input.action);
 const allowed=['tenant_id','operation_id','action','mode','version','confirmation','retain_external_n8n'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))return json({error:'invalid_request'},400);
 if(action==='prepare'){
  if(!['archive','delete'].includes(String(input.mode))||typeof input.version!=='string'||typeof input.confirmation!=='string'||typeof input.retain_external_n8n!=='boolean')return json({error:'invalid_request'},400);
  const begin=await caller.rpc('operator_begin_retirement_resources',{_tenant_id:tenant,_mode:input.mode,_expected_version:input.version,_confirmation_name:input.confirmation,_operation_id:operation,_retain_external_n8n:input.retain_external_n8n});
  if(begin.error)return json({error:'resource_review_refused',code:begin.error.code},409);
 }
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20_000)})}}),claim=crypto.randomUUID();
 const bound={_tenant_id:tenant,_operation_id:operation,_actor:user.id,_claim:claim};
 const taken=await admin.rpc('operator_claim_retirement_resources',{...bound,_read_only:action==='read'});
 if(taken.error)return json({error:'resource_claim_refused',code:taken.error.code},409);
 const plan=taken.data as Plan;
 if(!plan.complete){
  // One resource per invocation bounds provider I/O below the Edge wall-clock limit.
  // Continue is explicit and uses the original operation; never replay an uncertain POST.
  const resource=plan.resources.find(r=>plan.results[r.key]?.state!=='verified');
  if(resource){
   const assert=async()=>{const r=await admin.rpc('operator_assert_retirement_resource',{...bound,_key:resource.key});return !r.error&&r.data===true;};
   if(!await assert())return json({error:'resource_authority_or_binding_changed'},409);
   let state:'verified'|'blocked'|'unknown'='unknown',status:string|null=null,reason:string|null=null;
   if(resource.provider==='twilio'&&typeof resource.sid==='string'){
    const management=masterCreds();
    const calls=async()=>{const creds=await resolveTwilioCreds(admin,resource.tenant_id);return creds.ok?creds.data:null;};
    // Existing protected provider secret, read lazily after bound account ownership.
    // This never accepts or returns a browser-supplied credential or uses a child
    // credential to query a suspended account. Ordinary Comms keeps its scoped keys.
    const parentCalls=async()=>{const token=Deno.env.get('TWILIO_AUTH_TOKEN');return token&&management?{accountSid:management.accountSid,authToken:token}:null;};
    const result=await retireTwilioSubaccount(resource.sid,plan.mode==='archive'?'suspended':'closed',management,action==='read',assert,calls,parentCalls);
    state=result.state;if(result.state==='verified')status=result.provider_status;else reason=result.reason;
   }else if((resource.provider==='tts_cache'||resource.provider==='generated_media')&&plan.mode==='delete'&&resource.objects){
    const remove=resource.provider==='tts_cache'?retireTenantTtsCache:retireTenantGeneratedMedia;
    const result=await remove(admin,resource.tenant_id,resource.objects,action==='read',assert);
    state=result.state;if(result.state==='verified')status=result.provider_status;else reason=result.reason;
   }else if(resource.provider==='n8n'&&resource.external_retention===true&&action!=='read'){
    // External n8n workflows are explicitly retained; clear only this tenant's canonical
    // encrypted PAIGE connection. Count of visible workflows is never ownership proof.
    state='verified';status='disconnected';
   }
   if(resource.provider!=='n8n'||action!=='read'){
    const finished=await admin.rpc('operator_finish_retirement_resource',{...bound,_key:resource.key,_state:state,_provider_status:status,_reason:reason});
    if(finished.error)return json({error:'resource_outcome_unknown',code:finished.error.code},502);
   }
  }
  const finished=await admin.rpc('operator_complete_retirement_resources',bound);
  if(finished.error)return json({error:'resource_outcome_unknown'},502);
 }
 const outcome=await caller.rpc('operator_read_retirement_resources',{_tenant_id:tenant,_operation_id:operation});
 if(outcome.error)return json({error:'resource_readback_unavailable'},502);
 return json(outcome.data);
});
