import {readFileSync} from "node:fs";
import ts from "typescript";
import {describe,expect,it,vi} from "vitest";

const source=readFileSync("supabase/functions/paige-context-router/index.ts","utf8");
if((source.match(/^import .*;\r?$/gm)??[]).length!==2)throw Error("Review the changed legacy router module boundary");
const javascript=ts.transpileModule(source.replace(/^import .*;\r?\n/gm,""),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const actor="e0927000-0000-4000-8000-000000000001",thread="e0927000-0000-4000-8000-000000000002";
async function drive({audience="workspace",readError=false,missing=false,resume=true}={}){
 let handler:(request:Request)=>Promise<Response>;
 const calls:string[]=[];
 const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},
  from:(table:string)=>{let columns="";
   const result=()=>{calls.push(table+":"+columns);return table==="paige_chat_threads"
    ?{data:missing?null:{audience,summary:null},error:readError?{message:"read unavailable"}:null}
    :{data:table==="profiles"?{full_name:"Test Actor"}:table==="user_roles"?[{role:"admin"}]
      :[{role:"user",content:"NATIVE_HISTORY_SENTINEL"}],error:null};};
   const q={select:(value:string)=>{columns=value;return q;},eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,
    maybeSingle:async()=>result(),then:(ok:(v:unknown)=>unknown,bad:(e:unknown)=>unknown)=>Promise.resolve(result()).then(ok,bad)};
   return q;},
  rpc:async(name:string)=>{calls.push(name);return {data:name==="load_self_context"
   ?{ok:true,bundle:{workspace:"TEST_WORKSPACE_CONTEXT"},surfaces_used:[],row_count:1}
   :thread,error:null};}};
 const provider=vi.fn(async()=>Response.json({choices:[{message:{content:"Workspace answer"}}]}));
 new Function("createClient","gatewayCompat","Deno",javascript)(()=>client,provider,
  {env:{get:()=>"synthetic-local-only"},serve:(value:typeof handler)=>{handler=value;}});
 const response=await handler!(new Request("https://audience.tests.invalid",{method:"POST",
  headers:{Authorization:"Bearer synthetic-local-only","Content-Type":"application/json"},
  body:JSON.stringify({self:true,user_prompt:"Help me",...(resume?{thread_id:thread}:{})})}));
 return {status:response.status,body:await response.json(),calls,provider};
}
describe("customer-private history cannot be replayed through the legacy workspace router",()=>{
 for(const options of [{audience:"customer_private"},{audience:"unexpected"},{readError:true},{missing:true}])
  it("refuses a non-workspace or unverified audience before context/provider/writes "+JSON.stringify(options),async()=>{
   const r=await drive(options);expect(r.status).toBe(403);expect(r.provider).not.toHaveBeenCalled();
   expect(r.calls).not.toContain("load_self_context");expect(r.calls).not.toContain("paige_chat_turn_append");
  });
 it("preserves an authorized workspace conversation",async()=>{
  const r=await drive();expect(r.status).toBe(200);expect(r.body.answer).toBe("Workspace answer");
  expect(r.provider).toHaveBeenCalledOnce();expect(JSON.stringify(r.provider.mock.calls)).toContain("NATIVE_HISTORY_SENTINEL");
 });
 it("preserves creation through the existing workspace RPC",async()=>{
  const r=await drive({resume:false});expect(r.status).toBe(200);expect(r.calls).toContain("paige_chat_thread_create");
  expect(r.provider).toHaveBeenCalledOnce();
 });
});
