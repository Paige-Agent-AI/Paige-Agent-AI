#!/usr/bin/env node
/**
 * regression-lint — catch the doctrine-regression classes a type checker never will, on the
 * lines a PR actually ADDED (never whole files, never the whole tree).
 *
 * Added-lines-only is the honest, correct scope. `main` still carries pre-existing violations
 * (the live `index.html` meta description ships "AI-powered"; older edge-function copy; immutable
 * past migrations with permissive `USING (false)`) — those are owned by dedicated cleanup lanes
 * (§2 amputation / §3 copy sweep, Lane E). A whole-tree or whole-changed-file gate would either be
 * red on day one (ignored) or block an unrelated edit to a file that happens to carry old debt.
 * By scanning only the `+` lines of the diff, this gate's job is exactly "don't ADD a violation" —
 * which makes the acceptance test true ("a PR that adds a banned phrase to a shipped file fails")
 * across ALL shipped surfaces, not just src/.
 *
 * Coverage (the shipped surfaces a §3/jargon regression can reach):
 *   - src — ts,tsx,js,jsx,css,html
 *   - index.html — the meta/OG description every crawler + LLM reads (Lane E flags it)
 *   - public — llms.txt, static assets
 *   - supabase/functions — .ts edge functions compose user-facing email/copy
 * Migration policy check: supabase/migrations .sql files.
 *
 * Checks (on ADDED lines only):
 *   1. §3 banned marketing phrases + "MMA OS" operator jargon in a shipped surface.
 *   2. a new `USING (false)` / `WITH CHECK (false)` policy line not declared restrictive
 *      (a permissive deny is decorative — permissive policies OR together).
 *
 * Escape hatch (§13, for a justified mention — e.g. a comment that quotes the ban): put
 * `ci-allow-regression` on the added line.
 *
 * Diff range: `git diff $BASE_REF $HEAD_REF` (defaults origin/main…HEAD) — the SAME two-endpoint
 * form ci.yml's changed-files step uses, so the two gates never disagree about the change set.
 */
import { execSync } from "node:child_process";

const BASE_REF = process.env.BASE_REF || "origin/main";
const HEAD_REF = process.env.HEAD_REF || "HEAD";
const ALLOW = /ci-allow-regression/;
const FORBIDDEN_VENDOR_RUNTIME = /@lovable\.dev\/|\blovable-tagger\b|https?:\/\/[^\s"')]*lovable\.(?:dev|app)\b|\bLOVABLE_(?:API_KEY|SEND_URL)\b|\bsendLovableEmail\b/i;

// §3 banned marketing phrases (case-insensitive) + operator jargon that must not ship.
const PHRASE_PATTERNS = [
  { re: /ai[- ]powered/i, label: '§3 banned phrase "AI-powered" (use "Paige-run")' },
  { re: /\bstreamline/i, label: '§3 banned phrase "streamline" (use "Paige handles it")' },
  { re: /\bseamless/i, label: '§3 banned phrase "seamless"' },
  { re: /empower coaches/i, label: '§3 banned phrase "empower coaches" (use "give coaches back their time")' },
  { re: /\bMMA OS\b/i, label: '§11 internal jargon "MMA OS" in shipped code' },
];

const isShipped = (f) =>
  /^src\/.*\.(ts|tsx|js|jsx|css|html)$/.test(f) ||
  f === "index.html" ||
  /^public\//.test(f) ||
  /^supabase\/functions\/.*\.(?:ts|tsx|js|jsx|mjs)$/.test(f);
const isMigration = (f) => /^supabase\/migrations\/.*\.sql$/.test(f);
const isRuntimeConfig = (f) => /^(?:package(?:-lock)?\.json|vite\.config\.ts|auth\.html)$/.test(f) || /^supabase\/functions\/.*\/(?:deno\.jsonc?|deno\.lock)$/.test(f);

function resolveBase() {
  try {
    execSync(`git rev-parse --verify ${BASE_REF}`, { stdio: "ignore" });
    return BASE_REF;
  } catch {
    return execSync(`git rev-parse ${HEAD_REF}^`, { encoding: "utf8" }).trim();
  }
}

const base = resolveBase();
const diff = execSync(`git diff ${base} ${HEAD_REF} --unified=0 --no-color`, {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

const problems = [];
let file = null;
let lineNo = 0;

for (const line of diff.split("\n")) {
  if (line.startsWith("+++ ")) {
    const p = line.slice(4).trim().replace(/^b\//, "");
    file = p === "/dev/null" ? null : p;
    continue;
  }
  if (line.startsWith("@@")) {
    const m = line.match(/\+(\d+)/);
    lineNo = m ? parseInt(m[1], 10) : 0;
    continue;
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    const content = line.slice(1);
    if (file && (isShipped(file) || isRuntimeConfig(file)) && FORBIDDEN_VENDOR_RUNTIME.test(content)) {
      problems.push(`${file}:${lineNo}  Owner no-Lovable rule: remove the vendor dependency and recreate required behavior in PAIGE-owned code`);
    }
    if (file && !ALLOW.test(content)) {
      if (isShipped(file)) {
        for (const { re, label } of PHRASE_PATTERNS) {
          if (re.test(content)) problems.push(`${file}:${lineNo}  ${label}`);
        }
      }
      if (isMigration(file) && /(using|with check)\s*\(\s*false\s*\)/i.test(content) && !/restrictive/i.test(content)) {
        problems.push(`${file}:${lineNo}  new USING/WITH CHECK (false) policy must be declared AS RESTRICTIVE (permissive deny is a no-op)`);
      }
    }
    lineNo++;
  }
  // '-' and '\' lines don't advance the new-file line counter.
}

if (problems.length) {
  console.error(`❌ regression-lint: ${problems.length} new violation(s) in added lines:\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error(`\nFix them, or add \`ci-allow-regression\` on the line for a justified exception.`);
  process.exit(1);
}

console.log(`✅ regression-lint: no new §3/jargon/policy violations in added lines (${base.slice(0, 12)}…${HEAD_REF}).`);
