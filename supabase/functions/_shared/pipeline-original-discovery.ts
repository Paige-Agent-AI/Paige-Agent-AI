import type { PipelineCanonicalCaller } from './pipeline-metadata-canonical-reader.ts';
export interface PipelineOriginalScope { threadId:string; intentId:string; actorId:string; tenantId:string }
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
/** Read-only canonical lookup. Caller JSON, consumed-card existence and lost
 * responses do not establish intent lineage. The SQL resolver owns that proof.
 * This helper never dispatches, issues a receipt or settles executor ownership. */
export async function findPipelineOriginalEffect(scope:PipelineOriginalScope,caller:PipelineCanonicalCaller):Promise<string|null> {
 try {
  if(!scope||Object.keys(scope).some(key=>!['threadId','intentId','actorId','tenantId'].includes(key))||![scope.threadId,scope.intentId,scope.actorId,scope.tenantId].every(uuid))return null;
  const pin=Object.freeze({...scope});
  const user=await caller.auth.getUser();if(user.error||user.data.user?.id!==pin.actorId)return null;
  const tenant=await caller.rpc('current_user_tenant_id');if(tenant.error||tenant.data!==pin.tenantId)return null;
  const args={_thread:pin.threadId,_intent:pin.intentId};
  const reference=await caller.rpc('find_pipeline_metadata_original_effect',args);
  if(reference.error||!uuid(reference.data))return null;
  const after=await caller.auth.getUser();const current=await caller.rpc('current_user_tenant_id');
  if(after.error||current.error||after.data.user?.id!==pin.actorId||current.data!==pin.tenantId)return null;
  const final=await caller.rpc('find_pipeline_metadata_original_effect',args);
  return !final.error&&final.data===reference.data?reference.data:null;
 }catch{return null;}
}
