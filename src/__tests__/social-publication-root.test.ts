// @vitest-environment node
// Execute the actual original Chat dispatch arm; ports stand in for network/native services.
import {readFileSync} from "node:fs";
import ts from "typescript";
import {describe,expect,it,vi} from "vitest";
import {SOCIAL_PUBLISH_TOOL,SOCIAL_READ_TOOL,SOCIAL_CHECK_TOOL} from "../../supabase/functions/_shared/social-publish-command/chat.ts";
import {readSocialPublicationReference} from "../../supabase/functions/_shared/social-publish-command/reference.ts";
const source=readFileSync("supabase/functions/paige-ai-chat/index.ts","utf8");
const ast=ts.createSourceFile("chat.ts",source,ts.ScriptTarget.Latest,true);
let body:ts.Statement|undefined;
function visit(n:ts.Node){if(ts.isIfStatement(n)&&n.expression.getText(ast).replace(/\s/g,"")==='tc.function.name==="social_post_publish"||tc.function.name==="read_social_publication"||tc.function.name==="check_social_publication"')body=n.thenStatement;ts.forEachChild(n,visit);}
visit(ast);if(!body)throw Error("Original Social dispatch arm missing");
const names=["cancellationsRecorded","revalidateProposalScope","callerTier","calendarBookingAccountShape","scopedClientId","customerPortal","workspaceAuthorityNow","readCalendarAccountShape","req","turnScopeTenantId",
  "toolResults","createClient","supabaseUrl","supabaseServiceKey","dispatchSocialChat","personaCtx","user","doorPin","approvedConfirmations","approvalTokenTool","approvalRefusals","withoutTeamHubCardTokens","supabaseClient","authHeader","TEAM_HUB_CARD_ALREADY_WAITING","readSocialPublicationReference","socialPublicationSource","SOCIAL_PUBLISH_TOOL","SOCIAL_READ_TOOL","SOCIAL_CHECK_TOOL","recordCapabilityRun","supabase","stableRunId","requestNonce","settlePinnedDoorResult","approvalSpend"];
const code=ts.transpileModule(`return async function(ports,toolCalls){const {${names.join(",")}}=ports;for(const tc of toolCalls)${body.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const run=new Function(code)() as (ports:Record<string,unknown>,calls:unknown[])=>Promise<void>;
const tenant="11111111-1111-4111-8111-111111111111",content="22222222-2222-4222-8222-222222222222";
const reference={schema:1,tenant_id:tenant,content_id:content,content_revision:"2026-11-13T12:00:00Z",publication_id:null};
function world(){
  const caller={functions:{invoke:vi.fn(async()=>({data:null,error:null}))}},service={from:vi.fn(()=>({select:()=>({})}))};
  const toolResults:{content:string}[]=[],refs=new Map<object,unknown[]>(),dispatch=vi.fn(async(_context:Record<string,unknown>,_deps:Record<string,unknown>):Promise<{content:Record<string,unknown>}>=>({content:{success:true,social_reference:reference}}));
  const ports:Record<string,unknown>={cancellationsRecorded:true,revalidateProposalScope:vi.fn(async()=>true),callerTier:"tenant",calendarBookingAccountShape:"solo",scopedClientId:null,customerPortal:false,
    workspaceAuthorityNow:vi.fn(async()=>({seat:true,workspaceAdmin:true})),readCalendarAccountShape:vi.fn(async()=>({status:"available",accountShape:"solo"})),req:{signal:new AbortController().signal},turnScopeTenantId:tenant,
    toolResults,createClient:()=>service,supabaseUrl:"https://unit-test.invalid",supabaseServiceKey:"test-service",dispatchSocialChat:dispatch,personaCtx:{tenant_id:tenant},user:{id:"actor"},doorPin:null,
    approvedConfirmations:new Set(),approvalTokenTool:new Map(),approvalRefusals:new Map(),withoutTeamHubCardTokens:vi.fn(async()=>({failed:false,bound:[]})),supabaseClient:caller,authHeader:"Bearer caller-jwt",
    TEAM_HUB_CARD_ALREADY_WAITING:{success:false,error:"private_original_card_waiting"},readSocialPublicationReference,socialPublicationSource:refs,SOCIAL_PUBLISH_TOOL,SOCIAL_READ_TOOL,SOCIAL_CHECK_TOOL,
    recordCapabilityRun:vi.fn(async()=>true),supabase:service,stableRunId:vi.fn(async()=>"stable-original-call"),requestNonce:"original-request",settlePinnedDoorResult:vi.fn(async(_tc,_pin,_spent,result)=>result),approvalSpend:new Map()};
  const call={id:"social-call",function:{name:SOCIAL_READ_TOOL,arguments:JSON.stringify({content_id:content})}};
  return {ports,dispatch,caller,service,toolResults,refs,call,drive:()=>run(ports,[call])};
}
describe("original Root Social adapter",()=>{
  it("passes only the current caller JWT to the one original door",async()=>{
    const w=world();await w.drive();const deps=w.dispatch.mock.calls[0][1] as {invoke:(body:unknown)=>Promise<unknown>};
    await deps.invoke({action:"inspect"});expect(w.caller.functions.invoke).toHaveBeenCalledWith("social-publish-command",{headers:{Authorization:"Bearer caller-jwt"},body:{action:"inspect"}});
    expect(w.refs.get(w.call)).toEqual([reference]);expect(w.ports.recordCapabilityRun).toHaveBeenCalledWith(w.service,expect.objectContaining({capabilityKey:"social.publication_read",outcome:"capability_succeeded"}));
  });
  it.each([{callerTier:"platform_operator"},{calendarBookingAccountShape:null},{scopedClientId:"focused-client"},{customerPortal:true},
    {workspaceAuthorityNow:async()=>({seat:false,workspaceAdmin:true})},{workspaceAuthorityNow:async()=>({seat:true,workspaceAdmin:false})},
    {readCalendarAccountShape:async()=>({status:"unavailable"})}])("refuses an ineligible or freshly revoked Social scope before dispatch: %o",async(change)=>{
    const w=world();Object.assign(w.ports,change);await w.drive();expect(w.dispatch).not.toHaveBeenCalled();expect(w.refs.size).toBe(0);expect(w.ports.recordCapabilityRun).not.toHaveBeenCalled();
  });
  it("keeps a private Hub-bound proposal on its original card",async()=>{
    const w=world();w.call.function.name=SOCIAL_PUBLISH_TOOL;w.dispatch.mockResolvedValue({content:{success:false,needs_confirm:true,confirm_fingerprint:"0123456789abcdef",social_reference:reference}});
    w.ports.withoutTeamHubCardTokens=vi.fn(async()=>({failed:false,bound:["0123456789abcdef"]}));await w.drive();
    expect(JSON.parse(w.toolResults[0].content)).toEqual(w.ports.TEAM_HUB_CARD_ALREADY_WAITING);expect(w.refs.size).toBe(0);
  });
  it("does not persist foreign or over-specified references from the result",async()=>{
    const w=world();w.dispatch.mockResolvedValue({content:{success:true,social_reference:{...reference,post_url:"https://foreign.invalid"}}});await w.drive();expect(w.refs.size).toBe(0);expect(w.ports.recordCapabilityRun).not.toHaveBeenCalled();
  });
  it("preserves the original pinned args and delegates settlement without claiming again",async()=>{
    const w=world(),pin={fingerprint:"0123456789abcdef",toolName:"social.post_publish",args:{content_id:content,caption:"Stored exact caption"}};
    w.ports.doorPin=pin;w.call.function.name=SOCIAL_PUBLISH_TOOL;await w.drive();
    expect(w.dispatch).toHaveBeenCalledWith(expect.objectContaining({pinned:{fingerprint:pin.fingerprint,args:pin.args},sameToolCalls:1}),expect.anything());
    expect(w.ports.settlePinnedDoorResult).toHaveBeenCalledTimes(1);
  });
});
