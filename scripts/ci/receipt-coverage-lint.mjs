#!/usr/bin/env node
/**
 * receipt-coverage-lint.mjs — evidence coverage fails CLOSED, the way risk classification already does.
 *
 * THE ASYMMETRY THIS CLOSES. `_shared/action-risk.ts` states its first rule as fail-closed: adding a
 * write tool without classifying it makes that tool inert, loudly, and `lint:action-risk` fails the
 * change before it reaches anyone. That is why no unclassified write is reachable today.
 *
 * Evidence coverage had no equivalent. Which capabilities write a receipt was decided by three
 * hand-maintained `Set`s and some per-family wiring, with no gate. So a lane could add a write tool,
 * classify it correctly, ship it — and emit no receipt, with nothing anywhere saying so. The tool is
 * governed by default and unrecorded by default, and the second half is silent.
 *
 * WHY A LEDGER AND NOT A DETECTOR. The obvious implementation scans for `recordCapabilityRun` call
 * sites and infers coverage. That was tried and discarded: any static detector has to decide which
 * tool a given call belongs to, and the honest answer is often "you cannot tell from here" — the
 * call may sit behind an injected `recordRun`, inside a shared outcome module, or in an edge
 * function three hops away. A first attempt counted a tool as covered whenever its name appeared
 * anywhere in a file that also called `recordCapabilityRun`, which over-reports badly. A guard that
 * is wrong often enough gets switched off rather than fixed, so this asks for a DECLARATION instead,
 * exactly as the action-risk policy itself is a hand-curated table with written rationale.
 *
 * THE RULE. Every mutation classified in `action-risk.ts` must appear in the ledger with a receipt
 * posture. A new tool may declare `emits` (with evidence) or `exempt` (with a real reason). It may
 * NOT declare `seeded_undeclared` — that value belongs only to the 147 entries frozen when this gate
 * was installed, and exists solely so the gate could be added without 147 guesses.
 *
 * WHAT THIS DOES NOT DO, stated rather than implied: it does not verify that a tool declaring
 * `emits` actually emits. It verifies that somebody decided and wrote down which it is. That is the
 * part that was missing, and it is the part a reviewer can check in a diff.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const ACTION_RISK = join(REPO_ROOT, "supabase", "functions", "_shared", "action-risk.ts");
const LEDGER = join(HERE, "receipt-coverage-ledger.json");

const VALID = new Set(["emits", "exempt", "seeded_undeclared"]);

/** Parse the distinct classified mutation keys out of the RISK array, folding duplicates. */
export function classifiedTools(source) {
  const start = source.indexOf("const RISK: ReadonlyArray");
  const end = source.indexOf("const RISK_RANK");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("cannot locate the RISK array in action-risk.ts — the parser needs updating");
  }
  const body = source.slice(start, end);
  const out = new Map();
  for (const m of body.matchAll(/\[\s*"([a-z][a-z0-9_]*)"\s*,\s*"(ordinary|high|owner_only)"/g)) {
    if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

export function check(classified, ledgerDoc) {
  const entries = ledgerDoc.entries ?? [];
  const byTool = new Map(entries.map((e) => [e.tool, e]));
  const problems = [];

  for (const e of entries) {
    if (!VALID.has(e.receipt)) {
      problems.push({ kind: "bad-value", tool: e.tool, detail: `receipt "${e.receipt}" is not one of ${[...VALID].join(", ")}` });
    }
    if (e.receipt === "emits" && !String(e.evidence ?? "").trim()) {
      problems.push({ kind: "no-evidence", tool: e.tool, detail: "declares `emits` with no `evidence` naming where it is written" });
    }
    if (e.receipt === "exempt" && String(e.reason ?? "").trim().length < 20) {
      problems.push({ kind: "no-reason", tool: e.tool, detail: "declares `exempt` without a reason saying why it writes none" });
    }
    if (!classified.has(e.tool)) {
      problems.push({ kind: "stale", tool: e.tool, detail: "is in the ledger but is no longer classified in action-risk.ts" });
    }
  }

  for (const tool of classified.keys()) {
    const e = byTool.get(tool);
    if (!e) problems.push({ kind: "missing", tool, detail: "is classified in action-risk.ts but absent from the ledger" });
  }
  return problems;
}

/**
 * `seeded_undeclared` is frozen: only tools present in the committed seed may carry it. A new tool
 * using it would grow the debt the ledger exists to freeze, so it is rejected by name.
 */
export function checkSeedFrozen(ledgerDoc, seedTools) {
  const out = [];
  for (const e of ledgerDoc.entries ?? []) {
    if (e.receipt === "seeded_undeclared" && !seedTools.has(e.tool)) {
      out.push({ kind: "new-undeclared", tool: e.tool, detail: "is new and declares `seeded_undeclared`, which only the frozen seed may use — declare `emits` or `exempt`" });
    }
  }
  return out;
}

function run() {
  let classified, ledger;
  try {
    classified = classifiedTools(readFileSync(ACTION_RISK, "utf8"));
  } catch (e) {
    console.error(`[receipt-coverage-lint] ${e.message}`);
    return 1;
  }
  try {
    ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch (e) {
    console.error(`[receipt-coverage-lint] cannot read ${LEDGER}: ${e.message}`);
    return 1;
  }

  const problems = [
    ...check(classified, ledger),
    ...checkSeedFrozen(ledger, new Set(ledger.seeded_tools ?? [])),
  ];
  if (problems.length) {
    console.error("");
    console.error("✗ receipt-coverage-lint FAILED:");
    for (const p of problems) console.error(`    • ${p.tool} ${p.detail}`);
    console.error("");
    console.error("  Risk classification already fails closed. Evidence coverage now does too: a mutation");
    console.error("  that is classified must also say whether it writes a capability receipt.");
    console.error("");
    console.error("  Add an entry to scripts/ci/receipt-coverage-ledger.json:");
    console.error('    { "tool": "<name>", "risk": "<class>", "receipt": "emits",  "evidence": "<where it is written>" }');
    console.error('    { "tool": "<name>", "risk": "<class>", "receipt": "exempt", "reason":   "<why it writes none>" }');
    console.error("");
    console.error("  `seeded_undeclared` is NOT available to a new tool — it belongs to the frozen seed only.");
    console.error("");
    return 1;
  }

  const n = (v) => (ledger.entries ?? []).filter((e) => e.receipt === v).length;
  console.log(
    `✓ receipt-coverage-lint: ${classified.size} classified mutation(s), all declared — ` +
    `${n("emits")} emits · ${n("exempt")} exempt · ${n("seeded_undeclared")} seeded-undeclared.`,
  );
  return 0;
}

export function selfTest() {
  const cases = [];
  const ok = (name, cond) => cases.push([name, cond]);
  const cls = new Map([["a_create", "ordinary"], ["b_send", "high"]]);
  const led = (entries) => ({ entries });

  ok("a complete ledger passes",
    check(cls, led([{ tool: "a_create", risk: "ordinary", receipt: "emits", evidence: "x" },
                    { tool: "b_send", risk: "high", receipt: "exempt", reason: "the outbound record has one home in send-message" }])).length === 0);

  ok("a classified tool missing from the ledger FAILS",
    check(cls, led([{ tool: "a_create", risk: "ordinary", receipt: "emits", evidence: "x" }]))
      .some((p) => p.kind === "missing" && p.tool === "b_send"));

  ok("a ledger tool no longer classified FAILS (drift the other way)",
    check(new Map([["a_create", "ordinary"]]),
          led([{ tool: "a_create", risk: "ordinary", receipt: "emits", evidence: "x" },
               { tool: "gone", risk: "high", receipt: "emits", evidence: "x" }]))
      .some((p) => p.kind === "stale" && p.tool === "gone"));

  ok("`emits` with no evidence FAILS",
    check(new Map([["a_create", "ordinary"]]), led([{ tool: "a_create", risk: "ordinary", receipt: "emits" }]))
      .some((p) => p.kind === "no-evidence"));

  ok("`exempt` with a token reason FAILS",
    check(new Map([["a_create", "ordinary"]]), led([{ tool: "a_create", risk: "ordinary", receipt: "exempt", reason: "later" }]))
      .some((p) => p.kind === "no-reason"));

  ok("an unknown receipt value FAILS",
    check(new Map([["a_create", "ordinary"]]), led([{ tool: "a_create", risk: "ordinary", receipt: "probably" }]))
      .some((p) => p.kind === "bad-value"));

  ok("a NEW tool may not use seeded_undeclared",
    checkSeedFrozen(led([{ tool: "brand_new", risk: "high", receipt: "seeded_undeclared" }]), new Set(["old_one"]))
      .some((p) => p.kind === "new-undeclared"));

  ok("a SEEDED tool may keep seeded_undeclared",
    checkSeedFrozen(led([{ tool: "old_one", risk: "high", receipt: "seeded_undeclared" }]), new Set(["old_one"])).length === 0);

  ok("the RISK parser folds duplicate keys",
    classifiedTools('const RISK: ReadonlyArray<x> = [\n["t","high","r"],\n["t","ordinary","r"],\n];\nconst RISK_RANK').size === 1);

  ok("the RISK parser keeps the first class seen",
    classifiedTools('const RISK: ReadonlyArray<x> = [\n["t","high","r"],\n["t","ordinary","r"],\n];\nconst RISK_RANK').get("t") === "high");

  const failed = cases.filter(([, c]) => !c);
  for (const [n, c] of cases) console.log(`  ${c ? "ok  " : "FAIL"}  ${n}`);
  if (failed.length) { console.error(`\n✗ receipt-coverage-lint self-test: ${failed.length} of ${cases.length} failed.`); return 1; }
  console.log(`\n✓ receipt-coverage-lint self-test passed — ${cases.length} cases.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(process.argv.includes("--self-test") ? selfTest() : run());
}
