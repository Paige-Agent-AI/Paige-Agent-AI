import {readFileSync} from "node:fs";
import ts from "typescript";
import {createClient} from "@supabase/supabase-js";
import {describe,expect,it} from "vitest";

// Evaluate the actual reviewed caller initializer/CORS object, then use the real
// SDK's request transport with synthetic fetch. This is wire-contract evidence,
// never native authorization, live Auth or a model/provider acceptance claim.
const source=readFileSync("supabase/functions/paige-ai-chat/index.ts","utf8");
const ast=ts.createSourceFile("chat.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const variable=(name:string)=>{let found:ts.Expression|undefined;const visit=(n:ts.Node)=>{
 if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.name.text===name){if(found)throw Error("Ambiguous reviewed initializer");found=n.initializer;}
 ts.forEachChild(n,visit);};visit(ast);if(!found)throw Error("Missing original "+name);return found.getText(ast);};
const evaluate=(name:string,bindings:Record<string,unknown>)=>{
 const js=ts.transpileModule("const value=()=> ("+variable(name)+");",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 return new Function(...Object.keys(bindings),js+"\nreturn value();")(...Object.values(bindings));
};
const a="e0927000-0000-4000-8000-000000000001",b="e0927000-0000-4000-8000-000000000002";
async function callerRequest(business:string|null,purpose:"customer"|"owner"="customer",kind:"rpc"|"thread"="rpc"){
 const seen:Array<{authorization:string|null;business:string|null;path:string}>=[],keys:string[]=[];
 const headers=new Headers({Authorization:"Bearer synthetic-cura-captured"});if(business!==null)headers.set("x-client-portal-business",business);
 const factory=(url:string,key:string,options:Parameters<typeof createClient>[2])=>{
  keys.push(key);return createClient(url,key,{...options,auth:{persistSession:false,autoRefreshToken:false},global:{...options?.global,fetch:async(input,init)=>{
   const h=new Headers(init?.headers);seen.push({authorization:h.get("Authorization"),business:h.get("x-client-portal-business"),path:String(input)});
   return new Response("null",{status:200,headers:{"Content-Type":"application/json"}});
  }}});
 };
 const bindings={req:{headers},authHeader:headers.get("Authorization"),supabaseUrl:"https://synthetic-cura.invalid",supabaseKey:"synthetic-anon-key",supabaseServiceKey:"synthetic-service-key",createClient:factory,customerPortal:purpose==="customer"};
 const originalCaller=evaluate("supabaseClient",bindings);
 const customer=evaluate("customerCaller",{...bindings,supabaseClient:originalCaller});
 expect(keys).toHaveLength(purpose==="customer"?2:1);expect(keys.every(k=>k==="synthetic-anon-key")).toBe(true);
 if(purpose==="owner")expect(customer).toBe(originalCaller);
 if(kind==="thread"){
  const query=evaluate("threadMetadataQuery",{customerCaller:customer,validatedData:{threadId:"e0947000-0000-4000-8000-000000000002"},user:{id:"e0917000-0000-4000-8000-000000000001"}});
  await query.maybeSingle();
 }else await customer.rpc("client_portal_self_profile");
 return seen;
}

describe("original CURA caller transport",()=>{
 it("carries the selected B hint and captured bearer to original native authorization",async()=>{
  expect(await callerRequest(b)).toEqual([{authorization:"Bearer synthetic-cura-captured",business:b,path:"https://synthetic-cura.invalid/rest/v1/rpc/client_portal_self_profile"}]);
 });
 it("keeps concurrent A/B request clients isolated",async()=>{
  const [first,second]=await Promise.all([callerRequest(a),callerRequest(b)]);expect(first[0].business).toBe(a);expect(second[0].business).toBe(b);
 });
 it("keeps an incoming customer hint off the original owner caller",async()=>{
  expect((await callerRequest(b,"owner"))[0]).toMatchObject({authorization:"Bearer synthetic-cura-captured",business:null});
 });
 it("scopes the original private thread RLS query with the selected business",async()=>{
  const seen=await callerRequest(b,"customer","thread");expect(seen[0]).toMatchObject({authorization:"Bearer synthetic-cura-captured",business:b});
  expect(seen[0].path).toContain("/rest/v1/paige_chat_threads?");
  const url=new URL(seen[0].path);expect(url.searchParams.get("id")).toBe("eq.e0947000-0000-4000-8000-000000000002");expect(url.searchParams.get("caller_user_id")).toBe("eq.e0917000-0000-4000-8000-000000000001");
 });
 it("preserves the original no-hint caller Auth contract",async()=>{
  const seen=await callerRequest(null);expect(seen[0]).toMatchObject({authorization:"Bearer synthetic-cura-captured",business:null});
 });
 it("admits the customer hint through the actual existing CORS policy",()=>{
  const cors=evaluate("corsHeaders",{CHAT_CONTROL_HEADER:"x-paige-chat-control"});expect(cors["Access-Control-Allow-Headers"].split(",").map((s:string)=>s.trim())).toContain("x-client-portal-business");
  expect(cors["Access-Control-Allow-Headers"]).toContain("authorization");expect(cors["Access-Control-Allow-Headers"]).toContain("x-paige-chat-control");
 });
 it("does not attach the customer hint or caller bearer to the original service client",()=>{
  const calls:unknown[][]=[];evaluate("supabase",{supabaseUrl:"https://synthetic-cura.invalid",supabaseServiceKey:"synthetic-service-key",createClient:(...args:unknown[])=>{calls.push(args);return {};}});
  expect(calls).toEqual([["https://synthetic-cura.invalid","synthetic-service-key"]]);
 });
});
