import {readFileSync} from "node:fs";
import ts from "typescript";
import {describe,it,expect} from "vitest";
import {orderedContactMethods,primaryContactMethod} from "../../supabase/functions/_shared/contact-methods";

// Execute the actual self resolver and registered handler, not a copied model.
// OAuth verification/tier middleware and Data API transport are explicit doubles.
const source=readFileSync("supabase/functions/paige-mcp/index.ts","utf8");
const ast=ts.createSourceFile("paige-mcp.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const nodes=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&["actorClient","withPrimaryAddressFields"].includes(node.name?.text??"")
  ||ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)
  &&node.expression.expression.getText(ast)==="mcp.tool"
  &&["me_get_profile","me_update_profile"].includes((node.expression.arguments[0] as ts.StringLiteral)?.text));
const script=ts.transpileModule(nodes.map(n=>n.getText(ast)).join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function load(overrides:Record<string,unknown>={}){
 const actor="actual-client",queries:Array<{select:string;filters:Array<[string,string,unknown]>}>=[];
 const row={id:"client-a",tenant_id:"tenant-a",linked_user_id:actor,status:"active",merged_into_contact_id:null,portal_access_state:"open",
   first_name:"Test",last_name:"Customer",onboarding_stage:"invited",tenants:{status:"active"},
   current_notes:"PRIVATE INTERNAL NOTE",provider_secret:"PRIVATE PROVIDER VALUE",lead_score:99,
   client_contact_methods:[{kind:"email",value:"client@tests.invalid",is_primary:true}],...overrides};
 const admin={from:()=>{
   const q={select:"",filters:[] as Array<[string,string,unknown]>};queries.push(q);
   const b={select:(s:string)=>{q.select=s;return b;},eq:(k:string,v:unknown)=>{q.filters.push(["eq",k,v]);return b;},is:(k:string,v:unknown)=>{q.filters.push(["is",k,v]);return b;},
    maybeSingle:async()=>{
      const matches=q.filters.every(([,k,v])=>k==="tenants.status"?(row.tenants as {status:string}).status===v:row[k as keyof typeof row]===v);
      if(!matches)return{data:null,error:null};
      const data=Object.fromEntries(Object.entries(row).filter(([k])=>q.select.split(/[,(!]/).map(s=>s.trim()).includes(k)));
      return{data,error:null};
    }};return b;
 }};
 const handlers:Record<string,{handler:(patch?:unknown)=>Promise<unknown>}>= {};
 const schema=()=>({optional:()=>({describe:()=>({})}),describe:()=>({})});
 const z={object:()=>({}),string:schema,number:schema};
 const run=new Function("admin","currentActor","mcp","z","ok","err","orderedContactMethods","primaryContactMethod",script);
 run(admin,()=>({user_id:actor}),{tool:(name:string,value:typeof handlers[string])=>{handlers[name]=value;}},z,(data:unknown)=>data,(error:string)=>({error}),orderedContactMethods,primaryContactMethod);
 return{handlers,queries};
}
describe("MCP customer profile privacy before opening external entry",()=>{
 it("returns permitted profile fields while withholding raw CRM notes, scores and provider data",async()=>{
  const {handlers,queries}=load();const result=await handlers.me_get_profile.handler();
  expect(JSON.stringify(result)).toContain("Customer");
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|current_notes|provider_secret|lead_score/);
  expect(queries[0].filters).toEqual(expect.arrayContaining([["eq","linked_user_id","actual-client"],["eq","status","active"],["is","merged_into_contact_id",null],["eq","portal_access_state","open"],["eq","tenants.status","active"]]));
 });
 it.each([{linked_user_id:"foreign"},{status:"archived"},{merged_into_contact_id:"survivor"},{tenants:{status:"suspended"}},
  // E09 Slice 7: a paused relationship is not the customer's while the owner holds it.
  {portal_access_state:"paused"}])("refuses an unavailable relationship %j",async override=>{
  const {handlers,queries}=load(override);expect(await handlers.me_get_profile.handler()).toEqual({error:"no_linked_client_record"});expect(queries).toHaveLength(1);
 });
 it.each([{current_notes:"replace internal note"},{funding_goal_amount:999}])("refuses internal CRM/commercial edits %j",async patch=>{
  const {handlers,queries}=load();expect(await handlers.me_update_profile.handler(patch)).toEqual({error:"field_not_customer_editable"});expect(queries).toHaveLength(1);
 });
});
