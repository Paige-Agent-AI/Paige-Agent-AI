/** Execute the actual shared-handler Sales branch/cancellation function with injected storage.
 * C4b: the branch now reads `doorPin` (a carried-forward approval, none here) and may call
 * `settlePinnedDoorResult`; both are injected as free variables like every other binding.
 * This proves decline failure containment, not a hosted Chat/authority drive. */
import {readFileSync} from 'node:fs';
import {transpileModule,ModuleKind,ScriptTarget,createSourceFile,isImportDeclaration,isNamedImports} from 'typescript';
import {describe,it,expect} from 'vitest';
import {SALES_INVOICE_TOOL_NAMES} from '../../supabase/functions/_shared/sales-invoice-chat';
import {SALES_COLLECTIONS_TOOL_NAMES} from '../../supabase/functions/_shared/sales-collections-chat';
import {GROWTH_PUBLISH_DOOR_TOOL_NAMES} from '../../supabase/functions/_shared/growth-publish-chat';
import {COMMS_EMAIL_TOOL_NAMES} from '../../supabase/functions/_shared/comms-email/chat';
import {WEEKLY_COMMITMENT_DRAFT_TOOL_NAME,weeklyCommitmentDraftToolsForContext} from '../../supabase/functions/_shared/paige-spine/domains/automations';
import {weeklyDraftNativeArgs} from '../../supabase/functions/_shared/paige-orchestration/weekly-draft-chat-claim';
const source=readFileSync('supabase/functions/paige-ai-chat/index.ts','utf8');
const compile=(code:string)=>transpileModule(code,{compilerOptions:{module:ModuleKind.None,target:ScriptTarget.ES2022}}).outputText;
const start=source.indexOf('if (SALES_INVOICE_TOOL_NAMES.has(tc.function.name) || SALES_COLLECTIONS_TOOL_NAMES.has(tc.function.name)) {');
const end=source.indexOf('// ── THE ONE PUBLISH DOOR',start);
if(start<0||end<=start)throw Error('Actual Sales dispatch branch missing');
const branch=compile(`return (async()=>{for(const tc of toolCalls){${source.slice(start,end)}}return toolResults})()`);
async function dispatch(cancellationsRecorded:boolean,current=true,toolName='billing_create_invoice'){
 const calls:unknown[]=[];const run=async(ctx:unknown,deps:unknown)=>{calls.push({ctx,deps});return {content:{success:true},tokens:[]}};
 const bindings={cancellationsRecorded,revalidateProposalScope:async()=>current,doorPin:undefined,settlePinnedDoorResult:()=>{throw Error('no pinned door call in this test')},SALES_INVOICE_TOOL_NAMES,SALES_COLLECTIONS_TOOL_NAMES,toolCalls:[{id:'test-call',function:{name:toolName,arguments:'{}'}}],toolResults:[],messages:[{role:'user',content:'Create the draft'}],personaCtx:{tenant_id:'test-tenant'},user:{id:'test-actor'},approvedConfirmations:new Set(),payloadThreadId:'test-thread',dispatchSalesInvoiceChat:run,dispatchSalesCollectionsChat:run,supabase:{},supabaseClient:{caller:'authenticated'},supabaseUrl:'test',supabaseServiceKey:'fixture',createClient:()=>({from:()=>({select:()=>({})})}),approvalTokenTool:new Map(),approvalRefusals:new Map()};
 const results=await new Function(...Object.keys(bindings),branch)(...Object.values(bindings)) as {content:string}[];
 return {calls,caller:bindings.supabaseClient,result:JSON.parse(results[0].content)};
}
const cancelStart=source.indexOf('const cancelConfirmations = async');
const cancelEnd=source.indexOf('const cancellationsRecorded = await cancelConfirmations',cancelStart);
if(cancelStart<0||cancelEnd<=cancelStart)throw Error('Actual canonical cancellation function missing');
const weeklyStart=source.indexOf('const weeklyDraftScope =');
const weeklyEnd=source.indexOf('const recordConfirmation = async',weeklyStart);
if(weeklyStart<0||weeklyEnd<=weeklyStart)throw Error('Actual weekly selector closure missing');
const actualImports=createSourceFile('index.ts',source,ScriptTarget.Latest,true).statements.filter(isImportDeclaration);
for(const [name,path]of [['WEEKLY_COMMITMENT_DRAFT_TOOL_NAME','../_shared/paige-spine/domains/automations.ts'],['weeklyCommitmentDraftToolsForContext','../_shared/paige-spine/domains/automations.ts'],['weeklyDraftNativeArgs','../_shared/paige-orchestration/weekly-draft-chat-claim.ts']]){
 if(!actualImports.some(d=>d.moduleSpecifier.getText().slice(1,-1)===path&&d.importClause?.namedBindings&&isNamedImports(d.importClause.namedBindings)&&d.importClause.namedBindings.elements.some(e=>e.name.text===name&&(e.propertyName??e.name).text===name)))throw Error('Actual weekly import missing: '+name);
}
// Run the actual selector too. An omitted free-variable binding must not be
// mistaken for a failed decline or bypassed by an unconditional helper stub.
const cancelBody=compile(`${source.slice(weeklyStart,weeklyEnd)}${source.slice(cancelStart,cancelEnd)}return cancelConfirmations(fps);`);
async function cancel(error:unknown=null,current=true,recovery:"allowed"|"held"|"unknown"="allowed",fps=['0123456789abcdef']){
 const queries:unknown[][]=[];const query:Record<string,unknown>={};
 const readQueries:unknown[][]=[];const readQuery:Record<string,unknown>={};
 for(const method of ['eq','is','not','neq','limit'])readQuery[method]=(...args:unknown[])=>{readQueries.push([method,...args]);return readQuery};
 readQuery.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve);
 query.select=(...args:unknown[])=>{readQueries.push(['select',...args]);return readQuery};
 const checks:unknown[]=[],errors:unknown[][]=[];
 for(const method of ['update','eq','in','is','not'])query[method]=(...args:unknown[])=>{queries.push([method,...args]);return query};
 query.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({error}).then(resolve);
 // The actual cancellation closure now checks recovery permission before either
 // consumption path. Bind and assert the port; never silently omit a free variable.
 const unexpected=()=>{throw Error('No original weekly proposal exists in this Sales fixture')};
 const bindings={interactive:undefined,fps,revalidateProposalScope:async()=>current,selectedConfirmationNonce:async()=>null,requireRecoveryPermission:async(effect?:boolean)=>{checks.push(effect);if(recovery!=="allowed")throw Error(recovery==="held"?"INTERACTIVE_RECOVERY_READ_ONLY":"INTERACTIVE_RECOVERY_SCOPE_UNAVAILABLE");},supabase:{from:(table:string)=>{if(table!=='paige_pending_confirmations')throw Error('Unexpected confirmation table');return query}},personaCtx:{tenant_id:'test-tenant'},user:{id:'test-actor'},payloadThreadId:'test-thread',scopedClientId:null,CRM_COMMAND_TOOL_NAMES:new Set(['crm_create_contact']),SALES_INVOICE_TOOL_NAMES,SALES_COLLECTIONS_TOOL_NAMES,GROWTH_PUBLISH_DOOR_TOOL_NAMES,COMMS_EMAIL_TOOL_NAMES,
 WEEKLY_COMMITMENT_DRAFT_TOOL_NAME,weeklyCommitmentDraftToolsForContext,weeklyDraftNativeArgs,callerTier:'tenant',calendarBookingAccountShape:'solo',taskReadRole:'owner',customerPortal:false,req:new Request('https://fixture.invalid'),proposalScopeInvalidated:false,tenantKnowledgeScopeRevoked:false,interactiveRecoveryReadOnly:false,runtimeIdentity:null,validatedData:{},requestNonce:'00000000-0000-4000-8000-000000000001',confirmationToken:unexpected,readWeeklyDraftChatStatus:unexpected,declineWeeklyDraftChatApproval:unexpected,requestExecutionState:{needsReview:false},aiMessages:[],supabaseClient:{},console:{error:(...args:unknown[])=>{errors.push(args);}}};
 return {recorded:await new Function(...Object.keys(bindings),cancelBody)(...Object.values(bindings)),queries,readQueries,checks,errors};
}
describe('actual Sales Chat cancellation containment',()=>{
 it('failed decline persistence blocks ordinary draft create/revise before the AUTO-capable endpoint',async()=>{for(const tool of ['billing_create_invoice','sales_revise_invoice_draft']){const r=await dispatch(false,true,tool);expect(r.calls).toEqual([]);expect(r.result).toMatchObject({success:false,not_applied:true,error:'confirmation_context_unavailable'})}});
 it('a changed workspace refuses without a Sales command',async()=>{expect((await dispatch(true,false)).calls).toEqual([])});
 it('recorded declines and current scope retain the same Sales dispatch',async()=>{const r=await dispatch(true);expect(r.calls).toHaveLength(1);expect(r.calls[0]).toMatchObject({deps:{caller:r.caller}})});
 it('threaded Not now consumes only the exact actor/tenant NULL-scope Sales/CRM/publish/comms action-door fingerprints',async()=>{const r=await cancel();expect(r.recorded).toBe(true);expect(r.queries).toContainEqual(['eq','user_id','test-actor']);expect(r.queries).toContainEqual(['eq','tenant_id','test-tenant']);expect(r.queries).toContainEqual(['in','fingerprint',['0123456789abcdef']]);for(const key of ['thread_id','scoped_client_id','consumed_at'])expect(r.queries).toContainEqual(['is',key,null]);expect(r.queries).toContainEqual(['not','server_issued_at','is',null]);const allowed=r.queries.find(q=>q[0]==='in'&&q[1]==='tool_name')?.[2] as string[];expect(allowed).toContain('billing_create_invoice');expect(allowed).toContain('sales_revise_invoice_draft');expect(allowed).toContain('sales_save_collection_terms');for(const tool of GROWTH_PUBLISH_DOOR_TOOL_NAMES)expect(allowed).toContain(tool);expect(allowed).toContain('crm_create_contact');expect(allowed).toContain('comms_send_email');expect(allowed).not.toContain('unrelated_tool')});
 it('failed cancellation writes and scope changes return false',async()=>{expect((await cancel({code:'failure'})).recorded).toBe(false);const r=await cancel(null,false);expect(r.recorded).toBe(false);expect(r.queries).toEqual([])});
 it('checks effect permission exactly before the existing action-door decline write',async()=>{const r=await cancel();expect(r.recorded).toBe(true);expect(r.checks).toEqual([true]);expect(r.errors).toEqual([])});
 it.each(['held','unknown'] as const)('refuses %s recovery permission without consuming any proposal',async recovery=>{const r=await cancel(null,true,recovery);expect(r.recorded).toBe(false);expect(r.checks).toEqual([true]);expect(r.queries).toEqual([]);expect(r.errors).toHaveLength(1);expect(String(r.errors[0][1])).toContain(recovery==='held'?'INTERACTIVE_RECOVERY_READ_ONLY':'INTERACTIVE_RECOVERY_SCOPE_UNAVAILABLE')});
 it.each([{kind:'missing',fps:[]},{kind:'malformed',fps:['malformed']},{kind:'unselected foreign nonce',fps:['0123456789abcdef:44444444-4444-4444-8444-444444444444']}])('never consumes a $kind scoped token',async({fps})=>{const r=await cancel(null,true,'allowed',fps);expect(r.recorded).toBe(true);expect(r.queries).toEqual([]);expect(r.checks).toEqual([]);expect(r.errors).toEqual([])});
 it('an unselected scoped nonce can only inspect its original weekly selector, never consume or decline it',async()=>{
  const nonce='44444444-4444-4444-8444-444444444444',r=await cancel(null,true,'allowed',['0123456789abcdef:'+nonce]);
  expect(r.recorded).toBe(true);expect(r.queries).toEqual([]);expect(r.checks).toEqual([]);expect(r.errors).toEqual([]);
  for(const pair of [['user_id','test-actor'],['tenant_id','test-tenant'],['thread_id','test-thread'],['tool_name',WEEKLY_COMMITMENT_DRAFT_TOOL_NAME],['fingerprint','0123456789abcdef'],['issued_in_request',nonce]])expect(r.readQueries).toContainEqual(['eq',...pair]);
  expect(r.readQueries).toContainEqual(['is','scoped_client_id',null]);expect(r.readQueries).toContainEqual(['not','server_issued_at','is',null]);expect(r.readQueries).toContainEqual(['neq','issued_in_request','00000000-0000-4000-8000-000000000001']);expect(r.readQueries).toContainEqual(['limit',2]);
 });
});
