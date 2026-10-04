import {readFileSync} from 'node:fs';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {it,expect} from 'vitest';
import {decideDeclaredCapability} from '../../../../supabase/functions/_shared/capability-kit/decision';
import {SALES_COLLECTION_KIT_BY_ACTION} from '../../../../supabase/functions/_shared/paige-spine/domains/sales_collections';
import {UUID,COLLECTION_ACTIONS,parseCollectionCommand} from '../../../../supabase/functions/_shared/sales-collections/contract';
const tenant='11111111-1111-4111-8111-111111111111',operation='22222222-2222-4222-8222-222222222222';
const command={action:'collection.commit_import',batch_id:'33333333-3333-4333-8333-333333333333',expected_digest:'a'.repeat(64)};
const source=readFileSync('supabase/functions/sales-collection-command/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
const compiled=transpileModule(source,{compilerOptions:{module:ModuleKind.None,target:ScriptTarget.ES2022}}).outputText;
function setup(options:{role?:string;tenant?:string;replay?:unknown;claimed?:unknown;auditFails?:boolean}={}){
 let handler!:(r:Request)=>Promise<Response>;const calls:{name:string;args:unknown}[]=[];
 const caller={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},rpc:async(name:string)=>({data:name==='current_user_tenant_id'?options.tenant??tenant:'auto',error:null})};
 const admin={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:name==='read_sales_collection_command_result'?options.replay??null:name==='preview_sales_collection_command'?{eligible:true,summary:'Review exact import'}:{ok:true,batch:{id:command.batch_id}},error:null}},from:(table:string)=>{
  let mutation='';const builder:Record<string,unknown>={};for(const method of ['eq','is','not','neq','gt','lte','contains','order','limit'])builder[method]=()=>builder;
  builder.select=()=>builder;builder.update=()=>{mutation='update';return builder};builder.insert=(args:unknown)=>{calls.push({name:'insert:'+table,args});mutation='insert';return builder};
  builder.maybeSingle=async()=>({data:table==='tenant_members'?{role:options.role??'owner',status:'active'}:mutation==='update'?options.claimed?{args:options.claimed}:null:mutation==='insert'?{summary:'Review import',expires_at:'2099-01-01T00:00:00Z'}:null,error:null});
  builder.then=(resolve:(v:unknown)=>unknown,reject:(v:unknown)=>unknown)=>Promise.resolve({error:table==='paige_audit_log'&&options.auditFails?{code:'failure'}:null}).then(resolve,reject);return builder;
 }};
 const scope={Deno:{env:{get:(key:string)=>key},serve:(fn:typeof handler)=>{handler=fn}},createClient:(_url:string,key:string)=>key==='SUPABASE_ANON_KEY'?caller:admin,confirmFingerprint:async()=>'0123456789abcdef',decideDeclaredCapability,SALES_COLLECTION_KIT_BY_ACTION,databaseAnswered:()=>true,UUID,COLLECTION_ACTIONS,parseCollectionCommand};
 new Function(...Object.keys(scope),compiled)(...Object.values(scope));
 return {calls,request:async(extra:Record<string,unknown>={})=>{const response=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({expected_tenant_id:tenant,operation_id:operation,command,...extra})}));return {status:response.status,body:await response.json()}}};
}
it('actual collection endpoint refuses readonly and switched workspace before any commercial RPC',async()=>{
 for(const options of [{role:'member'},{tenant:'other'}]){const test=setup(options);expect((await test.request()).status).toBeGreaterThanOrEqual(400);expect(test.calls).toEqual([])}
});
it('actual collection endpoint replays exact committed import before eligibility or approval',async()=>{
 const test=setup({replay:{ok:true,batch:{id:command.batch_id}}});expect((await test.request()).body.replayed).toBe(true);expect(test.calls.map(c=>c.name)).toEqual(['read_sales_collection_command_result']);
});
it('auto never executes a commercial import and actor-authored governance is rejected',async()=>{
 const test=setup();expect((await test.request()).body.outcome).toBe('approval_required');expect(test.calls.some(c=>c.name==='execute_sales_collection_command')).toBe(false);
 expect((await test.request({governance:{approved:true}})).status).toBe(400);
});
it('missing claimed approval and failed decision receipt cannot reach the business writer',async()=>{
 const test=setup();expect((await test.request({approved_fingerprint:'0123456789abcdef'})).body.outcome).toBe('approval_required');expect(test.calls.some(c=>c.name==='execute_sales_collection_command')).toBe(false);
 const failed=setup({auditFails:true});expect((await failed.request()).body.code).toBe('SALES_DECISION_RECEIPT_FAILED');expect(failed.calls.some(c=>c.name==='execute_sales_collection_command')).toBe(false);
});
it('a canonical stored approval executes the exact reviewed digest with server actor and tenant',async()=>{
 const args={command,operation_id:operation,expected_tenant_id:tenant,approval_subject:`collection.commit_import:${command.batch_id}`};
 const test=setup({claimed:args});expect((await test.request({approved_fingerprint:'0123456789abcdef'})).body.ok).toBe(true);
 expect(test.calls.find(c=>c.name==='execute_sales_collection_command')?.args).toMatchObject({_actor_user_id:'owner',_expected_tenant_id:tenant,_operation_id:operation,_command:command,_governance:{decision_receipt_recorded:true,tool:'sales_commit_collection_import'}});
});
