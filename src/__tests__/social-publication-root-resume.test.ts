// @vitest-environment node
// Execute the original selected-door loop, including its native row selection,
// fingerprint validation and conservative already-used path. No model/provider.
import {readFileSync} from "node:fs";
import ts from "typescript";
import {describe,expect,it,vi} from "vitest";
import {selectDoorRow,buildResumeCall,doorResumeShape} from "../../supabase/functions/_shared/paige-turn/resume.ts";
import {confirmFingerprint} from "../../supabase/functions/_shared/confirm-fingerprint.ts";
import {socialResumeShape,SOCIAL_PROPOSAL_KEY,SOCIAL_PUBLISH_TOOL} from "../../supabase/functions/_shared/social-publish-command/chat.ts";
import {fakeDb,type Query} from "../../supabase/functions/_shared/team-hub/a2b-test-fakes.ts";
const source=readFileSync("supabase/functions/paige-ai-chat/index.ts","utf8"),ast=ts.createSourceFile("chat.ts",source,ts.ScriptTarget.Latest,true);
let block:ts.IfStatement|undefined;
function visit(n:ts.Node){if(ts.isIfStatement(n)&&n.expression.getText(ast).replace(/\s/g,"")==="doorTokens.length>0&&doorTenant&&awaitproposalScopeHolds()")block=n;ts.forEachChild(n,visit);}
visit(ast);if(!block)throw Error("Original selected-door resume loop missing");
const names=["doorTokens","doorTenant","proposalScopeHolds","supabase","CRM_COMMAND_TOOL_NAMES","SALES_INVOICE_TOOL_NAMES","SALES_COLLECTIONS_TOOL_NAMES","GROWTH_PUBLISH_DOOR_TOOL_NAMES","SOCIAL_PROPOSAL_KEY","CRM_ACTION_CAPABILITY","CRM_PREVIEW_REQUIRED_ACTIONS","PUBLISH_DOOR_CHAT_TOOLS","requestNonce","user","selectDoorRow","confirmFingerprint","doorResumeShape","socialResumeShape","SOCIAL_PUBLISH_TOOL","interactive","payloadThreadId","approvalTokenTool","resumeTokenTools","resumeTokens","offeredTools","resumeHandledDoorTools","buildResumeCall","resumePreviewValidation","resumePin","resumeDoorPin","resumeCalls"];
const run=new Function(ts.transpileModule(`return async function(ports){const {${names.join(",")}}=ports;${block.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)() as (ports:Record<string,unknown>)=>Promise<void>;
const tenant="11111111-1111-4111-8111-111111111111",content="22222222-2222-4222-8222-222222222222",actor="33333333-3333-4333-8333-333333333333";
const args={content_id:content,content_revision:"2026-11-13T12:00:00Z",platform:"threads",caption:"Stored approved caption",account_id:"44444444-4444-4444-8444-444444444444",connection_id:"55555555-5555-4555-8555-555555555555",provider_account_id:"private-account",profile_key:"private-profile",channel_label:"Original destination",channel_id:null};
async function world(changes:Record<string,unknown>={}){
  const fp=await confirmFingerprint(SOCIAL_PROPOSAL_KEY,args),queries:Query[]=[];
  const row={fingerprint:fp,tool_name:SOCIAL_PROPOSAL_KEY,args,consumed_at:null,expires_at:"2999-01-01T00:00:00Z",server_issued_at:"2026-11-13T12:01:00Z",issued_in_request:"prior-request",...changes};
  const calls:{id:string;function:{name:string;arguments:string}}[]=[],pins=new Map(),tokens=new Map(),handled=new Map();
  const ports={doorTokens:[fp],doorTenant:tenant,proposalScopeHolds:vi.fn(async()=>true),supabase:fakeDb(()=>({data:[row],error:null}),queries),CRM_COMMAND_TOOL_NAMES:new Set(),SALES_INVOICE_TOOL_NAMES:new Set(),SALES_COLLECTIONS_TOOL_NAMES:new Set(),GROWTH_PUBLISH_DOOR_TOOL_NAMES:new Set(),SOCIAL_PROPOSAL_KEY,CRM_ACTION_CAPABILITY:{},CRM_PREVIEW_REQUIRED_ACTIONS:new Set(),PUBLISH_DOOR_CHAT_TOOLS:{},requestNonce:"current-request",user:{id:actor},selectDoorRow,confirmFingerprint,doorResumeShape,socialResumeShape,SOCIAL_PUBLISH_TOOL,interactive:null,payloadThreadId:null,approvalTokenTool:new Map(),resumeTokenTools:[],resumeTokens:tokens,offeredTools:new Set([SOCIAL_PUBLISH_TOOL]),resumeHandledDoorTools:handled,buildResumeCall,resumePreviewValidation:new Map(),resumePin:new Map(),resumeDoorPin:pins,resumeCalls:calls};
  return {ports,fp,row,queries,calls,pins,tokens,handled,drive:()=>run(ports)};
}
describe("native Social proposal in original Root resume",()=>{
  it("selects the native key but invokes only the declared tool with stored exact args",async()=>{
    const w=await world();await w.drive();expect(w.calls).toHaveLength(1);expect(w.calls[0].function.name).toBe(SOCIAL_PUBLISH_TOOL);
    expect(JSON.parse(w.calls[0].function.arguments)).toEqual({content_id:content,expected_content_revision:args.content_revision,platform:"threads",caption:args.caption});
    expect(w.pins.get(w.calls[0].id)).toMatchObject({toolName:SOCIAL_PROPOSAL_KEY,fingerprint:w.fp,args});
    expect(w.queries[0].filters).toEqual(expect.arrayContaining([["eq","user_id",actor],["eq","tenant_id",tenant],["is","thread_id",null],["is","scoped_client_id",null],["neq","issued_in_request","current-request"]]));
    const names=w.queries[0].filters.find(([op,key])=>op==="in"&&key==="tool_name")?.[2] as string[];expect(names).toContain(SOCIAL_PROPOSAL_KEY);expect(names).not.toContain(SOCIAL_PUBLISH_TOOL);
  });
  it.each([{expires_at:"2000-01-01T00:00:00Z"},{expires_at:null},{expires_at:"unreadable"}])("does not invoke expired or unreadable original approval %o",async(change)=>{const w=await world(change);await w.drive();expect(w.calls).toHaveLength(0);expect(w.tokens.get(w.fp)).toMatchObject({tool:SOCIAL_PUBLISH_TOOL,state:"expired"});});
  it("a used original approval suppresses a second call and requires readback",async()=>{const w=await world({consumed_at:"2026-11-13T12:02:00Z"});await w.drive();expect(w.calls).toHaveLength(0);expect(w.tokens.get(w.fp)).toMatchObject({state:"lost"});expect(w.handled.get(SOCIAL_PUBLISH_TOOL)).toBe("elsewhere");});
  it("withholds an unoffered model tool, preserving the unspent native row",async()=>{const w=await world();w.ports.offeredTools.clear();const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});try{await w.drive();expect(w.calls).toHaveLength(0);expect(w.tokens.get(w.fp)).toMatchObject({state:"withheld"});expect(w.row.consumed_at).toBeNull();}finally{warn.mockRestore();}});
  it("refuses modified stored args, unknown shapes and changed current scope",async()=>{
    for(const changed of [{args:{...args,caption:"Mutated"}},{args:{...args,content_revision:"version-one"}}]){const w=await world(changed);await w.drive();expect(w.calls).toHaveLength(0);}
    const w=await world();w.ports.proposalScopeHolds.mockResolvedValue(false);await w.drive();expect(w.queries).toHaveLength(0);expect(w.calls).toHaveLength(0);
  });
});
