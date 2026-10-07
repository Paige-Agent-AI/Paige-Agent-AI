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
// C0a ("ADMIN IS A TENANT ROLE"): the owner/admin role gate routes through ONE shared set in
// _shared/workspace-authority.ts instead of an inline `tc.function.name === "<tool>"` list. A tool
// still reaches the model only through that gate when (a) it is a member of OWNER_OPS_BRANCH_TOOLS and
// (b) the Chat handler actually routes the owner-ops branch through that set.
const workspaceAuthorityText = readFileSync(join(root, "supabase/functions/_shared/workspace-authority.ts"), "utf8");
const ownerOpsSetBody = (() => {
  const at = workspaceAuthorityText.indexOf("OWNER_OPS_BRANCH_TOOLS");
  return at < 0 ? "" : workspaceAuthorityText.slice(at, workspaceAuthorityText.indexOf("]);", at));
})();
const sharedRoleGateCovers = (chatText, tool) =>
  ownerOpsSetBody.includes(`"${tool}"`) && chatText.includes("OWNER_OPS_BRANCH_TOOLS.has(tc.function.name)");
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
  for(const tool of ['zapier_list_actions','zapier_run_action']){const eq=nodes(chat,n=>ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken&&normalized(n.left)==='tc.function.name'&&n.right&&ts.isStringLiteral(n.right)&&n.right.text===tool).length;requireProof(eq>=2||(eq>=1&&sharedRoleGateCovers(chat.text,tool)),`${tool} referenced by role gate and dispatch`);}
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

// The GHL twin (GHL-1, 2026-10-03: the owner's live connection's 36-tool catalogue is the
// discovery event the M4 lane named as the gate). The GHL lane dispatches to the CANONICAL
// mcp-gateway (not a legacy edge), so the proof pins: the manifest declarations, the
// role-gate + dispatch mentions, the canonical-connection resolution (provider_key
// 'gohighlevel', server-side — the model never supplies a connection id), the gateway
// invocation (the tools action for the list; the execute action with prepare/execute modes
// gated on the approval channel), and the honest not_connected refusal.
function validateGhlTypeScript(chatText, adapterText) {
  const chat=ts.createSourceFile('paige-ai-chat.ts',chatText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const adapter=ts.createSourceFile('ghl-management.ts',adapterText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const findings=[]; const requireProof=(ok,label)=>{if(!ok)findings.push(`ghl TypeScript binding: ${label}`)};
  requireProof(!chat.parseDiagnostics.length&&!adapter.parseDiagnostics.length,'sources must parse');
  // The tool schemas live in the DOMAIN'S ADAPTER (the chat-tool-registry ruling), derived
  // from a specs catalog and mounted by spread — the n8n-management shape, pinned the same way.
  const specs=nodes(adapter,ts.isVariableDeclaration).find(n=>nameOf(n.name)==='specs');
  requireProof(!!specs?.initializer&&ts.isObjectLiteralExpression(specs.initializer),'adapter derives tools from a literal specs catalog');
  const specNames=new Set(specs&&ts.isObjectLiteralExpression(specs.initializer)?specs.initializer.properties.map(p=>nameOf(p.name)).filter(Boolean):[]);
  for(const tool of ['ghl_list_actions','ghl_run_action'])requireProof(specNames.has(tool),`adapter's specs catalog declares ${tool}`);
  const catalog=nodes(adapter,ts.isVariableDeclaration).find(n=>nameOf(n.name)==='GHL_MANAGEMENT_TOOLS');
  requireProof(!!catalog?.initializer&&normalized(catalog.initializer).startsWith('Object.entries(specs).map('),'catalog derived from the specs catalog');
  const mounted=nodes(chat,ts.isSpreadElement).some(n=>normalized(n.expression)==='GHL_MANAGEMENT_TOOLS');
  requireProof(mounted,'catalog mounted in the handler toolDefs by spread (never re-declared inline)');
  for(const tool of ['ghl_list_actions','ghl_run_action']){const eq=nodes(chat,n=>ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken&&normalized(n.left)==='tc.function.name'&&n.right&&ts.isStringLiteral(n.right)&&n.right.text===tool).length;requireProof(eq>=2||(eq>=1&&sharedRoleGateCovers(chat.text,tool)),`${tool} referenced by role gate and dispatch`);}
  const guard=nodes(chat,ts.isIfStatement).find(n=>normalized(n.expression)==='tc.function.name==="ghl_list_actions"||tc.function.name==="ghl_run_action"');
  requireProof(!!guard,'dispatch guard selects exactly the two ghl tools');
  const block=guard?.thenStatement;
  if(block){
    // THE CANONICAL CONNECTION IS RESOLVED SERVER-SIDE — provider_key 'gohighlevel', never
    // a model-supplied connection id.
    requireProof(nodes(block,ts.isBinaryExpression).some(n=>n.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken&&normalized(n.left)==='c?.provider_key'&&n.right&&ts.isStringLiteral(n.right)&&n.right.text==='gohighlevel'),'canonical connection resolved by provider_key gohighlevel server-side');
    requireProof(nodes(block,ts.isPropertyAssignment).some(n=>nameOf(n.name)==='action'&&n.initializer&&ts.isStringLiteral(n.initializer)&&n.initializer.text==='tools'),'catalogue read goes through the gateway tools action');
    const executeCalls=nodes(block,n=>ts.isPropertyAssignment(n)&&nameOf(n.name)==='action'&&n.initializer&&ts.isStringLiteral(n.initializer)&&n.initializer.text==='execute');
    requireProof(executeCalls.length===1,'one execute dispatch through the canonical gateway');
    requireProof(nodes(block,ts.isPropertyAssignment).some(n=>nameOf(n.name)==='mode'&&n.initializer&&ts.isConditionalExpression(n.initializer)&&normalized(n.initializer).includes('approvalChannel.has(tc.id)')&&normalized(n.initializer).includes('"execute"')&&normalized(n.initializer).includes('"prepare"')),'dispatch mode is prepare without the operator approval, execute with it');
    requireProof(nodes(block,ts.isPropertyAssignment).some(n=>nameOf(n.name)==='error'&&n.initializer&&ts.isStringLiteral(n.initializer)&&n.initializer.text==='not_connected'),'honest not_connected refusal when no canonical connection exists');
    // THE TRANSPORT SEAM: a gateway refusal is a non-2xx whose BODY is the honest closed
    // vocabulary (execute_not_enabled, approval_required, not_found); thrown verbatim the
    // model would see only the generic transport sentence. Both invoke sites must read the
    // body with the in-file helper built for exactly this trap.
    requireProof(nodes(block,ts.isCallExpression).filter(n=>normalized(n.expression).includes('readInvokeBody')).length===2,'both gateway invoke sites read the refusal body (readInvokeBody), never throw the transport error');
  } else requireProof(false,'dispatch block resolved');
  return {findings,tools:new Map([['ghl_list_actions',{write:false}],['ghl_run_action',{write:true}]])};
}
const ghlProof=validateGhlTypeScript(readFileSync(chatSourcePath,'utf8'),readFileSync(join(root,'supabase/functions/_shared/ghl-management.ts'),'utf8'));

// Human and PAIGE use the same merchant edge; these are exact, domain-local
// source proofs, not permission to register arbitrary edge names as SQL symbols.
const merchantSpecs = new Map([
  ['sales_merchant.status',{tool:'read_sales_merchant_status',action:'merchant.status',write:false}],
  ['sales_merchant.refresh',{tool:'read_sales_merchant_refresh',action:'merchant.refresh_status',write:false}],
  ['sales_merchant.onboarding_start',{tool:'sales_start_merchant_onboarding',action:'merchant.start_onboarding',write:true}],
  ['sales_merchant.portal_link',{tool:'sales_create_merchant_login_link',action:'merchant.login_link',write:true}],
]);
const merchantPaths={chat:chatSourcePath,aggregate:join(root,'supabase/functions/_shared/sales-invoice-chat.ts'),adapter:join(root,'supabase/functions/_shared/sales-payments/merchant-chat.ts'),declarations:join(root,'supabase/functions/_shared/sales-payments/merchant-capability.ts'),edge:join(root,'supabase/functions/tenant-stripe-connect/index.ts'),admission:join(root,'supabase/functions/_shared/sales-payments/merchant-admission.ts')};
const merchantSources=Object.fromEntries(Object.entries(merchantPaths).map(([key,path])=>[key,readFileSync(path,'utf8')]));
function validateMerchantTypeScript(texts){
  const sources=Object.fromEntries(Object.entries(texts).map(([key,text])=>[key,ts.createSourceFile(`${key}.ts`,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)]));
  const findings=[];const requireProof=(ok,label)=>{if(!ok)findings.push(`merchant TypeScript binding: ${label}`);};
  for(const [key,source]of Object.entries(sources))requireProof(!source.parseDiagnostics.length,`${key} parses`);
  const {chat,aggregate,adapter,declarations,edge,admission}=sources;
  const calls=(source,expression)=>nodes(source,ts.isCallExpression).filter(n=>normalized(n.expression)===expression);
  const imported=(source,path,names)=>{
    const imports=nodes(source,ts.isImportDeclaration).filter(n=>ts.isStringLiteral(n.moduleSpecifier)&&n.moduleSpecifier.text===path);
    const bindings=imports.flatMap(n=>n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)?n.importClause.namedBindings.elements:[]);
    for(const expected of names){requireProof(bindings.filter(n=>n.name.text===expected&&(!n.propertyName||n.propertyName.text===expected)).length===1,`exact import ${expected}`);requireProof(!nodes(source,n=>(ts.isVariableDeclaration(n)||ts.isFunctionDeclaration(n)||ts.isParameter(n))&&nameOf(n.name)===expected).length,`unshadowed ${expected}`);}
  };
  imported(chat,'../_shared/sales-invoice-chat.ts',['SALES_INVOICE_TOOLS','SALES_INVOICE_TOOL_NAMES','dispatchSalesInvoiceChat']);
  imported(aggregate,'./sales-payments/merchant-chat.ts',['SALES_MERCHANT_TOOLS','SALES_MERCHANT_TOOL_NAMES','dispatchMerchantChat']);
  imported(adapter,'./merchant-capability.ts',['MERCHANT_KIT_BY_TOOL','MERCHANT_TOOL_ACTIONS']);
  imported(edge,'../_shared/sales-payments/merchant-admission.ts',['admitMerchantCommand']);
  imported(edge,'../_shared/sales-payments/merchant.ts',['readStripeMerchant']);
  imported(edge,'../_shared/sales-payments/merchant-onboarding.ts',['merchantStatus']);
  imported(admission,'../capability-kit/decision.ts',['decideDeclaredCapability']);
  const actions=nodes(declarations,ts.isVariableDeclaration).find(n=>nameOf(n.name)==='MERCHANT_TOOL_ACTIONS')?.initializer;
  const literal=actions&&ts.isAsExpression(actions)?actions.expression:actions;
  requireProof(literal&&ts.isObjectLiteralExpression(literal)&&literal.properties.length===4,'closed literal action catalog');
  for(const spec of merchantSpecs.values()){const value=fieldValue(literal??{},spec.tool);requireProof(value&&ts.isStringLiteral(value)&&value.text===spec.action,'canonical tool/action '+spec.tool);}
  const catalog=nodes(adapter,ts.isVariableDeclaration).find(n=>nameOf(n.name)==='tools')?.initializer;
  const array=catalog&&ts.isAsExpression(catalog)?catalog.expression:catalog;
  requireProof(array&&ts.isArrayLiteralExpression(array)&&array.elements.length===4&&[...merchantSpecs.values()].every(spec=>array.elements.some(n=>ts.isStringLiteral(n)&&n.text===spec.tool)),'closed Chat catalog');
  requireProof(nodes(aggregate,ts.isVariableDeclaration).some(n=>{if(nameOf(n.name)!=='SALES_INVOICE_TOOLS'||!n.initializer)return false;const init=ts.isAsExpression(n.initializer)?n.initializer.expression:n.initializer;return ts.isArrayLiteralExpression(init)&&init.elements.some(e=>ts.isSpreadElement(e)&&normalized(e.expression)==='SALES_MERCHANT_TOOLS');}),'catalog mounted in Sales family');
  requireProof(calls(declarations,'defineCapability').length===1&&nodes(declarations,ts.isObjectLiteralExpression).some(n=>normalized(fieldValue(n,'risk'))==='\"high\"'||normalized(fieldValue(n,'risk'))==="'high'"),'canonical high-risk Kit declaration');
  requireProof(calls(chat,'toolDefs.push').some(n=>n.arguments.some(a=>ts.isSpreadElement(a)&&normalized(a.expression).replace(/asany$/,'')==='SALES_INVOICE_TOOLS')),'Sales family mounted in Chat');
  requireProof(nodes(chat,ts.isPropertyAssignment).some(n=>nameOf(n.name)==='tools'&&normalized(n.initializer)==='toolDefs'),'mounted catalog reaches model');
  requireProof(nodes(chat,ts.isVariableDeclaration).some(n=>nameOf(n.name)==='dispatchSales'&&normalized(n.initializer)==='SALES_COLLECTIONS_TOOL_NAMES.has(tc.function.name)?dispatchSalesCollectionsChat:dispatchSalesInvoiceChat'),'existing Sales dispatch selects adapter');
  requireProof(calls(chat,'dispatchSales').some(n=>normalized(fieldValue(n.arguments[0],'tenantId'))==='personaCtx?.tenant_id??null'&&normalized(fieldValue(n.arguments[0],'userId'))==='user.id'&&normalized(fieldValue(n.arguments[1],'caller'))==='supabaseClient'),'dispatch uses caller and server tenant');
  const dispatch=calls(aggregate,'dispatchMerchantChat');
  requireProof(dispatch.length===1&&normalized(dispatch[0])==='dispatchMerchantChat(ctx,deps,{operationId:salesInvoiceOperationId})'&&nodes(aggregate,ts.isIfStatement).some(n=>normalized(n.expression)==='SALES_MERCHANT_TOOL_NAMES.has(ctx.toolName)'&&nodes(n.thenStatement,ts.isCallExpression).includes(dispatch[0])),'merchant dispatch mounted behind same catalog');
  const doors=calls(adapter,'deps.caller.functions.invoke');
  requireProof(doors.length===1&&ts.isStringLiteral(doors[0].arguments[0])&&doors[0].arguments[0].text==='tenant-stripe-connect'&&normalized(doors[0].arguments[1])==='{body}','one authenticated merchant provider door');
  requireProof(calls(adapter,'merchantChatSafeResult').length===1,'closed Chat projection');
  const admit=calls(edge,'admitMerchantCommand');const create=calls(edge,'stripe.accounts.create');
  requireProof(admit.length===1&&create.length===1&&admit[0].pos<create[0].pos,'canonical admission before account dispatch');
  requireProof(calls(admission,'decideDeclaredCapability').length===1&&calls(admission,'port.claim').length===1,'shared Kit and canonical claim');
  const rpc=calls(edge,'admin.rpc');
  for(const name of ['_sales_invoice_actor','reserve_sales_merchant_onboarding','persist_sales_merchant_onboarding','record_sales_merchant_onboarding_readback'])requireProof(rpc.some(n=>n.arguments[0]&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text===name),`actual RPC ${name}`);
  requireProof(calls(edge,'readStripeMerchant').length===1,'provider account readback');
  requireProof(calls(edge,'recordCapabilityRun').length===1,'hosted handoff Rail receipt');
  requireProof(calls(edge,'merchantStatus').length>=1,'status projector used');
  return {findings};
}
const merchantProof=validateMerchantTypeScript(merchantSources);
function provenMerchantSymbol(capability,role,symbol,proof=merchantProof){
  const spec=merchantSpecs.get(capability.key);
  if(!spec||proof.findings.length||capability.domain!=='sales_merchant'||capability.action?.chatTool!==spec.tool||capability.action.classification!==(spec.write?'external_effect':'read')||capability.action.riskPolicyKey!==(spec.write?'high':'read_only')||capability.action.approvalAuthority!==(spec.write?'chat-canonical':'none'))return false;
  return role==='executor'&&symbol==='edge.tenant-stripe-connect'||role==='projector'&&symbol==='tenant-stripe-connect:status';
}

// One registry of the exact TS symbol pairs each proof may vouch for. A proof only vouches
// for capabilities whose chatTool it actually verified, with the declared classification,
// risk policy, and approval authority matching the verified write kind field-for-field.
const TS_SYMBOL_PROOFS=[
  {proof:tsProof,executor:'edge.paige-ai-chat',projector:'n8n-management.project'},
  {proof:zapierProof,executor:'edge.paige-ai-chat',projector:'mcp-outcome.projectOutcomeForModel'},
  {proof:ghlProof,executor:'edge.paige-ai-chat',projector:'mcp-gateway.tools'},
  {proof:ghlProof,executor:'edge.paige-ai-chat',projector:'mcp-gateway.execute'},
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
      if (!symbol.startsWith("public.") && (provenTypeScriptSymbol(capability,role,symbol)||provenMerchantSymbol(capability,role,symbol))) continue;
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
  if(tsProof.findings.length||zapierProof.findings.length||ghlProof.findings.length||merchantProof.findings.length){console.error(tsProof.findings.concat(zapierProof.findings,ghlProof.findings,merchantProof.findings));process.exit(1);}
  const merchantNegatives=[
    ['unmounted catalog','aggregate','...SALES_MERCHANT_TOOLS','...OTHER_TOOLS'],
    ['unmounted family','chat','toolDefs.push(...SALES_INVOICE_TOOLS','toolDefs.push(...OTHER_TOOLS'],
    ['unmounted dispatch','aggregate','return dispatchMerchantChat(ctx,deps','return missingDispatch(ctx,deps'],
    ['wrong provider door','adapter',"invoke('tenant-stripe-connect'","invoke('other-edge'"],
    ['missing admission','edge','await admitMerchantCommand(','await missingAdmission('],
    ['missing shared gate','admission','decideDeclaredCapability(MERCHANT_KIT_BY_TOOL','missingGate(MERCHANT_KIT_BY_TOOL'],
    ['missing readback','edge','await around(\'account_readback\',()=>readStripeMerchant(','await around(\'account_readback\',()=>missingReadback('],
    ['missing receipt','edge','await recordCapabilityRun(','await missingReceipt('],
  ];
  for(const [label,key,before,after]of merchantNegatives){
    if(!merchantSources[key].includes(before))throw Error(`merchant negative target absent: ${label}`);
    const altered={...merchantSources,[key]:merchantSources[key].replace(before,after)};
    if(!validateMerchantTypeScript(altered).findings.length)throw Error(`merchant AST negative accepted: ${label}`);
  }
  const merchantCap=PAIGE_SPINE_CAPABILITIES.find(c=>c.key==='sales_merchant.onboarding_start');
  if(!merchantCap)throw Error('merchant registry target absent');
  for(const [label,cap]of [
    ['unknown edge',{...merchantCap,action:{...merchantCap.action,executor:'edge.other'}}],
    ['unknown projector',{...merchantCap,outcome:{...merchantCap.outcome,projector:'other:status'}}],
    ['unknown key',{...merchantCap,key:'sales_merchant.unknown'}],
    ['wrong authority',{...merchantCap,action:{...merchantCap.action,approvalAuthority:'none'}}],
  ])if(!lint([cap],migrations,'supabase/functions/_shared/paige-spine/registry.ts',()=> 'high').length)throw Error(`merchant symbol negative accepted: ${label}`);
  const originalChat=readFileSync(chatSourcePath,'utf8'),originalManagement=readFileSync(managementSourcePath,'utf8');
  // Mutate the intended call, not an unrelated additive domain's matching field.
  const n8nStart=originalChat.indexOf('await runN8nManagement('),n8nEnd=originalChat.indexOf('});',n8nStart)+3;
  const mutateN8nCall=(before,after)=>{if(n8nStart<0||n8nEnd<=n8nStart)throw Error('n8n self-test target missing');const call=originalChat.slice(n8nStart,n8nEnd);if(!call.includes(before))throw Error('n8n self-test field missing: '+before);return originalChat.slice(0,n8nStart)+call.replace(before,after)+originalChat.slice(n8nEnd);};
  const n8nNegatives=[
    ['wrong import',originalChat.replace("../_shared/n8n-management.ts","../_shared/untrusted.ts"),originalManagement],
    ['unmounted catalog',originalChat.replace('...N8N_MANAGEMENT_TOOLS','...OTHER_TOOLS'),originalManagement],
    ['caller change',mutateN8nCall('userId: user.id','userId: args.user_id'),originalManagement],
    ['tenant change',mutateN8nCall("tenantId: personaCtx.tenant_id ?? ''","tenantId: args.tenant_id"),originalManagement],
    ['approval bypass',mutateN8nCall('mutationApproved: approvalChannel.has(tc.id)','mutationApproved: true'),originalManagement],
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
  const originalAdapter=readFileSync(join(root,'supabase/functions/_shared/ghl-management.ts'),'utf8');
  const ghlNegatives=[
    ['ghl adapter tool removed',originalChat,originalAdapter.replace('  ghl_run_action: {','  ghl_other_action: {')],
    ['ghl adapter unmounted',originalChat.replace('...GHL_MANAGEMENT_TOOLS,','...OTHER_TOOLS,'),originalAdapter],
    ['ghl provider resolution weakened',originalChat.replace('c?.provider_key === "gohighlevel"','c?.provider_key === args.provider_key'),originalAdapter],
    ['ghl dispatch guard weakened',originalChat.replace('tc.function.name === "ghl_list_actions" || tc.function.name === "ghl_run_action"','true'),originalAdapter],
    ['ghl prepare bypass (always execute)',originalChat.replace('mode: approvalChannel.has(tc.id) ? "execute" : "prepare"','mode: "execute"'),originalAdapter],
    ['ghl honest not_connected removed',originalChat.replace('error: "not_connected",','error: "unavailable",'),originalAdapter],
    ['ghl refusal body dropped',originalChat.replace('const ghlRunBody = await readInvokeBody(ghlErr, ghlData);','if (ghlErr) throw ghlErr;'),originalAdapter],
  ];
  for(const [name,chat,adapter]of ghlNegatives)if(!validateGhlTypeScript(chat,adapter).findings.length){console.error(`GHL AST negative failed: ${name}`);process.exit(1);}
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
const findings = [...tsProof.findings,...zapierProof.findings,...merchantProof.findings,...lint(PAIGE_SPINE_CAPABILITIES, migrations, chatGuard, classifyAction)];
if (findings.length) { console.error("PAIGE Spine registry lint: FAIL"); for (const finding of findings) console.error(`- ${finding}`); process.exit(1); }
console.log(`PAIGE Spine registry lint: PASS (${PAIGE_SPINE_CAPABILITIES.length} capability)`);
