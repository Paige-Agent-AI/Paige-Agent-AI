// @vitest-environment node
import {readFileSync} from 'node:fs';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {it,expect} from 'vitest';
import {e04CommercialFixture,e04Id} from '../test/fixtures/e04-commercial-presentation';
import {COLLECTION_ACTIONS,UUID,parseCollectionCommand} from '../../supabase/functions/_shared/sales-collections/contract';
import {SALES_COLLECTION_KIT_BY_ACTION} from '../../supabase/functions/_shared/paige-spine/domains/sales_collections';
import {decideDeclaredCapability} from '../../supabase/functions/_shared/capability-kit/decision';
import {confirmFingerprint} from '../../supabase/functions/_shared/confirm-fingerprint';
import {databaseAnswered} from '../../supabase/functions/_shared/approval-outcome';
import {commercialTermsSummary} from '../../supabase/functions/_shared/sales-commercial/terms-summary';
import {readCommercialEffectuationConsequence,hasCommercialEffectuationReceipt} from '../../supabase/functions/_shared/sales-commercial/effectuation-command';
import {commercialPreparationCommand,readCommercialPreparationConsequence,hasCommercialPreparationReceipt} from '../../supabase/functions/_shared/sales-commercial/preparation-command';
import {prepareCommercialPresentationFromRecords} from '../../supabase/functions/_shared/agreements/commercial-presentation-read';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/commercial-presentation';
import {AgreementPreparationUnavailable} from '../../supabase/functions/_shared/agreements/prepare-retained';
import {preparationReviewDocument,readPreparationReviewDocument} from '../../supabase/functions/_shared/agreements/preparation-review';
import {sha256Hex} from '../../supabase/functions/_shared/agreements/token';

const source=readFileSync('supabase/functions/sales-collection-command/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
const compiled=transpileModule(source,{compilerOptions:{module:ModuleKind.None,target:ScriptTarget.ES2022}}).outputText;
type Options={role?:string;lane?:string;anonymous?:boolean;current?:string;claimed?:boolean;replay?:unknown;result?:unknown;consequence?:unknown;artifactFailure?:string;auditFails?:boolean;executeError?:unknown;sourceChanged?:boolean};
async function setup(options:Options={}){
 const f=await e04CommercialFixture(),actor=e04Id(9),calls:Array<{name:string;args:unknown}>=[];
 let handler:(request:Request)=>Promise<Response>=async()=>new Response();
 const command=f.command,body={expected_tenant_id:f.tenant,operation_id:f.operation,command};
 const artifact={payload:f.proposed.presentation.payload,payload_digest:command.payload_digest,presented_body_markdown:f.proposed.presented_body_markdown,
  presented_body_sha256:await sha256Hex(f.proposed.presented_body_markdown),content_storage_key:`${f.tenant}/${f.agreement}/presented-commercial-${f.operation}-${command.payload_digest}.pdf`,document_sha256:'a'.repeat(64)};
 const result={ok:true,outcome:'agreement_prepared',historical_receipt:true,receipt_id:e04Id(8),row:{id:f.agreement,tenant_id:f.tenant,version_at_preparation:4,
  invoice_id:f.invoice,invoice_version:1,invoice_draft_version:2,terms_id:f.terms,terms_version:3,client_id:f.client,offer_id:f.offer,payload_digest:command.payload_digest,
  document_sha256:artifact.document_sha256,prepared_at:'2026-10-15T00:00:00Z',actor_user_id:actor},operation:{id:f.operation,action:command.action}};
 if(options.sourceChanged)f.rows.paige_agreements.body_markdown='Different current wording';
 const caller={from:f.caller.from,auth:{getUser:async()=>({data:{user:{id:actor,is_anonymous:options.anonymous===true}},error:null})},
  rpc:async(name:string)=>({data:name==='current_user_tenant_id'?options.current??f.tenant:name==='is_tenant_admin'?true:options.lane??'confirm',error:null})};
 const consequence={...command,kind:'retain_signing_document',principal_minor:350000,currency:'usd',engagement:f.proposed.presentation.payload.engagement};
 const claimed={command,operation_id:f.operation,expected_tenant_id:f.tenant,approval_subject:`${command.action}:${command.agreement_id}`,approval_cycle_nonce:e04Id(10)};
 const admin={storage:{controlledPort:true},rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:name==='read_sales_collection_command_result'?options.replay??null:
   name==='preview_sales_collection_command'?{eligible:true,summary:'Retain exactly reviewed document',consequence:options.consequence===undefined?consequence:options.consequence}:options.result??result,
   error:name==='execute_sales_agreement_preparation'?options.executeError??null:null};},from:(table:string)=>{
  let mutation='',inserted:Record<string,unknown>={};const query:Record<string,unknown>={};
  for(const method of ['eq','is','not','neq','gt','lte','contains','order','limit'])query[method]=()=>query;
  query.select=()=>query;query.update=()=>{mutation='update';return query;};query.insert=(args:Record<string,unknown>)=>{mutation='insert';inserted=args;calls.push({name:'insert:'+table,args});return query;};
  query.maybeSingle=async()=>({data:table==='tenant_members'?{role:options.role??'owner',status:'active'}:table==='paige_pending_confirmations'&&mutation==='insert'?{summary:inserted.summary,expires_at:inserted.expires_at}:table==='paige_pending_confirmations'&&mutation==='update'&&options.claimed?{args:claimed}:null,error:null});
  query.then=(resolve:(v:unknown)=>unknown,reject:(v:unknown)=>unknown)=>Promise.resolve({error:table==='paige_audit_log'&&options.auditFails?{code:'synthetic-audit-refusal'}:null}).then(resolve,reject);return query;
 }};
 const prepareRetainedAgreementArtifact=async(...args:unknown[])=>{calls.push({name:'artifact',args});if(options.artifactFailure)throw new AgreementPreparationUnavailable(options.artifactFailure as 'SOURCE_CHANGED');return artifact;};
 const bindings={Deno:{env:{get:(key:string)=>key},serve:(value:typeof handler)=>handler=value},createClient:(_url:string,key:string)=>key==='SUPABASE_ANON_KEY'?caller:admin,
  COLLECTION_ACTIONS,UUID,parseCollectionCommand,SALES_COLLECTION_KIT_BY_ACTION,decideDeclaredCapability,confirmFingerprint,databaseAnswered,commercialTermsSummary,
  readCommercialEffectuationConsequence,hasCommercialEffectuationReceipt,commercialPreparationCommand,readCommercialPreparationConsequence,hasCommercialPreparationReceipt,
  prepareCommercialPresentationFromRecords,canonicalPresentationJson,preparationReviewDocument,readPreparationReviewDocument,AgreementPreparationUnavailable,prepareRetainedAgreementArtifact};
 new Function(...Object.keys(bindings),compiled)(...Object.values(bindings));
 return {...f,actor,body,artifact,result,calls,invoke:async(input:Record<string,unknown>=body)=>{const r=await handler(new Request('https://synthetic.invalid/preparation',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(input)}));return {status:r.status,body:await r.json()};}};
}
it('uses real source/Kit/fingerprint to propose high-risk review without artifact or business writes',async()=>{
 const h=await setup({lane:'auto'}),r=await h.invoke();expect(r.status).toBe(202);expect(r.body.fingerprint).toMatch(/^[a-f0-9]{16}$/);
 const decision=h.calls.find(c=>c.name==='insert:paige_audit_log')!.args as {payload:Record<string,unknown>};expect(decision.payload).toMatchObject({risk:'high',lane_effective:'confirm',clamped:true});
 expect(h.calls.some(c=>c.name==='artifact'||c.name==='execute_sales_agreement_preparation')).toBe(false);
 const proposal=h.calls.find(c=>c.name==='insert:paige_pending_confirmations')!.args;expect(JSON.stringify(proposal)).not.toMatch(/body_markdown|content_storage_key|document_sha256/);
});
it.each([{anonymous:true},{role:'member'},{lane:'off'},{current:e04Id(99)}])('refuses missing ordinary current authority %s',async options=>{
 const h=await setup(options),r=await h.invoke();expect([401,403,409]).toContain(r.status);expect(h.calls.some(c=>c.name==='artifact')).toBe(false);
});
it('refuses changed canonical source and wrong consequence before minting a card',async()=>{
 for(const options of [{sourceChanged:true},{consequence:null}]){const h=await setup(options),r=await h.invoke();expect([409,422]).toContain(r.status);expect(h.calls.some(c=>c.name==='insert:paige_pending_confirmations'||c.name==='artifact')).toBe(false);}
});
it('prepares only after a real claimed approval and supplies server artifact/actor to the existing canonical transaction',async()=>{
 const h=await setup({claimed:true}),r=await h.invoke({...h.body,approved_fingerprint:'0123456789abcdef'});expect(r.status).toBe(200);
 expect(h.calls.find(c=>c.name==='execute_sales_agreement_preparation')!.args).toMatchObject({_actor_user_id:h.actor,_expected_tenant_id:h.tenant,_operation_id:h.operation,_command:h.command,_prepared:h.artifact,
  _governance:{tool:'sales_prepare_agreement',approval_channel:'operator_card',approved_fingerprint:'0123456789abcdef',decision_receipt_recorded:true}});
 expect(h.calls.some(c=>c.name==='execute_sales_collection_command')).toBe(false);
});
it('bare approval and failed decision audit cannot reach artifact preparation',async()=>{
 for(const options of [{},{claimed:true,auditFails:true}]){const h=await setup(options);await h.invoke({...h.body,approved_fingerprint:'0123456789abcdef'});expect(h.calls.some(c=>c.name==='artifact')).toBe(false);}
});
it('recovers original exact receipt before fresh draft eligibility or artifact work',async()=>{
 const first=await setup(),h=await setup({replay:first.result,sourceChanged:true}),r=await h.invoke();expect(r.status).toBe(200);expect(r.body).toMatchObject({...first.result,replayed:true});expect(h.calls.map(c=>c.name)).toEqual(['read_sales_collection_command_result']);
});
it.each(['STORAGE_UNVERIFIED','WORKSPACE_CHANGED','SOURCE_CHANGED','RENDER_UNAVAILABLE'])('preserves truthful artifact failure %s with the same operation',async code=>{
 const h=await setup({claimed:true,artifactFailure:code}),r=await h.invoke({...h.body,approved_fingerprint:'0123456789abcdef'});expect(r.status).toBe(['SOURCE_CHANGED','RENDER_UNAVAILABLE'].includes(code)?422:503);expect(r.body.operation_id).toBe(h.operation);expect(r.body.outcome).toBe(['SOURCE_CHANGED','RENDER_UNAVAILABLE'].includes(code)?'refused':'outcome_unknown');expect(h.calls.some(c=>c.name==='execute_sales_agreement_preparation')).toBe(false);
});
it.each(['missing_receipt','wrong_document','wrong_source'])('never accepts unverifiable canonical result %s',async kind=>{
 const original=await setup(),result=structuredClone(original.result) as Record<string,unknown>;
 if(kind==='missing_receipt')result.receipt_id=null;
 if(kind==='wrong_document')(result.row as Record<string,unknown>).document_sha256='b'.repeat(64);
 if(kind==='wrong_source')(result.row as Record<string,unknown>).client_id=e04Id(99);
 const h=await setup({claimed:true,result}),r=await h.invoke({...h.body,approved_fingerprint:'0123456789abcdef'});expect(r.status).toBe(503);expect(r.body).toMatchObject({outcome:'outcome_unknown',operation_id:h.operation});
});
it.each(['_prepared','actor_user_id','governance'])('rejects browser-supplied %s before canonical reads',async key=>{
 const h=await setup(),r=await h.invoke({...h.body,[key]:h.artifact});expect(r.status).toBe(400);expect(h.calls).toHaveLength(0);
});
