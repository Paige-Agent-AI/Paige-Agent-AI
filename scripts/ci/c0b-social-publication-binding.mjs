// Domain-local source proof for the original Spine lint. This is not runtime
// admission. Mount only with the matching original Chat/native-key adapter and
// an independently reviewed immutable source contract; missing proof fails closed.
import ts from "typescript";
import {createHash} from "node:crypto";
import {inspectIncumbentSource} from "./c0b-incumbent-resource-binding.mjs";

// Filled only from the actual immutable NON-AUTHOR source review. A draft/null
// contract is intentionally unavailable to the existing CI gate, never a PASS.
// Actual NON-AUTHOR composition receipt3c20fee0,9ea00137/tree81d103f5;
// literal adoption only. This module never generates or renews these values.
export const SOCIAL_PUBLICATION_REVIEWED_BINDINGS=Object.freeze({
  "dispatches": {
    "social_post_publish": {
      "fingerprint": "e7eedfea8f4bbed0d1c9b6ba60ac6c4a370a79441bdfe485039fe6061a15db84",
      "imports": [
        "../_shared/calendar-booking-read.ts",
        "../_shared/capability-record.ts",
        "../_shared/paige-turn/resume.ts",
        "../_shared/social-publish-command/chat.ts",
        "../_shared/social-publish-command/reference.ts",
        "../_shared/team-hub/card-binding.ts",
        "../_shared/workspace-authority.ts"
      ]
    },
    "read_social_publication": {
      "fingerprint": "e7eedfea8f4bbed0d1c9b6ba60ac6c4a370a79441bdfe485039fe6061a15db84",
      "imports": [
        "../_shared/calendar-booking-read.ts",
        "../_shared/capability-record.ts",
        "../_shared/paige-turn/resume.ts",
        "../_shared/social-publish-command/chat.ts",
        "../_shared/social-publish-command/reference.ts",
        "../_shared/team-hub/card-binding.ts",
        "../_shared/workspace-authority.ts"
      ]
    },
    "check_social_publication": {
      "fingerprint": "e7eedfea8f4bbed0d1c9b6ba60ac6c4a370a79441bdfe485039fe6061a15db84",
      "imports": [
        "../_shared/calendar-booking-read.ts",
        "../_shared/capability-record.ts",
        "../_shared/paige-turn/resume.ts",
        "../_shared/social-publish-command/chat.ts",
        "../_shared/social-publish-command/reference.ts",
        "../_shared/team-hub/card-binding.ts",
        "../_shared/workspace-authority.ts"
      ]
    }
  },
  "sources": {
    "supabase/functions/_shared/social-publish-command/chat.ts": "1e4d7a376d1dfe31bbbf0aea953895cf8f1e996c29dcc0a80ab1d80a0fedeeb8",
    "supabase/functions/_shared/social-publish-command/reference.ts": "2dcf97c7bc63ca8787138f7f5017bb2889869cf3325e14d8ec95f33366ab6e11",
    "supabase/functions/_shared/social-publish-command/read.ts": "be3b86e5c8a6017646eab89ed350a773fdf9963428b5f18ca564c5ec87e7ec43",
    "supabase/functions/_shared/social-publish-command/door.ts": "11f23b7da8a80839303e205d9b69ade113e3ef588432a9f40a6c7733fd71be23",
    "supabase/functions/_shared/social-publish-command/schedule.ts": "b70e1d60b5fca966b289d621422a8f1d6f9ced06509d3c22197c145a871613f7",
    "supabase/functions/_shared/social-publish-command/media.ts": "3b40d7b49e7f9fc7ce33dcea9d65e19909dd0c2cdf1237772729940e05ee9fb3",
    "supabase/functions/_shared/social-provider/governance.ts": "2fa79fb79e3c8928ce61b57b9eda8c5bcd0b3ca733936f7a870dd0c4a19d5928",
    "supabase/functions/_shared/social-provider/mod.ts": "05fbdef3fbe6dd9e2d5ca308d3ee3a10b34978190cb1398b88d0358231cf8a7b",
    "supabase/functions/_shared/social-provider/zernio.ts": "32f5b060a034de37fdd7469128f6a8fa7f80b5bd3297885ac23b8b98d7a0b791",
    "supabase/functions/social-publish-command/index.ts": "1b0908762980b26e6deb9cf0b9182a9cbc6683894dc48a9aeb6e89606616b558",
    "supabase/functions/_shared/paige-spine/domains/social.ts": "9c454e02f3877bbe86a3cd2e5c4c7b82e2159274195a9fe619a87770907164b3",
    "supabase/functions/_shared/paige-spine/domains/social_publication.ts": "06ce4fe08e8d43323d70df36b034f728fc1e0edd07adda6a05014609a023a795"
  },
  "runtimeImports": {
    "../_shared/social-publish-command/chat.ts": "f9604dcd5ac0a64900e82ae6796b82932b7177d164080befca49b68d363003a9",
    "../_shared/social-publish-command/reference.ts": "dc8e2a0391ecdb665d06322d3a60462dd5d02333c9f6aa6d4bf2d242b44af693"
  }
});

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
