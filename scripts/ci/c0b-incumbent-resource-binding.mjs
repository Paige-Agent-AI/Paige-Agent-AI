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
    "fingerprint": "e30e4c6192c4bda96ffc8a445b0f5b904c9ac4b99bf97d663c92b29729b521c5"
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
    "fingerprint": "ed9ab52d7d0a43767511336f6da42924a8f7d5f123d9afad4b450b0a606f90fb"
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
    "fingerprint": "b64c1c44b2a97196c3b89f55d55fcc19f11f12bc4704e322b989b4b0eca28658"
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
    "fingerprint": "7593ff2aa8a3c824e35d0c07b8a02837cda128b0a3eb721595d826884bd3b131"
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
    "fingerprint": "ddc9a1a4aad046e44ec6d7e405786f8564ec0a986f272ec3f268118dbce965c7"
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
    "fingerprint": "034fa06f6c755a974ce39b0f713ffbfa4a4d25ae3a90bee07eee02ef5ca37161"
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
    "fingerprint": "f49a392f2fed710564744025cb962caa1a54b7fd2cdaaa7e4392d1606969529a"
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
    "fingerprint": "2aece6fd95c9e452b57db958a109ec5a553a9c50f044c1f8ecb82d74612824d6"
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
    "fingerprint": "61559e0106eae052fbca305cee867cda5f8277627b447485a136218dbe4916a2"
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
    "fingerprint": "61559e0106eae052fbca305cee867cda5f8277627b447485a136218dbe4916a2"
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
    "fingerprint": "cb72f0c174902f85b6d8c1c8aa230f9cb6d7f4c1dc9f286a6b0be6295c8c09ae"
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
    "fingerprint": "2cbeac1e677bb8842f143c825bce3e19e9e6b70ab6383d9b38dd86872808e013"
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
    "fingerprint": "508e41efa724aeaa0017489c1d2ab80e82c22593f1f92bbd74849e84ee48b851"
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
    "fingerprint": "9c7dea911d01cd1e50c8e3c1233a714f5d20721ec3d5d67083718a2a62f52632"
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
    "fingerprint": "32d522414b032769477d6ddbb2f2749b97c5bd8b9a80e510b2241f44118ae2ea"
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
    "fingerprint": "c9d2297e402e452b07ea76f13863dd3d7a4f29f51c7b9dd9e8b850d542342e26"
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
    "fingerprint": "bc91b67777f0c4aeca9c8c49c7be6a73183732f0d6a5c7510f2dc234aa9898cf"
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
    "fingerprint": "72d9be07c366f29efad667fa0c11105533fb4e4f6169331fdea0df0cc4647537"
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
    "fingerprint": "98fad50464939098095081fafd900b0bd7e6df70a2ee0f4fecd52d43d22efb99"
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
    "fingerprint": "8d5b8a1182699beadec350e90b8f9bce99d117df555e244897e9dfc86cc1143a"
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
    "fingerprint": "3c9b540f12a957f91ab1df4e8cea6ebe870014f9425133fb2acc75cdd035855e"
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
    "fingerprint": "209487e0d1df037287c16974e76b0bb7768016c2f82e7c9967df18745ea0b0c3"
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
    "fingerprint": "b9bb4a194fe6751d20554619f4af3baa2fe4f07c12200d0a6f8bff60aa226a71"
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
    "fingerprint": "20d6b25082941f8472c6dcc6a96547a582e8dda9b942bf8b2ceea14bc5665c5c"
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
    "fingerprint": "9467a7d508935396c4e9c77e06cb4e0841c804e993e8fc5e9d6f1796092022e3"
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
    "fingerprint": "fd0b06c9fe049ef6ece729ee65ec9dfd6d882fcd159a85c1683e23e27cddfe8b"
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
    "fingerprint": "e4a2f3f8e771ce9e6419a1cdb2e8d4efb8dc89d9c51720126afff845b6310882"
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
    "fingerprint": "151f158f092711151201a9755d7635edb1edabc6d651961479a16860a0ccae8e"
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
    "fingerprint": "4c83d8c51da024e336398abed87a6be7abcfc5170a49c6a8c1f29c2ae15be213"
  }
};
const SOURCES = {
  "supabase/functions/_shared/workspace-authority.ts": "b5fb2d35bf32fd4280f9e7e2c53488e6a0d4248cdbd42a5beb67ea91d18d5fc1",
  "supabase/functions/_shared/calendar-link-tenant-brain.ts": "28748e315a12caa855ec906192743cdad5298d37ccbd35ad83539949124800f4",
  "supabase/functions/_shared/client-seat-reply.ts": "6b2ed9c2342da886f8dff44a46bc9dadd4bcd3b079839f62b470ea363564b44d",
  "supabase/functions/_shared/outbound-draft-check.ts": "eda79597ac86a489f916075844f535fcf228518d953b48c55b2e9901920ee961",
  "supabase/functions/_shared/action-risk.ts": "c7fe7e4f039823455d2b5748151b58454f30aa6f4693eb91538dc5928e8336d7",
  "supabase/functions/_shared/finance-gate.ts": "dfa7fbec065d346ca72199313294a4418aa8be66f3dbb68cfe991a93aef0cf40",
  "supabase/functions/_shared/paige-capability-status/projection.ts": "280c36a53ed5d553f6e6467f7177d049a2c612078cdb8d8139878cec3463922f",
  "supabase/functions/_shared/paige-capability-status/readiness.ts": "56b0a8da8b1a76414a147d15bffb9b589b9bcf9e130c797290b846759e1da65e",
  "supabase/functions/_shared/paige-capability-status/render.ts": "63a15351e4f7af98544082c421c35af5d9eba2002d54150b2756b255bd131c58",
  "supabase/functions/_shared/checked-write.ts": "455d00e06fc6e84479ff8d0d5782288d21e4570d63d8e2e0acf770a5a8d5e95c",
  "supabase/functions/_shared/untrusted-fence.ts": "fc0ed34f9c564e4669b187a106756e860383ede74ae2bbb60f4b0a3944c7bf12",
  "supabase/functions/paige-deep-research/index.ts": "d03ca42ebd2da2ec293319167840d9750182308c7307bdcc991abf436f954023",
  "supabase/functions/paige-web-search/index.ts": "4a48df53d16d5b2a618df453c3d41fbbf4a6f43dc0830578a3cf0678333c3794",
  "supabase/functions/fetch-url-content/index.ts": "4e10fe5cd2e189ced5c0cf929586626297b7c9653b34f8a109eede4b88d2926b",
  "supabase/functions/kb-ingest-doc/index.ts": "640c91d2dcd4742bb1b12ed37b7bc9b606fa73f2881a825e9c45be011e75aeaf",
  "supabase/functions/comms-search-numbers/index.ts": "828ac020a9c984a808e3c9375748f1762a8667bd5a9da1c81d1fac902782d4f8",
  "supabase/functions/comms-purchase-number/index.ts": "23f479730d2b658fe231dcbe33e3fcd864ec07e9f87ce116742f83e84c8e9237",
  "supabase/functions/comms-a2p-draft/index.ts": "49bd8acc5ed4ec7d60ba79b917438ae5eba0ce2ffcbf862baa9caa56293ada29",
  "supabase/functions/paige-write-back/index.ts": "5ff11463820b7c38e69f683cbcd8542359d5a72c37724c06846bf3dcc6d41de8",
  "supabase/functions/paige-orchestrator/index.ts": "84e1bb410fb5e01242d4a34401ece2c4dbad515be51e3e4cbe337420e5245243",
  "supabase/functions/subagent-forge/index.ts": "1acb5488f11bd93a2d6b36638fddcd73323f4363eacbd58b284d1fa648b3d906",
  "supabase/functions/send-message/index.ts": "bcda6bcb8c643ee271fcf46eca88ccbb764eb0dbd5030e885bb6aa364a0d10ef",
  "supabase/functions/_shared/paige-spine/contracts.ts": "2d771686d636c04d2e07d9b8c336e19cde246b9a303ddd034d7ae8500f7eefb4",
  // Operator retirement adds opt-in timeout/no-retry controls; ordinary callers retain
  // their existing behavior. Renewed non-author review and actual retry controls are
  // recorded on PR #1897; no other incumbent snapshot is regenerated or accepted.
  "supabase/functions/_shared/twilio.ts": "afe6b57d9ed91c00e6517856f7b17c36f147fee5b88afb3450586c4393d6565a",
  "supabase/functions/_shared/channel-adapters.ts": "6ca080080233039c808d79af0a659ab3f93adb818b59573a99083b1cee015e2c",
  "supabase/functions/_shared/pre-send-pipeline.ts": "f44dff1b639511729fff60f48b90041d1ece27e7cccbdca3b5d455b045685f12",
  "supabase/functions/_shared/contact-methods.ts": "cea64c7f9ac201150bfd28834eaac88a6ebe0333c2c0a42dc9b9a8476840eef6",
  "supabase/functions/_shared/internal-vocabulary.ts": "9074425cc61d1a678e3a4ca03595fe8c4d1eac4572a4bd2daf31aff77f39d37a",
  "supabase/functions/_shared/paige-capability-status/resolver.ts": "ec8a5dad7df3426f30203aa1c8014372a60f51ed0decc829fc8541fba62a4142",
  "supabase/functions/paige-deep-research/fabric.ts": "c79dbb46a0245429912079b93b047db413afdcd9d7be3e6e2e6befa60a0da2d9",
  "supabase/functions/_shared/reasoning/strategize.ts": "23f4ca3254da1ff6d3bceb16c7332f3d2d222b88bacbfb14e76891705f68c808",
  "supabase/functions/_shared/ssrfGuard.ts": "ab192431c1d51594a551184bc0e029a2a47a96a408f9f5935e0e13c8bbfe4db8",
  "supabase/functions/_shared/kb-ingest-core.ts": "690bcf6b6f4bff44ed4e964a60c3799dc62f41ea8e317d414d61acfac489eaa3",
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
  "supabase/functions/_shared/canonical-app-url.ts": "4f350474f662ec829ed9d0761591998a6bc31199a3db673744dfceea291d4691",
  "supabase/functions/_shared/gmail.ts": "78f697e312d18eb9d73ff2a3802142003a843b109f5e2a956182befb5d6160ff",
  "supabase/functions/_shared/smtp.ts": "0e3ea569f3728dde3329bb5281ef0afb9d592a4f080b3535b2bb7da62799f5ff",
  "supabase/functions/_shared/sales-invoice-delivery/binding.ts": "4e95a90d3a145278d3cb27f64865d26dc968d1c8cf7937dea2feac584e307b77",
  "supabase/functions/_shared/agreements/token.ts": "793e1c0a521fc0ea3b39e5761f87cdad7fee67a73b2110ac1f2963992b20eeea",
  "supabase/functions/_shared/model-fabric.ts": "6c442b661864089c33ac4f8db953e21f4ba3f7a847a5f0e5de418e971dde0ac4",
  "supabase/functions/_shared/llm-trace.ts": "af062627f61ec1bf2702f69b234c9cee8ce0bcb5010fb3faafcfc2ebbdfc4a13",
  "supabase/functions/_shared/prompt-forge.ts": "0abdeb7a887ac7b566dd8f21c11140122985d2acf0b5b6020596974ffd3e11ee",
  "supabase/functions/_shared/voyage.ts": "4eb1a516b2ce4679e83bfa62bb908a4b2e3be4d48dcdc89df75bb160bd6569b2",
  "supabase/functions/_shared/claude.ts": "67bc9d193437c976a6b481fba40e04cc2bf6b026940ce233919b7e2d25ca7738",
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
  "supabase/functions/_shared/paige-orchestration/subject-tenant.ts": "7b4670476f67d7a8eecea23737f9a3f5ea6477c78e1428b6c8cfd728abc0569c",
  "supabase/functions/_shared/sales-payments/balance-projection.ts": "089be3509f1a784659f86ceaa8e21238a765b744ebc5f75ecdb870be58070a92",
  "supabase/functions/_shared/sales-invoice-delivery/readiness.ts": "951b29afbdab2ad6480fdaadde38ae6f927bf5686f7bbf5518109128c91bb140",
  "supabase/functions/_shared/comms-email/readiness.ts": "5ea65b2c7ff8c499da47238645bf19856da2508ad7ea85ab2a8ab39ac3a09b1d",
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
 "supabase/functions/_shared/analytics-metrics/read.ts": "5d9666507651a14299df79a5272ee0ea4c2d79b14fd0368c2df366f537b94bd9",
 "supabase/functions/_shared/analytics-metrics/metric-contract.ts": "239f18f65fabc566aba0d9d9bf772dd9a401b5a1a25af1efafcc1feb4c93cc16",
 "supabase/functions/_shared/pipeline-original-discovery.ts": "4c55fee76bc2622a0b57b33282276f36aa3a8552725168c45ab1b2774b7e7fa9",
 "supabase/functions/_shared/paige-turn/outcome-status.ts": "2efe3c91386d47e475cfc38e69b97a542a9286f3d09ec853d4c6a126e64075f8",
 // Historical Research context and its pure status-result constructors.
 "supabase/functions/_shared/research-history-context.ts": "fa64f9d267b6f2196ae7ff754ef2660a918bcd6da79698700acbfc05222685b2",
 "supabase/functions/_shared/paige-context/mod.ts": "56fb44fcb3c78d6cf3a221290550b57694be6eb99e8eda608e610ddfc65dd6a8",
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
