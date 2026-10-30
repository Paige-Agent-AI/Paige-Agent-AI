import {readFileSync} from "node:fs";
import ts from "typescript";
import {describe,expect,it,vi} from "vitest";
import {z} from "zod";
import {readCustomerInvoicesContext,customerInvoicesTerminalSource,customerInvoicesMessages} from "../../supabase/functions/_shared/client-portal-invoices-context";
import {customerTerminalSource} from "../../supabase/functions/_shared/client-portal-assistant-context";
import {customerProgressTerminalSource} from "../../supabase/functions/_shared/client-portal-progress-context";
import {customerSessionsTerminalSource} from "../../supabase/functions/_shared/client-portal-sessions-context";
import {customerFilesTerminalSource} from "../../supabase/functions/_shared/client-portal-files-context";
import {customerPublicLinkTerminalSource} from "../../supabase/functions/_shared/client-portal-public-link";

const source=readFileSync("supabase/functions/paige-ai-chat/index.ts","utf8"),ast=ts.createSourceFile("handler.ts",source,ts.ScriptTarget.Latest,true);
function find(match:(n:ts.Node)=>boolean){const nodes:ts.Node[]=[];const visit=(n:ts.Node)=>{if(match(n))nodes.push(n);ts.forEachChild(n,visit);};visit(ast);
 if(nodes.length!==1)throw Error("Original invoice boundary changed: "+nodes.length);return nodes[0];}
const declaration=(name:string)=>find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name).getText(ast);
const compile=(s:string)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
const id=(n:number)=>`e0997500-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor=id(1),tenant=id(2),contact=id(3),thread=id(4),intent=id(5),captured="2026-10-30T14:00:00.000Z";
const persona={binding:{actorId:actor,tenantId:tenant,clientId:contact},enabled:true,businessName:"Test Practice",assistantName:"CURA",
 tone:"Clear",serviceScope:null,humanHandoff:null,tagline:null,supportEmail:null};
const fixture=()=>({thread_id:thread,intent_id:intent,mode:"bound",snapshot:{version:1 as const,kind:"customer_invoices" as const,
 actor_id:actor,tenant_id:tenant,contact_id:contact,thread_id:thread,intent_id:intent,observation_identity:"ab".repeat(32),captured_at:captured},
 billing:{tenant_id:tenant,contact_id:contact,captured_at:captured,calendar:{state:"missing" as const,zone:null,local_date:null},invoices:[],balances:[],invoice_count:0,open_count:0,has_more:false,next_cursor:null}});
function begin(portal=true,selected=true,kind="message",link:string|null=null,files:string[]|null=null){
 const accepted=async(_name:string,_args:Record<string,unknown>)=>({data:{status:"accepted"},error:null});
 const owner=vi.fn(accepted),customer=vi.fn(accepted);
 const make=new Function("env",compile(`const {supabaseClient,customerCaller,customerPortal,customerInvoicesSelected,customerPublicLink,customerFileIds,validatedData,interactiveInput,userText,customerQuery}=env;
 const ${declaration("beginTurn")};return beginTurn;`));
 return{owner,customer,call:make({supabaseClient:{rpc:owner},customerCaller:{rpc:customer},customerPortal:portal,customerInvoicesSelected:selected,
  customerPublicLink:link,customerFileIds:files,validatedData:{threadId:thread,requestIntentId:intent},interactiveInput:{kind},userText:"My invoices",customerQuery:null})};
}
describe("original invoice admission, not another Chat executor",()=>{
 it("uses only the customer caller and original exact link/file selection",async()=>{
  const x=begin(true,true,"message","https://example.org/selected",[id(8)]);await x.call(true);
  expect(x.owner).not.toHaveBeenCalled();expect(x.customer).toHaveBeenCalledWith("client_portal_assistant_begin_invoices",expect.objectContaining({
   p_thread:thread,p_intent:intent,p_url:"https://example.org/selected",p_file_ids:[id(8)],p_effectful:true,p_stop:false,p_bound_answer:false}));
 });
 for(const[caseName,portal,selected,kind,effectful,expected]of[
  ["financial unavailable",true,false,"message",true,"client_portal_assistant_begin_sessions"],
  ["conversational/draining",true,true,"message",false,"client_portal_assistant_begin_sessions"],
  ["Stop",true,true,"stop",true,"client_portal_assistant_begin"],
  ["owner",false,true,"message",true,"paige_chat_interactive_begin_v2"],
 ] as const)it("preserves "+caseName+" original path",async()=>{
  const x=begin(portal,selected,kind);await x.call(effectful);const calls=portal?x.customer.mock.calls:x.owner.mock.calls;
  expect(calls[0][0]).toBe(expected);expect(calls[0][1]).not.toHaveProperty("p_url");
 });
});

const captureBlock=find(n=>ts.isIfStatement(n)&&n.expression.getText(ast)==='customerPortal && !customerControl && customerPersona && interactiveInput.kind === "message"').getText(ast);
async function capture(data:unknown,error:unknown=null,degraded=false){
 const rpc=vi.fn(async()=>({data,error}));
 const run=new AsyncFunction("env",compile(`const {customerPortal,customerControl,customerPersona,interactiveInput,customerCaller,user,validatedData,readCustomerInvoicesContext,corsHeaders,degraded}=env;
 let customerInvoicesContext=null,customerInvoicesSnapshot=null;${captureBlock};return{context:customerInvoicesContext,snapshot:customerInvoicesSnapshot};`));
 return{rpc,result:await run({customerPortal:true,customerControl:false,customerPersona:persona,interactiveInput:{kind:"message"},customerCaller:{rpc},user:{id:actor},
  validatedData:{threadId:thread,requestIntentId:intent},readCustomerInvoicesContext,corsHeaders:{},degraded})};
}
describe("original accepted source read",()=>{
 it("uses accepted bound capture time, never the earlier fresh observation",async()=>{
  const x=await capture(fixture());expect(x.result.context.mode).toBe("bound");expect(x.result.snapshot.captured_at).toBe(captured);
 });
 it("general legacy contains no invoice facts or permission substitute",async()=>{
  const x=await capture({thread_id:thread,intent_id:intent,mode:"legacy",snapshot:null,billing:null});expect(x.result).toEqual({context:null,snapshot:null});
 });
 for(const[name,data,error,degraded]of[
  ["financial withdrawal",null,{code:"42501"},false],
  ["missing native API",null,{code:"42883"},false],
  ["unaccepted fresh source",{...fixture(),mode:"fresh"},null,false],
  ["draining bound replay",fixture(),null,true],
 ] as const)it("keeps accepted receipt and withholds "+name,async()=>{
  const x=await capture(data,error,degraded);expect(x.result).toBeInstanceOf(Response);
  expect(await x.result.json()).toMatchObject({code:"CUSTOMER_INVOICES_UNAVAILABLE",message_accepted:true});
 });
});

async function lifetime(){
 let current:unknown=fixture(),error:unknown=null;
 const customerCaller={rpc:async(name:string)=>name==="client_portal_assistant_invoices_context"?{data:current,error}:{data:true,error:null}};
 const source={persona:{enabled:true}},progress={},sessions={};
 const capturedSource=await readCustomerInvoicesContext(customerCaller,actor,thread,intent,persona);
 if(capturedSource.status!=="available")throw Error("Invoice fixture unavailable");
 const make=new Function("env",compile(`let tenantKnowledgeScopeRevoked=false;const customerPortal=true;
 const {customerCaller,user,payloadThreadId,validatedData,customerAssistant,customerPersona,customerProgressContext,customerSessionsContext,customerInvoicesContext,
 readCustomerAssistantContext,readCustomerProgressContext,readCustomerSessionsContext,readCustomerInvoicesContext}=env;
 const customerFilesContext=null,customerPublicLinkContext=null;const ${declaration("revalidateTenantKnowledgeScope")};return revalidateTenantKnowledgeScope;`));
 const check=make({customerCaller,user:{id:actor},payloadThreadId:thread,validatedData:{requestIntentId:intent},customerAssistant:source,customerPersona:persona,
  customerProgressContext:progress,customerSessionsContext:sessions,customerInvoicesContext:capturedSource.data,
  readCustomerAssistantContext:async()=>({status:"available",data:source}),readCustomerProgressContext:async()=>({status:"available",data:progress}),
  readCustomerSessionsContext:async()=>({status:"available",data:sessions}),readCustomerInvoicesContext});
 return{check,change:(value:unknown)=>{current=value;},deny:()=>{error={code:"42501"};},restore:()=>{current=fixture();error=null;}};
}
describe("provider and output financial currentness",()=>{
 it("permits the exact accepted source",async()=>{const x=await lifetime();expect(await x.check()).toBe(true);});
 for(const[key,value]of[["captured_at","2026-10-30T14:01:00Z"],["observation_identity","cd".repeat(32)],["actor_id",id(9)],["tenant_id",id(9)],["contact_id",id(9)]] as const)
  it("permanently withholds changed "+key,async()=>{const x=await lifetime();const next=fixture();Object.assign(next.snapshot,{[key]:value});x.change(next);
   expect(await x.check()).toBe(false);x.restore();expect(await x.check()).toBe(false);});
 it("withholds actual native financial refusal without retry fallback",async()=>{const x=await lifetime();x.deny();expect(await x.check()).toBe(false);x.restore();expect(await x.check()).toBe(false);});
});

describe("same native terminal, no financial writer",()=>{
 for(const state of["FINAL","WITHHELD","INTERRUPTED","REFUSED"])
 it(state+" uses accepted source or empty cleanup",async()=>{
  const rpc=vi.fn(async(_name:string,_args:Record<string,unknown>)=>({data:id(10),error:null}));
  const make=new Function("env",compile(`const {supabase,supabaseClient,user,interactiveReceiptScope,customerInvoicesSnapshot,customerTerminalSource,
   customerProgressTerminalSource,customerSessionsTerminalSource,customerFilesTerminalSource,customerPublicLinkTerminalSource,customerInvoicesTerminalSource,z}=env;
   const customerPortal=true,customerSourceSnapshot=null,customerProgressSnapshot=null,customerSessionsSnapshot=null,customerFilesSnapshot=null,customerPublicLinkSnapshot=null;
   const ${declaration("appendAssistant")};return appendAssistant;`));
  const snapshot=fixture().snapshot;
  const append=make({supabase:{rpc},supabaseClient:{rpc:vi.fn()},user:{id:actor},interactiveReceiptScope:{thread,tenant,intent},customerInvoicesSnapshot:snapshot,
   customerTerminalSource,customerProgressTerminalSource,customerSessionsTerminalSource,customerFilesTerminalSource,customerPublicLinkTerminalSource,customerInvoicesTerminalSource,z});
  await append({p_thread_id:thread,p_role:"assistant",p_content:"Invoice answer",p_bundle_ref:{customer_invoices:{forged:true},turn_state:{state}}});
  expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0][0]).toBe("paige_chat_interactive_settle");
  const result=rpc.mock.calls[0][1];expect(result).toMatchObject({p_actor:actor,p_tenant:tenant,p_thread:thread,p_intent:intent});
  if(state==="FINAL")expect((result.p_bundle_ref as Record<string,unknown>).customer_invoices).toEqual(snapshot);
  else{expect(result.p_content).toBe("");expect(result.p_bundle_ref).not.toHaveProperty("customer_invoices");}
 });
 it("model facts use original commercial exact labels and disclose permission/evidence limits",()=>{
  const f=fixture();const text=customerInvoicesMessages({threadId:thread,intentId:intent,mode:"bound",snapshot:f.snapshot,billing:f.billing})[0].content;
  expect(text).toContain("not instructions or approval");expect(text).toContain("not real collected money");expect(text).not.toContain(actor);
 });
});
