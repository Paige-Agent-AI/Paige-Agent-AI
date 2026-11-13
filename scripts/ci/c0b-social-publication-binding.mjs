// Domain-local source proof for the original Spine lint. This is not runtime
// admission. Mount only with the matching original Chat/native-key adapter and
// an independently reviewed immutable source contract; missing proof fails closed.
import ts from "typescript";
import {createHash} from "node:crypto";
import {inspectIncumbentSource} from "./c0b-incumbent-resource-binding.mjs";

// Filled only from the actual immutable NON-AUTHOR source review. A draft/null
// contract is intentionally unavailable to the existing CI gate, never a PASS.
export const SOCIAL_PUBLICATION_REVIEWED_BINDINGS=null;

const SPECS=Object.freeze({
  "social.post_publish":{tool:"social_post_publish",classification:"external_effect",risk:"high",approval:"chat-canonical"},
  "social.publication_read":{tool:"read_social_publication",classification:"read",risk:"read_only",approval:"none"},
  "social.publication_check":{tool:"check_social_publication",classification:"read",risk:"read_only",approval:"none"},
});
export const socialPublicationSourcePaths=Object.freeze([
  "supabase/functions/_shared/social-publish-command/chat.ts",
  "supabase/functions/_shared/social-publish-command/reference.ts",
  "supabase/functions/_shared/social-publish-command/read.ts",
  "supabase/functions/_shared/social-publish-command/door.ts",
  "supabase/functions/_shared/social-publish-command/schedule.ts",
  "supabase/functions/_shared/social-publish-command/media.ts",
  "supabase/functions/_shared/social-provider/governance.ts",
  "supabase/functions/_shared/social-provider/mod.ts",
  "supabase/functions/_shared/social-provider/zernio.ts",
  "supabase/functions/social-publish-command/index.ts",
  "supabase/functions/_shared/paige-spine/domains/social.ts",
  "supabase/functions/_shared/paige-spine/domains/social_publication.ts",
]);
const printer=ts.createPrinter({removeComments:true});
const hash=s=>createHash("sha256").update(s).digest("hex");
const walk=(node,test)=>{const out=[];function visit(n){if(test(n))out.push(n);ts.forEachChild(n,visit);}visit(node);return out;};
const compact=n=>printer.printNode(ts.EmitHint.Unspecified,n,n.getSourceFile()).replace(/\s+/g,"");
const record=x=>x&&typeof x==="object"&&!Array.isArray(x)?x:null;
const digest=x=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x);
const reviewedDispatch=x=>!!record(x)&&Object.keys(x).length===2&&digest(x.fingerprint)
  &&Array.isArray(x.imports)&&x.imports.length>0&&x.imports.length<=128
  &&x.imports.every(p=>typeof p==="string")&&new Set(x.imports).size===x.imports.length
  &&JSON.stringify(x.imports)===JSON.stringify([...x.imports].sort());
const VALUE_IMPORT_BINDINGS=Object.freeze([
  ["../_shared/social-publish-command/chat.ts",["dispatchSocialChat","socialChatToolDefs","SOCIAL_PROPOSAL_KEY","SOCIAL_PUBLISH_TOOL","SOCIAL_READ_TOOL","SOCIAL_CHECK_TOOL","socialResumeShape"]],
  ["../_shared/social-publish-command/reference.ts",["readSocialPublicationReference"]],
]);

export function matchesSocialPublicationDeclaration(capability){
  const spec=Object.hasOwn(SPECS,capability?.key)?SPECS[capability.key]:null,a=capability?.action;
  return !!spec&&capability.domain==="social"&&capability.owner==="solo-campaigns"
    &&capability.humanSurface==="/solo/:account/growth/social"&&capability.readiness==="none"
    &&capability.chatBinding==="LIVE"&&capability.mindBinding==="UNAVAILABLE"&&capability.maturity==="PARTIAL"
    &&capability.sharedPrimitiveChange==="NONE"&&a?.executor==="edge.paige-ai-chat"
    &&a.chatTool===spec.tool&&a.classification===spec.classification&&a.riskPolicyKey===spec.risk
    &&a.approvalAuthority===spec.approval&&a.seatAuthority==="workspace-admin"
    &&capability.outcome?.projector==="public.content_publication_list";
}

/** `reviewed` must contain the exact frozen dispatch/source digests. This module
 * never computes a replacement contract, renews a pin or auto-accepts changed source. */
export function validateSocialPublicationBindings(chatText,sources,reviewed){
  const findings=[],tools=new Map(),proof=record(reviewed),dispatches=record(proof?.dispatches),pins=record(proof?.sources),runtimeImports=record(proof?.runtimeImports);
  const expectedTools=Object.values(SPECS).map(s=>s.tool);
  if(!dispatches||Object.keys(dispatches).length!==3||expectedTools.some(t=>!reviewedDispatch(dispatches[t])))findings.push("Social binding requires all three immutable reviewed dispatch and import contracts");
  if(!pins||Object.keys(pins).length!==socialPublicationSourcePaths.length||socialPublicationSourcePaths.some(p=>!digest(pins[p])))findings.push("Social binding requires the complete reviewed source contract");
  if(!runtimeImports||Object.keys(runtimeImports).length!==VALUE_IMPORT_BINDINGS.length||VALUE_IMPORT_BINDINGS.some(([p])=>!digest(runtimeImports[p])))findings.push("Social binding requires exact reviewed runtime import declarations");
  if(findings.length)return {findings,tools};
  const chat=ts.createSourceFile("chat.ts",chatText.replace(/\r\n/g,"\n"),ts.ScriptTarget.Latest,true);
  if(chat.parseDiagnostics.length) return {findings:["Social Chat source must parse"],tools};
  const calls=walk(chat,ts.isCallExpression),variables=walk(chat,ts.isVariableDeclaration);
  const imports=walk(chat,ts.isImportDeclaration);
  for(const [path,names]of VALUE_IMPORT_BINDINGS){
    const declarations=imports.filter(n=>ts.isStringLiteral(n.moduleSpecifier)&&n.moduleSpecifier.text===path);
    if(declarations.length!==1||hash(printer.printNode(ts.EmitHint.Unspecified,declarations[0],chat))!==runtimeImports[path])findings.push(`Social reviewed runtime import changed: ${path}`);
    const bindings=declarations.filter(n=>n.importClause&&!n.importClause.isTypeOnly&&!n.attributes)
      .flatMap(n=>n.importClause.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)?n.importClause.namedBindings.elements:[]);
    for(const name of names)if(bindings.filter(n=>!n.isTypeOnly&&n.name.text===name&&(!n.propertyName||n.propertyName.text===name)).length!==1
      ||walk(chat,n=>(ts.isVariableDeclaration(n)||ts.isFunctionDeclaration(n)||ts.isParameter(n)||ts.isBindingElement(n))&&n.name&&ts.isIdentifier(n.name)&&n.name.text===name).length){
      findings.push(`Social original import is missing, redirected or shadowed: ${name}`);
    }
  }
  if(!calls.some(n=>compact(n)==="socialResumeShape(row.tool_name,row.args)"))findings.push("Social native proposal resume is not mounted");
  if(!variables.some(n=>compact(n)==="resumedTool=row.tool_name===SOCIAL_PROPOSAL_KEY?SOCIAL_PUBLISH_TOOL:row.tool_name"))findings.push("Social resume must alias only its exact native proposal key");
  if(!calls.some(n=>compact(n)==="buildResumeCall(fp,{tool_name:resumedTool,args:shape.callArgs})"))findings.push("Social resume must dispatch the original stored request under its declared model tool");
  if(!calls.some(n=>compact(n.expression)==="resumeDoorPin.set"&&compact(n).includes("toolName:row.tool_name")))findings.push("Social resume must retain the native key on the original pin");
  if(!calls.some(n=>compact(n.expression).endsWith(".in")&&n.arguments.length===2&&compact(n.arguments[0])==='"tool_name"'&&ts.isArrayLiteralExpression(n.arguments[1])&&n.arguments[1].elements.some(e=>compact(e)==="SOCIAL_PROPOSAL_KEY")))findings.push("Social decline must consume its original native proposal");
  for(const path of socialPublicationSourcePaths){
    const raw=sources.get(path);
    if(typeof raw!=="string"){findings.push(`Social reviewed source missing: ${path}`);continue;}
    const source=ts.createSourceFile(path,raw.replace(/\r\n/g,"\n"),ts.ScriptTarget.Latest,true);
    if(source.parseDiagnostics.length||hash(printer.printNode(ts.EmitHint.Unspecified,source,source))!==pins[path])findings.push(`Social reviewed source changed: ${path}`);
  }
  for(const spec of Object.values(SPECS))try{
    const actual=inspectIncumbentSource(chat.text,spec.tool),expected=dispatches[spec.tool];
    if(actual.fingerprint!==expected.fingerprint)findings.push(`Social reviewed dispatch changed: ${spec.tool}`);
    if(JSON.stringify(actual.imports)!==JSON.stringify(expected.imports))findings.push(`Social reviewed imports changed: ${spec.tool}`);
  }catch(error){findings.push(`Social binding ${spec.tool}: ${error.message}`);}
  if(!findings.length)for(const [key,spec]of Object.entries(SPECS))tools.set(spec.tool,{key,...spec});
  return {findings,tools};
}

export function validateSocialPublicationDeclarations(capabilities,proof){
  const findings=[];
  for(const [key,spec]of Object.entries(SPECS)){
    const found=capabilities.filter(c=>c.key===key);
    if(found.length!==1||!matchesSocialPublicationDeclaration(found[0])||!proof?.tools?.has(spec.tool))findings.push(`Social declaration lacks its exact original binding: ${key}`);
  }
  return findings;
}
