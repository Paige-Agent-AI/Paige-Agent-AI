/** Thin domain transport only; NOT registered/mounted. The existing shared gate
 * must supply its actual stored-call claim OUTSIDE model arguments. These shapes
 * grant no authority: the original caller-JWT native executor rechecks all of it.
 * No confirmation issuance/claiming, fallback publisher, store, or retry here.
 */
export type PortalPublicationScope={actorId:string;tenantId:string;threadId:string|null;clientId:string|null;audience:'owner'|'customer'};
export type PortalPublicationClaim={id:string;fingerprint:string;requestNonce:string;threadId:string|null;clientId:string|null};
type NativeArguments={_expected_actor_id:string;_expected_tenant_id:string;_confirmation_id:string;_fingerprint:string;_claimed_in_request:string;_thread_id:string|null};
type Dependencies={current:()=>boolean;caller:{
 auth:{getUser:()=>Promise<{data:{user:{id:string}|null};error:unknown}>};
 rpc:(name:'share_client_portal_request',args:NativeArguments)=>PromiseLike<{data:unknown;error:unknown}>;
}};
type Result={success:false;outcome:'refused'|'outcome_unknown'}|{
 success:true;outcome:'shared';work_id:string;customer_action_id:string;replayed:boolean;published_at:string;
};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const nullableUuid=(x:unknown):x is string|null=>x===null||uuid(x);
const time=(x:unknown):x is string=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x));
const exact=(x:Record<string,unknown>,fields:readonly string[])=>Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const same=(a:Record<string,unknown>,b:Record<string,unknown>)=>exact(a,Object.keys(b))&&Object.keys(b).every(k=>a[k]===b[k]);
const words=(x:unknown,max:number):x is string=>typeof x==='string'&&x.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,'').length>0&&[...x].length<=max;
const targetFields=['expected_tenant_id','contact_id','work_id','version','title','body','recipient_user_id','access_version']as const;
const receiptFields=['schema_version','actor_id','tenant_id','contact_id','work_id','customer_action_id','status','replayed','published_at']as const;
const refused=():Result=>({success:false,outcome:'refused'});
const unknown=():Result=>({success:false,outcome:'outcome_unknown'});

export async function executePortalRequestPublication(
 deps:Dependencies,scope:PortalPublicationScope,stored:unknown,claim:PortalPublicationClaim
):Promise<Result>{
 let dispatched=false;
 try{
  if(!object(scope)||!object(claim)||!object(stored))return refused();
  // Primitive copies preserve exact native timestamps/words and claim identity.
  // Never round source versions through Date or rebuild approval from prose.
  const s={...scope},c={...claim},t={...stored};
  if(!exact(t,targetFields)||s.audience!=='owner'||!uuid(s.actorId)||!uuid(s.tenantId)||!nullableUuid(s.threadId)||!nullableUuid(s.clientId)
   ||![t.expected_tenant_id,t.contact_id,t.work_id,t.recipient_user_id].every(uuid)||t.expected_tenant_id!==s.tenantId
   ||!time(t.version)||!(t.access_version===null||time(t.access_version))||!words(t.title,160)||!words(t.body,4000)
   ||(s.clientId!==null&&s.clientId!==t.contact_id)||!uuid(c.id)||!uuid(c.requestNonce)
   ||typeof c.fingerprint!=='string'||!/^[a-f0-9]{16}$/.test(c.fingerprint)||c.threadId!==s.threadId||c.clientId!==s.clientId)return refused();
  const current=()=>deps.current()&&same(scope,s)&&same(claim,c)&&same(stored,t);
  const actorCurrent=async()=>{
   if(!current())return false;
   const auth=await deps.caller.auth.getUser();return current()&&!auth.error&&auth.data.user?.id===s.actorId;
  };
  if(!await actorCurrent()||!current())return refused();
  // Exactly one original native dispatch. The shared Harness must supply the
  // bounded caller transport. A logical interruption never retries a mutation.
  dispatched=true;
  const response=await deps.caller.rpc('share_client_portal_request',{
   _expected_actor_id:s.actorId,_expected_tenant_id:s.tenantId,_confirmation_id:c.id,
   _fingerprint:c.fingerprint,_claimed_in_request:c.requestNonce,_thread_id:s.threadId,
  });
  if(!await actorCurrent()||!current())return unknown();
  if(response.error){
   // Received native denials roll back their transaction. A lost/unknown reply
   // proves neither refusal nor success and must reconcile original Work.
   return response.data===null&&object(response.error)&&['42501','55000'].includes(String(response.error.code))?refused():unknown();
  }
  const r=response.data;
  if(!object(r)||!exact(r,receiptFields)||r.schema_version!==1||r.actor_id!==s.actorId||r.tenant_id!==s.tenantId
   ||r.contact_id!==t.contact_id||r.work_id!==t.work_id||!uuid(r.customer_action_id)||r.status!=='shared'
   ||typeof r.replayed!=='boolean'||!time(r.published_at))return unknown();
  return {success:true,outcome:'shared',work_id:r.work_id as string,customer_action_id:r.customer_action_id,
   replayed:r.replayed,published_at:r.published_at};
 }catch{return dispatched?unknown():refused();}
}
