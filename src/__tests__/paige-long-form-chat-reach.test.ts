import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getSpineCapability, PAIGE_SPINE_CAPABILITIES, validateSpineRegistry } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import { classifyAction } from '../../supabase/functions/_shared/action-risk.ts';
import { LEGACY_CAPABILITIES } from '../../supabase/functions/_shared/paige-capability-status/legacy-capabilities.ts';
import { projectCapabilities, type Lane } from '../../supabase/functions/_shared/paige-capability-status/projection.ts';
import ts from 'typescript';

const chat = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const dashboard = readFileSync("src/components/dashboard/PaigeAIChat.tsx", "utf8");
const studio = readFileSync("src/solo/studio/useStudioChat.ts", "utf8");
const worker = readFileSync("supabase/functions/paige-document-worker/index.ts", "utf8");
const submission = readFileSync('supabase/migrations/20270418000000_paige_durable_document_work.sql','utf8');
const retiredRoles = readFileSync('supabase/migrations/20270504000000_retire_title_role_from_functions.sql','utf8');
const baseline = JSON.parse(readFileSync('scripts/ci/capability-declaration-baseline.json','utf8')) as Array<{tool:string}>;
const walk=(node:ts.Node,predicate:(n:ts.Node)=>boolean):ts.Node[]=>{const out:ts.Node[]=[];const visit=(n:ts.Node)=>{if(predicate(n))out.push(n);ts.forEachChild(n,visit);};visit(node);return out;};
const print=(n:ts.Node)=>ts.createPrinter({removeComments:true}).printNode(ts.EmitHint.Unspecified,n,n.getSourceFile()).replace(/\s/g,'');
function sourceBinding(text:string):boolean {
 const source=ts.createSourceFile('chat.ts',text,ts.ScriptTarget.Latest,true);
 const branches=walk(source,n=>ts.isIfStatement(n)&&print(n.expression)==='tc.function.name==="document_generate"') as ts.IfStatement[];
 const lifts=walk(source,n=>ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.name.text==='STUDIO_AUTO_TOOLS') as ts.VariableDeclaration[];
 if(branches.length!==1||lifts.length!==1||lifts[0].initializer?.getText().includes('"document_generate"'))return false;
 const body=branches[0].thenStatement;
 const studioBranches=walk(body,n=>ts.isIfStatement(n)&&print(n.expression)==='studioSessionId') as ts.IfStatement[];
 if(studioBranches.length!==1||!studioBranches[0].elseStatement||!studioBranches[0].thenStatement.getText().includes('DURABLE_DOCUMENT_STUDIO_ASYNC_UNAVAILABLE'))return false;
 const calls=walk(body,n=>ts.isCallExpression(n)) as ts.CallExpression[];
 const submits=calls.filter(n=>n.arguments.length>0&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='submit_paige_document_work');
 if(submits.length!==1||print(submits[0].expression)!=='supabaseClient.rpc'||print(submits[0].arguments[1])!=='{_intent_id:documentIntentId,_thread_id:payloadThreadId,_request_payload:validatedBrief.value,}')return false;
 if(!walk(studioBranches[0].elseStatement,n=>n===submits[0]).length||walk(studioBranches[0].thenStatement,n=>n===submits[0]).length)return false;
 return !walk(body,n=>(ts.isVariableDeclaration(n)||ts.isParameter(n))&&ts.isIdentifier(n.name)&&['supabaseClient','documentIntentId','payloadThreadId','validatedBrief'].includes(n.name.text)&&n.name.text!=='documentIntentId'&&n.name.text!=='validatedBrief').length;
}

describe("durable long-form Chat reach", () => {
  it("preserves the canonical outcome separately from the incumbent Chat submission declaration", () => {
    expect(validateSpineRegistry(PAIGE_SPINE_CAPABILITIES)).toEqual([]);
    const capability = getSpineCapability("long_form.document_authoring");
    expect(capability).toMatchObject({
      chatBinding: "LIVE",
      maturity: "PARTIAL",
      action: undefined,
      outcome: { projector: "public.record_capability_run" },
    });
  });
  it('declares the existing Chat-only document submission without changing its family or gate',()=>{
    const cap=getSpineCapability('research_knowledge.document_generate');
    expect(cap).toMatchObject({domain:'research_knowledge',readiness:'none',selfDescribe:true,chatBinding:'LIVE',mindBinding:'UNAVAILABLE',maturity:'PARTIAL',
      action:{classification:'mutate',executor:'public.submit_paige_document_work',chatTool:'document_generate',seatAuthority:'workspace-admin',riskPolicyKey:'ordinary',approvalAuthority:'chat-canonical'}});
    expect(classifyAction('document_generate')).toBe('ordinary');
    expect(cap?.action?.idempotency).toContain('wake');expect(cap?.action?.idempotency).toContain('unknown');
    expect(LEGACY_CAPABILITIES.document_generate).toBeUndefined();expect(baseline.some(r=>r.tool==='document_generate')).toBe(false);
  });
  it('proves exact caller submission args and independent Studio refusal in current source',()=>{
    expect(sourceBinding(chat)).toBe(true);
    expect(submission).toContain('_actor uuid := auth.uid()');expect(submission).toContain('t.caller_user_id = _actor');expect(submission).toContain('_tenant is distinct from public.current_user_tenant_id()');
    expect(submission).toContain("public.has_tenant_role(_actor, _tenant, 'owner')");expect(submission).toContain("public.has_tenant_role(_actor, _tenant, 'admin')");
    expect(retiredRoles).toContain("'submit_paige_document_work'");
    expect(submission).toContain('revoke all on function public.submit_paige_document_work(uuid,uuid,jsonb) from public, anon;');
    expect(submission).toContain('grant execute on function public.submit_paige_document_work(uuid,uuid,jsonb) to authenticated;');
    expect(chat).toContain('"content_save", "document_generate", "generate_image"');
  });
  it.each([
    (s:string)=>s.replaceAll('_intent_id: documentIntentId','_intent_id: args.intent_id'),
    (s:string)=>s.replaceAll('_thread_id: payloadThreadId','_thread_id: args.thread_id'),
    (s:string)=>s.replaceAll('_request_payload: validatedBrief.value','_request_payload: args'),
    (s:string)=>s.replaceAll('supabaseClient.rpc(\n                      "submit_paige_document_work"','supabase.rpc(\n                      "submit_paige_document_work"'),
    (s:string)=>s.replaceAll('"generate_image", "content_save",\n            "growth_page_save"','"generate_image", "content_save", "document_generate",\n            "growth_page_save"'),
    (s:string)=>s.replaceAll('if (studioSessionId) {\n                await recordDocumentSubmissionOutcome','if (false) {\n                await recordDocumentSubmissionOutcome'),
  ])('rejects source mutation of caller/args/Studio authority',mutate=>{const changed=mutate(chat);expect(changed).not.toBe(chat);expect(sourceBinding(changed)).toBe(false);});
  it('preserves incumbent discovery for member/admin and confirm/auto/off',()=>{
    const cap=getSpineCapability('research_knowledge.document_generate')!;
    for(const admin of [false,true])for(const lane of ['confirm','auto','off'] as Lane[]){
      const input={tools:[{name:'document_generate',description:'Existing document generation.'}],isMutating:()=>true,lanes:new Map([['document_generate',lane]]),workspaceAdminTools:new Set(['document_generate']),isWorkspaceAdmin:admin,readiness:new Map()};
      const before=projectCapabilities({...input,spine:[],legacy:{document_generate:{domain:'research_knowledge',effect:'mutate',selfDescribe:true,readiness:'none'}}});
      const after=projectCapabilities({...input,spine:[cap],legacy:{}});
      const facts=(r:typeof before)=>r.map(({key,source,...rest})=>rest);
      expect(facts(after)).toEqual(facts(before));
    }
  });

  it("submits a bounded brief to the canonical durable RPC instead of model-authored blocks", () => {
    const tool = chat.slice(chat.indexOf('name: "document_generate"'), chat.indexOf('name: "growth_list"'));
    const handlerStart = chat.indexOf('} else if (tc.function.name === "document_generate") {');
    const handler = chat.slice(handlerStart, chat.indexOf('} else if (tc.function.name === "growth_list") {', handlerStart));
    expect(tool).toContain('required: ["doc_type", "title", "brief"]');
    expect(tool).not.toContain('required: ["doc_type", "title", "blocks"]');
    expect(tool).not.toContain("source_refs");
    expect(handler).toContain('"submit_paige_document_work"');
    expect(handler).toContain("validateDocumentBrief(candidate)");
    expect(handler).toContain("if (targetVerified)");
    expect(handler).not.toContain("if (!result)");
    expect(handler).not.toContain('rpc("save_marketing_content"');
    expect(handler).toContain('recordDocumentSubmissionOutcome("DURABLE_DOCUMENT_IDENTITY_REQUIRED"');
    expect(handler).toContain('recordDocumentSubmissionOutcome("DURABLE_DOCUMENT_TARGET_NOT_VERIFIED"');
    expect(handler).toContain('"DURABLE_DOCUMENT_SUBMIT_FAILED"');
    expect(handler).toContain('recordDocumentSubmissionOutcome("DURABLE_DOCUMENT_WORK_ID_MISSING"');
    expect(handler).toContain("recordDocumentSubmissionOutcome(validatedBrief.code");
    expect(handler).toContain("classifyDocumentSubmissionError(submitError)");
    expect(handler).toContain("recordCapabilityRun(supabase");
    expect(handler).toContain('if (workStatus === "claimed")');
    expect(handler).toContain('} else if (workStatus === "succeeded")');
    expect(handler).toContain('"DURABLE_DOCUMENT_RECONCILIATION_REQUIRED"');
    expect(handler).toContain('"DURABLE_DOCUMENT_BLOCKED"');
    expect(handler).toContain('"DURABLE_DOCUMENT_STUDIO_ASYNC_UNAVAILABLE"');
    expect(handler).toContain("cannot resume");
    expect(handler).toContain("start a new document request");
    expect(handler).not.toContain("args.source_refs");
  });

  it("never files a failure receipt when durable settlement did not commit", () => {
    const settle = worker.slice(worker.indexOf("async function settleFailure"), worker.indexOf("async function runOne"));
    expect(settle).toContain('admin.rpc("settle_paige_document_work_failure"');
    expect(settle).not.toContain("recordCapabilityRun");
    expect(settle).toContain('if (error) {');
  });

  it("derives a retry-stable intent for each document call in a turn", () => {
    expect(chat).toContain("requestIntentId: z.string().uuid().optional()");
    expect(chat).toContain('stableRunId(["document_generate_intent", payloadRequestIntentId, String(currentDocumentCallOrdinal)])');
    expect(chat).toContain("_intent_id: documentIntentId");
    expect(dashboard).toContain("retry.requestIntentId");
    expect(studio).toContain("failedIntent.current.id");
  });

  it("keeps ordinary documents visibly non-signable", () => {
    const tool = chat.slice(chat.indexOf('name: "document_generate"'), chat.indexOf('name: "growth_list"'));
    expect(tool).toContain("never request signature lines");
    expect(tool).toContain("If the document is meant to be signed, use agreement_draft");
    expect(tool).not.toContain("worksheet-field signature lines");
  });
});
