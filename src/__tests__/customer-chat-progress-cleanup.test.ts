import {customerInvoicesTerminalSource} from "../../supabase/functions/_shared/client-portal-invoices-context";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {afterEach,describe,expect,it,vi} from "vitest";
import {z} from "zod";
import {customerFilesTerminalSource} from "../../supabase/functions/_shared/client-portal-files-context";
import {customerPublicLinkTerminalSource} from "../../supabase/functions/_shared/client-portal-public-link";
import {customerSessionsTerminalSource} from "../../supabase/functions/_shared/client-portal-sessions-context";
import {readCustomerAssistantContext,customerTerminalSource} from "../../supabase/functions/_shared/client-portal-assistant-context";
import {readCustomerProgressContext,customerProgressTerminalSource,CUSTOMER_PROGRESS_TIMEOUT_MS} from "../../supabase/functions/_shared/client-portal-progress-context";
import {createInteractiveLifetime,createInteractiveSettlement} from "../../supabase/functions/_shared/paige-turn/interactive";
import {RECOVERY_READ_ONLY_REFUSAL} from "../../supabase/functions/_shared/paige-turn/interactive-refusal";

const source=readFileSync("supabase/functions/paige-ai-chat/index.ts","utf8"),ast=ts.createSourceFile("handler.ts",source,ts.ScriptTarget.Latest,true);
function declaration(name:string){const found:ts.VariableDeclaration[]=[];function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)found.push(n);ts.forEachChild(n,visit);}visit(ast);if(found.length!==1)throw Error("actual source boundary changed");return found[0].getText(ast);}
function preflight(){const found:ts.IfStatement[]=[];function visit(n:ts.Node){if(ts.isIfStatement(n)&&n.expression.getText(ast)==="customerPortal && !customerControl && customerPersona")found.push(n);ts.forEachChild(n,visit);}visit(ast);if(found.length!==1)throw Error("actual preflight changed");return found[0].getText(ast);}
const compile=(s:string)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
const actor="e0932000-0000-4000-8000-000000000001",client="e0932000-0000-4000-8000-000000000002",tenant="e0932000-0000-4000-8000-000000000003",thread="e0932000-0000-4000-8000-000000000004",intent="e0932000-0000-4000-8000-000000000005";
function knowledge(){return {frame:{actor_id:actor,profile:{id:client,tenant_id:tenant,linked_user_id:actor},brand:{tenant_id:tenant,tenant_name:"Test business"},config:{assistant:{enabled:true}}},thread_id:thread,intent_id:intent,snapshot:{version:2,retrieval_refs:[],source_refs:[]},sources:[],history:[],history_limited:false,ranking:"recency",sources_limited:false,authorized_count:0,query_embedding_eligible:false};}

describe("accepted Progress read failure retains original native cleanup",()=>{
 afterEach(()=>vi.useRealTimers());
 for(const failure of ["withdrawn","read error","timeout"] as const)it(failure+" settles an empty interrupted receipt and releases exactly once",async()=>{
  const k=await readCustomerAssistantContext({rpc:async()=>({data:knowledge(),error:null})},actor,thread,intent);if(!k.data)throw Error("original Knowledge admission missing");
  const caller={rpc:vi.fn(async()=>failure==="timeout"?await new Promise<never>(()=>{}):{data:null,error:{code:failure==="withdrawn"?"42501":"57014"}})};
  const settlementCalls:Record<string,unknown>[]=[],release=vi.fn(async()=>{});
  const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
   expect(name).toBe("paige_chat_interactive_settle");
   // The original native Progress guard allows cleanup only with empty prose and no source claim.
   // Its accepted user has a Progress snapshot, even though this failed read has not hydrated it.
   expect(args.p_content).toBe("");expect(args.p_bundle_ref).not.toHaveProperty("customer_progress");expect(args.p_bundle_ref).not.toHaveProperty("customer_knowledge");expect(args.p_bundle_ref).not.toHaveProperty("customer_sessions");expect(args.p_bundle_ref).not.toHaveProperty("interactive_refusal");
   expect(args).toMatchObject({p_thread:thread,p_actor:actor,p_tenant:tenant,p_intent:intent});
   settlementCalls.push(args);return {data:client,error:null};
  });
  const setup=new Function("env",compile("const {supabase,supabaseClient,user,interactiveReceiptScope,customerSourceSnapshot,customerTerminalSource,customerProgressTerminalSource,customerSessionsTerminalSource,customerFilesTerminalSource,customerPublicLinkTerminalSource,customerInvoicesTerminalSource,z,validatedData,RECOVERY_READ_ONLY_REFUSAL}=env;let customerProgressSnapshot=null,customerSessionsSnapshot=null;const customerFilesSnapshot=null,customerPublicLinkSnapshot=null,customerInvoicesSnapshot=null;const customerPortal=true;let "+declaration("recoveryInputRefused")+";const "+declaration("appendAssistant")+";const "+declaration("interactiveFallback")+";return {fallback:interactiveFallback};"));
  const fallback=setup({supabase:{rpc},supabaseClient:{rpc:vi.fn()},user:{id:actor},interactiveReceiptScope:{thread,tenant,intent},customerSourceSnapshot:k.data.snapshot,customerTerminalSource,customerProgressTerminalSource,customerSessionsTerminalSource,customerFilesTerminalSource,customerPublicLinkTerminalSource,customerInvoicesTerminalSource,z,validatedData:{threadId:thread,requestIntentId:intent},RECOVERY_READ_ONLY_REFUSAL}).fallback;
  const settlement=createInteractiveSettlement({owns:async()=>true,readback:async()=>false,fallback,release});
  const lifetime=createInteractiveLifetime(settlement);
  const run=new AsyncFunction("env",compile("const {customerPortal,customerControl,customerPersona,customerCaller,user,validatedData,readCustomerProgressContext,corsHeaders,lifetime}=env;let customerProgressContext=null,customerProgressSnapshot=null,customerSessionsContext=null,customerSessionsSnapshot=null;const customerInvoicesSelected=false;const customerFileIds=null,customerPublicLink=null;try{"+preflight()+"}finally{await lifetime.handlerFinished();}"));
  if(failure==="timeout")vi.useFakeTimers();
  const pending=run({customerPortal:true,customerControl:false,customerPersona:k.data.persona,customerCaller:caller,user:{id:actor},validatedData:{threadId:thread,requestIntentId:intent},readCustomerProgressContext,corsHeaders:{},lifetime});
  if(failure==="timeout")await vi.advanceTimersByTimeAsync(CUSTOMER_PROGRESS_TIMEOUT_MS+1);
  const response=await pending;expect(response).toBeInstanceOf(Response);expect(response.status).toBe(failure==="withdrawn"?409:503);expect(await response.json()).toMatchObject({code:"CUSTOMER_PROGRESS_UNAVAILABLE",message_accepted:true});
  expect(settlementCalls).toHaveLength(1);expect(release).toHaveBeenCalledTimes(1);await lifetime.handlerFinished();expect(release).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledTimes(1);
 });
});
