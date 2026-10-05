/** Execute the actual shared-handler Sales branch/cancellation function with injected storage.
 * This proves decline failure containment, not a hosted Chat/authority drive. */
import {readFileSync} from 'node:fs';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {describe,it,expect} from 'vitest';
import {SALES_INVOICE_TOOL_NAMES} from '../../supabase/functions/_shared/sales-invoice-chat';
import {SALES_COLLECTIONS_TOOL_NAMES} from '../../supabase/functions/_shared/sales-collections-chat';
const source=readFileSync('supabase/functions/paige-ai-chat/index.ts','utf8');
const compile=(code:string)=>transpileModule(code,{compilerOptions:{module:ModuleKind.None,target:ScriptTarget.ES2022}}).outputText;
const start=source.indexOf('if (SALES_INVOICE_TOOL_NAMES.has(tc.function.name) || SALES_COLLECTIONS_TOOL_NAMES.has(tc.function.name)) {');
const end=source.indexOf('// ── THE ONE PUBLISH DOOR',start);
if(start<0||end<=start)throw Error('Actual Sales dispatch branch missing');
const branch=compile(`return (async()=>{for(const tc of toolCalls){${source.slice(start,end)}}return toolResults})()`);
async function dispatch(cancellationsRecorded:boolean,current=true,toolName='billing_create_invoice'){
 const calls:unknown[]=[];const run=async(ctx:unknown,deps:unknown)=>{calls.push({ctx,deps});return {content:{success:true},tokens:[]}};
 const bindings={cancellationsRecorded,revalidateProposalScope:async()=>current,SALES_INVOICE_TOOL_NAMES,SALES_COLLECTIONS_TOOL_NAMES,toolCalls:[{id:'test-call',function:{name:toolName,arguments:'{}'}}],toolResults:[],messages:[{role:'user',content:'Create the draft'}],personaCtx:{tenant_id:'test-tenant'},user:{id:'test-actor'},approvedConfirmations:new Set(),payloadThreadId:'test-thread',dispatchSalesInvoiceChat:run,dispatchSalesCollectionsChat:run,supabase:{},supabaseClient:{caller:'authenticated'},supabaseUrl:'test',supabaseServiceKey:'fixture',createClient:()=>({from:()=>({select:()=>({})})}),approvalTokenTool:new Map(),approvalRefusals:new Map()};
 const results=await new Function(...Object.keys(bindings),branch)(...Object.values(bindings)) as {content:string}[];
 return {calls,caller:bindings.supabaseClient,result:JSON.parse(results[0].content)};
}
const cancelStart=source.indexOf('const cancelConfirmations = async');
const cancelEnd=source.indexOf('const cancellationsRecorded = await cancelConfirmations',cancelStart);
if(cancelStart<0||cancelEnd<=cancelStart)throw Error('Actual canonical cancellation function missing');
const cancelBody=compile(`${source.slice(cancelStart,cancelEnd)}return cancelConfirmations(fps);`);
async function cancel(error:unknown=null,current=true){
 const queries:unknown[][]=[];const query:Record<string,unknown>={};
 for(const method of ['update','eq','in','is','not'])query[method]=(...args:unknown[])=>{queries.push([method,...args]);return query};
 query.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({error}).then(resolve);
 const bindings={fps:['0123456789abcdef'],revalidateProposalScope:async()=>current,selectedConfirmationNonce:async()=>null,supabase:{from:()=>query},personaCtx:{tenant_id:'test-tenant'},user:{id:'test-actor'},payloadThreadId:'test-thread',scopedClientId:null,CRM_COMMAND_TOOL_NAMES:new Set(['crm_create_contact']),SALES_INVOICE_TOOL_NAMES,SALES_COLLECTIONS_TOOL_NAMES,console:{error:()=>{}}};
 return {recorded:await new Function(...Object.keys(bindings),cancelBody)(...Object.values(bindings)),queries};
}
describe('actual Sales Chat cancellation containment',()=>{
 it('failed decline persistence blocks ordinary draft create/revise before the AUTO-capable endpoint',async()=>{for(const tool of ['billing_create_invoice','sales_revise_invoice_draft']){const r=await dispatch(false,true,tool);expect(r.calls).toEqual([]);expect(r.result).toMatchObject({success:false,not_applied:true,error:'confirmation_context_unavailable'})}});
 it('a changed workspace refuses without a Sales command',async()=>{expect((await dispatch(true,false)).calls).toEqual([])});
 it('recorded declines and current scope retain the same Sales dispatch',async()=>{const r=await dispatch(true);expect(r.calls).toHaveLength(1);expect(r.calls[0]).toMatchObject({deps:{caller:r.caller}})});
 it('threaded Not now consumes only the exact actor/tenant NULL-scope Sales/CRM action-door fingerprints',async()=>{const r=await cancel();expect(r.recorded).toBe(true);expect(r.queries).toContainEqual(['eq','user_id','test-actor']);expect(r.queries).toContainEqual(['eq','tenant_id','test-tenant']);expect(r.queries).toContainEqual(['in','fingerprint',['0123456789abcdef']]);for(const key of ['thread_id','scoped_client_id','consumed_at'])expect(r.queries).toContainEqual(['is',key,null]);expect(r.queries).toContainEqual(['not','server_issued_at','is',null]);const allowed=r.queries.find(q=>q[0]==='in'&&q[1]==='tool_name')?.[2] as string[];expect(allowed).toContain('billing_create_invoice');expect(allowed).toContain('sales_revise_invoice_draft');expect(allowed).toContain('sales_save_collection_terms');expect(allowed).not.toContain('unrelated_tool')});
 it('failed cancellation writes and scope changes return false',async()=>{expect((await cancel({code:'failure'})).recorded).toBe(false);const r=await cancel(null,false);expect(r.recorded).toBe(false);expect(r.queries).toEqual([])});
});
