#!/usr/bin/env node
/**
 * tool-catalogue-lint — every tool the runtime GOVERNS must be one the operator can SEE.
 *
 * THE GAP THIS GUARDS, measured 2026-08-24. `paige-ai-chat`'s `MUTATING_TOOLS` is the runtime
 * autonomy gate: 46 tools that write, create or change state, each defaulting to `confirm` so
 * Paige proposes before she acts. `list_tool_autonomy()` is the catalogue the operator's
 * Capabilities surface renders — and it carries 23. **The other 23 are governed and invisible.**
 * They cannot be flipped to autopilot, and — the half that matters — they cannot be turned OFF.
 * Among them: `n8n_delete_workflow` (permanent, by its own description), `marketplace_install`,
 * `forge_subagent`, `update_business_profile`, and the whole `plan_*` family.
 *
 * It is drift, not a decision. The Studio migration says so in its own header: it re-declared the
 * catalogue "from a copy" and the copy predated those tools. CD saw a slice of it and wrote
 * "Four automation tools are gated at runtime but missing"; the task ledger recorded five. The
 * real number is 23, which is what happens to a hand-maintained list that has no check.
 *
 * SO THIS IS A RATCHET, NOT A WALL. Failing outright would block every unrelated PR on a
 * pre-existing gap, so the known 23 are the baseline: the guard fails when the gap GROWS — a new
 * governed tool added with no catalogue row — and tells you to lower the baseline when it
 * shrinks. Same shape as `scripts/ci/tsc-ratchet.mjs`, for the same reason.
 *
 * ── TWO MORE HOLES, CLOSED 2026-09-24 ────────────────────────────────────────────────────────────
 *
 * THE STALE COPY. `list_tool_autonomy` is CREATE OR REPLACEd with its WHOLE body, so the newest
 * declaration by filename is the only one prod runs. Two lanes each write a migration from a copy
 * of the catalogue, and whichever sorts later silently erases the other's rows. Each PR is
 * internally consistent and passes alone. This is not hypothetical and it is not rare — the chain
 * carries FIVE removal events, and the largest is 25 rows:
 *
 *   PR #1237 landed 20270305000000 at 12:45 on 2026-09-13, written from a pre-CRM copy.
 *   PR #1252 landed 20270316000000 at 17:16, from the same copy.
 *   PR #1234 landed 20270204000000 at 23:50 — adding 25 governed CRM rows at a version that sorts
 *   BEFORE both. Its rows were shadowed the instant it merged, so the same PR had to ship
 *   20270318000000 to put them back. That migration's own header records it: the earlier body
 *   "hides 23 source-backed CRM controls plus two already-classified paid credit-pull controls."
 *
 * A human caught that one by hand. Note where the new file sorted — EARLIER than the tip — so a
 * "compare the newest declaration against the one before it" check would have seen +25/-0 and
 * passed. The removal is only visible by walking EVERY consecutive pair in the chain, which is
 * what `shadowedRemovals` does. It is also genuinely pre-merge: a PR branch carries the other
 * lane's already-merged migration, so the shadowing is present in the tree CI tests.
 *
 * A removal is legitimate sometimes. It has to be SAID: a `-- catalogue-removal-ok: <key> — <why>`
 * line in the migration that drops it. History predates the rule, so the 42 existing removals are
 * baselined by exact (migration, key) pair in `tool-catalogue-shadow-baseline.json` — never a
 * count, for the reason stated just below.
 *
 * THE OTHER DIRECTION. The guard graded `runtime \ catalogue` and nothing else, so a dropped row
 * for a tool that is NOT runtime-governed vanished silently. That blind spot is closed above: the
 * chain check compares KEY SETS and does not care whether a key is governed. What the guard does
 * NOT do is demand that non-mutating tools be catalogued — see `phantomRows` for why.
 *
 *   node scripts/ci/tool-catalogue-lint.mjs
 *   node scripts/ci/tool-catalogue-lint.mjs --self-test
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

/**
 * The baseline is a COUNT plus the exact keys, because a count alone can stay flat while the
 * membership churns — one tool quietly dropped from the catalogue and another added would net to
 * zero and pass. Listing them makes any swap visible.
 */
// THE BASELINE IS NOW EMPTY, AND THAT IS THE POINT.
//
// This list used to name 23 tools that the runtime gated but the catalogue never offered — the
// operator could not see them and, more to the point, could not turn them off. Migration
// 20261020000000 completed the catalogue, so the gap is CLOSED and the ratchet's job changes from
// "hold it from growing" to "hold it AT zero".
//
// Do NOT re-populate this to get a new tool past the guard. A tool in MUTATING_TOOLS with no
// catalogue row is governed invisibly; the fix is a migration that adds the row, not an entry here.
const KNOWN_UNGOVERNED = [];

const POLICY = "supabase/functions/_shared/action-risk.ts";
const CHAT = "supabase/functions/paige-ai-chat/index.ts";
const NATIVE = "supabase/functions/_shared/paige-orchestration/native-adapter.ts";

/** Read classification is proved from the shipped adapter registry, never from catalogue wording.
 * Accept only a constant object descriptor, bound by its exact local/named import and by all three
 * actual adapter delegates. No dynamic imports, spreads, mutable registry or unregistered exports.
 * This is a source contract check; it grants no tool, schedule, tenant or execution authority.
 */
export function registeredNativeReadTools(text = fs.readFileSync(NATIVE, "utf8"), file = NATIVE,
  load = module => fs.readFileSync(module, "utf8")) {
  const require = (ok, why) => { if (!ok) throw new Error(`native catalogue binding: ${why}`); };
  const parse = (code, name) => {
    const result = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    require(result.parseDiagnostics.length === 0, `${name} must parse`);
    const inspect = node => {
      require(!(ts.isIdentifier(node) && ["eval", "Function"].includes(node.text)), `${name} cannot use dynamic evaluation`);
      ts.forEachChild(node, inspect);
    };
    inspect(result);
    require(!result.statements.some(ts.isExpressionStatement), `${name} cannot execute top-level mutations or escapes`);
    return result;
  };
  const unwrap = n => n && (ts.isAsExpression(n) || ts.isParenthesizedExpression(n)
    || ts.isTypeAssertionExpression(n) || ts.isSatisfiesExpression(n)) ? unwrap(n.expression) : n;
  const identifier = n => n && ts.isIdentifier(n) ? n.text : null;
  const literal = n => { n = unwrap(n); return n && ts.isStringLiteral(n) ? n.text : null; };
  const allowedUses = (source, name, allowed) => {
    // Match actual identifier nodes, rather than trying to enumerate all ways JavaScript can mutate.
    // A new alias, Reflect call, computed escape or future source shape is unproven and fails closed.
    const walk = node => {
      require(!(ts.isIdentifier(node) && node.text === name) || allowed.has(node), `${name} has an unapproved reference or escape`);
      ts.forEachChild(node, walk);
    };
    walk(source);
  };
  const properties = (value, name) => {
    value = unwrap(value); require(value && ts.isObjectLiteralExpression(value), `${name} must be an object literal`);
    const out = new Map();
    for (const p of value.properties) {
      require(ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p), `${name} cannot spread or borrow properties`);
      const key = identifier(p.name) ?? literal(p.name);
      require(key && !out.has(key), `${name} has no dynamic or duplicate properties`); out.set(key, p);
    }
    return out;
  };
  const variables = source => {
    const out = new Map();
    for (const s of source.statements.filter(ts.isVariableStatement)) for (const d of s.declarationList.declarations) {
      const name = identifier(d.name); if (!name) continue;
      require(!out.has(name), `${name} must have one declaration`);
      out.set(name, { node: d, value: d.initializer, constant: !!(s.declarationList.flags & ts.NodeFlags.Const),
        exported: !!s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) });
    }
    return out;
  };
  const descriptor = (source, name, exported = false) => {
    const declaration = variables(source).get(name);
    require(declaration?.constant && (!exported || declaration.exported), `${name} must be a constant${exported ? " export" : ""}`);
    return properties(declaration.value, name);
  };
  const source = parse(text, file), local = variables(source);
  const registry = descriptor(source, "NATIVE_EXECUTORS");
  const adapter = descriptor(source, "nativeAdapter", true);
  const registryUses = new Set([local.get("NATIVE_EXECUTORS").node.name]);
  allowedUses(source, "nativeAdapter", new Set([local.get("nativeAdapter").node.name]));
  require(literal(adapter.get("kind")?.initializer) === "native", "nativeAdapter must be the native adapter");
  for (const operation of ["resolveCapability", "dispatch", "readback"]) {
    const method = adapter.get(operation);
    require(method && ts.isMethodDeclaration(method) && method.body, `${operation} must be an actual method`);
    const inputIndex = operation === "readback" ? 1 : 0;
    const input = identifier(method.parameters[inputIndex]?.name);
    require(input, `${operation} must have its input parameter`);
    const statements = method.body.statements, first = statements[0];
    require(statements.length === (operation === "resolveCapability" ? 2 : 3)
      && first && ts.isVariableStatement(first) && !!(first.declarationList.flags & ts.NodeFlags.Const)
      && first.declarationList.declarations.length === 1, `${operation} must begin with one const registry lookup and no dead/early delegates`);
    const bindings = method.body.statements.filter(ts.isVariableStatement).flatMap(s => s.declarationList.declarations)
      .filter(d => d.initializer && ts.isElementAccessExpression(d.initializer)
        && identifier(d.initializer.expression) === "NATIVE_EXECUTORS");
    require(bindings.length === 1, `${operation} must resolve exactly one registry entry`);
    const bound = identifier(bindings[0].name), index = bindings[0].initializer.argumentExpression;
    registryUses.add(bindings[0].initializer.expression);
    const boundUses = new Set([bindings[0].name]);
    require(bound && (operation === "resolveCapability" ? identifier(index) === input
      : ts.isPropertyAccessExpression(index) && identifier(index.expression) === input && index.name.text === "actionKind"),
    `${operation} must select the input's action kind`);
    if (operation !== "resolveCapability") {
      const guard = statements[1];
      require(ts.isIfStatement(guard) && !guard.elseStatement && ts.isPrefixUnaryExpression(guard.expression)
        && guard.expression.operator === ts.SyntaxKind.ExclamationToken && identifier(guard.expression.operand) === bound
        && ts.isReturnStatement(guard.thenStatement), `${operation} can return early only when its registry entry is absent`);
      boundUses.add(guard.expression.operand);
    }
    const end = method.body.statements.at(-1);
    require(end && ts.isReturnStatement(end), `${operation} must return its delegate`);
    const expression = end.expression;
    if (operation === "resolveCapability") {
      require(expression && ts.isConditionalExpression(expression) && identifier(expression.condition) === bound
        && ts.isPropertyAccessExpression(expression.whenTrue) && identifier(expression.whenTrue.expression) === bound
        && expression.whenTrue.name.text === "capability" && expression.whenFalse.kind === ts.SyntaxKind.NullKeyword,
      "resolveCapability must return the registered descriptor");
      boundUses.add(expression.condition); boundUses.add(expression.whenTrue.expression);
    } else {
      require(expression && ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
        && identifier(expression.expression.expression) === bound && expression.expression.name.text === operation
        && expression.arguments.length === (operation === "dispatch" ? 1 : 2)
        && identifier(expression.arguments.at(-1)) === input
        && (operation !== "readback" || identifier(expression.arguments[0]) === identifier(method.parameters[0]?.name)),
      `${operation} must call the registered executor with its input`);
      boundUses.add(expression.expression.expression);
    }
    allowedUses(method, bound, boundUses);
  }
  const router = source.statements.find(n => ts.isFunctionDeclaration(n) && identifier(n.name) === "isNativeActionKind");
  const routerKey = identifier(router?.parameters[0]?.name), routing = router?.body?.statements[0]?.expression;
  require(router?.body?.statements.length === 1 && ts.isReturnStatement(router.body.statements[0])
    && routing && ts.isBinaryExpression(routing) && routing.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    && ts.isPrefixUnaryExpression(routing.left) && routing.left.operator === ts.SyntaxKind.ExclamationToken
    && ts.isPrefixUnaryExpression(routing.left.operand) && routing.left.operand.operator === ts.SyntaxKind.ExclamationToken
    && identifier(routing.left.operand.operand) === routerKey && ts.isCallExpression(routing.right)
    && routing.right.expression.getText(source) === "Object.prototype.hasOwnProperty.call"
    && routing.right.arguments.length === 2 && identifier(routing.right.arguments[0]) === "NATIVE_EXECUTORS"
    && identifier(routing.right.arguments[1]) === routerKey, "native action routing must read the same registry");
  registryUses.add(routing.right.arguments[0]);
  // The incumbent unit-test hook exposes the registry as a constant shorthand property.
  // Preserve that exact inspection export, but permit no alias or subsequent use of the hook.
  const testHook = local.get("__test");
  if (testHook) {
    require(testHook.constant && testHook.exported && ts.isObjectLiteralExpression(testHook.value), "test hook must remain a constant inspection export");
    for (const member of testHook.value.properties) {
      require(ts.isShorthandPropertyAssignment(member), "test hook cannot introduce computed bindings or aliases");
      if (member.name.text === "NATIVE_EXECUTORS") registryUses.add(member.name);
      else require(source.statements.some(n => ts.isFunctionDeclaration(n) && identifier(n.name) === member.name.text), "test hook may only expose its local helpers");
    }
    allowedUses(source, "__test", new Set([testHook.node.name]));
  }
  allowedUses(source, "NATIVE_EXECUTORS", registryUses);
  const imports = new Map();
  for (const statement of source.statements.filter(ts.isImportDeclaration)) {
    const clause = statement.importClause, bindings = clause?.namedBindings;
    if (!clause || clause.isTypeOnly || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements.filter(b => !b.isTypeOnly)) {
      require(!imports.has(binding.name.text) && !local.has(binding.name.text), "import symbols must be unambiguous");
      imports.set(binding.name.text, { symbol: (binding.propertyName ?? binding.name).text,
        node: binding.name, module: literal(statement.moduleSpecifier) });
    }
  }
  const reads = new Set();
  for (const [actionKind, entry] of registry) {
    require(ts.isPropertyAssignment(entry) && /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/.test(actionKind), "registry keys must be literal action kinds");
    const name = identifier(unwrap(entry.initializer)); require(name, "registry entries must bind an exact executor symbol");
    allowedUses(source, name, new Set([entry.initializer, local.get(name)?.node.name ?? imports.get(name)?.node]));
    let executor;
    if (local.has(name)) executor = descriptor(source, name);
    else {
      const imported = imports.get(name); require(imported?.module?.startsWith("./"), `${name} must be a named sibling import`);
      const module = path.resolve(path.dirname(path.resolve(file)), imported.module);
      require(path.dirname(module) === path.dirname(path.resolve(file)) && path.extname(module) === ".ts", "executor module must be a sibling TypeScript source");
      const importedSource = parse(load(module), module);
      executor = descriptor(importedSource, imported.symbol, true);
      allowedUses(importedSource, imported.symbol, new Set([variables(importedSource).get(imported.symbol).node.name]));
    }
    const capability = properties(executor.get("capability")?.initializer, `${name}.capability`);
    if (literal(capability.get("effect")?.initializer) !== "read") continue; // mutations still require RISK
    const key = literal(capability.get("id")?.initializer);
    require(key && key === actionKind.replaceAll(".", "_") && !reads.has(key), "read id must bind uniquely to its registered action kind");
    for (const operation of ["dispatch", "readback"]) {
      const member = executor.get(operation), value = unwrap(member?.initializer);
      require(member && (ts.isMethodDeclaration(member) || (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)))),
        `${name} must implement ${operation}`);
    }
    reads.add(key);
  }
  return reads;
}

/**
 * THE GATED SET MOVED, AND THIS GUARD FOLLOWED IT RATHER THAN BEING DELETED.
 *
 * `MUTATING_TOOLS` used to be a literal inside the handler and is now derived from the action-risk
 * policy, which classifies every mutation once. The set this guard grades is unchanged — every
 * tool the runtime governs — so it reads the policy's table instead of the handler's literal. A
 * guard that cannot find its subject still fails loudly rather than passing quietly, because
 * "found nothing, therefore nothing is wrong" is the failure mode these guards exist to avoid.
 */
function runtimeTools() {
  const src = fs.readFileSync(POLICY, "utf8");
  const at = src.indexOf("const RISK: ReadonlyArray<readonly [string, ActionRisk, string]> = [");
  const close = at < 0 ? -1 : src.indexOf("\n];", at);
  if (at < 0 || close < 0) {
    console.error(`✗ tool-catalogue-lint: could not find the classification table in ${POLICY}.`);
    console.error("  The policy was renamed or changed shape. Update this guard rather than deleting it —");
    console.error("  a guard that cannot find its subject must fail loudly, never pass quietly.");
    process.exit(1);
  }
  const tools = [...src.slice(at, close).matchAll(
    /\[\s*"([a-z0-9_]+)"\s*,\s*"(?:ordinary|high|owner_only)"\s*,/g)].map((m) => m[1]);
  if (tools.length < 40) {
    console.error(`✗ tool-catalogue-lint: parsed only ${tools.length} governed tools from ${POLICY}.`);
    console.error("  That is too few to be real, so this guard is reading nothing. Fix the parse.");
    process.exit(1);
  }
  return new Set(tools);
}

/**
 * Does this file DECLARE list_tool_autonomy? Case-insensitive on the CREATE, and it must be a
 * CREATE — not any mention of the name.
 *
 * This was `sql.includes("FUNCTION public.list_tool_autonomy")`, a case-sensitive substring. An
 * adversarial pass EXECUTED the counter-example: a migration written in lowercase SQL
 * (`create or replace function public.list_tool_autonomy`) is invisible to that check, so the
 * guard skips the real tip, grades an OLDER file, and exits 0 — defeating two of its own asserts at
 * once. Lowercase DDL is ordinary in this repo; six of the migrations already in `supabase/migrations`
 * are written that way.
 */
const DECLARES = /create\s+or\s+replace\s+function\s+public\.list_tool_autonomy/i;
export const declaresCatalogue = (sql) => DECLARES.test(sql);

/**
 * The `VALUES` rows of one declaration, in order. `null` when the body has no catalogue block.
 *
 * Reads the LAST catalogue block in the file, not the first. A migration carrying two
 * `CREATE OR REPLACE` bodies runs both, so PROD ends up with the second — while the first version
 * of this graded the first and let a second body that dropped 20 governed rows pass green. Proven
 * by execution, not argued.
 */
function parseCatalogue(sql) {
  const starts = [...sql.matchAll(/WITH catalog\(tool_key/g)].map((m) => m.index);
  if (!starts.length) return null;
  const from = starts[starts.length - 1];
  const to = sql.indexOf("SELECT", from);
  if (to < 0) return null;
  return [...sql.slice(from, to).matchAll(/\('([a-z0-9_]+)',/g)].map((m) => m[1]);
}

/** An additive wrapper preserves the exact predecessor before returning new rows.
 * This is deliberately narrow: a filtered/conditional forwarding call cannot clear erasure.
 */
export function preservesCataloguePredecessor(sql) {
  const code=sql.replace(/--[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
  const rename=code.match(/ALTER\s+FUNCTION\s+public\.list_tool_autonomy\(uuid\)\s+RENAME\s+TO\s+([a-z0-9_]+)\s*;/i);
  if(!rename || declarationCount(code)!==1)return false;
  const name=rename[1];
  const body=code.slice(code.search(DECLARES));
  return new RegExp('BEGIN\\s+RETURN\\s+QUERY\\s+SELECT\\s+\\*\\s+FROM\\s+public\\.'+name+'\\(_tenant_id\\)\\s*;','i').test(body)
    && new RegExp('REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.'+name+'\\(uuid\\)\\s+FROM\\s+PUBLIC,anon,authenticated\\s*;','i').test(code);
}

/** More than one declaration in one file is legal SQL and a trap for any single-body reader. */
export const declarationCount = (sql) => [...sql.matchAll(new RegExp(DECLARES.source, "gi"))].length;

/**
 * A removal is allowed when the migration that drops the row SAYS SO, with a reason:
 *
 *   -- catalogue-removal-ok: pipeline_configure — superseded by pipeline_create; no runtime dispatch
 *
 * Same shape as `-- definer-anon-exempt:` in definer-fn-lint. The reason is required, because the
 * whole failure this guards is a drop nobody meant to make — a bare marker would let the accident
 * through wearing the clothes of a decision.
 */
function declaredRemovals(sql) {
  const ok = new Set();
  for (const m of sql.matchAll(/--\s*catalogue-removal-ok:\s*([a-z0-9_]+)([^\n]*)/g)) {
    if (m[2].replace(/^[\s—:-]+/, "").trim().length > 0) ok.add(m[1]);
  }
  return ok;
}

/**
 * EVERY consecutive pair in the chain, not just the last one.
 *
 * A new declaration can sort into the MIDDLE of the chain — 20270204000000 did — and then it is the
 * file AFTER it that shadows its rows, while the pair ending at the new file itself looks clean.
 * Grading only the tip would have passed the 25-row erasure that actually happened.
 */
function shadowedRemovals(decls, baseline) {
  const unexplained = [];
  const seen = new Set();
  for (let i = 1; i < decls.length; i++) {
    const prev = decls[i - 1];
    const cur = decls[i];
    const allowed = declaredRemovals(cur.sql ?? "");
    const based = new Set(baseline[cur.file] ?? []);
    for (const key of prev.keys) {
      if (cur.keys.has(key)) continue;
      if (allowed.has(key)) continue;
      if (based.has(key)) { seen.add(`${cur.file}\u0000${key}`); continue; }
      unexplained.push({ file: cur.file, key, from: prev.file });
    }
  }
  const stale = [];
  for (const [file, keys] of Object.entries(baseline)) {
    for (const key of keys) if (!seen.has(`${file}\u0000${key}`)) stale.push({ file, key });
  }
  return { unexplained, stale };
}

/**
 * IS THE CATALOGUE SUPPOSED TO CARRY NON-MUTATING TOOLS? No — and the evidence is that every row
 * it carries without a runtime classification is one the product already has to work around:
 *
 *   crm_delete_contact   a tombstone. src/__tests__/legacy-contact-delete-retirement.test.ts:190
 *                        asserts action-risk.ts must NOT list it; :77 asserts the Chat tool is gone.
 *                        The catalogue row outlived both.
 *   pipeline_create      "phantom/unclassified tools" in src/solo/data/capabilityTools.ts:171,
 *   pipeline_add_stage   listed in UNMAPPED_CATALOGUE_TOOLS so no Solo knob renders for them.
 *   social_post          filtered out at BOTH read sites — src/operator/data/useToolAutonomy.ts:90
 *                        and src/components/admin/settings/PaigeAutonomyPanel.tsx:120.
 *
 * So the catalogue is meant to be exactly the operator's view of the GOVERNED set, and this guard
 * does not ask for non-mutating rows. It grades the opposite direction instead: EVERY CATALOGUE ROW
 * HAS A MUTATION RISK CLASSIFICATION OR A SOURCE-BOUND REGISTERED NATIVE READ DESCRIPTOR.
 * Native reads carry their effect class in the canonical adapter and keep that class: treating
 * one as a mutation merely to make its actual permission switch visible would falsify the policy.
 * The same phantom rule rejects any row lacking either source contract. Baselined at the four above,
 * bites on a fifth.
 *
 * READ THE ASSERT LITERALLY, because it used to claim more than it tests. The earlier wording was
 * "a switch the operator can flip that governs nothing", which reads as a guarantee that every
 * catalogued row governs something REACHABLE. It does not test reachability, and on this tree that
 * stronger claim is false while the guard is green:
 *
 *   `crm_assign_contact` and `crm_update_pipeline_stage` are classified AND catalogued AND spliced
 *   out of the model surface at index.ts:7112-7119. Nine legacy CRM writers are spliced there; seven
 *   come back under CRM_COMMAND_TOOLS pointed at a different executor and these two do not. So the
 *   operator has two switches in the Capabilities panel that govern nothing the model can call.
 *   Verified by hand: each appears once in the tip catalogue migration and zero times in the model
 *   surface this repo's own capability-declaration baseline enumerates.
 *
 * That is a real product defect and it is NOT this guard's to fix silently. Grading reachability
 * means intersecting against the emitted tool manifest, which is the sibling guard's subject. Filed
 * rather than widened here, because an assert that quietly grows its scope is how the next reader
 * comes to trust something nobody measured.
 */
function phantomRows(catKeys, runtime, baseline) {
  const based = new Set(baseline);
  const unexplained = [...catKeys].filter((k) => !runtime.has(k) && !based.has(k)).sort();
  const stale = [...based].filter((k) => !catKeys.has(k) || runtime.has(k)).sort();
  return { unexplained, stale };
}

/**
 * Every declaration in filename order. The catalogue prod runs is the LAST one — the RPC is
 * `CREATE OR REPLACE`d with its whole body each time — but the ones before it are the history the
 * chain check needs, so they are all read here rather than only the tip.
 */
export function catalogueDeclarations() {
  const dir = "supabase/migrations";
  const decls = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    if (!declaresCatalogue(sql)) continue;
    if (declarationCount(sql) > 1) {
      console.error(`✗ tool-catalogue-lint: ${f} declares list_tool_autonomy ${declarationCount(sql)} times. ` +
        `Postgres runs them all and prod keeps the LAST, so a second body can silently drop rows the first one has. ` +
        `Split it into one declaration per migration.`);
      process.exit(1);
    }
    const keys = parseCatalogue(sql);
    if (keys === null) {
      console.error(`✗ tool-catalogue-lint: ${f} redeclares list_tool_autonomy but has no readable`);
      console.error("  catalogue block. The body changed shape. Update this guard rather than");
      console.error("  deleting it — a guard that cannot find its subject must fail loudly.");
      process.exit(1);
    }
    const inherited=preservesCataloguePredecessor(sql)?[...(decls.at(-1)?.keys??[])]:[];
    decls.push({ file: f, sql, keys: new Set([...inherited,...keys]) });
  }
  if (!decls.length) {
    console.error("✗ tool-catalogue-lint: no migration declares list_tool_autonomy.");
    process.exit(1);
  }
  return decls;
}

const BASELINE_PATH = "scripts/ci/tool-catalogue-shadow-baseline.json";

/**
 * SELF-TEST — proof the two new checks FAIL when they should.
 *
 * A guard that only ever passes is indistinguishable from a guard that reads nothing, which is the
 * exact failure the catalogue itself suffered for 23 tools. So every case asserting "clean" is
 * paired with a NEGATIVE fixture asserting the same check bites on the real defect — and the
 * headline negative is the erasure that actually happened on 2026-09-13, reproduced in miniature.
 *
 * The cases call the SHIPPED functions above, never a re-implementation of them.
 */
function selfTest() {
  let failed = 0;
  const check = (name, ok, detail) => {
    if (ok) return void console.log(`  ok   ${name}`);
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  };

  /** A declaration body in the shape the parser reads, plus any leading marker lines. */
  const decl = (file, keys, markers = "") => ({
    file,
    keys: new Set(keys),
    sql:
      `${markers}\nCREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid)\nAS $$\n` +
      `BEGIN\n  RETURN QUERY\n  WITH catalog(tool_key, label, category) AS (\n    VALUES\n` +
      keys.map((k) => `      ('${k}', 'Label', 'Cat'),`).join("\n") +
      `\n  )\n  SELECT * FROM catalog;\nEND;\n$$;\n`,
  });

  // ── the parser ─────────────────────────────────────────────────────────────────────────────────
  const wrapper="ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _prior_catalogue; REVOKE ALL ON FUNCTION public._prior_catalogue(uuid) FROM PUBLIC,anon,authenticated; CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid) AS $$ BEGIN RETURN QUERY SELECT * FROM public._prior_catalogue(_tenant_id); WITH catalog(tool_key,label) AS (VALUES ('new_action','New')) SELECT * FROM catalog; END $$;";
  check("additive wrapper forwards full private predecessor",preservesCataloguePredecessor(wrapper));
  check("NEGATIVE: filtered predecessor cannot preserve rows",!preservesCataloguePredecessor(wrapper.replace('(_tenant_id);','(_tenant_id) WHERE false;')));
  check("NEGATIVE: conditional predecessor cannot preserve rows",!preservesCataloguePredecessor(wrapper.replace('BEGIN RETURN','BEGIN IF false THEN RETURN')));
  check("NEGATIVE: a comment cannot establish forwarding",!preservesCataloguePredecessor(wrapper.replace('RETURN QUERY SELECT * FROM public._prior_catalogue(_tenant_id);','-- RETURN QUERY SELECT * FROM public._prior_catalogue(_tenant_id);\n')));

  check("parses the VALUES rows of a declaration",
    JSON.stringify(parseCatalogue(decl("a.sql", ["crm_create_contact", "crm_add_note"]).sql))
      === JSON.stringify(["crm_create_contact", "crm_add_note"]));
  check("returns null when the body carries no catalogue block (the guard then hard-fails)",
    parseCatalogue("CREATE OR REPLACE FUNCTION public.list_tool_autonomy() AS $$ SELECT 1 $$;") === null);

  // ── the removal marker ─────────────────────────────────────────────────────────────────────────
  check("a marker WITH a reason is honoured",
    declaredRemovals("-- catalogue-removal-ok: social_post — never dispatched; filtered at both reads")
      .has("social_post"));
  check("NEGATIVE: a bare marker with no reason is NOT honoured",
    !declaredRemovals("-- catalogue-removal-ok: social_post").has("social_post"),
    "a reasonless marker would let an accident through wearing the clothes of a decision");
  check("NEGATIVE: a marker for one key does not excuse another",
    !declaredRemovals("-- catalogue-removal-ok: social_post — gone on purpose").has("crm_add_note"));

  // ── shadowedRemovals: the 2026-09-13 erasure, in miniature ─────────────────────────────────────
  // Lane A adds a row at a version that sorts BEFORE the already-merged lane-B tip, so lane B's
  // stale copy erases it. Both PRs are internally consistent; only the chain shows the loss.
  const chain = [
    decl("20270127000100_base.sql", ["crm_add_note", "calendar_book_meeting"]),
    decl("20270204000000_lane_a.sql", ["crm_add_note", "calendar_book_meeting", "crm_merge_contacts"]),
    decl("20270305000000_lane_b.sql", ["crm_add_note", "calendar_book_meeting"]),
  ];

  const erased = shadowedRemovals(chain, {});
  check("NEGATIVE: the erased row is caught",
    erased.unexplained.length === 1
      && erased.unexplained[0].key === "crm_merge_contacts"
      && erased.unexplained[0].file === "20270305000000_lane_b.sql",
    `got ${JSON.stringify(erased.unexplained)}`);

  // This is the whole reason every pair is walked. Grading only the newly-added declaration against
  // the one before it — the obvious design — sees lane A's +1/-0 and passes the erasure.
  check("NEGATIVE: grading only the newly-added file would have MISSED it (why the chain is walked)",
    shadowedRemovals(chain.slice(0, 2), {}).unexplained.length === 0);

  check("a removal declared in the migration that makes it is clean",
    shadowedRemovals([chain[0], chain[1], decl("20270305000000_lane_b.sql",
      ["crm_add_note", "calendar_book_meeting"],
      "-- catalogue-removal-ok: crm_merge_contacts — folded into crm_update_contact; no dispatch left",
    )], {}).unexplained.length === 0);

  check("a baselined removal is clean",
    shadowedRemovals(chain, { "20270305000000_lane_b.sql": ["crm_merge_contacts"] })
      .unexplained.length === 0);

  check("NEGATIVE: the baseline excuses ONLY its exact key, never the whole file",
    shadowedRemovals(
      [chain[0], chain[1], decl("20270305000000_lane_b.sql", ["crm_add_note"])],
      { "20270305000000_lane_b.sql": ["crm_merge_contacts"] },
    ).unexplained.map((x) => x.key).join() === "calendar_book_meeting");

  check("NEGATIVE: a baseline entry that no longer describes a real removal is reported stale",
    shadowedRemovals(chain, { "20270305000000_lane_b.sql": ["crm_merge_contacts", "gone_long_ago"] })
      .stale.map((x) => x.key).join() === "gone_long_ago");

  check("an unbroken chain is clean",
    shadowedRemovals([chain[0], chain[1]], {}).unexplained.length === 0
      && shadowedRemovals([chain[0], chain[1]], {}).stale.length === 0);

  // ── phantomRows ────────────────────────────────────────────────────────────────────────────────
  const rt = new Set(["crm_add_note", "calendar_book_meeting"]);
  const catalogue = new Set(["crm_add_note", "calendar_book_meeting", "social_post"]);

  check("NEGATIVE: a catalogue row with no action-risk classification is caught",
    phantomRows(catalogue, rt, []).unexplained.join() === "social_post");
  check("a baselined phantom is clean",
    phantomRows(catalogue, rt, ["social_post"]).unexplained.length === 0);
  check("NEGATIVE: a SECOND phantom still bites through the baseline",
    phantomRows(new Set([...catalogue, "pipeline_create"]), rt, ["social_post"])
      .unexplained.join() === "pipeline_create");
  check("a phantom that gets classified is reported stale, so the baseline shrinks",
    phantomRows(catalogue, new Set([...rt, "social_post"]), ["social_post"]).stale.join() === "social_post");
  check("a phantom whose row is dropped is reported stale too",
    phantomRows(new Set(["crm_add_note"]), rt, ["social_post"]).stale.join() === "social_post");
  check("a catalogue that is exactly the governed set is clean",
    phantomRows(rt, rt, []).unexplained.length === 0);

  // ── registered native reads: descriptor → exact import → registry → actual adapter delegates ───
  const nativeFixture = `import { observationExecutor as observer } from "./observation.ts";
    const NATIVE_EXECUTORS = { "planning.observe": observer };
    export function isNativeActionKind(kind: string) { return !!kind && Object.prototype.hasOwnProperty.call(NATIVE_EXECUTORS, kind); }
    export const nativeAdapter = { kind: "native",
      resolveCapability(actionKind: string) { const ex = NATIVE_EXECUTORS[actionKind]; return ex ? ex.capability : null; },
      async dispatch(input: any) { const ex = NATIVE_EXECUTORS[input.actionKind]; if (!ex) return null; return ex.dispatch(input); },
      async readback(providerRef: any, input: any) { const ex = NATIVE_EXECUTORS[input.actionKind]; if (!ex) return null; return ex.readback(providerRef, input); }
    };`;
  const descriptorFixture = `export const observationExecutor = {
    capability: { id: "planning_observe", effect: "read" as const },
    dispatch: (input: any) => call(input, false), readback: (ref: any, input: any) => call(input, true)
  };`;
  const reads = (registry = nativeFixture, descriptor = descriptorFixture) => registeredNativeReadTools(
    registry, "/fixture/native-adapter.ts", file => file === path.resolve("/fixture/observation.ts") ? descriptor : "");
  check("a registered imported native read has a source-bound catalogue key", reads().has("planning_observe"));
  check("registered native read clears its catalogue row without mutation classification",
    phantomRows(new Set(["planning_observe"]), reads(), []).unexplained.length === 0);
  const remainsPhantom = (registry, descriptor) => {
    try { return phantomRows(new Set(["planning_observe"]), reads(registry, descriptor), []).unexplained.length === 1; }
    catch { return true; } // invalid source fails the gate as well
  };
  check("NEGATIVE: an unregistered native descriptor remains phantom",
    remainsPhantom(nativeFixture.replace('"planning.observe": observer', ''), descriptorFixture));
  check("NEGATIVE: a native mutation cannot masquerade as a classified read",
    remainsPhantom(nativeFixture, descriptorFixture.replace('effect: "read"', 'effect: "mutate"')));
  check("NEGATIVE: a descriptor id misbound to its registered action remains phantom",
    remainsPhantom(nativeFixture, descriptorFixture.replace('id: "planning_observe"', 'id: "other_read"')));
  check("NEGATIVE: a different imported symbol cannot borrow the read descriptor",
    remainsPhantom(nativeFixture.replace('observationExecutor as', 'missingExecutor as'), descriptorFixture));
  check("NEGATIVE: a comment containing the import establishes no binding",
    remainsPhantom(nativeFixture.replace('import {', '// import {'), descriptorFixture));
  check("NEGATIVE: a missing readback is not a registered native read",
    remainsPhantom(nativeFixture, descriptorFixture.replace('readback:', 'unbound:')));
  check("NEGATIVE: adapter dispatch must delegate through the registered executor",
    remainsPhantom(nativeFixture.replace('return ex.dispatch(input)', 'return null'), descriptorFixture));
  check("NEGATIVE: adapter capability resolution cannot fabricate a read descriptor",
    remainsPhantom(nativeFixture.replace('return ex ? ex.capability : null', 'return { id: "planning_observe", effect: "read" }'), descriptorFixture));
  check("NEGATIVE: adapter readback must delegate to the registered readback",
    remainsPhantom(nativeFixture.replace('return ex.readback(providerRef, input)', 'return ex.dispatch(input)'), descriptorFixture));
  check("NEGATIVE: a duplicate effect property cannot hide a mutation",
    remainsPhantom(nativeFixture, descriptorFixture.replace('effect: "read" as const', 'effect: "read", effect: "mutate"')));
  check("NEGATIVE: a read descriptor mutated after its declaration remains unproven",
    remainsPhantom(nativeFixture, descriptorFixture + '\nobservationExecutor.capability.effect = "mutate" as any;'));
  check("NEGATIVE: Object.assign cannot replace a nested descriptor effect",
    remainsPhantom(nativeFixture, descriptorFixture + '\nObject.assign(observationExecutor.capability, { effect: "mutate" });'));
  check("NEGATIVE: Object.assign cannot replace a registered executor",
    remainsPhantom(nativeFixture + '\nObject.assign(NATIVE_EXECUTORS, { "planning.observe": mutationExecutor });', descriptorFixture));
  check("NEGATIVE: an unconditional early return cannot leave a dead dispatch delegate",
    remainsPhantom(nativeFixture.replace('async dispatch(input: any) {', 'async dispatch(input: any) { return null;'), descriptorFixture));
  check("NEGATIVE: a mutable lookup cannot substitute another executor",
    remainsPhantom(nativeFixture.replace('const ex = NATIVE_EXECUTORS[input.actionKind];', 'let ex = NATIVE_EXECUTORS[input.actionKind]; ex = mutationExecutor;'), descriptorFixture));
  check("NEGATIVE: an alias cannot mutate the descriptor effect",
    remainsPhantom(nativeFixture, descriptorFixture + '\nconst alias = observationExecutor.capability; alias.effect = "mutate" as any;'));
  check("NEGATIVE: deleting descriptor metadata cannot retain a proven read",
    remainsPhantom(nativeFixture, descriptorFixture + '\ndelete observationExecutor.capability.effect;'));
  check("NEGATIVE: an unknown mutator cannot receive a descriptor alias",
    remainsPhantom(nativeFixture, descriptorFixture + '\nconst alias = observationExecutor.capability; mutate(alias);'));
  check("NEGATIVE: Reflect.set cannot alter a nested descriptor",
    remainsPhantom(nativeFixture, descriptorFixture + '\nfunction hidden() { Reflect.set(observationExecutor.capability, "effect", "mutate"); }'));
  check("NEGATIVE: Reflect.deleteProperty cannot erase readback",
    remainsPhantom(nativeFixture, descriptorFixture + '\nfunction hidden() { Reflect.deleteProperty(observationExecutor, "readback"); }'));
  check("NEGATIVE: a nested mutation through an alias remains unproven",
    remainsPhantom(nativeFixture, descriptorFixture + '\nfunction hidden() { const alias = observationExecutor; Object.assign(alias.capability, { effect: "mutate" }); }'));
  check("NEGATIVE: parenthesized mutation calls cannot evade allowed uses",
    remainsPhantom(nativeFixture, descriptorFixture + '\nfunction hidden() { (Object.assign)(observationExecutor.capability, { effect: "mutate" }); }'));
  check("NEGATIVE: updating descriptor metadata remains unproven",
    remainsPhantom(nativeFixture, descriptorFixture + '\nfunction hidden() { observationExecutor.capability.id++; }'));
  check("NEGATIVE: dynamic evaluation cannot manufacture a descriptor binding",
    remainsPhantom(nativeFixture, descriptorFixture + '\nfunction hidden() { eval("change the descriptor"); }'));
  check("NEGATIVE: a phantom key cannot borrow an unrelated registered read",
    phantomRows(new Set(["phantom_read"]), reads(), []).unexplained.join() === "phantom_read");

  if (failed) {
    console.error(`\n✗ tool-catalogue-lint self-test: ${failed} failed.`);
    return 1;
  }
  console.log("\n✓ tool-catalogue-lint self-test: every check bites when it should.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
if (process.argv.includes("--self-test")) process.exit(selfTest());

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
const mutationRuntime = runtimeTools();
let nativeReads;
try { nativeReads = registeredNativeReadTools(); }
catch (error) { console.error(`✗ tool-catalogue-lint: ${error.message}`); process.exit(1); }
const runtime = new Set([...mutationRuntime, ...nativeReads]);
const decls = catalogueDeclarations();
const cat = { file: decls[decls.length - 1].file, keys: decls[decls.length - 1].keys };
const ungoverned = [...runtime].filter((k) => !cat.keys.has(k)).sort();
const known = new Set(KNOWN_UNGOVERNED);
const isNew = ungoverned.filter((k) => !known.has(k));
const fixed = KNOWN_UNGOVERNED.filter((k) => cat.keys.has(k));

if (isNew.length) {
  console.error(
    `✗ tool-catalogue-lint: ${isNew.length} newly governed tool(s) the operator cannot see or turn off:`,
  );
  for (const k of isNew) console.error(`    ${k}`);
  console.error(
    `\n  Every classified mutation or registered native read requires a row in list_tool_autonomy.` +
      `\n  is governed INVISIBLY — the operator cannot flip it to autopilot and, more to the point,` +
      `\n  cannot turn it off. Add it to the catalogue in a new migration that CREATE OR REPLACEs` +
      `\n  list_tool_autonomy (${cat.file} is the current one), with an operator-facing label and a` +
      `\n  category from the existing set. Do not add it to this guard's baseline to get past it.`,
  );
  process.exit(1);
}

if (fixed.length) {
  console.error(
    `✗ tool-catalogue-lint: ${fixed.length} tool(s) are now in the catalogue but still listed as` +
      ` a known gap here:`,
  );
  for (const k of fixed) console.error(`    ${k}`);
  console.error("\n  Good news — remove them from KNOWN_UNGOVERNED so the ratchet holds the gain.");
  process.exit(1);
}

const shadow = shadowedRemovals(decls, baseline.shadowedRemovals ?? {});
if (shadow.unexplained.length) {
  console.error(
    `✗ tool-catalogue-lint: ${shadow.unexplained.length} catalogue row(s) are erased by a later` +
      ` declaration with no reason given:`,
  );
  for (const r of shadow.unexplained) console.error(`    ${r.key}  (present in ${r.from}, gone in ${r.file})`);
  console.error(
    `\n  list_tool_autonomy is CREATE OR REPLACEd with its WHOLE body, so the newest declaration by` +
      `\n  filename is the only one prod runs. A migration written from a copy of the catalogue` +
      `\n  erases every row added after that copy was taken — which is how 25 governed CRM controls` +
      `\n  were shadowed on 2026-09-13 and had to be restored by a second migration in the same PR.` +
      `\n` +
      `\n  If the drop is an ACCIDENT — the usual case — re-add those rows to the declaration that` +
      `\n  lost them. Take the copy from the current tip (${cat.file}), not from your branch point.` +
      `\n  If the drop is DELIBERATE, say so in that migration, one line per row:` +
      `\n      -- catalogue-removal-ok: ${shadow.unexplained[0].key} — <why this row should go>` +
      `\n  The reason is required. Do not add it to the baseline: that file is closed history.`,
  );
  process.exit(1);
}

if (shadow.stale.length) {
  console.error(
    `✗ tool-catalogue-lint: ${shadow.stale.length} baselined removal(s) no longer happen:`,
  );
  for (const r of shadow.stale) console.error(`    ${r.key}  (baselined against ${r.file})`);
  console.error(
    `\n  Either the row came back or a declaration was inserted into the middle of the chain, which` +
      `\n  re-links which file follows which. Both are worth a look. Drop these entries from` +
      `\n  ${BASELINE_PATH} so the ratchet holds the gain.`,
  );
  process.exit(1);
}

const phantom = phantomRows(cat.keys, runtime, baseline.phantomRows ?? []);
if (phantom.unexplained.length) {
  console.error(
    `✗ tool-catalogue-lint: ${phantom.unexplained.length} catalogue row(s) govern nothing:`,
  );
  for (const k of phantom.unexplained) console.error(`    ${k}`);
  console.error(
    `\n  These have a row the operator can toggle but no mutation class in ${POLICY}` +
      `\n  and no source-bound native read descriptor. Establish the appropriate canonical class` +
      `\n  and registry binding, or drop the row in a new declaration with a` +
      `\n  \`-- catalogue-removal-ok:\` line saying why.`,
  );
  process.exit(1);
}

if (phantom.stale.length) {
  console.error(
    `✗ tool-catalogue-lint: ${phantom.stale.length} baselined phantom row(s) are phantoms no longer:`,
  );
  for (const k of phantom.stale) console.error(`    ${k}`);
  console.error(
    `\n  Good news — they are classified or gone. Remove them from ${BASELINE_PATH}.`,
  );
  process.exit(1);
}

console.log(
  `✓ tool-catalogue-lint: ${mutationRuntime.size} classified mutation(s) + ${nativeReads.size} registered native read(s) · ${cat.keys.size} in the catalogue` +
    ` · ${ungoverned.length} governed-but-invisible (baseline, not grown).`,
);
console.log(
  `  ${decls.length} declaration(s) in the chain · every consecutive pair checked for erased rows` +
    ` · ${(baseline.phantomRows ?? []).length} unclassified row(s) (baseline, not grown).`,
);
if (ungoverned.length) {
  console.log(
    `  Those ${ungoverned.length} are real: the operator cannot turn them off. Closing the gap is` +
      ` the catalogue-completion task, and this guard stops it widening in the meantime.`,
  );
}

// INT-080: the operator catalogue and the provider manifest are two views of the same governed
// tool population. Exercise the shipped Chat handler through the repository's offline loader so
// a provider-incompatible schema cannot pass this already-required tool-catalogue CI step.
const contractCheck = spawnSync(process.execPath, [
  "--import", "./scripts/knowledge-scope/register.mjs",
  "scripts/ci/paige-chat-tool-contract-check.mjs",
], { stdio: "inherit" });
if (contractCheck.error || contractCheck.status !== 0) {
  console.error(`✗ tool-catalogue-lint: Anthropic tool contract check failed${contractCheck.error ? ` — ${contractCheck.error.message}` : ""}.`);
  process.exit(contractCheck.status ?? 1);
}

}
