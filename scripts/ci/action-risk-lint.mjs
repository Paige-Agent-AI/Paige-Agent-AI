#!/usr/bin/env node
/**
 * action-risk-lint — a write tool that nobody classified must not reach production.
 *
 * WHAT THIS GUARDS. `supabase/functions/_shared/action-risk.ts` decides how much proof each
 * mutation needs: `ordinary` (a compact confirmation), `high` (the rendered approval card, whose
 * fingerprint travels in the request body and so cannot be produced by the model), or `owner_only`
 * (not a chat action at any approval strength). The handler gates on that file and nothing else.
 *
 * The failure mode this exists to stop is not malice, it is arithmetic. Someone adds the fifty-
 * second write tool, does not know this file exists, and the tool ships. Before the policy, the
 * default for an unlisted tool was permissive; now the default is inert, and the runtime refuses it
 * — but "inert in production" is a bad way to find out. This finds out in CI instead.
 *
 * It also guards the reverse: a classification for a tool that no longer exists is a line nobody
 * will ever delete, and a policy full of ghosts stops being read.
 *
 * TWO SURFACES DECLARE ACTS, NOT ONE — added 2026-09-05 with the governed MCP door. The policy was
 * written when Chat was the only caller, so "does the handler still declare this?" meant one file.
 * `paige-mcp` now maps its 117 tools onto canonical keys in
 * `_shared/paige-mcp/capability-policy.ts`, forty-nine of which exist for that door alone. Those
 * are not ghosts — a live registry points at every one of them — and the ghost rule had to learn
 * the second surface or it would have demanded the deletion of the classifications that make the
 * MCP door work. The rule itself is unchanged in spirit: a classified key that NO surface points
 * at is still a line nobody reads.
 *
 *   node scripts/ci/action-risk-lint.mjs
 *   node scripts/ci/action-risk-lint.mjs --self-test
 */
import fs from "node:fs";
import ts from "typescript";

const RETIRED_OWNER_ONLY_CHAT_TOOLS = ["automation_set_grant", "automation_set_state"];
const astNodes = (root, predicate) => {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root); return found;
};
const compactNode = node => ts.createPrinter({ removeComments: true })
  .printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).replace(/\s/g, "");

/** Retained policies protect historical/injected calls, never grant a model tool.
 * Admit only the two retired keys, under the actual imported policy, unconditional
 * clamp, off brake and early owner-only continue before approval/dispatch. */
export function retainedOwnerOnlyDenials(src) {
  const source = ts.createSourceFile(CHAT, src, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) return [];
  const imports = source.statements.filter(ts.isImportDeclaration)
    .filter(n => n.moduleSpecifier.text === "../_shared/action-risk.ts")
    .flatMap(n => n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)
      ? n.importClause.namedBindings.elements.filter(e => !e.propertyName).map(e => e.name.text) : []);
  if (!["classifyAction", "clampLaneByRisk", "mutatingTools"].every(n => imports.includes(n))) return [];
  const gates = astNodes(source, n => ts.isIfStatement(n)
    && compactNode(n.expression) === 'MUTATING_TOOLS.has(tc.function.name)&&!CRM_COMMAND_TOOL_NAMES.has(tc.function.nameasany)');
  if (gates.length !== 1 || !ts.isBlock(gates[0].thenStatement)) return [];
  const statements = gates[0].thenStatement.statements;
  const indexOf = value => statements.findIndex(n => compactNode(n) === value);
  const clampIndex = indexOf('constclampedMode=clampLaneByRisk(autoModeas"auto"|"confirm"|"off",tc.function.name);');
  const clampApply = statements.findIndex(n => ts.isIfStatement(n)
    && compactNode(n.expression) === 'clampedMode!==autoMode' && !n.elseStatement
    && ts.isBlock(n.thenStatement) && n.thenStatement.statements.some(s => compactNode(s) === 'autoMode=clampedMode;'));
  const offIndex = statements.findIndex(n => ts.isIfStatement(n) && compactNode(n.expression) === 'autoMode==="off"'
    && !n.elseStatement && ts.isBlock(n.thenStatement) && n.thenStatement.statements.length > 0 && ts.isContinueStatement(n.thenStatement.statements.at(-1)));
  const confirmIndex = statements.findIndex(n => ts.isIfStatement(n) && compactNode(n.expression) === 'autoMode==="confirm"');
  if (!(clampIndex >= 0 && clampApply > clampIndex && offIndex > clampApply && confirmIndex > offIndex)) return [];
  const confirm = statements[confirmIndex];
  if (!ts.isBlock(confirm.thenStatement) || !confirm.elseStatement
    || compactNode(confirm.elseStatement) !== '{approvalChannel.set(tc.id,studioLifted?"studio_session_auto":"standing_autonomy_setting");}') return [];
  const approvalStatements = confirm.thenStatement.statements;
  if (!approvalStatements[0] || compactNode(approvalStatements[0]) !== 'constrisk=classifyAction(tc.function.name);') return [];
  const denial = approvalStatements[2];
  if (!denial || !ts.isIfStatement(denial) || compactNode(denial.expression) !== 'risk==="owner_only"'
    || denial.elseStatement || !ts.isBlock(denial.thenStatement)
    || !denial.thenStatement.statements.length || !ts.isContinueStatement(denial.thenStatement.statements.at(-1))) return [];
  const branches = astNodes(source, n => ts.isIfStatement(n)
    && compactNode(n.expression) === 'tc.function.name==="automation_set_grant"||tc.function.name==="automation_set_state"');
  return branches.length === 1 && branches[0].pos > gates[0].end ? [...RETIRED_OWNER_ONLY_CHAT_TOOLS] : [];
}

const POLICY = "supabase/functions/_shared/action-risk.ts";
const CHAT = "supabase/functions/paige-ai-chat/index.ts";
const MCP_POLICY = "supabase/functions/_shared/paige-mcp/capability-policy.ts";
const SOCIAL_HANDLER = "supabase/functions/paige-social/index.ts";
const CONTACT_SCOPED_EDGE_HANDLERS = [
  "supabase/functions/_shared/nav-pull-profile/governed-adapter.ts",
  "supabase/functions/smartcredit-pull-snapshot/index.ts",
];
const CRM_CATALOG = "supabase/functions/_shared/crm-command/catalog.ts";
const SALES_INVOICE_CONTRACT = "supabase/functions/_shared/sales-invoice-command/contract.ts";
const SALES_INVOICE_HANDLER = "supabase/functions/sales-invoice-command/index.ts";
// The Vibe Studio publish door (Migration E). Same precedent as the invoice door: a door-only act
// is declared by the door's bound declaration map, and only once the door exists and binds it.
const STUDIO_PUBLISH_MAP = "supabase/functions/_shared/paige-spine/domains/studio_publish.ts";
const STUDIO_PUBLISH_HANDLER = "supabase/functions/growth-publish-command/index.ts";

/** Every classified action, as `[tool, class, reason]`, read from the policy's own table. */
export function parsePolicy(src) {
  const at = src.indexOf("const RISK: ReadonlyArray<readonly [string, ActionRisk, string]> = [");
  if (at < 0) return null;
  const end = src.indexOf("\n];", at);
  if (end < 0) return null;
  return [...src.slice(at, end).matchAll(
    /\[\s*"([a-z0-9_]+)"\s*,\s*"(ordinary|high|owner_only)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g,
  )].map((m) => ({ tool: m[1], risk: m[2], reason: m[3] }));
}

/** The tools the handler declares to the model, with the exempt list it honours. */
export function parseChat(src, importedTools = []) {
  return {
    declared: [...new Set([...src.matchAll(/\n\s*name: "([a-z0-9_]+)",/g)].map((m) => m[1]).concat(importedTools))],
    // The handler must gate on the policy, not on a literal of its own. A re-introduced hand-list
    // is the exact drift the policy replaced, so it fails here rather than being merged and
    // discovered later by a reviewer who happens to look.
    hasHandList: /const MUTATING_TOOLS = new Set<string>\(\[/.test(src),
    gatesOnPolicy: /const MUTATING_TOOLS = mutatingTools\(\);/.test(src),
    retainedOwnerOnlyDenials: retainedOwnerOnlyDenials(src),
  };
}

/**
 * The canonical keys the MCP door points at, read from its capability policy. That file holds no
 * classification of its own — it is a tool-name → key mapping — so this only asks WHICH keys are
 * referenced, never what they are worth.
 */
export function parseMcpCanonicals(src) {
  const start = src.indexOf("export const MCP_CAPABILITY_POLICY");
  if (start === -1) return [];
  return [...src.slice(start).matchAll(/^\s*canonical:\s*"([a-z0-9_]+)",/gm)].map((m) => m[1]);
}

/** Domain-owned edge mutations that enter the same governed decision seam. */
export function parseGovernedEdgeActions(src) {
  return [...new Set([...src.matchAll(/await govern\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]))];
}

/** Canonical capability constants used by governed, contact-scoped Edge adapters. */
export function parseCapabilityConstants(src) {
  return [...src.matchAll(/const (?:[A-Z0-9_]*CAPABILITY) = "([a-z0-9_]+)"/g)].map((m) => m[1]);
}

/** Actual governed invoice command keys, including the human-only document-link action. */
export function parseSalesInvoiceActions(src) {
  const at = src.indexOf("export const SALES_INVOICE_ACTIONS = {");
  const end = src.indexOf("} as const;", at);
  if (at < 0 || end < 0) return [];
  return [...src.slice(at, end).matchAll(/"invoice\.[a-z_]+":\s*"([a-z0-9_]+)"/g)].map(m => m[1]);
}

/** The Studio publish door's governed keys, read from its bounded declaration map. */
export function parseStudioPublishActions(src) {
  const at = src.indexOf("export const STUDIO_PUBLISH_KIT_BY_ACTION = {");
  const end = src.indexOf("} as const;", at);
  if (at < 0 || end < 0) return [];
  return [...src.slice(at, end).matchAll(/^\s*([a-z0-9_]+):\s*[A-Z0-9_]+_CAPABILITY,/gm)].map(m => m[1]);
}

/** The door must hand the map's declaration to the canonical Kit gate, as the invoice door does. */
export function studioPublishDoorBound(handler) {
  return /import\s*\{[^}]*\bSTUDIO_PUBLISH_KIT_BY_ACTION\b[^}]*\}\s*from\s*["']\.\.\/_shared\/paige-spine\/domains\/studio_publish\.ts["']/.test(handler)
    && /import\s*\{[^}]*\bdecideDeclaredCapability\b[^}]*\}\s*from\s*["']\.\.\/_shared\/capability-kit\/decision\.ts["']/.test(handler)
    && /decideDeclaredCapability\(\s*STUDIO_PUBLISH_KIT_BY_ACTION\[/.test(handler);
}

/** Closed declared adapter, not any function whose name resembles a gate. */
export function invoiceDeclaredGateBound(handler, decision) {
  const body=decision.split('export function decideDeclaredCapability(')[1]?.split('export function decideDeclaredOrdinaryCapability(')[0] ?? '';
  return handler.includes('SALES_INVOICE_ACTIONS[command.action]')
    && /import\s*\{\s*decideDeclaredCapability\s*\}\s*from\s*["']\.\.\/_shared\/capability-kit\/decision\.ts["']/.test(handler)
    && /import\s*\{\s*SALES_INVOICE_KIT_BY_ACTION\s*\}\s*from\s*["']\.\.\/_shared\/paige-spine\/domains\/sales_invoice\.ts["']/.test(handler)
    && handler.includes('decideDeclaredCapability(SALES_INVOICE_KIT_BY_ACTION[capability], {')
    && /import\s*\{\s*decideGovernedExecution\s*\}\s*from\s*["']\.\.\/paige-spine\/governedExecution\.ts["']/.test(decision)
    && body.includes("if (!isDefinedCapability(declaration)) throw new TypeError('CAPABILITY_DECLARATION_REQUIRED')")
    && body.includes('key !== input.capability.id')
    && body.includes('classifyAction(key) !== declaration.governance.risk')
    && body.includes("declaration.governance.approval !== 'confirm'")
    && body.includes("declaration.governance.risk !== 'high'")
    && body.includes("input.capability.availability === 'unknown'")
    && body.includes('input.capability.outcomeChannel !== declaration.receipt.recorder')
    && body.includes('return decideGovernedExecution(input);');
}
export function ordinaryDeclaredGateBound(decision) {
  const body=decision.split('export function decideDeclaredOrdinaryCapability(')[1] ?? '';
  return body.includes('isDefinedCapability(declaration)')
    && body.includes('key !== input.capability.id')
    && body.includes('classifyAction(key) !== declaration.governance.risk')
    && body.includes("declaration.effect !== 'mutation'")
    && body.includes("declaration.governance.risk !== 'ordinary'")
    && body.includes("declaration.providerBinding.kind !== 'internal'")
    && body.includes('input.capability.outcomeChannel !== declaration.receipt.recorder')
    && body.includes("input.capability.availability === 'unknown'")
    && body.includes('return decideGovernedExecution(input);');
}
export function salesDraftDoorBound(chat, salesChat, draftChat, door, admission, decision) {
  return chat.includes('...SALES_INVOICE_TOOLS') && salesChat.includes('...SALES_DRAFT_TOOLS')
    && salesChat.includes('dispatchCommercialDraftChat(ctx,deps,')
    && draftChat.includes("from './draft-capabilities.ts'")
    && draftChat.includes("functions.invoke('sales-invoice-draft-command'")
    && door.includes('await admitCommercialDraft(')
    && admission.includes("from '../capability-kit/decision.ts'")
    && admission.includes('decideDeclaredOrdinaryCapability(declaration,')
    && ordinaryDeclaredGateBound(decision);
}

const MERCHANT_PATHS = [CHAT,'supabase/functions/_shared/sales-invoice-chat.ts','supabase/functions/_shared/sales-payments/merchant-chat.ts','supabase/functions/tenant-stripe-connect/index.ts','supabase/functions/_shared/sales-payments/merchant-admission.ts','supabase/functions/_shared/sales-payments/merchant-capability.ts','supabase/functions/_shared/capability-kit/decision.ts'];
/** Closed current merchant declarations, counted only when their real Chat and edge bind them. */
export function parseMerchantActions(declarations) {
  const body=declarations.match(/export const MERCHANT_KIT_BY_TOOL\s*=\s*\{([\s\S]*?)\}\s*as const;/)?.[1];
  if(!body)return [];
  const entries=[...body.matchAll(/\b([a-z0-9_]+):(MERCHANT_ONBOARDING_CAPABILITY|MERCHANT_PORTAL_CAPABILITY)/g)];
  if(entries.length!==2||entries.map(m=>m[0]).join(',')!==body.replace(/\s/g,''))return [];
  const expected={sales_start_merchant_onboarding:'MERCHANT_ONBOARDING_CAPABILITY',sales_create_merchant_login_link:'MERCHANT_PORTAL_CAPABILITY'};
  if(entries.some(m=>expected[m[1]]!==m[2])||new Set(entries.map(m=>m[1])).size!==2)return [];
  if(entries.some(m=>!declarations.includes(`governance:{actionRiskKey:'${m[1]}',risk:'high',approval:'confirm'`)))return [];
  return entries.map(m=>m[1]);
}
export function salesMerchantDoorBound(chat, aggregate, adapter, edge, admission, declarations, decision) {
  const actions=parseMerchantActions(declarations);
  const highGate=decision.split('export function decideDeclaredCapability(')[1]?.split('export function decideDeclaredOrdinaryCapability(')[0]??'';
  return actions.length===2
    && /import\s*\{[^}]*SALES_INVOICE_TOOLS[^}]*dispatchSalesInvoiceChat[^}]*\}\s*from\s*['"]\.\.\/_shared\/sales-invoice-chat\.ts['"]/.test(chat)
    && chat.includes('toolDefs.push(...SALES_INVOICE_TOOLS')
    && chat.includes('SALES_COLLECTIONS_TOOL_NAMES.has(tc.function.name) ? dispatchSalesCollectionsChat : dispatchSalesInvoiceChat')
    && chat.includes('await dispatchSales({')
    && /import\s*\{[^}]*SALES_MERCHANT_TOOLS[^}]*dispatchMerchantChat[^}]*\}\s*from\s*['"]\.\/sales-payments\/merchant-chat\.ts['"]/.test(aggregate)
    && aggregate.includes('...SALES_MERCHANT_TOOLS')
    && aggregate.includes('if(SALES_MERCHANT_TOOL_NAMES.has(ctx.toolName))return dispatchMerchantChat(ctx,deps,')
    && /from\s*['"]\.\/merchant-capability\.ts['"]/.test(adapter)
    && actions.every(tool=>adapter.includes(`'${tool}'`))
    && adapter.includes("deps.caller.functions.invoke('tenant-stripe-connect',{body})")
    && /import\s*\{[^}]*admitMerchantCommand[^}]*\}\s*from\s*['"]\.\.\/_shared\/sales-payments\/merchant-admission\.ts['"]/.test(edge)
    && edge.includes('await admitMerchantCommand(body,context,')
    && /import\s*\{\s*decideDeclaredCapability\s*\}\s*from\s*['"]\.\.\/capability-kit\/decision\.ts['"]/.test(admission)
    && /from\s*['"]\.\/merchant-capability\.ts['"]/.test(admission)
    && admission.includes('decideDeclaredCapability(MERCHANT_KIT_BY_TOOL[tool],')
    && admission.includes('await port.claim(tool,req.approved_fingerprint)')
    && actions.every(tool=>declarations.includes(`governance:{actionRiskKey:'${tool}',risk:'high',approval:'confirm'`))
    && highGate.includes('classifyAction(key) !== declaration.governance.risk')
    && highGate.includes("declaration.governance.risk !== 'high'")
    && highGate.includes('return decideGovernedExecution(input);');
}
export function parseExemptions(src) {
  const at = src.indexOf("const NON_MUTATING_EXEMPT: ReadonlyMap<string, string> = new Map([");
  if (at < 0) return null;
  const end = src.indexOf("\n]);", at);
  if (end < 0) return null;
  return [...src.slice(at, end).matchAll(/\[\s*"([a-z0-9_]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g)]
    .map((m) => ({ tool: m[1], reason: m[2] }));
}

/** Kept in step with `MUTATION_VERB` in the policy by `checkVerbParity` below. */
const MUTATION_VERB = /(^|_)(create|update|delete|remove|save|send|publish|install|uninstall|grant|revoke|run|assign|enroll|book|set|draft|generate|file|advance|forge|archive|activate|deactivate|move|add|build|log|author|enable|disable|invite|upload|apply|approve|reject|decide|import|export|sync|write|post|schedule|cancel|start|stop|trigger|fire|configure|buy|purchase|pull|name|rename|propose|provision|claim|release)(_|$)/;

/** The rule: destroys, changes permissions, or goes public ⇒ never `ordinary`. */
const IRREVERSIBLE_OR_OUTWARD = /(^|_)(delete|remove|revoke|publish|uninstall|install)(_|$)|(^|_)grant(_|$)/;

export function findings({ policy, exemptions, chat, verbSourceMatches, mcpCanonicals = [], governedEdgeActions = [], requiredClassifications = [] }) {
  const out = [];
  const classified = new Map(policy.map((p) => [p.tool, p.risk]));
  const exempt = new Set(exemptions.map((e) => e.tool));
  for (const tool of chat.retainedOwnerOnlyDenials ?? []) {
    if (RETIRED_OWNER_ONLY_CHAT_TOOLS.includes(tool) && classified.get(tool) !== "owner_only")
      out.push(`${tool} retains a historical/injected Chat denial and must retain its owner_only classification.`);
  }
  // Explicit mutating contracts are stronger evidence than a verb-shaped tool name.
  for (const tool of new Set(requiredClassifications)) {
    if (!classified.has(tool)) out.push(`${tool} is a canonical governed mutation but has no classification in ${POLICY}.`);
  }

  // A regex that matches nothing reports a clean bill of health, which is indistinguishable from
  // a clean bill of health. Prove the subject was found before grading it.
  if (policy.length < 40) out.push(`the policy parsed only ${policy.length} classifications — the table shape changed, so this guard is reading nothing`);
  if (chat.declared.length < 50) out.push(`only ${chat.declared.length} tool names were found in the handler — this guard is reading nothing`);

  if (chat.hasHandList) out.push(`${CHAT} declares its own MUTATING_TOOLS literal again — the gated set must come from the policy, or the two lists will drift exactly as they did before`);
  if (!chat.gatesOnPolicy) out.push(`${CHAT} no longer derives MUTATING_TOOLS from mutatingTools() — the handler must gate on the policy`);

  // 1. Every declared tool that reads as a write is classified, or exempted with a reason.
  for (const tool of new Set([...chat.declared, ...mcpCanonicals, ...governedEdgeActions])) {
    if (classified.has(tool) || exempt.has(tool)) continue;
    if (!MUTATION_VERB.test(tool)) continue;
    out.push(`${tool} reads as a write but has no entry in ${POLICY}. Classify it (ordinary | high | owner_only), or add it to NON_MUTATING_EXEMPT with the reason it persists nothing.`);
  }

  // 2. No ghosts: a classification NO surface points at. Chat declares tools by name; the MCP door
  //    declares them indirectly, by mapping a tool onto a canonical key. Either reference keeps a
  //    classification alive — an entry with neither is the line nobody deletes.
  const declared = new Set([...chat.declared, ...mcpCanonicals, ...governedEdgeActions]);
  for (const { tool, risk } of policy) {
    // Containment tombstones are deliberately classified while not being dispatched, so a future
    // accidental re-registration cannot inherit read semantics. They are named here rather than
    // silently tolerated.
    if (tool === "marketplace_install" || tool === "marketplace_uninstall" || tool === "n8n_delete_workflow") continue;
    if (RETIRED_OWNER_ONLY_CHAT_TOOLS.includes(tool)) {
      if (declared.has(tool)) out.push(`${tool} is a retired owner-only Chat path and must not be advertised to a model.`);
      if (risk === "owner_only" && !declared.has(tool) && chat.retainedOwnerOnlyDenials?.includes(tool)) continue;
    }
    if (!declared.has(tool)) out.push(`${tool} is classified in ${POLICY} but the handler no longer declares it — remove the entry, or the policy fills with lines nobody reads.`);
  }

  // 3. The membership rule, not a hand-list: anything that destroys, changes who may do what, or
  //    goes public is at least `high`. `owner_only` is stronger, so it satisfies this too.
  for (const { tool, risk } of policy) {
    if (IRREVERSIBLE_OR_OUTWARD.test(tool) && risk === "ordinary") {
      out.push(`${tool} is classified ordinary, but its name says it destroys, changes permissions, or goes public. That needs the approval card at minimum.`);
    }
  }

  // 4. Every entry states WHY. The reason is the rubric a later reader argues with and the next
  //    tool is placed against; an entry without one is a guess that will be copied.
  for (const { tool, reason } of policy) {
    if (!reason || reason.trim().length < 12) out.push(`${tool} carries no usable reason for its classification.`);
  }
  for (const { tool, reason } of exemptions) {
    if (!reason || reason.trim().length < 20) out.push(`${tool} is exempted from classification without saying why it persists nothing.`);
  }

  // 5. This file's copy of the verb pattern must be the policy's. Two regexes that must agree are
  //    two regexes that eventually will not, and the divergence would show up as CI passing a tool
  //    the runtime then refuses.
  if (!verbSourceMatches) out.push(`the MUTATION_VERB pattern in this guard no longer matches the one in ${POLICY} — they must be identical or CI and the runtime will disagree about what counts as a write.`);

  return out;
}

function selfTest() {
  const ok = (name, cond) => { console.log(`${cond ? "  ok  " : "  FAIL"} ${name}`); return cond ? 0 : 1; };
  const base = {
    policy: Array.from({ length: 60 }, (_, i) => ({ tool: `t_create_${i}`, risk: "ordinary", reason: "a sufficiently long reason" })),
    exemptions: [],
    chat: { declared: Array.from({ length: 60 }, (_, i) => `t_create_${i}`), hasHandList: false, gatesOnPolicy: true },
    verbSourceMatches: true,
  };
  let bad = 0;
  const merchantSources=MERCHANT_PATHS.map(path=>fs.readFileSync(path,'utf8'));
  bad += ok('merchant declarations discovered through mounted Chat and canonical edge gate',salesMerchantDoorBound(...merchantSources));
  for(const [index,token]of [[0,'toolDefs.push(...SALES_INVOICE_TOOLS'],[1,'...SALES_MERCHANT_TOOLS'],[1,'return dispatchMerchantChat(ctx,deps,'],[2,"invoke('tenant-stripe-connect'"],[3,'await admitMerchantCommand(body,context,'],[4,'decideDeclaredCapability(MERCHANT_KIT_BY_TOOL[tool],'],[4,'await port.claim(tool,req.approved_fingerprint)'],[5,"risk:'high'"],[6,'classifyAction(key) !== declaration.governance.risk']]){
    if(!merchantSources[index].includes(token))throw Error(`merchant negative target absent: ${token}`);
    const broken=[...merchantSources];broken[index]=broken[index].replace(token,'BROKEN_BINDING');
    bad += ok(`merchant discovery refuses broken binding ${token}`,!salesMerchantDoorBound(...broken));
  }
  const unknownMerchant=merchantSources[5].replaceAll('sales_create_merchant_login_link','sales_create_unknown_merchant_link');
  bad += ok('unknown merchant key is not discovered',parseMerchantActions(unknownMerchant).length===0);
  bad += ok('unknown merchant declaration cannot preserve a ghost classification',!salesMerchantDoorBound(...merchantSources.map((s,i)=>i===5?unknownMerchant:s)));
  const draftSources = [CHAT,'supabase/functions/_shared/sales-invoice-chat.ts','supabase/functions/_shared/sales-commercial/draft-chat.ts','supabase/functions/sales-invoice-draft-command/index.ts','supabase/functions/_shared/sales-commercial/draft-admission.ts','supabase/functions/_shared/capability-kit/decision.ts'].map(path=>fs.readFileSync(path,'utf8'));
  bad += ok('draft guard follows the real declaration/dispatch/shared-gate chain',salesDraftDoorBound(...draftSources));
  for (const [index,token] of [[0,'...SALES_INVOICE_TOOLS'],[1,'...SALES_DRAFT_TOOLS'],[1,'dispatchCommercialDraftChat(ctx,deps,'],[2,"functions.invoke('sales-invoice-draft-command'"],[3,'await admitCommercialDraft('],[4,"from '../capability-kit/decision.ts'"],[4,'decideDeclaredOrdinaryCapability(declaration,'],[5,"declaration.providerBinding.kind !== 'internal'"],[5,"declaration.governance.risk !== 'ordinary'"]]) {
    const broken=[...draftSources];broken[index]=broken[index].replace(token,'BROKEN_BINDING');
    bad += ok(`draft guard refuses broken binding ${token}`,!salesDraftDoorBound(...broken));
  }
  const invoiceHandler = fs.readFileSync(SALES_INVOICE_HANDLER, 'utf8');
  const invoiceDecision = fs.readFileSync('supabase/functions/_shared/capability-kit/decision.ts', 'utf8');
  bad += ok('invoice declared gate follows the exact canonical adapter', invoiceDeclaredGateBound(invoiceHandler, invoiceDecision));
  for (const [label, handler, decision] of [
    ['fake adapter import',invoiceHandler.replace('capability-kit/decision.ts','fake/decision.ts'),invoiceDecision],
    ['wrong declaration selection',invoiceHandler.replace('SALES_INVOICE_KIT_BY_ACTION[capability]','SALES_INVOICE_KIT_BY_ACTION.other'),invoiceDecision],
    ['forged declaration',invoiceHandler,invoiceDecision.replace('!isDefinedCapability(declaration)','false')],
    ['wrong risk',invoiceHandler,invoiceDecision.replace('classifyAction(key) !== declaration.governance.risk','false')],
    ['unknown availability',invoiceHandler,invoiceDecision.replace("input.capability.availability === 'unknown'",'false')],
    ['alternate authority',invoiceHandler,invoiceDecision.replace('return decideGovernedExecution(input);','return fakeApproval(input);')],
  ]) bad += ok(`invoice gate refuses ${label}`, !invoiceDeclaredGateBound(handler, decision));
  bad += ok("studio publish discovery reads its bounded declaration map",
    parseStudioPublishActions('export const STUDIO_PUBLISH_KIT_BY_ACTION = {\n  growth_page_unpublish: GROWTH_PAGE_UNPUBLISH_CAPABILITY,\n  studio_image_publish: STUDIO_IMAGE_PUBLISH_CAPABILITY,\n} as const;').join() === 'growth_page_unpublish,studio_image_publish');
  bad += ok("studio publish discovery refuses an absent or incomplete map",
    parseStudioPublishActions('growth_page_unpublish: GROWTH_PAGE_UNPUBLISH_CAPABILITY,').length === 0
    && parseStudioPublishActions('export const STUDIO_PUBLISH_KIT_BY_ACTION = {').length === 0);
  bad += ok("the real studio publish map parses all eight acts",
    parseStudioPublishActions(fs.readFileSync(STUDIO_PUBLISH_MAP, 'utf8')).length === 8);
  {
    const door = 'import { decideDeclaredCapability } from "../_shared/capability-kit/decision.ts";\nimport { STUDIO_PUBLISH_KIT_BY_ACTION } from "../_shared/paige-spine/domains/studio_publish.ts";\nconst d = decideDeclaredCapability(STUDIO_PUBLISH_KIT_BY_ACTION[key], {});';
    bad += ok("a studio door bound to the map through the Kit gate passes", studioPublishDoorBound(door));
    bad += ok("a studio door importing a different map is refused", !studioPublishDoorBound(door.replace('domains/studio_publish.ts', 'domains/other.ts')));
    bad += ok("a studio door skipping the Kit gate is refused", !studioPublishDoorBound(door.replace('decideDeclaredCapability(STUDIO', 'run(STUDIO')));
    bad += ok("a studio door with a fake gate import is refused", !studioPublishDoorBound(door.replace('capability-kit/decision.ts', 'fake/decision.ts')));
  }
  bad += ok("imported catalog mutations are included", parseChat('', ['widget_delete_thing']).declared.includes('widget_delete_thing'));
  bad += ok("invoice risk discovery reads its bounded canonical map", parseSalesInvoiceActions('export const SALES_INVOICE_ACTIONS = {\n "invoice.publish": "sales_publish_invoice",\n} as const;').join() === 'sales_publish_invoice');
  bad += ok("invoice risk discovery refuses an absent or incomplete map", parseSalesInvoiceActions('"invoice.publish": "sales_publish_invoice"').length === 0 && parseSalesInvoiceActions('export const SALES_INVOICE_ACTIONS = {').length === 0);
  for (const tool of ['sales_record_manual_payment', 'sales_reverse_manual_payment', 'sales_void_invoice']) {
    bad += ok(`an unclassified explicit ${tool} fails regardless of its name`, findings({ ...base, requiredClassifications: [tool], governedEdgeActions: [tool] }).some(f => f.includes(`${tool} is a canonical governed mutation`)));
  }
  bad += ok("an unclassified imported write fails", findings({...base, chat:{...base.chat, declared:[...base.chat.declared,...parseChat('', ['widget_delete_thing']).declared]}}).some(f=>f.includes('widget_delete_thing')));

  bad += ok("a fully classified handler is clean", findings(base).length === 0);
  bad += ok("an unclassified write is caught",
    findings({ ...base, chat: { ...base.chat, declared: [...base.chat.declared, "widget_delete_thing"] } })
      .some((f) => f.includes("widget_delete_thing")));
  bad += ok("a read-only tool is not caught",
    !findings({ ...base, chat: { ...base.chat, declared: [...base.chat.declared, "widget_list_things"] } })
      .some((f) => f.includes("widget_list_things")));
  bad += ok("an exempted write is not caught",
    !findings({ ...base, exemptions: [{ tool: "widget_generate_preview", reason: "returns it in memory and persists nothing at all" }],
      chat: { ...base.chat, declared: [...base.chat.declared, "widget_generate_preview"] } })
      .some((f) => f.includes("widget_generate_preview")));
  bad += ok("an exemption with no reason is caught",
    findings({ ...base, exemptions: [{ tool: "widget_generate_preview", reason: "fine" }],
      chat: { ...base.chat, declared: [...base.chat.declared, "widget_generate_preview"] } })
      .some((f) => f.includes("without saying why")));
  bad += ok("a delete classified ordinary is caught",
    findings({ ...base, policy: [...base.policy, { tool: "widget_delete_thing", risk: "ordinary", reason: "a sufficiently long reason" }],
      chat: { ...base.chat, declared: [...base.chat.declared, "widget_delete_thing"] } })
      .some((f) => f.includes("approval card at minimum")));
  bad += ok("a delete classified owner_only is NOT caught",
    !findings({ ...base, policy: [...base.policy, { tool: "widget_delete_thing", risk: "owner_only", reason: "a sufficiently long reason" }],
      chat: { ...base.chat, declared: [...base.chat.declared, "widget_delete_thing"] } })
      .some((f) => f.includes("approval card at minimum")));
  bad += ok("a ghost classification is caught",
    findings({ ...base, policy: [...base.policy, { tool: "gone_create_thing", risk: "ordinary", reason: "a sufficiently long reason" }] })
      .some((f) => f.includes("gone_create_thing")));
  const retainedSource = fs.readFileSync(CHAT, "utf8");
  const retained = parseChat(retainedSource);
  for (const tool of RETIRED_OWNER_ONLY_CHAT_TOOLS) {
    const policy = [...base.policy, { tool, risk: "owner_only", reason: "Retained denial for historical or injected calls." }];
    const chat = { ...base.chat, retainedOwnerOnlyDenials: retained.retainedOwnerOnlyDenials };
    bad += ok(`${tool} has a real retained early owner-only denial`, retained.retainedOwnerOnlyDenials.includes(tool));
    bad += ok(`${tool} retained denial keeps its owner-only policy`, !findings({ ...base, policy, chat }).some(f => f.includes(tool)));
    bad += ok(`${tool} missing denial is not a ghost exemption`, findings({ ...base, policy, chat: { ...chat, retainedOwnerOnlyDenials: [] } }).some(f => f.includes(tool)));
    bad += ok(`${tool} ordinary downgrade is refused`, findings({ ...base, policy: [...base.policy, { tool, risk: "ordinary", reason: "Retained denial for historical or injected calls." }], chat }).some(f => f.includes(tool)));
    bad += ok(`${tool} high downgrade is refused`, findings({ ...base, policy: [...base.policy, { tool, risk: "high", reason: "Retained denial for historical or injected calls." }], chat }).some(f => f.includes(tool)));
    bad += ok(`${tool} policy deletion is refused`, findings({ ...base, chat }).some(f => f.includes("must retain its owner_only classification")));
    bad += ok(`${tool} cannot be re-advertised`, findings({ ...base, policy, chat: { ...chat, declared: [...base.chat.declared, tool] } }).some(f => f.includes("must not be advertised")));
  }
  for (const [label, from, to] of [
    ["canonical policy import", '../_shared/action-risk.ts', '../_shared/fake-risk.ts'],
    ["unconditional class clamp", 'clampLaneByRisk(autoMode as', 'fakeLane(autoMode as'],
    ["clamp assignment", 'autoMode = clampedMode;', 'autoMode = "auto";'],
    ["off brake", 'if (autoMode === "off") {', 'if (false) {'],
    ["owner refusal", 'if (risk === "owner_only") {', 'if (false) {'],
    ["retained dispatcher", 'tc.function.name === "automation_set_grant" || tc.function.name === "automation_set_state"', 'false'],
  ]) {
    if (!retainedSource.includes(from)) throw Error(`retained owner-only mutation target absent: ${label}`);
    bad += ok(`retained owner-only proof refuses changed ${label}`, retainedOwnerOnlyDenials(retainedSource.replace(from, to)).length === 0);
  }
  bad += ok("a key only the MCP door points at is NOT a ghost",
    !findings({ ...base, policy: [...base.policy, { tool: "mcp_only_create_thing", risk: "ordinary", reason: "a sufficiently long reason" }],
      mcpCanonicals: ["mcp_only_create_thing"] })
      .some((f) => f.includes("mcp_only_create_thing")));
  bad += ok("a key NEITHER surface points at is still a ghost",
    findings({ ...base, policy: [...base.policy, { tool: "orphan_create_thing", risk: "ordinary", reason: "a sufficiently long reason" }],
      mcpCanonicals: ["something_else"] })
      .some((f) => f.includes("orphan_create_thing")));
  bad += ok("the MCP canonical parser reads a real-shaped table",
    parseMcpCanonicals('export const MCP_CAPABILITY_POLICY = {\n  a: {\n    canonical: "x_create_y",\n  },\n};')
      .join() === "x_create_y");
  bad += ok("the MCP canonical parser does not invent keys from an absent table",
    parseMcpCanonicals("no table here").length === 0);
  bad += ok("contact-scoped Edge capability constants are discovered",
    parseCapabilityConstants('export const NAV_PULL_CAPABILITY = "nav_pull_business_credit";').join() === "nav_pull_business_credit");
  bad += ok("a governed edge action is a real declaring surface",
    parseGovernedEdgeActions('const result = await govern(\n  "widget_create_thing",\n  args,\n);').join() === "widget_create_thing");
  bad += ok("a re-introduced hand-list is caught",
    findings({ ...base, chat: { ...base.chat, hasHandList: true } }).some((f) => f.includes("drift")));
  bad += ok("a handler that stopped gating on the policy is caught",
    findings({ ...base, chat: { ...base.chat, gatesOnPolicy: false } }).some((f) => f.includes("must gate on the policy")));
  bad += ok("a policy this guard could not parse is caught, not passed",
    findings({ ...base, policy: [] }).some((f) => f.includes("reading nothing")));
  bad += ok("a diverged verb pattern is caught",
    findings({ ...base, verbSourceMatches: false }).some((f) => f.includes("disagree about what counts")));
  // 2026-09-12 regression: `decide` must read as a mutation verb, so an unclassified `*_decide`
  // write (the `improvement_decide` bypass) is caught as a write rather than sailing through as a
  // query. Guards the lint's own copy of MUTATION_VERB; `checkVerbParity` guards it against the policy.
  bad += ok("`decide` reads as a mutation verb (the improvement_decide bypass stays closed)",
    MUTATION_VERB.test("improvement_decide") && MUTATION_VERB.test("x_decide") && !MUTATION_VERB.test("decided_list"));
  bad += ok("`pull` reads as a mutation verb for paid provider actions",
    MUTATION_VERB.test("nav_pull_business_credit") && MUTATION_VERB.test("smartcredit_pull_snapshot"));
  console.log(bad === 0 ? "\n✓ action-risk-lint self-test passed." : `\n✗ ${bad} self-test(s) failed.`);
  process.exit(bad === 0 ? 0 : 1);
}

// Only run the guard when this file IS the command. Importing it for its `findings` — which the
// self-test and any future harness does — must not fire the real lint as a side effect.
import { pathToFileURL } from "node:url";
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (process.argv.includes("--self-test")) selfTest();
if (!invokedDirectly) { /* imported for its exports */ } else {

const policySrc = fs.readFileSync(POLICY, "utf8");
const chatSrc = fs.readFileSync(CHAT, "utf8");
const policy = parsePolicy(policySrc);
const exemptions = parseExemptions(policySrc);
if (!policy || !exemptions) {
  console.error(`✗ action-risk-lint: could not read the policy table in ${POLICY}. It moved or changed shape — fix this guard rather than deleting it.`);
  process.exit(1);
}
const verbSourceMatches = policySrc.includes(`export const MUTATION_VERB = ${MUTATION_VERB.toString()};`);
// Follow the mounted domain-owned catalog; imported mutations receive the same policy checks.
let importedTools = [];
if (chatSrc.includes('...N8N_MANAGEMENT_TOOLS')) {
  if (!/import\s*\{[^}]*N8N_MANAGEMENT_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/n8n-management\.ts['"]/.test(chatSrc)) throw new Error('Unresolved n8n catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/n8n-management.ts', 'utf8');
  importedTools = [...source.matchAll(/^\s*(n8n_[a-z_]+):\{provider:/gm)].map(m => m[1]);
  if (!importedTools.length) throw new Error('n8n catalog could not be parsed');
}
if (chatSrc.includes('...GHL_MANAGEMENT_TOOLS')) {
  if (!/import\s*\{[^}]*GHL_MANAGEMENT_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/ghl-management\.ts['"]/.test(chatSrc)) throw new Error('Unresolved GHL catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/ghl-management.ts', 'utf8');
  const ghlTools = [...source.matchAll(/^\s*(ghl_[a-z_]+):\s*\{/gm)].map(m => m[1]);
  if (!ghlTools.length) throw new Error('GHL catalog could not be parsed');
  importedTools.push(...ghlTools);
}
if (chatSrc.includes('...BUSINESS_MISSION_TOOLS')) {
  if (!/import\s*\{[^}]*BUSINESS_MISSION_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/paige-spine\/domains\/business_mission\.ts['"]/.test(chatSrc)) throw new Error('Unresolved Business Mission catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/paige-spine/domains/business_mission.ts', 'utf8');
  const missionTools = [...source.matchAll(/\bname:\s*"(mission_[a-z_]+)"/g)].map(m => m[1]);
  if (!missionTools.length) throw new Error('Business Mission catalog could not be parsed');
  importedTools.push(...missionTools);
}
if (chatSrc.includes('...CAMPAIGN_BRIEF_TOOLS')) {
  if (!/import\s*\{[^}]*CAMPAIGN_BRIEF_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/paige-spine\/domains\/campaigns\.ts['"]/.test(chatSrc)) throw new Error('Unresolved Campaign Brief catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/paige-spine/domains/campaigns.ts', 'utf8');
  const campaignTools = [...source.matchAll(/\bname:\s*"(campaign_brief_[a-z_]+)"/g)].map(m => m[1]);
  if (!campaignTools.length) throw new Error('Campaign Brief catalog could not be parsed');
  importedTools.push(...campaignTools);
}
if (chatSrc.includes('...EMAIL_CAMPAIGN_TOOLS')) {
  if (!/import\s*\{[^}]*EMAIL_CAMPAIGN_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/email-campaign-chat\.ts['"]/.test(chatSrc)) throw new Error('Unresolved email campaign catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/email-campaign-chat.ts', 'utf8');
  const emailTools = [...source.matchAll(/\bname:\s*["']((?:read_)?email_campaign[a-z_]*)["']/g)].map(m => m[1]);
  if (!emailTools.length) throw new Error('Email campaign catalog could not be parsed');
  importedTools.push(...emailTools);
}
if (chatSrc.includes('...EMAIL_SERIES_TOOLS')) {
  if (!/import\s*\{[^}]*EMAIL_SERIES_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/email-series-chat\.ts['"]/.test(chatSrc)) throw new Error('Unresolved email series catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/email-series-chat.ts', 'utf8');
  const seriesTools = [...source.matchAll(/\bname:\s*["']((?:read_)?email_series[a-z_]*)["']/g)].map(m => m[1]);
  if (!seriesTools.length) throw new Error('Email series catalog could not be parsed');
  importedTools.push(...seriesTools);
}
if (chatSrc.includes('...CALENDAR_PRESET_TOOLS')) {
  if (!/import\s*\{[^}]*CALENDAR_PRESET_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/paige-spine\/domains\/calendar_preset\.ts['"]/.test(chatSrc)) throw new Error('Unresolved Calendar Preset catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/paige-spine/domains/calendar_preset.ts', 'utf8');
  const calendarTools = [...source.matchAll(/\bname:\s*"(booking_preset_[a-z_]+)"/g)].map(m => m[1]);
  if (!calendarTools.length) throw new Error('Calendar Preset catalog could not be parsed');
  importedTools.push(...calendarTools);
}
if (chatSrc.includes('...CALENDAR_LINK_TOOLS')) {
  if (!/import\s*\{[^}]*CALENDAR_LINK_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/paige-spine\/domains\/calendar_link\.ts['"]/.test(chatSrc)) throw new Error('Unresolved Calendar Link catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/paige-spine/domains/calendar_link.ts', 'utf8');
  const linkTools = [...source.matchAll(/\bname:\s*"(calendar_link_[a-z_]+)"/g)].map(m => m[1]);
  if (!linkTools.length) throw new Error('Calendar Link catalog could not be parsed');
  importedTools.push(...linkTools);
}
if (chatSrc.includes('...AGREEMENT_TOOLS')) {
  if (!/import\s*\{[^}]*AGREEMENT_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/paige-spine\/domains\/agreement\.ts['"]/.test(chatSrc)) throw new Error('Unresolved Agreement catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/paige-spine/domains/agreement.ts', 'utf8');
  const agreementTools = [...source.matchAll(/\bname:\s*"(agreement_[a-z_]+)"/g)].map(m => m[1]);
  if (!agreementTools.length) throw new Error('Agreement catalog could not be parsed');
  importedTools.push(...agreementTools);
}
if (chatSrc.includes('...GROWTH_FORM_TOOLS')) {
  if (!/import\s*\{[^}]*GROWTH_FORM_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/paige-spine\/domains\/growth_form\.ts['"]/.test(chatSrc)) throw new Error('Unresolved Growth Form catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/paige-spine/domains/growth_form.ts', 'utf8');
  const formTools = [...source.matchAll(/\bname:\s*"(growth_form_[a-z_]+)"/g)].map(m => m[1]);
  if (!formTools.length) throw new Error('Growth Form catalog could not be parsed');
  importedTools.push(...formTools);
}
if (chatSrc.includes('...CRM_COMMAND_TOOLS')) {
  if (!/import\s*\{[^}]*CRM_COMMAND_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/crm-command\/catalog\.ts['"]/.test(chatSrc)) throw new Error('Unresolved CRM command catalog import');
  const source = fs.readFileSync(CRM_CATALOG, 'utf8');
  const mapStart = source.indexOf("export const CRM_ACTION_CAPABILITY");
  const mapEnd = source.indexOf("} as const;", mapStart);
  const crmTools = [...source.slice(mapStart, mapEnd).matchAll(/"[a-z._]+":\s*"([a-z0-9_]+)"/g)].map(m => m[1]);
  if (!crmTools.length) throw new Error('CRM command catalog could not be parsed');
  importedTools.push(...crmTools);
}
if (chatSrc.includes('...INBOX_INTELLIGENCE_TOOLS')) {
  if (!/import\s*\{[^}]*INBOX_INTELLIGENCE_TOOLS[^}]*\}\s*from\s*['"]\.\.\/_shared\/inbox-intelligence\/chat\.ts['"]/.test(chatSrc)) throw new Error('Unresolved Inbox Intelligence catalog import');
  const source = fs.readFileSync('supabase/functions/_shared/inbox-intelligence/chat.ts', 'utf8');
  const inboxTools = [...source.matchAll(/[^\w]name:\s*["']((?:read_message_content|read_support_cases|gmail_organize))["']/g)].map(m => m[1]);
  if (!inboxTools.length) throw new Error('Inbox Intelligence catalog could not be parsed');
  importedTools.push(...inboxTools);
}
const mcpCanonicals = parseMcpCanonicals(fs.readFileSync(MCP_POLICY, "utf8"));
const governedEdgeActions = [
  ...parseGovernedEdgeActions(fs.readFileSync(SOCIAL_HANDLER, "utf8")),
  ...CONTACT_SCOPED_EDGE_HANDLERS.flatMap((path) => parseCapabilityConstants(fs.readFileSync(path, "utf8"))),
];
const requiredClassifications = [];
const merchantDeclarations='supabase/functions/_shared/sales-payments/merchant-capability.ts';
if(fs.existsSync(merchantDeclarations)){
  const sources=MERCHANT_PATHS.map(path=>fs.readFileSync(path,'utf8'));
  if(!salesMerchantDoorBound(...sources))throw Error('Sales merchant declaration lost its mounted Chat/shared-governance binding');
  const keys=parseMerchantActions(sources[5]);
  importedTools.push(...keys);
  requiredClassifications.push(...keys);
}
// The ordinary draft door uses the same shared gate; the high-only Kit adapter is not widened.
// Follow its real Chat import/dispatch and declaration, rather than exempting a new policy key.
const draftDoor = 'supabase/functions/sales-invoice-draft-command/index.ts';
if (fs.existsSync(draftDoor)) {
  const salesChat = fs.readFileSync('supabase/functions/_shared/sales-invoice-chat.ts','utf8');
  const draftChat = fs.readFileSync('supabase/functions/_shared/sales-commercial/draft-chat.ts','utf8');
  const admission = fs.readFileSync('supabase/functions/_shared/sales-commercial/draft-admission.ts','utf8');
  const declarations = fs.readFileSync('supabase/functions/_shared/sales-commercial/draft-capabilities.ts','utf8');
  const door = fs.readFileSync(draftDoor,'utf8');
  if (!salesDraftDoorBound(chatSrc,salesChat,draftChat,door,admission,fs.readFileSync('supabase/functions/_shared/capability-kit/decision.ts','utf8'))) throw new Error('Sales draft door lost its declared Chat/shared-governance binding');
  const keys = [...declarations.matchAll(/actionRiskKey:'([a-z0-9_]+)'/g)].map(match=>match[1]);
  if (keys.length !== 2 || new Set(keys).size !== 2) throw new Error('Sales draft declaration keys could not be parsed');
  importedTools.push(...keys);
  requiredClassifications.push(...keys);
}
if (fs.existsSync(SALES_INVOICE_HANDLER)) {
  const source = fs.readFileSync(SALES_INVOICE_HANDLER, 'utf8');
  if (!invoiceDeclaredGateBound(source, fs.readFileSync('supabase/functions/_shared/capability-kit/decision.ts', 'utf8'))) throw new Error('Invoice handler no longer binds its canonical action map and validated declaration to the governed gate');
  const actions = parseSalesInvoiceActions(fs.readFileSync(SALES_INVOICE_CONTRACT, 'utf8'));
  if (!actions.length) throw new Error('Invoice action map could not be parsed');
  governedEdgeActions.push(...actions);
  requiredClassifications.push(...actions);
}
const collectionHandlerPath = 'supabase/functions/sales-collection-command/index.ts';
if (fs.existsSync(collectionHandlerPath)) {
  // Reuse the closed adapter proof, with only the domain's imported symbols changed.
  const source = fs.readFileSync(collectionHandlerPath,'utf8')
    .replaceAll('COLLECTION_ACTIONS','SALES_INVOICE_ACTIONS')
    .replaceAll('SALES_COLLECTION_KIT_BY_ACTION','SALES_INVOICE_KIT_BY_ACTION')
    .replaceAll('domains/sales_collections.ts','domains/sales_invoice.ts');
  if (!invoiceDeclaredGateBound(source,fs.readFileSync('supabase/functions/_shared/capability-kit/decision.ts','utf8'))) throw new Error('Collections handler lost canonical declared governance');
  const contract=fs.readFileSync('supabase/functions/_shared/sales-collections/contract.ts','utf8');
  const map=contract.slice(contract.indexOf('export const COLLECTION_ACTIONS ='),contract.indexOf('} as const;'));
  const actions=[...map.matchAll(/'collection\.[a-z_]+':\s*'([a-z0-9_]+)'/g)].map(match=>match[1]);
  const expectedCollectionActions=['sales_save_collection_terms','sales_stage_collection_import','sales_commit_collection_import','sales_record_manual_payment','sales_reverse_manual_payment','sales_create_commercial_terms'];
  if(actions.length!==expectedCollectionActions.length||new Set(actions).size!==actions.length||expectedCollectionActions.some(action=>!actions.includes(action)))throw new Error('Collections closed action map could not be parsed');
  governedEdgeActions.push(...actions);
  requiredClassifications.push(...actions);
}
// The Studio publish door. Until it exists, the keys only it runs are classified but declared by
// nothing — the ghost rule reports them, which is the truth on a tree without the door.
if (fs.existsSync(STUDIO_PUBLISH_HANDLER)) {
  if (!studioPublishDoorBound(fs.readFileSync(STUDIO_PUBLISH_HANDLER, 'utf8'))) throw new Error('Studio publish door no longer binds STUDIO_PUBLISH_KIT_BY_ACTION to the canonical Kit gate (decideDeclaredCapability)');
  const actions = parseStudioPublishActions(fs.readFileSync(STUDIO_PUBLISH_MAP, 'utf8'));
  if (!actions.length) throw new Error('Studio publish declaration map could not be parsed');
  governedEdgeActions.push(...actions);
  requiredClassifications.push(...actions);
}
if (!mcpCanonicals.length) {
  console.error(`✗ action-risk-lint: read no canonical keys out of ${MCP_POLICY}. That file is the MCP door's second declaring surface, so an empty read would silently condemn every MCP-only classification as a ghost. Fix this guard rather than letting it pass.`);
  process.exit(1);
}
const problems = findings({
  policy,
  exemptions,
  chat: parseChat(chatSrc, importedTools),
  verbSourceMatches,
  mcpCanonicals,
  governedEdgeActions,
  requiredClassifications,
});

if (problems.length) {
  console.error(`✗ action-risk-lint: ${problems.length} problem(s).\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error(`\n  The policy is ${POLICY}. An action with no classification cannot run, on purpose:`);
  console.error(`  the permissive default is what let a hand-maintained list go quietly out of date.`);
  process.exit(1);
}
const by = (r) => policy.filter((p) => p.risk === r).length;
console.log(`✓ action-risk-lint: ${policy.length} classified action(s) — ${by("ordinary")} ordinary · ${by("high")} high · ${by("owner_only")} owner-only · ${exemptions.length} exempted · 0 unclassified writes.`);
}
