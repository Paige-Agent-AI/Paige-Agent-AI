import {supabase as acceptedReads,scenario as acceptedScenario,id} from '../e04-accepted-commercial-ui/sdk';
import {parseCommercialEffectuationCommand} from '../../../supabase/functions/_shared/sales-commercial/effectuation-command';
export {id};
type Result=Record<string,unknown>;
const operations=new Map<string,Result>(),listeners=new Set<()=>void>();
export const scenario={mode:'ready',writes:0,applied:false,lastOperation:id(11),calls:[] as {name:string;body:unknown}[],reset(mode:string){
 this.mode=mode;this.applied=mode==='recorded';this.writes=this.applied?1:0;this.calls=[];operations.clear();sessionStorage.clear();
 acceptedScenario.mode=['changed','denied','unverified','pending'].includes(mode)?mode:'recorded';
 },retireActor(){for(const callback of [...listeners])callback();}};
const consequence=(c:ReturnType<typeof parseCommercialEffectuationCommand>)=>({agreement_id:c.agreement_id,signing_id:c.signing_id,signing_version:c.signing_version,
 terms_version:c.expected_version,invoice_id:c.invoice_id,payload_digest:c.payload_digest,sealed_sha256:c.sealed_sha256,expected_updated_at:c.expected_updated_at,
 invoice_draft_version:c.invoice_draft_version,client_id:id(2),amount_cents:350000,currency:'usd',starts_on:'2026-10-15',state_before:'draft',state_after:'active',effect:'activate_matching_terms'});
export const supabase={
 auth:{getSession:async()=>({data:{session:{user:{id:id(10)}}}}),onAuthStateChange(callback:()=>void){listeners.add(callback);return {data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};}},
 async rpc(name:string){
  const result=await acceptedReads.rpc(name);
  if(name==='read_sales_commercial_package'&&result.data&&'commercial_terms' in result.data){
   const row=result.data.commercial_terms;Object.assign(row,{status:scenario.applied?'active':'draft',effective_provenance:scenario.applied?{signing_id:id(3),terms_version:3,recorded_at:'2026-10-15T05:17:00Z',operation_id:scenario.lastOperation}:null});
  }
  return result;
 },
 functions:{async invoke(name:string,args:{body:Record<string,unknown>}){
  if(name!=='sales-collection-command')throw Error('Unexpected synthetic door');
  const body=args.body,c=parseCommercialEffectuationCommand(body.command);scenario.calls.push({name,body:structuredClone(body)});
  if(body.expected_tenant_id!==id(1)||typeof body.operation_id!=='string')throw Error('Wrong synthetic scope');
  const prior=operations.get(body.operation_id);if(prior)return {data:{...prior,replayed:true},error:null};
  if(scenario.mode==='off')return {data:{ok:false,outcome:'refused',message:'This governed capability is unavailable. The terms remain unchanged.'},error:null};
  if(scenario.mode==='missing')return {data:{ok:false,outcome:'refused',message:'These records cannot currently be made effective. Check the matching signed revision, commercial start date and agreed price in Terms & Agreements.'},error:null};
  if(!body.approved_fingerprint)return {data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Make the matching signed commercial terms effective. No invoice, payment request, payment, onboarding or service completion is created.',preview:{eligible:true,consequence:scenario.mode==='malformed'?{...consequence(c),sealed_sha256:'c'.repeat(64)}:consequence(c)}},error:null};
  if(scenario.mode==='receipt_failed')return {data:{ok:false,outcome:'refused',message:'The collection action could not complete. Reload its current state before trying again.'},error:null};
  scenario.applied=true;scenario.writes++;scenario.lastOperation=body.operation_id;
  const result={ok:true,outcome:'commercial_terms_effectuated',historical_receipt:true,receipt_id:id(12),row:{id:c.agreement_id,tenant_id:id(1),status_at_execution:'active',signing_id:c.signing_id,signing_version:c.signing_version,terms_version:c.expected_version,effective_at:'2026-10-15T05:17:00Z',source_digest:c.payload_digest,actor_user_id:id(10),effect:'activate_matching_terms'},operation:{id:body.operation_id,action:c.action}};
  operations.set(body.operation_id,result);
  if(scenario.mode==='unknown')throw Error('Synthetic interrupted response');
  return {data:result,error:null};
 }},
};
