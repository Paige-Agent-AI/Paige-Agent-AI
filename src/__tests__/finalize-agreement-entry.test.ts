import {readFileSync} from "node:fs";
import ts from "typescript";
import {describe,it,expect} from "vitest";
import {clientServiceAgreementMatches} from "../../supabase/functions/_shared/client-service-agreement-validation";
import {DEFAULT_AGREEMENT_TEMPLATE,renderAgreementBody} from "../pages/onboard/agreement-default";
const source=readFileSync("supabase/functions/finalize-agreement/index.ts","utf8");
const ast=ts.createSourceFile("finalize.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const serve=ast.statements.find(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)==="Deno.serve") as ts.ExpressionStatement;
const expression=(serve.expression as ts.CallExpression).arguments[0].getText(ast);
const errorFunction=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="err")!;
const compiled=ts.transpileModule(errorFunction.getText(ast)+"\nconst handler="+expression+";",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const client="e0931000-0000-0000-0000-000000000001",user="e0911000-0000-0000-0000-000000000001";
const profile={id:client,linked_user_id:user,first_name:"Test",last_name:"Customer"};
const tenant={tenant_name:"Test Service",agreement_body:null};
function body(){const today=new Date().toISOString().slice(0,10);return{client_id:client,agreement_template_key:"platform_default",agreement_version:"default-v1",agreement_text_snapshot:renderAgreementBody(DEFAULT_AGREEMENT_TEMPLATE,{tenant_name:tenant.tenant_name,client_full_legal_name:"Test Customer",effective_date:today,signature_date:today}),signature:{typed_name:"Test Customer",e_sign_consent:true,read_consent:true}};}
function setup(options:{profile?:unknown;source?:unknown;readError?:boolean;actor?:string;linked?:string}={}){
 const effects:string[]=[],calls:string[]=[];
 const admin={auth:{getUser:async()=>({data:{user:{id:options.actor??user}},error:null})},
  storage:{from:()=>({upload:async()=>{effects.push("upload");return{error:null};}})},
  from:(table:string)=>{
   const b={select:()=>b,eq:()=>b,in:()=>b,
    maybeSingle:async()=>({data:{id:client,linked_user_id:options.linked??user,onboarding_stage:"signing_agreement",first_name:"Test",last_name:"Customer"},error:null}),
    insert:()=>{effects.push("insert:"+table);return b;},single:async()=>({data:{id:"signed-a"},error:null}),
    update:()=>{effects.push("update:"+table);return b;},then:(done:(v:unknown)=>unknown)=>Promise.resolve({error:null}).then(done)};return b;
  }};
 const caller={rpc:async(name:string)=>{calls.push(name);return{data:name==="client_portal_self_profile"?("profile" in options?options.profile:profile):("source" in options?options.source:tenant),error:options.readError?{code:"42501"}:null};}};
 const instantiate=new Function("createClient","SUPABASE_URL","SERVICE_ROLE_KEY","Deno","clientServiceAgreementMatches","buildPdf","decodeBase64Image","corsHeaders",compiled+"\nreturn handler;");
 const handler=instantiate((_url:string,key:string)=>key==="synthetic-service-key"?admin:caller,"https://unit-test.invalid","synthetic-service-key",{env:{get:()=>"synthetic-public-key"}},clientServiceAgreementMatches,async()=>{effects.push("pdf");return new Uint8Array([1,2]);},()=>null,{});
 const invoke=(payload:unknown=body())=>handler(new Request("https://unit-test.invalid/finalize-agreement",{method:"POST",headers:{Authorization:"Bearer synthetic-customer-token","Content-Type":"application/json"},body:JSON.stringify(payload)})) as Promise<Response>;
 return{invoke,effects,calls};
}
describe("actual finalize-agreement handler entry boundary",()=>{
 it("uses actual-caller canonical profile and agreement reads before signing the exact document",async()=>{
  const h=setup(),r=await h.invoke();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({ok:true,agreement_id:"signed-a"});
  expect(h.calls).toEqual(["client_portal_self_profile","get_client_service_agreement"]);
  expect(h.effects).toEqual(["pdf","upload","insert:paige_signed_agreements","update:clients"]);
 });
 it.each([{agreement_text_snapshot:"forged agreement"},{agreement_version:"forged-version"},{agreement_template_key:"foreign-template"}])("rejects tampered presentation %j before any PDF/storage/write",async patch=>{
  const h=setup(),r=await h.invoke({...body(),...patch});expect(r.status).toBe(409);expect(h.effects).toEqual([]);
 });
 it.each([{profile:null},{profile:{...profile,id:"wrong-client"}},{profile:{...profile,linked_user_id:"wrong-subject"}},{readError:true}])("refuses unavailable, foreign or revoked scope %j before signing",async options=>{
  const h=setup(options),r=await h.invoke();expect(r.status).toBe(403);expect(h.effects).toEqual([]);
 });
 it("does not trust a globally signed-in actor to claim another linked record",async()=>{
  const h=setup({linked:"other-subject"}),r=await h.invoke();expect(r.status).toBe(403);expect(h.effects).toEqual([]);expect(h.calls).toEqual([]);
 });
 it("rejects string consent and malformed signer data",async()=>{
  const h=setup(),r=await h.invoke({...body(),signature:{typed_name:123,e_sign_consent:"yes",read_consent:true}});expect(r.status).toBe(400);expect(h.effects).toEqual([]);
 });
});
