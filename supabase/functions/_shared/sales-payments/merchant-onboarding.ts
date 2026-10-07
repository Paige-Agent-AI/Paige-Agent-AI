export type MerchantRow = {tenant_id:string;stripe_account_id:string|null;provider_environment:string|null;binding_version:number;charges_enabled:boolean;payouts_enabled:boolean;details_submitted:boolean;sales_payment_permission:boolean;sales_readback_at:string|null;requirements?:{disabled_reason?:string|null}|null;onboarding_id?:string|null;onboarding_started_at?:string|null;onboarding_claim?:string|null};
export function merchantStatus(tenant:string,row:MerchantRow|null,manage:boolean,environment:string|null,now:number){
 const connected=Boolean(row?.stripe_account_id), checked=row?.sales_readback_at??null, time=checked?Date.parse(checked):NaN;
 let state='not_connected', reason:string|null=null;
 if(row?.onboarding_id&&!connected){state='outcome_unknown';reason='ONBOARDING_OUTCOME_UNKNOWN';}
 else if(connected){
  if(!environment||row?.provider_environment!==environment){state='unverified';reason='PROVIDER_ENVIRONMENT_UNVERIFIED';}
  else if(!Number.isFinite(time)||time>now||now-time>300000){state='unverified';reason='MERCHANT_READBACK_REQUIRED';}
  else if(!row?.details_submitted){state='setup_incomplete';reason='MERCHANT_SETUP_REQUIRED';}
  else if(!row.charges_enabled||!row.sales_payment_permission||row.requirements?.disabled_reason!=null){state='restricted';reason='MERCHANT_PAYMENTS_RESTRICTED';}
  else state='ready';
 }
 return {tenant_id:tenant,connected,can_manage:manage,provider_environment:row?.provider_environment==='test'||row?.provider_environment==='live'?row.provider_environment:!row&&(environment==='test'||environment==='live')?environment:null,binding_version:row?.binding_version??null,charges_enabled:row?.charges_enabled===true,payouts_enabled:row?.payouts_enabled===true,details_submitted:row?.details_submitted===true,sales_payment_permission:row?.sales_payment_permission===true,checked_at:checked,state,recovery_reason:reason};
}
export function hostedUrl(raw:string){const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||!['connect.stripe.com','dashboard.stripe.com'].includes(url.hostname)||url.port)throw new Error('PROVIDER_LINK_UNVERIFIED');return url.href;}
export function returnTarget(raw:unknown,workspace:string|null,origins:string[]){
 const url=new URL(typeof raw==='string'?raw:'');
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||!origins.includes(url.origin))throw new Error('RETURN_URL_INVALID');
 if(workspace){if(!/^[0-9]+$/.test(workspace)||url.pathname!==`/solo/${workspace}/settings/integrations`||url.search!=='?stripe_setup=return')throw new Error('RETURN_URL_INVALID');}
 else throw new Error('RETURN_URL_INVALID');
 return url.href;
}
export async function deadline<T>(work:Promise<T>,ms=10000):Promise<T>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('PROVIDER_OUTCOME_UNKNOWN')),ms);})]);}finally{clearTimeout(timer!);}}
export interface OnboardingAccount {id:string;metadata?:Record<string,string>;}
export interface OnboardingPort {
 scope():Promise<void>;
 create(idempotencyKey:string,metadata:Record<string,string>):Promise<OnboardingAccount>;
 list(after?:string):Promise<{data:OnboardingAccount[];has_more:boolean}>;
 persist(row:MerchantRow,account:OnboardingAccount):Promise<MerchantRow>;
}
/** A reservation is durable BEFORE this seam. Only its one-time winner may dispatch. */
export async function resolveOnboarding(row:MerchantRow,dispatch:boolean,port:OnboardingPort):Promise<MerchantRow>{
 if(!row.onboarding_id||!row.onboarding_claim||!['test','live'].includes(row.provider_environment??''))throw new Error('RESERVATION_INVALID');
 const metadata={tenant_id:row.tenant_id,onboarding_id:row.onboarding_id,provider_environment:row.provider_environment!};
 const around=async<T>(fn:()=>Promise<T>)=>{await port.scope();const value=await fn();await port.scope();return value;};
 let account:OnboardingAccount|null=null;
 if(dispatch)account=await around(()=>port.create(`sales-merchant-${row.onboarding_id}`,metadata));
 else{
  let after:string|undefined;const matches:OnboardingAccount[]=[];
  for(let page=0;page<5;page++){
   const list=await around(()=>port.list(after));matches.push(...list.data.filter(a=>Object.entries(metadata).every(([k,v])=>a.metadata?.[k]===v)));
   if(!list.has_more){if(matches.length===1)account=matches[0];break;}after=list.data.at(-1)?.id;if(!after)break;
  }
 }
 if(!account)return row;
 if(!/^acct_[A-Za-z0-9]+$/.test(account.id)||!Object.entries(metadata).every(([k,v])=>account!.metadata?.[k]===v))throw new Error('PROVIDER_PROVENANCE_UNVERIFIED');
 await port.scope();return port.persist(row,account);
}



/** New onboarding targets the current Solo route and always binds explicit workspace intent. */
export function admitMerchantRequest(body:Record<string,unknown>,activeTenant:string):boolean {
 if(body.expected_tenant_id!==undefined){if(body.expected_tenant_id!==activeTenant)throw new Error('WORKSPACE_CHANGED');return true;}
 if(body.action==='start_onboarding')throw new Error('EXPECTED_TENANT_REQUIRED');
 return false;
}
/** Explicit refresh reconciles pending creation using GET only; it never claims dispatch. */
export async function recoverPendingMerchant(action:string,row:MerchantRow|null,port:OnboardingPort):Promise<MerchantRow|null>{
 if(action!=='refresh_status'||!row?.onboarding_id||row.stripe_account_id)return row;
 return resolveOnboarding(row,false,port);
}

/** Treat SDK/network response as untrusted; never expose a missing/non-string provider link. */
export function hostedLink(response:unknown):string {
 if(!response||typeof response!=='object'||!('url' in response)||typeof response.url!=='string')throw new Error('PROVIDER_LINK_UNVERIFIED');
 return hostedUrl(response.url);
}
