// Merchant onboarding only: canonical tenant binding, provider GET readback, hosted Express links.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import Stripe from 'https://esm.sh/stripe@17.5.0?target=deno';
import {readStripeMerchant} from '../_shared/sales-payments/merchant.ts';
import {merchantStatus,returnTarget,hostedUrl,deadline,resolveOnboarding,recoverPendingMerchant,admitMerchantRequest,type MerchantRow} from '../_shared/sales-payments/merchant-onboarding.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json(405,{error:'method_not_allowed'});
 let tenantId:string|null=null,row:MerchantRow|null=null,environment:'test'|'live'|null=null;
 try{
  const authorization=req.headers.get('Authorization');if(!authorization)return json(401,{error:'unauthorized'});
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(url,key), caller=createClient(url,key,{global:{headers:{Authorization:authorization}}});
  const auth=await caller.auth.getUser();if(auth.error||!auth.data.user)return json(401,{error:'unauthorized'});
  const actor=auth.data.user.id;
  let body:Record<string,unknown>;try{body=await req.json();if(!body||Array.isArray(body)||typeof body!=='object')throw 0;}catch{return json(400,{error:'invalid_json'});}
  const action=body.action;if(!['status','start_onboarding','refresh_status','login_link'].includes(String(action)))return json(400,{error:'unknown_action'});
  const profile=await admin.from('profiles').select('active_tenant_id').eq('user_id',actor).maybeSingle();
  if(profile.error||!profile.data?.active_tenant_id)return json(403,{error:'workspace_unavailable'});
  tenantId=profile.data.active_tenant_id;
  let solo:boolean;
  try{solo=admitMerchantRequest(body,tenantId!);}catch(error){return json(error instanceof Error&&error.message==='WORKSPACE_CHANGED'?409:400,{error:error instanceof Error&&error.message==='WORKSPACE_CHANGED'?'workspace_changed':'expected_tenant_required'});}
  const scope=async()=>{
   const result=await admin.rpc('_sales_invoice_actor',{_actor:actor,_tenant:tenantId});if(result.error)throw new Error('WORKSPACE_CHANGED');
   if(row){const current=await admin.from('tenant_stripe_accounts').select('stripe_account_id,provider_environment,binding_version').eq('tenant_id',tenantId).single();if(current.error||current.data.stripe_account_id!==row.stripe_account_id||current.data.provider_environment!==row.provider_environment||current.data.binding_version!==row.binding_version)throw new Error('BINDING_CHANGED');}
  };
  await scope();
  const tenant=await admin.from('tenants').select('id,account_number').eq('id',tenantId).single();if(tenant.error||!tenant.data)throw new Error('WORKSPACE_CHANGED');
  const stored=await admin.from('tenant_stripe_accounts').select('*').eq('tenant_id',tenantId).maybeSingle();if(stored.error)throw new Error('STORAGE_UNAVAILABLE');row=stored.data;
  const stripeKey=Deno.env.get('STRIPE_SECRET_KEY')??'',match=/^(?:sk|rk)_(test|live)_/.exec(stripeKey)?.[1];
  environment=match==='test'||match==='live'?match:null;
  const output=()=>merchantStatus(tenantId!,row,true,environment,Date.now());
  if(action==='status'){await scope();return json(200,output());}
  if(!environment)return json(503,{...output(),state:'unverified',recovery_reason:'PROVIDER_UNAVAILABLE'});
  if(row?.provider_environment&&row.provider_environment!==environment)return json(409,{...output(),state:'unverified',recovery_reason:'PROVIDER_ENVIRONMENT_MISMATCH'});
  // Disable SDK automatic write retries: ambiguous creation is resolved only with GET lookup.
  const stripe=new Stripe(stripeKey,{apiVersion:'2024-11-20.acacia',maxNetworkRetries:0,timeout:8000});
  const around=async<T>(fn:()=>Promise<T>)=>{await scope();const value=await deadline(fn());await scope();return value;};
  if(action==='start_onboarding'){
   const origins=['https://paigeagent.ai','https://app.paigeagent.ai'];
   const configured=Deno.env.get('PUBLIC_SITE_URL');if(configured){const configuredUrl=new URL(configured);if(configuredUrl.protocol==='https:'&&(configuredUrl.hostname==='paigeagent.ai'||configuredUrl.hostname.endsWith('.paigeagent.ai')))origins.push(configuredUrl.origin);}
   const workspace=solo?String(tenant.data.account_number):null;
   let returnUrl:string,refreshUrl:string;try{returnUrl=returnTarget(body.return_url,workspace,origins);refreshUrl=returnTarget(body.refresh_url??body.return_url,workspace,origins);}catch{return json(400,{error:'return_url_invalid'});}
   if(!row?.stripe_account_id){
    const reserved=await admin.rpc('reserve_sales_merchant_onboarding',{_actor_user_id:actor,_expected_tenant_id:tenantId,_environment:environment,_operation_id:crypto.randomUUID(),_claim:crypto.randomUUID()});
    if(reserved.error||!reserved.data?.binding)throw new Error('RESERVATION_UNAVAILABLE');row=reserved.data.binding;
    row=await resolveOnboarding(row!,reserved.data.dispatch===true,{
     scope,
     create:(idempotencyKey,metadata)=>deadline(stripe.accounts.create({type:'express',capabilities:{card_payments:{requested:true},transfers:{requested:true}},metadata},{idempotencyKey})),
     list:after=>deadline(stripe.accounts.list({limit:100,...(after?{starting_after:after}:{})})),
     persist:async(binding,account)=>{
      const saved=await admin.rpc('persist_sales_merchant_onboarding',{_actor_user_id:actor,_expected_tenant_id:tenantId,_environment:environment,_operation_id:binding.onboarding_id,_claim:binding.onboarding_claim,_expected_version:binding.binding_version,_merchant_id:account.id});
      if(saved.error||!saved.data)throw new Error('BINDING_UNRECORDED');return saved.data;
     },
    });
    if(!row.stripe_account_id)return json(409,output());
   }
   if(row!.provider_environment!==environment)throw new Error('PROVIDER_ENVIRONMENT_UNVERIFIED');
   await around(()=>readStripeMerchant({tenant_id:tenantId!,provider:'stripe',merchant_id:row!.stripe_account_id!,environment:environment!,version:row!.binding_version},{environment:environment!,retrieveAccount:id=>stripe.accounts.retrieve(id)},Date.now));
   const link=await around(()=>stripe.accountLinks.create({account:row!.stripe_account_id!,refresh_url:refreshUrl,return_url:returnUrl,type:'account_onboarding'}));
   return json(200,{...output(),url:hostedUrl(link.url)});
  }
  row=await recoverPendingMerchant(String(action),row,{
   scope,
   create:async()=>{throw new Error('ONBOARDING_CREATE_NOT_ALLOWED');},
   list:after=>deadline(stripe.accounts.list({limit:100,...(after?{starting_after:after}:{})})),
   persist:async(binding,account)=>{
    const saved=await admin.rpc('persist_sales_merchant_onboarding',{_actor_user_id:actor,_expected_tenant_id:tenantId,_environment:environment,_operation_id:binding.onboarding_id,_claim:binding.onboarding_claim,_expected_version:binding.binding_version,_merchant_id:account.id});
    if(saved.error||!saved.data)throw new Error('BINDING_UNRECORDED');return saved.data;
   },
  });
  if(!row?.stripe_account_id)return json(200,output());
  let account:Stripe.Account|null=null;
  const facts=await around(()=>readStripeMerchant({tenant_id:tenantId!,provider:'stripe',merchant_id:row!.stripe_account_id!,environment:(row!.provider_environment??environment) as 'test'|'live',version:row!.binding_version},{environment:environment!,retrieveAccount:async id=>{const found=await stripe.accounts.retrieve(id);if('deleted' in found&&found.deleted)return {id:found.id,deleted:true};account=found as Stripe.Account;return account;}},Date.now));
  if(action==='login_link'){
   if(row.provider_environment!==environment)throw new Error('PROVIDER_ENVIRONMENT_UNVERIFIED');
   const link=await around(()=>stripe.accounts.createLoginLink(row!.stripe_account_id!));return json(200,{...output(),url:hostedUrl(link.url)});
  }
  const acct=account as Stripe.Account|null;if(!acct)throw new Error('PROVIDER_UNAVAILABLE');
  const saved=await admin.rpc('record_sales_merchant_onboarding_readback',{_actor_user_id:actor,_expected_tenant_id:tenantId,_merchant_id:facts.merchant_id,_expected_version:row.binding_version,_environment:environment,_charges_enabled:facts.charges_enabled,_payouts_enabled:facts.payouts_enabled,_details_submitted:facts.details_submitted,_payment_permission:facts.payment_permission,_country:acct.country??null,_currency:acct.default_currency??null,_requirements:acct.requirements??null});
  if(saved.error||!Number.isSafeInteger(saved.data))throw new Error('READBACK_UNRECORDED');row={...row,binding_version:saved.data,provider_environment:environment};
  await scope();const current=await admin.from('tenant_stripe_accounts').select('*').eq('tenant_id',tenantId).single();if(current.error)throw new Error('STORAGE_UNAVAILABLE');row=current.data;
  return json(200,output());
 }catch(error){
  // No provider payload/error leaks; never promote a failed persist or an ambiguous POST.
  if(error instanceof Error&&error.message==='WORKSPACE_CHANGED')return json(409,{error:'workspace_changed'});
  if(!tenantId)return json(503,{error:'merchant_unavailable'});
  return json(503,{...merchantStatus(tenantId,row,true,environment,Date.now()),state:row?.onboarding_id&&!row.stripe_account_id?'outcome_unknown':'unverified',recovery_reason:row?.onboarding_id&&!row.stripe_account_id?'ONBOARDING_OUTCOME_UNKNOWN':'MERCHANT_READBACK_REQUIRED'});
 }
});
