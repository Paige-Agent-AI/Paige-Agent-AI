import {readFileSync} from "node:fs";
import ts from "typescript";
import {describe,expect,it} from "vitest";

const source=readFileSync("supabase/functions/admin-delete-user/index.ts","utf8");
const imports=source.match(/^import .*;\r?$/gm)??[];
if(imports.length!==2)throw Error("Review the deletion handler's changed module boundary");
const javascript=ts.transpileModule(source.replace(/^import .*;\r?\n/gm,""),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const actor="e0918000-0000-4000-8000-000000000001",target="e0918000-0000-4000-8000-000000000002";
async function drive({role="super_admin",keep=true,self=false,owner=false,cleanupError=false}={}){
 const calls:Array<{table:string;operation:string;filters:unknown[]}>=[];
 let handler:(request:Request)=>Promise<Response>;
 const admin={auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),admin:{
  getUserById:async()=>({data:{user:{email:owner?"owner@tests.invalid":"client@tests.invalid"}}}),
  deleteUser:async(id:string)=>{calls.push({table:"auth.users",operation:"delete",filters:[id]});
   return {error:cleanupError?{message:"retained private history restricts deletion"}:null};}}},
  from:(table:string)=>{let operation="select";const filters:unknown[]=[];
   const result=()=>{calls.push({table,operation,filters:[...filters]});return {data:table==="user_roles"
    ?[{role}]:table==="app_settings_owner"?{owner_email:"owner@tests.invalid"}:null,
    error:cleanupError&&table==="paige_chat_threads"?{message:"private cleanup unavailable"}:null};};
   const q={select:()=>q,eq:(...args:unknown[])=>{filters.push(args);return q;},limit:()=>q,
    update:()=>{operation="update";return q;},delete:()=>{operation="delete";return q;},
    insert:()=>{operation="insert";return q;},maybeSingle:async()=>result(),
    then:(done:(value:unknown)=>unknown,failed:(error:unknown)=>unknown)=>Promise.resolve(result()).then(done,failed)};
   return q;}};
 new Function("serve","createClient","Deno","console",javascript)(
  (value:typeof handler)=>{handler=value;},()=>admin,{env:{get:()=>"synthetic-local-only"}},{error:()=>{}});
 const response=await handler!(new Request("https://deletion.tests.invalid",{method:"POST",
  headers:{Authorization:"Bearer synthetic-local-only","Content-Type":"application/json"},
  body:JSON.stringify({user_id:self?actor:target,keep_contact:keep})}));
 return {status:response.status,body:await response.json(),calls};
}
describe("canonical account deletion with customer-private Chat",()=>{
 for(const keep of [true,false])it("cleans only target-authored private Chat before Auth deletion; keep_contact="+keep,async()=>{
  const r=await drive({keep});expect(r.status).toBe(200);
  const privateIndex=r.calls.findIndex(c=>c.table==="paige_chat_threads");
  expect(privateIndex).toBeGreaterThan(-1);
  expect(r.calls[privateIndex]).toEqual({table:"paige_chat_threads",operation:"delete",
   filters:[["caller_user_id",target],["audience","customer_private"]]});
  expect(privateIndex).toBeLessThan(r.calls.findIndex(c=>c.table==="auth.users"));
 });
 for(const role of ["client","member"])it("does not give "+role+" account-deletion authority",async()=>{
  const r=await drive({role});expect(r.status).toBe(403);
  expect(r.calls.some(c=>c.operation==="delete")).toBe(false);
 });
 for(const options of [{self:true},{owner:true}])it("preserves protected self/platform-owner refusal",async()=>{
  const r=await drive(options);expect(r.status).not.toBe(200);
  expect(r.calls.some(c=>c.operation==="delete")).toBe(false);
 });
 it("does not claim successful Auth deletion when private cleanup is incomplete",async()=>{
  const r=await drive({cleanupError:true});expect(r.status).toBe(500);
  expect(r.body.error).toContain("private cleanup unavailable");
 });
});

