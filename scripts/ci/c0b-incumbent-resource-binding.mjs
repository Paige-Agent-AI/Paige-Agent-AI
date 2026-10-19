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
    "fingerprint": "977946b648e121c3281058923140f7b630df6db877461fb759ba6f39fdac02bc"
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
    "fingerprint": "2cc88537b6ce863ed767d977ff7135f608bcc85e9c5ea9098f6fe799ecfa2d66"
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
    "fingerprint": "659febf70815f57c774a5d3e68ded57e9aba1bc274190b539854b92aeb8d4093"
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
    "fingerprint": "d33aae266148db9ec30970a5f654c01e1322c4143fc14306d464626bcade1479"
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
    "fingerprint": "aa63c193fe8a2ffd41a4e08c395fbc86b1fe545e2ce0a5e1f77b3c5782ddc56e"
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
    "fingerprint": "a7bb57c6a7d9d4f8f59bf934d175a9093f2406114c998ae819fe831008e5352b"
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
    "fingerprint": "285aded79412db3473d08d4b2aa8201d94428c653b0c29318887fa979f39c001"
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
    "fingerprint": "66bad68f2de685b7760757f306ec7a89e42bf6e0d5053d97bceefc7f55aa011f"
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
    "fingerprint": "b3c17759665facc3aabf706dbe501243728eeb767d9f343f591c52409281b73c"
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
    "fingerprint": "b3c17759665facc3aabf706dbe501243728eeb767d9f343f591c52409281b73c"
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
    "fingerprint": "816c9309195a40ee3d84d524896115cbf1fb4c446162dca9f54bf576b9faac6a"
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
    "fingerprint": "3aa8579fa9ca50b5ee913b53e786760d2db1666386ee0d91476c8a07e994fe25"
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
    "fingerprint": "382de7ee7c76ccdf7896dae728dd8ec21a8a194e6c44cd0dd41e78267ff868ed"
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
    "fingerprint": "08b1557eed06da18144b600bf1b8faab3d1b2ca5e0f9838fad3c0afaf018cbcf"
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
    "fingerprint": "32acc94974120879b6febefd56156b288164d44ab9e556f895f0bd500af744ba"
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
    "fingerprint": "feb7df0d574bc63cc5c560dc749d273eab27a63961018dcb1eff41309f41c5fb"
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
    "fingerprint": "bd65cd71b5b08bbf6bc370eac27ec3359d83b49143407299ecaebab76b9b996f"
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
    "fingerprint": "9a24f658ea10260e77e40e39c3c4911bfc1547088850f72ae215c5af071343c7"
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
    "fingerprint": "c4517ea8e58f1138ae11d75e91e406b9284363964f8505500e71f92e806c6991"
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
    "fingerprint": "deb31a9407a634bfcdd06feb18c4129a8f9363a5ca7f1d75796e07e560eab011"
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
    "fingerprint": "806346990c37005608e3e3ab89a9d8f56ac049bd2c3aed00f74a2c5f04396c80"
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
    "fingerprint": "d29ab101b1c6debcb6e1433f13aaa623a032ef9d84dc145e999a4934234aa009"
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
    "fingerprint": "3b252e41758216712d1f718ddf7a7e6d377f1af014a70f5da7257cef272abaa7"
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
    "fingerprint": "c1dc555f9a4cfedd8b04d4ce8ed2bcfcc0fe6e3b287893056a67372f7f057787"
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
    "fingerprint": "da4144fcdd7a7f73d300bccb5e47f04a775e58fe8981d98b7ca04e1e75da8a2a"
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
    "fingerprint": "946e62d37c323b55a7aba0d7e3818e9d1cb16d89b8c41aba5bf2a52f7c641787"
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
    "fingerprint": "cea6365c2871d2f7018ec1bcf0c68e5af68e83e53315bc18ce5fb3b6eafc5ff9"
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
    "fingerprint": "0bd753807ffa143b136b233252559017979ce88f5b312faf18fa5e8d2252ac6a"
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
    "fingerprint": "6e30809dcd458221118bd8fadc438b49d0010ce25bb913565ed1659175fef792"
  }
};
const SOURCES = {
  "supabase/functions/_shared/workspace-authority.ts": "b5fb2d35bf32fd4280f9e7e2c53488e6a0d4248cdbd42a5beb67ea91d18d5fc1",
  "supabase/functions/_shared/calendar-link-tenant-brain.ts": "28748e315a12caa855ec906192743cdad5298d37ccbd35ad83539949124800f4",
  "supabase/functions/_shared/client-seat-reply.ts": "6b2ed9c2342da886f8dff44a46bc9dadd4bcd3b079839f62b470ea363564b44d",
  "supabase/functions/_shared/outbound-draft-check.ts": "eda79597ac86a489f916075844f535fcf228518d953b48c55b2e9901920ee961",
  "supabase/functions/_shared/action-risk.ts": "a7c036942209d81c2b46dd5855bb21f69ec9ed69bf35d239e4aea3d8e50d6a3a",
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
  "supabase/functions/comms-purchase-number/index.ts": "23f479730d2b658fe231dcbe33e3fcd864ec07e9f87ce116742f83e84c8e9237",
  "supabase/functions/comms-a2p-draft/index.ts": "49bd8acc5ed4ec7d60ba79b917438ae5eba0ce2ffcbf862baa9caa56293ada29",
  "supabase/functions/paige-write-back/index.ts": "5ff11463820b7c38e69f683cbcd8542359d5a72c37724c06846bf3dcc6d41de8",
  "supabase/functions/paige-orchestrator/index.ts": "84e1bb410fb5e01242d4a34401ece2c4dbad515be51e3e4cbe337420e5245243",
  "supabase/functions/subagent-forge/index.ts": "1acb5488f11bd93a2d6b36638fddcd73323f4363eacbd58b284d1fa648b3d906",
  "supabase/functions/send-message/index.ts": "29306707680c77fde92d6c689a9f1bca472ba24ab3219c60b21dcc7da68c956d",
  "supabase/functions/_shared/paige-spine/contracts.ts": "2d771686d636c04d2e07d9b8c336e19cde246b9a303ddd034d7ae8500f7eefb4",
  // Operator retirement adds opt-in timeout/no-retry controls; ordinary callers retain
  // their existing behavior. Renewed non-author review and actual retry controls are
  // recorded on PR #1897; no other incumbent snapshot is regenerated or accepted.
  "supabase/functions/_shared/twilio.ts": "afe6b57d9ed91c00e6517856f7b17c36f147fee5b88afb3450586c4393d6565a",
  "supabase/functions/_shared/channel-adapters.ts": "f29fe7502ceb961ad886863c570970d48c4c19969ce2b6fce203a04867deef41",
  // E09 Slice 6 bounded renewal (2026-10-18), integrating-crew source review (NOT non-author):
  // the only change vs main is one added `case "customer_request"` in suppressionReason (the plain
  // sentence a portal opt-out returns). Step order, every block/queue condition, the consent channel
  // list and the normalizers are byte-identical. Renew this one scalar only.
  "supabase/functions/_shared/pre-send-pipeline.ts": "dd7193c8f9663462f045de0eb937c6cf728a1c0ce0dce6451f4fa4cc9fd545b6",
  "supabase/functions/_shared/contact-methods.ts": "cea64c7f9ac201150bfd28834eaac88a6ebe0333c2c0a42dc9b9a8476840eef6",
  "supabase/functions/_shared/internal-vocabulary.ts": "9074425cc61d1a678e3a4ca03595fe8c4d1eac4572a4bd2daf31aff77f39d37a",
  "supabase/functions/_shared/paige-capability-status/resolver.ts": "ec8a5dad7df3426f30203aa1c8014372a60f51ed0decc829fc8541fba62a4142",
  "supabase/functions/paige-deep-research/fabric.ts": "23fd093b20d6f721ff07619aa5a4e34892d5346fd6b4934e0ae73fffb0b609bb",
  "supabase/functions/_shared/reasoning/strategize.ts": "ace59eadcd60f18c8fa673002626a5fe869099acdc8dd704c71c9b7aa9b3b46a",
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
  "supabase/functions/_shared/sales-invoice-delivery/readiness-reader.ts": "8ea30924c24b27244d413ee167e43f08b18a0589df53e2d2b65fde4998ca2ba2",
  // E04 exact invoice navigation: independently compared incumbent route outputs; authority unchanged.
  "supabase/functions/_shared/canonical-app-url.ts": "9eae3b8862432dd7f1d8c1bfc77db807ed6a00407731a710d874bd419f301719",
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
  "supabase/functions/_shared/comms-email/readiness.ts": "920b5bf24d44385ded3bd1b72840c1f1ebd3689524cd88472e6bc6337c043cfc",
  "supabase/functions/_shared/openai-models.ts": "a76ac476a2cbd298421a9d7d37f3605cf384e4a4e53a1635719405d52e70905e",
  "supabase/functions/_shared/openai-responses.ts": "bec9943dcb725b592cdba219a5e349f14bcf1f259adbc17522fceb5c6fe0ec81",
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
 // Distinct NONAUTHOR037b review: bounded control transport parsing/classification only.
 "supabase/functions/_shared/paige-turn/control-transport.ts": "cabcb7dbaf5c728491fec670f341b061e2c0a45fd8988370565de348c332dbd6",
 "supabase/functions/_shared/operations-task-read.ts": "97dea16d6415e8114342904f2270e8257f4e5ea31431192a2e6f7f3e5fa05c4b",
 "supabase/functions/_shared/inbox-intelligence/policy.ts": "12b8711f7ba6bc1acf3c41f8221be74c3ac92699584a48dc36d1e5c2311b21b2",
 "supabase/functions/_shared/calendar-booking-read.ts": "22fd2716f66c9bd87fb3c91cdd7a9f0d8a3586396a1e47374182fe2a3e553c2f",
 "supabase/functions/_shared/solo-classification.ts": "a4a7b91f4c8d36d56548f3096bd6e0ef70cafca12036bd6fb81444f8294e845a",
 "supabase/functions/_shared/paige-spine/domains/calendar_booking.ts": "69f388de84dd13b73d0951531bcee85a9ff7e37dc59524bb24d3ce3d657bb755",
 "supabase/functions/_shared/paige-spine/domains/teamAuthorityChatEvidence.ts": "2e513de67adec189f65b7a29df2d8e1943ff3a4366f3833ec3a1534d6300262f",
 // Independently reviewed pure contact receipt reference; presentation only, no authority.
 "supabase/functions/_shared/paige-turn/crm-result-reference.ts": "9ed77f5d7459746d13d570ad8a627f3ab8c875ee2744edbc2a7626f0a7426427",
 "supabase/functions/_shared/client-portal-assistant-context.ts": "a19e19a393c6f0a71b7fdab1e8a9204372915fa38860abf4213c0d945eb01967",
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
 "supabase/functions/_shared/analytics-metrics/read.ts": "a666df00a26f6b7d52237afdeb89868898dffb298acce4ba9fbceb18935b15d6",
 "supabase/functions/_shared/analytics-metrics/keys.ts": "7d6469a106f5200147e360e46b0ef1846581795207fa74d7c48f0ecc14d4fbc6",
 "supabase/functions/_shared/analytics-metrics/metric-contract.ts": "8bbc6b91d259e2ab80643dd37667d88736043066e14d725bbca5344874d0c2a5",
 "supabase/functions/_shared/pipeline-original-discovery.ts": "4c55fee76bc2622a0b57b33282276f36aa3a8552725168c45ab1b2774b7e7fa9",
 "supabase/functions/_shared/paige-turn/outcome-status.ts": "1cfab94676e27a705b620e0a4401ed7712cab25b597bc233aaddcd4d638a1942",
 // Historical Research context and its pure status-result constructors.
 "supabase/functions/_shared/research-history-context.ts": "fa64f9d267b6f2196ae7ff754ef2660a918bcd6da79698700acbfc05222685b2",
 "supabase/functions/_shared/paige-context/mod.ts": "56fb44fcb3c78d6cf3a221290550b57694be6eb99e8eda608e610ddfc65dd6a8",
 // Independently reviewed completed-lifecycle publication reader; no effect authority.
 "supabase/functions/_shared/paige-turn/interactive.ts": "c11ff1572df36f4efdc5534e6fa19177748acd551e56e2c147b88b421a256432",
 // Independently reviewed canonical approval-status projection; no effect authority.
 "supabase/functions/_shared/paige-turn/interactive-approval.ts": "1fbe20d09c91d4082932a75cb8e52ecb6eaf11a0c516d3f2e0342469a3c9a870",
 "supabase/functions/_shared/planning/approved-reminder.ts": "2aa731c9f9c116955fb6a7a99a8c814ca0676464ee1fcfbe1b7780b373b68196",
 "supabase/functions/_shared/planning/original-reminder-outcome.ts": "f7ba277de16f284d0699fc4f9ab103f48bf8ea42cddf6f10c67102c2e9ffd0ce",
 "supabase/functions/_shared/paige-turn/interactive-reminder-history.ts": "84e35fd73307cf8172951fc1dcbf0b1064dd988cfb596ea95bc3ea7e244b4415",
 // Exact non-author-reviewed generic-email C4b ancestry at a9de011b6;
 // proposal b4ebdf9d / review 8b83d5c5. Existing114 pins and verifier unchanged.
 "supabase/functions/_shared/paige-turn/resume.ts": "389a87cb2d6f6dff75704a7887ba5bd39c53fc12bc5117cf7bb2ca852f650fba",
 "supabase/functions/_shared/comms-email/chat.ts": "b2c63f538935839cbafa9642b2d0ca83b8c24b1fc61be8200bda2efc19e9044e",
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
