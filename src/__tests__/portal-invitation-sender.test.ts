import {readFileSync} from "node:fs";
import ts from "typescript";
import {describe,expect,it} from "vitest";
import {commsProviderExecutionAllowed} from "../../supabase/functions/_shared/comms-provider-boundary";

// The incumbent actual-handler test pattern: replace the two inspected module
// boundaries only, execute the real handler, never permit a network effect.
const source=readFileSync("supabase/functions/send-portal-invite/index.ts","utf8");
if((source.match(/^import .*;\r?$/gm)??[]).length!==2)throw Error("Review the changed invitation module boundary");
const javascript=ts.transpileModule(source.replace(/^import .*;\r?\n/gm,""),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const actor="e0919000-0000-4000-8000-000000000001",tenant="e0929000-0000-4000-8000-000000000001",
 contact="e0939000-0000-4000-8000-000000000001",invitation="e0949000-0000-4000-8000-000000000001";
const recipient="client@tests.invalid";
type Options={header?:boolean;authenticated?:boolean;authThrows?:boolean;authority?:"admin"|"agency"|"platform"|"team_owner"|"none";
 token?:Record<string,unknown>;client?:Record<string,unknown>|null;emails?:unknown[];rpcError?:boolean;
 providerAllowed?:boolean;lateChange?:"role"|"actor"|"email"|"token"|"provider";transportUnknown?:boolean;body?:Record<string,unknown>;teamAction?:"create"|"resend"};
async function drive(options:Options={}){
 let handler:(request:Request)=>Promise<Response>,brandRead=false;
 const calls:Array<{kind:string;name:string;args:unknown}>=[],sends:unknown[]=[],logs:unknown[]=[];
 const token={id:invitation,tenant_id:tenant,contact_id:contact,kind:"consumer",email:recipient,
  revoked_at:null,expires_at:"2099-01-01T00:00:00Z",uses:0,max_uses:1,last_used_at:null,...options.token};
 const client=options.client===null?null:{id:contact,tenant_id:tenant,status:"active",merged_into_contact_id:null,
  do_not_contact:false,linked_user_id:null,...options.client};
 const methods=(options.emails??[{kind:"email",is_primary:true,value:recipient}])
  .map(method=>method&&typeof method==="object"?{client_id:contact,tenant_id:tenant,...method}:method);
 function makeClient(_url:string,key:string,configuration?:{global?:{headers?:{Authorization?:string}}}){
  const kind=key.includes("service")?"service":"jwt";
  const actualCaller=configuration?.global?.headers?.Authorization==="Bearer synthetic-local-only";
  return {auth:{getUser:async()=>{if(options.authThrows)throw Error("synthetic Auth transport unavailable");
    return {data:{user:options.authenticated===false||!actualCaller?null:{id:brandRead&&options.lateChange==="actor"?contact:actor}},
    error:options.authenticated===false||!actualCaller?{message:"not authenticated"}:null};}},
   functions:{invoke:async(name:string,input:{headers?:{Authorization?:string};body:unknown})=>{
    if(name!=="send-portal-invite")throw Error("Unexpected function invocation");
    calls.push({kind,name,args:input.headers});
    const result=await handler(new Request("https://invitation.tests.invalid",{method:"POST",headers:{
     Authorization:input.headers?.Authorization??"Bearer synthetic-service-key","Content-Type":"application/json"},body:JSON.stringify(input.body)}));
    return {data:await result.json(),error:result.ok?null:{message:"sender refused"}};
   }},
   rpc:async(name:string,args:unknown)=>{
    calls.push({kind,name,args});
    if(name==="create_solo_team_invite"||name==="resend_solo_team_invite")return options.authority==="none"
     ?{data:null,error:new Error("only an owner or admin may manage team invitations in that workspace")}
     :{data:{id:invitation,token:"synthetic-invite-token",email:recipient,tenant_id:tenant,expires_at:token.expires_at},error:null};
    if(name==="solo_team_invite_authority")return options.authority==="team_owner"&&!(brandRead&&options.lateChange==="role")
     ?{data:tenant,error:null}:{data:null,error:{message:"native team authority refused"}};
    if(name==="resolve_tenant_brand"){brandRead=true;return {data:[{tenant_name:"Test business",primary_color:"#150C31",logo_url:null}],error:null};}
    if(name==="tenant_sender_identity")return {data:{from_address:"business@tests.invalid",from_name:"Test business"},error:null};
    if(name==="comms_provider_execution_allowed")return {data:options.providerAllowed!==false&&!(brandRead&&options.lateChange==="provider"),error:null};
    if(options.rpcError)return {data:null,error:{message:"authority unavailable"}};
    const allowed=!(brandRead&&options.lateChange==="role");
    return {data:allowed&&((name==="is_tenant_admin"&&(options.authority??"admin")==="admin")
     ||(name==="agency_can_manage_child"&&options.authority==="agency")
     ||(name==="is_platform_owner"&&options.authority==="platform")),error:null};
   },
   from:(table:string)=>{
    const filters:unknown[]=[];
    const rows=()=>table==="tenant_invite_tokens"?[brandRead&&options.lateChange==="token"?{...token,revoked_at:"2026-01-01T00:00:00Z"}:token]:table==="clients"?(client?[client]:[]):table==="client_contact_methods"
     ? (brandRead&&options.lateChange==="email"?[{client_id:contact,tenant_id:tenant,kind:"email",is_primary:true,value:"changed@tests.invalid"}]:methods):[];
    const q={select:()=>q,eq:(...args:unknown[])=>{filters.push(args);return q;},is:(...args:unknown[])=>{filters.push(args);return q;},limit:()=>q,
     insert:(value:unknown)=>{logs.push(value);return Promise.resolve({error:null});},
     maybeSingle:async()=>{calls.push({kind,name:table,args:filters});return {data:rows()[0]??null,error:null};},
     then:(done:(value:unknown)=>unknown,failed:(error:unknown)=>unknown)=>{
      calls.push({kind,name:table,args:filters});return Promise.resolve({data:rows(),error:null}).then(done,failed);}};
    return q;
   }};
 }
 const env:Record<string,string>={SUPABASE_URL:"https://test.supabase.co",SUPABASE_ANON_KEY:"test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY:"test-service-key",RESEND_API_KEY:"synthetic-provider-key",PUBLIC_SITE_URL:"https://portal.tests.invalid"};
 new Function("createClient","commsProviderExecutionAllowed","Deno","fetch","console",javascript)(makeClient,commsProviderExecutionAllowed,
  {env:{get:(key:string)=>env[key]??""},serve:(value:typeof handler)=>{handler=value;}},
  async(url:string,request:{body:string})=>{
   if(url!=="https://api.resend.com/emails")throw Error("Unexpected network destination; network is forbidden");
   sends.push(JSON.parse(request.body));if(options.transportUnknown)throw Error("synthetic lost acknowledgement");
   return new Response(JSON.stringify({id:"synthetic-provider-message"}),{status:200,headers:{"Content-Type":"application/json"}});
  },{error:()=>{}});
 let entry=handler!;
 if(options.teamAction){
  const teamSource=readFileSync("supabase/functions/solo-team-invitations/index.ts","utf8");
  if((teamSource.match(/^import .*;\r?$/gm)??[]).length!==1)throw Error("Review the changed team module boundary");
  const teamJavascript=ts.transpileModule(teamSource.replace(/^import .*;\r?\n/gm,""),{
   compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  new Function("createClient","Deno","console",teamJavascript)(makeClient,
   {env:{get:(key:string)=>env[key]??""},serve:(value:typeof entry)=>{entry=value;}},{error:()=>{}});
 }
 const response=await entry(new Request("https://invitation.tests.invalid",{method:"POST",
  headers:{...(options.header===false?{}:{Authorization:"Bearer synthetic-local-only"}),"Content-Type":"application/json"},
  body:JSON.stringify(options.teamAction?{action:options.teamAction,expectedTenantId:tenant,email:recipient,inviteId:invitation,permission:"member"}
   :{token:"synthetic-invite-token",email:recipient,...options.body})}));
 return {status:response.status,body:await response.json(),calls,sends,logs};
}

describe("canonical portal invitation sender authority",()=>{
 for(const authority of ["admin","agency","platform"] as const)it("preserves legitimate "+authority+" sender and current delivery evidence",async()=>{
  const r=await drive({authority});expect(r.status).toBe(200);expect(r.body.emailed).toBe(true);expect(r.sends).toHaveLength(1);
  expect(r.sends[0]).toMatchObject({to:[recipient],from:"Test business <business@tests.invalid>"});
  expect(r.logs).toHaveLength(1);expect(r.logs[0]).toMatchObject({message_id:"synthetic-provider-message",metadata:{actor_user_id:actor,invite_id:invitation}});
  const authorityCalls=r.calls.filter(x=>["is_platform_owner","is_tenant_admin","agency_can_manage_child"].includes(x.name));
  expect(authorityCalls.length).toBeGreaterThanOrEqual(3);expect(authorityCalls.every(x=>x.kind==="jwt")).toBe(true);
  expect(authorityCalls).toEqual(expect.arrayContaining([expect.objectContaining({name:"is_tenant_admin",args:{_tenant:tenant}}),
   expect.objectContaining({name:"agency_can_manage_child",args:{_child:tenant}})]));
 });
 for(const [label,options] of [
  ["missing authorization header",{header:false}], ["no verified user",{authenticated:false}], ["Auth read unavailable",{authThrows:true}],
  ["ordinary recipient or foreign-business actor",{authority:"none",body:{tenant_id:tenant,role:"owner"}}],
  ["ordinary recipient or foreign-business team actor",{authority:"none",token:{kind:"team",contact_id:null}}],
  ["native permission read failed",{rpcError:true}], ["missing contact",{token:{contact_id:null}}],
  ["missing bound recipient",{token:{email:null}}], ["consumed invitation",{token:{uses:1,last_used_at:"2026-01-01T00:00:00Z"}}],
  ["revoked invitation",{token:{revoked_at:"2026-01-01T00:00:00Z"}}], ["expired invitation",{token:{expires_at:"2000-01-01T00:00:00Z"}}],
  ["contact no longer exists",{client:null}], ["foreign contact",{client:{tenant_id:contact}}],
  ["inactive contact",{client:{status:"inactive"}}], ["merged contact",{client:{merged_into_contact_id:invitation}}],
  ["suppressed contact",{client:{do_not_contact:true}}], ["already joined contact",{client:{linked_user_id:actor}}],
  ["changed saved email",{emails:[{kind:"email",is_primary:true,value:"changed@tests.invalid"}]}],
  ["ambiguous primary email",{emails:[{kind:"email",is_primary:true,value:recipient},{kind:"email",is_primary:true,value:recipient}]}],
  ["foreign email-method business",{emails:[{tenant_id:contact,kind:"email",is_primary:true,value:recipient}]}],
  ["foreign email-method client",{emails:[{client_id:invitation,kind:"email",is_primary:true,value:recipient}]}],
  ["permission revoked before provider",{lateChange:"role"}], ["actor changed before provider",{lateChange:"actor"}],
  ["native team owner authority withdrawn before provider",{authority:"team_owner",token:{kind:"team",contact_id:null},lateChange:"role"}],
  ["saved recipient changed before provider",{lateChange:"email"}],
  ["invitation revoked before provider",{lateChange:"token"}], ["provider gate withdrawn before provider",{lateChange:"provider"}],
 ] as Array<[string,Options]>)it("refuses "+label+" without sending or filing a send",async()=>{
  const r=await drive(options);expect(r.body.emailed).not.toBe(true);expect(r.sends).toHaveLength(0);expect(r.logs).toHaveLength(0);
 });
 it("preserves the native provider-execution floor",async()=>{
  const r=await drive({providerAllowed:false});expect(r.status).toBe(403);expect(r.body.code).toBe("COMMS_PROVIDER_EXECUTION_DISABLED");expect(r.sends).toHaveLength(0);
 });
 it("preserves legitimate existing team invitation delivery",async()=>{
  const r=await drive({token:{kind:"team",contact_id:null}});expect(r.status).toBe(200);expect(r.body.emailed).toBe(true);
 });
 it("preserves the incumbent native team owner flag without granting consumer send authority",async()=>{
  const r=await drive({authority:"team_owner",token:{kind:"team",contact_id:null}});
  expect(r.status).toBe(200);expect(r.body.emailed).toBe(true);expect(r.sends).toHaveLength(1);
  expect(r.calls).toContainEqual({kind:"service",name:"solo_team_invite_authority",args:{_actor:actor,_expected_tenant_id:tenant}});
  const consumer=await drive({authority:"team_owner"});expect(consumer.status).toBe(403);expect(consumer.sends).toHaveLength(0);
  expect(consumer.calls.some(x=>x.name==="solo_team_invite_authority")).toBe(false);
 });
 for(const teamAction of ["create","resend"] as const)it("preserves the real team "+teamAction+" caller through the shared sender",async()=>{
  const r=await drive({teamAction,token:{kind:"team",contact_id:null}});
  expect(r.status).toBe(200);expect(r.body).toMatchObject({emailed:true,invitationId:invitation,tenantId:tenant});expect(r.sends).toHaveLength(1);
  expect(r.calls).toContainEqual({kind:"service",name:"send-portal-invite",args:{Authorization:"Bearer synthetic-local-only"}});
  expect(r.logs[0]).toMatchObject({metadata:{actor_user_id:actor,invite_id:invitation}});
 });
 it("refuses an unauthenticated caller at the real team entry before native preparation or delivery",async()=>{
  const r=await drive({teamAction:"create",authenticated:false,token:{kind:"team",contact_id:null}});
  expect(r.status).toBe(401);expect(r.calls).toHaveLength(0);expect(r.sends).toHaveLength(0);expect(r.logs).toHaveLength(0);
 });
 it("does not retry a provider transport outcome that is unknown",async()=>{
  const r=await drive({transportUnknown:true});expect(r.body.emailed).toBe(false);expect(r.body.reason).toBe("transport");expect(r.sends).toHaveLength(1);
 });
});
