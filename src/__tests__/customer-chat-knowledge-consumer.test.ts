import {readFileSync} from "node:fs";
import ts from "typescript";
import {z} from "zod";
import {describe,expect,it,vi} from "vitest";
import {readCustomerAssistantContext,customerProgramMessages,customerTerminalSource} from "../../supabase/functions/_shared/client-portal-assistant-context";
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
const ref={share_id:"66666666-6666-4666-8666-666666666666",share_revision:1,source_fingerprint:"a".repeat(64)};
function fixture(){return{frame:{actor_id:actor,profile:{id:client,tenant_id:tenant,linked_user_id:actor},brand:{tenant_id:tenant,tenant_name:"Coaching business"},config:{assistant:{enabled:true,tone:"Warm"}}},thread_id:thread,intent_id:intent,
 snapshot:{version:1,retrieval_refs:[ref],source_refs:[ref]},sources:[{...ref,document_id:client,document_revision:1,generation_id:null,title:"Approved guide",content:"Approved program guidance",content_truncated:false}],
 history:[{role:"user",content:"Private earlier question",source_refs:[ref]}],history_limited:false}}
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
  const {supabaseClient,user,payloadThreadId,validatedData,customerAssistant,readCustomerAssistantContext}=env;
  const ${guardDeclaration};
  return {check:revalidateTenantKnowledgeScope,retired:()=>tenantKnowledgeScopeRevoked};`));
 const actual=create({supabaseClient,user:{id:actor},payloadThreadId:thread,validatedData:{requestIntentId:intent},customerAssistant:captured.data,readCustomerAssistantContext});
 return{...actual,calls,change:(fn:(r:ContextFixture)=>void)=>fn(current),fail:()=>{error={code:"42501",message:"PRIVATE DIAGNOSTIC"};},restore:()=>{current=fixture();error=null;authorized=true},deny:()=>{authorized=false;}};
}
describe("actual customer provider/output lifetime source fence",()=>{
 it("compares one native role/program/private-history snapshot and the actual private thread",async()=>{
  const g=await guard();await expect(g.check()).resolves.toBe(true);expect(g.retired()).toBe(false);
  expect(g.calls).toEqual(["client_portal_assistant_context","client_portal_assistant_context","paige_chat_customer_thread_authorized"]);
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
 it("uses the customer-only native admission adapter while preserving workspace begin arguments",async()=>{
  const rpc=vi.fn(async(..._args:unknown[])=>({data:{status:"accepted"},error:null}));
  const make=new Function("supabaseClient","customerPortal","validatedData","interactiveInput","userText",compile(`const ${declaration("beginTurn").getText(ast)};return beginTurn;`));
  for(const customerPortal of [false,true]){
   const begin=make({rpc},customerPortal,{threadId:thread,requestIntentId:intent},{kind:"message"},"Question");
   await begin(false);expect(rpc.mock.lastCall?.[0]).toBe(customerPortal?"client_portal_assistant_begin":"paige_chat_interactive_begin_v2");
   expect(rpc.mock.lastCall?.[1]).toMatchObject({p_thread:thread,p_intent:intent,p_content:"Question",p_stop:false,p_effectful:false});
  }
 });
 it("clears owner prompts/tools and supplies only the customer role, current program and admitted private messages",async()=>{
  const result=await readCustomerAssistantContext({rpc:async()=>({data:fixture(),error:null})},actor,thread,intent);const context=result.data!;
  const block=node((n):n is ts.IfStatement=>ts.isIfStatement(n)&&n.expression.getText(ast)==="customerPortal && customerPersona && customerAssistant");
  const run=new Function("customerPortal","customerPersona","customerAssistant","aiMessages","messages","toolDefs","buildClientPortalPersonaMessages","customerProgramMessages",compile(block.getText(ast)));
  const aiMessages:unknown[]=[{role:"system",content:"OWNER PRIVATE"}],tools:unknown[]=[{function:{name:"owner_only_write"}}];
  run(true,context.persona,context,aiMessages,[...context.history,{role:"user",content:"Current question"}],tools,buildClientPortalPersonaMessages,customerProgramMessages);
  expect(tools).toEqual([]);expect(JSON.stringify(aiMessages)).not.toContain("OWNER PRIVATE");
  expect(JSON.stringify(aiMessages)).toContain("representing the business");expect(JSON.stringify(aiMessages)).toContain("Approved program guidance");
  expect(aiMessages.at(-1)).toEqual({role:"user",content:"Current question"});
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
