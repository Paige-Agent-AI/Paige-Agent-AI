// Source-proof mechanics over the actual original Root arm. This is not a
// review receipt or permission; no product/source pin is regenerated here.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {test} from "node:test";
import ts from "typescript";
import {inspectIncumbentSource} from "../c0b-incumbent-resource-binding.mjs";
import {socialPublicationSourcePaths,validateSocialPublicationBindings,validateSocialPublicationDeclarations,matchesSocialPublicationDeclaration} from "../c0b-social-publication-binding.mjs";

const root=readFileSync("supabase/functions/paige-ai-chat/index.ts","utf8").replace(/\r\n/g,"\n");
const alias=root;
const sources=new Map(socialPublicationSourcePaths.map(p=>[p,readFileSync(p,"utf8")]));
const printer=ts.createPrinter({removeComments:true});
function sourceDigest(raw){const source=ts.createSourceFile("source.ts",raw.replace(/\r\n/g,"\n"),ts.ScriptTarget.Latest,true);return createHash("sha256").update(printer.printNode(ts.EmitHint.Unspecified,source,source)).digest("hex");}
// Test fixture contracts are derived here solely to exercise the unchanged validator.
// The mounted CI adapter must instead use independently reviewed literal identities.
const aliasAst=ts.createSourceFile("chat.ts",alias,ts.ScriptTarget.Latest,true);
const testContract={dispatches:Object.fromEntries(["social_post_publish","read_social_publication","check_social_publication"].map(tool=>[tool,inspectIncumbentSource(alias,tool)])),
  sources:Object.fromEntries([...sources].map(([p,s])=>[p,sourceDigest(s)])),
  runtimeImports:Object.fromEntries(aliasAst.statements.filter(n=>ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)&&["../_shared/social-publish-command/chat.ts","../_shared/social-publish-command/reference.ts"].includes(n.moduleSpecifier.text)).map(n=>[n.moduleSpecifier.text,createHash("sha256").update(printer.printNode(ts.EmitHint.Unspecified,n,aliasAst)).digest("hex")]))};
const caps=[
  ["social.post_publish","social_post_publish","external_effect","high","chat-canonical"],
  ["social.publication_read","read_social_publication","read","read_only","none"],
  ["social.publication_check","check_social_publication","read","read_only","none"],
].map(([key,chatTool,classification,riskPolicyKey,approvalAuthority])=>({key,domain:"social",owner:"solo-campaigns",humanSurface:"/solo/:account/growth/social",readiness:"none",chatBinding:"LIVE",mindBinding:"UNAVAILABLE",maturity:"PARTIAL",sharedPrimitiveChange:"NONE",
  action:{executor:"edge.paige-ai-chat",chatTool,classification,riskPolicyKey,approvalAuthority,seatAuthority:"workspace-admin"},outcome:{projector:"public.content_publication_list"}}));

test("the actual original native-key adapter has one closed source proof",()=>{
  const proof=validateSocialPublicationBindings(alias,sources,testContract);assert.deepEqual(proof.findings,[]);assert.equal(proof.tools.size,3);assert.deepEqual(validateSocialPublicationDeclarations(caps,proof),[]);
});
test("missing native alias, review identity or source fails closed",()=>{
  const unmounted=alias.replace(" ?? socialResumeShape(row.tool_name,row.args)","");assert.notEqual(unmounted,alias);
  assert.ok(validateSocialPublicationBindings(unmounted,sources,testContract).findings.some(f=>f.includes("resume")));
  assert.ok(validateSocialPublicationBindings(alias,sources,null).findings.length);
  const missing=new Map(sources);missing.delete(socialPublicationSourcePaths[0]);assert.ok(validateSocialPublicationBindings(alias,missing,testContract).findings.some(f=>f.includes("source missing")));
});
test("a service-bearer substitution in the actual original adapter breaks immutable binding",()=>{
  const changed=alias.replace('invoke:body=>supabaseClient.functions.invoke("social-publish-command",{headers:{Authorization:authHeader},body})','invoke:body=>supabaseClient.functions.invoke("social-publish-command",{headers:{Authorization:supabaseServiceKey},body})');
  assert.notEqual(changed,alias);const proof=validateSocialPublicationBindings(changed,sources,testContract);assert.ok(proof.findings.some(f=>f.includes("dispatch changed")));assert.equal(proof.tools.size,0);
});
test("redirecting the actual Root import cannot borrow pinned original helper files",()=>{
  const changed=alias.replace('from "../_shared/social-publish-command/chat.ts"','from "../_shared/foreign-social-command/chat.ts"');
  assert.notEqual(changed,alias);const proof=validateSocialPublicationBindings(changed,sources,testContract);
  assert.ok(proof.findings.some(f=>f.includes("original import")));assert.ok(proof.findings.some(f=>f.includes("reviewed imports changed")));assert.equal(proof.tools.size,0);
});
test("type-only clauses or specifiers cannot substitute for the runtime Social binding",()=>{
  for(const changed of [alias.replace("import {dispatchSocialChat,","import type {dispatchSocialChat,"),alias.replace("import {dispatchSocialChat,","import {type dispatchSocialChat,")]){
    assert.notEqual(changed,alias);const proof=validateSocialPublicationBindings(changed,sources,testContract);assert.ok(proof.findings.some(f=>f.includes("original import")));assert.equal(proof.tools.size,0);
  }
});
test("import attributes cannot change the original runtime module contract",()=>{
  const changed=alias.replace('from "../_shared/social-publish-command/chat.ts";','from "../_shared/social-publish-command/chat.ts" with { type: "json" };');
  assert.notEqual(changed,alias);const proof=validateSocialPublicationBindings(changed,sources,testContract);assert.ok(proof.findings.some(f=>f.includes("runtime import changed")));assert.equal(proof.tools.size,0);
});
test("pinning the model alias or omitting durable decline consumption is refused",()=>{
  for(const changed of [alias.replace("toolName: row.tool_name","toolName: resumedTool"),alias.replace("...COMMS_EMAIL_TOOL_NAMES,SOCIAL_PROPOSAL_KEY]","...COMMS_EMAIL_TOOL_NAMES]")]){
    assert.notEqual(changed,alias);assert.ok(validateSocialPublicationBindings(changed,sources,testContract).findings.length);
  }
});
test("changed approved-argument selection in the original helper cannot borrow its proof",()=>{
  const changed=new Map(sources),p=socialPublicationSourcePaths[0],s=changed.get(p);assert.ok(s.includes("fp=row.fingerprint;args=call;"));changed.set(p,s.replace("fp=row.fingerprint;args=call;","fp=row.fingerprint;args=ctx.args;"));
  assert.ok(validateSocialPublicationBindings(alias,changed,testContract).findings.some(f=>f.includes("reviewed source changed")));
});
test("the closed declaration cannot lend its source proof to another executor, seat, risk or key",()=>{
  const good=caps[0];assert.equal(matchesSocialPublicationDeclaration(good),true);
  for(const delta of [{key:"__proto__"},{key:"social.other"},{maturity:"LIVE"},{chatBinding:"PARTIAL"},{action:{...good.action,executor:"edge.other"}},{action:{...good.action,seatAuthority:"member"}},{action:{...good.action,riskPolicyKey:"ordinary"}},{action:{...good.action,approvalAuthority:"none"}}])assert.equal(matchesSocialPublicationDeclaration({...good,...delta}),false);
  assert.ok(validateSocialPublicationDeclarations(caps,{tools:new Map()}).length);
});
