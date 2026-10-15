// One merchant door: scoped reads, shared Trust/Kit approval, canonical Stripe binding and Rail.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import Stripe from 'https://esm.sh/stripe@17.5.0?target=deno';
import {readStripeMerchant} from '../_shared/sales-payments/merchant.ts';
import {merchantStatus,returnTarget,hostedLink,deadline,resolveOnboarding,recoverPendingMerchant,type MerchantRow} from '../_shared/sales-payments/merchant-onboarding.ts';
import {parseMerchantRequest,classifyMerchantFailure,type MerchantStage,type MerchantRequest} from '../_shared/sales-payments/merchant-command.ts';
import {admitMerchantCommand,type MerchantAdmissionContext,type MerchantTool} from '../_shared/sales-payments/merchant-admission.ts';
import {merchantApprovalStore} from '../_shared/sales-payments/merchant-approval-store.ts';
import {recordCapabilityRun} from '../_shared/capability-record.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json(405,{ok:false,outcome:'refused',code:'METHOD_NOT_ALLOWED'});
 let tenantId:string|null=null,row:MerchantRow|null=null,environment:'test'|'live'|null=null,stage:MerchantStage='admission';
 try{
  const authorization=req.headers.get('Authorization');if(!authorization)return json(401,{ok:false,outcome:'refused',code:'UNAUTHENTICATED'});
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(url,key),caller=createClient(url,key,{global:{headers:{Authorization:authorization}}});
  const auth=await caller.auth.getUser();if(auth.error||!auth.data.user)return json(401,{ok:false,outcome:'refused',code:'UNAUTHENTICATED'});
  const actor=auth.data.user.id;
  let body:MerchantRequest;try{const raw=await req.text();if(raw.length>4000)throw Error();body=parseMerchantRequest(JSON.parse(raw));}catch{return json(400,{ok:false,outcome:'refused',code:'MERCHANT_COMMAND_INVALID'});}
  const action=body.action;
  const profile=await admin.from('profiles').select('active_tenant_id').eq('user_id',actor).maybeSingle();
  if(profile.error||!profile.data?.active_tenant_id)return json(403,{ok:false,outcome:'refused',code:'WORKSPACE_UNAVAILABLE'});
  tenantId=profile.data.active_tenant_id;
  if(body.expected_tenant_id!==undefined&&body.expected_tenant_id!==tenantId)return json(409,{ok:false,outcome:'refused',code:'WORKSPACE_CHANGED'});
  let loaded=false;
  const scope=async()=>{
   const result=await admin.rpc('_sales_invoice_actor',{_actor:actor,_tenant:tenantId});if(result.error)throw Error('WORKSPACE_CHANGED');
   if(loaded){
    const current=await admin.from('tenant_stripe_accounts').select('stripe_account_id,provider_environment,binding_version,onboarding_id').eq('tenant_id',tenantId).maybeSingle();
    if(current.error||Boolean(current.data)!==Boolean(row)||current.data&&(current.data.stripe_account_id!==row?.stripe_account_id||current.data.provider_environment!==row?.provider_environment||current.data.binding_version!==row?.binding_version||current.data.onboarding_id!==row?.onboarding_id))throw Error('BINDING_CHANGED');
   }
  };
  await scope();
  const tenant=await admin.from('tenants').select('id,account_number').eq('id',tenantId).single();if(tenant.error||!tenant.data)throw Error('WORKSPACE_CHANGED');
  const stored=await admin.from('tenant_stripe_accounts').select('*').eq('tenant_id',tenantId).maybeSingle();if(stored.error)throw Error('STORAGE_UNAVAILABLE');row=stored.data;loaded=true;
  const stripeKey=Deno.env.get('STRIPE_SECRET_KEY')??'',match=/^(?:sk|rk)_(test|live)_/.exec(stripeKey)?.[1];environment=match==='test'||match==='live'?match:null;
  const output=()=>merchantStatus(tenantId!,row,true,environment,Date.now());
  if(action==='status'){await scope();return json(200,{...output(),ok:true,outcome:'available'});}
  if(!environment)return json(503,{...output(),ok:false,outcome:'refused',code:'PROVIDER_UNAVAILABLE',state:'unverified',recovery_reason:'PROVIDER_UNAVAILABLE'});
  if(row?.provider_environment&&row.provider_environment!==environment)return json(409,{...output(),ok:false,outcome:'refused',code:'PROVIDER_ENVIRONMENT_MISMATCH',state:'unverified',recovery_reason:'PROVIDER_ENVIRONMENT_MISMATCH'});
  // No automatic provider write retries. Unknown reservations reconcile by GET only.
  const stripe=new Stripe(stripeKey,{apiVersion:'2024-11-20.acacia',maxNetworkRetries:0,timeout:8000});
  const around=async<T>(at:MerchantStage,fn:()=>Promise<T>)=>{stage=at;await scope();const value=await deadline(fn());await scope();return value;};
  const persist=async(binding:MerchantRow,account:{id:string})=>{
   stage='binding_persist';await scope();
   const saved=await admin.rpc('persist_sales_merchant_onboarding',{_actor_user_id:actor,_expected_tenant_id:tenantId,_environment:environment,_operation_id:binding.onboarding_id,_claim:binding.onboarding_claim,_expected_version:binding.binding_version,_merchant_id:account.id});
   if(saved.error||!saved.data)throw Error('BINDING_UNRECORDED');return saved.data as MerchantRow;
  };
  let admitted:{capability:MerchantTool;args:Record<string,unknown>}|null=null;
  let targets:{return_url:string;refresh_url:string}|null=null;
  if(action==='start_onboarding'||action==='login_link'){
   if(row?.onboarding_id&&!row.stripe_account_id)return json(409,{...output(),ok:false,outcome:'outcome_unknown',code:'ONBOARDING_OUTCOME_UNKNOWN'});
   if(action==='login_link'&&!row?.stripe_account_id)return json(409,{...output(),ok:false,outcome:'refused',code:'MERCHANT_NOT_CONNECTED'});
   if(row?.stripe_account_id&&row.provider_environment!==environment)return json(409,{...output(),ok:false,outcome:'refused',code:'PROVIDER_ENVIRONMENT_UNVERIFIED'});
   const origins=['https://paigeagent.ai','https://app.paigeagent.ai'];let appOrigin='https://app.paigeagent.ai';
   const configured=Deno.env.get('PUBLIC_SITE_URL');if(configured){const configuredUrl=new URL(configured);if(configuredUrl.protocol==='https:'&&!configuredUrl.username&&!configuredUrl.password&&!configuredUrl.port&&(configuredUrl.hostname==='paigeagent.ai'||configuredUrl.hostname.endsWith('.paigeagent.ai'))){appOrigin=configuredUrl.origin;origins.push(appOrigin);}}
   const canonical=`${appOrigin}/solo/${String(tenant.data.account_number)}/settings/integrations?stripe_setup=return`;
   try{targets={return_url:returnTarget(body.return_url??canonical,String(tenant.data.account_number),origins),refresh_url:returnTarget(body.refresh_url??body.return_url??canonical,String(tenant.data.account_number),origins)};}catch{return json(400,{...output(),ok:false,outcome:'refused',code:'RETURN_URL_INVALID'});}
   // Bind this approval to the configured server credential without storing/exposing that credential.
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stripeKey));
   const provider_configuration=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   const context:MerchantAdmissionContext={actor,tenant:tenantId!,environment,provider_configuration,binding_version:row?.binding_version??null,merchant_id:row?.stripe_account_id??null,onboarding_id:row?.onboarding_id??null,...targets};
   const proposalStore=merchantApprovalStore(admin,actor,tenantId!,crypto.randomUUID(),()=>new Date().toISOString());
   const decision=await admitMerchantCommand(body,context,{scope,...proposalStore,
    lane:async tool=>{const value=await caller.rpc('resolve_tool_autonomy',{_tenant_id:tenantId,_tool_key:tool});return !value.error&&typeof value.data==='string'?value.data:'unresolved';},
    audit:async audit=>{const receipt=await admin.from('paige_audit_log').insert({actor_user_id:actor,actor_role:'sales:workspace_admin',tenant_id:tenantId,action:'sales.merchant_governed_decision',target_type:'merchant_connection',target_id:tenantId,payload:{capability:audit.capability,decision:audit.decision,risk:audit.risk,lane_requested:audit.laneRequested,lane_effective:audit.laneEffective,clamped:audit.clamped}});return !receipt.error;},
   });
   if(decision.kind==='refuse')return json(403,{...output(),ok:false,outcome:'refused',code:decision.code});
   if(decision.kind==='propose'){const {kind:_kind,...proposal}=decision;return json(202,{...output(),...proposal,ok:false,outcome:'approval_required'});}
   admitted=decision;
   const binding=decision.args.merchant_binding as MerchantAdmissionContext;targets={return_url:binding.return_url,refresh_url:binding.refresh_url};
   if(action==='start_onboarding'&&!row?.stripe_account_id){
    stage='reservation';await scope();
    const reserved=await admin.rpc('reserve_sales_merchant_onboarding',{_actor_user_id:actor,_expected_tenant_id:tenantId,_environment:environment,_operation_id:decision.args.operation_id,_claim:crypto.randomUUID()});
    if(reserved.error||!reserved.data?.binding)throw Error('RESERVATION_UNAVAILABLE');row=reserved.data.binding;
    // An approval of absence never adopts a concurrently created/different merchant reservation.
    if(reserved.data.dispatch!==true||row!.onboarding_id!==decision.args.operation_id)return json(409,{...output(),ok:false,outcome:row?.stripe_account_id?'refused':'outcome_unknown',code:row?.stripe_account_id?'BINDING_CHANGED':'ONBOARDING_OUTCOME_UNKNOWN'});
    row=await resolveOnboarding(row!,reserved.data.dispatch===true,{
     scope,
     create:(idempotencyKey,metadata)=>{stage='account_create';return deadline(stripe.accounts.create({type:'express',capabilities:{card_payments:{requested:true},transfers:{requested:true}},metadata},{idempotencyKey}));},
     list:after=>{stage='account_recovery';return deadline(stripe.accounts.list({limit:100,...(after?{starting_after:after}:{})}));},persist,
    });
    if(!row.stripe_account_id)return json(409,{...output(),ok:false,outcome:'outcome_unknown',code:'ONBOARDING_OUTCOME_UNKNOWN'});
   }
  }
  row=await recoverPendingMerchant(action,row,{scope,create:async()=>{throw Error('ONBOARDING_CREATE_NOT_ALLOWED');},list:after=>{stage='account_recovery';return deadline(stripe.accounts.list({limit:100,...(after?{starting_after:after}:{})}));},persist});
  if(!row?.stripe_account_id)return json(200,{...output(),ok:true,outcome:'available'});
  let account:Stripe.Account|null=null;
  const facts=await around('account_readback',()=>readStripeMerchant({tenant_id:tenantId!,provider:'stripe',merchant_id:row!.stripe_account_id!,environment:(row!.provider_environment??environment) as 'test'|'live',version:row!.binding_version},{environment:environment!,retrieveAccount:async id=>{const found=await stripe.accounts.retrieve(id);if('deleted'in found&&found.deleted)return {id:found.id,deleted:true};account=found as Stripe.Account;return account;}},Date.now));
  // Every handoff projects this fresh observation, never a previously cached Ready row.
  // Persist/CAS the exact account/version before the external hosted-link effect.
  const acct=account as Stripe.Account|null;if(!acct)throw Error('PROVIDER_UNAVAILABLE');stage='readback_persist';await scope();
  const saved=await admin.rpc('record_sales_merchant_onboarding_readback',{_actor_user_id:actor,_expected_tenant_id:tenantId,_merchant_id:facts.merchant_id,_expected_version:row.binding_version,_environment:environment,_charges_enabled:facts.charges_enabled,_payouts_enabled:facts.payouts_enabled,_details_submitted:facts.details_submitted,_payment_permission:facts.payment_permission,_country:acct.country??null,_currency:acct.default_currency??null,_requirements:acct.requirements??null});
  if(saved.error||!Number.isSafeInteger(saved.data))throw Error('READBACK_UNRECORDED');
  if(admitted&&saved.data!==facts.binding_version)throw Error('BINDING_CHANGED');
  row={...row,binding_version:saved.data,provider_environment:environment};
  await scope();const current=await admin.from('tenant_stripe_accounts').select('*').eq('tenant_id',tenantId).single();if(current.error||!current.data)throw Error('STORAGE_UNAVAILABLE');
  if(current.data.stripe_account_id!==facts.merchant_id||current.data.provider_environment!==environment||current.data.binding_version!==saved.data)throw Error('BINDING_CHANGED');
  row=current.data as MerchantRow;
  if(action==='start_onboarding'||action==='login_link'){
   const link=await around('hosted_link',()=>action==='start_onboarding'?stripe.accountLinks.create({account:row!.stripe_account_id!,refresh_url:targets!.refresh_url,return_url:targets!.return_url,type:'account_onboarding'}):stripe.accounts.createLoginLink(row!.stripe_account_id!));
   const hosted=hostedLink(link);stage='receipt';await scope();
   // Sanitize database errors before the shared receipt helper can log them.
   const safeReceiptClient={rpc:async(name:string,args:Record<string,unknown>)=>{try{const result=await admin.rpc(name,args);return {data:null,error:result.error?{message:'MERCHANT_RECEIPT_UNAVAILABLE'}:null};}catch{return {data:null,error:{message:'MERCHANT_RECEIPT_UNAVAILABLE'}};}}};
   const recorded=await recordCapabilityRun(safeReceiptClient,{tenantId,actorId:actor,capabilityKey:admitted!.capability,outcome:'capability_succeeded',runId:String(admitted!.args.operation_id),detail:{action:body.command.action,provider:'stripe',environment,binding_version:row.binding_version,result:'hosted_handoff_created'}});
   if(!recorded)return json(503,{...output(),ok:false,outcome:'completed_unrecorded',code:'MERCHANT_HANDOFF_UNRECORDED'});
   await scope();return json(200,{...output(),ok:true,outcome:'customer_action_required',url:hosted});
  }
  return json(200,{...output(),ok:true,outcome:'available'});
 }catch(error){
  const safe=classifyMerchantFailure(stage,error);console.warn('[merchant-connect]',safe);
  if(safe.code==='WORKSPACE_CHANGED'||safe.code==='BINDING_CHANGED')return json(409,{ok:false,outcome:'refused',code:safe.code});
  if(!tenantId)return json(503,{ok:false,outcome:'refused',code:'MERCHANT_UNAVAILABLE'});
  const pending=Boolean(row?.onboarding_id&&!row.stripe_account_id);
  return json(safe.outcome==='refused'?409:503,{...merchantStatus(tenantId,row,true,environment,Date.now()),ok:false,outcome:safe.outcome,code:safe.code,state:pending?'outcome_unknown':'unverified',recovery_reason:safe.code});
 }
});
