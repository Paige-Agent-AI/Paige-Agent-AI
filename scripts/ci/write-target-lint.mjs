#!/usr/bin/env node
/**
 * Every `WRITE_TARGET` value must name a table this repository actually creates, or be declared a
 * deliberate non-table label.
 *
 * WHAT IT IS. `WRITE_TARGET` supplies the `target_type` on the attribution row written for each
 * mutating tool — the record a write landed on, so a person tracing "what did Paige change" reaches
 * something real. It is the readable half of the audit trail: the id says WHICH row, this says
 * which KIND of row, and a wrong value makes the pair unresolvable.
 *
 * WHY IT EXISTS. Four values named tables that have never existed anywhere — `activities`,
 * `calendar_events`, `content`, `event_kinds` — so the attribution rows for SEVEN tools pointed at
 * nothing. Found by grounding the map against production, not by any gate.
 *
 * THE GATE THAT COULD NOT SEE IT. The harness already asserted that a rail event NAMES the record
 * it changed, and that every executable mutation names an entity. A wrong name satisfies both
 * perfectly. Presence and truth are different properties: the first needs only a non-empty string,
 * the second needs a schema. That is the gap this closes, and it is why the fix is a lint rather
 * than another harness check.
 *
 * HOW IT DECIDES, and what it cannot decide. A value is accepted when some migration in this repo
 * has a `CREATE TABLE` for it, or when it appears in NON_TABLE_LABELS below with a reason. It
 * cannot ask production — CI has no credentials — so a table that exists live but is created by no
 * migration here would be reported as missing. That direction is the safe one: it complains about a
 * value it cannot verify rather than passing one it cannot check. If that case ever arises, add the
 * migration rather than an exemption; a target with no migration is a separate problem.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const SELF_TEST = process.argv.includes("--self-test");
const HANDLER = "supabase/functions/paige-ai-chat/index.ts";
const MIGRATIONS = "supabase/migrations";

/** Values that are deliberately NOT tables. Each says what it is, so none is a silent exemption. */
const NON_TABLE_LABELS = new Map([
  ["external_provider", "a third-party system (e.g. Zapier, or a social platform via the sole Social provider); the record lives outside this database"],
  ["marketplace", "an install, which spans several rows rather than one table"],
  ["knowledge_base", "the tenant's knowledge corpus, addressed by its own ids"],
  ["n8n_workflow", "a workflow in n8n; the record is not ours"],
  ["paige_subagents", "the subagent registry, whose table name varies by deployment"],
]);

/** Pure, so the self-test grades the real decision rather than a re-implementation of it. */
export function danglingTargets({ entries, createdTables, nonTableLabels }) {
  const out = [];
  const seen = new Set();
  for (const [tool, target] of entries) {
    if (seen.has(target)) continue;
    if (createdTables.has(target) || nonTableLabels.has(target)) continue;
    seen.add(target);
    out.push(
      `${tool} records its writes against "${target}", which no migration in this repo creates ` +
      `and which is not declared a non-table label. Every attribution row for it points at nothing. ` +
      `Name the table the handler actually writes, or declare the label with its reason.`,
    );
  }
  return out;
}

export function parseWriteTargets(src) {
  const start = src.indexOf("const WRITE_TARGET: Record<string, string> = {");
  if (start < 0) return null;             // null, not [] — "cannot find it" is not "there are none"
  const end = src.indexOf("};", start);
  if (end < 0) return null;
  return [...src.slice(start, end).matchAll(/(\w+):\s*"([a-z_]+)"/g)].map((m) => [m[1], m[2]]);
}

export function createdTables(sqlTexts) {
  const set = new Set();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  for (const sql of sqlTexts) for (const m of sql.matchAll(re)) set.add(m[1]);
  return set;
}

if (SELF_TEST) {
  let pass = 0, fail = 0;
  const ok = (c, n) => { if (c) pass++; else { fail++; console.log(`  FAIL ${n}`); } };
  const NT = new Map([["marketplace", "reason"]]);

  ok(danglingTargets({ entries: [["t", "clients"]], createdTables: new Set(["clients"]), nonTableLabels: NT }).length === 0,
     "a real table passes");
  ok(danglingTargets({ entries: [["t", "activities"]], createdTables: new Set(["clients"]), nonTableLabels: NT }).length === 1,
     "a table no migration creates is caught — the exact live defect");
  ok(danglingTargets({ entries: [["t", "marketplace"]], createdTables: new Set(), nonTableLabels: NT }).length === 0,
     "a declared non-table label passes");
  ok(danglingTargets({ entries: [["a", "ghost"], ["b", "ghost"]], createdTables: new Set(), nonTableLabels: NT }).length === 1,
     "one report per distinct target, not per tool");
  ok(createdTables(["CREATE TABLE IF NOT EXISTS public.foo (id uuid);"]).has("foo"),
     "CREATE TABLE IF NOT EXISTS public.x is recognised");
  ok(createdTables(["create table \"bar\" (id uuid);"]).has("bar"),
     "lowercase and quoted forms are recognised");
  ok(parseWriteTargets("no map here") === null,
     "a missing map returns null rather than an empty list, so it cannot read as 'nothing wrong'");
  ok((parseWriteTargets('const WRITE_TARGET: Record<string, string> = {\n  a: "x", b: "y",\n};') ?? []).length === 2,
     "the map is parsed");
  console.log(fail === 0 ? "✓ write-target-lint self-test passed." : `✗ ${fail} self-test failure(s).`);
  process.exit(fail === 0 ? 0 : 1);
}

const entries = parseWriteTargets(readFileSync(HANDLER, "utf8"));
if (entries === null) {
  console.log(`::error::write-target-lint: could not find WRITE_TARGET in ${HANDLER}. ` +
    `Refusing to report a verdict on a map it cannot read.`);
  process.exit(1);
}
const sqls = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"));
const found = danglingTargets({ entries, createdTables: createdTables(sqls), nonTableLabels: NON_TABLE_LABELS });

if (found.length) {
  console.log(`✗ write-target-lint: ${found.length} attribution target(s) point at nothing.\n`);
  for (const f of found) console.log(`  • ${f}`);
  console.log("\n  An audit row that names a table which does not exist is unresolvable — and reads as correct.");
  process.exit(1);
}
console.log(`✓ write-target-lint: ${entries.length} attribution target(s), every one a real table or a declared label.`);
