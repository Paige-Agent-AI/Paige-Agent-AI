#!/usr/bin/env node
/**
 * doc-citation-lint — verify that `file:line` citations in a doc say what the doc claims.
 *
 * WHY THIS EXISTS. The Solo metric dictionary asserts facts about the codebase and anchors each one
 * to a `file:line`. Twice while writing it the same defect shipped: a migration was cited for
 * behaviour a LATER migration had already repealed.
 *
 *   - `20260711180000` seeded a default pipeline on tenant insert  →  repealed by `20260915000000`
 *   - `20260710200000` fell back to five default stages            →  repealed by `20260831224500`
 *
 * Both readings were correct about the file cited and wrong about the live schema, because Postgres
 * migrations are append-only: `create or replace function` means the newest definition wins and
 * every older one is a historical artefact that still greps cleanly. A prose rule ("check for a
 * later migration") already failed twice, so this is the assertion the build runs instead.
 *
 * THREE CHECKS:
 *   1. RESOLVES  — the cited file exists and actually has that many lines.
 *   2. STALE     — a citation into a migration that defines a function/table, where a LATER
 *                  migration redefines the same identifier. This is the class that bit us.
 *   3. QUOTED    — where the doc quotes code in backticks next to a citation, that text appears
 *                  within a small window of the cited line.
 *
 * Exit 1 on any RESOLVES or STALE failure. QUOTED mismatches warn: prose legitimately paraphrases.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const SELF_TEST = process.argv.includes("--self-test");
const docs = process.argv.slice(2).filter((a) => a !== "--self-test");
if (!docs.length && !SELF_TEST) {
  console.error("usage: doc-citation-lint.mjs <doc.md> [doc.md...] | --self-test");
  process.exit(2);
}

const migrationFiles = existsSync(MIGRATIONS)
  ? readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
  : [];

/** `20260713152601` -> `supabase/migrations/20260713152601_tier_dashboard_metrics.sql` */
function resolveMigration(prefix) {
  const hit = migrationFiles.find((f) => f.startsWith(prefix));
  return hit ? join("supabase/migrations", hit) : null;
}

/** A citation is `<path-or-14-digit-prefix>:<line>` or `...:<line>-<line>`, inside backticks. */
const CITATION = /`([A-Za-z0-9_./-]+?):(\d+)(?:-(\d+))?`/g;

/** Identifiers a migration line DEFINES — the things a later migration can silently supersede. */
const DEFINES = [
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/i,
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/i,
  /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:public\.)?([a-z0-9_]+)/i,
  /create\s+trigger\s+([a-z0-9_]+)/i,
];

const fileCache = new Map();
function lines(path) {
  if (!fileCache.has(path)) {
    fileCache.set(path, existsSync(path) ? readFileSync(path, "utf8").split("\n") : null);
  }
  return fileCache.get(path);
}

const reported = new Set();
let failures = 0;
let warnings = 0;
let checked = 0;

for (const doc of docs) {
  if (!existsSync(doc)) {
    console.error(`✗ doc not found: ${doc}`);
    failures++;
    continue;
  }
  const text = readFileSync(doc, "utf8");
  const docLines = text.split("\n");

  // A doc line often carries several citations. A snippet quoted correctly from one of them would
  // be flagged against its neighbour if each citation were judged alone, so resolve every path on
  // a line up front and let a snippet satisfy ANY of them.
  const pathsByDocLine = new Map();
  for (const m of text.matchAll(CITATION)) {
    const ln = text.slice(0, m.index).split("\n").length;
    const ref = m[1];
    const resolved = /^\d{14}$/.test(ref) ? resolveMigration(ref) : ref;
    if (!resolved || !existsSync(resolved)) continue;
    if (!pathsByDocLine.has(ln)) pathsByDocLine.set(ln, []);
    pathsByDocLine.get(ln).push(resolved);
  }

  for (const m of text.matchAll(CITATION)) {
    const [raw, ref, startStr, endStr] = m;
    const start = Number(startStr);
    const end = endStr ? Number(endStr) : start;
    // Which doc line is this on? (for a useful error)
    const docLine = text.slice(0, m.index).split("\n").length;

    const isMigrationPrefix = /^\d{14}$/.test(ref);
    const path = isMigrationPrefix ? resolveMigration(ref) : ref;

    if (!path) {
      console.error(`✗ ${doc}:${docLine}  ${raw} — no migration starts with ${ref}`);
      failures++;
      continue;
    }
    const body = lines(path);
    if (!body) {
      // Not every backticked `word:123` is a file reference; only fail when it looks like a path.
      if (ref.includes("/") || isMigrationPrefix) {
        console.error(`✗ ${doc}:${docLine}  ${raw} — file does not exist: ${path}`);
        failures++;
      }
      continue;
    }
    checked++;

    // (1) RESOLVES
    if (end > body.length) {
      console.error(`✗ ${doc}:${docLine}  ${raw} — ${path} has only ${body.length} lines`);
      failures++;
      continue;
    }

    // (2) STALE — only meaningful for migrations.
    // Walk BACKWARD from the cited line to the enclosing definition. Citing line 67 of a function
    // declared on line 26 is the normal case and the one that bit us twice — a check that only
    // fired on the declaration line would have passed on both real defects.
    if (path.startsWith("supabase/migrations/")) {
      let enclosing = null;
      for (let i = end - 1; i >= 0 && i > end - 400; i--) {
        for (const re of DEFINES) {
          const hit = body[i].match(re);
          if (hit) { enclosing = { ident: hit[1], at: i + 1 }; break; }
        }
        if (enclosing) break;
      }
      const cited = enclosing ? body[enclosing.at - 1] : "";
      for (const re of DEFINES) {
        const def = cited.match(re);
        if (!def) continue;
        const ident = def[1].toLowerCase();
        const thisFile = path.split("/").pop();
        // A definition is repealed by a later REDEFINITION *or* by a later DROP. The starter
        // auto-provisioner was removed by `drop function`, not replaced — so checking only for
        // redefinition would have missed one of the two defects that motivated this lint.
        const drops = new RegExp(
          String.raw`drop\s+(?:function|table|view|materialized\s+view|trigger)\s+(?:if\s+exists\s+)?(?:public\.)?` +
            ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            String.raw`\b`,
          "i",
        );
        const later = migrationFiles.filter((f) => f > thisFile).filter((f) => {
          const other = readFileSync(join(MIGRATIONS, f), "utf8");
          if (drops.test(other)) return true;
          return DEFINES.some((r) => {
            const g = new RegExp(r.source, "gi");
            for (const hit of other.matchAll(g)) if (hit[1].toLowerCase() === ident) return true;
            return false;
          });
        });
        if (later.length) {
          console.error(
            `✗ STALE  ${doc}:${docLine}  ${raw} sits inside \`${ident}\` (declared ${thisFile}:${enclosing.at}), which is redefined later by:\n` +
              later.map((f) => `           ${f}`).join("\n") +
              `\n           The cited migration is history; the newest definition is what runs.`,
          );
          failures++;
        }
        break;
      }
    }

    // (3) QUOTED — a backticked snippet beside a citation should exist in the cited FILE.
    //
    // An earlier version demanded the snippet appear within ±3 lines of the citation, and warned 35
    // times on a document with zero real problems: prose legitimately backticks a route, a column
    // name, or a symbol declared elsewhere in the same file. A warning channel that cries wolf 35
    // times is one people learn to skip, which would defeat the point of having it. So the check is
    // now the narrow, high-signal one: does this quoted text exist in that file AT ALL? That still
    // catches a fabricated quote — the failure worth catching — without punishing prose.
    const docLineText = docLines[docLine - 1] ?? "";
    const snippets = [...docLineText.matchAll(/`([^`]{16,})`/g)]
      .map((x) => x[1])
      .filter((x) => x !== raw.slice(1, -1))
      // Only things that read like code lifted from a file: an operator, a call, or a declaration.
      .filter((x) => /[=(){};]|::|->/.test(x))
      // Not a bare path/citation, and not a prose sentence that happens to be in backticks.
      .filter((x) => !/^[\w./-]+:\d/.test(x) && x.split(" ").length < 14)
      // A line with an odd number of backticks makes the pair-matcher straddle two inline spans and
      // emit fragments like ", all tenant-scoped (". Real quoted code starts with a word or a slash.
      .filter((x) => /^[\w/]/.test(x))
      // Route notation the doc writes itself — `/agency/{n}/analytics` is a description of a URL
      // shape, not text lifted from a file, so it has no business being checked against one.
      .filter((x) => !/\{[a-z]\}/i.test(x));
    if (snippets.length) {
      const candidates = pathsByDocLine.get(docLine) ?? [path];
      const haystacks = candidates.map((c) => (lines(c) ?? []).join("\n").replace(/\s+/g, " "));
      for (const snip of snippets) {
        const needle = snip.replace(/\s+/g, " ").trim();
        const key = `${doc}:${docLine}:${needle}`;
        if (reported.has(key)) continue; // several citations share a doc line; report once
        if (!haystacks.some((h) => h.includes(needle))) {
          reported.add(key);
          console.warn(
            `⚠ QUOTED ${doc}:${docLine}  \`${needle.slice(0, 70)}\` appears in none of: ${candidates.join(", ")}`,
          );
          warnings++;
        }
      }
    }
  }
}

// ── SELF-TEST ─────────────────────────────────────────────────────────────────────────────────
// A guard with no test can stop guarding silently — not hypothetical here: the first version of the
// STALE check fired only on a definition's own declaration line and so PASSED on both real defects,
// and the check has since been refactored twice.
//
// The test RUNS THIS SCRIPT against a fixture rather than re-implementing its logic. An earlier
// draft asserted the underlying facts directly, which would have stayed green while the linter
// itself was broken — a self-test that cannot fail is decoration.
if (SELF_TEST) {
  const { spawnSync } = await import("node:child_process");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "doc-citation-selftest-"));
  const self = new URL(import.meta.url).pathname;

  const cases = [
    {
      label: "a definition DROPPED by a later migration (the starter auto-provisioner)",
      body: "Seeded on tenant insert by `20260711180000:311`.\n",
      expect: "fail",
    },
    {
      label: "a definition REPLACED by a later migration (the default-stage fallback)",
      body: "Falls back to default stages at `20260710200000:67`.\n",
      expect: "fail",
    },
    {
      // Deliberately a NON-migration file: migrations are append-only, so any function chosen here
      // may be superseded later and turn this case red for a reason that is not a regression. The
      // first draft used `20260831224500:139` and the self-test correctly failed it —
      // `configure_tenant_pipeline` is itself redefined twice more.
      label: "a citation into a normal source file is not flagged as stale",
      body: "This lint lives at `scripts/ci/doc-citation-lint.mjs:1`.\n",
      expect: "pass",
    },
    {
      label: "a line number past the end of the file is caught",
      body: "See `20261004000000:999999`.\n",
      expect: "fail",
    },
  ];

  let bad = 0;
  for (const [i, c] of cases.entries()) {
    const fixture = join(dir, `case${i}.md`);
    writeFileSync(fixture, c.body);
    const run = spawnSync(process.execPath, [self, fixture], { encoding: "utf8" });
    const failed = run.status !== 0;
    const want = c.expect === "fail";
    if (failed !== want) {
      console.error(`✗ self-test: expected ${c.expect.toUpperCase()} for ${c.label}; exit was ${run.status}`);
      console.error((run.stdout || "") + (run.stderr || ""));
      bad++;
    } else {
      console.log(`  ok   ${c.label}`);
    }
  }
  console.log(`\ndoc-citation-lint self-test: ${bad ? "FAIL" : "PASS"} — ${cases.length} case(s).`);
  if (bad) process.exit(1);
  if (!docs.length) process.exit(0);
}

const verdict = failures ? "FAIL" : "PASS";
console.log(`\ndoc-citation-lint: ${verdict} — ${checked} citations resolved, ${failures} failure(s), ${warnings} warning(s).`);
process.exit(failures ? 1 : 0);
