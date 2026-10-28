// EXP05 main-composed Planning reference, October28: local separate source review
// 5643917bb; original d4c1afeaf reproduces126 pins/29 dispatches. Incoming E04
// Sales agreement reference/focus preserved; renew only the same two composed
// helper digests. Full pre-renewal/inverse proof in the existing UI evidence.
// EXP05 original Planning Work reference, October28. Pre-renewal source35ad53778,
// AUTHOR-REVIEW / LOWER ASSURANCE5684152701; baseline main37244873 reproduces
// all126 dependencies and29 dispatches. Renew ONLY canonical-app-url and record-links
// source digests for the closed optional Planning discriminator. Other124 pins,
// all29 dispatch scalars, metadata, extractor, validator and hostile controls exact.
// No permission, effect, activation or authenticated acceptance is supplied by a pin.
// EXP05 weekly preview + merged EXP08 A1b composition, October27.
// PRE-RENEWAL source0667478177e5420d16f698e41bea41b9fa9bc71b,
// AUTHOR-REVIEW / LOWER ASSURANCE5675206554. Main545e086b2 reproduces
// all29 dispatches/126 dependencies. ONLY enclosing identity[15] changes;
// every incumbent branch/control/helper/import/other identity is exact.
// Renew29 reviewed scalars + original automations digest only; inverse
// restores complete main contract. Preserve other125 pins, metadata,
// extractor/validator and hostile controls. No activation or authority grant.
// EXP08 Team Hub agents A1b, part 3 (the agent turn refuses a chat control hint), AUTHOR-REVIEW /
// LOWER ASSURANCE before renewal (owner ruling 2026-10-27: EXP08 owns Team Hub end to end). Base
// HEAD 1c243694a (origin/main aea94a0e8 merged) reproduces all29 dispatch pins from its own
// paige-ai-chat source. The only source change is inside enclosing identity[15], insertion-only:
// the agent-turn seam's deps object gains `controlHint` (the request's own x-paige-chat-control
// value, read once before the ingress limit), plus two comment lines. No dispatch, control,
// authority or verifier logic changed; action-risk.ts is byte-identical. Renew those 29 dispatch
// scalars only; extractor, metadata, validator, hostile controls and every source pin unchanged.
// EXP08 Team Hub agents A1b (the agent turn), AUTHOR-REVIEW / LOWER ASSURANCE before renewal (owner
// ruling 2026-10-27: EXP08 owns Team Hub end to end, including the edits it needs in shared files).
// Base origin/main cab598493 reproduces all29 dispatch pins from its own paige-ai-chat source.
// Decomposition of all29 against the branch: dispatch branches, dominating controls, local helpers
// and import sets equal; ONLY enclosing identity[15] changes, insertion-only (0 removed / 13 added
// lines): one import of _shared/team-hub/agent-turn.ts and one early branch, after the verified actor
// and the ingress rate limit and before the chat schema, that hands a { teamHubAgentTurn } request
// to that module and returns. No dispatch, control, authority or verifier logic changed;
// action-risk.ts is byte-identical (its pin is unchanged). Renew those 29 dispatch scalars only;
// extractor, metadata, validator, hostile controls and every source pin unchanged.
// EXP08 PAIGE team-lifecycle tools, AUTHOR-REVIEW / LOWER ASSURANCE before renewal (ANT-161 window),
// re-renewed after merging origin/main 93f567749 and the review fixes, then re-checked unchanged after
// merging 50468eec2 and d3e68daf1 (docs only). Each of those mains reproduces all29 dispatch pins and
// all126 source pins from its own sources. Decomposition of all29 against the merged
// branch: dispatch branches, dominating controls, local helpers and import sets equal; ONLY enclosing
// identity[15] changes, insertion-only (0 removed / 184 added canonical lines: the lifecycle offer
// (client-tier and portal excluded), labels, five card summaries with the paged roster lookup and the
// account-shape read, the pre-card rule/receiver/account-shape gate, one final pre-Unknown dispatch
// branch, WRITE_TARGET rows and the target-id resolver case). action-risk.ts canonical delta is five
// added `high` rows (team_suspend_member, team_reinstate_member, team_remove_member,
// team_set_conversations, team_handover_work). Renew those 29 dispatch scalars and that digest only;
// extractor, metadata, validator, hostile controls and every other source pin unchanged.
// EXP08 admin scope stage 0, AUTHOR-REVIEW / LOWER ASSURANCE before renewal. Base origin/main
// 6e2cb01ff reproduces all29 dispatch pins and all126 source pins. Decomposition of all29: dispatch
// branches, dominating controls, local helpers and import sets equal; ONLY enclosing identity[15]
// changes: one canonical line replaced (1 removed / 2 added) - the member_grant_role result gains a
// `note` string saying the role applies only to an already-active member (a pending seat otherwise),
// so PAIGE does not claim access was given (§13). No branch, control, authority or verifier logic
// changed. Renew those29 dispatch scalars only; extractor, metadata, validator, hostile controls and
// all126 source pins unchanged.
// EXP09 original customer-request command: sequential AUTHOR-REVIEW / LOWER ASSURANCE
// BEFORE renewal. Baseline a8aaa131 reproduces all29 original aggregates. Actual
// Root SHA256 db58b72020aa696ef9b393efefb8070797a448fcf26325f9722de0030262da8e.
// Every ORIGINAL dispatch/control/helper/import and other identity is exact.
// Search additionally has one reviewed Portal-only pre-dispatch privacy refusal
// (canonical SHA256 4a69aa16), captured by the unchanged extractor; its original
// provider branch remains exact. Enclosing identity[15] holds the bounded new
// source/claim/native/privacy/result integration. One HIGH risk row only; E04/E08
// rows remain exact. Renew28 literals for29 tools and that risk digest. Original
// extractor/validator/contract metadata/other dependency pins and hostile controls
// unchanged. Native49/0, Root/UI99, scoped-approval8/7-to15/0, privacy7/1-to8/0 and render33
// are local bounded proof, never authenticated execution or activation.
// EXP08 Team Hub increment 4 (PAIGE with Team Hub), AUTHOR-REVIEW / LOWER ASSURANCE before renewal,
// re-renewed on merging main 7ce948051. That main reproduces all29 dispatch pins from its own
// paige-ai-chat source; against the merged source all29 dispatch branches, dominating controls, local
// helpers and import sets are equal and ONLY enclosing identity[15] changes (the increment-4 additions:
// imports, offer, labels, card summary, summary-memory withhold, turn trace policy, the content flag,
// two final pre-Unknown branches, WRITE_TARGET/locator, and the executeToolCalls call site that
// withholds web, Knowledge and unattended writes after a Team Hub read). action-risk.ts canonical delta
// is one added `high` row (team_hub_post_reply). Renew those scalars only; extractor, metadata,
// validator, hostile controls and every other source pin unchanged.
// EXP05 bounded draft save: AUTHOR-REVIEW / LOWER ASSURANCE before renewal,
// ANT161290bfac2/e56ca703; all29 baseline scalars reproduced fromb5122f92.
// Only automation_draft body/helpers/import and enclosing identity[15] change;
// original full branch inverse and all125 existing source pins are preserved.
// Add ONE reviewed unchanged elapsed-utility pin; no validator/metadata waiver.
// EXP05 bounded Automation read: AUTHOR-REVIEW / LOWER ASSURANCE before renewal,
// ANT161805a388d/c15e6a47; original29 baseline literals reproduced from31e.
// Only enclosing identity[15] changes; every incumbent branch/control/other
// identity/helper/import and all125 dependency pins/extractor/metadata stay exact.
// Exact stored-read branch/helper separately reviewed; no effect or activation.
// EXP05 original task-history read: AUTHOR-REVIEW / LOWER ASSURANCE BEFORE renewal.
// Source420c81db / Rootdc335892; ANT161/9b82f9b6. All125 parent source pins and29
// scalars reproduced. Each original branch/control/helper/import is exact; ONLY
// enclosing identity[15] changes. Renew these29 literals and the one reviewed
// automations domain digest. Preserve extractor, metadata, other124 pins, native
// HTTP/SQL ABI, hostile controls and all activation/production proof gates.
// EXP05 Calendar type-only correction: source review98b7df6cb / ANT161f484fa71
// AUTHOR-REVIEW / LOWER ASSURANCE before this ONE helper digest renewal. Strict
// consumer compile125PASS; emitted JS identical. Root/all29/other124 pins exact.
// EXP05 original-outcome correction: pre-renewal AUTHOR-REVIEW / LOWER ASSURANCE
// at4710ecc55 / Chat a4bd438a5, ANT161991f5439 / PR6392593760. All29 old
// scalars reproduced; ONLY enclosing identity[15] changes. All125 source values,
// incoming E04/E08 reservations, metadata, validator and hostile controls retained.
// Corrected card mapping re-reviewed at e20298af0 BEFORE final renewal: ANT161712e7e5b.
// EXP05 original weekly Chat consumer, AUTHOR-REVIEW / LOWER ASSURANCE BEFORE renewal.
// Reviewed e20298af0 / root196795237 against actual main229fb5e9. All29 baseline
// scalars reproduced; all branches/controls remain exact.28 change only enclosing
// identity[15]; capability_status also changes its inspected projection helper to
// clamp this mandatory-confirm draft and adds the original automations import.
// Preserve124 original dependency digests; add only that reviewed domain digest.
// Original extractor/metadata/validators/hostile tests and E04 reservation unchanged.
// Evidence: docs/evidence/exp05-weekly-native-chat-binding.json; ANT1616d4b8c72.
// EXP02 current689 composition: report ROOT/scalars unchanged from reviewedf076.
// Preserve COMPLETE incoming E04 C35 readiness source pin, provenance and metadata.
// EXP02 report source plan, current-main229 composition, October24.
// AUTHOR-REVIEW / LOWER ASSURANCE ba7eeb2ca3860f11c60a06c40f72034cc9f6f634, receipt6392035404.
// Original ROOT00cf86f001c67679f51466c8aeef59ef12b4a38e preserves released campaign read.
// Renew ONLY29 AST-addressed CONTRACTS literals: identity[15] alone changes;
// every branch/control/other identity/helper/import and all124 incoming pins exact.
// Canonical metric keys already pinned; missing-import regression2FAIL to46PASS.
// Extractor/validator/metadata/hostile controls and E04 SOURCES reservation retained.
// EXP04 prepared invitation source, Oct24: AUTHOR-REVIEW / LOWER ASSURANCE
// BEFORE renewal at245458a0, receipt5640616994; exact reviewed readiness blob
// d8856749c80394d597bd32df7c770c77bc6b8141. Extract only the original canonical
// sender-list query/policy; incumbent resolver byte-exact by inverse. Old pin
// 920b5bf2 reproduced, original121 email/invoice cases PASS. Renew this ONE
// dependency literal; Chat root/all29 dispatches, other dependencies, metadata,
// extractor/validators and hostile tests unchanged. No runtime activation.
// EXP09 private CURA files: sequential AUTHOR-REVIEW / LOWER ASSURANCE before renewal.
// Reviewed committed Chat blob323ef07c58eb97f5592fae4b243ba4cbcfcc0ea6 at b2091782b,
// composed with actual main6380. All29 original decompositions change only
// enclosing-handler identity[15]; dispatches/controls/other identities/helpers/imports
// and all124 source dependency pins remain exact. Renew29 literals only.
// Original fail-fast extractor/validator/metadata/hostile tests remain unchanged.
// Evidence: docs/evidence/ui-delivery/assets/e09-private-cura-composer/connected-source-binding.json.
// EXP05 native original specialist status, AUTHOR-REVIEW / LOWER ASSURANCE
// at848abb406 BEFORE renewal. Reviewed Chat blob95fd4627185a; actual parenta39
// reproduced all29 literals/123 dependencies. Only enclosing-handler identity[15]
// changes; every dispatch/control/other identity/helper/import remains exact.
// Renew29 reviewed literals and the strict transport pin; add only the new
// original-history helper pin. No extractor, validator, metadata or waiver.
// EXP05 current-main union, AUTHOR-REVIEW / LOWER ASSURANCE at7fb2a3484.
// Chat blob5d43ef723fe67cb2c20ec2bc2f1c524269d56e51 composes E07#2711
// with the exact pre-processing refusal. Every incoming main scalar reproduced;
// all29 change only enclosing-handler identity[15], with every branch, control,
// other identity, helper and import exact. Preserve both provenances below,
// extractor, metadata and all123 dependency pins. Renew these29 literals only.
// EXP05 saved refusal/reload, October23: AUTHOR-REVIEW / LOWER ASSURANCE.
// Reviewed Chat blob9df96fc9863a5359417690a60493882c5ce8d8f9 against c071094e.
// All29 baseline scalars and122 existing dependency pins reproduced. Only
// enclosing-handler identity[15] changes; branches, controls, other identity,
// helpers and imports remain exact. Renew29 reviewed literals and pin only the
// new shared closed refusal constant; preserve extractor, metadata and hostile tests.
// EXP07 copy refine continuity (2026-10-23), AUTHOR-REVIEW / LOWER ASSURANCE
// against main 84cb2adfc (PR #2702 head). The paige-ai-chat delta is three
// hunks, all in the EXP07 lane's own surface: (1) the CANVAS STATE hint for
// canvas kind "content" resolves the on-canvas marketing_content row's own kind
// and steers copy to content_save/image to generate_image/documents to the
// one-line cannot-revise answer; (2) the content_save model schema gains the
// optional target_content_id with the omit-for-new rule; (3) the content_save
// executor honors target_content_id ONLY through the server-side on-canvas
// clamp (#292 precedent), refines only kind 'text' rows, passes the clamp
// result to save_marketing_content as p_id, and appends the Studio session's
// save_artifact_version snapshot after each save. All 29 base pins were
// reproduced from main's source before writing (scratchpad exp07-c0b/renew);
// every dispatch fingerprint changes because the hint sits in the enclosing
// handler shared by all dispatches (identity/controls), while each tool's own
// dispatch branch, dominating controls, helpers and imports stay structurally
// exact. Renew these 29 literals only; extractor, metadata and dependency
// pins unchanged.
// EXP05 original specialist reentry, October23: AUTHOR-REVIEW / LOWER ASSURANCE.
// Reviewed Chat blob eb15ecc1fb62232589979d1ea69a2f0f5afdc0e8 and orchestrator
// blob 406d289092a45381c0a6d4583c43557714d0aae7 against main77a1c400c.
// Original extractor decomposition: 27 adapters change only enclosing-handler
// identity[15]; list/delegate also change their shared transport branch. Every
// other branch/control/identity/helper/import is exact. All122 old dependency
// digests reproduced; only the reviewed orchestrator dependency changes.
// Renew these30 literals only, with extractor, metadata and hostile controls
// preserved. Original caller-JWT private read never invokes or settles work.
// EXP02 composed report Chat consumer, October23: AUTHOR-REVIEW / LOWER ASSURANCE.
// Exact reviewed dependency 993420e79807cf61bc1eeca1d2afde9cc6f4a9b8.
// Combined Chat blobc82273249f6ec7507e634e318b3124d3542c2ffb; all29 baseline scalars/122
// dependencies reproduced. Only enclosing-handler identity[15] changes relative
// to that dependency; all dispatch/control/other identity/helper/import pieces
// remain exact. Preserve every incoming recovery producer/dependency/metadata
// and original extractor/hostile control. Renew29 literal scalars only. This
// supersedes the initial E2 scalar witness below; historical commit3e846 retained.
// docs/evidence/ui-delivery/assets/e2-report-chat/source-binding.json.
// EXP02 original report Chat consumer, October23: sequential AUTHOR-REVIEW /
// LOWER ASSURANCE against released main ee77807f9c65f4846d3b3ba5ca2aa12ce1f6e2e1.
// Chat blob18956a426d4e75bdd91e7467a24d87b40a1ce308 changes only the original
// document tool/schema/closed review validator and unknown-result hold. Private
// read-only AST decomposition reproduced all29 baseline scalars/122 dependency
// sources. Each dispatch, dominating control, other identity, helper and import
// remains identical; only enclosing-handler identity[15] reflects the reviewed
// document branch. Renew these29 literal scalars only, preserving the original
// extractor, metadata, dependency pins and all hostile controls. Reproduction:
// docs/evidence/ui-delivery/assets/e2-report-chat/source-binding.json.
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
// 2026-10-28 EXP06 hosting door, fingerprint renewal note: two additive WRITE_TARGET
// attribution rows (growth_hosting_deploy/growth_hosting_recover -> growth_hosted_deployments)
// land inside the canonical authentication prefix EVERY incumbent fingerprint covers, so all
// tools' fingerprints were recomputed with this module's own inspector on the exact head —
// dispatch logic, identity and authority are unchanged (the rows are map entries, not dispatch).
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
// EXP05 read-only continuation (2026-10-21), sequential AUTHOR-REVIEW /
// LOWER ASSURANCE; source blob56ef6154a491fc12e805b38c75f354128340b860,
// maina04637af9468a6e6e1f3a65e508eb07e56cba326, ANT-161/49f7ce1d.
// Five actual gate regressions RED ->86 focused PASS. The9-line heuristic-only
// repair excludes forbidden comma-list verbs from action continuation; original
// client/accepted-offer precedence and all execution/approval controls remain.
// All29 frozen main dispatches/116 dependencies reproduced. Independent AST
// decomposition changes only enclosing-handler identity[15],91f18301... ->
// f041e518...; dispatches, dominating controls, other identities, helpers and
// imports remain identical. Renew these29 reviewed literal dispatch scalars only.
// Extractor, metadata and dependency digests are unchanged. Preserve EXP09's
// separately coordinated canonical-app-url dependency renewal (ANT-161/4a182318).
// EXP09 K2 continuation (2026-10-21): NON-AUTHOR source review against main
// 46c6514f917ec00d423fd83e36e6bd9714ba915b. Independent decomposition reproduced
// all 29 existing/candidate scalars: only enclosing-handler identity[15] changes;
// dispatches, dominating controls, other identities, helpers and imports stay equal.
// The customer-only v2 retrieval/eligibility envelope and guarded ranking preserve
// stable context equality and owner/operator controls. Review also reproduced
// 115/116 dependency digests; renew only client-portal-assistant-context ancestry.
// Reviewed raw core c69403b2cdacd14e76f1966b0b0f087eb1dc8ba61e86e34973070fdc2bc56c20;
// context 0aca33229b6d6180c13ea3cf2fff9da8f65edb69a854f43c3229d11049534cd2.
// Only these 30 reviewed literals change; no extractor, metadata or other pin renewal.
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
// E09 Slice 3 bounded renewal (2026-10-18), integrating-crew source review (NOT non-author)
// of plan_item_set_client_share on main b54d7c8d (after #2339/#2340). Per-part comparison:
// all 29 exact dispatch branches, dominating controls and local helpers equal; the one changed
// identity input is the whole-handler try, whose only deltas are the additive offer, label,
// confirm summary, final pre-Unknown dispatch branch, WRITE_TARGET and locator entries. The
// action-risk.ts canonical delta is one added `high` row. Renew those 30 scalars only.
// E09 Slice M bounded renewal (2026-10-18), integrating-crew source review (NOT non-author)
// of portal_menu_read/portal_menu_update on main 04b53739 (after #2344/#2345; #2344 hunks
// intact, branch diff vs main is insertion-only). Per-part comparison: all 29 exact dispatch
// branches, dominating controls and local helpers equal; the one changed identity input is
// the whole-handler try, whose only deltas are the additive offer, labels, confirm summary,
// final pre-Unknown dispatch branch, WRITE_TARGET and locator entries. The action-risk.ts
// canonical delta is one added `high` row. Renew those 30 scalars only.
// E09 Slice M read-tool rename renewal (2026-10-18), integrating-crew source review (NOT
// non-author) on branch 3c9c6f8d -> rename, main 21c6dc81 an ancestor. The chat tool
// portal_menu_read is renamed read_tenant_portal_menu (its public.read_* executor) so the
// capability kit admits it as a declared read. Per-part comparison: all 29 exact dispatch
// branches, dominating controls and local helpers equal; the one changed identity input is
// the whole-handler try, whose only deltas are four string literals of this slice's own
// lines (label key, two dispatch selectors, one refusal text) - rename-only. Branch diff vs
// main stays insertion-only; action-risk.ts is byte-identical (its pin is unchanged).
// Renew those 29 dispatch scalars only.
// E09 Slice 4 (Documents) bounded renewal on current main (2026-10-18), integrating-crew source
// review (NOT non-author): slice4-documents rebased onto main 9939a6b7 (after #2342, #2344,
// #2345, #2347, #2348, #2349, #2350, #2351, #2353, #2354; every main hunk intact). The branch
// diff vs main for paige-ai-chat/index.ts carries exactly the +/- lines of the reviewed Slice 4
// diff (one import; crm_list_documents adds updated_at/shared_at; crm_file_document routes a
// same-client visibility change to public.client_file_set_client_share and a re-file through
// refileClientDocument in _shared/crm/client-file-share.ts, never writing visibility directly).
// Per-part comparison of all 29 pinned tools, main vs branch: every dominating control and local
// helper equal; the one changed identity input is the whole-handler try (identity[15]);
// crm_file_document's own dispatch branch changes as described. action-risk.ts is byte-identical
// (pin unchanged; crm_file_document stays `high`). Renew those 29 dispatch scalars only.
// E09 Slice 6 (Profile & Consent) bounded renewal on current main (2026-10-18), integrating-crew source
// review (NOT non-author): slice6-consent rebased onto main e660dca7 (Documents #2358 and every earlier
// main hunk intact). The branch diff vs main for paige-ai-chat/index.ts is ONE replaced string literal: the
// `do_not_contact` property description inside the update_client tool definition, which claimed
// "suppresses outbound email and SMS" although runPreSend never reads do_not_contact (§13); it now says
// what the flag does (marketing email only) and where a 1:1 pause lives. Proof: with that one literal
// reverted, all 29 fingerprints equal main's pins exactly; with it, all 29 change (the whole-handler try,
// identity[15]). No dispatch branch, control, helper, authority or verifier logic changed. action-risk.ts
// is byte-identical (pin unchanged). Renew those 29 dispatch scalars only.
// E09 Slice 7 bounded renewal (2026-10-18), integrating-crew source review (NOT non-author)
// of read_client_portal_access/client_portal_access_set on main 1cc4e995. Per-part comparison
// (fingerprint decomposed into dispatch branch, dominating controls, identity inputs, local
// helpers, imports): all 29 exact dispatch branches, dominating controls, local helpers and
// imports equal; the one changed identity input is the whole-handler try (index 15), whose
// canonical delta is insertion-only (0 removed / 85 added lines: the additive offer, two labels,
// the confirm summary case, the final pre-Unknown dispatch branch, WRITE_TARGET and locator
// entries). The action-risk.ts canonical delta is one added `high` row. Renew those 30 scalars only.
// E09 Slice 7 round-2 renewal (2026-10-18), integrating-crew source review (NOT non-author): the
// approval card for client_portal_access_set now names the client and the reason. The whole paige-ai-chat
// diff is two lines: `portalAccessClientName` added to the existing client-portal-access import, and the
// describeConfirm case `client_portal_access_set` now returns portalAccessConfirmSummary(a, await
// portalAccessClientName(supabaseClient, personaCtx?.tenant_id ?? null, a?.contact_id)) — a read-only name
// lookup on the caller's own session (RLS), no write, no effect. describeConfirm lives inside the
// whole-handler try (identity input index 15) and precedes the comms_setup_calling branch (a dominating
// control there), so all 29 scalars move; no dispatch branch, control, helper or import set of any
// contract changed otherwise. Renew those 29 scalars only.
// E09 Slice 7 round-3 renewal (2026-10-18), integrating-crew source review (NOT non-author): the
// approval card for client_portal_access_set is now bound to the version it was built from. The
// paige-ai-chat delta is confined to this slice's own final pre-Unknown dispatch branch plus its
// import: `accessVersionToken` added to the existing client-portal-access import, and two read-only
// result fields — `access_version: accessVersionToken(r.view.since)` on the read result and on the
// set result — plus one sentence appended to the read result's note. No write, authority, tenant,
// actor or confirmation path changed. Decomposed per contract (dispatch branches, dominating
// controls, local helpers, imports, identity inputs): all equal for all 29 except identity input 15
// (the whole-handler try), whose canonical delta is 2 lines replaced and 1 added, all inside that
// branch. Renew those 29 scalars only; no SOURCES/ANCESTRY digest changes.
// E09 Slice 7 integration renewal (2026-10-19), integrating-crew source review (NOT non-author): the
// Slice 7 branch (e88971a26, whose three notes above were reviewed against 1cc4e995) squash-merged onto
// s7-integrate b6d3bdf75 (main d44ad08 + Agreements #2367 + Payments). The three round notes above are
// superseded by this one: their scalars were never pinned on this base. Additive-only check against the
// composed bytes: the paige-ai-chat delta base -> integrated head is exactly Slice 7's own delta
// (1cc4e995 -> e88971a26), line for line, 84 lines added and 0 removed (the client-portal-access import,
// the two Spine tools on the offer, two labels, the confirm summary case, the final pre-Unknown dispatch
// branch, WRITE_TARGET and locator entries). Decomposed per contract (dispatch branches, dominating
// controls, local helpers, imports, identity inputs) for all 29: every part equal except identity input
// 15 (the whole-handler try), which holds those insertions. action-risk.ts is base plus Slice 7's one added
// `high` row; its canonical digest a7c03694... equals the digest Slice 7 reviewed, so that SOURCES pin is
// the reviewed one. Renew those 29 dispatch scalars only.
// E09 Slice 7 integration round-2 renewal (2026-10-19), integrating-crew source review (NOT non-author):
// the compliance review found Paige's share confirmations told the owner a PAUSED client "can now open it
// in their portal" (the share writers reported the login link alone). The paige-ai-chat delta is three
// confirmation notes plus one name added to the existing client-portal-access import: crm_file_document's
// same-client share note and its re-file note, and plan_item_set_client_share's note, each now say "can
// open it now" only on the branch where the writer's portal_connected is not false, and otherwise append
// portalUnseenNote(...) (a pure sentence from _shared/client-portal-access.ts naming paused / ended / not
// joined); each result also carries the writer's portal_access. No write, authority, tenant, actor,
// confirmation or verifier path changed. Decomposed per contract (dispatch branches, dominating controls,
// local helpers, imports, identity inputs): all equal for all 29 except identity input 15 (the
// whole-handler try: 6 canonical lines replaced by 14, all inside those three notes and the import name)
// and crm_file_document's own dispatch branch (its two notes) and import set (client-portal-access.ts is
// now referenced from that branch, for portalUnseenNote). action-risk.ts is byte-identical. Renew those 29
// dispatch scalars only; no SOURCES/ANCESTRY digest changes.
// E09 Slice 7 integration round-3 renewal (2026-10-19), integrating-crew source review (NOT non-author):
// the Slice 7 branch rebased from s7-integrate b6d3bdf75 onto main a26efbcc9 (Agreements #2367 renumbered
// 225000, Payments #2371, Slice H #2373, and main's own chat changes, e.g. the ANT-21 stream bound). The two notes above
// pinned scalars on b6d3bdf75, never on this base, and are superseded here. Additive check against the
// composed bytes: the paige-ai-chat delta main -> head equals the round-2-reviewed delta b6d3bdf75 ->
// round-2 head line for line, except the round-3 security-2 change: the three share-confirmation guards
// (crm_file_document's same-client share note and re-file note, plan_item_set_client_share's note) test
// `portalConnected !== true` instead of `=== false`, so an answer with no portal_connected (null, e.g. a
// replay) takes the unseen branch and never claims visibility; the re-file call passes
// `refiled.share ?? { portalConnected: null }`; one comment line added. Decomposed per contract against
// main's pins (dispatch branches, dominating controls, local helpers, imports, identity inputs): main's
// own fingerprints equal main's pins for all 29; at head every part is equal except identity input 15
// (the whole-handler try, holding Slice 7's insertions and these guards) for all 29, and, for
// crm_file_document only, its dispatch branch (the two share notes above) and its import set (+
// ../_shared/client-portal-access.ts for portalUnseenNote, a pure sentence function). No write,
// authority, tenant, actor, confirmation or verifier path changed. Renew those 29 dispatch scalars only.
// E09 CURA identity bounded renewal (2026-10-19), AUTHOR source review (NOT non-author; the independent
// round-3 reviewers must confirm): branch e09-portal-cura rebased onto main a26efbcc9 (Slice H #2373 and every
// earlier main hunk intact). The branch diff vs main for paige-ai-chat/index.ts is two hunks: one added import
// line (readClientPortalPersonaInput, customerAgentName, customerSeatIdentity) and one added
// `else if (callerTier === "client")` branch after the native Customer Portal persona branch, which re-voices
// the owner's prompt blocks with the business's agent name read from client_portal_frame under the caller's
// JWT (best effort, presentation only; vouched client-seat text untouched). No dispatch branch, control,
// helper, authority or verifier logic changed; the whole-handler try (identity[15]) is what moves all 29.
// Proof: paige-ai-chat/index.ts at main gives all 29 of main's pins exactly (scratchpad r3/pins.mjs, zero
// mismatches); the branch's gives the 29 below. send-message/index.ts: the client email's sender fallback
// reads the business name through _shared/email/sender-display-name.ts instead of "Paige Agent" (one import,
// one widened row type, one replaced assignment). client-portal-identity.ts: the customer agent-name rule
// (accent/symbol folding, "Paiget" only as a standalone word) and literal replacer functions. action-risk.ts
// is byte-identical (pin unchanged). Renew those 29 dispatch scalars and those 2 source digests only.
// E09 CURA round-6 renewal (2026-10-19), AUTHOR source review (NOT non-author; a non-author reviewer must
// confirm): branch e09-portal-cura rebased from main a26efbcc9 onto main 7d3964564 (Slice 7 #2376, the mentor remap,
// H0 #2375). At 7d3964564 main's own paige-ai-chat gives all 29 of main's pins exactly (scratchpad r3/pins.mjs,
// zero mismatches). The branch delta main -> head for paige-ai-chat/index.ts is the same 18 changed lines, line for
// line, as the delta reviewed in round 3 (a26efbcc9 -> round-5 head): one added import line and the added
// `else if (callerTier === "client")` re-voicing branch. Slice 7's insertions are main's and unchanged. Those lines
// sit in the whole-handler try (identity input 15), which is what moves all 29; no dispatch branch, control,
// helper, import set, authority or verifier logic changed. SOURCES/ANCESTRY digests are unchanged (no mismatch).
// Renew those 29 dispatch scalars only.
// E09 F2 bounded renewal (2026-10-19), owner-approved; AUTHOR source review (NOT non-author; a non-author reviewer
// must confirm): branch e09-funding-f2 on main 8f232ff98 (F1b #2387). At 8f232ff98 main's own paige-ai-chat gives all 29
// of main's pins exactly (zero mismatches). The F2 delta in paige-ai-chat/index.ts: (1) the existing `callerTier`
// resolution (same getActorTier call, same fail-closed "client" default, same customerPortal skip) moves earlier, ahead of
// the attachment branch, and the URL-fetch site reuses it exactly as before; (2) the credit-report read-check is skipped
// for a client-tier caller (their PDF takes the general-document path); (3) personaCtx.funding_enabled is forced false for
// a client-tier caller; (4) one added case label ("not_entitled" -> capability_refused) in the portal-menu outcome map.
// All four sit in the whole-handler try (identity input 15), which is what moves all 29; import sets are equal for all 29.
// No write, authority, tenant, actor, confirmation or verifier path widened. Renew those 29 dispatch scalars only.
// EXP00 O-3 renewal (2026-10-19), AUTHOR source review (NOT non-author; an independent reviewer must
// confirm): the operator-console chat fix (zcod/exp00-o3-chat-company-tools) changes
// paige-ai-chat/index.ts in FIVE additive places — the request schema gains the operator-console
// surface literal; a hard-gated persona force (is_platform_operator on the verified JWT) makes the
// operator console ask tenant-lessly as PAIGE Inc; a steering system line names the company data
// sources; two platform read tools (platform_customer_overview / platform_commercial_summary) are
// conditionally defined and dispatched to the platform-admin-gated SQL RPCs through the caller-JWT
// client. No existing dispatch branch, guard, refusal, adapter or verifier changed; the whole-handler
// shape moves all 29 fingerprints together. Old fingerprints reproduced from main before renewing
// (scratchpad renew-pins2.mjs over base vs branch chat source). Renew these 29 dispatch scalars only.
// Round-2 renewal (same day, review P1): the force block was initially nested inside the
// customerPersona branch (dead on real operator turns) and was moved to a sibling position; the
// crm_search_contacts anchor indent restored. Fingerprints renewed again (scratchpad renew-pins3.mjs).
// Round-3 renewal: the sanctioned kit registration moved the tool mount to the canonical
// toolDefs.push(...PLATFORM_OPERATOR_READ_TOOLS) form with the spine-domain import; fingerprints
// renewed once more against origin/main's chat source (round-3 scratchpad).
// Round-4 renewal: the knowledge-scope revalidation now honors the operator console's pinned
// platform scope (live probe caught the membership-fallback row reading as a mid-turn scope
// change); fingerprints recomputed against origin/main's chat source (round-4 scratchpad); round-5: the owner-ops dispatch entry condition now
// admits the operator console's two platform reads (gated on operatorConsolePersona, never the
// frozen workspace set — live probe #2 caught them falling through to 'Unknown tool').
// Fingerprints recomputed against origin/main's chat source (round-5 scratchpad); round-6: the workspace-authority admission now
// admits the operator console's platform reads on the verified persona (live probe #3 caught
// 'workspace owner or admin required'). Fingerprints recomputed vs origin/main (round-6 scratchpad); round-7: authority admission now uses a module-level
// PLATFORM_READ_TOOL_NAMES set (no tc.function.name === near the authorityAdmits gate — the
// declaration lint's window heuristic correctly caught the inline pattern). Fingerprints
// recomputed vs origin/main (round-7 scratchpad).
// E02 bounded renewal: AUTHOR-REVIEW / LOWER ASSURANCE of 9e23831942f778b5cd89638c409ead7753a9e394.
// The existing snapshot call now uses the caller-JWT transport released in #2451.
// Restoring only that imported/called name makes the whole Chat AST identical to
// reviewed main 1eb4d1e66; all 29 original fingerprints pass on that baseline.
// Each new scalar below includes that same preceding read-only branch. All
// incumbent bodies, controls, identity inputs, dependency pins and metadata stay
// unchanged. No extractor or negative-control waiver; final CI/review still apply.
// E02 O17 AUTHOR-REVIEW / LOWER ASSURANCE, immutable Chat b772485f versus95d61084:
// all29 exact branches, dominating controls, local helpers and imports are equal.
// Only identity input15 (the same whole-handler try) changes: the existing inbox
// envelope dispatcher/reference wiring and trusted per-call Map collector condition.
// Freeze only these reviewed29 scalars. Extractor, metadata, SOURCES/ANCESTRY,
// admission/authority/recovery/effects and all prior refusal mutants stay intact.
// EXP09 original approval-status observation (2026-10-21): all29 original
// scalar fingerprints reproduce against main5b03e903. Isolated AST decomposition
// changes only enclosing-handler identity[15] f041e518... -> d21ac092...;
// branches, dominating controls, other identities, helpers/imports are identical.
// No tool, execution, approval or hold authority changed. New read-only original
// CURA history/observer source is pinned below; no extractor/metadata waiver.
// P2 ordinary-profile repair: all29 d1a800ec scalars reproduce exactly.
// Only enclosing-handler identity[15] changes d21ac092... -> 1f1b9249...
// for the canonical profiles.user_id lookup; branch/control/helper/import
// identities and all116 incumbent plus two CURA dependency pins stay intact.
// Explicit CURA status projection: all29 9088bd7b pins reproduce; only
// enclosing identity[15] changes 1f1b9249... -> 038e9116... . Dispatch
// branches/controls/other identities/helpers/imports are identical. The one
// control-transport source pin changes cabcb7db... -> fb73799d... for a
// literal-true status-only read selector requiring its original approval origin.
// All other117 dependency pins, extractor and metadata stay unchanged.
// EXP05 bounded Operations review, AUTHOR-REVIEW / LOWER ASSURANCE, Oct21/22.
// Immutable base d873a1b7b9937c5cacd7a1228665e08bdc99919e reproduces all29 pins.
// Restoring only the operator prompt prose/import makes the Chat AST identical.
// Separate decomposition: all29 branches, controls, helpers, imports and all
// other identity inputs are equal; only whole-handler identity[15] changes.
// Core source sha256 3068f564e2633614f1ffec914de96cc2c5c2b06c3c4f11c7f3579972c05568c2
// -> 79d9a4d2bf1904a62a216208f311e3ffabf5864a588574bb55f7efd596e4ca27 (LF).
// All120 dependency pins, metadata, extractor and hostile refusal tests remain.
// Instructions grant no authority; required exact-head CI and runtime proof stay.
// EXP05 owner-private weekly status, AUTHOR-REVIEW / LOWER ASSURANCE, Oct22.
// Immutable base dda459c23f966f7c3e0112d998ab32c110bde25b reproduces all29 pins.
// Scoped inverse removes only two imports, one read-set name, trace case,
// domain offer and final read dispatch; the entire restored Chat AST equals base.
// All29 incumbent branches/controls/helpers/imports and every other identity
// are identical. Only whole-handler identity[15] changes for this additive read.
// Core LF sha256 eea17cc1e4dfec21673e1a5bf6387145f5186ae1848ef3dd4940b5210db8f3de.
// All120 dependency pins, extractor, metadata and hostile refusal tests stay exact.
// Native caller-JWT owner/scope checks remain; no schedule or effect authority.
// EXP09 customer-only CURA request scope, AUTHOR-REVIEW / LOWER ASSURANCE.
// Base4008a1390 reproduces all29 original scalar bindings/120 source pins.
// Exact inverse of11 customer-native request/CORS patches restores the entire
// baseline handler byte-for-byte. Original owner/service factories are untouched;
// all8 strict CRM read bindings pass without changing their verifier.
// Customer-scoped instance is the same SDK/verified bearer/anon key/native store,
// not an execution/permission system. Action metadata, extractor, dependencies
// and refusal expectations remain unchanged; renew reviewed ancestry scalars only.
// Candidate handler SHA2561de19b80b5fb4944c8dbb7888fb550f859071259c72fb2b8d8df8421df7853e8.
// EXP09 original shared Progress context, Oct22, AUTHOR-REVIEW / LOWER ASSURANCE.
// Base4bdca8486 reproduces every29 dispatch scalar and all120 original source pins.
// Recorded12 inverse operations (20 sites) restore the complete original handler;
// original dispatches, controls, helpers, imports, factories and metadata are exact.
// Independent source decomposition changes only enclosing-handler identity[15].
// Native accepts the original intent before a bounded source read; error recovery
// preserves the issued receipt, original cleanup and owner messages. No new tool.
// Renew these reviewed29 scalars and explicitly pin the new closed context helper;
// retain every original120 dependency, extractor and hostile refusal control.
// Native source/ABI/ACL, exact CI and actual client/model proof remain separate.
// EXP05 98326a6bf4908d4a02c675deeaebf97bc8e57e69, sequential AUTHOR-REVIEW / LOWER ASSURANCE.
// Five actual Chat-branch/next-mutator regressions corrected. All29 main pins reproduced.
// AST decomposition: common enclosing-handler identity[15] only for27 adapters;
// list/delegate also change their shared branch and existing approval-outcome import.
// All other controls/identity/helpers/imports and121 dependency sources preserved.
// Renew only these reviewed literal scalars; no verifier, metadata or mutation waiver.
// EXP05 98326a6bf4908d4a02c675deeaebf97bc8e57e69, sequential AUTHOR-REVIEW / LOWER ASSURANCE.
// Five actual Chat-branch/next-mutator regressions corrected. All29 main pins reproduced.
// AST decomposition: common enclosing-handler identity[15] only for27 adapters;
// list/delegate also change their shared branch and existing approval-outcome import.
// All other controls/identity/helpers/imports and121 dependency sources preserved.
// Renew only these reviewed literal scalars; no verifier, metadata or mutation waiver.
// EXP05 approval brief, AUTHOR-REVIEW / LOWER ASSURANCE atdec31d691
// reviews5637296300/5637298584 BEFORE literal renewal. Exact c9 baseline29
// scalars and all124 actual dependency pins reproduce. Original extractor
// decomposition changes ONLY enclosing-handler identity[15]; all branches,
// controls, other identities, helpers/imports and dependency digests stay exact.
// Chat blob869d339bccc7; no metadata, validator, gate or activation change.
// docs/evidence/exp05-specialist-confirmation-brief-binding.json.
// EXP05 original approval deadline, AUTHOR-REVIEW / LOWER ASSURANCE.
// Exact source b07aef8d21c7c6723a6127445fb0ca0540bf7750; review6382339584
// BEFORE renewal. Actual main7b baseline29 scalars/all124 dependencies reproduce.
// Original AST decomposition changes ONLY enclosing-handler identity[15];
// every branch/control/other identity/helper/import is exact. Renew29 literals
// only; metadata/extractor/validator/dependency digests remain unchanged.
// docs/evidence/exp05-initial-approval-expiry-binding.json.
// EXP04 exact attribution review, Oct24: AUTHOR-REVIEW / LOWER ASSURANCE.
// Relative to b73ff25d, removing ONE WRITE_TARGET row restores the entire
// Chat source byte-for-byte. All122 original dependencies/29 baseline scalars
// reproduce. Separate original-extractor decomposition changes ONLY enclosing
// handler identity[15] for all29; dispatches/controls/other identities/helpers/
// imports stay exact. Renew these29 inspected literals only; no extractor,
// metadata, source digest, interactive.ts scalar or hostile-control change.
// Evidence: docs/evidence/e04-effective-terms-attribution-binding.json.
// This target metadata grants no Chat/Live schema, admission or execution.
// EXP04 original-recovery union, Oct24: AUTHOR-REVIEW / LOWER ASSURANCE.
// Exact pending producer d95794a2 and its123 dependency paths are retained.
// Prior E04 risk digest remains explicit; no other dependency digest is renewed.
// Removing only E04's static WRITE_TARGET row restores that entire Chat source.
// All29 baseline scalars reproduce; separate original-extractor decomposition
// changes only enclosing-handler identity[15], with all branches/controls/other
// identities/helpers/imports unchanged. Renew these29 literal scalars only;
// extractor, metadata, source digests and hostile controls are byte-preserved.
// docs/evidence/e04-effective-terms-recovery-union-binding.json. This is no
// admission/activation grant; original2697 must release before its E04 consumer.
// EXP04 actual released expiry union, Oct24: AUTHOR-REVIEW / LOWER ASSURANCE.
// PRE-RENEWAL source review6383068164; actual main2b14/source527/leaseaa794e53.
// One E04 static WRITE_TARGET row inverse restores entire released Chat.
// Original extractor reproduces29 baseline scalars/all124 source paths; only
// enclosing-handler identity[15] changes, no branch/control/other identity/
// helper/import drift. Renew29 reviewed literals ONLY; prior E04 HIGH risk
// digest and all other123 dependency digests/metadata/validator remain exact.
// docs/evidence/e04-effective-terms-recovery-union-binding.json. No admission.
// EXP03 S1e campaign leads read (2026-10-24), AUTHOR RENEWAL pending independent review.
// Renewed twice: first against main 5ff2e58825, then re-renewed after rebasing onto main
// ef1a6cfb9 (E09's chat changes had re-renewed the same pins mid-flight; the rebase kept
// main's pins and a fresh pass recomputed all 29 against the merged chat blob). The only
// paige-ai-chat changes beyond main are the read_campaign_leads additions (import of
// readCampaignBriefLeads, one dispatch branch inside the campaign-brief chain with the
// chain condition extended, one label case, one status line). Third and fourth passes renewed
// all 29 after the dossier-path fix and the disclosure-wording fix each moved the
// enclosing-handler identity (the round-2 reviewer's mechanical check caught the first
// staleness; an earlier local run without the full test was a false green). The final
// renewal verifies per tool that the branch and main import IDENTICAL relative modules.
// All 29 base pins were reproduced before each write (scratchpad exp03-c0b/renew);
// every dispatch literal is unchanged and only the enclosing-handler identity moved.
// Renew these 29 fingerprints only; extractor, metadata, dependency pins and hostile
// controls remain exact.
// EXP05 bounded Calendar agenda: immutable source8d811f8393 / Rootd55b8e95,
// AUTHOR-REVIEW / LOWER ASSURANCE ANT161/73fa1612 before exact renewal.
// All29 aggregates differ only at enclosing identity[15]; renew2 Calendar source
// digests only. Preserve125 paths/123 other values, validator/metadata and E04/E08.
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
    // 2026-10-28 EXP06 hosting door: renewed because two additive WRITE_TARGET attribution
    // rows (growth_hosting_*) land inside the canonical authentication prefix this fingerprint
    // covers. Dispatch logic, identity and authority unchanged; recomputed with the proof's own
    // inspector on the exact head.
    "fingerprint": "c9ff71a76354595792719dabe8cb48fe8483344e30fd017c6c4ed7be4139c0d5"
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
    "fingerprint": "b3762c46c35d693414669b6a9ee189db64f6c09863b013b4a8208f2002ff8f36"
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
    "fingerprint": "8f750f52af4dfad439eb46806fe62653aa3d1a4366e592d914b9a193bcf26246"
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
    "fingerprint": "16d2fdbea1f6e45f005cf21288a2b840c6fe6b6d54c262c6d76bdc04307528ad"
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
    "fingerprint": "1a482d88ec901f54d8e42b69e97e3e271ab86fda3514b19444f1d76aabc2dce3"
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
    "fingerprint": "7c6aaed3e0d22aa6332fe2f8fd49b259c19499c0e9332064017bb5c2d5d9aac8"
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
    "fingerprint": "35cb7d4cd4e8d0044b8672d6ed22b337c12cb84b8def09f3d98bafa038dd89bd"
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
    "fingerprint": "85f236e691e41ff0a3cfddea805ce8df7543a29def60ec282f61817f2cddf9bd"
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
    "fingerprint": "61245fa5da231ceb550e04f5e49812a6a571bfd912f307ece7bc75a719a91a5a"
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
    "fingerprint": "61245fa5da231ceb550e04f5e49812a6a571bfd912f307ece7bc75a719a91a5a"
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
    "fingerprint": "c433924e3c61dd2a4874c506249102e2b1919258cb04e3e99b1ac61bf5c6359a"
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
    "fingerprint": "89a369438f3933db3e00260492e5ee4d02a8e0b13dbd89a2c410b79372310f90"
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
    "fingerprint": "aaae222760554eb7c7fa89f69539c47e3bae7ed859d70b8311c476733d6e7f75"
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
    "fingerprint": "e5459514d60b4c1a8f722d53951f46c6d9ad2714c54c076478eca67612a9eeab"
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
    "fingerprint": "c4221bbeb4e28a2a3e6cc84f690dd27478c58f903e7388566ec8636e4c3a591a"
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
    "fingerprint": "68afeb653403d21120623100a3a92fccc909524100d7b3bedbd7a05ce9bf0647"
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
    "fingerprint": "7fffa0df578790d0bdccc8fb90c9ab9c241a7bd70bb7607c6030a4aa2d9b44f3"
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
    "fingerprint": "6936757599fa08248f6893d6721942cda96a69f66185ca697b039aed8c5b718b"
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
    "fingerprint": "6bef0a25b55b30a51329a4c3aee1d8b8f7ab0968457c992e1216d8104e7c1910"
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
    "fingerprint": "0cc76e75828287a3b2a8ba1aa9c1f92e6701eb0e84857f40f2401e9e5d3fd1fb"
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
    "fingerprint": "0ce2ecab96366b1cb64afde72db96306b1514d880e4c6db067b643768ebfaf66"
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
    "fingerprint": "7555d8a5804a33c8cc37e6a073e78c358d0ca91ab94170d18f505826c3f6b9aa"
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
    "fingerprint": "520bcefa78124750b7bcada6cbb8c269ac229a79071dec9b75464fd62f7bfc59"
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
    "fingerprint": "67eb832388b666da8725d66c22891b72f25ca443957a52f82084e7aabd67124c"
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
    "fingerprint": "ebab5df3081077b1bc51f31a8f671e5b668ef4b9d042e84bc8b363e4226e68bc"
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
    "fingerprint": "50536fe4d0047807bf9fac55fb430fb4f8215ea1e793a25f9ce6c9ce1b5b4443"
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
    "fingerprint": "acd372736f1c3f65e436184b041e9a59d566a6e95ceb4f03b875be40f2579d1d"
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
    "fingerprint": "971fa161cf2fe42dafb439360b6ed570e1a8e9680014b6a7fdfb6d612bb645cd"
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
    "fingerprint": "4405569d67291fade56b8b44899bfc80dd378294a3b4ef780d058599932bf332"
  }
};
const SOURCES = {
  "supabase/functions/_shared/paige-orchestration/weekly-draft-deadline.ts": "9603cb202bee4ccd0daad1f306dd24deff9c65fda8a69df7f46424167be5c42d",
  // EXP05 mandatory-confirm catalogue projection, reviewed e20298af0 / original sequential review.
  "supabase/functions/_shared/paige-spine/domains/automations.ts": "dba9a2bbf012b3e5430509463972a87e77b7be4be08b53a7479714e01bf3f9af",
  "supabase/functions/_shared/workspace-authority.ts": "b5fb2d35bf32fd4280f9e7e2c53488e6a0d4248cdbd42a5beb67ea91d18d5fc1",
  // EXP03 unconfirmed-send (2026-10-27), AUTHOR-REVIEW / LOWER ASSURANCE: mapSendOutcome reads send-message's
  // new outcome_unknown explicitly (SendGrid has no idempotent replay), and sendCalendarLink's note for an
  // outcome_unknown says it may have reached the contact and must not be sent again (it said "NOT sent").
  // Gates, reads, send seam and the other outcomes unchanged. Old 28748e31… reproduced from b39fda02 first.
  // EXP03 (2026-10-27), AUTHOR-REVIEW / LOWER ASSURANCE: the three `if (!share.ok)` guards read
  // `share.ok === false` so the shareability union narrows under the app's strict:false typecheck (CI tsc
  // ratchet). Same branches, same returns; prior ac47de4e… reproduced from 739b2fa6 first.
  "supabase/functions/_shared/calendar-link-tenant-brain.ts": "77a50c2cc43bc05df9164b63941943fe0ff9d6b33d03c4eb3ce70b92ac525f66",
  "supabase/functions/_shared/client-seat-reply.ts": "6b2ed9c2342da886f8dff44a46bc9dadd4bcd3b079839f62b470ea363564b44d",
  "supabase/functions/_shared/outbound-draft-check.ts": "eda79597ac86a489f916075844f535fcf228518d953b48c55b2e9901920ee961",
  // EXP04 C20 source review, AUTHOR-REVIEW / LOWER ASSURANCE at5ba2664f.
  // One explicit HIGH row for the UI-only exact signed-terms act. Removing
  // that row reproduces the original risk source,122 pins and29 dispatches.
  // Original Chat/extractor/metadata/all other pins and hostile controls stay.
  // docs/evidence/e04-effective-terms-risk-binding.json records this boundary.
  // 2026-10-28 EXP06 hosting door: canonical delta is TWO added `high` rows
  // (growth_hosting_deploy/growth_hosting_recover) after the studio_image keys — no existing
  // row touched. Renewed with the proof's own printer (removeComments).
  "supabase/functions/_shared/action-risk.ts": "cb0a549c4d5c8d401c16c8087b0e4d28032dedaff355f86934e2242f106a4956",
  "supabase/functions/_shared/finance-gate.ts": "dfa7fbec065d346ca72199313294a4418aa8be66f3dbb68cfe991a93aef0cf40",
  "supabase/functions/_shared/paige-capability-status/projection.ts": "280c36a53ed5d553f6e6467f7177d049a2c612078cdb8d8139878cec3463922f",
  "supabase/functions/_shared/paige-capability-status/readiness.ts": "56b0a8da8b1a76414a147d15bffb9b589b9bcf9e130c797290b846759e1da65e",
  "supabase/functions/_shared/paige-capability-status/render.ts": "63a15351e4f7af98544082c421c35af5d9eba2002d54150b2756b255bd131c58",
  "supabase/functions/_shared/checked-write.ts": "455d00e06fc6e84479ff8d0d5782288d21e4570d63d8e2e0acf770a5a8d5e95c",
  "supabase/functions/_shared/untrusted-fence.ts": "fc0ed34f9c564e4669b187a106756e860383ede74ae2bbb60f4b0a3944c7bf12",
  "supabase/functions/paige-deep-research/index.ts": "a96323d61924dba10329189fd98c56d2638c0fdc79e9a83a28ad352b0043bbd6",
  "supabase/functions/paige-web-search/index.ts": "2606664401bb71708fe798afab7f1166648083131d1ccfa06f9123d1629b0dd2",
  "supabase/functions/_shared/research-source-policy.ts": "df0ca1d9f4ee256051ff51927500b25b5fd071a057a6d868c6448f6f852e144b",
  "supabase/functions/fetch-url-content/index.ts": "4e10fe5cd2e189ced5c0cf929586626297b7c9653b34f8a109eede4b88d2926b",
  "supabase/functions/kb-ingest-doc/index.ts": "09c54913f8c844a0e7bb2826947cb002496fb800c34d2e46ae0f6a3f5a0ea7a7",
  "supabase/functions/comms-search-numbers/index.ts": "828ac020a9c984a808e3c9375748f1762a8667bd5a9da1c81d1fac902782d4f8",
  // Purchased-number voice wiring (2026-10-28), AUTHOR-REVIEW / LOWER ASSURANCE before renewal: the
  // handler now builds the number's inbound voice webhook with the existing voiceTwimlUrl(secret)
  // helper (the one repair-voice-twiml-app stamps), refuses needs_config/voice_twiml_url_unavailable
  // BEFORE any buy when it cannot, and passes voiceUrl to purchaseNumber. Authority, tenant derivation,
  // price verification, audit and record exits are unchanged. Old 23f47973… reproduced from 4fb4b0398.
  "supabase/functions/comms-purchase-number/index.ts": "34a2ed1199818913b5e861be571095cbc3a212adb3f5062a33060e48f7a921e4",
  "supabase/functions/comms-a2p-draft/index.ts": "49bd8acc5ed4ec7d60ba79b917438ae5eba0ce2ffcbf862baa9caa56293ada29",
  "supabase/functions/paige-write-back/index.ts": "5ff11463820b7c38e69f683cbcd8542359d5a72c37724c06846bf3dcc6d41de8",
  // EXP05 durable-outcome review a5f5e38ce, AUTHOR-REVIEW / LOWER ASSURANCE.
  // Registration must precede dispatch; exact saved outcome/receipt acknowledgment
  // gates actor-bound completion; original actorless ActionBus drafts retain their
  // receipt exclusion without an invented identity. Same-ID uncertainty, no replay.
  // Original a8d0324d digest reproduced; only this source changed/held. All peer
  // pins, actual authority, adapters, registry, providers and verifier rules retained.
  // EXP05 separate AUTHOR-REVIEW / LOWER ASSURANCE, October23: ZION's
  // original soft draft uses Model Fabric with fresh context/registry checks on
  // each leg. Exact-service actorless ActionBus drafts retain their original
  // identity/receipt exclusion. Original f319 digest and all122/29 reproduced;
  // only this reviewed producer changes, no extractor/dispatch/peer-pin waiver.
  "supabase/functions/paige-orchestrator/index.ts": "837d77bc04d622c63e2b9269326f6c234cdaacd5a1555ae2e8c2167ca029d723",
  "supabase/functions/subagent-forge/index.ts": "1acb5488f11bd93a2d6b36638fddcd73323f4363eacbd58b284d1fa648b3d906",
  // EXP00 comms-door renewal (2026-10-19), AUTHOR source review (NOT non-author; an independent reviewer
  // must confirm): branch zcod/exp00-comms-door-content-order changes send-message/index.ts in ONE hunk —
  // the SendGrid arm's content array reorders text/plain before text/html (one comment line added, one
  // spread line moved). SendGrid rejects html-first with a live 400 ("If present, text/plain must be first,
  // followed by text/html, followed by any other content"), captured on the welcome delivery 2026-10-18;
  // same fix class as send-transactional-email #2369. Provider payload construction only: no dispatch
  // branch, authority, verifier, adapter selection or recipient logic changed; paige-ai-chat untouched,
  // so all dispatch fingerprints are unchanged. Old canonical digest 29306707… reproduced from main
  // before renewing (scratchpad /tmp/renew-digest.mjs, printer {removeComments:true}). Renew this digest only.
  // EXP08 Team Hub increment 3 renewal (2026-10-25), author source review, scope CONFIRMED by an independent
  // §39 re-reviewer on the same diff: branch claude/practical-davinci-ij8hb8 changes send-message/index.ts only inside
  // attachmentValidationError — two early returns of "attachment_not_allowed": any path containing `%`
  // (Storage's router percent-decodes object names, so `team%2Dhub/<id>` is read as `team-hub/<id>`), and a
  // case-insensitive first folder of `team-hub` (<tenant>/team-hub/ holds members-only Team Hub files). An
  // input refusal before any send: no dispatch branch, authority, verifier, adapter selection, recipient or
  // provider payload changed; paige-ai-chat untouched, so all dispatch fingerprints are unchanged. Old digest
  // 08ec0fe3… reproduced from 1dac06b8b with the same canonical form (TypeScript printer {removeComments:true},
  // sha256) before renewing; the new value was then confirmed by this file's own test passing. Renew this digest only.
  // EXP04 C45/E08 receiving AUTHOR-REVIEW / LOWER ASSURANCE: both whole
  // sender inverses preserve the complete reviewed agreement extension and
  // incoming Team Hub attachment refusals. Old08ec/E082eea/C451f8 reproduced.
  // This one explicit composed pin changes no validator, dispatch or peer pin.
  // EXP03 campaign SendGrid lane renewal (2026-10-26), AUTHOR-REVIEW / LOWER ASSURANCE (an independent §39
  // reviewer read the same diff and found no blocker): branch claude/great-heisenberg-u7kyd9 changes
  // send-message/index.ts in three places. (1) Before the H2 refusal, a service-role marketing send keyed
  // `ecr:<recipient id>` asks email_campaign_sendgrid_admit (migration 20271116020000) and is admitted to
  // SendGrid only when the database says so for this tenant and recipient; every other SendGrid send is
  // still refused. (2) That send's custom_args carry the tenant and the recipient id, and it asks
  // SendGrid to track opens and clicks. (3) An unreadable SendGrid answer for it reports outcome
  // "outcome_unknown" (the outcome union widened by that one value). No other dispatch branch, authority,
  // verifier or adapter selection changed; paige-ai-chat is untouched, so all dispatch fingerprints are
  // unchanged. Old digest 2405fceb… reproduced from main 3d541038 and from 146cf565 with the same canonical
  // form (TypeScript printer {removeComments:true}, sha256) before renewing. Renew this digest only.
  // EXP03 Resend retirement renewal (2026-10-27), AUTHOR-REVIEW / LOWER ASSURANCE (an independent §39 reviewer
  // must confirm): branch exp03-resend-retire-local. Production's Resend account was emptied 2026-10-26 (owner:
  // "I am moving EVERYTHING to SendGrid"), so every send through the old Resend arm failed. send-message/index.ts
  // changes in five places. (1) The email adapter's Resend arm is removed; every non-Gmail, non-SMTP email goes
  // through the existing SendGrid arm with SENDGRID_MAIL_SEND_API_KEY (never RESEND_API_KEY, never the admin
  // key). (2) That arm's From: a SendGrid connector's (H2-bound by the door/campaign admission) is unchanged;
  // every other goes through _shared/email/platform-sendgrid.ts platformFrom (mail.paigeagent.ai kept, a
  // business's own domain sent as notifications@ under its name, Reply-To defaulting to the old address); the
  // no-op X-Idempotency-Key header is dropped. (3) comms_email_reconcile is refused before any claim (no
  // idempotent replay, so a re-send could deliver twice). (4) A managed campaign send (`ecr:` key, service
  // role, marketing) gets the campaign lane's custom_args, tracking and outcome_unknown on an unreadable answer;
  // other sends with a message row carry tenant + message ids. (5) The missing-key string the comms classifier
  // reads is the SendGrid one. No authority, verifier, recipient, tenant gate or dispatch branch changed;
  // CORRECTION (independent §39 review, 2026-10-27): change (2) WAS an H2 change, not "H2 untouched" — keeping
  // any mail.paigeagent.ai From and remapping paigeagent.ai let a workspace admin's own 'resend' connector send
  // as another business's managed address or as PAIGE; fixed by the H2 renewal below.
  // paige-ai-chat untouched, so all dispatch fingerprints are unchanged. Old digest 2753af0d… reproduced
  // from b39fda02 (git show HEAD:… | TypeScript printer {removeComments:true}, sha256) before renewing.
  // Renew this digest only.
  // EXP03 unconfirmed-send follow-up (2026-10-27, same branch), AUTHOR-REVIEW / LOWER ASSURANCE: the campaign-only
  // unreadable-answer flag becomes providerUnconfirmed for EVERY SendGrid email (Gmail/SMTP and the missing-key
  // refusal excluded): the generic answer adds outcome "outcome_unknown" + `unconfirmed: true` (status stays
  // "failed"); the audit error is prefixed "delivery_unconfirmed:", a released row's error is
  // "delivery_unconfirmed", and a direct send with a contact/connector gets one thread row marked the same
  // (both status CHECKs admit no "unknown"). No authority, recipient, tenant gate, H2 refusal, provider payload
  // or dispatch branch changed. Prior value 72f6da30… (above, this branch) reproduced before renewing.
  // EXP03 H2 + review-fix renewal (2026-10-27, same branch), AUTHOR-REVIEW / LOWER ASSURANCE (an independent §39
  // reviewer found the H2 hole and must confirm the fix): (a) H2 — every non-SendGrid-connector From is the
  // business's data, so the adapter uses platform-sendgrid.ts tenantFrom: a mail.paigeagent.ai From is kept ONLY
  // when it equals THIS tenant's own managed address resolved server-side (tenant_sender_identity's address and
  // its active tenant_email_identities row, for the derived tenantId; never a connector field); everything else,
  // including any paigeagent.ai address (never remapped), sends as notifications@ under the business's name, and
  // the Reply-To fallback never points at paigeagent.ai. (b) A row already marked delivery_unconfirmed is refused
  // (outcome_unknown + unconfirmed, no provider call) after the §9 tenant gate and before the provider floor;
  // the message read adds the `error` column. No authority, recipient, tenant gate, H2 SendGrid-connector
  // refusal or dispatch branch changed. Prior e6fc6c24… reproduced from 0999a6a3 before renewing.
  // EXP03 O12 piece 1 renewal (2026-10-27), PR #2997, reviewed by two independent §39 adversarial reviews
  // (round 1 + round 2, both on the real diff): send-message/index.ts changes in four places. (1) The door
  // path accepts the internal comms_email_scheduled_release flag only with comms_email_operation_id, never with
  // a reconcile, and releases a bound 'queued' row only when binding.send_at is due (60 s drift tolerance; the
  // database claim's not_before is the authority); a bound row with send_at is refused without the flag and the
  // flag on an immediate binding is refused. (2) parseCommsEmailBinding parses an optional send_at. (3) The
  // generic scheduled_binding block and terminalizeScheduledRelease's direct row writes are skipped for a bound
  // row (it is closed through the finalizer). (4) Nothing else: no authority, verifier, recipient, tenant gate,
  // provider arm or dispatch branch changed. Old e1c22250… reproduced from main 9e325d91 first.
  // EXP03 O12 piece 2 renewal (2026-10-27), governed email attachments, reviewed by two independent §39 adversarial reviews (c6276d507, then the follow-up 090d85257; no TOCTOU, no cross-tenant read; round-1 M1/M3/M4 and the LOWs fixed; H1 fixed on the card, though no product surface produces a file send yet; round 2 found no new HIGH) — the follow-up's delta in this file is listed:
  // send-message/index.ts changes in four places. (1) parseCommsEmailBinding parses an optional
  // binding.attachments with the shared strict manifest parser (governed copies of THIS tenant and operation
  // only); anything else marks it "invalid". (2) Before the claim, a binding with files is refused through the
  // existing unclaimed finalizer (COMMS_EMAIL_ATTACHMENT_CHANGED with zero storage reads when invalid;
  // COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED unless binding and connector are on the SendGrid arm), else the
  // governed copies are read with the service role, re-hashed against the binding and handed to the adapter as
  // ctx.governedFileAttachments. (3) The SendGrid arm sends those as attachments; the Gmail and SMTP arms refuse
  // a send carrying them before any network call, classified failed/COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED.
  // (4) Nothing else: the door-path refusal of body.attachments, serverAttachments, the invoice PDF path, the H2
  // refusal, authority, recipient, tenant gate and dispatch branches are unchanged. Old fffd0a7f… reproduced from
  // main 0fcd5a331 first.
  "supabase/functions/send-message/index.ts": "0acfd997a123d5b73cc3a5fb13a1dff2d841f5d8ae9f17e86147bd0bfbc5ae82",
  "supabase/functions/_shared/paige-spine/contracts.ts": "2d771686d636c04d2e07d9b8c336e19cde246b9a303ddd034d7ae8500f7eefb4",
  // Operator retirement adds opt-in timeout/no-retry controls; ordinary callers retain
  // their existing behavior. Renewed non-author review and actual retry controls are
  // recorded on PR #1897; no other incumbent snapshot is regenerated or accepted.
  // Purchased-number voice wiring (2026-10-28), AUTHOR-REVIEW / LOWER ASSURANCE before renewal: the
  // only change is purchaseNumber — PurchaseNumberOptions gains optional voiceUrl, and the form body
  // gains VoiceUrl + VoiceMethod=POST when it is set (omitted otherwise, so no other request changes).
  // No other function, auth path or request shape is touched. Old afe6b57d… reproduced from 4fb4b0398.
  "supabase/functions/_shared/twilio.ts": "3b6fe3eeb8c6e4211e82012d08f63b5d8b14811ee780fef19eaa735b6c5d0b1d",
  // SendGrid Inbound Parse (2026-10-27), AUTHOR-REVIEW / LOWER ASSURANCE: the inbound registry gains an
  // optional provider qualifier — InboundChannelAdapter.provider?, a `channel:provider` key when it is set,
  // and getInboundAdapter(ch, provider?) — so handle-inbound-email can register its SendGrid adapter beside
  // Resend's unqualified 'email' one. An adapter without `provider` keys exactly as before (bare channel), so
  // every existing register/get call resolves the same adapter. Outbound registry, NormalizedMessage, Delivery,
  // OutboundSendContext and buildListUnsubscribeHeaders are byte-identical. Prior f29fe750… reproduced from
  // db0048ad7 (git show | TypeScript printer {removeComments:true}, sha256) before renewing. Renew this digest only.
  // EXP03 O12 piece 2 renewal (2026-10-27), same review: channel-adapters.ts ADDS one optional
  // OutboundSendContext field, governedFileAttachments ({content, filename, type}[]), read only by the email
  // adapter. No existing field, adapter contract or registry function changed. Old dc0cfccf… reproduced from
  // main 0fcd5a331 first.
  "supabase/functions/_shared/channel-adapters.ts": "515ad56691be9b00b9cd894f53522236a23e78efba40b20adb0806fc6df15984",
  // E09 Slice 6 bounded renewal (2026-10-18), integrating-crew source review (NOT non-author):
  // the only change vs main is one added `case "customer_request"` in suppressionReason (the plain
  // sentence a portal opt-out returns). Step order, every block/queue condition, the consent channel
  // list and the normalizers are byte-identical. Renew this one scalar only.
  "supabase/functions/_shared/pre-send-pipeline.ts": "dd7193c8f9663462f045de0eb937c6cf728a1c0ce0dce6451f4fa4cc9fd545b6",
  // SendGrid Inbound Parse review fix M4a (2026-10-27), AUTHOR-REVIEW / LOWER ASSURANCE: adds
  // lookupClientIdByAddress (same client_id_for_address RPC, same log line, but returns the error instead of
  // reading it as "not found"); findClientIdByAddress now delegates to it and returns its `.id`, so every
  // existing caller (voice-twiml, public-booking, handle-inbound-sms x2, paige-mcp, growth-inbound,
  // handle-inbound-email's Resend arm) gets the identical value and log. No other helper changed. Prior
  // cea64c7f… reproduced from 5134fc4ec (git show | TypeScript printer {removeComments:true}, sha256) before
  // renewing. Renew this digest only.
  "supabase/functions/_shared/contact-methods.ts": "62ad629140b6feb5c096c45c878bc3b94b6383375202810955bff7409198bd3b",
  "supabase/functions/_shared/internal-vocabulary.ts": "9074425cc61d1a678e3a4ca03595fe8c4d1eac4572a4bd2daf31aff77f39d37a",
  "supabase/functions/_shared/paige-capability-status/resolver.ts": "ec8a5dad7df3426f30203aa1c8014372a60f51ed0decc829fc8541fba62a4142",
  "supabase/functions/paige-deep-research/fabric.ts": "23fd093b20d6f721ff07619aa5a4e34892d5346fd6b4934e0ae73fffb0b609bb",
  "supabase/functions/_shared/reasoning/strategize.ts": "ace59eadcd60f18c8fa673002626a5fe869099acdc8dd704c71c9b7aa9b3b46a",
  // EXP10 PR14 (2026-10-26): the DNS-phase deadline race in safeFetch — a deadlineLoser promise
  // rejecting on abort now races assertPublicHttpUrl, so a never-settling resolver can no longer
  // hang the call past its own timeout. Nothing else in the file changed (guards, reasons,
  // redirect refusal and size caps byte-identical; pinned by the new 8-test suite). Old pin
  // ab192431c1d51594a551184bc0e029a2a47a96a408f9f5935e0e13c8bbfe4db8 reproduced from main with
  // printer {removeComments:true}+sha256 before renewing. Renew this digest only.
  "supabase/functions/_shared/ssrfGuard.ts": "656797b1b724d61b766a88787a803286bf56637050d8d8e715b3310628d51490",
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
  // E09 Payments round 3 (2026-10-18, pin ec72c112…466b): presentation only. A projection carrying the
  // portal-only test_provider_cents / provider_environment keys tells a TEST receipt as a test that moved
  // no money and does not name the processor; it refuses a test total that contradicts the evidence.
  // Owner and bearer projections carry neither key: 225 rendered fixtures compared byte-identical
  // before/after. NON-AUTHOR REVIEWED: the round-3 verifier (not the author) reviewed this change and
  // found it presentation-only and portal-keyed (only client_portal_invoice_ledger produces those keys;
  // sales_provider_receipt_shape makes every provider receipt a 'receipt' with environment test|live),
  // with nothing to block; 60,000 random owner/bearer projections byte-identical to base dbb8a8842.
  // E09 Payments round 4 (2026-10-18, pin 3288d97e…e4c8): presentation only, portal-keyed. On a portal
  // projection a voided invoice shows "Nothing owed: this invoice was voided." in place of the outstanding
  // figure, the outstanding equation and the Outstanding column, and the payment notes name only the money
  // present. NON-AUTHOR REVIEWED: the round-4 verifier (not the author) reviewed this change and found it
  // wording-only and gated on isPortalProjection (owner/bearer output unchanged in its own 60,000-case
  // fuzz against base dbb8a8842, two control mutants biting), with nothing to block beyond its finding 1
  // (a fully corrected payment read "No payments recorded."), which round 5 fixes.
  // E09 Payments round 5 (2026-10-18), reviewed by a non-author verifier, round 5 (nothing to block):
  // presentation only, portal-keyed (paymentEvidenceCopy's
  // isPortalProjection branch). "No payments recorded." only when the ledger shows no receipt; without a
  // ledger "No payments count toward this invoice."; a fully corrected payment says "Recorded payments
  // were corrected; nothing counts toward this invoice."; business-recorded money has one name
  // ("Business-recorded payments") and the box says when its totals are after corrections. Owner and
  // bearer output unchanged: 240 fixtures byte-identical to the round-2 renderer and 60,000 random
  // projections (24,489 rendered, 10,829 of them void) byte-identical to base dbb8a8842.
  "supabase/functions/_shared/sales-invoice-document.ts": "5ae255569a861722b09868da12dac1e43c104a593d3f3cb0c16f29e47eb55649",
  "supabase/functions/_shared/document-pdf.ts": "e88f697d5d79af5feb0d6952fc5029633d488434b232798bc42fffd0fccd9a8e",
  "supabase/functions/_shared/email-attachments.ts": "becc41d2968a75ba07c1ec077c142f625ccb0239f5dd3423073dbbbe0186069e",
  // EXP03 Resend retirement (2026-10-27), AUTHOR-REVIEW / LOWER ASSURANCE: one fact's source key changes,
  // resendConfigured now reads the presence of SENDGRID_MAIL_SEND_API_KEY (a "resend" sender sends through
  // SendGrid). Shape, reads and every refusal unchanged. Old 8ea30924… reproduced from b39fda02 first.
  "supabase/functions/_shared/sales-invoice-delivery/readiness-reader.ts": "4d4620552e5912e0c37f546e23df0caf81024db37407eef411b6b1ce51b9926a",
  // E04 exact invoice navigation: independently compared incumbent route outputs; authority unchanged.
  // E02 AUTHOR-REVIEW / LOWER ASSURANCE: add UUID-only Play focus beside current
  // invoice/Deal/Task routes; all existing route entries and authority remain unchanged.
 // E02 #2467 AUTHOR-REVIEW / LOWER ASSURANCE: only an additive SOLO Conversations
 // destination/type entry; resolver, account/actor gates and exact-focus map unchanged.
 // Renew this helper alone; keep all dispatch pins and the route-mutation refusal.
 // E02 #2481 AUTHOR-REVIEW / LOWER ASSURANCE: additive SOLO Marketing type/route
 // only; current-account/actor gates, prior routes and focus map unchanged. Old
 // 492e6c96 digest reproduced from main; all29 dispatches and other115 sources match.
 // Renew only this inspected helper; extractor/metadata/route refusal stay exact.
 // EXP09 #2492 bounded renewal: source1c88645ce / composedbe57dd5fc
 // NON-AUTHOR source review5604204248: additive current-SOLO Portal Knowledge
 // route and UUID source focus only; original routes/account/actor gates unchanged.
 // Prior f3336677 digest reproduced from main2a799. All29 dispatch pins and
 // other115 dependency sources pass unchanged; renew this inspected helper only.
 // Extractor, metadata and route-mutation refusals remain restrictive.
 // EXP02 mounted finding review, AUTHOR-REVIEW / LOWER ASSURANCE:
 // only the existing SOLO systems_check destination gains UUID finding focus.
 // Original actor/tier/account/path validation and all other routes stay exact.
 // Restoring main8e97's route helper reproduces old636e digest, all120 sources
 // and all29 dispatches. Renew this reviewed helper only; extractor, metadata,
 // dispatch scalars and other119 accepted dependency pins remain unchanged.
 "supabase/functions/_shared/canonical-app-url.ts": "abb26a5acdf4569d308610d8827145a93e103f3b1f5a71e56b8aca75cc685658",
  "supabase/functions/_shared/gmail.ts": "78f697e312d18eb9d73ff2a3802142003a843b109f5e2a956182befb5d6160ff",
  "supabase/functions/_shared/smtp.ts": "0e3ea569f3728dde3329bb5281ef0afb9d592a4f080b3535b2bb7da62799f5ff",
  "supabase/functions/_shared/sales-invoice-delivery/binding.ts": "4e95a90d3a145278d3cb27f64865d26dc968d1c8cf7937dea2feac584e307b77",
  "supabase/functions/_shared/agreements/token.ts": "793e1c0a521fc0ea3b39e5761f87cdad7fee67a73b2110ac1f2963992b20eeea",
  "supabase/functions/_shared/model-fabric.ts": "f4ac35c621fa233f287f897d86dfc289f7c1b7f9235bfe411832c35a9c1c4224",
  "supabase/functions/_shared/llm-trace.ts": "d8da0ed275f3c533afe35b92f7f182238443a9e93834ea885041a85f87629dd9",
  "supabase/functions/_shared/prompt-forge.ts": "0abdeb7a887ac7b566dd8f21c11140122985d2acf0b5b6020596974ffd3e11ee",
  "supabase/functions/_shared/voyage.ts": "4eb1a516b2ce4679e83bfa62bb908a4b2e3be4d48dcdc89df75bb160bd6569b2",
  "supabase/functions/_shared/claude.ts": "cfbb18ce156d2259bf1904d6f6eaed8262e007c70929958c7261f185e20747ff",
  "supabase/functions/_shared/router-budget/mod.ts": "9b12ac32282e4223238688feef1d3e384406e9d9e1378fc94c9d937d7d6a20c4",
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
  // EXP03 Resend retirement (2026-10-27), AUTHOR-REVIEW / LOWER ASSURANCE: readCommsEmailReadiness's
  // resendConfigured fact reads SENDGRID_MAIL_SEND_API_KEY presence instead of RESEND_API_KEY. Decision
  // function, result shape and every reason unchanged. Old 325b6bae… reproduced from b39fda02 first.
  // EXP03 O12 piece 2 renewal (2026-10-27), same review: readiness.ts — readCommsEmailReadiness adds
  // sender_provider (the chosen connector's provider name, never a credential) to a READY answer only, and the
  // CommsEmailReadiness type gains that optional field. Every state, reason and read is unchanged. Old 035c108e…
  // reproduced from main 0fcd5a331 first.
  // EXP03 scheduled send during the business's do-not-disturb (2026-10-27), same review: readiness takes an
  // optional `scheduled` flag; when set, ONLY the business's own do-not-disturb hold (queued_tenant_dnd) stops
  // holding the check, because the drainer re-runs every pre-send check at release. Suppression, consent,
  // client do-not-disturb, quiet hours and an errored check still refuse. Every other state, reason and read is
  // unchanged. Old e2790d93… reproduced from main 5a4bfb1f0 first.
  "supabase/functions/_shared/comms-email/readiness.ts": "8bfab4b5fe9453736b8f68b82d76434cc9884e9ea39583d7d32e97454affba5f",
  "supabase/functions/_shared/openai-models.ts": "a76ac476a2cbd298421a9d7d37f3605cf384e4a4e53a1635719405d52e70905e",
  "supabase/functions/_shared/openai-responses.ts": "bec9943dcb725b592cdba219a5e349f14bcf1f259adbc17522fceb5c6fe0ec81",
  "supabase/functions/_shared/provider-failure.ts": "3a3507a6ddc6f6e5051a5d17b7a5ff30624643c6bd39d07793224eb0177873b5",
  "supabase/functions/_shared/paige-turn/route.ts": "657f0c9ee1d3724a5eca72f661718d560e090cd7ee36707cadbbf94f1f463d6e",
  "supabase/functions/_shared/brand-tokens.ts": "225f25c0ed74155012b7959766adfe51d4fd8c8341ad7da57c26b650caad06ca",
  "supabase/functions/_shared/cheesy-tells.ts": "7710d88a2999f0ab23870ff22f9ce46999d35d598982ce7f517a7fea0f4fab9a",
  "supabase/functions/_shared/claude-models.ts": "026a3b83753bd302319a1f671cfb560bb788c96b4f27bc44222cd6650fcc34fd",
  // EXP03 O12 piece 1 renewal (2026-10-27), PR #2997, same two §39 reviews: contract.ts ADDS
  // parseCommsEmailSendAt (whole minute, 2 min–30 days at proposal, format-only at confirm) and
  // COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS. The command, its keys, commsEmailBodyHtml and the content digest
  // are unchanged. Old 733eb988… reproduced from main 9e325d91 first.
  // EXP03 O12 piece 2 renewal (2026-10-27), same review: contract.ts ADDS the attachment limits (10 files,
  // 10 MiB each, 10 MiB together — the follow-up lowered the total from 15 MiB), COMMS_EMAIL_FILE_PROVIDERS
  // (sendgrid, resend), parseCommsEmailAttachmentRequest (server-tenant composer paths only),
  // commsEmailAttachmentName and commsEmailGovernedAttachmentPath. The command, its keys, commsEmailBodyHtml,
  // the content digest and the send-time functions are unchanged. Old 3fc25e77… reproduced from main 0fcd5a331
  // first.
  "supabase/functions/_shared/comms-email/contract.ts": "40208d3cc65b42150e162e4d062d33d23f244a68cb7c3b75d0494aa989a1e334",
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
 // Distinct NONAUTHOR037b review: bounded control transport parsing/classification only.
 "supabase/functions/_shared/paige-turn/control-transport.ts": "aa43597cddb240e6ce5e27f12be91e674ba3bb1235554d75852e4cda69bc0975",
 "supabase/functions/_shared/operations-task-read.ts": "97dea16d6415e8114342904f2270e8257f4e5ea31431192a2e6f7f3e5fa05c4b",
 "supabase/functions/_shared/inbox-intelligence/policy.ts": "12b8711f7ba6bc1acf3c41f8221be74c3ac92699584a48dc36d1e5c2311b21b2",
 "supabase/functions/_shared/calendar-booking-read.ts": "41e960e069a4f09655b49e7413cd939e19c91ad3ea451952fa1e3aa372953547",
 "supabase/functions/_shared/solo-classification.ts": "a4a7b91f4c8d36d56548f3096bd6e0ef70cafca12036bd6fb81444f8294e845a",
 "supabase/functions/_shared/paige-spine/domains/calendar_booking.ts": "ce2ab054fe80fe836e89aaf4c42677e52224d7ed01aedc1a2ac07ab5f26d6afe",
 "supabase/functions/_shared/paige-spine/domains/teamAuthorityChatEvidence.ts": "2e513de67adec189f65b7a29df2d8e1943ff3a4366f3833ec3a1534d6300262f",
 // Independently reviewed pure contact receipt reference; presentation only, no authority.
 "supabase/functions/_shared/paige-turn/crm-result-reference.ts": "9ed77f5d7459746d13d570ad8a627f3ab8c875ee2744edbc2a7626f0a7426427",
 "supabase/functions/_shared/client-portal-assistant-context.ts": "807be6a423b0b8e3925da34a19a473e93873973f54a60d50fb49d66c724bfc96",
 "supabase/functions/_shared/client-portal-progress-context.ts": "cbccd38b41cbd80d279cd3ce8227f73a3896a1a85fcd7ead5da897bfb2d4d596",
 // EXP09 Sessions exact customer-only review: all prior121 source pins and29 dispatch bodies/controls/helpers/imports preserved.
 "supabase/functions/_shared/client-portal-sessions-context.ts": "73ff54b458db614ab464f3d12f052eb33b39e3b78d7a7daccb4a359e05229ad0",
 "supabase/functions/_shared/client-portal-chat-scope.ts": "f9f0cc67e17097d3e3f3c817793550acd6d35ecf436965c04851c90254555433",
 // Cura identity review at36fd1031470aaaa1e0c0b364ecd57468b473bd2f:
 // only the customer name resolver/import and role wording change. Native
 // binding/policy/Knowledge/private-history guards are unchanged. Pin the pure
 // identity dependency too; no dispatch scalar or verifier logic is renewed.
 "supabase/functions/_shared/client-portal-persona.ts": "e6d4017abf1f50cfbb1da55cec4430f9d64465c8664220fd1013612c91f5c833",
 // E09 CURA round 4 (2026-10-19), AUTHOR source review (NOT non-author; an independent reviewer must confirm):
 // client-portal-identity.ts only. namesPaige sets aside a literal typed "Paiget" on the raw name before folding
 // (a superscript or look-alike t no longer borrows the exemption); the look-alike map gains lowercase keys
 // (Latin and APL alpha, Cyrillic ie and palochka, turned i, small capitals, Cherokee small letters) and drops uppercase keys
 // that never matched after lowercasing; a pure exported agentNameAsTyped (invisible-stripped, trimmed, 80 chars)
 // is factored out of customerAgentName unchanged. Presentation only: no import, dispatch, authority or verifier
 // change; paige-ai-chat is byte-identical, so the 29 dispatch fingerprints are unchanged. Old canonical digest
 // 55a91574… reproduced from HEAD f272b28ca before renewing (scratchpad r4-digest.mjs). Renew this digest only.
 // E09 CURA round 5 (2026-10-19), AUTHOR source review (NOT non-author; an independent reviewer must confirm):
 // client-portal-identity.ts only. INVISIBLE gains U+FFA0 (halfwidth Hangul filler) and readAs strips INVISIBLE
 // again after NFKC (U+FFA0 folds into U+1160); the look-alike map gains Cherokee small ꭺ ꮐ ꭼ, Lisu, Coptic,
 // Cyrillic ԍ ҽ, Latin ǀ ɛ ɨ ɩ ᵽ ƥ ꝑ ꞡ ɠ and a pure generated table of negative circled/squared letters. Header
 // comment narrowed to the listed look-alikes. Presentation only: no import, dispatch, authority or verifier change;
 // paige-ai-chat untouched, so the 29 dispatch fingerprints are unchanged. Round-4 digest b673eaf5… reproduced
 // from HEAD 270973a56 before renewing (scratchpad v4probe/c0b/dig.mjs). Renew this digest only.
 "supabase/functions/_shared/client-portal-identity.ts": "c04232c4e0967ee8e313da48387e481c57d92c8d67ae686d2792a99c7f658a67",
 "supabase/functions/_shared/paige-spine/domains/soloBusinessInterviewContext.ts": "ae869d9dbc131f0e6d48d3f34e6a5edc81fd22a095946fa06cf8b7393528b053",
 // E02 source review: the33-key literal moved unchanged into a pure dependency.
 // Reconstituting it into the reader is AST-identical to deployed892b1bdfe.
 // Pin BOTH reviewed files; no generated digest acceptance or effect guard waiver.
 // E02 AUTHOR-REVIEW / LOWER ASSURANCE: existing issuer cycle serialized; internal
 // evidence retains verified epochs, model projection still strips identity. No authority change.
 // E02 internal Marketing foundation: original33 public keys/schema/refusal retained;
 // existing11 originating producer keys only in verified internal evidence, with owner/kind/unit/period checks.
 // Renew only these two inspected dependency digests; Chat/29 dispatch scalars, extractor and metadata unchanged.
 "supabase/functions/_shared/analytics-metrics/read.ts": "8b423b4ceb27da109c88e4901512c98298f17a099a510f6b8add3fe68dbfc25d",
 "supabase/functions/_shared/analytics-metrics/keys.ts": "2334724562df2138494c0dbe28076840b81145a258d65c78667a5d3b86bf2400",
 "supabase/functions/_shared/analytics-metrics/metric-contract.ts": "8bbc6b91d259e2ab80643dd37667d88736043066e14d725bbca5344874d0c2a5",
 "supabase/functions/_shared/pipeline-original-discovery.ts": "4c55fee76bc2622a0b57b33282276f36aa3a8552725168c45ab1b2774b7e7fa9",
 "supabase/functions/_shared/paige-turn/outcome-status.ts": "1cfab94676e27a705b620e0a4401ed7712cab25b597bc233aaddcd4d638a1942",
 // Historical Research context and its pure status-result constructors.
 "supabase/functions/_shared/research-history-context.ts": "fa64f9d267b6f2196ae7ff754ef2660a918bcd6da79698700acbfc05222685b2",
 "supabase/functions/_shared/paige-context/mod.ts": "56fb44fcb3c78d6cf3a221290550b57694be6eb99e8eda608e610ddfc65dd6a8",
 // EXP05 AUTHOR-REVIEW / LOWER ASSURANCE, sourcea7961d9d/reviewf07a6b682:
 // retain only the original delegate invocation UUID in effect/receipt context;
 // wrong-tool/invalid references excluded, unknown outcomes unchanged. Original
 // c11ff157 reproduced; other122 sources/29 dispatches/validator remain exact.
 // EXP04 C20 shared-file write released by ANT161/48ebd0a0; preserve its scalar.
 "supabase/functions/_shared/paige-turn/interactive.ts": "2917df7c8f03806e63b5f38f4aa386d6df0a1ca6892028cf8384cf98646c74ff",
 // Independently reviewed canonical approval-status projection; no effect authority.
 "supabase/functions/_shared/paige-turn/interactive-approval.ts": "1fbe20d09c91d4082932a75cb8e52ecb6eaf11a0c516d3f2e0342469a3c9a870",
 "supabase/functions/_shared/planning/approved-reminder.ts": "2aa731c9f9c116955fb6a7a99a8c814ca0676464ee1fcfbe1b7780b373b68196",
 "supabase/functions/_shared/planning/original-reminder-outcome.ts": "f7ba277de16f284d0699fc4f9ab103f48bf8ea42cddf6f10c67102c2e9ffd0ce",
 "supabase/functions/_shared/paige-turn/interactive-reminder-history.ts": "84e35fd73307cf8172951fc1dcbf0b1064dd988cfb596ea95bc3ea7e244b4415",
 "supabase/functions/_shared/paige-turn/interactive-refusal.ts": "908219d36f0b49358553e4ea9e03a846f19b1f0995ef6b56e09295f1e1e7b240",
 // EXP05 exact original turn/authority/receipt reader, reviewed848abb406.
 // EXP05021b7f9e, sequential AUTHOR-REVIEW / LOWER ASSURANCE464d7e37:
 // one original eight-second read budget; all authority/origin/receipt checks
 // and the entire prior helper recover by undoing only its stage wrappers.
 "supabase/functions/_shared/paige-turn/interactive-specialist-history.ts": "307f88e1c25dbc04db4e1cf578b963206272b9cefe9e3ccdedf6e6b0ae354f6e",
 // Original record references remain URL-free, bounded and reauthorized at destination.
 // EXP02 source review, AUTHOR-REVIEW / LOWER ASSURANCE (ANT161/a22186d8):
 // only the two existing UUID-reference branches admit systems_check. Original
 // six-link cap, UUID guard, contact-only labels and URL/account/authority stripping
 // stay exact. Restoring main8e97's helper reproduces old8465 digest, all120 source
 // pins and all29 dispatches. Renew this inspected helper only; no extractor,
 // metadata, dispatch scalar or other dependency changes. Hostile controls retained.
 "supabase/functions/_shared/paige-turn/record-links.ts": "f382443f63dce366a255bc1b4fb20d7cc160787658ab97e84ea948e79204a728",
 // Original extraction input/acknowledgment validation remains authoritative.
 "supabase/functions/_shared/knowledge-extraction.ts": "458e778114b65959f35c5a65f1b371992faf199f6828d2928df8cb0c5435578d",
 // Original CURA history and strict native preparation adapter; native authority unchanged.
 "supabase/functions/_shared/paige-turn/interactive-cura-history.ts": "46578149462437bb3e1e5243277af11b5f7d251a345e75aece2efb020bf7ef88",
 "supabase/functions/_shared/cura-knowledge-teaching.ts": "b421c4302a7772d7b376a7ff99cd96691991593eb3ab1db31d1ac82a9825df87",
 // Exact non-author-reviewed generic-email C4b ancestry at a9de011b6;
 // proposal b4ebdf9d / review 8b83d5c5. Existing114 pins and verifier unchanged.
 // 2026-10-28 EXP03 chat scheduled email (review MINOR 5): renewed from dbcdf4de (reproduced from main
 // f1360cf2). doorResumeShape's comms branch carries a stored canonical send_at into the recorded call
 // and refuses a non-canonical one; every other branch unchanged.
 "supabase/functions/_shared/paige-turn/resume.ts": "41da840ec5b42ebd65e923fcb5c2cfa5310d7ba867e9b549139b3d31cc4cd22a",
 // 2026-10-28 EXP03 chat scheduled email: renewed from b2c63f53 (reproduced from main f1360cf2).
 // Adds only optional send_at: proposal passes it top-level (never in the command) and into the
 // operation id when present; an approved/pinned call replays the stored send_at verbatim; card
 // preview carries a canonical send_at and file names/sizes; "scheduled" and three send-time
 // refusal notes. Selection, approval lookup and every other branch unchanged.
 // 2026-10-28 review round 1: renewed from 4a71458d (reproduced from 025ff551). send_at description asks
 // for the offset on the TARGET date (no fixed example); "scheduled" never reads Not sent and points to
 // the card's local time; COMMS_EMAIL_ALREADY_SCHEDULED note. Nothing else.
 "supabase/functions/_shared/comms-email/chat.ts": "0bf1f64ec1d82e5ef435fdf06cf07fd8169e2853e3c5401eb1c8592b00d81608",
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
