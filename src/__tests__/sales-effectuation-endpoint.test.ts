import {readFileSync} from 'node:fs';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {describe,it,expect} from 'vitest';
import {COLLECTION_ACTIONS,UUID,object as isRecord,parseCollectionCommand} from '../../supabase/functions/_shared/sales-collections/contract';
import {SALES_COLLECTION_KIT_BY_ACTION} from '../../supabase/functions/_shared/paige-spine/domains/sales_collections';
import {decideDeclaredCapability} from '../../supabase/functions/_shared/capability-kit/decision';
import {confirmFingerprint} from '../../supabase/functions/_shared/confirm-fingerprint';
import {databaseAnswered} from '../../supabase/functions/_shared/approval-outcome';
import {readCommercialEffectuationConsequence,hasCommercialEffectuationReceipt} from '../../supabase/functions/_shared/sales-commercial/effectuation-command';
import {commercialTermsSummary} from '../../supabase/functions/_shared/sales-commercial/terms-summary';
const tenant='aaaaaaaa-0000-4000-8000-000000000001',actor='11111111-0000-4000-8000-000000000001',op='77777777-0000-4000-8000-000000000001';
const command={action:'collection.effectuate_terms',agreement_id:'55555555-0000-4000-8000-000000000001',expected_version:3,expected_updated_at:'2026-10-15T05:17:00.123456+00:00',
 signing_id:'99999999-0000-4000-8000-000000000001',signing_version:4,invoice_id:'66666666-0000-4000-8000-000000000001',invoice_draft_version:2,payload_digest:'a'.repeat(64),sealed_sha256:'b'.repeat(64)};
const consequence={agreement_id:command.agreement_id,signing_id:command.signing_id,signing_version:4,terms_version:3,invoice_id:command.invoice_id,payload_digest:command.payload_digest,sealed_sha256:command.sealed_sha256,
 expected_updated_at:command.expected_updated_at,invoice_draft_version:2,client_id:'33333333-0000-4000-8000-000000000001',amount_cents:350000,currency:'usd',starts_on:'2026-10-15',state_before:'draft',state_after:'active',effect:'activate_matching_terms'};
const body={expected_tenant_id:tenant,operation_id:op,command};
const receipt=()=>({ok:true,outcome:'commercial_terms_effectuated',historical_receipt:true,receipt_id:'88888888-0000-4000-8000-000000000001',
 row:{id:command.agreement_id,tenant_id:tenant,status_at_execution:'active',signing_id:command.signing_id,signing_version:command.signing_version,terms_version:command.expected_version,effective_at:'2026-10-15T05:17:00Z',source_digest:command.payload_digest,actor_user_id:actor,effect:'activate_matching_terms'},operation:{id:op,action:command.action}});
const source=readFileSync('supabase/functions/sales-collection-command/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
const compiled=transpileModule(source,{compilerOptions:{module:ModuleKind.None,target:ScriptTarget.ES2022}}).outputText;
type Options={authenticated?:boolean;anonymous?:boolean;role?:string;lane?:string;current?:string;claimed?:unknown;preview?:unknown;replay?:unknown;result?:unknown;auditFails?:boolean;executeError?:unknown;currentSequence?:string[]};
function setup(options:Options={}){
 let handler:(request:Request)=>Promise<Response>=async()=>new Response();let scopeRead=0;
 const calls:{name:string;args:unknown}[]=[];
 const caller={auth:{getUser:async()=>({data:{user:options.authenticated===false?null:{id:actor,is_anonymous:options.anonymous===true}},error:null})},rpc:async(name:string)=>({data:name==='current_user_tenant_id'?options.currentSequence?.[scopeRead++]??options.current??tenant:options.lane??'confirm',error:null})};
 const admin={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:name==='read_sales_collection_command_result'?options.replay??null:name==='preview_sales_collection_command'?options.preview??{eligible:true,summary:'Matching signed terms',consequence}:options.result??receipt(),error:name==='execute_sales_collection_command'?options.executeError??null:null};},from:(table:string)=>{
  let mutation='',inserted:Record<string,unknown>={};const filters:unknown[]=[];const query:Record<string,unknown>={};
  for(const method of ['eq','is','not','neq','gt','lte','contains','order','limit'])query[method]=(...args:unknown[])=>{filters.push([method,...args]);return query;};
  query.select=()=>query;query.update=()=>{mutation='update';return query;};query.insert=(args:Record<string,unknown>)=>{mutation='insert';inserted=args;calls.push({name:'insert:'+table,args});return query;};
  query.maybeSingle=async()=>{if(table==='paige_pending_confirmations')calls.push({name:`query:${mutation||'select'}:${table}`,args:filters});return {data:table==='tenant_members'?{role:options.role??'owner',status:'active'}:table==='paige_pending_confirmations'&&mutation==='insert'?{summary:inserted.summary,expires_at:inserted.expires_at}:table==='paige_pending_confirmations'&&mutation==='update'&&options.claimed?{args:options.claimed}:null,error:null};};
  query.then=(resolve:(v:unknown)=>unknown,reject:(v:unknown)=>unknown)=>Promise.resolve({error:table==='paige_audit_log'&&options.auditFails?{code:'synthetic-failure'}:null}).then(resolve,reject);
  return query;
 }};
 const bindings={Deno:{env:{get:(key:string)=>key},serve:(value:typeof handler)=>handler=value},createClient:(_url:string,key:string)=>key==='SUPABASE_ANON_KEY'?caller:admin,
  COLLECTION_ACTIONS,UUID,parseCollectionCommand,SALES_COLLECTION_KIT_BY_ACTION,decideDeclaredCapability,confirmFingerprint,databaseAnswered,readCommercialEffectuationConsequence,hasCommercialEffectuationReceipt,commercialTermsSummary};
 new Function(...Object.keys(bindings),compiled)(...Object.values(bindings));
 return {calls,invoke:async(input:Record<string,unknown>=body)=>{const result=await handler(new Request('https://synthetic.invalid/collection',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(input)}));return {status:result.status,body:await result.json()};}};
}
describe('actual Collections handler, controlled ports and real Kit/fingerprint',()=>{
 it.each(['auto','confirm'])('requires canonical high confirmation with %s and binds the complete exact source',async lane=>{
  const h=setup({lane});const result=await h.invoke();expect(result.status).toBe(202);expect(result.body.outcome).toBe('approval_required');
  const pending=h.calls.find(c=>c.name==='insert:paige_pending_confirmations')!.args as Record<string,unknown>;
  if(!isRecord(pending.args))throw Error('Canonical proposal args required');
  expect(result.body.fingerprint).toBe(await confirmFingerprint('sales_effectuate_commercial_terms',pending.args));
  expect(pending).toMatchObject({user_id:actor,tenant_id:tenant,thread_id:null,scoped_client_id:null,tool_name:'sales_effectuate_commercial_terms',args:{command,operation_id:op,expected_tenant_id:tenant}});
  expect(h.calls.some(c=>c.name==='execute_sales_collection_command')).toBe(false);expect(JSON.stringify(pending)).not.toContain('body_markdown');
 });
 it('a changed signed source changes the actual canonical fingerprint',async()=>{
  const a=setup(),b=setup({preview:{eligible:true,summary:'Matching signed terms',consequence:{...consequence,sealed_sha256:'c'.repeat(64)}}});
  const first=await a.invoke(),second=await b.invoke({...body,command:{...command,sealed_sha256:'c'.repeat(64)}});expect(second.status).toBe(202);expect(first.body.fingerprint).not.toBe(second.body.fingerprint);
 });
 it.each([{authenticated:false},{anonymous:true},{role:'member'},{lane:'off'},{current:'bbbbbbbb-0000-4000-8000-000000000002'}])('refuses missing current authority %s',async options=>{
  const h=setup(options);const result=await h.invoke();expect([401,403,409]).toContain(result.status);expect(h.calls.some(c=>c.name==='execute_sales_collection_command')).toBe(false);
 });
 it.each([null,{...consequence,signing_id:command.agreement_id},{...consequence,amount_cents:-1}])('will not mint approval with missing or wrong consequence %s',async value=>{
  const h=setup({preview:{eligible:true,summary:'Untrusted partial summary',consequence:value}});const result=await h.invoke();expect(result.status).toBe(422);expect(result.body.code).toBe('COMMERCIAL_REVIEW_CONTEXT_UNAVAILABLE');expect(h.calls.some(c=>c.name==='insert:paige_pending_confirmations')).toBe(false);
 });
 it('missing start/source facts give a bounded correction route without inventing values',async()=>{
  const h=setup({preview:{eligible:false}});const result=await h.invoke();expect(result.status).toBe(422);expect(result.body.message).toContain('commercial start date');expect(h.calls.some(c=>c.name==='execute_sales_collection_command')).toBe(false);
 });
 it('passes only the server-claimed exact command and derived governance to the canonical writer',async()=>{
  const claimed={command,operation_id:op,expected_tenant_id:tenant,approval_subject:`${command.action}:${command.agreement_id}`,approval_cycle_nonce:'22222222-0000-4000-8000-000000000001'};
  const h=setup({claimed});const result=await h.invoke({...body,approved_fingerprint:'0123456789abcdef'});expect(result.status).toBe(200);
  expect(h.calls.find(c=>c.name==='execute_sales_collection_command')!.args).toMatchObject({_actor_user_id:actor,_expected_tenant_id:tenant,_operation_id:op,_command:command,
   _governance:{actor_user_id:actor,tenant_id:tenant,tool:'sales_effectuate_commercial_terms',action:command.action,approval_channel:'operator_card',approved_fingerprint:'0123456789abcdef',decision_receipt_recorded:true}});
 });
 it('a bare fingerprint with no server claim cannot execute',async()=>{
  const h=setup();await h.invoke({...body,approved_fingerprint:'0123456789abcdef'});expect(h.calls.some(c=>c.name==='execute_sales_collection_command')).toBe(false);
 });
 it('audit failure prevents the business writer',async()=>{const h=setup({auditFails:true});expect((await h.invoke()).status).toBe(503);expect(h.calls.some(c=>c.name==='execute_sales_collection_command')).toBe(false);});
 it('returns original durable history before current eligibility or approval redemption',async()=>{
  const replay=receipt();
  const h=setup({replay,preview:{eligible:false}});const result=await h.invoke();expect(result.status).toBe(200);expect(result.body).toMatchObject({...replay,replayed:true});expect(h.calls.map(c=>c.name)).toEqual(['read_sales_collection_command_result']);
 });
 it.each([{actor_user_id:actor},{governance:{approved:true}},{command:{...command,status:'active'}}])('refuses client-authored authority or arbitrary state %s',async extra=>{const h=setup();expect((await h.invoke({...body,...extra})).status).toBe(400);expect(h.calls).toHaveLength(0);});
 it.each([{ok:true},{...receipt(),receipt_id:null},{...receipt(),row:{...receipt().row,tenant_id:'bbbbbbbb-0000-4000-8000-000000000002'}}])('treats unverifiable stored success as unknown while retaining the original operation %s',async replay=>{
  const h=setup({replay});const result=await h.invoke();expect(result.status).toBe(503);expect(result.body).toMatchObject({ok:false,outcome:'outcome_unknown',operation_id:op});expect(h.calls.map(c=>c.name)).toEqual(['read_sales_collection_command_result']);
 });
});
