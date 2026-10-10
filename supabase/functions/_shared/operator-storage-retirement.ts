// Generated-audio cache only. Reviewed paths come from the private canonical journal,
// never browser input. All byte removal uses Storage API; no SQL metadata deletion.
type ObjectRef={id:string;name:string;fingerprint:string};
type StorageClient={storage:{from:(bucket:string)=>{remove:(paths:string[])=>Promise<{error:unknown}>;list:(prefix:string,options:{limit:number;offset:number})=>Promise<{data:{name:string}[]|null;error:unknown}>}}};
type Result={state:'verified';provider_status:'removed'}|{state:'blocked'|'unknown';reason:string};
export async function retireTenantTtsCache(admin:StorageClient,tenant:string,objects:ObjectRef[],readOnly:boolean,assertBinding:()=>Promise<boolean>):Promise<Result>{
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenant)||!Array.isArray(objects)||!objects.length||objects.length>100
  ||objects.some(o=>!o||!new RegExp('^'+tenant+'/[0-9a-f]{64}\\.mp3$').test(o.name))||new Set(objects.map(o=>o.name)).size!==objects.length)return{state:'blocked',reason:'storage_scope_invalid'};
 if(!await assertBinding())return{state:'blocked',reason:'operator_authority_changed'};
 const cache=admin.storage.from('tts-cache');
 if(!readOnly){
  // One bounded call; retry only after readback and explicit continuation. A timeout is
  // ambiguous and does not cause an automatic second remove.
  try{const r=await cache.remove(objects.map(o=>o.name));if(r.error)return{state:'unknown',reason:'storage_remove_unverified'};}
  catch{return{state:'unknown',reason:'storage_remove_unverified'};}
 }
 // The API's successful delete response alone is not absence proof. Check both API
 // inventory and the fresh server-bound SQL manifest via the claimed finalizer.
 try{
  const r=await cache.list(tenant,{limit:101,offset:0});
  if(r.error||r.data===null)return{state:'unknown',reason:'storage_readback_unavailable'};
  if(r.data.length)return{state:'unknown',reason:'storage_objects_remain'};
 }catch{return{state:'unknown',reason:'storage_readback_unavailable'};}
 if(!await assertBinding())return{state:'unknown',reason:'storage_scope_changed'};
 return{state:'verified',provider_status:'removed'};
}
