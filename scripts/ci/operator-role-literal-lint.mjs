#!/usr/bin/env node
/**
 * operator-role-literal-lint — no client code decides "is this person an operator" from a list.
 *
 * WHY. Before the Platform Operator shell consolidation, "operator" had no single answer. The
 * client alone carried about ten role lists, some naming `platform_admin` and some not, and the
 * one that forgot it locked the delegated operator tier out of the console it is authorised for.
 * There is now one server answer, `operator_standing()`, and one client home that reads it,
 * `src/lib/auth/operatorStanding.ts`. This gate keeps it that way: a quoted operator role word
 * (`"super_admin"`, `"platform_admin"`) in client code outside that home fails the build.
 *
 * THE BASELINE, AND WHY IT EXISTS. A few files still carry the words for reasons that are not an
 * operator gate — tenant assignee filters that read OTHER members' roles, orphaned screens owned
 * by another lane, static display labels. Each is recorded per file in
 * `operator-role-literal-baseline.json` with its count. A file may drop below its count (commit
 * the smaller number) but never rise above it, and a file that is not listed may carry none. So
 * the count only descends, the same discipline as `alias-ratchet.mjs` and `tsc-ratchet.mjs`, and
 * `baseline-guard.mjs` refuses a PR that edits an entry upward.
 *
 * Comments are not counted: explaining why a list was removed has to be able to name it.
 *
 *   node scripts/ci/operator-role-literal-lint.mjs            check src/
 *   node scripts/ci/operator-role-literal-lint.mjs --self-test prove it bites
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const BASELINE_PATH = join(HERE, "operator-role-literal-baseline.json");

/** The one client home. The owner tier is named once, here. */
const HOME = "src/lib/auth/operatorStanding.ts";
/** Generated from the database; it lists every enum value by construction. */
const GENERATED = new Set(["src/integrations/supabase/types.ts"]);

const LITERAL = /(["'`])(super_admin|platform_admin)\1/g;

/** Count quoted operator role words in code, ignoring comment lines and trailing comments. */
export function countLiterals(source) {
  let count = 0;
  let inBlock = false;
  for (const raw of source.split("\n")) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    // Drop block comments that open (and possibly close) on this line.
    line = line.replace(/\/\*.*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open !== -1) {
      line = line.slice(0, open);
      inBlock = true;
    }
    // Drop a trailing line comment that is not inside a string (good enough for this code base:
    // no role word appears after `//` inside a string literal).
    const slash = line.indexOf("//");
    if (slash !== -1 && !/["'`][^"'`]*\/\//.test(line)) line = line.slice(0, slash);
    count += (line.match(LITERAL) ?? []).length;
  }
  return count;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !p.includes("__tests__") ? [p] : [];
  });
}

export function check(files, baseline) {
  const problems = [];
  const counts = {};
  for (const [rel, source] of files) {
    if (rel === HOME || GENERATED.has(rel)) continue;
    const n = countLiterals(source);
    if (n === 0) continue;
    counts[rel] = n;
    const allowed = baseline[rel] ?? 0;
    if (n > allowed) problems.push(`${rel}: ${n} operator role literal(s), baseline ${allowed}`);
  }
  const shrunk = Object.entries(baseline).filter(([rel, n]) => (counts[rel] ?? 0) < n);
  return { problems, shrunk, counts };
}

function selfTest() {
  const cases = [
    ["a new role list fails", [["src/x.tsx", `const ROLES = new Set(["super_admin", "platform_admin"]);`]], {}, 1],
    ["a comment naming the role passes", [["src/x.tsx", `// super_admin used to be listed here: "super_admin"`]], {}, 0],
    ["a block comment passes", [["src/x.tsx", `/*\n * roles.includes("platform_admin")\n */\nconst a = 1;`]], {}, 0],
    ["the home may name the owner tier", [[HOME, `export const OWNER_TIER = "super_admin";`]], {}, 0],
    ["generated types pass", [["src/integrations/supabase/types.ts", `"super_admin" | "platform_admin"`]], {}, 0],
    ["a baselined file at its count passes", [["src/y.ts", `x.includes("super_admin")`]], { "src/y.ts": 1 }, 0],
    ["a baselined file above its count fails", [["src/y.ts", `a("super_admin"); b('platform_admin')`]], { "src/y.ts": 1 }, 1],
    ["single quotes and backticks count", [["src/z.ts", "f('super_admin', `platform_admin`)"]], {}, 1],
    ["a role word inside a longer word does not count", [["src/z.ts", `const is_super_admin_label = "is_super_admin";`]], {}, 0],
  ];
  let failed = 0;
  for (const [name, files, baseline, expectProblems] of cases) {
    const { problems } = check(files, baseline);
    const ok = problems.length === expectProblems;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "ok" : "FAIL"}  ${name}`);
  }
  if (failed) {
    console.error(`✗ operator-role-literal-lint self-test: ${failed} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ operator-role-literal-lint self-test passed — ${cases.length} cases.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")).files;
    const files = walk(join(ROOT, "src")).map((p) => [relative(ROOT, p), readFileSync(p, "utf8")]);
    const { problems, shrunk } = check(files, baseline);
    if (problems.length) {
      console.error("✗ operator-role-literal-lint: operator role words in client code outside the one home.");
      for (const p of problems) console.error(`  ${p}`);
      console.error(
        `\n  Read operator standing from ${HOME} (useOperatorStanding / fetchOperatorStanding),\n` +
          "  never from a list of role words. See the header of this script.",
      );
      process.exit(1);
    }
    for (const [rel, n] of shrunk) {
      console.log(`  ${rel}: below its baseline of ${n} — lower it in operator-role-literal-baseline.json.`);
    }
    console.log(`✓ operator-role-literal-lint: no operator role list in client code outside ${HOME}.`);
  }
}
