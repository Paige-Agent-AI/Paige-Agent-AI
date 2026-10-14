#!/usr/bin/env node
/**
 * operator-role-literal-lint — no client code decides "is this person an operator" except through
 * the one client home.
 *
 * WHY. Before the Platform Operator shell consolidation, "operator" had no single answer. The
 * client alone carried about ten role lists, some naming `platform_admin` and some not, and the
 * one that forgot it locked the delegated operator tier out of the console it is authorised for.
 * There is now one server answer, `operator_standing()`, and one client home that reads it,
 * `src/lib/auth/operatorStanding.ts`. This gate keeps it that way. In client code outside that
 * home it counts, per file:
 *   - an operator role word (`super_admin`, `platform_admin`) as a string, template, object key,
 *     identifier or inside a regex literal;
 *   - a direct call of an old operator predicate by RPC name (`is_platform_admin`,
 *     `is_platform_owner`, `is_platform_operator`, `is_super_admin`) — a second way to ask.
 *
 * It tokenizes with the TypeScript scanner, so comments are skipped exactly and a string like
 * "image/*" or "/operator/*" can never open a pretend comment that hides the rest of a file.
 *
 * THE BASELINE. A few files still carry a hit for reasons that are not an operator gate — tenant
 * assignee filters that read OTHER members' roles, orphaned screens owned by another lane, Solo
 * surfaces that need their own evidence. Each is recorded per file in
 * `operator-role-literal-baseline.json` with its count and reason. The count must match exactly:
 * a file above its count fails (a new list), and a file below it also fails until the number is
 * lowered, so slack can never be quietly re-grown. `baseline-guard.mjs` refuses a PR that raises an
 * entry or adds a file. The same discipline as `alias-ratchet.mjs` and `tsc-ratchet.mjs`.
 *
 *   node scripts/ci/operator-role-literal-lint.mjs            check src/
 *   node scripts/ci/operator-role-literal-lint.mjs --self-test prove it bites
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const BASELINE_PATH = join(HERE, "operator-role-literal-baseline.json");

/** The one client home. */
export const HOME = "src/lib/auth/operatorStanding.ts";
/** Generated from the database; it lists every enum value and function by construction. */
const GENERATED = new Set(["src/integrations/supabase/types.ts"]);

const ROLE_WORDS = new Set(["super_admin", "platform_admin"]);
const OLD_PREDICATES = new Set(["is_platform_admin", "is_platform_owner", "is_platform_operator", "is_super_admin"]);
const REGEX_ROLE = /super_admin|platform_admin|\(super\|platform\)_admin|\(platform\|super\)_admin/;

/**
 * Count hits in one source file: role words in any token that is code, and old-predicate names
 * passed as a string (a role word inside a longer identifier such as `is_super_admin` is not a
 * hit, and neither is anything inside a comment).
 */
export function countHits(source, fileName = "x.tsx") {
  const variant = /\.tsx$/.test(fileName) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ true, variant, source);
  let count = 0;
  let previous = ts.SyntaxKind.Unknown;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    // A `/` after something that cannot end an expression starts a regex literal.
    if ((kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) && regexAllowedAfter(previous)) {
      kind = scanner.reScanSlashToken();
    }
    // Template literals: rescan the continuation after each `}` of a substitution.
    if (kind === ts.SyntaxKind.CloseBraceToken && scanner.getTokenFlags && templateDepth > 0) {
      kind = scanner.reScanTemplateToken(false);
    }
    trackTemplate(kind);
    const text = scanner.getTokenValue?.() ?? scanner.getTokenText();
    switch (kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        if (ROLE_WORDS.has(text) || OLD_PREDICATES.has(text)) count += 1;
        break;
      case ts.SyntaxKind.Identifier:
        if (ROLE_WORDS.has(scanner.getTokenText())) count += 1;
        break;
      case ts.SyntaxKind.RegularExpressionLiteral:
        if (REGEX_ROLE.test(scanner.getTokenText())) count += 1;
        break;
      default:
        break;
    }
    previous = kind;
  }
  return count;
}

let templateDepth = 0;
function trackTemplate(kind) {
  if (kind === ts.SyntaxKind.TemplateHead) templateDepth += 1;
  if (kind === ts.SyntaxKind.TemplateTail && templateDepth > 0) templateDepth -= 1;
}

function regexAllowedAfter(kind) {
  switch (kind) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.CloseParenToken:
    case ts.SyntaxKind.CloseBracketToken:
    case ts.SyntaxKind.CloseBraceToken:
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.PlusPlusToken:
    case ts.SyntaxKind.MinusMinusToken:
      return false;
    default:
      return true;
  }
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
    templateDepth = 0;
    const n = countHits(source, rel);
    if (n > 0) counts[rel] = n;
    const allowed = baseline[rel] ?? 0;
    if (n > allowed) {
      problems.push(`${rel}: ${n} hit(s), baseline ${allowed} — read operator standing from ${HOME}.`);
    } else if (n < allowed) {
      problems.push(`${rel}: ${n} hit(s), below its baseline of ${allowed} — lower it in operator-role-literal-baseline.json.`);
    }
  }
  const seen = new Set(files.map(([rel]) => rel));
  for (const [rel, n] of Object.entries(baseline)) {
    if (!seen.has(rel) && n > 0) problems.push(`${rel}: listed in the baseline but no longer exists — remove its entry.`);
  }
  return { problems, counts };
}

function selfTest() {
  const cases = [
    ["a new role list fails", [["src/x.tsx", `const ROLES = new Set(["super_admin", "platform_admin"]);`]], {}, 1],
    ["a line comment naming the role passes", [["src/x.tsx", `// super_admin used to be listed here: "super_admin"`]], {}, 0],
    ["a trailing comment after code passes", [["src/x.tsx", `const a = "x"; // was "super_admin"`]], {}, 0],
    ["a block comment passes", [["src/x.tsx", `/*\n * roles.includes("platform_admin")\n */\nconst a = 1;`]], {}, 0],
    ["a string containing /* does not hide what follows", [["src/x.tsx", `const accept = "image/*";\nconst R = new Set(["super_admin"]);`]], {}, 1],
    ["a route string like /operator/* does not hide what follows", [["src/x.tsx", `<Route path="/operator/*" />;\nconst R = ["platform_admin"];`]], {}, 1],
    ["the home may name anything", [[HOME, `rpc("operator_standing"); const OWNER = "super_admin";`]], {}, 0],
    ["generated types pass", [["src/integrations/supabase/types.ts", `"super_admin" | "platform_admin"`]], {}, 0],
    ["a baselined file at its count passes", [["src/y.ts", `x.includes("super_admin")`]], { "src/y.ts": 1 }, 0],
    ["a baselined file above its count fails", [["src/y.ts", `a("super_admin"); b('platform_admin')`]], { "src/y.ts": 1 }, 1],
    ["a baselined file below its count fails until lowered", [["src/y.ts", `const clean = 1;`]], { "src/y.ts": 2 }, 1],
    ["a baselined file that no longer exists fails until removed", [["src/z.ts", `const clean = 1;`]], { "src/gone.ts": 1 }, 1],
    ["single quotes and backticks count", [["src/z.ts", "f('super_admin', `platform_admin`)"]], {}, 1],
    ["an unquoted object key counts", [["src/z.ts", `const T = { super_admin: true, platform_admin: true };`]], {}, 1],
    ["a regex literal counts", [["src/z.ts", `const R = /^(super|platform)_admin$/;`]], {}, 1],
    ["a role word inside a longer identifier does not count", [["src/z.ts", `const is_super_admin_label = 1;`]], {}, 0],
    ["an old predicate called by RPC name counts", [["src/z.ts", `await supabase.rpc("is_platform_admin");`]], {}, 1],
    ["each old predicate name counts", [["src/z.ts", `rpc("is_platform_owner"); rpc('is_super_admin'); rpc(\`is_platform_operator\`)`]], {}, 1],
  ];
  let failed = 0;
  for (const [name, files, baseline, expectProblems] of cases) {
    const { problems } = check(files, baseline);
    const ok = problems.length === expectProblems;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "ok" : "FAIL"}  ${name}${ok ? "" : ` (expected ${expectProblems} problem(s), got ${problems.length}: ${problems.join("; ")})`}`);
  }
  // Exact counts, not just problem counts, for the cases where the number is the point.
  const exact = [
    [`rpc("is_platform_owner"); rpc('is_super_admin'); rpc(\`is_platform_operator\`)`, 3],
    [`const T = { super_admin: true, platform_admin: true };`, 2],
    [`const accept = "image/*";\nconst R = new Set(["super_admin"]);`, 1],
  ];
  for (const [src, n] of exact) {
    templateDepth = 0;
    const got = countHits(src, "src/e.ts");
    const ok = got === n;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "ok" : "FAIL"}  counts ${n} in ${JSON.stringify(src.slice(0, 40))}${ok ? "" : ` (got ${got})`}`);
  }
  if (failed) {
    console.error(`✗ operator-role-literal-lint self-test: ${failed} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ operator-role-literal-lint self-test passed — ${cases.length + exact.length} cases.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")).files;
    const files = walk(join(ROOT, "src")).map((p) => [relative(ROOT, p), readFileSync(p, "utf8")]);
    const { problems } = check(files, baseline);
    if (problems.length) {
      console.error("✗ operator-role-literal-lint:");
      for (const p of problems) console.error(`  ${p}`);
      console.error("\n  See the header of scripts/ci/operator-role-literal-lint.mjs.");
      process.exit(1);
    }
    console.log(`✓ operator-role-literal-lint: every operator decision in client code goes through ${HOME}.`);
  }
}
