#!/usr/bin/env node
/**
 * Two migration files may never share a version, and a migration this branch adds may never reuse
 * a version that already exists on the base branch.
 *
 * WHY THIS EXISTS. `supabase_migrations.schema_migrations` is keyed on the VERSION alone. When a
 * version is already recorded, `supabase db push` does not fail and does not warn — it SKIPS the
 * file. So a colliding migration merges, CI stays green, the `db-live` tag advances, every badge
 * reads healthy, and the migration simply never exists on production. The objects it was supposed
 * to create are absent, and the first sign of it is whatever breaks weeks later.
 *
 * MEASURED, 2026-09-01. Merging main into a long-lived branch produced THREE collisions at once:
 *
 *   20261018000000  chat_turn_append_tenant_scope           vs main's secret_read_keeps_its_approvals
 *   20261019000000  credit_extraction_review_state          vs main's solo_setup_business_brief
 *   20261020000000  tool_autonomy_catalogue_covers_the_gate vs prod's primary_number_is_always_active
 *
 * The Supabase preview reported ONE of them — it stops at the first duplicate-key error — so
 * fixing what it named would have left two behind and looked resolved. The third had no duplicate
 * FILENAME anywhere in the repository (its twin exists only in production's ledger, applied from
 * a branch that is not merged), so scanning the tree for repeated prefixes cannot find it either.
 *
 * WHAT THIS GUARD DOES AND DOES NOT COVER. It runs offline against git, so it catches the two
 * shapes that are decidable without a database:
 *   1. two files in the tree sharing a version — always wrong, whoever wrote them;
 *   2. a version this branch ADDS that already exists on the merge base — the merge-collision
 *      shape, which is the common one on a long-lived branch.
 *   4. a version this branch ADDS that sorts BEFORE the newest version already on the base branch.
 *      Production has applied the base's newest, and `supabase db push` (what deploy-migrations runs)
 *      refuses a local file that would be inserted before the remote's last migration, so the deploy
 *      fails after merge. Measured 2026-10-28: an EXP03 branch named its migration 20271120140003 while
 *      main was already at 20271121110019; shapes 1 and 2 passed it, and only a by-hand frontier check
 *      caught it before merge. Rename to a version later than the base's newest.
 * It does NOT and cannot catch shape 3: a version recorded in production whose file is not in this
 * repository at all. That needs the live ledger, which CI has no credentials for. Stated plainly
 * rather than implied, because a guard trusted for more than it checks is worse than none — the
 * pre-merge check for that shape is a query against `schema_migrations`, and it belongs in the
 * §32.a persisted-apply confirmation, not here.
 *
 * The fix is always to RENAME the new migration to a free, later version — never to renumber the
 * one already applied, which would orphan a live row.
 */
import { execFileSync } from "node:child_process";

const SELF_TEST = process.argv.includes("--self-test");
const git = (...a) => execFileSync("git", a, { encoding: "utf8" });
const versionOf = (p) => (p.split("/").pop() ?? "").split("_")[0];

/** Pure, so the self-test grades the real decision rather than a re-implementation of it. */
export function collisions({ treeFiles, baseFiles, addedFiles }) {
  const out = [];
  const byVersion = new Map();
  for (const f of treeFiles) {
    const v = versionOf(f);
    if (!/^\d{14}$/.test(v)) continue;
    (byVersion.get(v) ?? byVersion.set(v, []).get(v)).push(f);
  }
  for (const [v, files] of byVersion) {
    if (files.length > 1) {
      out.push(`two migrations share version ${v}: ${files.map((f) => f.split("/").pop()).join(" and ")}. ` +
        `schema_migrations is keyed on the version, so only ONE of them would ever be applied — silently.`);
    }
  }
  const baseVersions = new Set(baseFiles.map(versionOf));
  const baseByVersion = new Map(baseFiles.map((f) => [versionOf(f), f.split("/").pop()]));
  for (const f of addedFiles) {
    const v = versionOf(f);
    if (!/^\d{14}$/.test(v)) continue;
    if (baseVersions.has(v)) {
      out.push(`${f.split("/").pop()} reuses version ${v}, which the base branch already has as ` +
        `${baseByVersion.get(v)}. On merge this file is SKIPPED, not applied, and nothing reports it. ` +
        `Rename this migration to a free, later version — never renumber the one already applied.`);
    }
  }
  const baseNewest = baseFiles.map(versionOf).filter((v) => /^\d{14}$/.test(v)).sort().at(-1);
  if (baseNewest) {
    for (const f of addedFiles) {
      const v = versionOf(f);
      if (!/^\d{14}$/.test(v) || baseVersions.has(v) || v > baseNewest) continue;
      out.push(`${f.split("/").pop()} has version ${v}, which sorts before the base branch's newest ` +
        `migration ${baseByVersion.get(baseNewest)}. Production has applied that one, so \`supabase db push\` ` +
        `refuses to insert this file before it and the deploy fails after merge. Rename it to a version ` +
        `later than ${baseNewest}.`);
    }
  }
  return out;
}

if (SELF_TEST) {
  let pass = 0, fail = 0;
  const ok = (c, n) => { if (c) pass++; else { fail++; console.log(`  FAIL ${n}`); } };
  const M = (v, n) => `supabase/migrations/${v}_${n}.sql`;

  ok(collisions({ treeFiles: [M("20260101000000", "a"), M("20260102000000", "b")], baseFiles: [], addedFiles: [] }).length === 0,
     "distinct versions in the tree are clean");
  ok(collisions({ treeFiles: [M("20260101000000", "a"), M("20260101000000", "b")], baseFiles: [], addedFiles: [] }).length === 1,
     "two files sharing a version is caught");
  // The real shape: no duplicate filename in the tree at all, the twin is on the base branch.
  ok(collisions({ treeFiles: [M("20260101000000", "mine")], baseFiles: [M("20260101000000", "theirs")],
                  addedFiles: [M("20260101000000", "mine")] }).length === 1,
     "a version the base already uses is caught even with no duplicate filename");
  ok(collisions({ treeFiles: [M("20260103000000", "mine")], baseFiles: [M("20260102000000", "theirs")],
                  addedFiles: [M("20260103000000", "mine")] }).length === 0,
     "an unused version is clean");
  // A file present on BOTH sides unchanged is not an addition and must not be flagged.
  ok(collisions({ treeFiles: [M("20260101000000", "same")], baseFiles: [M("20260101000000", "same")], addedFiles: [] }).length === 0,
     "an unchanged existing migration is not a collision with itself");
  ok(collisions({ treeFiles: ["supabase/migrations/README.md"], baseFiles: [], addedFiles: ["supabase/migrations/README.md"] }).length === 0,
     "a non-migration filename is ignored rather than parsed as a version");
  // Shape 4: an added version older than the base's newest fails `db push` after merge.
  ok(collisions({ treeFiles: [M("20260101000000", "mine"), M("20260105000000", "theirs")],
                  baseFiles: [M("20260105000000", "theirs")], addedFiles: [M("20260101000000", "mine")] }).length === 1,
     "an added version older than the base's newest is caught");
  ok(collisions({ treeFiles: [M("20260106000000", "mine"), M("20260105000000", "theirs")],
                  baseFiles: [M("20260105000000", "theirs")], addedFiles: [M("20260106000000", "mine")] }).length === 0,
     "an added version newer than the base's newest is clean");
  ok(collisions({ treeFiles: [M("20260105000000", "mine")], baseFiles: [M("20260105000000", "theirs")],
                  addedFiles: [M("20260105000000", "mine")] }).length === 1,
     "a reused newest version is reported once, as a reuse, not also as out of order");
  console.log(fail === 0 ? "✓ migration-version-collision-lint self-test passed." : `✗ ${fail} self-test failure(s).`);
  process.exit(fail === 0 ? 0 : 1);
}

const base = process.env.BASE_REF || "origin/main";
const listTree = (ref) => {
  try { return git("ls-tree", "-r", "--name-only", ref, "supabase/migrations/").split("\n").filter(Boolean); }
  catch { return null; }
};
const baseFiles = listTree(base);
if (baseFiles === null) {
  // Honest: no base to compare against means shape 2 is UNCHECKED, and saying so beats a green tick.
  console.log(`migration-version-collision-lint: base ref '${base}' is unavailable — checked the tree only, NOT against a base.`);
}
const treeFiles = git("ls-files", "supabase/migrations/").split("\n").filter(Boolean);
let addedFiles = [];
if (baseFiles) {
  try {
    addedFiles = git("diff", "--name-only", "--diff-filter=A", `${base}...HEAD`, "--", "supabase/migrations/")
      .split("\n").filter(Boolean);
  } catch { addedFiles = []; }
}

const found = collisions({ treeFiles, baseFiles: baseFiles ?? [], addedFiles });
if (found.length) {
  console.log(`✗ migration-version-collision-lint: ${found.length} problem(s).\n`);
  for (const f of found) console.log(`  • ${f}`);
  console.log("\n  A reused version does not fail on push — it is SKIPPED, and every gate stays green. An out-of-order one\n" +
    "  fails the deploy after merge. Either way, rename the new migration to a free version after the base's newest.");
  process.exit(1);
}
console.log(`✓ migration-version-collision-lint: ${treeFiles.length} migration(s), no version reused or out of order${baseFiles ? ` (base ${base})` : ""}.`);
