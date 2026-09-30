#!/usr/bin/env node
/**
 * scripts/reconcile-missing-migrations.mjs — Task #421 Phase-2 reconciliation GENERATOR.
 *
 * WHAT THIS DOES (repo-only; it NEVER connects to prod and NEVER writes schema_migrations):
 *   Prod's `supabase_migrations.schema_migrations` ledger has drifted ahead of the repo's
 *   `supabase/migrations/` directory (172 prod-only versions with no local file; 33 local
 *   files never recorded on prod). This script reconciles the REPO so the pipeline's
 *   `supabase db push` (.github/workflows/deploy-migrations.yml; plain since 2026-09-29, never
 *   `--include-all`) sees a history that matches prod. It does exactly four repo-only mutations, then writes an audit report:
 *     1. RENAME (git mv) each local file that is a content-TWIN of a prod-only migration to
 *        prod's recorded version stamp — KEEPING the local file body as source-of-truth
 *        (owner call #4). Records a byte-fidelity drift signal; never overwrites with ledger SQL.
 *     2. RECONSTRUCT (fs write) each genuinely-missing prod-only migration from the ledger's
 *        recorded `statements`, under a provenance header. classification 'RECONSTRUCTED'.
 *     3. QUARANTINE the §2 funding/vendor bootstrap 20250908112911 as a NO-OP STUB —
 *        funding/vendor INSERTs are STRIPPED (owner call #1). classification 'RECONSTRUCTED_QUARANTINED'.
 *     4. EXCLUDE (git rm) the foreign-project orphan 20260715011405 (owner call #3).
 *   Anything ambiguous (a local-only file that does NOT exactly match a prod-only name, or a
 *   name/local with >1 candidate on either side) is FLAGGED in `unmatchedLocalOnly` for
 *   integrator/owner decision — it is NEVER auto-renamed or guessed.
 *
 * TWO-PHASE BY CONSTRUCTION (verifier PL-0): a PRE-PASS computes the ENTIRE plan and runs every
 *   guard (input validation, empty-statements, slug/path-jail, written-path uniqueness,
 *   conservation) touching NOTHING on disk. Only after the pre-pass returns clean does the
 *   single MUTATE phase run (writes → git mv → git rm → report). A guard that throws therefore
 *   leaves the working tree byte-for-byte pristine — no half-renamed state to hand-untangle.
 *
 * IT IS REPO-ONLY. It writes .sql files under supabase/migrations/, runs `git mv`/`git rm`,
 * and writes scripts/_reconcile/reconcile-report.json. It does NOT open a DB connection, does
 * NOT apply migrations, and does NOT touch prod schema_migrations. The APPLY is done later by
 * the standard `supabase db push` pipeline on merge to main — not here.
 *
 * REVIEWER NO-NETWORK GREP (verifier PL-h1) — this source must contain ZERO of:
 *   pg | postgres | @supabase/supabase-js | psql | 'db push' | execute_sql | apply_migration |
 *   fetch | http | https | net | SERVICE_ROLE | SUPABASE_DB_PASSWORD | access[-_ ]?token
 *   as an executable path. (The strings `schema_migrations` / `funding_offers` etc. appear ONLY
 *   as inert documentation text inside the embedded headers — never in a code path.)
 *   Confirm with:  grep -nE "pg|postgres|supabase-js|psql|db push|fetch|http|net|SERVICE_ROLE" scripts/reconcile-missing-migrations.mjs
 *
 * INPUTS (paths overridable via CLI flags; defaults documented):
 *   --ledger        scripts/_reconcile/ledger-dump.json
 *                     JSON array of { version:string, name:string, statements:string[] } for the
 *                     172 prod-only migrations. The integrator produces this via the Supabase MCP
 *                     and places it. `name===''` marks the 5 unnamed Sept-2025 bootstrap rows.
 *   --prod-versions scripts/_reconcile/prod-versions.txt
 *                     Newline list of ALL 682 prod-recorded versions. Used ONLY to compute
 *                     local-only (repo files whose 14-digit version is not recorded on prod).
 *   --migrations    supabase/migrations   (dir of `<14digit>_<slug>.sql` files)
 *   --out           scripts/_reconcile/reconcile-report.json
 *   --dry-run       Compute + write the report, but perform NO fs writes / git mv / git rm.
 *                     (For the integrator's own inspection pass; default is to mutate the repo.)
 *
 * RUN (by the INTEGRATOR, from repo root):  node scripts/reconcile-missing-migrations.mjs
 *
 * DETERMINISM & IDEMPOTENCY: versions are processed in sorted order; re-running is safe (a twin
 * already renamed is detected and skipped; the orphan already removed is skipped; a reconstructed
 * file already present is left as-is and reported, not clobbered). No timestamp/random bytes ever
 * enter a .sql body (only reconcile-report.json.generatedAt varies between runs), so a re-run on
 * unchanged inputs produces byte-identical .sql outputs.
 *
 * §13 honesty: the report is the PR review surface — it records exactly what happened (drift
 * flags, unmatched flags, skips), never a hoped-for outcome. §32: the EMPTY-GUARD throws in the
 * pre-pass rather than ever emitting a blank migration.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ---- CLI arg parsing (all optional; sensible repo-relative defaults) -------------------------
function argOf(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DRY_RUN = process.argv.includes('--dry-run');
const LEDGER_PATH = resolve(REPO_ROOT, argOf('--ledger', 'scripts/_reconcile/ledger-dump.json'));
const PROD_VERSIONS_PATH = resolve(REPO_ROOT, argOf('--prod-versions', 'scripts/_reconcile/prod-versions.txt'));
const MIGRATIONS_DIR = resolve(REPO_ROOT, argOf('--migrations', 'supabase/migrations'));
const REPORT_PATH = resolve(REPO_ROOT, argOf('--out', 'scripts/_reconcile/reconcile-report.json'));
const RECONCILE_DIR = resolve(REPO_ROOT, 'scripts/_reconcile');
const REL_MIGRATIONS = relative(REPO_ROOT, MIGRATIONS_DIR); // for clean git args

// ---- Well-known constants from Phase-1 (MCP-verified) ---------------------------------------
const QUARANTINE_VERSION = '20250908112911'; // §2 funding/vendor bootstrap → NO-OP STUB (owner #1)
const QUARANTINE_SLUG = 'remote_bootstrap_funding_seed_quarantined'; // compliance-fixed filename slug
const ORPHAN_VERSION = '20260715011405';     // foreign-project (bfmyebsjyuoecmjskqhs) orphan → git rm (owner #3)

// MANUAL TWINS (integrator-resolved, task #421). Local-only files whose slug does NOT exactly match
// their prod-only twin's name, but whose BODY is verified (2026-07-22, content-compared vs the
// ledger dump) to be the SAME logical migration — a near-miss slug rename. Each entry pins a
// prod-only version to the exact local file that owns it, so that version is RENAMED (local body
// kept as source-of-truth, owner #4) instead of reconstructed-as-a-duplicate. Map: prodVersion -> localFile.
//   • 20260715125930 growth_fire_submission_processor_cron_token
//       ← local 20260715120000_growth_fire_processor_cron_token.sql (both the x-cron-token forward-fix)
//   • 20260715231415 custom_field_definitions
//       ← local 20260716090000_custom_field_definitions.sql (byte-identical 25497-char body; prod
//         ALSO has a separate 20260715231230 PLACEHOLDER row for this name, which reconstructs on its own)
const MANUAL_TWINS = new Map([
  ['20260715125930', '20260715120000_growth_fire_processor_cron_token.sql'],
  ['20260715231415', '20260716090000_custom_field_definitions.sql'],
]);
const VERSION_RE = /^(\d{14})_(.+)\.sql$/;   // <14 digits>_<slug>.sql
const V14_RE = /^\d{14}$/;
const SLUG_RE = /^[a-z0-9_]+$/;              // repo filename slug convention (verifier PL-add1)

// Advisory-only Phase-1 expectations (verifier PL-a6 / PL-add8): these WARN on divergence, they
// NEVER gate control flow.
const EXPECT = { prodOnly: 172, localOnly: 33, prodVersions: 682, unnamed: 5, twins: 32 };

// ---- Compliance-provided text blocks (embedded VERBATIM) -------------------------------------
// Provenance header stamped onto every plain RECONSTRUCTED file. §13: reconstructed from the prod
// ledger, NOT from a `supabase db pull`. Contains NO timestamp/random bytes (verifier PL-d3).
function provenanceHeader(version, displayName) {
  return [
    '-- =============================================================================',
    `-- RECONSTRUCTED from prod ledger — version ${version} (${displayName})`,
    '-- =============================================================================',
    '-- This file is the SQL recorded in',
    `-- supabase_migrations.schema_migrations.statements for version ${version} on prod`,
    '-- (ref xygzykjyynhzqytbqnzu) — i.e. the statements that ACTUALLY RAN on prod when',
    "-- this migration was applied via the owner's dashboard/MCP.",
    '--',
    '-- It is NOT a recovered original-authored migration file, and NO `supabase db',
    '-- pull` / schema introspection was run to produce it. It is reconstructed',
    '-- verbatim from the recorded ledger statements for the SOLE purpose of restoring',
    '-- repo<->prod migration-history parity, so `supabase db push` no longer trips its',
    '-- "remote migration versions not found in local" history guard.',
    '--',
    '-- Because prod already records this version, `db push` treats it as',
    '-- already-applied and does NOT re-run it; it re-executes only on a fresh-DB',
    "-- reset (idempotency is this file's own responsibility, per the recorded SQL).",
    '--',
    '-- Generated by scripts/reconcile-missing-migrations.mjs (task #421). Do not edit',
    '-- to "fix" behavior — this is a faithful transcript of the applied prod SQL.',
    '-- =============================================================================',
  ].join('\n');
}

// §2 QUARANTINE STUB for 20250908112911 — compliance-supplied EXACT body, embedded verbatim.
// Deliberate no-op: the funding/vendor SEED is STRIPPED (owner call #1). The funding/vendor names
// appear ONLY in explanatory comments (the §2 disclosure) — there is NO executable seed DML.
function quarantineStub() {
  return [
    '-- =============================================================================',
    '-- Migration 20250908112911 — §2 QUARANTINE STUB (deliberate no-op)',
    '-- =============================================================================',
    '-- This file is a DELIBERATE NO-OP replacement for the SQL recorded in prod',
    '-- supabase_migrations.schema_migrations.statements for version 20250908112911.',
    '-- It is NOT the original-authored migration and NOT the product of a db pull.',
    '--',
    '-- The recorded prod statements for this version seeded public.funding_offers',
    '-- (Chase Ink, Bluevine, Kabbage, Equipment Finance, Ford — APR ranges,',
    "-- affiliate_tag 'MOGUL_CHASE') and public.vendor_offers (Uline, Grainger,",
    "-- Shell, Dell, Chase — code 'MOGUL001'). Those seed rows are funding/credit +",
    '-- affiliate content and are DELIBERATELY OMITTED here under CLAUDE.md §2 — no',
    '-- funding/credit content in platform defaults, no vertical seed in the platform',
    '-- default registry — with explicit owner sign-off on 2026-07-22. Funding/credit',
    '-- is an opt-in tenant preset, never a default seeded for every tenant.',
    '--',
    '-- SCHEMA IS UNAFFECTED: the funding_offers / vendor_offers table DDL is carried',
    '-- by the §2-clean schema twin migration 20250908112841 (reconstructed',
    '-- schema-only, no seed rows). This stub creates and seeds nothing.',
    '--',
    '-- LIVE STATE (verified on prod ref xygzykjyynhzqytbqnzu, 2026-07-22):',
    '-- funding_offers = 0 rows and vendor_offers = 0 rows — the historical seed was',
    '-- applied then deleted, so this is a migration-HISTORY concern, not a live-data',
    '-- leak. Replacing the seed with this no-op means a fresh `supabase db reset`',
    '-- ships both tables EMPTY / seedless, which is the intended §2-clean outcome.',
    '--',
    '-- Tracked debt: de-credit cluster #360 / #209.',
    '-- =============================================================================',
    '',
    '-- Intentional no-op: records the version in schema_migrations without applying',
    '-- any DDL or DML. Safe and idempotent on every run.',
    'DO $$',
    'BEGIN',
    '  -- §2 quarantine: funding_offers / vendor_offers seed rows intentionally',
    '  -- omitted (see header). Table DDL is created by migration 20250908112841.',
    '  NULL;',
    'END $$;',
  ].join('\n');
}

// ---- Normalizer for the byte-fidelity drift signal (§32, ADVISORY) --------------------------
// normalize = strip SQL comments + collapse whitespace + trim (case PRESERVED — identifier case
// is meaningful, so a case-only difference SHOULD register as drift). Because whitespace is
// collapsed to single spaces, the join separator (\n vs \n\n) cannot manufacture false drift.
// HEURISTIC: comment-stripping via regex can misfire inside string literals ('--not a comment'),
// so `drift:false` is a SIGNAL, never a proof of equality (§13 honest labeling).
function normalizeSql(s) {
  return String(s ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // /* block comments */
    .replace(/--[^\n]*/g, ' ')          // -- line comments
    .replace(/\s+/g, ' ')               // collapse all whitespace
    .trim();
}

function die(msg) {
  console.error(`\n[reconcile] FATAL: ${msg}\n`);
  process.exit(1);
}
function warn(msg) {
  console.warn(`[reconcile] WARN: ${msg}`);
}

// Write-path JAIL (verifier PL-h3): every write/mv/rm target must resolve inside
// supabase/migrations/ or scripts/_reconcile/, and inside the repo root. Throws otherwise.
const JAIL_ROOTS = [MIGRATIONS_DIR, RECONCILE_DIR];
function assertInJail(p) {
  const r = resolve(p);
  if (r !== REPO_ROOT && !r.startsWith(REPO_ROOT + sep)) {
    die(`write-path jail: ${r} escapes repo root ${REPO_ROOT}.`);
  }
  const ok = JAIL_ROOTS.some((root) => r === root || r.startsWith(root + sep));
  if (!ok) die(`write-path jail: ${r} is outside supabase/migrations/ and scripts/_reconcile/.`);
  return r;
}

// child_process is git-ONLY with a subcommand allowlist (verifier PL-h2/PL-d4). Array args, never
// a shell string. Anything but `git mv` / `git rm` throws. Read-only `ls-files`/`status` allowed
// for guards if ever added. Fails loud (§13) rather than silently desyncing.
const GIT_SUBCOMMAND_ALLOWLIST = new Set(['mv', 'rm', 'ls-files', 'status']);
function git(args) {
  if (!Array.isArray(args) || args.length === 0) die('git(): args must be a non-empty array.');
  if (!GIT_SUBCOMMAND_ALLOWLIST.has(args[0])) {
    die(`git(): subcommand '${args[0]}' is not in the allowlist {mv, rm, ls-files, status}.`);
  }
  return execFileSync('git', args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

// Defensive secret heuristic (verifier PL-add7, LOW): flag reconstructed bodies that carry a
// literal that looks like a live key/token, for reviewer eyes. ADVISORY — does not block the write
// (the body is the real applied prod SQL, §13); the flag surfaces it in the report.
const SECRET_RE = /\b(sk_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{10,}|[A-Fa-f0-9]{40,})\b/;
function looksLikeSecret(body) {
  return SECRET_RE.test(String(body ?? ''));
}

// =============================================================================================
// ============================ PRE-PASS (compute + guard; NO DISK MUTATION) ====================
// =============================================================================================

// ---- 1. Load + validate inputs --------------------------------------------------------------
if (!existsSync(LEDGER_PATH)) die(`ledger dump not found at ${LEDGER_PATH} (integrator must place it — see --ledger).`);
if (!existsSync(PROD_VERSIONS_PATH)) die(`prod-versions list not found at ${PROD_VERSIONS_PATH} (see --prod-versions).`);
if (!existsSync(MIGRATIONS_DIR)) die(`migrations dir not found at ${MIGRATIONS_DIR}`);

let ledger;
try {
  ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
} catch (e) {
  die(`could not parse ledger dump as JSON: ${e.message}`);
}
if (!Array.isArray(ledger)) die('ledger dump must be a JSON array of { version, name, statements }.');

// Validate & index the prod-only ledger rows (verifier PL-add2: 14-digit version on every row).
const prodOnly = new Map(); // version -> { version, name, statements }
for (const row of ledger) {
  if (!row || typeof row.version !== 'string' || !V14_RE.test(row.version)) {
    die(`ledger row has a bad/absent 14-digit version: ${JSON.stringify(row)?.slice(0, 200)}`);
  }
  if (typeof row.name !== 'string') die(`ledger row ${row.version} has a non-string name.`);
  if (row.statements != null && !Array.isArray(row.statements)) {
    die(`ledger row ${row.version} has a non-array statements field.`);
  }
  if (prodOnly.has(row.version)) die(`duplicate version ${row.version} in ledger dump.`);
  prodOnly.set(row.version, { version: row.version, name: row.name, statements: row.statements ?? [] });
}

// prod-versions.txt parse hygiene + cardinality (verifier PL-add3).
const prodVersions = new Set(
  readFileSync(PROD_VERSIONS_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      if (!V14_RE.test(l)) die(`prod-versions.txt has a non-14-digit entry: '${l}'`);
      return l;
    }),
);

// ---- 1b. Index the repo migrations dir ------------------------------------------------------
const repoFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
const versionToFile = new Map(); // version -> filename
const slugToLocalOnly = new Map(); // slug -> [filename] for LOCAL-ONLY files only
const localOnlyFiles = []; // [{ file, version, slug }]

for (const file of repoFiles) {
  const m = file.match(VERSION_RE);
  if (!m) {
    warn(`repo file does not match <14digits>_<slug>.sql, ignored: ${file}`);
    continue;
  }
  const [, version] = m;
  if (!V14_RE.test(version)) die(`repo file ${file} parsed a non-14-digit version.`);
  if (versionToFile.has(version)) die(`two repo files share version ${version}: ${versionToFile.get(version)} / ${file}`);
  versionToFile.set(version, file);
}

// Input-integrity cross-checks (verifier PL-add3):
//  - a ledger "prod-only" version that ALSO has a local file is a contradiction.
//  - a ledger "prod-only" version MUST appear in the full prod-versions list.
for (const v of prodOnly.keys()) {
  if (versionToFile.has(v)) {
    die(`ledger claims ${v} is prod-only, but a local file exists (${versionToFile.get(v)}). Inputs are inconsistent — resolve before running.`);
  }
  if (!prodVersions.has(v)) {
    die(`ledger prod-only version ${v} is absent from prod-versions.txt — inputs inconsistent (a prod-only row must be a recorded prod version).`);
  }
}

// local-only = repo file whose version is NOT recorded on prod.
for (const [version, file] of versionToFile) {
  if (!prodVersions.has(version)) {
    const slug = file.match(VERSION_RE)[2];
    localOnlyFiles.push({ file, version, slug });
    if (!slugToLocalOnly.has(slug)) slugToLocalOnly.set(slug, []);
    slugToLocalOnly.get(slug).push(file);
  }
}

// prod-side name-multiplicity (verifier PL-a3): a name shared by >1 prod row can never be an
// unambiguous twin target.
const prodNameCounts = new Map();
for (const row of prodOnly.values()) {
  if (row.name === '') continue;
  prodNameCounts.set(row.name, (prodNameCounts.get(row.name) || 0) + 1);
}

// ---- 2. Build the PLAN (pure; the report buckets are projections of these) -------------------
const renamePlan = [];      // { version, fromFile, toFile, drift, note, alreadyApplied }
const reconstructPlan = []; // { version, slug, file }
const quarantinePlan = [];  // { version, slug, file }
const excludePlan = [];     // { version, file, reason }
const unmatchedPlan = [];   // { file, reason }
const securityFlags = [];   // { version, file, reason } (advisory)

const consumedLocalFiles = new Set(); // local filenames claimed as a twin
const flaggedFiles = new Set();       // local filenames pushed to unmatched (dedupe)
const twinnedProdVersions = new Set();// prod versions covered by a rename (NOT reconstructed)
const outputPaths = new Set();        // verifier PL-b2: every write/mv-target path, THROW on dup

function claimOutputPath(absPath) {
  const r = assertInJail(absPath); // PL-h3
  if (outputPaths.has(r)) die(`duplicate_output_path: two operations target the same file ${r}.`);
  outputPaths.add(r);
  return r;
}
function flagLocal(file, reason) {
  if (flaggedFiles.has(file)) return;
  flaggedFiles.add(file);
  unmatchedPlan.push({ file, reason });
}

const sortedProd = [...prodOnly.values()].sort((a, b) => a.version.localeCompare(b.version));

// ---- 2a. ORPHAN excluded FIRST, before any twin matching (verifier PL-a2) -------------------
// Remove the foreign-project orphan from the candidate pool by explicit version match so its UUID
// slug can never surface as a twin candidate or as unmatched.
for (const lo of localOnlyFiles) {
  if (lo.version === ORPHAN_VERSION) {
    consumedLocalFiles.add(lo.file); // remove from the twin/unmatched pools
    claimOutputPath(join(MIGRATIONS_DIR, lo.file));
    excludePlan.push({
      version: lo.version,
      file: lo.file,
      reason:
        'EXCLUDED_DELETE: orphan with no prod twin; body rebinds a cron to FOREIGN project ref ' +
        'bfmyebsjyuoecmjskqhs (not prod xygzykjyynhzqytbqnzu). Never applied to prod. Owner call #3: delete from repo.',
    });
  }
}

// ---- 2a-bis. MANUAL TWINS (integrator-resolved near-miss renames) — before auto-matching ------
// Pinned prodVersion->localFile pairs whose bodies are integrator-verified to be the same migration
// despite a non-matching slug. Rename (keep local body, owner #4); NEVER reconstruct these versions.
for (const [prodVersion, fromFile] of MANUAL_TWINS) {
  const row = prodOnly.get(prodVersion);
  if (!row) die(`manual_twin: prod version ${prodVersion} is not in the ledger dump — cannot pin a twin to it.`);
  if (row.name === '') die(`manual_twin: prod version ${prodVersion} is unnamed; refusing a named twin target.`);
  if (!SLUG_RE.test(row.name)) die(`manual_twin: prod name '${row.name}' for ${prodVersion} violates the slug convention.`);
  const lo = localOnlyFiles.find((x) => x.file === fromFile);
  if (!lo) die(`manual_twin: ${fromFile} is not a local-only migration — cannot rename (already on prod, or absent).`);
  if (consumedLocalFiles.has(fromFile)) die(`manual_twin: ${fromFile} already consumed — conflicting manual twin.`);
  if (twinnedProdVersions.has(prodVersion)) die(`manual_twin: prod version ${prodVersion} already twinned — duplicate manual twin.`);

  const toFile = `${prodVersion}_${row.name}.sql`;
  const fromPath = join(MIGRATIONS_DIR, fromFile);
  const toPath = join(MIGRATIONS_DIR, toFile);
  const fromExists = existsSync(fromPath);
  const toExists = existsSync(toPath);
  if (fromExists && toExists) {
    flagLocal(fromFile, `manual_twin rename_target_collision: ${toFile} already exists alongside ${fromFile}. Manual resolution required.`);
    continue;
  }
  if (!fromExists && !toExists) die(`manual_twin source_missing: expected ${fromFile} or ${toFile} for ${prodVersion}, found neither.`);
  const alreadyApplied = !fromExists && toExists;

  const bodyPath = fromExists ? fromPath : toPath;
  const drift = normalizeSql(readFileSync(bodyPath, 'utf8')) !== normalizeSql((row.statements || []).join('\n'));
  let note =
    `MANUAL TWIN (near-miss slug '${lo.slug}' -> prod name '${row.name}', integrator-verified same migration 2026-07-22). ` +
    (drift
      ? 'DRIFT (ADVISORY): normalized local body != ledger statements; keeping LOCAL body (owner #4).'
      : 'no drift (ADVISORY): normalized local body matches ledger statements.');
  if (alreadyApplied) note = `already renamed (idempotent skip). ${note}`;

  consumedLocalFiles.add(fromFile);
  twinnedProdVersions.add(prodVersion);
  claimOutputPath(toPath);
  renamePlan.push({ version: prodVersion, fromFile, toFile, drift, note, alreadyApplied, manual: true });
}

// ---- 2b. TWIN planning — EXACT-equality slug===name ONLY, 1:1 cardinality (PL-a1/PL-a3/PL-a5) -
for (const row of sortedProd) {
  if (twinnedProdVersions.has(row.version)) continue; // already covered by a MANUAL twin
  if (row.name === '') continue; // unnamed bootstrap rows can never twin by slug
  const candidates = (slugToLocalOnly.get(row.name) || []).filter((f) => !consumedLocalFiles.has(f));
  if (candidates.length === 0) continue; // no exact-slug local twin → handled as MISSING below

  // Reject ambiguity on EITHER side — never guess which file owns a version (verifier PL-a3).
  if (prodNameCounts.get(row.name) > 1) {
    for (const f of candidates) {
      flagLocal(f, `ambiguous_slug_multiple_candidates: slug '${row.name}' is recorded on ${prodNameCounts.get(row.name)} prod-only versions; cannot auto-rename — integrator/owner to resolve.`);
    }
    continue; // both prod rows fall through to reconstruction
  }
  if (candidates.length > 1) {
    for (const f of candidates) {
      flagLocal(f, `ambiguous_slug_multiple_candidates: ${candidates.length} local-only files share slug '${row.name}' matching prod version ${row.version}; cannot auto-rename — integrator/owner to resolve.`);
    }
    continue;
  }

  const fromFile = candidates[0];
  const toFile = `${row.version}_${row.name}.sql`;
  const fromPath = join(MIGRATIONS_DIR, fromFile);
  const toPath = join(MIGRATIONS_DIR, toFile);
  const fromExists = existsSync(fromPath);
  const toExists = existsSync(toPath);

  // Idempotency / collision states (verifier PL-a5/PL-d1):
  if (fromExists && toExists) {
    // Both present — refuse to clobber; flag the local, let the prod row reconstruct.
    flagLocal(fromFile, `rename_target_collision (ambiguous_both_exist): target ${toFile} already exists alongside source ${fromFile}. Manual resolution required — not auto-renamed.`);
    continue;
  }
  if (!fromExists && !toExists) {
    die(`source_missing: twin rename for ${row.version} expected ${fromFile} or ${toFile} on disk, found neither. Inputs/tree inconsistent.`);
  }
  const alreadyApplied = !fromExists && toExists; // prior run already renamed this

  // §32 byte-fidelity drift signal — read whichever body is on disk (post-rename we read target).
  const bodyPath = fromExists ? fromPath : toPath;
  const localBody = readFileSync(bodyPath, 'utf8');
  const ledgerBody = (row.statements || []).join('\n');
  const nLocal = normalizeSql(localBody);
  const nLedger = normalizeSql(ledgerBody);
  const drift = nLocal !== nLedger;
  let note = drift
    ? `DRIFT (ADVISORY): normalized local body (${nLocal.length} chars) != normalized ledger statements (${nLedger.length} chars). Keeping LOCAL body as source-of-truth (owner #4); comment-strip heuristic, not a proof — diff logged for review.`
    : `no drift (ADVISORY): normalized local body matches ledger statements (${nLocal.length} chars). Heuristic signal, not a proof of equality.`;
  if (alreadyApplied) note = `already renamed (idempotent skip). ${note}`;

  consumedLocalFiles.add(fromFile);
  twinnedProdVersions.add(row.version);
  claimOutputPath(toPath); // the rename TARGET is an output path (PL-b2)
  renamePlan.push({ version: row.version, fromFile, toFile, drift, note, alreadyApplied, manual: false });
}

// ---- 2c. MISSING prod rows (no twin) → RECONSTRUCT / QUARANTINE (PL-b1 before PL b-loop) ------
const usedFilenames = new Set(repoFiles); // seed with what's on disk to avoid any collision
for (const row of sortedProd) {
  if (twinnedProdVersions.has(row.version)) continue; // covered by a rename
  const { version, name, statements } = row;

  // §2 QUARANTINE branch runs BEFORE the name==='' bootstrap branch (verifier PL-b1) so this
  // version yields the quarantine stub ONLY — never also a `…_remote_bootstrap.sql`.
  if (version === QUARANTINE_VERSION) {
    const filename = `${version}_${QUARANTINE_SLUG}.sql`;
    if (!SLUG_RE.test(QUARANTINE_SLUG)) die(`quarantine slug '${QUARANTINE_SLUG}' violates the filename convention.`);
    const filePath = join(MIGRATIONS_DIR, filename);
    claimOutputPath(filePath);
    usedFilenames.add(filename);
    quarantinePlan.push({ version, slug: QUARANTINE_SLUG, file: filename });
    continue;
  }

  // §32 EMPTY-GUARD (verifier PL-c1): throw in the pre-pass — never emit a blank migration, and the
  // throw leaves the tree pristine (PL-0). All-whitespace counts as empty.
  if (!Array.isArray(statements) || statements.length === 0 || statements.every((s) => typeof s !== 'string' || s.trim() === '')) {
    die(`EMPTY_STATEMENTS at ${version} ('${name || '(unnamed)'}'): ledger row has no non-empty statements — refusing to emit a blank migration (§32). Fix the dump or exclude this version deliberately.`);
  }

  // slug: named rows use the ledger name; the unnamed Sept bootstrap rows use 'remote_bootstrap'.
  let slug = name !== '' ? name : 'remote_bootstrap';
  // Path-traversal / injection guard on ledger-derived slugs (verifier PL-add1). A prod ledger name
  // that violates the convention is an input-integrity failure → throw in the pre-pass (safe, tree
  // untouched), never sanitize-and-write a surprising filename.
  if (!SLUG_RE.test(slug)) {
    die(`invalid_slug: ledger name for version ${version} yields slug '${slug}', which violates /^[a-z0-9_]+$/. Refusing to write a path-unsafe filename — resolve the dump.`);
  }

  let filename = `${version}_${slug}.sql`;
  // Uniqueness net: the 14-digit version prefix already makes each unnamed 'remote_bootstrap' file
  // unique. This only fires on a pathological duplicate filename; append a version-based
  // discriminator to stay unique + deterministic.
  if (usedFilenames.has(filename)) {
    const disc = version.slice(-6);
    slug = `${slug}_${disc}`;
    filename = `${version}_${slug}.sql`;
    if (usedFilenames.has(filename)) die(`filename collision could not be resolved for ${version} (${slug}).`);
  }

  // §13 honest secrets scan (advisory) — flag, still reconstruct (real applied SQL).
  const previewBody = statements.join('\n\n');
  if (looksLikeSecret(previewBody)) {
    securityFlags.push({
      version,
      file: filename,
      reason: 'possible_secret_literal: a reconstructed statement contains a literal resembling a key/token. Verbatim from applied prod SQL — reconstructed as-is; flagged for reviewer confirmation (likely a benign vault-name ref per dossier §4).',
    });
  }

  claimOutputPath(join(MIGRATIONS_DIR, filename));
  usedFilenames.add(filename);
  reconstructPlan.push({ version, slug, file: filename });
}

// ---- 2d. Remaining local-only files (not consumed, not orphan, not already flagged) → UNMATCHED
// e.g. the near-miss 20260715120000_growth_fire_processor_cron_token vs prod
// 'growth_fire_submission_processor_cron_token'. Never auto-handled (verifier PL-a1 self-check).
for (const lo of localOnlyFiles) {
  if (consumedLocalFiles.has(lo.file)) continue; // renamed twin or excluded orphan
  if (flaggedFiles.has(lo.file)) continue;       // already flagged (ambiguous / collision)
  flagLocal(
    lo.file,
    `UNMATCHED: local-only version ${lo.version} slug '${lo.slug}' has no EXACT-name prod-only twin. ` +
      'Likely a near-miss slug rename or a genuinely-local migration — integrator/owner to decide (rename to a prod version, keep local, or delete). Not auto-handled.',
  );
}

// ---- 3. PRE-PASS SELF-CHECKS -----------------------------------------------------------------

// PL-a1 exact-match self-check: the documented near-miss MUST NOT twin and MUST be surfaced.
{
  const nearMissLocal = '20260715120000_growth_fire_processor_cron_token.sql';
  const nearMissProdName = 'growth_fire_submission_processor_cron_token';
  const localPresent = repoFiles.includes(nearMissLocal);
  // Only AUTO twins (manual:false) are subject to the strict-equality rule; MANUAL_TWINS are
  // integrator-pinned by verified content and legitimately rename a near-miss slug.
  const autoTwinnedByNearMiss = renamePlan.some((r) => r.fromFile === nearMissLocal && !r.manual);
  const prodHasNearMissName = [...prodOnly.values()].some((r) => r.name === nearMissProdName);
  if (localPresent && prodHasNearMissName && autoTwinnedByNearMiss) {
    die(`exact-match self-check FAILED: near-miss ${nearMissLocal} was AUTO-twinned to a '${nearMissProdName}' version — fuzzy matching leaked in. Twin match must be strict slug===name.`);
  }
}

// PL-b1 self-check: the quarantine version must be quarantined, never reconstructed.
if (reconstructPlan.some((r) => r.version === QUARANTINE_VERSION)) {
  die(`quarantine version ${QUARANTINE_VERSION} leaked into reconstructPlan — it must ONLY be quarantined.`);
}
if (!quarantinePlan.some((q) => q.version === QUARANTINE_VERSION)) {
  die(`quarantine version ${QUARANTINE_VERSION} is not present in quarantinePlan — §2 stub was not scheduled.`);
}

// PL-add6: the quarantine stub carries NO executable seed DML (INSERT INTO / COPY … FROM). The
// funding/vendor names live only in explanatory comments; the sole statement is a DO $$ … NULL no-op.
{
  const stub = quarantineStub();
  if (/insert\s+into/i.test(stub) || /\bcopy\b[^\n]*\bfrom\b/i.test(stub)) {
    die('quarantine stub contains executable seed DML (INSERT INTO / COPY) — §2 requires a pure no-op with the funding/vendor seed STRIPPED.');
  }
}

// PL-g1 CONSERVATION — throw on any imbalance, BEFORE mutating. These prove nothing was silently
// dropped or double-counted; they are the strongest completeness guarantee (§13/§18 review surface).
{
  const prodSide = reconstructPlan.length + quarantinePlan.length + renamePlan.length;
  if (prodSide !== prodOnly.size) {
    die(`prod_side_unbalanced: reconstructed(${reconstructPlan.length}) + quarantined(${quarantinePlan.length}) + renamed(${renamePlan.length}) = ${prodSide} != prod-only rows ${prodOnly.size}. Every prod-only version must land in exactly one bucket.`);
  }
  const localSide = renamePlan.length + excludePlan.length + unmatchedPlan.length;
  if (localSide !== localOnlyFiles.length) {
    die(`local_side_unbalanced: renamed(${renamePlan.length}) + excluded(${excludePlan.length}) + unmatched(${unmatchedPlan.length}) = ${localSide} != local-only files ${localOnlyFiles.length}. Every local-only file must land in exactly one bucket.`);
  }
}

// PL-a6 / PL-add8 ADVISORY count warnings — surface drift from Phase-1 expectations; NEVER gate.
if (prodOnly.size !== EXPECT.prodOnly) warn(`prod-only ledger rows = ${prodOnly.size} (Phase-1 expected ${EXPECT.prodOnly}).`);
if (localOnlyFiles.length !== EXPECT.localOnly) warn(`local-only repo files = ${localOnlyFiles.length} (Phase-1 expected ${EXPECT.localOnly}).`);
if (prodVersions.size !== EXPECT.prodVersions) warn(`prod-versions.txt entries = ${prodVersions.size} (Phase-1 expected ${EXPECT.prodVersions}).`);
if (renamePlan.length !== EXPECT.twins) warn(`discovered twins = ${renamePlan.length} (Phase-1 advisory ${EXPECT.twins}).`);
{
  const unnamed = [...prodOnly.values()].filter((r) => r.name === '').length;
  if (unnamed !== EXPECT.unnamed) warn(`unnamed (bootstrap) prod rows = ${unnamed} (Phase-1 expected ${EXPECT.unnamed}).`);
}

// =============================================================================================
// ============================ MUTATE PASS (only reached after a clean pre-pass) ===============
// =============================================================================================
// Every disk op is recorded on `touched[]`; the report buckets are projections of the PLAN, and a
// cross-check (verifier PL-g2) asserts executed op-counts reconcile with the plan.
const touched = []; // { action, version, file, executed }
let mvExecuted = 0, mvSkipped = 0, writeExecuted = 0, writeSkipped = 0, rmExecuted = 0, rmSkipped = 0;

// 1. RECONSTRUCT + QUARANTINE writes (UTF-8, LF, single trailing newline — verifier PL-add5).
for (const p of reconstructPlan) {
  const row = prodOnly.get(p.version);
  const displayName = row.name === '' ? 'remote_bootstrap' : row.name;
  const body = `${provenanceHeader(p.version, displayName)}\n\n${(row.statements || []).join('\n\n')}\n`;
  const filePath = assertInJail(join(MIGRATIONS_DIR, p.file));
  if (existsSync(filePath)) {
    writeSkipped++; // idempotent: prior run already reconstructed it; do NOT clobber
    touched.push({ action: 'write-reconstruct', version: p.version, file: p.file, executed: false });
  } else {
    if (!DRY_RUN) writeFileSync(filePath, body, { encoding: 'utf8' });
    writeExecuted++;
    touched.push({ action: 'write-reconstruct', version: p.version, file: p.file, executed: !DRY_RUN });
  }
}
for (const q of quarantinePlan) {
  const body = `${quarantineStub()}\n`;
  const filePath = assertInJail(join(MIGRATIONS_DIR, q.file));
  if (existsSync(filePath)) {
    writeSkipped++;
    touched.push({ action: 'write-quarantine', version: q.version, file: q.file, executed: false });
  } else {
    if (!DRY_RUN) writeFileSync(filePath, body, { encoding: 'utf8' });
    writeExecuted++;
    touched.push({ action: 'write-quarantine', version: q.version, file: q.file, executed: !DRY_RUN });
  }
}

// 2. RENAME (git mv) — existsSync-guarded on both ends (verifier PL-d1).
for (const r of renamePlan) {
  const fromPath = join(MIGRATIONS_DIR, r.fromFile);
  const toPath = join(MIGRATIONS_DIR, r.toFile);
  assertInJail(toPath);
  const fromExists = existsSync(fromPath);
  const toExists = existsSync(toPath);
  if (!fromExists && toExists) {
    mvSkipped++; // already applied
    touched.push({ action: 'git-mv', version: r.version, file: r.toFile, executed: false });
  } else if (fromExists && !toExists) {
    if (!DRY_RUN) git(['mv', join(REL_MIGRATIONS, r.fromFile), join(REL_MIGRATIONS, r.toFile)]);
    mvExecuted++;
    touched.push({ action: 'git-mv', version: r.version, file: r.toFile, executed: !DRY_RUN });
  } else {
    // both/neither exist should have been resolved in the pre-pass; be loud rather than blind.
    die(`rename state changed under us for ${r.version} (${r.fromFile} -> ${r.toFile}); refusing to git mv blind.`);
  }
}

// 3. EXCLUDE (git rm) — guarded; an already-deleted path is a clean skip (verifier PL-d2).
for (const e of excludePlan) {
  const filePath = join(MIGRATIONS_DIR, e.file);
  if (existsSync(filePath)) {
    if (!DRY_RUN) git(['rm', '--quiet', join(REL_MIGRATIONS, e.file)]);
    rmExecuted++;
    touched.push({ action: 'git-rm', version: e.version, file: e.file, executed: !DRY_RUN });
  } else {
    rmSkipped++; // already excluded
    touched.push({ action: 'git-rm', version: e.version, file: e.file, executed: false });
  }
}

// 4. Cross-check the touched ledger against the plan (verifier PL-g2). Every disk op corresponds to
// exactly one plan entry; a file touched but absent from the report is impossible by construction.
{
  const writeTouched = touched.filter((t) => t.action === 'write-reconstruct' || t.action === 'write-quarantine').length;
  const mvTouched = touched.filter((t) => t.action === 'git-mv').length;
  const rmTouched = touched.filter((t) => t.action === 'git-rm').length;
  if (writeTouched !== reconstructPlan.length + quarantinePlan.length) die(`touched-ledger mismatch: write ops ${writeTouched} != planned ${reconstructPlan.length + quarantinePlan.length}.`);
  if (mvTouched !== renamePlan.length) die(`touched-ledger mismatch: mv ops ${mvTouched} != planned ${renamePlan.length}.`);
  if (rmTouched !== excludePlan.length) die(`touched-ledger mismatch: rm ops ${rmTouched} != planned ${excludePlan.length}.`);
}

// =============================================================================================
// ============================ REPORT (the PR review surface) ==================================
// =============================================================================================
const report = {
  generatedAt: new Date().toISOString(), // ONLY nondeterministic value; never enters a .sql body
  dryRun: DRY_RUN,
  counts: {
    prod_only_rows: prodOnly.size,
    local_only_files: localOnlyFiles.length,
    reconstructed: reconstructPlan.length,
    quarantined: quarantinePlan.length,
    renamed: renamePlan.length,
    excluded: excludePlan.length,
    unmatchedLocalOnly: unmatchedPlan.length,
    securityFlags: securityFlags.length,
    twins_total: renamePlan.length,
    missing_total: reconstructPlan.length + quarantinePlan.length,
  },
  execution: {
    dryRun: DRY_RUN,
    writes: { executed: writeExecuted, skipped_existing: writeSkipped },
    renames: { executed: mvExecuted, skipped_already_applied: mvSkipped },
    excludes: { executed: rmExecuted, skipped_already_gone: rmSkipped },
  },
  reconstructed: reconstructPlan.map((p) => ({ version: p.version, slug: p.slug })),
  renamed: renamePlan.map((r) => ({ fromFile: r.fromFile, toFile: r.toFile, drift: r.drift, note: r.note })),
  quarantined: quarantinePlan.map((q) => ({ version: q.version, slug: q.slug })),
  excluded: excludePlan.map((e) => ({ version: e.version, file: e.file, reason: e.reason })),
  unmatchedLocalOnly: unmatchedPlan.map((u) => ({ file: u.file, reason: u.reason })),
  securityFlags,
};

// Deterministic ordering in the report (verifier PL-f1).
report.reconstructed.sort((a, b) => a.version.localeCompare(b.version));
report.quarantined.sort((a, b) => a.version.localeCompare(b.version));
report.renamed.sort((a, b) => a.toFile.localeCompare(b.toFile));
report.excluded.sort((a, b) => a.version.localeCompare(b.version));
report.unmatchedLocalOnly.sort((a, b) => a.file.localeCompare(b.file));
report.securityFlags.sort((a, b) => a.version.localeCompare(b.version));

mkdirSync(dirname(REPORT_PATH), { recursive: true }); // verifier PL-add4
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8' });

// ---- Console summary (the integrator's at-a-glance) -----------------------------------------
console.log(`[reconcile] ${DRY_RUN ? 'DRY-RUN (no repo mutation) ' : ''}done.`);
console.log(`  prod-only ledger rows : ${prodOnly.size}`);
console.log(`  local-only repo files : ${localOnlyFiles.length}`);
console.log(`  renamed (twins)       : ${report.counts.renamed}  (drift: ${report.renamed.filter((r) => r.drift).length})`);
console.log(`  reconstructed         : ${report.counts.reconstructed}`);
console.log(`  quarantined (§2)      : ${report.counts.quarantined}`);
console.log(`  excluded (git rm)     : ${report.counts.excluded}`);
console.log(`  unmatched (FLAGGED)   : ${report.counts.unmatchedLocalOnly}`);
console.log(`  security flags        : ${report.counts.securityFlags}`);
console.log(`  report                : ${REPORT_PATH}`);
if (report.counts.unmatchedLocalOnly > 0) {
  console.log('  NOTE: unmatchedLocalOnly is non-empty — integrator/owner review required before the PR is complete.');
}
if (report.counts.securityFlags > 0) {
  console.log('  NOTE: securityFlags is non-empty — confirm each is a benign vault-name ref, not a live secret, before merge.');
}