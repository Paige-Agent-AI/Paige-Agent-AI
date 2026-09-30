#!/usr/bin/env node
/**
 * definer-signature-acl.mjs — the §9/§59 rule that `definer-fn-lint.mjs` structurally could not see.
 *
 * WHY THIS EXISTS. `definer-fn-lint.mjs` fails a migration that DEFINES a public SECURITY DEFINER
 * function and, in the same file, EXPLICITLY grants it to anon/PUBLIC. That is one way a DEFINER
 * function becomes anon-reachable. It is not the only way, and the other way is silent:
 *
 *   A function with NO acl statement at all inherits PostgreSQL's default for functions,
 *   EXECUTE TO PUBLIC.
 *
 * The sibling guard cannot see that, for two reasons stated in its own header: it matches an
 * EXPLICIT grant, and it keys on the bare NAME, per file. So it is blind to (a) an implicit default
 * and (b) a SECOND SIGNATURE of a name whose other signature it has already seen granted.
 *
 * THE DEFECT THAT PROVED IT. `public.record_capability_run` — the one write path into
 * `paige_workspace_events`, a table otherwise sealed with FORCE RLS and REVOKE ALL — was locked
 * correctly on its 6-argument signature (20261212000000:491-493, 20261220000000:265-267). On
 * 2027-01-07, `20270107000000:94` added a TEN-argument overload. An overload is a new `pg_proc`
 * entry, not a replacement, so it inherited nothing, and that migration issued no GRANT and no
 * REVOKE for it. Name-level auditing reported the function as ACL'd, because the NAME was. Only a
 * signature-level, cross-file check surfaces it. `20270416000000` re-locks it. MEASURED ON PROD 2026-09-24 (pg_proc.proacl): both signatures already read `{postgres=X/postgres,service_role=X/postgres}`, so the hole is NOT live. The migration is not applied and 20270107000000 carries no GRANT/REVOKE, so an out-of-band action set that ACL -- the migration's real job is making the lock REPRODUCIBLE from the repo.
 *
 * THE BLANKET SWEEPS, AND WHY THERE IS A CUTOFF. Four DO-block statements revoke PUBLIC/anon
 * EXECUTE across every public DEFINER function — 20260627002438, 20260628220854, 20260629185611
 * and 20260629200234. A signature that existed when the last of those ran was swept clean whatever
 * its own migration said. Those are dynamic and no static rule can attribute them per-signature, so
 * this check applies only to functions first created AFTER `SWEEP_CUTOFF`. Without that cutoff the
 * rule reports ~200 pre-swept functions and becomes noise, which is how a guard gets switched off
 * instead of fixed.
 *
 * WHAT IT DOES NOT COVER, stated rather than implied:
 *   - Trigger functions. PostgreSQL refuses a direct call ("trigger functions can only be called as
 *     triggers", 0A000), so a PUBLIC grant on one is not a reachable path. Excluded.
 *   - The 12 ACL statements that live inside DO blocks. They are invisible to any static rule. In
 *     this corpus the over-count they cause is exactly one signature, and it is already dropped.
 *   - Production reality. This reads migration source. It cannot read `pg_proc.proacl`, so it proves
 *     what the tree says, not what the database did.
 *
 * Deliberately dependency-free. Run via `npm run lint:definer-fns`, which runs both rules.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const BASELINE_PATH = join(HERE, "definer-implicit-grant-baseline.json");

/** The last blanket DO-block sweep. Functions first created at or before this are already covered. */
export const SWEEP_CUTOFF = "20260629200234";

/** A file-level opt-out, reusing the sibling guard's marker plus one of our own. */
const EXEMPT_MARKER = /--\s*definer-(?:anon|implicit-grant)-exempt\s*:\s*\S+/i;

/**
 * Blank out `--` comments, `/* *\/` comments, '...' literals and $tag$...$tag$ bodies, preserving
 * offsets. Without this the scan matches CREATE FUNCTION inside prose (16 such occurrences here)
 * and inside DO-block bodies.
 */
export function maskSql(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const e = sql.indexOf("\n", i);
      const n = e === -1 ? sql.length : e;
      out += " ".repeat(n - i); i = n; continue;
    }
    if (sql.startsWith("/*", i)) {
      const e = sql.indexOf("*/", i + 2);
      const n = e === -1 ? sql.length : e + 2;
      out += " ".repeat(n - i); i = n; continue;
    }
    const dq = /^\$([a-zA-Z0-9_]*)\$/.exec(sql.slice(i));
    if (dq) {
      const tag = dq[0];
      const e = sql.indexOf(tag, i + tag.length);
      const n = e === -1 ? sql.length : e + tag.length;
      out += " ".repeat(n - i); i = n; continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      out += " ".repeat(j - i); i = j; continue;
    }
    out += sql[i]; i++;
  }
  return out;
}

const ALIAS = {
  int: "integer", int4: "integer", int2: "smallint", int8: "bigint",
  float: "double precision", float8: "double precision", float4: "real",
  bool: "boolean", varchar: "character varying", decimal: "numeric",
  timestamptz: "timestamp with time zone", timestamp: "timestamp without time zone",
  timetz: "time with time zone",
};
const MULTIWORD = [
  "timestamp with time zone", "timestamp without time zone",
  "time with time zone", "time without time zone",
  "character varying", "double precision", "bit varying",
];

/**
 * Normalise one parameter to its `pg_proc` identity type.
 *
 * `float` -> `double precision` is load-bearing and not cosmetic: `match_paige_memory` declares
 * `_match_threshold float` at its CREATE and `double precision` in its GRANT. Without the alias the
 * two read as different signatures and the function reports as unACL'd, which is a false positive
 * on a real and correctly-granted function. Typmods are stripped because `numeric(10,2)` and
 * `numeric` are the same entry.
 */
export function normaliseType(raw) {
  let t = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  t = t.replace(/\bdefault\b[\s\S]*$/i, "");          // DEFAULT clause and everything after it
  t = t.replace(/^(in|out|inout|variadic)\s+/i, "");  // argument mode
  t = t.replace(/\([^)]*\)/g, "");                    // typmod
  t = t.trim();
  const isArray = /\[\s*\]$/.test(t);
  if (isArray) t = t.replace(/\[\s*\]$/, "").trim();
  for (const mw of MULTIWORD) {
    if (t === mw || t.endsWith(` ${mw}`)) return mw + (isArray ? "[]" : "");
  }
  let last = t.split(" ").pop() || t;                 // `name type` -> type
  last = last.replace(/^(public|pg_catalog|extensions)\./, "");
  return (ALIAS[last] ?? last) + (isArray ? "[]" : "");
}

/** Split an argument list on top-level commas only. */
export function splitParams(argstr) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of argstr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

export function signatureOf(name, argstr) {
  return `${name.toLowerCase()}(${splitParams(argstr).map(normaliseType).join(",")})`;
}

/** Read the balanced argument list starting at the `(` at `openIdx`. */
function argsAt(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === "(") depth++;
    else if (masked[i] === ")") { depth--; if (depth === 0) return masked.slice(openIdx + 1, i); }
  }
  return null;
}

const CREATE_RE = /create\s+(?:or\s+replace\s+)?function\s+(?:public\s*\.\s*)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(/gi;
const ACL_RE = /(?:grant|revoke)[\s\S]{0,120}?on\s+function\s+(?:public\s*\.\s*)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(/gi;
const DROP_RE = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\s*\.\s*)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(/gi;

/** Scan a corpus of {file, sql} and return the live, post-cutoff, unACL'd DEFINER signatures. */
export function findImplicitGrants(corpus) {
  const created = new Map();   // signature -> first file that created it
  const lastCreate = new Map();
  const acld = new Set();
  const dropped = new Map();
  const triggers = new Set();

  for (const { file, sql } of corpus) {
    const m = maskSql(sql);
    if (EXEMPT_MARKER.test(sql)) continue;

    for (const mt of m.matchAll(CREATE_RE)) {
      const open = mt.index + mt[0].length - 1;
      const args = argsAt(m, open);
      if (args === null) continue;
      const sig = signatureOf(mt[1], args);
      const tail = m.slice(open, open + 3000);
      const asIdx = tail.search(/\bas\b/i);
      const head = asIdx === -1 ? tail : tail.slice(0, asIdx);
      if (!/\bsecurity\s+definer\b/i.test(head)) continue;
      if (/\breturns\s+trigger\b/i.test(head)) { triggers.add(sig); continue; }
      if (!created.has(sig)) created.set(sig, file);
      lastCreate.set(sig, file);
    }
    for (const mt of m.matchAll(ACL_RE)) {
      const open = mt.index + mt[0].length - 1;
      const args = argsAt(m, open);
      if (args !== null) acld.add(signatureOf(mt[1], args));
    }
    for (const mt of m.matchAll(DROP_RE)) {
      const open = mt.index + mt[0].length - 1;
      const args = argsAt(m, open);
      if (args !== null) dropped.set(signatureOf(mt[1], args), file);
    }
  }

  const findings = [];
  for (const [sig, firstFile] of created) {
    if (acld.has(sig) || triggers.has(sig)) continue;
    const drop = dropped.get(sig);
    if (drop && drop > (lastCreate.get(sig) ?? firstFile)) continue;  // dropped after its last create
    if (firstFile.slice(0, 14) <= SWEEP_CUTOFF) continue;             // covered by a blanket sweep
    findings.push({ rule: "implicit-default-grant", path: `supabase/migrations/${firstFile}`, signature: sig });
  }
  return findings.sort((a, b) => (a.path + a.signature).localeCompare(b.path + b.signature));
}

function readCorpus() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

export function run() {
  const findings = findImplicitGrants(readCorpus());
  let baseline = [];
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (e) {
    console.error(`[definer-signature-acl] cannot read baseline ${BASELINE_PATH}: ${e.message}`);
    return 1;
  }

  // Shrink-only, by exact signature. Removing debt is always allowed; adding it is not.
  const admitted = new Map();
  for (const b of baseline) {
    const k = `${b.path}::${b.signature}`;
    admitted.set(k, (admitted.get(k) ?? 0) + 1);
  }
  const additions = [];
  for (const f of findings) {
    const k = `${f.path}::${f.signature}`;
    const left = admitted.get(k) ?? 0;
    if (left > 0) admitted.set(k, left - 1);
    else additions.push(f);
  }

  if (additions.length > 0) {
    console.error("");
    console.error("✗ definer-signature-acl FAILED — public SECURITY DEFINER function(s) with NO ACL at all:");
    for (const a of additions) console.error(`    • ${a.signature}\n        created in ${a.path}`);
    console.error("");
    console.error("  A function with no GRANT and no REVOKE inherits PostgreSQL's default, EXECUTE TO");
    console.error("  PUBLIC — which includes anon and authenticated. A SECURITY DEFINER function bypasses");
    console.error("  RLS, so that is an unauthenticated caller running RLS-bypassing logic.");
    console.error("");
    console.error("  THIS FIRES ON A NEW SIGNATURE TOO. An overload is a new pg_proc entry and inherits");
    console.error("  nothing from the signature it sits beside — that is exactly how record_capability_run");
    console.error("  lost its lock (20270107000000). Granting `name(a,b)` does not grant `name(a,b,c)`.");
    console.error("");
    console.error("  Fix one of:");
    console.error("    1) REVOKE ALL ON FUNCTION public.<name>(<exact types>) FROM PUBLIC, anon, authenticated;");
    console.error("       then GRANT EXECUTE ... TO the roles that genuinely need it, or");
    console.error("    2) if the default grant is deliberate and load-bearing — an RLS policy expression");
    console.error("       evaluated as the caller needs it — add `-- definer-implicit-grant-exempt: <reason>`");
    console.error("       in that migration.");
    console.error("");
    console.error("  Never widen the baseline to clear CI. It is shrink-only and additions fail here.");
    console.error("");
    return 1;
  }

  const stale = [...admitted.values()].reduce((a, b) => a + b, 0);
  console.log(
    `✓ definer-signature-acl: ${findings.length}/${baseline.length} baseline entries remain` +
    `${stale ? ` (${stale} cleared)` : ""}; no new implicit-default grant.`,
  );
  return 0;
}

export function selfTest() {
  const cases = [];
  const ok = (name, cond) => { cases.push([name, cond]); };
  const AFTER = "20270101000000_x.sql";           // after SWEEP_CUTOFF
  const BEFORE = "20260601000000_x.sql";          // before SWEEP_CUTOFF

  // 1. the real defect shape: DEFINER created, no ACL anywhere
  ok("bare DEFINER after the sweep is caught", findImplicitGrants([
    { file: AFTER, sql: "create function public.f(_a uuid) returns void language plpgsql security definer as $$ begin end $$;" },
  ]).length === 1);

  // 2. an ACL in a DIFFERENT migration clears it (cross-file is the whole point)
  ok("ACL in another file clears it", findImplicitGrants([
    { file: AFTER, sql: "create function public.f(_a uuid) returns void language plpgsql security definer as $$ begin end $$;" },
    { file: "20270102000000_y.sql", sql: "revoke all on function public.f(uuid) from public;" },
  ]).length === 0);

  // 3. THE OVERLOAD CASE — granting name(a) must NOT clear name(a,b)
  ok("an overload is not cleared by its sibling's grant", findImplicitGrants([
    { file: AFTER, sql: "create function public.f(_a uuid) returns void language plpgsql security definer as $$ begin end $$;\n" +
                        "grant execute on function public.f(uuid) to service_role;\n" +
                        "create function public.f(_a uuid, _b text) returns void language plpgsql security definer as $$ begin end $$;" },
  ]).length === 1);

  // 4. pre-sweep functions are not reported
  ok("pre-sweep creation is exempt", findImplicitGrants([
    { file: BEFORE, sql: "create function public.g() returns void language plpgsql security definer as $$ begin end $$;" },
  ]).length === 0);

  // 5. trigger functions are excluded
  ok("trigger function excluded", findImplicitGrants([
    { file: AFTER, sql: "create function public.t() returns trigger language plpgsql security definer as $$ begin return new; end $$;" },
  ]).length === 0);

  // 6. SECURITY INVOKER is not our business
  ok("invoker function ignored", findImplicitGrants([
    { file: AFTER, sql: "create function public.i() returns void language sql security invoker as $$ select 1 $$;" },
  ]).length === 0);

  // 7. a CREATE FUNCTION inside a comment must not count
  ok("commented-out CREATE ignored", findImplicitGrants([
    { file: AFTER, sql: "-- create function public.c() returns void language plpgsql security definer as $$ begin end $$;" },
  ]).length === 0);

  // 8. a CREATE FUNCTION inside a dollar-quoted body must not count
  ok("CREATE inside a dollar-quoted body ignored", findImplicitGrants([
    { file: AFTER, sql: "do $mig$ begin execute 'create function public.d() returns void security definer'; end $mig$;" },
  ]).length === 0);

  // 9. the float/double-precision alias trap — CREATE says float, GRANT says double precision
  ok("float and double precision are the same signature", findImplicitGrants([
    { file: AFTER, sql: "create function public.m(_t float) returns void language plpgsql security definer as $$ begin end $$;" },
    { file: "20270102000000_y.sql", sql: "grant execute on function public.m(double precision) to authenticated;" },
  ]).length === 0);

  // 10. typmod and schema qualification normalise
  ok("typmod and schema qualification normalise", findImplicitGrants([
    { file: AFTER, sql: "create function public.n(_v extensions.vector(1536), _p numeric(10,2)) returns void language plpgsql security definer as $$ begin end $$;" },
    { file: "20270102000000_y.sql", sql: "revoke all on function public.n(vector, numeric) from public;" },
  ]).length === 0);

  // 11. dropped after its last create is not live
  ok("dropped signature is not reported", findImplicitGrants([
    { file: AFTER, sql: "create function public.z() returns void language plpgsql security definer as $$ begin end $$;" },
    { file: "20270103000000_z.sql", sql: "drop function public.z();" },
  ]).length === 0);

  // 12. the file-level exemption marker
  ok("exemption marker opts a file out", findImplicitGrants([
    { file: AFTER, sql: "-- definer-implicit-grant-exempt: evaluated inside an RLS policy as the caller\ncreate function public.e() returns void language plpgsql security definer as $$ begin end $$;" },
  ]).length === 0);

  const failed = cases.filter(([, c]) => !c);
  for (const [n, c] of cases) console.log(`  ${c ? "ok  " : "FAIL"}  ${n}`);
  if (failed.length) { console.error(`\n✗ definer-signature-acl self-test: ${failed.length} of ${cases.length} failed.`); return 1; }
  console.log(`\n✓ definer-signature-acl self-test passed — ${cases.length} cases.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(process.argv.includes("--self-test") ? selfTest() : run());
}
