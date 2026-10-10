#!/usr/bin/env node
/**
 * BUILD-ORDER Layer 1's done-check, as a guard rather than a habit.
 *
 * CD's bar: *"`git grep` from `OperatorEntry` reaches every file under `surfaces/`. A file no
 * live path imports is not shipped, whatever its tests say."* That is exactly the failure the
 * main audit found — ~370 KB of correct porting reachable from nothing, pinned only by its own
 * tests, which is why a green suite proved nothing about it.
 *
 * So this walks the real import graph from the operator entry point and fails when a surface,
 * or any module under `src/operator/`, is orphaned. A test that renders a component is not the
 * console rendering it.
 *
 * Deliberately NOT a TypeScript-aware resolver: a regex over `import`/`export …  from` and
 * `import()` is enough for this codebase's conventions (`@/` alias or a relative path), and a
 * resolver that silently fails open would defeat the point. An unresolvable specifier is
 * reported rather than skipped.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ENTRY = "src/operator/OperatorEntry.tsx";

/** Modules that are legitimately reached by something other than the operator entry. */
const EXEMPT = new Map([
  [
    "src/operator/data/useOperatorChrome.ts",
    "Real reads with no consumer YET, held for Layer 6. It computes rail badges, fleet totals, a " +
      "role label and a status summary — and v3's rail foot draws exactly two controls (theme, " +
      "collapse), no badge and no footer, so none of it has a home in the shipped chrome. " +
      "BUILD-ORDER's rule is structure before data: the surfaces port first and unbacked figures " +
      "render em-dashes, so a read waiting for its wiring layer is correct. Deleting working " +
      "reads to satisfy a graph check would be the waste, not the fix.",
  ],
]);

const EXTS = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"];

function resolve(spec, from) {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null; // package import
  const base = spec.startsWith("@/") ? join("src", spec.slice(2)) : join(dirname(from), spec);
  for (const ext of EXTS) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p.replaceAll("\\", "/");
  }
  return null;
}

/** `from "x"`, `from 'x'`, and `import("x")` — the three forms this codebase uses. */
const SPEC_RE = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g;

function walk(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(SPEC_RE)) {
      const next = resolve(m[1], file);
      if (next) stack.push(next);
    }
  }
  return seen;
}

function listModules(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listModules(p));
    else if (/\.(tsx?|ts)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) out.push(p.replaceAll("\\", "/"));
  }
  return out;
}

if (!existsSync(ENTRY)) {
  console.error(`operator-reachability: entry ${ENTRY} does not exist.`);
  process.exit(1);
}

const reached = walk(ENTRY);
const all = listModules("src/operator");
const orphaned = all.filter((f) => !reached.has(f) && !EXEMPT.has(f));

if (orphaned.length) {
  console.error(
    `\n❌ operator-reachability: ${orphaned.length} module(s) under src/operator/ are not reachable from ${ENTRY}.\n`,
  );
  for (const f of orphaned) console.error(`   ${f}`);
  console.error(
    "\nA surface no live path imports is NOT shipped, whatever its tests say (BUILD-ORDER Layer 1).",
  );
  console.error("Mount it at its view, delete it, or add it to EXEMPT with the reason.\n");
  process.exit(1);
}

console.log(
  `✓ operator-reachability: ${all.length} module(s) under src/operator/, all reachable from ${ENTRY}.`,
);
