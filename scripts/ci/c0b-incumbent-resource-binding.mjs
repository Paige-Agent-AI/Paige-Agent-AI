// Restrictive reviewed source contracts. These are build-time AST fingerprints,
// not runtime permission, provider availability or authenticated execution proof.
// A changed branch/helper/endpoint requires renewed source review; CI has no
// snapshot regeneration or auto-accept path.
import ts from 'typescript';
import { createHash } from 'node:crypto';
const printer=ts.createPrinter({removeComments:true});
const walk=(node,test)=>{const found=[];const visit=n=>{if(test(n))found.push(n);ts.forEachChild(n,visit);};visit(node);return found;};
const canonical=n=>n?printer.printNode(ts.EmitHint.Unspecified,n,n.getSourceFile()):'';
const text=n=>n?printer.printNode(ts.EmitHint.Unspecified,n,n.getSourceFile()).replace(/\s+/g,''):'';
const hash=value=>createHash('sha256').update(value).digest('hex');
const name=n=>n&&ts.isIdentifier(n)?n.text:'';
const nearestFunction=n=>{for(let p=n?.parent;p;p=p.parent)if(ts.isFunctionLike(p))return p;};
const dispatcher=n=>{for(let p=n?.parent;p;p=p.parent)if(ts.isArrowFunction(p)&&ts.isVariableDeclaration(p.parent)&&name(p.parent.name)==='executeToolCalls')return p;};
const selected=(expression,tool)=>walk(expression,ts.isBinaryExpression).some(n=>text(n.left)==='tc.function.name'&&n.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken&&ts.isStringLiteral(n.right)&&n.right.text===tool);
let cachedText,cachedIndex;
function sourceIndex(raw){
 if(raw===cachedText)return cachedIndex;
 const source=ts.createSourceFile('chat.ts',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),all=walk(source,()=>true);
 cachedText=raw;cachedIndex={source,variables:all.filter(ts.isVariableDeclaration),ifs:all.filter(ts.isIfStatement),imports:all.filter(ts.isImportDeclaration),
  functions:all.filter(n=>ts.isFunctionDeclaration(n)||(ts.isVariableDeclaration(n)&&n.initializer&&(ts.isArrowFunction(n.initializer)||ts.isFunctionExpression(n.initializer)))),
  declarations:all.filter(n=>ts.isVariableDeclaration(n)||ts.isParameter(n)||ts.isFunctionDeclaration(n)),
  assignments:all.filter(n=>ts.isBinaryExpression(n)&&n.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&n.operatorToken.kind<=ts.SyntaxKind.LastAssignment)};return cachedIndex;
}
export function inspectIncumbentSource(chatText,tool) {
 const {source,variables,ifs,imports:importDeclarations,functions:localFunctions,declarations:allDeclarations,assignments}=sourceIndex(chatText);
 if(source.parseDiagnostics.length)throw Error('Chat source must parse');
 const candidates=ifs.filter(n=>selected(n.expression,tool)&&dispatcher(n));
 // A nested UI/price/refusal condition is not the executor. The outer exact
 // selector with the complete incumbent body is the reviewed dispatch branch.
 candidates.sort((a,b)=>b.thenStatement.getWidth(source)-a.thenStatement.getWidth(source));
 const branch=candidates[0];if(!branch)throw Error(`missing dispatch ${tool}`);
 const fn=dispatcher(branch);const identity=[];
 for(const variable of ['authHeader','supabaseUrl','supabaseKey','supabaseServiceKey','supabaseClient','supabase']) {
  const declarations=variables.filter(n=>name(n.name)===variable&&!dispatcher(n));
  if(declarations.length!==1)throw Error(`ambiguous lexical ${variable}`);
  identity.push(canonical(declarations[0]));
 }
 const client=variables.find(n=>name(n.name)==='supabaseClient');
 const outer=nearestFunction(client);
 if(!outer?.body||!ts.isBlock(outer.body))throw Error('canonical request handler absent');
 const service=variables.find(n=>name(n.name)==='supabase');
 const authEnd=outer.body.statements.findIndex(statement=>service.pos>=statement.pos&&service.end<=statement.end);
 if(authEnd<0)throw Error('canonical authentication prefix absent');
 identity.push(...outer.body.statements.slice(0,authEnd+1).map(canonical));
 const protectedNames=new Set(['supabaseClient','supabase','authHeader','supabaseServiceKey','user','personaCtx','scopedClientId','authorizedClientId']);
 assignments.filter(n=>walk(n.left,ts.isIdentifier).some(id=>protectedNames.has(id.text))).forEach(n=>identity.push(canonical(n)));
 const verified=variables.filter(n=>nearestFunction(n)===outer&&text(n.initializer)==='awaitsupabaseClient.auth.getUser()');
 if(verified.length!==1||!text(verified[0].name).includes('user'))throw Error('verified actor binding missing');
 identity.push(canonical(verified[0]));
 const authRefusal=ifs.find(n=>nearestFunction(n)===outer&&text(n.expression)==='authError||!user');
 if(!authRefusal)throw Error('verified actor refusal missing');identity.push(canonical(authRefusal));
 const factory=importDeclarations.filter(n=>ts.isStringLiteral(n.moduleSpecifier)&&n.moduleSpecifier.text==='https://esm.sh/@supabase/supabase-js@2.75.0');
 if(factory.length!==1)throw Error('canonical client factory import missing');identity.push(canonical(factory[0]));
 if(allDeclarations.some(n=>name(n.name)==='createClient'))throw Error('client factory shadowed');
 const auth=variables.find(n=>name(n.name)==='authHeader');
 if(!ts.isCallExpression(auth.initializer)||text(auth.initializer.expression)!=='req.headers.get'||auth.initializer.arguments.length!==1||!ts.isStringLiteral(auth.initializer.arguments[0])||auth.initializer.arguments[0].text!=='Authorization')throw Error('request JWT source changed');
 // Server-resolved workspace and focused subject provenance must not be
 // replaced by model arguments while leaving the dispatch body unchanged.
 for(const id of ['personaCtx','scopedClientId','scopedClientRef','clientScopeDenied','authorizedClientId','authorizedClientRef','clientScopeRefusal'])
  variables.filter(n=>name(n.name)===id).forEach(n=>identity.push(canonical(n)));
 const personaRead=variables.find(n=>text(n.initializer)==='awaitsupabaseClient.rpc("get_paige_persona_context")');
 if(!personaRead)throw Error('server persona read absent');
 for(let p=personaRead.parent;p;p=p.parent)if(ts.isTryStatement(p)){identity.push(canonical(p));break;}
 const clientAdmission=ifs.filter(n=>text(n.expression)==='payloadClientId'&&nearestFunction(n)===outer);
 if(clientAdmission.length!==1)throw Error('canonical focused client admission absent');identity.push(canonical(clientAdmission[0]));
 // Pin all controls dominating this branch, including role-block prelude and
 // the original per-call policy/confirmation/boundary guards before dispatch.
 const controls=[];
 for(let child=branch,parent=branch.parent;parent&&parent!==fn;child=parent,parent=parent.parent){
  if(ts.isIfStatement(parent))controls.push(canonical(parent.expression));
  if(ts.isBlock(parent))for(const statement of parent.statements){if(statement===child)break;if(!ts.isIfStatement(statement)||!walk(statement.expression,n=>ts.isPropertyAccessExpression(n)&&text(n)==='tc.function.name').length)controls.push(canonical(statement));}
 }
 const roots=[branch.thenStatement,...walk(fn.body,ts.isVariableDeclaration).filter(n=>name(n.name)==='allowed')];
 const helpers=[];const seen=new Set();const imports=new Set();
 const visit=root=>{
  for(const identifier of walk(root,ts.isIdentifier)){
   const id=identifier.text;if(seen.has(id)||id==='executeToolCalls')continue;seen.add(id);
   for(const declaration of localFunctions.filter(n=>name(n.name)===id)){helpers.push(canonical(declaration));visit(declaration);}
   for(const declaration of importDeclarations){
    const bindings=declaration.importClause?.namedBindings;
    if(bindings&&ts.isNamedImports(bindings)&&bindings.elements.some(e=>name(e.name)===id)&&ts.isStringLiteral(declaration.moduleSpecifier)&&declaration.moduleSpecifier.text.startsWith('.'))imports.add(declaration.moduleSpecifier.text);
   }
  }
 };
 roots.forEach(visit);
 return {fingerprint:hash([...candidates.map(n=>canonical(n.expression)+canonical(n.thenStatement)),...controls,...identity,...helpers.sort()].join('\n')),imports:[...imports].sort()};
}
// Explicit frozen metadata + reviewed source digests are filled only by the
// initial source review, never computed from the capability being validated.
// ANT-21 bounded renewal (2026-10-16): non-author candidate review traced the
// Task timestamps/status read reviewed at a294aa4e; unchanged full-handler ancestry
// captures this bounded read-only correction beside the prior CRM scope pin.
// Only reviewed digest scalars change. Extractor, metadata and refusal mutants stay.
// The subsequent CRM outcome composition was separately reviewed at 178e7adb,
// 64d9310b, 665ff5ed, 8688aee5 and c1b2759c. Its whole-handler ancestry changes
// renew only the 29 dispatch scalars; every dependency and metadata pin remains.
// E09 bounded review (2026-10-17), immutable product989a83ae7150e758ede981540046bc178a5f33f5.
// The customer-only context/terminal change alters captured whole-handler ancestry.
// All29 exact dispatch branches, controls, local helpers and other identity inputs
// remain equal. Freeze the separately reviewed digest literals; no auto acceptance.
// Source evidence: docs/evidence/customer-knowledge-consumer-2026-10-17/source-lease-proposal.json.
// E09 UUID-format correction separately reviewed at c7cc4f38adea6f705525a4c6f2ae0b0d2a05bd08.
// Same native UUID identities, canonical input and receipt spelling; no permission change.
// Existing dispatcher/control/helper/authority components and verifier logic remain unchanged.
// E09 attribution review of immutable 936de0b7651886565176ab83c69823063db79c75:
// removing exactly the two new invitation-attribution lines restores current main
// byte-for-byte. Only comms_setup_calling captures that shared attribution helper.
// Its one literal is renewed after source review; all other28, dependency pins,
// extraction/authority logic and refusal mutants remain unchanged.
const CONTRACTS = {
  "comms_setup_calling": {
    "key": "communications.comms_setup_calling",
    "chatTool": "comms_setup_calling",
    "executor": "edge.paige-ai-chat",
    "classification": "external_effect",
    "riskPolicyKey": "high",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "fc05eb5cb8c49caf26d0c73b49e1c9f3a27a6fb5c579c4f805ac0a43e2022396"
  },
  "calendar_book_meeting": {
    "key": "calendar.book_meeting",
    "chatTool": "calendar_book_meeting",
    "executor": "public.create_internal_booking",
    "classification": "mutate",
    "riskPolicyKey": "high",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "aa21e32dfd8e385f16743229e89c4621c660b6f1f07964d588722d0c5841f558"
  },
  "calendar_link_send": {
    "key": "calendar.link_send",
    "chatTool": "calendar_link_send",
    "executor": "edge.paige-ai-chat",
    "classification": "external_effect",
    "riskPolicyKey": "high",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "member",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "30f08313cb7b88ba2404e31819da6b9287903d9ffecab2f467dea66b1ac562ec"
  },
  "propose_business_brief_update": {
    "key": "business_profile.propose_brief_update",
    "chatTool": "propose_business_brief_update",
    "executor": "public.stage_solo_business_brief_proposal",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "5424434d8224ff33dff7b535862958b0d8cf61cda54ee418665e77aec1f8f24f"
  },
  "update_business_profile": {
    "key": "business_profile.update_legacy",
    "chatTool": "update_business_profile",
    "executor": "edge.paige-ai-chat",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": false,
    "readiness": "none",
    "fingerprint": "a03f5aa86494a2d38aa2573869c422ef70a6084924608d8b043c2b95764f3b72"
  },
  "capability_status": {
    "key": "platform_meta.capability_status",
    "chatTool": "capability_status",
    "executor": "edge.paige-ai-chat",
    "classification": "read",
    "riskPolicyKey": "read_only",
    "approvalAuthority": "none",
    "seatAuthority": "member",
    "selfDescribe": false,
    "readiness": "none",
    "fingerprint": "c6a006f9b328b11bbbf011bc13ef81d92a5efb1f1f0e68340c354d93c773da79"
  },
  "improvement_propose": {
    "key": "platform_meta.improvement_propose",
    "chatTool": "improvement_propose",
    "executor": "edge.paige-ai-chat",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": false,
    "readiness": "none",
    "fingerprint": "e63d5c12e149413372c2e0f6eb4ab6c0828b6bb8e51009fbe1c6fe5925386e25"
  },
  "improvement_decide": {
    "key": "platform_meta.improvement_decide",
    "chatTool": "improvement_decide",
    "executor": "edge.paige-ai-chat",
    "classification": "mutate",
    "riskPolicyKey": "high",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": false,
    "readiness": "none",
    "fingerprint": "0a3a36c39d18fbf25a501422157d8f9de0d6f9bb9d4dbd4713cb4d015d1d47b8"
  },
  "list_subagents": {
    "key": "agents.list",
    "chatTool": "list_subagents",
    "executor": "edge.paige-orchestrator",
    "classification": "read",
    "riskPolicyKey": "read_only",
    "approvalAuthority": "none",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "b4929ea58761b6de695b464742f1d99c2e89d77f57f8dbb2868a5dead4c77059"
  },
  "delegate_to_subagent": {
    "key": "agents.delegate",
    "chatTool": "delegate_to_subagent",
    "executor": "edge.paige-orchestrator",
    "classification": "external_effect",
    "riskPolicyKey": "high",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "b4929ea58761b6de695b464742f1d99c2e89d77f57f8dbb2868a5dead4c77059"
  },
  "forge_subagent": {
    "key": "agents.forge",
    "chatTool": "forge_subagent",
    "executor": "edge.subagent-forge",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "ff2f9cf768c862aeda6dac5e21d55776f985aac90899314482e28ee5a050f314"
  },
  "author_event_kind": {
    "key": "crm_clients.author_event_kind",
    "chatTool": "author_event_kind",
    "executor": "public.upsert_tenant_event_kind",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "member",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "f588fb6fb928fbec9ee81696a52c45e502b72d2b383d4e276acda7fd81790dd4"
  },
  "crm_add_note": {
    "key": "crm_clients.add_note",
    "chatTool": "crm_add_note",
    "executor": "edge.paige-ai-chat",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "e7a19430f24f39fdd864fc1c58e5cbd36260948191c73779a951718ce03c309b"
  },
  "crm_file_document": {
    "key": "crm_clients.file_document",
    "chatTool": "crm_file_document",
    "executor": "edge.paige-ai-chat",
    "classification": "mutate",
    "riskPolicyKey": "high",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "d8cc97b6706ae6e78c5e18cf8ed76d0cec1362fb2172f9d5f143aa74970d5d51"
  },
  "update_client_data": {
    "key": "crm_clients.update_client_data",
    "chatTool": "update_client_data",
    "executor": "edge.paige-write-back",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "member",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "e2d218289b268429bed960ce14c0a7f6deb82de8a4e3e5727a1f94eb82c6d8bb"
  },
  "pipeline_configure": {
    "key": "sales.pipeline_configure",
    "chatTool": "pipeline_configure",
    "executor": "public.configure_tenant_pipeline_as_paige",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "b2c03311762055de9198b56a4553f889293754ebd5cc7ee77772f3097f91bdac"
  },
  "deep_research": {
    "key": "research_knowledge.deep_research",
    "chatTool": "deep_research",
    "executor": "edge.paige-ai-chat",
    "classification": "read",
    "riskPolicyKey": "read_only",
    "approvalAuthority": "none",
    "seatAuthority": "member",
    "selfDescribe": true,
    "readiness": "research_provider",
    "fingerprint": "94ede00f47005cee9803af9da9cbec901a2ee1a1898fc9cda0892bd0f88b4cdb"
  },
  "web_search": {
    "key": "research_knowledge.web_search",
    "chatTool": "web_search",
    "executor": "edge.paige-ai-chat",
    "classification": "read",
    "riskPolicyKey": "read_only",
    "approvalAuthority": "none",
    "seatAuthority": "member",
    "selfDescribe": true,
    "readiness": "research_provider",
    "fingerprint": "756b8c832e3370073809f6b133da6fe0bfd6141327c6cc5e7aa8b5a7d52fe80d"
  },
  "web_fetch": {
    "key": "research_knowledge.web_fetch",
    "chatTool": "web_fetch",
    "executor": "edge.paige-ai-chat",
    "classification": "read",
    "riskPolicyKey": "read_only",
    "approvalAuthority": "none",
    "seatAuthority": "member",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "47760a70de6995c5476389dd003b59e4999821d43490f283aa6baab8599058e4"
  },
  "save_to_knowledge_base": {
    "key": "research_knowledge.save_to_knowledge_base",
    "chatTool": "save_to_knowledge_base",
    "executor": "edge.paige-ai-chat",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "member",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "0f4b80a74e569da38b0d7df7e35e99498e297adca495979e2a6d385cbe69681f"
  },
  "automation_draft": {
    "key": "automations.automation_draft",
    "chatTool": "automation_draft",
    "executor": "edge.paige-ai-chat",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "member",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "f4a85075b98ce6f4154c6e5b58555bd62b57df2d9ecd6810ce18f8ef3e1a9b96"
  },
  "comms_connection_summary": {
    "key": "communications.comms_connection_summary",
    "chatTool": "comms_connection_summary",
    "executor": "public.tenant_comms_readiness",
    "classification": "read",
    "riskPolicyKey": "read_only",
    "approvalAuthority": "none",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "f392c1a636319b51c27c810fe962c3ab4202a8e1ece37fb7e5d679892787ca29"
  },
  "comms_registration_status": {
    "key": "communications.comms_registration_status",
    "chatTool": "comms_registration_status",
    "executor": "public.tenant_comms_readiness",
    "classification": "read",
    "riskPolicyKey": "read_only",
    "approvalAuthority": "none",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "ebc39f9a2182fa17e7c9b960e4a19bb095a3332f3083d43c174665d82312e4e1"
  },
  "comms_list_numbers": {
    "key": "communications.comms_list_numbers",
    "chatTool": "comms_list_numbers",
    "executor": "edge.paige-ai-chat",
    "classification": "read",
    "riskPolicyKey": "read_only",
    "approvalAuthority": "none",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "c2f346ca7a395d856a61ddfaaee5acc6ca6004a452b6e6c07537c93d24f3d3df"
  },
  "comms_search_numbers": {
    "key": "communications.comms_search_numbers",
    "chatTool": "comms_search_numbers",
    "executor": "edge.paige-ai-chat",
    "classification": "read",
    "riskPolicyKey": "read_only",
    "approvalAuthority": "none",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "a78a0981c8a77296a5c4d20c609d4f9a0b61b13314c094ba80dd53b8565320de"
  },
  "comms_buy_number": {
    "key": "communications.comms_buy_number",
    "chatTool": "comms_buy_number",
    "executor": "edge.paige-ai-chat",
    "classification": "external_effect",
    "riskPolicyKey": "high",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "826109825cecde76715fa4039d5d724cf076011021528184f074dc98594dbd98"
  },
  "comms_draft_registration": {
    "key": "communications.comms_draft_registration",
    "chatTool": "comms_draft_registration",
    "executor": "edge.paige-ai-chat",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "724ca57115bd8f3ca99724f010f889f16dd26ff8fbb6911d25b77772b822b8af"
  },
  "comms_name_number": {
    "key": "communications.comms_name_number",
    "chatTool": "comms_name_number",
    "executor": "public.tenant_phone_number_rename",
    "classification": "mutate",
    "riskPolicyKey": "ordinary",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": false,
    "readiness": "none",
    "fingerprint": "b9c4b692d76d47b7935bcfa59fc53a23e759f1861ed6f615f6731b74d99e5b39"
  },
  "comms_set_primary_number": {
    "key": "communications.comms_set_primary_number",
    "chatTool": "comms_set_primary_number",
    "executor": "public.tenant_phone_number_set_primary",
    "classification": "mutate",
    "riskPolicyKey": "high",
    "approvalAuthority": "chat-canonical",
    "seatAuthority": "workspace-admin",
    "selfDescribe": true,
    "readiness": "none",
    "fingerprint": "8e71223ecb79802aa74b089cda5908f336dd18bfd38885b78e90452cbdf0f72c"
  }
};
const SOURCES = {
  "supabase/functions/_shared/workspace-authority.ts": "b5fb2d35bf32fd4280f9e7e2c53488e6a0d4248cdbd42a5beb67ea91d18d5fc1",
  "supabase/functions/_shared/calendar-link-tenant-brain.ts": "28748e315a12caa855ec906192743cdad5298d37ccbd35ad83539949124800f4",
  "supabase/functions/_shared/client-seat-reply.ts": "6b2ed9c2342da886f8dff44a46bc9dadd4bcd3b079839f62b470ea363564b44d",
  "supabase/functions/_shared/outbound-draft-check.ts": "eda79597ac86a489f916075844f535fcf228518d953b48c55b2e9901920ee961",
  // E09: reviewed single new high-risk invitation key; every incumbent policy byte
  // remain exact main. The shared handler only gains invitation attribution.
  // No CONTRACTS/ancestry renewal.
  "supabase/functions/_shared/action-risk.ts": "110bcb6fd9ffb7364cedec7f063a484b8881ccc3f7e636de4e65f2732768d9cf",
  "supabase/functions/_shared/finance-gate.ts": "dfa7fbec065d346ca72199313294a4418aa8be66f3dbb68cfe991a93aef0cf40",
  "supabase/functions/_shared/paige-capability-status/projection.ts": "280c36a53ed5d553f6e6467f7177d049a2c612078cdb8d8139878cec3463922f",
  "supabase/functions/_shared/paige-capability-status/readiness.ts": "56b0a8da8b1a76414a147d15bffb9b589b9bcf9e130c797290b846759e1da65e",
  "supabase/functions/_shared/paige-capability-status/render.ts": "63a15351e4f7af98544082c421c35af5d9eba2002d54150b2756b255bd131c58",
  "supabase/functions/_shared/checked-write.ts": "455d00e06fc6e84479ff8d0d5782288d21e4570d63d8e2e0acf770a5a8d5e95c",
  "supabase/functions/_shared/untrusted-fence.ts": "fc0ed34f9c564e4669b187a106756e860383ede74ae2bbb60f4b0a3944c7bf12",
  "supabase/functions/paige-deep-research/index.ts": "a1a3f295974ddcaf0b0e422286419653a88f4f5100e31a2f482bc2c4bfad24bc",
  "supabase/functions/paige-web-search/index.ts": "2606664401bb71708fe798afab7f1166648083131d1ccfa06f9123d1629b0dd2",
  "supabase/functions/_shared/research-source-policy.ts": "df0ca1d9f4ee256051ff51927500b25b5fd071a057a6d868c6448f6f852e144b",
  "supabase/functions/fetch-url-content/index.ts": "4e10fe5cd2e189ced5c0cf929586626297b7c9653b34f8a109eede4b88d2926b",
  "supabase/functions/kb-ingest-doc/index.ts": "09c54913f8c844a0e7bb2826947cb002496fb800c34d2e46ae0f6a3f5a0ea7a7",
  "supabase/functions/comms-search-numbers/index.ts": "828ac020a9c984a808e3c9375748f1762a8667bd5a9da1c81d1fac902782d4f8",
  "supabase/functions/comms-purchase-number/index.ts": "23f479730d2b658fe231dcbe33e3fcd864ec07e9f87ce116742f83e84c8e9237",
  "supabase/functions/comms-a2p-draft/index.ts": "49bd8acc5ed4ec7d60ba79b917438ae5eba0ce2ffcbf862baa9caa56293ada29",
  "supabase/functions/paige-write-back/index.ts": "5ff11463820b7c38e69f683cbcd8542359d5a72c37724c06846bf3dcc6d41de8",
  "supabase/functions/paige-orchestrator/index.ts": "84e1bb410fb5e01242d4a34401ece2c4dbad515be51e3e4cbe337420e5245243",
  "supabase/functions/subagent-forge/index.ts": "1acb5488f11bd93a2d6b36638fddcd73323f4363eacbd58b284d1fa648b3d906",
  "supabase/functions/send-message/index.ts": "512d6f070b435a52385eb28ff3e58861ac0c138e220473bf657335484a08bf76",
  "supabase/functions/_shared/paige-spine/contracts.ts": "2d771686d636c04d2e07d9b8c336e19cde246b9a303ddd034d7ae8500f7eefb4",
  // Operator retirement adds opt-in timeout/no-retry controls; ordinary callers retain
  // their existing behavior. Renewed non-author review and actual retry controls are
  // recorded on PR #1897; no other incumbent snapshot is regenerated or accepted.
  "supabase/functions/_shared/twilio.ts": "afe6b57d9ed91c00e6517856f7b17c36f147fee5b88afb3450586c4393d6565a",
  "supabase/functions/_shared/channel-adapters.ts": "f29fe7502ceb961ad886863c570970d48c4c19969ce2b6fce203a04867deef41",
  "supabase/functions/_shared/pre-send-pipeline.ts": "f44dff1b639511729fff60f48b90041d1ece27e7cccbdca3b5d455b045685f12",
  "supabase/functions/_shared/contact-methods.ts": "cea64c7f9ac201150bfd28834eaac88a6ebe0333c2c0a42dc9b9a8476840eef6",
  "supabase/functions/_shared/internal-vocabulary.ts": "9074425cc61d1a678e3a4ca03595fe8c4d1eac4572a4bd2daf31aff77f39d37a",
  "supabase/functions/_shared/paige-capability-status/resolver.ts": "ec8a5dad7df3426f30203aa1c8014372a60f51ed0decc829fc8541fba62a4142",
  "supabase/functions/paige-deep-research/fabric.ts": "c79dbb46a0245429912079b93b047db413afdcd9d7be3e6e2e6befa60a0da2d9",
  "supabase/functions/_shared/reasoning/strategize.ts": "23f4ca3254da1ff6d3bceb16c7332f3d2d222b88bacbfb14e76891705f68c808",
  "supabase/functions/_shared/ssrfGuard.ts": "ab192431c1d51594a551184bc0e029a2a47a96a408f9f5935e0e13c8bbfe4db8",
  "supabase/functions/_shared/kb-ingest-core.ts": "7001d69379463479e816922b58e911effa3ce0bf0d6f4377ce5b71b21aad070a",
  "supabase/functions/_shared/knowledge-ingest-scope.ts": "d7d21c4f3f76bdab286c3ef89132584358d3b5f5d05c087d0c27c1117c75904c",
  "supabase/functions/_shared/twilio-webhook-auth.ts": "70015f70ca2250b4a991d7c15d54f27bc7fb17d937c386d48621af749f48bf05",
  "supabase/functions/_shared/model-router.ts": "0bf6bb2a81fa9fea8f93dc9f5d98760f61472e9c18aff9e865aeca5890f8664b",
  "supabase/functions/_shared/tenant-for-user.ts": "2d81ae96e2209bc05244e67f103a7fbf3f48dbc2ee29a557e5a483df4800a27d",
  "supabase/functions/_shared/user-contact-methods.ts": "89d7501392b835e4ffbd415e0290e9a535512242149a30fd56abe7800f386f83",
  "supabase/functions/_shared/paige-write-back/governed-adapter.ts": "603d3150768651991750dde1498d3fa75061ff419e77c0150638ae421137af83",
  "supabase/functions/_shared/capability-record.ts": "dae9ca30342e6a6e27d2c77da2910a4f10d5178f9d4b2b7ee541e46bddae0fdb",
  "supabase/functions/_shared/durable-job/mod.ts": "5a52cdc45e245e20c3af458d8346b80991340579d4afafd33c7b0e19e4c8f38c",
  "supabase/functions/_shared/paige-orchestration/resource-binder.ts": "d2b6c246cd66a338d3ae08aa6a8f66f9960af06920d976cda86462bd30be39e4",
  "supabase/functions/_shared/marketplace-authority-containment.ts": "ac5391d46081aa6f3b08382e1420ad944f0519558b8b8d2d0b16dd8cef1cb4c2",
  "supabase/functions/_shared/subagent-authority.ts": "633143a287651772f3c78810397d7a1e753d1d9924c3668693783422be6c8494",
  "supabase/functions/_shared/systems-check-http.ts": "fd5713b29f5127fa0d10e501bd20cd869aa860b816eed500eb19e21e522fcfa6",
  "supabase/functions/_shared/sales-invoice-ledger.ts": "dab806f8decf8682d311a0eeaff90a2c9e7687f6043ff1d85d27a56d66b1515e",
  "supabase/functions/_shared/sales-invoice-document.ts": "baf7933a648ca9752ff43b2c5cd654b84267f3573f7eaa0fa6670be2fc22d844",
  "supabase/functions/_shared/document-pdf.ts": "e88f697d5d79af5feb0d6952fc5029633d488434b232798bc42fffd0fccd9a8e",
  "supabase/functions/_shared/email-attachments.ts": "becc41d2968a75ba07c1ec077c142f625ccb0239f5dd3423073dbbbe0186069e",
  "supabase/functions/_shared/sales-invoice-delivery/readiness-reader.ts": "cb4236ff9fec37be4043a7b2fa6a91e68b63c1c049f351f3d7f7ed51b8366c11",
  // E04 exact invoice navigation: independently compared incumbent route outputs; authority unchanged.
  "supabase/functions/_shared/canonical-app-url.ts": "c7f954bf6633321515b7a091adb286a4050dfa7b2b0069ba059177df115e14d1",
  "supabase/functions/_shared/gmail.ts": "78f697e312d18eb9d73ff2a3802142003a843b109f5e2a956182befb5d6160ff",
  "supabase/functions/_shared/smtp.ts": "0e3ea569f3728dde3329bb5281ef0afb9d592a4f080b3535b2bb7da62799f5ff",
  "supabase/functions/_shared/sales-invoice-delivery/binding.ts": "4e95a90d3a145278d3cb27f64865d26dc968d1c8cf7937dea2feac584e307b77",
  "supabase/functions/_shared/agreements/token.ts": "793e1c0a521fc0ea3b39e5761f87cdad7fee67a73b2110ac1f2963992b20eeea",
  "supabase/functions/_shared/model-fabric.ts": "f4ac35c621fa233f287f897d86dfc289f7c1b7f9235bfe411832c35a9c1c4224",
  "supabase/functions/_shared/llm-trace.ts": "d8da0ed275f3c533afe35b92f7f182238443a9e93834ea885041a85f87629dd9",
  "supabase/functions/_shared/prompt-forge.ts": "0abdeb7a887ac7b566dd8f21c11140122985d2acf0b5b6020596974ffd3e11ee",
  "supabase/functions/_shared/voyage.ts": "4eb1a516b2ce4679e83bfa62bb908a4b2e3be4d48dcdc89df75bb160bd6569b2",
  "supabase/functions/_shared/claude.ts": "cfbb18ce156d2259bf1904d6f6eaed8262e007c70929958c7261f185e20747ff",
  "supabase/functions/_shared/router-budget/mod.ts": "d77811a61d1833990e2c1e65c62d476112fd7a0e6326552582e7949a1cc6c008",
  "supabase/functions/_shared/model-router-gates.ts": "551cf84756d3a5b56a82c645c96ce51f0318f065b5969d19885ba591a506a566",
  "supabase/functions/_shared/model-allowlist.ts": "3b1e162f042a34357eb4ba6fb2e9bd7cafeb9725f07df655ac43f3233d215377",
  "supabase/functions/_shared/env-key.ts": "bbf7dd1e08f48f272e8311f49f9951a850154ed451c4eb3be99a0de8a57c3878",
  "supabase/functions/_shared/provider-types.ts": "8d79766668fcee619bb09f8281f68face325e60182235535c90c42a26410c05b",
  "supabase/functions/_shared/openai.ts": "8b3b1f2c880e6517d5b7fffd56be603ab0e772ba3668d1992c60aa82c08368c9",
  "supabase/functions/_shared/groq.ts": "451b1d60d277816b4912893a08b050b293a05db393f2ee210ea369c8d84d8181",
  "supabase/functions/_shared/ideogram.ts": "428872027d94596b73f61c629fb33dbd0f3f964df3c1783aebbd78131cf337c1",
  "supabase/functions/_shared/replicate.ts": "f8099645e9e0d744b4aa31f74aa814b75cd4acf72c0e186fd8eae5e58b46d92e",
  "supabase/functions/_shared/meshy.ts": "41aac6540ec0b2a3f4ec4e2bce1acf44f36a55625e9ee9331d76d270c0f450e6",
  "supabase/functions/_shared/gemini-image.ts": "68d384818fd85679b70deebbdc567d688fe97425670bd205be93e231f91614b1",
  "supabase/functions/_shared/doc-render.ts": "56e5fd5223120d45d2f445f4f53eeaeb8d69dac9b253c52fe915026d746a5b95",
  "supabase/functions/_shared/token-pricing.ts": "d7a9327187e536caac716def14bd147f4a8319505928f672c1ddc09daede9359",
  "supabase/functions/_shared/paige-spine/governedExecution.ts": "771d67a36c3a88323690e528df35b5355f74a5b6ff330d7262952a7eb87a83a9",
  // Experience 05: independently reviewed process-subject registration; all refusal branches retained.
  "supabase/functions/_shared/paige-orchestration/subject-tenant.ts": "79bfca5cada98f8226a533684556c2b6035ec8aaf0855c06846b035ef4d778bd",
  "supabase/functions/_shared/sales-payments/balance-projection.ts": "089be3509f1a784659f86ceaa8e21238a765b744ebc5f75ecdb870be58070a92",
  "supabase/functions/_shared/sales-invoice-delivery/readiness.ts": "951b29afbdab2ad6480fdaadde38ae6f927bf5686f7bbf5518109128c91bb140",
  "supabase/functions/_shared/comms-email/readiness.ts": "aa87ebeb806a5a08392d3aed0b8759e7af9bf5e8d82718f7c46ed364d11cab99",
  "supabase/functions/_shared/openai-models.ts": "a76ac476a2cbd298421a9d7d37f3605cf384e4a4e53a1635719405d52e70905e",
  "supabase/functions/_shared/openai-responses.ts": "83935ed55145bf1380d32fc809b52c73eadfb22ec5818c5e3e8548b616660c95",
  "supabase/functions/_shared/provider-failure.ts": "3a3507a6ddc6f6e5051a5d17b7a5ff30624643c6bd39d07793224eb0177873b5",
  "supabase/functions/_shared/paige-turn/route.ts": "657f0c9ee1d3724a5eca72f661718d560e090cd7ee36707cadbbf94f1f463d6e",
  "supabase/functions/_shared/brand-tokens.ts": "225f25c0ed74155012b7959766adfe51d4fd8c8341ad7da57c26b650caad06ca",
  "supabase/functions/_shared/cheesy-tells.ts": "7710d88a2999f0ab23870ff22f9ce46999d35d598982ce7f517a7fea0f4fab9a",
  "supabase/functions/_shared/claude-models.ts": "026a3b83753bd302319a1f671cfb560bb788c96b4f27bc44222cd6650fcc34fd",
  "supabase/functions/_shared/comms-email/contract.ts": "733eb988e3541ab06727888c70d04146b6d59321bcbef6583363e5da917121c2",
  "supabase/functions/_shared/paige-turn/continuity.ts": "ca8c258d200a59a573a3c0cc2a3ad253cbed1239da24afdd1efc0fdbc90dec69",
  "supabase/functions/_shared/paige-turn/contract.ts": "317424344aeb669ef5885b36bbe61c66f94ad3fce994c966203cd6c8f42763f4"
};
// The separately reviewed metric read was inserted before the incumbent chain.
// Its adapter/validator are additional ancestry context, not changes to the 88
// incumbent dependency snapshots. Issuing measurement evidence is not a business
// mutation, settlement, provider/model call or new action authority.
// Original-effect discovery and status projection are reviewed read-only context.
// Pin both so a changed helper cannot introduce effects or fabricate settlement.
const ANCESTRY_SOURCES = {
 "supabase/functions/_shared/client-portal-assistant-context.ts": "a19e19a393c6f0a71b7fdab1e8a9204372915fa38860abf4213c0d945eb01967",
 "supabase/functions/_shared/client-portal-chat-scope.ts": "f9f0cc67e17097d3e3f3c817793550acd6d35ecf436965c04851c90254555433",
 "supabase/functions/_shared/client-portal-persona.ts": "f40bdb7e89052844dd797b5b1d4ef3246fade0895fe22ece97d681540415f817",
 "supabase/functions/_shared/paige-spine/domains/soloBusinessInterviewContext.ts": "ae869d9dbc131f0e6d48d3f34e6a5edc81fd22a095946fa06cf8b7393528b053",
 // E02 source review: the33-key literal moved unchanged into a pure dependency.
 // Reconstituting it into the reader is AST-identical to deployed892b1bdfe.
 // Pin BOTH reviewed files; no generated digest acceptance or effect guard waiver.
 "supabase/functions/_shared/analytics-metrics/read.ts": "a666df00a26f6b7d52237afdeb89868898dffb298acce4ba9fbceb18935b15d6",
 "supabase/functions/_shared/analytics-metrics/keys.ts": "7d6469a106f5200147e360e46b0ef1846581795207fa74d7c48f0ecc14d4fbc6",
 "supabase/functions/_shared/analytics-metrics/metric-contract.ts": "8bbc6b91d259e2ab80643dd37667d88736043066e14d725bbca5344874d0c2a5",
 "supabase/functions/_shared/pipeline-original-discovery.ts": "4c55fee76bc2622a0b57b33282276f36aa3a8552725168c45ab1b2774b7e7fa9",
 "supabase/functions/_shared/paige-turn/outcome-status.ts": "2efe3c91386d47e475cfc38e69b97a542a9286f3d09ec853d4c6a126e64075f8",
 // Historical Research context and its pure status-result constructors.
 "supabase/functions/_shared/research-history-context.ts": "fa64f9d267b6f2196ae7ff754ef2660a918bcd6da79698700acbfc05222685b2",
 "supabase/functions/_shared/paige-context/mod.ts": "56fb44fcb3c78d6cf3a221290550b57694be6eb99e8eda608e610ddfc65dd6a8",
 // Independently reviewed completed-lifecycle publication reader; no effect authority.
 "supabase/functions/_shared/paige-turn/interactive.ts": "88d238f65d488277112b87d131ad122e4b28d534b43ca5803df97569a2c54ba5",
 // Independently reviewed canonical approval-status projection; no effect authority.
 "supabase/functions/_shared/paige-turn/interactive-approval.ts": "4ab6bdbd41f2fc6b81e51ee1c286a859a8167db66f34ef66599c0dda55a9e03c",
};
export function validateIncumbentResourceBindings(chatText,sourceTexts) {
 const findings=[],tools=new Map();
 for(const [path,digest]of [...Object.entries(SOURCES),...Object.entries(ANCESTRY_SOURCES)]){
  const raw=sourceTexts.get(path);if(typeof raw!=='string'){findings.push(`incumbent source missing: ${path}`);continue;}
  const source=ts.createSourceFile(path,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  if(source.parseDiagnostics.length||hash(canonical(source))!==digest)findings.push(`incumbent reviewed source changed: ${path}`);
 }
 for(const [tool,spec]of Object.entries(CONTRACTS)){
  try{if(inspectIncumbentSource(chatText,tool).fingerprint!==spec.fingerprint)findings.push(`incumbent reviewed dispatch changed: ${tool}`);else tools.set(tool,spec);}catch(error){findings.push(`incumbent binding ${tool}: ${error.message}`);}
  if(findings.length)break; // Any source refusal invalidates the whole proof.
 }
 return {findings,tools};
}
export const incumbentSourcePaths=[...Object.keys(SOURCES),...Object.keys(ANCESTRY_SOURCES)];
export function matchesIncumbentDeclaration(capability,spec){
 const action=capability.action;
 return !!action&&capability.key===spec.key&&action.chatTool!==undefined
  && ['chatTool','executor','classification','riskPolicyKey','approvalAuthority','seatAuthority'].every(field=>action[field]===spec[field])
  && capability.selfDescribe===spec.selfDescribe&&capability.readiness===spec.readiness
  && capability.chatBinding==='LIVE'&&capability.mindBinding==='UNAVAILABLE'&&capability.maturity==='PARTIAL';
}
export function validateIncumbentDeclarations(capabilities,proof){
 const findings=[];
 for(const capability of capabilities){const spec=CONTRACTS[capability.action?.chatTool];if(spec&&(!proof.tools.has(capability.action.chatTool)||!matchesIncumbentDeclaration(capability,spec)))findings.push(`${capability.key}: incumbent metadata must match reviewed source contract`);}
 return findings;
}
