import {readLinkedPortalClient,type ClientDeliveryPortalPort,type LinkedPortalClient} from './client-delivery-portal';

type Target=Readonly<{tenantId:string;clientId:string;invoiceId:string}>;
export type ClientInvoiceDocumentPort=ClientDeliveryPortalPort&{
  auth:ClientDeliveryPortalPort['auth']&{getSession():PromiseLike<{
    data:{session:{access_token:string;user:{id:string}}|null};error:unknown;
  }>};
};
type Request=Readonly<{target:Target;headers:Readonly<{Authorization:string}>}>;
export type ClientInvoiceRead<T>={kind:'ready';scope:LinkedPortalClient;value:T}|{kind:'refused'|'unavailable'|'scope_changed'};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const same=(a:LinkedPortalClient,b:LinkedPortalClient)=>a.actorId===b.actorId&&a.tenantId===b.tenantId&&a.clientId===b.clientId;

/** Existing session token is transport only. Actual user/self-link is re-proved
 * around each read; no token is minted, persisted, put in a URL or returned. */
export async function withClientInvoiceRead<T>(
  caller:ClientInvoiceDocumentPort,target:Target,current:()=>boolean,read:(request:Request)=>Promise<T>,
):Promise<ClientInvoiceRead<T>>{
  const selected=Object.freeze({...target});
  if(!current())return {kind:'scope_changed'};
  if(![selected.tenantId,selected.clientId,selected.invoiceId].every(uuid))return {kind:'refused'};
  try{
    const user=await caller.auth.getUser();
    if(!current())return {kind:'scope_changed'};
    const actor=user.data?.user?.id;
    if(user.error||!uuid(actor))return {kind:'refused'};
    const before=await readLinkedPortalClient(caller,actor,current);
    if(!current())return {kind:'scope_changed'};
    if(before.kind!=='ready')return {kind:before.kind==='unavailable'?'unavailable':'refused'};
    if(before.scope.tenantId!==selected.tenantId||before.scope.clientId!==selected.clientId)return {kind:'refused'};
    const session=await caller.auth.getSession();
    if(!current())return {kind:'scope_changed'};
    if(session.error||session.data?.session?.user.id!==actor||!session.data.session.access_token)return {kind:'refused'};
    const value=await read({target:selected,headers:{Authorization:`Bearer ${session.data.session.access_token}`}});
    if(!current())return {kind:'scope_changed'};
    const after=await readLinkedPortalClient(caller,actor,current);
    if(!current())return {kind:'scope_changed'};
    if(after.kind!=='ready')return {kind:after.kind==='unavailable'?'unavailable':'refused'};
    if(!same(before.scope,after.scope))return {kind:'refused'};
    return {kind:'ready',scope:after.scope,value};
  }catch{return {kind:current()?'unavailable':'scope_changed'};}
}
