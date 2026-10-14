#!/usr/bin/env node
/**
 * baseline-guard — every ratchet baseline may only SHRINK.
 *
 * Three baselines are guarded, and they have different shapes:
 *   scripts/ci/tsc-baseline.txt    `<count>\t<signature>` per line — a multiset, checked per entry
 *   scripts/ci/alias-baseline.txt  a single integer — the operator console's shadcn bridge
 *   scripts/ci/operator-role-literal-baseline.json  per-file counts — operator role words in client code
 *
 * A ratchet whose baseline can be edited upward is not a ratchet: the author whitelists the
 * regression in the same PR that causes it. The alias baseline was added 2026-08-23 and its
 * own doc comment claimed this protection before it existed — the claim is what made the gap
 * findable, so it is corrected here rather than reworded there.
 *
 * The tsc-ratchet trusts the baseline: any error signature present in it is treated as
 * pre-existing and won't fail a PR. So a PR could whitelist a genuinely-new error by appending
 * its signature to the baseline. This guard closes that: it compares the head baseline's
 * per-signature counts against the base ref's, and fails if ANY signature's count grew or a NEW
 * signature appeared. A reformat or a legitimate fix (counts drop / signatures removed) passes.
 *
 * The comparison is per-signature (not a line-diff and not a total-count): a total-count check
 * could be gamed by fixing one error while whitelisting another. If the base ref has no baseline
 * file at all (the PR that INTRODUCES the baseline — like Lane F Slice 1), the guard skips —
 * there's nothing to shrink from yet.
 *
 * Usage: BASE=<sha> node scripts/ci/baseline-guard.mjs
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.BASE;
if (!BASE) {
  console.log("baseline-guard: no BASE ref provided — skipping (not a PR context).");
  process.exit(0);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REL = "scripts/ci/tsc-baseline.txt";
const PATH = join(HERE, "tsc-baseline.txt");

/** Parse `<count>\t<signature>` lines into a Map(signature → count). */
function parse(text) {
  const m = new Map();
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const tab = raw.indexOf("\t");
    if (tab === -1) continue;
    const count = parseInt(raw.slice(0, tab), 10);
    const sig = raw.slice(tab + 1).trim();
    if (sig && Number.isFinite(count)) m.set(sig, count);
  }
  return m;
}

let baseText;
try {
  baseText = execSync(`git show ${BASE}:${REL}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
  console.log(`baseline-guard: ${REL} does not exist at base ${BASE.slice(0, 12)} — this PR introduces it, skipping.`);
  process.exit(0);
}

const base = parse(baseText);
const head = parse(readFileSync(PATH, "utf8"));

const grew = [];
for (const [sig, count] of head) {
  const baseCount = base.get(sig) ?? 0;
  if (count > baseCount) grew.push({ sig, from: baseCount, to: count });
}

if (grew.length) {
  console.error(`❌ baseline-guard: ${grew.length} baseline entr(y/ies) GREW — the tsc baseline may only shrink.`);
  console.error(`   Fix the type error instead of whitelisting it in ${REL}:`);
  for (const g of grew) console.error(`   ${g.from}→${g.to}  ${g.sig.slice(0, 140)}`);
  process.exit(1);
}

/**
 * The alias baseline — a single integer, so a plain numeric comparison rather than a multiset.
 * Absent at base means this PR introduces it, which is not a regression.
 */
const ALIAS_REL = "scripts/ci/alias-baseline.txt";
const ALIAS_PATH = join(HERE, "alias-baseline.txt");
let aliasBaseText = null;
try {
  aliasBaseText = execSync(`git show ${BASE}:${ALIAS_REL}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
  console.log(`baseline-guard: ${ALIAS_REL} does not exist at base ${BASE.slice(0, 12)} — this PR introduces it, skipping.`);
}
if (aliasBaseText !== null && existsSync(ALIAS_PATH)) {
  const before = parseInt(aliasBaseText.trim(), 10);
  const after = parseInt(readFileSync(ALIAS_PATH, "utf8").trim(), 10);
  if (Number.isNaN(before) || Number.isNaN(after)) {
    console.error(`❌ baseline-guard: ${ALIAS_REL} is not an integer on one side (base=${aliasBaseText.trim()}, head=${after}).`);
    process.exit(1);
  }
  if (after > before) {
    console.error(
      `❌ baseline-guard: ${ALIAS_REL} GREW ${before} → ${after}.\n` +
      `   The operator console's compatibility bridge only descends. Raising the number\n` +
      `   whitelists the mapping that made the console render the wrong palette — read the\n` +
      `   --pg-* token directly instead of adding a shadcn alias.`,
    );
    process.exit(1);
  }
  console.log(`baseline-guard: ${ALIAS_REL} ${before} → ${after} (ok).`);
}

/**
 * The operator role-literal baseline — per file, so each entry is compared on its own: a PR may
 * lower a file's count or drop the file, never raise a count or add a file.
 */
const ROLE_REL = "scripts/ci/operator-role-literal-baseline.json";
const ROLE_PATH = join(HERE, "operator-role-literal-baseline.json");
let roleBaseText = null;
try {
  roleBaseText = execSync(`git show ${BASE}:${ROLE_REL}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
  console.log(`baseline-guard: ${ROLE_REL} does not exist at base ${BASE.slice(0, 12)} — this PR introduces it, skipping.`);
}
if (roleBaseText !== null && existsSync(ROLE_PATH)) {
  const before = JSON.parse(roleBaseText).files ?? {};
  const after = JSON.parse(readFileSync(ROLE_PATH, "utf8")).files ?? {};
  const grew = Object.entries(after).filter(([file, n]) => n > (before[file] ?? 0));
  if (grew.length) {
    console.error(`❌ baseline-guard: ${ROLE_REL} GREW for ${grew.map(([f]) => f).join(", ")}.`);
    console.error("   Operator standing is read from src/lib/auth/operatorStanding.ts, never from a list of role words.");
    process.exit(1);
  }
  console.log(`baseline-guard: ${ROLE_REL} did not grow (ok).`);
}

console.log(`✅ baseline-guard: tsc baseline did not grow (base ${base.size} sigs → head ${head.size} sigs).`);
