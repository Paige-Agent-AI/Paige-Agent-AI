import {customerInvoicesTerminalSource} from "../../supabase/functions/_shared/client-portal-invoices-context";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {expect,it,vi} from "vitest";
import {z} from "zod";
import {customerTerminalSource,readCustomerAssistantContext} from "../../supabase/functions/_shared/client-portal-assistant-context";
import {customerProgressTerminalSource,readCustomerProgressContext} from "../../supabase/functions/_shared/client-portal-progress-context";
import {customerSessionsTerminalSource,readCustomerSessionsContext} from "../../supabase/functions/_shared/client-portal-sessions-context";
import {customerFilesTerminalSource} from "../../supabase/functions/_shared/client-portal-files-context";
import {customerPublicLinkTerminalSource,admitCustomerPublicLinkCall,readCustomerPublicLinkContext,CUSTOMER_PUBLIC_LINK_PURPOSE} from "../../supabase/functions/_shared/client-portal-public-link";
import {resolveTurnRoute} from "../../supabase/functions/_shared/paige-turn/route";
import {exposureFor} from "../../supabase/functions/_shared/paige-turn/exposure";

const source=readFileSync("supabase/functions/paige-ai-chat/index.ts","utf8");
const ast=ts.createSourceFile("handler.ts",source,ts.ScriptTarget.Latest,true);
const declaration=(name:string)=>{
 const found:ts.Node[]=[];const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name
  &&(name!=="response"||n.initializer?.getText(ast).includes("fabricChatStream(")))found.push(n);ts.forEachChild(n,visit);};visit(ast);
 if(found.length!==1)throw Error("Original declaration changed: "+name);return found[0].getText(ast);
};
const compile=(value:string)=>ts.transpileModule(value,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const id=(n:number)=>`e0997400-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor=id(1),tenant=id(2),contact=id(3),thread=id(4),intent=id(5),url="https://example.org/guide";
const snapshot={version:1 as const,kind:"customer_public_link" as const,actor_id:actor,tenant_id:tenant,contact_id:contact,thread_id:thread,intent_id:intent,url};

it("the original unclassified route already preserves an operational floor for a deterministic admitted read",()=>{
 const facts={surface:"chat" as const,approvedCard:false,answerBinding:false,
  foreground:{offer:{kind:"none" as const,reason:"not_affirmative" as const},standingCard:false},
  acceptedOfferKind:null,attachments:{document:false,image:false},classification:null};
 const route=resolveTurnRoute(facts);
 expect(route.cognitive_class).toBe("operational");expect(route.capability.tools).toBe("act");
 expect(route.reasons).toContain("unclassified_default");
 // The existing router grants no authority. The native customer adapter supplies
 // ONE read definition; the conservative route cannot grow that supplied set.
 const selectedDefinition={type:"function" as const,function:{name:"web_fetch",description:"Existing read",parameters:{}}};
 expect(exposureFor([selectedDefinition],route.capability.tools).offered).toEqual([selectedDefinition]);
 expect(resolveTurnRoute({...facts,approvedCard:true}).cognitive_class).toBe("deterministic");
});

function selectedCall(portal=true,mode:string|null="bound"){
 const definition={type:"function",function:{name:"web_fetch",description:"Original canonical definition",parameters:{type:"object"}}};
 const defs=[{type:"function",function:{name:"owner_write"}},definition];
 const make=new Function("env",compile("const {customerPortal,customerPublicLinkContext,customerPublicLinkSnapshot,toolDefs,CUSTOMER_PUBLIC_LINK_PURPOSE}=env;const "+declaration("customerPublicLinkTool")+";const "+declaration("customerPublicLinkCall")+";return {tool:customerPublicLinkTool,call:customerPublicLinkCall};"));
 return {definition,...make({customerPortal:portal,customerPublicLinkContext:mode?{mode,snapshot}:null,customerPublicLinkSnapshot:snapshot,toolDefs:defs,CUSTOMER_PUBLIC_LINK_PURPOSE})};
}
it("prepares one server-issued call from the original definition and accepted URL only",()=>{
 const read=selectedCall();expect(read.tool).toBe(read.definition);
 expect(read.call).toMatchObject({type:"function",function:{name:"web_fetch",arguments:JSON.stringify({url,purpose:CUSTOMER_PUBLIC_LINK_PURPOSE})}});
 expect(read.call.id).toMatch(/^[0-9a-f-]{36}$/);
 for(const [portal,mode] of [[false,"bound"],[true,null],[true,"fresh"],[true,"legacy"]] as const)expect(selectedCall(portal,mode).call).toBeNull();
});
it("the actual dispatch gate handles only its one exact prepared read and refuses model-selected or repeated calls",()=>{
 const read=selectedCall(),found:ts.IfStatement[]=[];
 const visit=(n:ts.Node)=>{if(ts.isIfStatement(n)&&ts.isBlock(n.thenStatement)&&n.expression.getText(ast)==="customerPortal"&&n.thenStatement.getText(ast).includes("customerPublicLinkAttempted = true"))found.push(n);ts.forEachChild(n,visit);};visit(ast);
 expect(found).toHaveLength(1);
 const make=new Function("env",compile("const {customerPortal,customerPublicLinkCall,customerPublicLinkContext,admitCustomerPublicLinkCall,calls}=env;let customerPublicLinkAttempted=false;const toolResults=[],accepted=[];for(const tc of calls){"+found[0].getText(ast)+";accepted.push(tc);}return {accepted,toolResults,attempted:customerPublicLinkAttempted};"));
 const clone=()=>JSON.parse(JSON.stringify(read.call));
 const badName=clone();badName.function.name="web_search";
 const badUrl=clone();badUrl.function.arguments=JSON.stringify({url:"https://example.org/another"});
 const extra=clone();extra.function.arguments=JSON.stringify({url,private_query:"never egress"});
 const foreignId=clone();foreignId.id=id(99);
 const result=make({customerPortal:true,customerPublicLinkCall:read.call,customerPublicLinkContext:{mode:"bound",snapshot},admitCustomerPublicLinkCall,
  calls:[badName,badUrl,extra,foreignId,read.call,clone()]});
 expect(result.accepted).toEqual([read.call]);expect(result.attempted).toBe(true);expect(result.toolResults).toHaveLength(5);
 expect(result.toolResults.every((r:{content:string})=>JSON.parse(r.content).error==="CUSTOMER_ACTION_UNAVAILABLE")).toBe(true);
});
it("the original first-model declaration waits for the prepared read instead of asking a model to choose customer tools",async()=>{
 const call=selectedCall().call,model=vi.fn(async()=>({ok:true}));
 const make=new (Object.getPrototypeOf(async()=>{}).constructor)("env",compile("const {resumeCalls,customerPublicLinkCall,noteFabric,fabricChatStream,roundClass,liveDecisionMessages,aiMessages,roundTools,traceFor,revalidateTurnProvider,paigeThinkingOn}=env;const "+declaration("response")+";return response;"));
 const result=await make({resumeCalls:[],customerPublicLinkCall:call,noteFabric:(_label:string,v:unknown)=>v,fabricChatStream:model,roundClass:"operational",
  liveDecisionMessages:(v:unknown)=>v,aiMessages:[],roundTools:()=>[],traceFor:()=>({}),revalidateTurnProvider:async()=>true,paigeThinkingOn:false});
 expect(result).toBeNull();expect(model).not.toHaveBeenCalled();
});

async function currentness(){
 const frame={actor_id:actor,profile:{id:contact,tenant_id:tenant,linked_user_id:actor},brand:{tenant_id:tenant,tenant_name:"Test business"},config:{assistant:{enabled:true}}};
 const knowledge={frame,thread_id:thread,intent_id:intent,snapshot:{version:2,retrieval_refs:[],source_refs:[]},sources:[],history:[],history_limited:false,
  ranking:"recency",sources_limited:false,authorized_count:0,query_embedding_eligible:false};
 const progress={frame,thread_id:thread,intent_id:intent,mode:"fresh",snapshot:{version:1,kind:"customer_progress",tenant_id:tenant,contact_id:contact,source_fingerprint:"a".repeat(64)},
  progress:{tenant_id:tenant,summary:{shared:0,done:0,open:0,overdue:0},items:[],has_more:false}};
 const sessions={frame,thread_id:thread,intent_id:intent,mode:"fresh",snapshot:{version:1,kind:"customer_sessions",tenant_id:tenant,contact_id:contact,source_fingerprint:"b".repeat(64)},
  sessions:{tenant_id:tenant,upcoming:{items:[],has_more:false},past:{items:[],has_more:false}}};
 let link:unknown={thread_id:thread,intent_id:intent,mode:"bound",snapshot:{...snapshot}},linkError:unknown=null;
 const caller={rpc:vi.fn(async(name:string)=>({data:name==="paige_chat_customer_thread_authorized"?true:name==="client_portal_assistant_progress_context"?progress:
  name==="client_portal_assistant_sessions_context"?sessions:name==="client_portal_assistant_link_context"?link:knowledge,error:name==="client_portal_assistant_link_context"?linkError:null}))};
 const k=await readCustomerAssistantContext(caller,actor,thread,intent);expect(k.status).toBe("available");
 const p=await readCustomerProgressContext(caller,actor,thread,intent,k.data!.persona);expect(p.status).toBe("available");
 const s=await readCustomerSessionsContext(caller,actor,thread,intent,k.data!.persona);expect(s.status).toBe("available");
 const l=await readCustomerPublicLinkContext(caller,actor,thread,intent,k.data!.persona,url);expect(l.status).toBe("available");
 const make=new Function("env",compile("let tenantKnowledgeScopeRevoked=false;const customerPortal=true,customerInvoicesContext=null,customerFilesContext=null;const {customerCaller,user,payloadThreadId,validatedData,customerAssistant,customerPersona,customerProgressContext,customerSessionsContext,customerPublicLinkContext,readCustomerAssistantContext,readCustomerProgressContext,readCustomerSessionsContext,readCustomerPublicLinkContext}=env;const "+declaration("revalidateTenantKnowledgeScope")+";return revalidateTenantKnowledgeScope;"));
 const check=make({customerCaller:caller,user:{id:actor},payloadThreadId:thread,validatedData:{requestIntentId:intent},customerAssistant:k.data,customerPersona:k.data!.persona,
  customerProgressContext:p.data,customerSessionsContext:s.data,customerPublicLinkContext:l.data,readCustomerAssistantContext,readCustomerProgressContext,readCustomerSessionsContext,readCustomerPublicLinkContext});
 return {check,replace:(value:unknown,error:unknown=null)=>{link=value;linkError=error;},restore:()=>{link={thread_id:thread,intent_id:intent,mode:"bound",snapshot:{...snapshot}};linkError=null;}};
}
it.each(["changed URL","wrong actor","wrong business","wrong customer","legacy downgrade","revoked source"])("the actual provider/publication fence permanently retires %s",async reason=>{
 const x=await currentness();expect(await x.check()).toBe(true);
 const changed={thread_id:thread,intent_id:intent,mode:"bound",snapshot:{...snapshot}};
 if(reason==="changed URL")changed.snapshot.url="https://example.org/another";
 if(reason==="wrong actor")changed.snapshot.actor_id=id(99);
 if(reason==="wrong business")changed.snapshot.tenant_id=id(99);
 if(reason==="wrong customer")changed.snapshot.contact_id=id(99);
 if(reason==="legacy downgrade")x.replace({thread_id:thread,intent_id:intent,mode:"legacy",snapshot:null});
 else if(reason==="revoked source")x.replace(null,{code:"42501"});else x.replace(changed);
 expect(await x.check()).toBe(false);x.restore();expect(await x.check()).toBe(false);
});

function begin(customerPortal:boolean,customerPublicLink:string|null,customerFileIds?:string[]){
 const rpc=vi.fn(async(..._args:unknown[])=>({data:{status:"accepted"},error:null}));
 const make=new Function("env",compile("const {customerPortal,customerPublicLink,customerFileIds,customerCaller,supabaseClient,interactiveInput,validatedData,userText,customerQuery}=env;const customerInvoicesSelected=false;const "+declaration("beginTurn")+";return beginTurn;"));
 return {rpc,call:make({customerPortal,customerPublicLink,customerFileIds,customerCaller:{rpc},supabaseClient:{rpc},interactiveInput:{kind:"message"},
  validatedData:{threadId:thread,requestIntentId:intent},userText:"Read the public guide",customerQuery:null})};
}
it.each([{files:undefined as string[]|undefined},{files:[id(6)]}])("uses the original native link admission and delegates optional files without owner authority: $files",async({files})=>{
 const x=begin(true,url,files);await x.call(true);
 expect(x.rpc).toHaveBeenCalledWith("client_portal_assistant_begin_link",expect.objectContaining({p_thread:thread,p_intent:intent,p_url:url,p_file_ids:files??null,p_effectful:true}));
});
it("preserves original no-link and owner begin paths",async()=>{
 const customer=begin(true,null);await customer.call(true);expect(customer.rpc.mock.calls[0][0]).toBe("client_portal_assistant_begin_sessions");
 const owner=begin(false,null);await owner.call(true);expect(owner.rpc.mock.calls[0][0]).toBe("paige_chat_interactive_begin_v2");
 expect(owner.rpc.mock.calls[0][1]).not.toHaveProperty("p_url");
});
it.each(["FINAL","WITHHELD","INTERRUPTED","REFUSED"])("settles %s only with the original accepted link or source-free cleanup",async state=>{
 const rpc=vi.fn(async(..._args:unknown[])=>({data:id(9),error:null}));
 const make=new Function("env",compile("const {supabase,supabaseClient,user,interactiveReceiptScope,customerPublicLinkSnapshot,customerTerminalSource,customerProgressTerminalSource,customerSessionsTerminalSource,customerFilesTerminalSource,customerPublicLinkTerminalSource,customerInvoicesTerminalSource,z}=env;const customerSourceSnapshot=null,customerProgressSnapshot=null,customerSessionsSnapshot=null,customerFilesSnapshot=null,customerInvoicesSnapshot=null;const customerPortal=true;const "+declaration("appendAssistant")+";return appendAssistant;"));
 await make({supabase:{rpc},supabaseClient:{rpc},user:{id:actor},interactiveReceiptScope:{thread,tenant,intent},customerPublicLinkSnapshot:snapshot,
  customerTerminalSource,customerProgressTerminalSource,customerSessionsTerminalSource,customerFilesTerminalSource,customerPublicLinkTerminalSource,customerInvoicesTerminalSource,z})({
   p_thread_id:thread,p_role:"assistant",p_content:"A real result, if read",p_bundle_ref:{turn_state:{state},customer_public_link:{url:"https://example.org/forged"}}});
 const args=rpc.mock.calls[0][1] as Record<string,unknown>,bundle=args.p_bundle_ref as Record<string,unknown>;
 expect(rpc.mock.calls[0][0]).toBe("paige_chat_interactive_settle");expect(args).toMatchObject({p_thread:thread,p_actor:actor,p_tenant:tenant,p_intent:intent});
 if(state==="FINAL"){expect(bundle.customer_public_link).toEqual(snapshot);expect(args.p_content).toBe("A real result, if read");}
 else{expect(bundle).not.toHaveProperty("customer_public_link");expect(args.p_content).toBe("");}
});
