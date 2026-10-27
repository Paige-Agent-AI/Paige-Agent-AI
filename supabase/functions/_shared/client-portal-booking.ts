import {clientPortalBindingFromProfile,type ClientPortalChatBinding} from './client-portal-chat-scope.ts';

// Thin transport for the original private customer booking path. Supplied ids
// NARROW real Auth/CRM authority. No owner client, sender, model authority,
// identity store, create fallback, provider call or retry loop lives here.
type Reply={data:unknown;error:unknown};
export type PortalBookingCaller={
 auth:{getUser():PromiseLike<{data:{user:{id:string}|null}|null;error:unknown}>};
 rpc(name:string,args:Record<string,unknown>):PromiseLike<Reply>;
};
type Intent={tenantId:string;clientId:string};
export type PortalBookingReceipt={id:string;title:string;start_at:string;end_at:string;timezone:string;status:string};
export type PortalBookingRecovery={state:'saved';booking:PortalBookingReceipt}|{state:'unverified'|'access_unavailable'};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function parseIntent(value:unknown):Intent|null{
 if(!object(value)||!uuid(value.tenantId)||!uuid(value.clientId))return null;
 return {tenantId:value.tenantId.toLowerCase(),clientId:value.clientId.toLowerCase()};
}
function sameIntent(value:unknown,captured:Intent):boolean{
 const current=parseIntent(value);return !!current&&current.tenantId===captured.tenantId&&current.clientId===captured.clientId;
}

/** Reuse the original selected-business self projection on the actual caller's
 * client. A body email, role, actor label or route number is never authority.
 */
export type PortalBookingGuest=Readonly<{name:string;email:string;phone:string|null}>;
type BookingCustomer=Readonly<{binding:ClientPortalChatBinding;guest:PortalBookingGuest|null}>;
function guestFromProfile(value:unknown):PortalBookingGuest|null{
 if(!object(value)||typeof value.email!=='string')return null;
 const email=value.email.trim().toLowerCase(),phone=typeof value.phone==='string'?value.phone.trim()||null:null;
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>200||(phone!==null&&phone.length>40))return null;
 const words=[value.first_name,value.last_name].filter((x):x is string=>typeof x==='string'&&!!x.trim()).map(x=>x.trim()).join(' ');
 const name=(words||(typeof value.entity_name==='string'?value.entity_name.trim():'')||'Customer').slice(0,120);
 return Object.freeze({name,email,phone});
}
async function resolveBookingCustomer(caller:PortalBookingCaller,value:unknown):Promise<BookingCustomer|null>{
 const intent=parseIntent(value);if(!intent)return null;
 try{
  const before=await caller.auth.getUser(),actor=before.data?.user?.id;
  if(before.error||!uuid(actor)||!sameIntent(value,intent))return null;
  const response=await caller.rpc('client_portal_self_profile',{p_tenant_id:intent.tenantId});
  if(response.error||!sameIntent(value,intent))return null;
  const binding=clientPortalBindingFromProfile(response.data,actor);
  if(!binding||binding.tenantId!==intent.tenantId||binding.clientId!==intent.clientId)return null;
  const guest=guestFromProfile(response.data);
  const after=await caller.auth.getUser();
  if(after.error||after.data?.user?.id!==actor||!sameIntent(value,intent))return null;
  return Object.freeze({binding:Object.freeze({...binding}),guest});
 }catch{return null;}
}
export async function resolvePortalBookingActor(caller:PortalBookingCaller,value:unknown):Promise<ClientPortalChatBinding|null>{
 return (await resolveBookingCustomer(caller,value))?.binding??null;
}
/** The same original self read, with only this customer's canonical booking
 * contact details. No body guest, email lookup, staff data or other CRM row.
 */
export async function resolvePortalBookingCustomer(caller:PortalBookingCaller,value:unknown):Promise<BookingCustomer|null>{
 return await resolveBookingCustomer(caller,value);
}

function decodeReceipt(value:unknown,binding:ClientPortalChatBinding,requestId:string):PortalBookingReceipt|null{
 if(!object(value)||!exact(value,['schema_version','actor_id','tenant_id','client_id','request_id','state','booking'])
  ||value.schema_version!==1||value.actor_id!==binding.actorId||value.tenant_id!==binding.tenantId
  ||value.client_id!==binding.clientId||value.request_id!==requestId||value.state!=='saved'||!object(value.booking))return null;
 const b=value.booking;
 if(!exact(b,['id','title','start_at','end_at','timezone','status'])||!uuid(b.id)
  ||typeof b.title!=='string'||!b.title.trim()||b.title.length>500
  ||typeof b.start_at!=='string'||typeof b.end_at!=='string'
  ||!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(b.start_at)
  ||!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(b.end_at)
  ||!Number.isFinite(Date.parse(b.start_at))||!Number.isFinite(Date.parse(b.end_at))
  ||Date.parse(b.end_at)<=Date.parse(b.start_at)||typeof b.timezone!=='string'||b.timezone.length>80
  ||typeof b.status!=='string'||!['scheduled','cancelled','done','no_show'].includes(b.status))return null;
 try{new Intl.DateTimeFormat('en',{timeZone:b.timezone});}catch{return null;}
 // Copy primitives BEFORE awaiting Auth/relationship revalidation. The native
 // response object is not held as a mutable receipt across that boundary.
 return Object.freeze({id:b.id,title:b.title,start_at:b.start_at,end_at:b.end_at,timezone:b.timezone,status:b.status});
}

/** Read/reconcile only. Missing, malformed, interrupted or absent results never
 * mean "safe to create again". This module cannot dispatch another booking.
 * Native request read is an integration dependency until the coherent action
 * and original-work receipt migration are shipped; absence remains unverified.
 */
export async function readPortalBookingReceipt(caller:PortalBookingCaller,value:unknown):Promise<PortalBookingRecovery>{
 if(!object(value)||!uuid(value.requestId))return {state:'unverified'};
 const requestId=value.requestId.toLowerCase(),intent=parseIntent(value);
 if(!intent)return {state:'access_unavailable'};
 const binding=await resolvePortalBookingActor(caller,value);
 if(!binding)return {state:'access_unavailable'};
 try{
  const response=await caller.rpc('client_portal_booking_request',{
   p_tenant_id:binding.tenantId,p_expected_client_id:binding.clientId,p_request_id:requestId,
  });
  const saved=response.error?null:decodeReceipt(response.data,binding,requestId);
  const current=await resolvePortalBookingActor(caller,value);
  if(!current||current.actorId!==binding.actorId||current.tenantId!==binding.tenantId
   ||current.clientId!==binding.clientId||!sameIntent(value,intent)||!uuid(value.requestId)||value.requestId.toLowerCase()!==requestId)return {state:'access_unavailable'};
  return saved?{state:'saved',booking:saved}:{state:'unverified'};
 }catch{return {state:'unverified'};}
}

export type PortalBookingExecution={booking_kind:'single'|'collective'|'class_seat';host_ids:string[];collective_group_id:string|null};
export type PortalBookingCommitResult=
 |{state:'saved';booking:PortalBookingReceipt;replayed:boolean;execution:PortalBookingExecution|null}
 |{state:'refused';reason:'blocked'|'access_unavailable'|'bad_request'|'changed'|'slot_unavailable'|'unavailable'}
 |{state:'unverified'};
type CommitDependencies={caller:PortalBookingCaller;service:{rpc(name:string,args:Record<string,unknown>):PromiseLike<Reply>};
 current:()=>boolean;executionAllowed:()=>boolean|PromiseLike<boolean>};
function capturedJSON(value:unknown,maximum:number):{text:string;copy:Record<string,unknown>}|null{
 try{
  if(!object(value))return null;const text=JSON.stringify(value);
  if(new TextEncoder().encode(text).byteLength>maximum)return null;
  const copy:unknown=JSON.parse(text);return object(copy)?{text,copy}:null;
 }catch{return null;}
}
export type PortalBookingRequest={scope:Intent&{requestId:string};request:{calendar_id:string;start:string;
 appointment_type_id:string|null;location:string;notes:string|null;answers:Record<string,unknown>}};
/** Data normalization only. A body cannot provide the verified actor, recipient,
 * availability decision, host assignment or native execution plan.
 */
export function portalBookingRequest(body:unknown):PortalBookingRequest|null{
 try{
  if(!object(body)||!uuid(body.tenant_id)||!uuid(body.client_id)||!uuid(body.request_id)||!uuid(body.calendar_id)
   ||typeof body.start!=='string'||!Number.isFinite(Date.parse(body.start)))return null;
  const answers=capturedJSON(object(body.answers)?body.answers:{},65536);if(!answers)return null;
  const request={calendar_id:body.calendar_id.toLowerCase(),start:new Date(body.start).toISOString(),
   appointment_type_id:typeof body.appointmentTypeId==='string'?body.appointmentTypeId:null,
   location:typeof body.location==='string'?body.location.trim():'',
   notes:String(body.notes??'').trim().slice(0,1000)||null,answers:answers.copy};
  if(!capturedJSON(request,65536))return null;
  return {scope:{tenantId:body.tenant_id.toLowerCase(),clientId:body.client_id.toLowerCase(),requestId:body.request_id.toLowerCase()},request};
 }catch{return null;}
}

export type PortalBookingReconciliation=
 |{state:'saved';booking:PortalBookingReceipt;replayed:true;execution:null}
 |{state:'not_found'|'conflict'|'unverified'}
 |{state:'refused';reason:'bad_request'|'access_unavailable'|'blocked'};
/** Exact-intent lookup through the original native record. Read-only even when
 * provider execution is held. No state returned here dispatches a create.
 */
export async function reconcilePortalBooking(
 deps:Pick<CommitDependencies,'caller'|'service'|'current'>,scope:unknown,request:unknown
):Promise<PortalBookingReconciliation>{
 try{
  if(!object(scope)||!uuid(scope.requestId))return {state:'refused',reason:'bad_request'};
  const requestId=scope.requestId.toLowerCase(),intent=parseIntent(scope),r=capturedJSON(request,65536);
  if(!intent||!r)return {state:'refused',reason:'bad_request'};
  const current=()=>deps.current()&&sameIntent(scope,intent)&&uuid(scope.requestId)&&scope.requestId.toLowerCase()===requestId
   &&JSON.stringify(request)===r.text;
  if(!current())return {state:'refused',reason:'blocked'};
  const binding=await resolvePortalBookingActor(deps.caller,scope);
  if(!binding||!current())return {state:'refused',reason:'access_unavailable'};
  const response=await deps.service.rpc('client_portal_reconcile_booking',{
   p_verified_actor_id:binding.actorId,p_tenant_id:binding.tenantId,p_expected_client_id:binding.clientId,
   p_request_id:requestId,p_expected_intent:r.copy,
  });
  const native=response.data;
  if(response.error||!object(native)||!current()
   ||!exact(native,['schema_version','actor_id','tenant_id','client_id','request_id','state','booking','replayed','execution'])
   ||native.schema_version!==1||native.actor_id!==binding.actorId||native.tenant_id!==binding.tenantId
   ||native.client_id!==binding.clientId||native.request_id!==requestId||native.replayed!==true||native.execution!==null
   ||typeof native.state!=='string'||!['saved','not_found','conflict','unverified'].includes(native.state))return {state:'unverified'};
  const {replayed:_replayed,execution:_execution,...original}=native;
  const state=native.state,booking=state==='saved'?decodeReceipt(original,binding,requestId):null;
  if((state==='saved'&&!booking)||(state!=='saved'&&native.booking!==null))return {state:'unverified'};
  const after=await resolvePortalBookingActor(deps.caller,scope);
  if(!after||after.actorId!==binding.actorId||after.clientId!==binding.clientId||after.tenantId!==binding.tenantId||!current())return {state:'unverified'};
  if(booking)return {state:'saved',booking,replayed:true,execution:null};
  if(state==='not_found')return {state:'not_found'};
  if(state==='conflict')return {state:'conflict'};
  return {state:'unverified'};
 }catch{return {state:'unverified'};}
}
function executionFromNative(value:unknown,plan:Record<string,unknown>):PortalBookingExecution|null{
 if(!object(value)||!exact(value,['booking_kind','host_ids','collective_group_id'])
  ||!['single','collective','class_seat'].includes(String(value.booking_kind))||value.booking_kind!==plan.booking_kind
  ||!Array.isArray(value.host_ids)||!value.host_ids.length||value.host_ids.length>1000||!value.host_ids.every(uuid)
  ||new Set(value.host_ids).size!==value.host_ids.length||!Array.isArray(plan.host_ids)||!plan.host_ids.every(uuid)
  ||value.host_ids.length!==plan.host_ids.length||value.host_ids.some((v,i)=>v!==String((plan.host_ids as string[])[i]).toLowerCase()))return null;
 if(value.booking_kind==='collective'){
  if(value.host_ids.length<2||!uuid(value.collective_group_id))return null;
 }else if(value.host_ids.length!==1||value.collective_group_id!==null)return null;
 return {booking_kind:value.booking_kind as PortalBookingExecution['booking_kind'],host_ids:[...value.host_ids],
  collective_group_id:value.collective_group_id as string|null};
}

/** Execute only the original engine's already validated server plan. This is
 * NOT an availability engine, model tool, approval issuer, sender or public
 * request-plan parser. The root handler owns admission to the existing path.
 * `current` is its real request fence; `executionAllowed` calls its ORIGINAL
 * provider restriction. Neither is read from customer/model arguments.
 */
export async function commitPortalBooking(
 deps:CommitDependencies,scope:unknown,request:unknown,preparedPlan:unknown
):Promise<PortalBookingCommitResult>{
 let dispatched=false;
 try{
  if(!object(scope)||!uuid(scope.requestId))return {state:'refused',reason:'bad_request'};
  const intent=parseIntent(scope),requestId=scope.requestId.toLowerCase();
  const r=capturedJSON(request,65536),p=capturedJSON(preparedPlan,100000);
  if(!intent||!r||!p)return {state:'refused',reason:'bad_request'};
  const current=()=>deps.current()&&sameIntent(scope,intent)&&uuid(scope.requestId)&&scope.requestId.toLowerCase()===requestId
   &&JSON.stringify(request)===r.text&&JSON.stringify(preparedPlan)===p.text;
  if(!current()||!(await deps.executionAllowed())||!current())return {state:'refused',reason:'blocked'};
  const binding=await resolvePortalBookingActor(deps.caller,scope);
  if(!binding||!current())return {state:'refused',reason:'access_unavailable'};
  if(!(await deps.executionAllowed())||!current())return {state:'refused',reason:'blocked'};
  // Fixed native method and actor from the verified caller. Body/model actor,
  // role, address and plan labels cannot replace the original Auth subject.
  dispatched=true;
  const response=await deps.service.rpc('client_portal_commit_booking',{
   p_verified_actor_id:binding.actorId,p_tenant_id:binding.tenantId,p_expected_client_id:binding.clientId,
   p_request_id:requestId,p_request_intent:r.copy,p_plan:p.copy,
  });
  if(!current())return {state:'unverified'};
  if(response.error){
   const code=object(response.error)?response.error.code:null;
   if(typeof code==='string'&&['22023','22007','22P02','23505','23514','23503','23P01','40001','42501','P0001'].includes(code)){
    // One native PostgreSQL function call: a real SQL exception rolls back the
    // whole appointment/audit transaction. Transport text alone proves nothing.
    const reason=code==='42501'?'access_unavailable':code==='40001'||code==='22023'?'changed':
     code==='23P01'||code==='23505'||(code==='P0001'&&object(response.error)&&response.error.message==='sold_out')?'slot_unavailable':'unavailable';
    return {state:'refused',reason};
   }
   return {state:'unverified'};
  }
  const native=response.data;
  if(!object(native)||!exact(native,['schema_version','actor_id','tenant_id','client_id','request_id','state','booking','replayed','execution'])
   ||typeof native.replayed!=='boolean')return {state:'unverified'};
  const {replayed,execution,...original}=native;
  const booking=decodeReceipt(original,binding,requestId);
  if(!booking)return {state:'unverified'};
  const actualExecution=replayed?null:executionFromNative(execution,p.copy);
  if((replayed&&execution!==null)||(!replayed&&!actualExecution))return {state:'unverified'};
  const after=await resolvePortalBookingActor(deps.caller,scope);
  if(!after||after.actorId!==binding.actorId||after.clientId!==binding.clientId||after.tenantId!==binding.tenantId||!current())return {state:'unverified'};
  // A late restriction does not undo the saved appointment. Retain its real
  // result while withholding provider follow-ups. A replay ALWAYS withholds.
  const followupsAllowed=!replayed&&await deps.executionAllowed();
  if(!current())return {state:'unverified'};
  return {state:'saved',booking,replayed,execution:followupsAllowed?actualExecution:null};
 }catch{return dispatched?{state:'unverified'}:{state:'refused',reason:'unavailable'};}
}
