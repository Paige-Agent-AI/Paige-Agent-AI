import {readFileSync} from "node:fs";
import ts from "typescript";
import {z} from "zod";
import {describe,expect,it,vi} from "vitest";
import {readCustomerAssistantContext,customerProgramMessages,customerTerminalSource,embedCustomerQuery} from "../../supabase/functions/_shared/client-portal-assistant-context";
import {buildClientPortalPersonaMessages} from "../../supabase/functions/_shared/client-portal-persona";

// Execute the actual narrow handler closures. Do not copy their implementations
// or execute the rest of the owner runtime, a provider or a hosted account.
const source=readFileSync("supabase/functions/paige-ai-chat/index.ts","utf8");
const ast=ts.createSourceFile("handler.ts",source,ts.ScriptTarget.Latest,true);
function node<T extends ts.Node>(match:(n:ts.Node)=>n is T):T{
 const found:T[]=[];const visit=(n:ts.Node)=>{if(match(n))found.push(n);ts.forEachChild(n,visit)};visit(ast);
 if(found.length!==1)throw Error("Review the changed handler boundary: "+found.length);return found[0];
}
const declaration=(name:string)=>node((n):n is ts.VariableDeclaration=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name);
const compile=(text:string)=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const actor="11111111-1111-4111-8111-111111111111",client="22222222-2222-4222-8222-222222222222";
const tenant="33333333-3333-4333-8333-333333333333",thread="44444444-4444-4444-8444-444444444444",intent="55555555-5555-4555-8555-555555555555";
const share={share_id:"66666666-6666-4666-8666-666666666666",share_revision:1,source_fingerprint:"a".repeat(64)};
// E09 K2: the v2 context binds the exact passages it quoted; history refs carry their kind, never passages.
const ref={kind:"knowledge_share",...share,passages:[0]},historyRef={kind:"knowledge_share",...share};
function fixture(){return{frame:{actor_id:actor,profile:{id:client,tenant_id:tenant,linked_user_id:actor},brand:{tenant_id:tenant,tenant_name:"Coaching business"},config:{assistant:{enabled:true,tone:"Warm"}}},thread_id:thread,intent_id:intent,
 snapshot:{version:2,retrieval_refs:[ref],source_refs:[ref]},sources:[{...share,passages:[0],document_id:client,document_revision:1,generation_id:client,title:"Approved guide",content:"Approved program guidance",content_truncated:false,customer_kind:"information",valid_until:null}],
 history:[{role:"user",content:"Private earlier question",source_refs:[historyRef]}],history_limited:false,ranking:"relevance",sources_limited:false,authorized_count:1,query_embedding_eligible:true}}
type ContextFixture=ReturnType<typeof fixture>;
async function guard(){
 let current:ContextFixture=fixture(),error:{code:string;message:string}|null=null,authorized=true;const calls:string[]=[];
 const supabaseClient={rpc:vi.fn(async(name:string)=>{calls.push(name);return name==="paige_chat_customer_thread_authorized"?{data:authorized,error:null}:{data:current,error}})};
 const captured=await readCustomerAssistantContext(supabaseClient,actor,thread,intent);expect(captured.status).toBe("available");
 let guardDeclaration=declaration("revalidateTenantKnowledgeScope").getText(ast);
 if(process.env.E09_CUSTOMER_CONTEXT_CONTROL==="persona_only"){
  const binding="JSON.stringify(source.data) === JSON.stringify(customerAssistant)";
  if(!guardDeclaration.includes(binding))throw Error("Review changed full customer-source comparison");
  guardDeclaration=guardDeclaration.replace(binding,"JSON.stringify(source.data?.persona) === JSON.stringify(customerAssistant?.persona)");
 }
 const create=new Function("env",compile(`let tenantKnowledgeScopeRevoked=false;const customerPortal=true;
  const {supabaseClient,customerCaller,user,payloadThreadId,validatedData,customerAssistant,readCustomerAssistantContext}=env;
  const ${guardDeclaration};
  return {check:revalidateTenantKnowledgeScope,retired:()=>tenantKnowledgeScopeRevoked};`));
 const actual=create({supabaseClient,customerCaller:supabaseClient,user:{id:actor},payloadThreadId:thread,validatedData:{requestIntentId:intent},customerAssistant:captured.data,readCustomerAssistantContext});
 return{...actual,calls,change:(fn:(r:ContextFixture)=>void)=>fn(current),fail:()=>{error={code:"42501",message:"PRIVATE DIAGNOSTIC"};},restore:()=>{current=fixture();error=null;authorized=true},deny:()=>{authorized=false;}};
}
describe("actual customer provider/output lifetime source fence",()=>{
 it("compares one native role/program/private-history snapshot and the actual private thread",async()=>{
  const g=await guard();await expect(g.check()).resolves.toBe(true);expect(g.retired()).toBe(false);
  expect(g.calls).toEqual(["client_portal_assistant_context_v2","client_portal_assistant_context_v2","paige_chat_customer_thread_authorized"]);
 });
 for(const [label,change]of Object.entries({
  "business role":(r:ContextFixture)=>r.frame.config.assistant.tone="Changed",
  "disablement":(r:ContextFixture)=>r.frame.config.assistant.enabled=false,
  "published source":(r:ContextFixture)=>r.sources[0].content="Changed source",
  "private history":(r:ContextFixture)=>r.history[0].content="Changed history",
  "history completeness":(r:ContextFixture)=>r.history_limited=true,
  "business":(r:ContextFixture)=>r.frame.profile.tenant_id=client,
  "customer":(r:ContextFixture)=>r.frame.profile.linked_user_id=client,
 }))it("retires "+label+" permanently for the current turn",async()=>{
  const g=await guard();expect(await g.check()).toBe(true);g.change(change);expect(await g.check()).toBe(false);
  g.restore();expect(await g.check()).toBe(false);expect(g.retired()).toBe(true);
 });
 for(const mode of ["native error","thread withdrawn"])it(mode+" refuses publication without fallback",async()=>{
  const g=await guard();if(mode==="native error")g.fail();else g.deny();expect(await g.check()).toBe(false);g.restore();expect(await g.check()).toBe(false);
 });
 it("internal business fields never enter the decoded source",async()=>{
  const g=await guard();g.change(r=>{Object.assign(r.frame.config,{internal_private_notes:"OWNER PRIVATE"});});expect(await g.check()).toBe(true);
 });
});
describe("actual customer handler integration",()=>{
 it("the actual customer begin cannot borrow the original owner caller",async()=>{
  const ownerRpc=vi.fn(async(..._args:unknown[])=>({data:{status:"accepted"},error:null})),customerRpc=vi.fn(async(..._args:unknown[])=>({data:{status:"accepted"},error:null}));
  const make=new Function("supabaseClient","customerCaller","customerPortal","validatedData","interactiveInput","userText","customerQuery",compile(`const ${declaration("beginTurn").getText(ast)};return beginTurn;`));
  const begin=make({rpc:ownerRpc},{rpc:customerRpc},true,{threadId:thread,requestIntentId:intent},{kind:"message"},"Question",null);
  await begin(false);expect(ownerRpc).not.toHaveBeenCalled();expect(customerRpc).toHaveBeenCalledTimes(1);expect(customerRpc.mock.calls[0][0]).toBe("client_portal_assistant_begin");
 });
 it("uses the customer-only native admission adapter while preserving workspace begin arguments",async()=>{
  const rpc=vi.fn(async(..._args:unknown[])=>({data:{status:"accepted"},error:null}));
  const make=new Function("supabaseClient","customerCaller","customerPortal","validatedData","interactiveInput","userText","customerQuery",compile(`const ${declaration("beginTurn").getText(ast)};return beginTurn;`));
  const vector=Array.from({length:1024},()=>0.5);
  for(const customerPortal of [false,true]){
   const begin=make({rpc},{rpc},customerPortal,{threadId:thread,requestIntentId:intent},{kind:"message"},"Question",customerPortal?{embedding:vector,degraded:false}:null);
   await begin(false);expect(rpc.mock.lastCall?.[0]).toBe(customerPortal?"client_portal_assistant_begin":"paige_chat_interactive_begin_v2");
   expect(rpc.mock.lastCall?.[1]).toMatchObject({p_thread:thread,p_intent:intent,p_content:"Question",p_stop:false,p_effectful:false});
   // The workspace begin is unchanged; the customer begin binds the same vector the read used.
   if(customerPortal)expect(rpc.mock.lastCall?.[1]).toMatchObject({p_query_embedding:vector});
   else expect(rpc.mock.lastCall?.[1]).not.toHaveProperty("p_query_embedding");
   await begin(true);
   if(customerPortal)expect(rpc.mock.lastCall?.[1]).toMatchObject({p_effectful:true,p_query_embedding:vector});
   else expect(rpc.mock.lastCall?.[1]).not.toHaveProperty("p_effectful");
  }
  // A failed embedding is NULL at begin: the customer begin overload is still the one called (recency).
  const degraded=make({rpc},{rpc},true,{threadId:thread,requestIntentId:intent},{kind:"message"},"Question",{embedding:null,degraded:true});
  await degraded(false);expect(rpc.mock.lastCall?.[1]).toMatchObject({p_query_embedding:null,p_effectful:false});
 });
 it("clears owner prompts/tools and supplies only the customer role, current program and admitted private messages",async()=>{
  const result=await readCustomerAssistantContext({rpc:async()=>({data:fixture(),error:null})},actor,thread,intent);const context=result.data!;
  const block=node((n):n is ts.IfStatement=>ts.isIfStatement(n)&&n.expression.getText(ast)==="customerPortal && customerPersona && customerAssistant");
  // The statement's client-seat else-branch awaits the persona read, so it compiles as an async body.
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor as FunctionConstructor;
  const run=new AsyncFunction("customerPortal","customerPersona","customerAssistant","aiMessages","messages","toolDefs","buildClientPortalPersonaMessages","customerProgramMessages","customerQuery",compile(block.getText(ast)));
  const aiMessages:unknown[]=[{role:"system",content:"OWNER PRIVATE"}],tools:unknown[]=[{function:{name:"owner_only_write"}}];
  await run(true,context.persona,context,aiMessages,[...context.history,{role:"user",content:"Current question"}],tools,buildClientPortalPersonaMessages,customerProgramMessages,{embedding:null,degraded:false});
  expect(tools).toEqual([]);expect(JSON.stringify(aiMessages)).not.toContain("OWNER PRIVATE");
  expect(JSON.stringify(aiMessages)).toContain("representing the business");expect(JSON.stringify(aiMessages)).toContain("Approved program guidance");
  expect(JSON.stringify(aiMessages)).not.toContain("may not have the most relevant material");
  expect(aiMessages.at(-1)).toEqual({role:"user",content:"Current question"});
  // E09 K2 (§13): the recency note follows what CURA was given, never this request's embed attempt.
  // A retried intent replays its bound snapshot: a relevance-bound replay whose own embed failed
  // must not claim recency, and a recency-bound replay whose embed worked must still say so.
  const replayRelevance:unknown[]=[];
  await run(true,context.persona,context,replayRelevance,[{role:"user",content:"Current question"}],[],buildClientPortalPersonaMessages,customerProgramMessages,{embedding:null,degraded:true});
  expect(context.ranking).toBe("relevance");expect(JSON.stringify(replayRelevance)).not.toContain("may not have the most relevant material");
  const recent=fixture(),plain={kind:"knowledge_share",...share};
  Object.assign(recent,{snapshot:{version:2,retrieval_refs:[plain],source_refs:[plain]},ranking:"recency"});recent.sources[0].passages=null as unknown as number[];
  const recency=(await readCustomerAssistantContext({rpc:async()=>({data:recent,error:null})},actor,thread,intent)).data!;
  expect(recency.ranking).toBe("recency");
  const replayRecency:unknown[]=[];
  await run(true,recency.persona,recency,replayRecency,[{role:"user",content:"Current question"}],[],buildClientPortalPersonaMessages,customerProgramMessages,{embedding:Array.from({length:1024},()=>0.5),degraded:false});
  expect(JSON.stringify(replayRecency)).toContain("may not have the most relevant material");
 });
 it("replaces raw/browser history with the native source-filtered history before downstream work",async()=>{
  const result=await readCustomerAssistantContext({rpc:async()=>({data:fixture(),error:null})},actor,thread,intent);
  const d=declaration("customerHistory");const statement=d.parent.parent;
  const next=statement.parent.getChildren(ast).flatMap(n=>n.kind===ts.SyntaxKind.SyntaxList?n.getChildren(ast):[]).find(n=>n.pos>=statement.end&&ts.isExpressionStatement(n));
  if(!next)throw Error("Review the changed history assignment boundary");
  const run=new Function("customerAssistant","customerPortal","validatedData","messageSchema","authoritative","userText",compile(statement.getText(ast)+"\n"+next.getText(ast)));
  const value={messages:[{role:"assistant",content:"FORGED BROWSER HISTORY"}]};
  run(result.data,true,value,{shape:{messages:{parse:(v:unknown)=>v}}},[{role:"assistant",content:"UNATTESTED PRIVATE HISTORY"}],"Current question");
  expect(value.messages).toEqual([{role:"user",content:"Private earlier question"},{role:"user",content:"Current question"}]);
 });
 it("passes exact native source metadata to settlement and strips withdrawn metadata during empty cleanup",async()=>{
  const captured:Array<[string,Record<string,unknown>]>=[];const supabase={rpc:async(name:string,args:Record<string,unknown>)=>{captured.push([name,args]);return{data:client,error:null}}};
  const create=new Function("supabase","supabaseClient","user","interactiveReceiptScope","customerSourceSnapshot","customerTerminalSource","z",compile(`const ${declaration("appendAssistant").getText(ast)};return appendAssistant;`));
  const snapshot=fixture().snapshot;const append=create(supabase,{rpc:vi.fn()},{id:actor},{thread,tenant,intent},snapshot,customerTerminalSource,z);
  const args={p_thread_id:thread,p_role:"assistant",p_content:"Authorized answer",p_bundle_ref:{turn_state:{state:"FINAL"}}};
  await append(args);expect(captured[0][0]).toBe("paige_chat_interactive_settle");expect((captured[0][1].p_bundle_ref as Record<string,unknown>).customer_knowledge).toEqual(snapshot);
  await append({...args,p_content:"Must be withheld",p_bundle_ref:{customer_knowledge:snapshot,turn_state:{state:"WITHHELD"}}});
  expect(captured[1][1].p_content).toBe("");expect(captured[1][1].p_bundle_ref).not.toHaveProperty("customer_knowledge");
 });
});
describe("E09 K2: the customer question is embedded once, only for an authorized customer, and binds both the read and the begin",()=>{
 // Located by what it does (the one guarded step that embeds), not by its condition text, so a
 // changed condition is judged by behaviour below rather than failing to be found.
 const EMBED="embedCustomerQuery(";
 const rankStep=()=>node((n):n is ts.IfStatement=>ts.isIfStatement(n)&&ts.isBlock(n.thenStatement)&&
  n.thenStatement.statements.some(s=>ts.isExpressionStatement(s)&&s.getText(ast).includes(EMBED)));
 it("embeds through the shared voyage embedder only, after the unavailable gate and the thread authorization",()=>{
  const step=rankStep();const text=step.getText(ast);
  expect(text).toContain("embedCustomerQuery(");expect(text).toContain("voyageEmbedOne, VOYAGE_MODEL");expect(text).not.toMatch(/callModel|router/i);
  // The only embedding of the customer's question is this one.
  expect(source.split("embedCustomerQuery(").length-1).toBe(1);
  // Native customer checks still dominate it; invalid protocol/audience now refuses before egress too.
  const at=step.getStart(ast);
  for(const gate of ['code:"CUSTOMER_CHAT_UNAVAILABLE"','"paige_chat_customer_thread_authorized"',
   'code: "INTERACTIVE_PROTOCOL_NOT_READY"','code:"CHAT_AUDIENCE_MISMATCH"']){
   expect(source.indexOf(gate)).toBeGreaterThan(-1);expect(source.indexOf(gate)).toBeLessThan(at);
  }
  expect(step.parent.parent.getText(ast)).toMatch(/^if \(validatedData\.interactive\)/);
  // The first read (what the gate uses) carries no vector; the snapshot is taken after ranking.
  expect(declaration("customerPersonaSource").getText(ast)).not.toContain("customerQuery");
  expect(source.indexOf("customerSourceSnapshot = customerAssistant?.snapshot ?? null;")).toBeGreaterThan(step.getEnd()-1);
 });
 async function step(env:{customerControl?:boolean;eligible?:boolean|null;assistant:unknown;embed:(text:string)=>Promise<unknown>;ranked?:unknown}){
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor as FunctionConstructor;
  const reads:unknown[][]=[],embeds:string[]=[];
  const supabaseClient={rpc:vi.fn(async(name:string,args:Record<string,unknown>)=>{reads.push([name,args.p_query_embedding]);return env.ranked as {data:unknown;error:unknown};})};
  const run=new AsyncFunction("env",compile(`let customerQuery=null;let customerAssistant=env.customerAssistant;
   const {customerPortal,customerControl,customerPersona,customerPersonaSource,validatedData,embedCustomerQuery,voyageEmbedOne,VOYAGE_MODEL,readCustomerAssistantContext,supabaseClient,customerCaller,user}=env;
   ${rankStep().getText(ast)}
   return {customerQuery,customerAssistant};`));
  const out=await run({customerPortal:true,customerControl:env.customerControl??false,customerPersonaSource:{queryEmbeddingEligible:env.eligible===null?undefined:env.eligible??true},customerAssistant:env.assistant,customerPersona:(env.assistant as {persona?:unknown}|null)?.persona??null,
   validatedData:{threadId:thread,requestIntentId:intent,messages:[{role:"user",content:"Latest question"}]},embedCustomerQuery,
   voyageEmbedOne:async(text:string)=>{embeds.push(text);return env.embed(text);},VOYAGE_MODEL:"voyage-3",readCustomerAssistantContext,supabaseClient,customerCaller:supabaseClient,user:{id:actor}});
  return{...out,reads,embeds};
 }
 const v=Array.from({length:1024},()=>0.25);
 it("does not call the embedding provider for an observed accepted or superseded intent",async()=>{
  const prior=(await readCustomerAssistantContext({rpc:async()=>({data:fixture(),error:null})},actor,thread,intent)).data!;
  const replay=await step({eligible:false,assistant:prior,embed:async()=>v,ranked:{data:fixture(),error:null}});
  expect(replay.embeds).toEqual([]);expect(replay.reads).toEqual([]);
  expect(replay.customerQuery).toBeNull();expect(replay.customerAssistant).toBe(prior);
  const unknown=await step({eligible:null,assistant:prior,embed:async()=>v,ranked:{data:fixture(),error:null}});
  expect(unknown.embeds).toEqual([]);expect(unknown.reads).toEqual([]);
 });
 it("embeds nothing when there is no authorized material to rank, or for stop/status",async()=>{
  const empty={...fixture(),snapshot:null,sources:[],authorized_count:0,history:[],ranking:"recency"};
  const first=(await readCustomerAssistantContext({rpc:async()=>({data:empty,error:null})},actor,thread,intent)).data!;
  expect(first?.sources).toEqual([]);expect(first.persona.enabled).toBe(true);
  const none=await step({assistant:first,embed:async()=>v});
  expect(none.embeds).toEqual([]);expect(none.reads).toEqual([]);expect(none.customerQuery).toBeNull();expect(none.customerAssistant).toBe(first);
  const full=(await readCustomerAssistantContext({rpc:async()=>({data:fixture(),error:null})},actor,thread,intent)).data!;
  expect(full?.sources.length).toBe(1);
  const control=await step({customerControl:true,assistant:full,embed:async()=>v});
  expect(control.embeds).toEqual([]);expect(control.customerQuery).toBeNull();
 });
 it("re-reads with the one vector the begin will bind, and keeps the recency read on any failure",async()=>{
  const first=(await readCustomerAssistantContext({rpc:async()=>({data:fixture(),error:null})},actor,thread,intent)).data!;
  expect(first?.sources.length).toBe(1);
  const rankedRow={...fixture(),sources:[{...fixture().sources[0],content:"Closest passage"}]};
  const ok=await step({assistant:first,embed:async()=>v,ranked:{data:rankedRow,error:null}});
  expect(ok.embeds).toEqual(["Latest question"]);expect(ok.reads).toEqual([["client_portal_assistant_context_v2",v]]);
  expect(ok.customerQuery).toEqual({embedding:v,degraded:false});expect((ok.customerAssistant as {sources:Array<{content:string}>}).sources[0].content).toBe("Closest passage");
  const failed=await step({assistant:first,embed:async()=>{throw new Error("Voyage 503")}});
  expect(failed.reads).toEqual([]);expect(failed.customerQuery).toEqual({embedding:null,degraded:true});expect(failed.customerAssistant).toBe(first);
  for(const ranked of [{data:null,error:{code:"08006"}},{data:{...rankedRow,frame:{...rankedRow.frame,config:{assistant:{enabled:true,tone:"Changed"}}}},error:null}]){
   const lost=await step({assistant:first,embed:async()=>v,ranked});
   expect(lost.reads.length).toBe(1);expect(lost.customerQuery).toEqual({embedding:null,degraded:true});expect(lost.customerAssistant).toBe(first);
  }
 });
});
