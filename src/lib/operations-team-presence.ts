export type OperationsPresenceStatus='online'|'busy'|'away'|'offline'|'unknown';
export type OperationsPresenceScope={actorId:string;tenantId:string};
export interface OperationsPresenceCaller {
 auth:{getSession:()=>PromiseLike<{data:{session:{user:{id:string}}|null};error:unknown}>};
 rpc:(name:'presence_list_effective',args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
}
export type OperationsPresenceResult=
 |{kind:'ready';actorId:string;tenantId:string;source:'presence_list_effective';availableMinutes:null;omittedCount:number;people:Array<{userId:string;status:OperationsPresenceStatus;lastSeen:string|null}>}
 |{kind:'unavailable'|'scope_changed'};
/** Existing actual-JWT Team read only; no capacity or authorization inferred from presence. */
export async function readOperationsTeamPresence(caller:OperationsPresenceCaller,scope:OperationsPresenceScope,
 members:ReadonlyArray<{user_id:string;status:string}>,isCurrent:()=>boolean):Promise<OperationsPresenceResult>{
 const current=()=>{try{return isCurrent()===true;}catch{return false;}};
 if(!current())return {kind:'scope_changed'};
 const {actorId,tenantId}=scope;
 if(!actorId||!tenantId||!Array.isArray(members))return {kind:'unavailable'};
 const memberIds=new Set<string>();
 for(const member of members){
  if(!member||typeof member.user_id!=='string'||!member.user_id||typeof member.status!=='string')return {kind:'unavailable'};
  if(member.status!=='active')continue;
  if(memberIds.has(member.user_id))return {kind:'unavailable'};
  memberIds.add(member.user_id);
 }
 try{
  const before=await caller.auth.getSession();
  if(!current()||before.error||before.data.session?.user.id!==actorId)return {kind:'scope_changed'};
  const response=await caller.rpc('presence_list_effective',{p_tenant_id:tenantId,p_window_seconds:75,p_override_ttl_seconds:43200});
  if(!current())return {kind:'scope_changed'};
  const after=await caller.auth.getSession();
  if(!current()||after.error||after.data.session?.user.id!==actorId)return {kind:'scope_changed'};
  if(response.error||!Array.isArray(response.data))return {kind:'unavailable'};
  const found=new Map<string,{status:OperationsPresenceStatus;lastSeen:string}>();let omittedCount=0;
  for(const value of response.data){
   if(!value||typeof value!=='object'||Array.isArray(value))return {kind:'unavailable'};
   const row=value as Record<string,unknown>;
   if(row.tenant_id!==tenantId||typeof row.user_id!=='string'||!row.user_id||found.has(row.user_id)
    ||typeof row.effective_status!=='string'||!['online','busy','away','offline'].includes(row.effective_status)
    ||typeof row.last_seen!=='string'||!Number.isFinite(Date.parse(row.last_seen)))return {kind:'unavailable'};
   found.set(row.user_id,{status:row.effective_status as OperationsPresenceStatus,lastSeen:row.last_seen});
   if(!memberIds.has(row.user_id))omittedCount++;
  }
  if(!current())return {kind:'scope_changed'};
  return {kind:'ready',actorId,tenantId,source:'presence_list_effective',availableMinutes:null,omittedCount,
   people:Array.from(memberIds,userId=>({userId,status:found.get(userId)?.status??'unknown',lastSeen:found.get(userId)?.lastSeen??null}))};
 }catch{return {kind:current()?'unavailable':'scope_changed'};}
}
