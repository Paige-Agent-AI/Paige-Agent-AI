// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';
import { preparePortalRequestCommand, portalRequestConfirmSummary } from '../../supabase/functions/_shared/client-portal-request-command';

const source=ts.createSourceFile('index.ts',readFileSync('supabase/functions/paige-ai-chat/index.ts','utf8'),ts.ScriptTarget.Latest,true);
let preparation:ts.IfStatement|undefined;
function find(node:ts.Node){if(ts.isIfStatement(node)&&node.expression.getText(source)==='tc.function.name===PORTAL_REQUEST_SHARE_TOOL'
 &&node.thenStatement.getText(source).includes('preparePortalRequestCommand('))preparation=node;ts.forEachChild(node,find);}find(source);
if(!preparation)throw Error('Original Root source preparation missing');
const js=ts.transpileModule(`async function run(){let gateArgs=input;let portalRequestPreparedSummary=null;for(const tc of [call]){${preparation.getText(source)}}return {gateArgs,portalRequestPreparedSummary,arguments:call.function.arguments};}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const id=(n:number)=>`e09fa000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup(options:{live?:boolean;approved?:boolean;carried?:boolean}={}){
 const scope={actorId:id(1),tenantId:id(2),threadId:id(3),clientId:null as string|null,audience:'owner' as const};
 const input:Record<string,unknown>={contact_id:id(4),work_id:id(5)};
 const args={expected_tenant_id:id(2),contact_id:id(4),work_id:id(5),version:'2026-10-25T12:00:00.123456Z',title:'Read the guide',body:'Choose one milestone.',recipient_user_id:id(6),access_version:null};
 const envelope={schema_version:1,actor_id:id(1),tenant_id:id(2),contact_id:id(4),work_id:id(5),source_state:'prepared',args:args as unknown,customer_action_id:null as string|null,read_at:'2026-10-25T13:00:00Z'};
 let current=true;const rpc=vi.fn(()=>({abortSignal:()=>Promise.resolve({data:envelope,error:null})}));
 const user=vi.fn(async()=>({data:{user:{id:id(1)}},error:null}));
 const name=vi.fn(async()=>'Jordan Rivera');const toolResults:Array<{content:string}>=[];
 const call={id:'call-1',function:{name:'client_portal_request_share',arguments:JSON.stringify(input)}};
 const deps={input,call,traceCtx:{content_policy:'full'},portalRequestContentCarried:false,portalRequestScope:()=>scope,portalRequestCurrent:()=>current,
  liveRuntimeScope:options.live?{}:null,resumePin:new Set(options.carried?[call.id]:[]),approvedConfirmations:new Set(options.approved?['test-original-token']:[]),
  confirmationArgs:(value:Record<string,unknown>)=>value,preparePortalRequestCommand,supabaseClient:{auth:{getUser:user},rpc},req:{signal:new AbortController().signal},
  revalidateProposalScope:async()=>current,portalAccessClientName:name,portalRequestConfirmSummary,PORTAL_REQUEST_SHARE_TOOL:call.function.name,toolResults};
 const run=new Function(...Object.keys(deps),`${js};return run;`)(...Object.values(deps))as()=>Promise<{gateArgs:Record<string,unknown>;portalRequestPreparedSummary:string|null;arguments:string}>;
 return{scope,input,args,envelope,rpc,user,name,toolResults,run,retire:()=>{current=false;}};
}
it('replaces only verified source identities with the exact eight saved consequential arguments',async()=>{
 const f=setup(),result=await f.run();expect(f.rpc).toHaveBeenCalledWith('read_client_portal_request_share_source',{_expected_actor_id:id(1),_expected_tenant_id:id(2),_contact_id:id(4),_work_id:id(5)});
 expect(result.gateArgs).toEqual(f.args);expect(JSON.parse(result.arguments)).toEqual(f.args);expect(Object.keys(result.gateArgs)).toHaveLength(8);
 expect(result.portalRequestPreparedSummary).toContain('Jordan Rivera');expect(result.portalRequestPreparedSummary).toContain(f.args.body);expect(result.portalRequestPreparedSummary).not.toContain(id(6));expect(f.toolResults).toEqual([]);
});
it('refuses model-authored replacement words or recipients before a source RPC',async()=>{
 const f=setup();f.input.body='Share something else';await f.run();expect(f.rpc).not.toHaveBeenCalled();expect(JSON.parse(f.toolResults[0].content)).toMatchObject({success:false,source_unavailable:true,not_applied:true});
});
it('never turns an existing original publication into another proposal or share',async()=>{
 const f=setup();f.envelope.source_state='shared';f.envelope.args=null;f.envelope.customer_action_id=id(10);const result=await f.run();
 expect(f.name).not.toHaveBeenCalled();expect(result.portalRequestPreparedSummary).toBeNull();expect(JSON.parse(f.toolResults[0].content)).toMatchObject({success:true,already_shared:true,read_only:true,work_id:id(5),customer_action_id:id(10)});
 expect(f.rpc).toHaveBeenCalledOnce();
});
it('does not invent the customer label when the caller-scoped CRM read cannot verify it',async()=>{
 const f=setup();f.name.mockResolvedValue('');const result=await f.run();expect(result.portalRequestPreparedSummary).toBeNull();expect(result.gateArgs).toEqual(f.input);expect(JSON.parse(f.toolResults[0].content).success).toBe(false);
});
it('leaves an original carried approval untouched without a fresh source read',async()=>{
 const f=setup({carried:true});const result=await f.run();expect(f.rpc).not.toHaveBeenCalled();expect(f.name).not.toHaveBeenCalled();expect(result.gateArgs).toEqual(f.input);expect(result.portalRequestPreparedSummary).toBeNull();
});
it('voice cannot consume a selected card and a foreign focused customer cannot be substituted',async()=>{
 for(const mode of ['voice','focus']){const f=setup({live:mode==='voice',approved:mode==='voice'});if(mode==='focus')f.scope.clientId=id(99);await f.run();expect(f.rpc).not.toHaveBeenCalled();expect(JSON.parse(f.toolResults[0].content).success).toBe(false);}
});
it('retires changed scope across the real source continuation before offering a review',async()=>{
 const f=setup();f.rpc.mockImplementation(()=>({abortSignal:()=>{f.retire();return Promise.resolve({data:f.envelope,error:null});}}));const result=await f.run();expect(result.portalRequestPreparedSummary).toBeNull();expect(result.gateArgs).toEqual(f.input);expect(f.name).not.toHaveBeenCalled();
});
