import ts from "typescript";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { PAIGE_SPINE_CAPABILITIES, validateSpineRegistry } from "../../supabase/functions/_shared/paige-spine/registry.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationDir = join(root, "supabase/migrations");
const migrations = readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort().map((name) => readFileSync(join(migrationDir, name), "utf8")).join("\n");
const chatGuardPath = join(root, "scripts/ci/chat-tool-registry-lint.mjs");
const actionRiskPath = join(root, "supabase/functions/_shared/action-risk.ts");

// Owner-approved SQL-plus-TypeScript extension. Public SQL symbols keep the original
// migration check. Only this exact mounted n8n adapter can prove the two TS symbols.
const chatSourcePath = join(root, "supabase/functions/paige-ai-chat/index.ts");
const managementSourcePath = join(root, "supabase/functions/_shared/n8n-management.ts");
const printer = ts.createPrinter({ removeComments: true });
function nodes(rootNode, predicate) {
  const found=[]; const visit=node=>{if(predicate(node))found.push(node);ts.forEachChild(node,visit);};visit(rootNode);return found;
}
const normalized = node => node ? printer.printNode(ts.EmitHint.Unspecified,node,node.getSourceFile()).replace(/\s+/g,"") : "";
const nameOf = node => node && (ts.isIdentifier(node)||ts.isStringLiteral(node)) ? node.text : "";
const field = (obj,key) => ts.isObjectLiteralExpression(obj) ? obj.properties.find(p=>nameOf(p.name)===key) : undefined;
const fieldValue = (obj,key) => {const p=field(obj,key);return p && ts.isPropertyAssignment(p) ? p.initializer : p && ts.isShorthandPropertyAssignment(p) ? p.name : undefined;};
function validateN8nTypeScript(chatText, managementText) {
  const chat=ts.createSourceFile('paige-ai-chat.ts',chatText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const management=ts.createSourceFile('n8n-management.ts',managementText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const findings=[]; const requireProof=(ok,label)=>{if(!ok)findings.push(`n8n TypeScript binding: ${label}`);};
  requireProof(!chat.parseDiagnostics.length&&!management.parseDiagnostics.length,'source must parse');
  const imports=nodes(chat,ts.isImportDeclaration).filter(n=>ts.isStringLiteral(n.moduleSpecifier)&&n.moduleSpecifier.text==='../_shared/n8n-management.ts');
  const names=imports.flatMap(n=>n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)?n.importClause.namedBindings.elements:[]);
  for(const expected of ['N8N_MANAGEMENT_TOOLS','runN8nManagement'])requireProof(names.filter(n=>n.name.text===expected&&(!n.propertyName||n.propertyName.text===expected)).length===1,`exact import ${expected}`);
  requireProof(!nodes(chat,n=>(ts.isVariableDeclaration(n)||ts.isFunctionDeclaration(n)||ts.isParameter(n))&&['N8N_MANAGEMENT_TOOLS','runN8nManagement'].includes(nameOf(n.name))).length,'import must not be shadowed');
  const declarations=nodes(management,ts.isFunctionDeclaration);
  const executor=declarations.find(n=>n.name?.text==='runN8nManagement');
  const projector=declarations.find(n=>n.name?.text==='project');
  requireProof(!!executor?.body&&!!executor.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword),'exported executor symbol');
  requireProof(!!projector?.body,'projector symbol');
  const specs=nodes(management,ts.isVariableDeclaration).find(n=>nameOf(n.name)==='specs')?.initializer;
  const tools=new Map();
  if(specs&&ts.isObjectLiteralExpression(specs))for(const p of specs.properties){
    if(!ts.isPropertyAssignment(p)||!ts.isObjectLiteralExpression(p.initializer))continue;
    const name=nameOf(p.name),provider=fieldValue(p.initializer,'provider'),write=fieldValue(p.initializer,'write');
    if(/^n8n_[a-z_]+$/.test(name)&&provider&&ts.isStringLiteral(provider)&&write&&[ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword].includes(write.kind))tools.set(name,{provider:provider.text,write:write.kind===ts.SyntaxKind.TrueKeyword});
  }
  requireProof(tools.size>0&&tools.size===(specs&&ts.isObjectLiteralExpression(specs)?specs.properties.length:0),'literal catalog entries');
  const catalog=nodes(management,ts.isVariableDeclaration).find(n=>nameOf(n.name)==='N8N_MANAGEMENT_TOOLS');
  requireProof(!!catalog&&normalized(catalog.initializer).startsWith('Object.entries(specs).map('),'catalog derived from verified specs');
  const defs=nodes(chat,ts.isVariableDeclaration).find(n=>nameOf(n.name)==='toolDefs')?.initializer;
  requireProof(!!defs&&ts.isArrayLiteralExpression(defs)&&defs.elements.some(n=>ts.isSpreadElement(n)&&normalized(n.expression)==='N8N_MANAGEMENT_TOOLS'),'catalog mounted in actual toolDefs array');
  requireProof(nodes(chat,ts.isPropertyAssignment).some(n=>nameOf(n.name)==='tools'&&normalized(n.initializer)==='toolDefs'),'toolDefs passed as model tools');
  const set=nodes(chat,ts.isVariableDeclaration).find(n=>nameOf(n.name)==='N8N_MANAGEMENT_TOOL_NAMES')?.initializer;
  requireProof(normalized(set)==='newSet(N8N_MANAGEMENT_TOOLS.map(tool=>tool.function.name))','routing Set derived from same catalog');
  const calls=nodes(chat,n=>ts.isCallExpression(n)&&normalized(n.expression)==='runN8nManagement');
  requireProof(calls.length===1,'one executor dispatch');
  const dispatch=calls[0];const arg=dispatch?.arguments[0];
  if(arg&&ts.isObjectLiteralExpression(arg)){
    const expected={admin:'supabase',userId:'user.id',tenantId:"personaCtx.tenant_id??''",sessionId:'n8nSessionId',tool:'tc.function.name',args:'args',mutationApproved:'approvalChannel.has(tc.id)'};
    for(const [key,value]of Object.entries(expected))requireProof(normalized(fieldValue(arg,key)).replace(/"/g,"'")===value,`dispatch ${key} binding`);
  }else requireProof(false,'executor object argument');
  let parent=dispatch?.parent,selector=false;
  while(parent){if(ts.isIfStatement(parent)&&normalized(parent.expression)==='N8N_MANAGEMENT_TOOL_NAMES.has(tc.function.name)')selector=true;parent=parent.parent;}
  requireProof(selector,'executor inside exact catalog dispatch');
  requireProof(nodes(chat,n=>ts.isCallExpression(n)&&normalized(n.expression)==='claimConfirmation').some(n=>n.pos<(dispatch?.pos??0)),'canonical claim precedes dispatch');
  requireProof(nodes(chat,ts.isBinaryExpression).some(n=>normalized(n)==='tc.function.arguments=JSON.stringify(approvedArgs)'&&n.pos<(dispatch?.pos??0)),'claimed arguments replace model arguments');
  requireProof(nodes(chat,n=>ts.isCallExpression(n)&&normalized(n.expression)==='approvalChannel.set').some(n=>n.pos<(dispatch?.pos??0)),'canonical approval channel precedes dispatch');
  if(executor?.body){
    const calls=nodes(executor.body,ts.isCallExpression);
    requireProof(calls.some(n=>normalized(n)==="rpc('acquire')"),'executor acquires canonical OAuth lease');
    requireProof(calls.some(n=>normalized(n)==="rpc('check')"),'executor checks lease before provider call');
    requireProof(calls.some(n=>normalized(n)==="rpc('check',{record_success:true})"),'executor checks result commit fence');
    requireProof(nodes(executor.body,ts.isObjectLiteralExpression).some(n=>normalized(fieldValue(n,'actor_id'))==='input.userId'&&normalized(fieldValue(n,'tenant_id'))==='input.tenantId'&&normalized(fieldValue(n,'session_id'))==='input.sessionId'),'lease bound to caller tenant and session');
    requireProof(calls.filter(n=>normalized(n.expression)==='project').length===1&&calls.some(n=>normalized(n)==='project(input.tool,data,secrets,args)'),'actual provider result enters exact projector');
    requireProof(nodes(executor.body,ts.isVariableDeclaration).some(n=>nameOf(n.name)==='projected'&&normalized(n.initializer)==='project(input.tool,data,secrets,args)'),'projected result captured');
    requireProof(nodes(executor.body,ts.isReturnStatement).some(n=>normalized(n.expression)==='projected'),'projected result returned');
    const providerCallback=calls.find(n=>normalized(n.expression)==='withApprovedCapabilitySession')?.arguments[1];
    requireProof(!!providerCallback&&!nodes(providerCallback,ts.isReturnStatement).some(n=>['data','raw'].includes(normalized(n.expression))),'raw provider result not returned');
    requireProof(nodes(executor.body,ts.isIfStatement).some(n=>normalized(n.expression)==='spec.write&&input.mutationApproved!==true'),'executor enforces mutation approval');
  }
  return {findings,tools};
}
const tsProof=validateN8nTypeScript(readFileSync(chatSourcePath,'utf8'),readFileSync(managementSourcePath,'utf8'));

// The Zapier twin of the n8n extension (same owner approval, same rigor, different wiring):
// the two zapier tools are hand-declared in the Chat manifest and dispatched to the
// call-zapier-action edge — there is no in-module catalog/executor to verify, so the proof
// pins the wiring that makes the Spine's declarations TRUE: manifest declaration, the
// role-gated + dispatch mentions, the ONE provider door, the read/run body split, and the
// projection boundary (an MCP provider's answer is untrusted input — it must pass through
// projectOutcomeForModel, never be forwarded raw).
function validateZapierTypeScript(chatText) {
  const chat=ts.createSourceFile('paige-ai-chat.ts',chatText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const findings=[]; const requireProof=(ok,label)=>{if(!ok)findings.push(`zapier TypeScript binding: ${label}`)};
  requireProof(!chat.parseDiagnostics.length,'source must parse');
  const manifestNames=nodes(chat,n=>ts.isPropertyAssignment(n)&&nameOf(n.name)==='name'&&n.initializer&&ts.isStringLiteral(n.initializer)&&['zapier_list_actions','zapier_run_action'].includes(n.initializer.text)&&n.parent&&ts.isObjectLiteralExpression(n.parent)&&field(n.parent,'description'));
  for(const tool of ['zapier_list_actions','zapier_run_action'])requireProof(manifestNames.some(n=>n.initializer.text===tool),`manifest declares ${tool} with governed description`);
  // Both names must reach the model ONLY through the admin role gate and the dispatch guard:
  // each appears in >=2 exact `tc.function.name === "<tool>"` comparisons.
  for(const tool of ['zapier_list_actions','zapier_run_action'])requireProof(nodes(chat,n=>ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken&&normalized(n.left)==='tc.function.name'&&n.right&&ts.isStringLiteral(n.right)&&n.right.text===tool).length>=2,`${tool} referenced by role gate and dispatch`);
  const guard=nodes(chat,ts.isIfStatement).find(n=>normalized(n.expression)==='tc.function.name==="zapier_list_actions"||tc.function.name==="zapier_run_action"');
  requireProof(!!guard,'dispatch guard selects exactly the two zapier tools');
  const block=guard?.thenStatement;
  if(block){
    const invokes=nodes(block,n=>ts.isCallExpression(n)&&normalized(n.expression)==='supabaseClient.functions.invoke'&&n.arguments.length>0&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='call-zapier-action');
    requireProof(invokes.length===1,'one provider door (call-zapier-action)');
    const split=nodes(block,ts.isConditionalExpression).find(n=>normalized(n.condition)==='tc.function.name==="zapier_list_actions"'&&normalized(n.whenTrue)==='{action:"list"}');
    requireProof(!!split,'read tool sends action:list; run tool sends its tool_name');
    requireProof(nodes(block,ts.isCallExpression).some(n=>normalized(n.expression)==='projectOutcomeForModel'&&n.arguments.length===1&&normalized(n.arguments[0])==='zapData'),'provider result enters the outcome projection');
    requireProof(!nodes(block,n=>ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&normalized(n.left)==='result'&&normalized(n.right)==='zapData').length,'raw provider result not forwarded');
  } else requireProof(false,'dispatch block resolved');
  return {findings,tools:new Map([['zapier_list_actions',{write:false}],['zapier_run_action',{write:true}]])};
}
const zapierProof=validateZapierTypeScript(readFileSync(chatSourcePath,'utf8'));

// One registry of the exact TS symbol pairs each proof may vouch for. A proof only vouches
// for capabilities whose chatTool it actually verified, with the declared classification,
// risk policy, and approval authority matching the verified write kind field-for-field.
const TS_SYMBOL_PROOFS=[
  {proof:tsProof,executor:'edge.paige-ai-chat',projector:'n8n-management.project'},
  {proof:zapierProof,executor:'edge.paige-ai-chat',projector:'mcp-outcome.projectOutcomeForModel'},
];
function provenTypeScriptSymbol(capability,role,symbol){
  const tool=capability.action?.chatTool;
  for(const entry of TS_SYMBOL_PROOFS){
    const spec=entry.proof?.tools.get(tool);
    if(!entry.proof||entry.proof.findings.length||!spec||capability.key!==`integrations.${tool}`)continue;
    if(capability.action.classification!==(spec.write?'external_effect':'read')||capability.action.riskPolicyKey!==(spec.write?'high':'read_only')||capability.action.approvalAuthority!==(spec.write?'chat-canonical':'none'))continue;
    if(role==='executor'&&symbol===entry.executor)return true;
    if(role==='projector'&&symbol===entry.projector)return true;
  }
  return false;
}

function lint(capabilities, sql, chatGuard, classifyAction, proof = null) {
  const findings = validateSpineRegistry(capabilities);
  for (const capability of capabilities) {
    const symbols = [["adapter",capability.evidence?.adapter], ["executor",capability.action?.executor], ["projector",capability.outcome?.projector]].filter(([,symbol])=>!!symbol);
    for (const [role,symbol] of symbols) {
      // Never bypass a public SQL symbol, even on a verified TS capability.
      if (!symbol.startsWith("public.") && provenTypeScriptSymbol(capability,role,symbol)) continue;
      const bare = symbol.replace(/^public\./, "");
      if (!new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${bare}\\s*\\(`, "i").test(sql)) findings.push(`${capability.key}: registered server symbol is absent from migration history: ${symbol}`);
    }
    if (["mutate", "external_effect"].includes(capability.action?.classification)) {
      if (!chatGuard) findings.push(`${capability.key}: mutable capability requires the direct Chat registry guard`);
      if (!classifyAction) findings.push(`${capability.key}: mutable capability requires Chat's canonical action-risk policy`);
      if (capability.action?.chatTool && capability.action?.riskPolicyKey && classifyAction && classifyAction(capability.action.chatTool) !== capability.action.riskPolicyKey) findings.push(`${capability.key}: canonical classifyAction(${capability.action.chatTool}) does not return ${capability.action.riskPolicyKey}`);
    }
  }
  if (chatGuard) {
    if (/no Spine registry exists yet/i.test(chatGuard)) findings.push("Chat guard still claims that no Spine registry exists");
    if (!chatGuard.includes("supabase/functions/_shared/paige-spine/registry.ts")) findings.push("Chat guard must consume the canonical Spine registry after reconciliation");
  }
  return findings;
}

if (process.argv.includes("--self-test")) {
  const unsafe = [{ ...PAIGE_SPINE_CAPABILITIES[0], key: "pipeline.unsafe_mutation", chatBinding: "PARTIAL", action: { classification: "mutate", executor: "public.get_pipeline_spine_evidence", chatTool: "banana_write", idempotency: "", riskPolicyKey: "read_only", approvalAuthority: "none" } }, PAIGE_SPINE_CAPABILITIES[0]];
  const findings = lint(unsafe, migrations, null, () => "unclassified");
  if (!["chat-canonical", "LIVE Chat", "ordinary or high", "idempotency", "direct Chat", "classifyAction"].every((needle) => findings.some((finding) => finding.includes(needle)))) { console.error("PAIGE Spine registry lint self-test failed closed incorrectly"); process.exit(1); }
  const external = [{ ...unsafe[0], key: "pipeline.unsafe_external", chatBinding: "LIVE", action: { ...unsafe[0].action, classification: "external_effect", idempotency: "keyed", riskPolicyKey: "ordinary", approvalAuthority: "chat-canonical" } }];
  if (!lint(external, migrations, "supabase/functions/_shared/paige-spine/registry.ts", () => "ordinary").some((finding) => finding.includes("external effects require high"))) { console.error("PAIGE Spine registry lint allowed an ordinary external effect"); process.exit(1); }
  const invalidPrepare = [{ ...PAIGE_SPINE_CAPABILITIES[0], action: { ...PAIGE_SPINE_CAPABILITIES[0].action, classification: "prepare" } }];
  if (!lint(invalidPrepare, migrations, null, null).some((finding) => finding.includes("unsupported action classification"))) { console.error("PAIGE Spine registry lint allowed prepare"); process.exit(1); }
  const later = migrations + "\ncreate or replace function public.future_domain_adapter() returns void language sql as $$ select $$;";
  const future = [{ ...PAIGE_SPINE_CAPABILITIES[0], key: "future.safe_evidence", domain: "future", owner: "future-domain", evidence: { ...PAIGE_SPINE_CAPABILITIES[0].evidence, adapter: "public.future_domain_adapter" }, action: undefined, outcome: undefined }];
  if (lint(future, later, null, null).length) { console.error("PAIGE Spine registry lint rejected a coherent additive later-domain migration"); process.exit(1); }
  if(tsProof.findings.length||zapierProof.findings.length){console.error(tsProof.findings.concat(zapierProof.findings));process.exit(1);}
  const originalChat=readFileSync(chatSourcePath,'utf8'),originalManagement=readFileSync(managementSourcePath,'utf8');
  const n8nNegatives=[
    ['wrong import',originalChat.replace("../_shared/n8n-management.ts","../_shared/untrusted.ts"),originalManagement],
    ['unmounted catalog',originalChat.replace('...N8N_MANAGEMENT_TOOLS','...OTHER_TOOLS'),originalManagement],
    ['caller change',originalChat.replace('userId: user.id','userId: args.user_id'),originalManagement],
    ['tenant change',originalChat.replace("tenantId: personaCtx.tenant_id ?? ''","tenantId: args.tenant_id"),originalManagement],
    ['approval bypass',originalChat.replace('mutationApproved: approvalChannel.has(tc.id)','mutationApproved: true'),originalManagement],
    ['missing executor',originalChat,originalManagement.replace('function runN8nManagement','function missingExecutor')],
    ['missing projector',originalChat,originalManagement.replace('function project(','function missingProjector(')],
    ['projection bypass',originalChat,originalManagement.replace('return projected;','return data;')],
    ['lease bypass',originalChat,originalManagement.replace("await rpc('check');","await Promise.resolve();")],
    ['approval guard removed',originalChat,originalManagement.replace('spec.write&&input.mutationApproved!==true','false')],
  ];
  for(const [name,chat,management]of n8nNegatives)if(!validateN8nTypeScript(chat,management).findings.length){console.error(`AST negative failed: ${name}`);process.exit(1);}
  const zapierNegatives=[
    ['zapier manifest tool removed',originalChat.replace('name: "zapier_run_action"','name: "zapier_other_action"')],
    ['zapier provider door retargeted',originalChat.replace('functions.invoke("call-zapier-action"','functions.invoke("other-provider"')],
    ['zapier dispatch guard weakened',originalChat.replace('tc.function.name === "zapier_list_actions" || tc.function.name === "zapier_run_action"','true')],
    ['zapier raw provider forward',originalChat.replace('result = projectOutcomeForModel(zapData);','result = zapData;')],
  ];
  for(const [name,chat]of zapierNegatives)if(!validateZapierTypeScript(chat).findings.length){console.error(`Zapier AST negative failed: ${name}`);process.exit(1);}
  const native=PAIGE_SPINE_CAPABILITIES.find(c=>c.action?.executor==='edge.paige-ai-chat');
  for(const [label,capability]of [['missing SQL',{...native,outcome:{...native.outcome,projector:'public.missing_sql_projector'}}],['unknown TS',{...native,outcome:{...native.outcome,projector:'other.project'}}],['unregistered TS',{...native,key:'integrations.unknown'}]]){
    if(!lint([capability],migrations,'supabase/functions/_shared/paige-spine/registry.ts',()=> 'high',tsProof).length){console.error(`symbol negative failed: ${label}`);process.exit(1);}
  }
  console.log("PAIGE Spine registry lint self-test: PASS (SQL + exact TS AST bindings)"); process.exit(0);
}

const chatGuard = existsSync(chatGuardPath) ? readFileSync(chatGuardPath, "utf8") : null;
let classifyAction = null;
if (existsSync(actionRiskPath)) {
  const policy = await import(pathToFileURL(actionRiskPath).href);
  classifyAction = typeof policy.classifyAction === "function" ? policy.classifyAction : null;
}
const findings = [...tsProof.findings,...zapierProof.findings,...lint(PAIGE_SPINE_CAPABILITIES, migrations, chatGuard, classifyAction)];
if (findings.length) { console.error("PAIGE Spine registry lint: FAIL"); for (const finding of findings) console.error(`- ${finding}`); process.exit(1); }
console.log(`PAIGE Spine registry lint: PASS (${PAIGE_SPINE_CAPABILITIES.length} capability)`);
