#!/usr/bin/env node
/**
 * Make the database CI rebuilt from migrations hold the same API-role grants production holds, and
 * fail loudly, naming the object, where it cannot.
 *
 * WHY THIS EXISTS. Most of production's `anon` / `authenticated` / `service_role` grants on
 * `public` were never written by a migration. Supabase's project-level default privileges granted
 * them automatically when each object was created, and production no longer carries a default ACL
 * for `public`, so no migration replay can reproduce them (measured 2026-09-26: 126 tables with no
 * migration grant at all, 71 with a narrower one; repo evidence in
 * 20261048000000_an_owner_can_remove_someone_from_their_workspace.sql:32 and
 * 20260805140000_fix271_marketplace_table_grants.sql:5-8). The local stack goes wrong the other
 * way too: its default ACL gives anon/authenticated only DELETE/TRUNCATE/REFERENCES/TRIGGER on new
 * tables and no EXECUTE on new functions (measured in database-contract run 36279473696: authenticated
 * could SELECT 207 of 438 public tables). A proof that exercises a policy as `authenticated` then
 * dies at the grant layer before the policy is evaluated, and lanes had started pasting production's
 * grants into their own test files.
 *
 * HOW IT KEEPS THE CHANGE UNDER REVIEW INTACT. The job does not guess which objects a pending
 * migration touches. It orders the work instead:
 *   1. `supabase db reset --version <V>`, where V (printed by `--reset-version`) is the newest
 *      migration production has recorded that also exists in this tree;
 *   2. this script, in ONE transaction: reset every non-extension `public` table, view, sequence,
 *      function and procedure to its built-in default ACL for the three API roles and PUBLIC, then
 *      apply production's GRANT/REVOKE statements for those roles (pg_dump writes an ACL as the
 *      difference from that same default, so reset-then-apply reproduces it exactly);
 *   3. `supabase migration up --include-all --local`, which applies every migration production has
 *      not recorded — the change under review — exactly as written, dynamic SQL and schema-wide
 *      grants included.
 * A migration older than V that production has not recorded is applied by step 1 and reconciled
 * away by step 2; `--reset-version` names each one, because that is production drift, not a detail.
 *
 * WHEN IT FAILS, AND WHY THAT IS THE POINT.
 *   - A production statement names an object the migrations up to V do not create → schema drift,
 *     every such object named. (On a push to main it can also mean a migration was applied to
 *     production between the ledger read and the dump; the baseline reads the ledger first so that
 *     race lands here, loudly, rather than silently.)
 *   - A dump line grants to an API role or PUBLIC on `public` in a shape this parser does not read
 *     → refused, so a partial parse can never leave the rebuilt database more permissive.
 *   - A GRANT/REVOKE produced a "no privileges could be granted/revoked" warning (an object owned by
 *     a role the job cannot act for) → refused, rather than reporting a reconcile that did nothing.
 *   - Too few statements, or a ledger that could not be read → refused before anything is reset.
 *
 * WHAT IT PRINTS. The public CI log is public, so the full production ACL is never printed: counts
 * per change, plus the names of objects where the migrations granted MORE than production (that says
 * production is narrower, and the names are already public in the migrations). Objects where
 * production grants more are counted, not named.
 *
 * RUNNING THE PROOFS LOCALLY. The pgTAP files no longer carry their own grants, so on a developer
 * machine run this script after `supabase db reset --version <V>` with a dump you are authorised to
 * take (`.github/scripts/prod-readonly-baseline.sh <dir>`), then `supabase migration up --include-all`.
 *
 * Usage:
 *   node scripts/ci/reproduce-production-grants.mjs --reset-version --recorded <recorded_versions.txt> [--migrations dir]
 *   node scripts/ci/reproduce-production-grants.mjs --dump <prod_schema.sql> --db <postgres url> [--report-missing]
 *
 * --report-missing is for grant-ordering-proof.sh's negative control only. That control reconciles
 * AFTER the change under review is applied, so an object the change drops still has production
 * grants and is missing by design; the flag reports it instead of failing. The job's own reconcile
 * runs before the change and never passes it, so drift there still fails.
 *   node scripts/ci/reproduce-production-grants.mjs --parse-ledger <migration_list.txt>
 *   node scripts/ci/reproduce-production-grants.mjs --self-test
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const API_ROLES = ["anon", "authenticated", "service_role"];

// pg_dump writes one grantee per statement, on one line:
//   GRANT ALL ON TABLE "public"."clients" TO "authenticated";
//   REVOKE ALL ON FUNCTION "public"."f"("_x" "uuid") FROM PUBLIC;
//   GRANT SELECT("col") ON TABLE "public"."t" TO "anon" WITH GRANT OPTION;
// The Supabase CLI dumps with every identifier quoted; plain pg_dump quotes only when it must.
const ACL_LINE =
  /^(GRANT|REVOKE) (.+?) ON (TABLE|SEQUENCE|FUNCTION|PROCEDURE) (?:"public"|public)\.(?:"((?:[^"]|"")+)"|([a-z_][a-z0-9_$]*))(\(.*\))? (TO|FROM) (PUBLIC|"[^"]+"|[a-z_][a-z0-9_]*)( WITH GRANT OPTION)?;$/;
// Anything that looks like an ACL statement on `public` naming an API role or PUBLIC. Every such line
// must parse; one that does not is refused rather than silently dropped.
// Limited to the object kinds the reset touches: a grant on a type or schema is not reset, so it is
// not something a partial parse could make more permissive.
const ACL_CANDIDATE = /^(GRANT|REVOKE) .* ON (TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE) (?:"public"|public)\..*\b(TO|FROM) (PUBLIC|"?(anon|authenticated|service_role)"?)\b/;

/** Production's API-role ACL statements for `public`, in dump order, and any line it could not read. */
export function parseProductionAcl(dumpText) {
  const statements = [];
  const unparsed = [];
  for (const raw of dumpText.split("\n")) {
    const line = raw.trim();
    if (/^ALTER DEFAULT PRIVILEGES/.test(line)) continue; // not an object ACL; the reset is per object
    const m = ACL_LINE.exec(line);
    if (!m) {
      if (ACL_CANDIDATE.test(line)) unparsed.push(line);
      continue;
    }
    const grantee = m[8] === "PUBLIC" ? "PUBLIC" : m[8].replace(/^"|"$/g, "");
    if (grantee !== "PUBLIC" && !API_ROLES.includes(grantee)) continue;
    statements.push({ sql: line, kind: m[3], name: m[4] !== undefined ? m[4].replace(/""/g, '"') : m[5], grantee });
  }
  return { statements, unparsed };
}

/** Versions recorded on production, read by the header of `supabase migration list`, not a column number. */
export function parseLedger(text) {
  // In an agent environment the CLI prints `{"migrations":[{"local","remote","time"}]}` instead.
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j?.migrations)) {
      const versions = new Set(j.migrations.map((m) => String(m?.remote ?? "").replace(/[^0-9]/g, "")).filter((v) => v.length === 14));
      return { versions, headerFound: true };
    }
  } catch { /* the table form */ }
  let col = -1;
  const versions = new Set();
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (col < 0) {
      col = cells.indexOf("Remote");
      continue;
    }
    const v = (cells[col] ?? "").replace(/[^0-9]/g, "");
    if (v.length === 14) versions.add(v);
  }
  return { versions, headerFound: col >= 0 };
}

/**
 * The version to rebuild up to: the newest one production has recorded that this tree also has.
 * Everything newer is the change under review. Older unrecorded ones are named, not hidden.
 */
export function resetPlan(files, recorded) {
  const local = files.filter((f) => /^\d{14}_.*\.sql$/.test(f)).map((f) => f.slice(0, 14)).sort();
  const shared = local.filter((v) => recorded.has(v));
  const version = shared.at(-1) ?? null;
  const pending = local.filter((v) => !recorded.has(v));
  return { version, pending, outOfOrder: version ? pending.filter((v) => v < version) : pending };
}

function dollarQuote(s) {
  let tag = "acl";
  while (s.includes(`$${tag}$`)) tag += "_";
  return `$${tag}$${s}$${tag}$`;
}

// Every (object, grantee, privilege) the three API roles and PUBLIC hold in `public`.
const API_ACL_FN = `CREATE FUNCTION pg_temp._api_acl() RETURNS TABLE (object text, grantee text, privilege text)
LANGUAGE sql AS $f$
  SELECT c.oid::regclass::text, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END, a.privilege_type
  FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f','S')
    AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon','authenticated','service_role'))
  UNION ALL
  SELECT p.oid::regprocedure::text, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END, a.privilege_type
  FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
  WHERE p.pronamespace = 'public'::regnamespace
    AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon','authenticated','service_role'))
  UNION ALL
  SELECT c.oid::regclass::text || '.' || quote_ident(at.attname), CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END, a.privilege_type || ' (column)'
  FROM pg_attribute at JOIN pg_class c ON c.oid = at.attrelid, aclexplode(at.attacl) a
  WHERE c.relnamespace = 'public'::regnamespace AND at.attacl IS NOT NULL
    AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon','authenticated','service_role'))
$f$;`;

/** The single transaction that reproduces production's ACL in the rebuilt database. */
export function buildReconcileSql(statements, { reportMissing = false } = {}) {
  const rows = statements
    .map((s) => `(${dollarQuote(s.sql)}, ${dollarQuote(`${s.kind.toLowerCase()} public.${s.name}`)})`)
    .join(",\n");
  return `\\set ON_ERROR_STOP on
${API_ACL_FN}
BEGIN;
CREATE TEMP TABLE _prod_acl (stmt text NOT NULL, object text NOT NULL) ON COMMIT DROP;
${rows ? `INSERT INTO _prod_acl (stmt, object) VALUES\n${rows};` : ""}

-- What the migrations alone produced, for the before/after comparison.
CREATE TEMP TABLE _before ON COMMIT DROP AS SELECT * FROM pg_temp._api_acl();

DO $reset$
DECLARE r record; kw text;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f','S')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON %s public.%I FROM PUBLIC, anon, authenticated, service_role',
      CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.relname);
  END LOOP;
  FOR r IN
    SELECT p.oid, p.prokind FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f','p','w')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    kw := CASE WHEN r.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END;
    -- A routine's built-in default is owner plus EXECUTE for PUBLIC; pg_dump writes the rest.
    EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC, anon, authenticated, service_role', kw, r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON %s %s TO PUBLIC', kw, r.oid::regprocedure);
  END LOOP;
END
$reset$;

DO $apply$
DECLARE r record; missing text[] := '{}';
BEGIN
  FOR r IN SELECT stmt, object FROM _prod_acl LOOP
    BEGIN
      EXECUTE r.stmt;
    EXCEPTION WHEN undefined_table OR undefined_function OR undefined_column OR undefined_object THEN
      missing := missing || (r.object || ' (' || SQLERRM || ')');
    END;
  END LOOP;
  IF cardinality(missing) > 0 THEN
    RAISE ${reportMissing ? "NOTICE" : "EXCEPTION"} 'SCHEMA DRIFT: production grants on % object(s) the migration chain does not create: % (if this branch is behind main, update it: production has migrations it lacks)',
      cardinality(missing), array_to_string(ARRAY(SELECT DISTINCT unnest(missing) ORDER BY 1), '; ');
  END IF;
END
$apply$;

CREATE TEMP TABLE _after ON COMMIT DROP AS SELECT * FROM pg_temp._api_acl();
\\echo RECONCILE_SUMMARY_BEGIN
SELECT 'added' AS change, grantee, privilege, count(*)::text AS n FROM (SELECT * FROM _after EXCEPT SELECT * FROM _before) x GROUP BY 1,2,3
UNION ALL
SELECT 'removed', grantee, privilege, count(*)::text FROM (SELECT * FROM _before EXCEPT SELECT * FROM _after) x GROUP BY 1,2,3
ORDER BY 1,2,3;
\\echo RECONCILE_SUMMARY_END
\\echo RECONCILE_REMOVED_OBJECTS_BEGIN
SELECT DISTINCT object FROM (SELECT * FROM _before EXCEPT SELECT * FROM _after) x ORDER BY 1;
\\echo RECONCILE_REMOVED_OBJECTS_END
COMMIT;
`;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function between(stdout, a, b) {
  return (stdout.split(a)[1]?.split(b)[0] ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

function summarize(stdout, statements) {
  const rows = between(stdout, "RECONCILE_SUMMARY_BEGIN", "RECONCILE_SUMMARY_END")
    .filter((l) => l.includes("|") && !/^change\s*\|/.test(l) && !/^-+\+/.test(l));
  const removed = between(stdout, "RECONCILE_REMOVED_OBJECTS_BEGIN", "RECONCILE_REMOVED_OBJECTS_END")
    .filter((l) => !/^object$/.test(l) && !/^-+$/.test(l) && !/^\(\d+ rows?\)$/.test(l));
  const shown = removed.slice(0, 60);
  const lines = [
    "### Production grants reproduced in the rebuilt database",
    "",
    `- Production ACL statements for the API roles in \`public\`: **${statements.length}**`,
    "",
    "Where the migration chain alone did not match production (changed by this step):",
    "",
    "| change | grantee | privilege | objects |",
    "|---|---|---|---|",
    ...(rows.length ? rows.map((r) => `| ${r.split("|").map((c) => c.trim()).join(" | ")} |`) : ["| none | | | 0 |"]),
    "",
    `Objects where the migrations granted more than production (**${removed.length}**)${removed.length > shown.length ? `, first ${shown.length}` : ""}:`,
    "",
    ...(shown.length ? shown.map((o) => `- \`${o}\``) : ["- none"]),
  ];
  const text = lines.join("\n") + "\n";
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

function resetVersion() {
  const recordedPath = arg("--recorded");
  const migrationsDir = arg("--migrations") ?? "supabase/migrations";
  if (!recordedPath) fail("usage: --reset-version --recorded <recorded_versions.txt> [--migrations dir]");
  const recorded = new Set(readFileSync(recordedPath, "utf8").split("\n").map((s) => s.trim()).filter((s) => /^\d{14}$/.test(s)));
  const files = readdirSync(migrationsDir);
  const local = files.filter((f) => /^\d{14}_.*\.sql$/.test(f));
  // An unreadable ledger would make every migration "pending" and reconcile nothing that matters.
  if (recorded.size < local.length / 2) {
    fail(`Production reports ${recorded.size} recorded migrations for ${local.length} files; the ledger read failed, refusing to guess what is pending.`);
  }
  const plan = resetPlan(files, recorded);
  if (!plan.version) fail("No migration production has recorded exists in this tree.");
  // Unrecorded migrations OLDER than V would otherwise be applied by the rebuild, before the grants
  // are reproduced, and lose their own grants. They are set aside and applied after, so their SQL is
  // still exercised here. Production's plain `db push` REFUSES such a file (deploy-migrations.yml):
  // it must be renamed newer than production's newest before it can ship.
  const aside = arg("--aside-list");
  const asideFiles = files.filter((f) => plan.outOfOrder.includes(f.slice(0, 14)));
  if (aside) writeFileSync(aside, asideFiles.map((f) => f + "\n").join(""));
  else if (asideFiles.length) fail("Unrecorded migrations older than the rebuild version exist; pass --aside-list so they can be set aside.");
  console.error(`Rebuild up to ${plan.version}; ${plan.pending.length} migration(s) production has not recorded are applied after the grants are reproduced (${asideFiles.length} of them older than ${plan.version}, set aside for the rebuild).`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- Rebuilt up to **${plan.version}**; applied after the grants were reproduced (the change under review): **${plan.pending.length}**, of which older than the rebuild version: **${asideFiles.length}**\n`);
  }
  process.stdout.write(plan.version + "\n");
}

function reconcile() {
  const dumpPath = arg("--dump");
  const db = arg("--db");
  if (!dumpPath || !db) fail("usage: --dump <prod_schema.sql> --db <url>");
  const { statements, unparsed } = parseProductionAcl(readFileSync(dumpPath, "utf8"));
  if (unparsed.length) {
    // Print the shape, not the grant: the verb, the object kind, the grantee.
    const shapes = [...new Set(unparsed.map((l) => l.replace(/"[^"]*"/g, '"…"').replace(/\(.*\)/, "(…)")))].slice(0, 10);
    fail(`${unparsed.length} production ACL line(s) on public naming an API role could not be parsed; refusing a partial reconcile. Shapes: ${shapes.join(" | ")}`);
  }
  const minStatements = Number(arg("--min-statements") ?? 100); // lowered only by fixture tests
  // A dump with no API-role grants means the dump or the parser is wrong, not that production
  // grants nothing — refuse rather than strip every grant from the rebuilt database.
  if (statements.length < minStatements) fail(`Only ${statements.length} production ACL statements parsed from ${dumpPath}; refusing to reset grants on that basis.`);
  const dir = mkdtempSync(join(tmpdir(), "prod-acl-"));
  const sqlPath = join(dir, "reconcile.sql");
  writeFileSync(sqlPath, buildReconcileSql(statements, { reportMissing: process.argv.includes("--report-missing") }));
  const r = spawnSync("psql", ["-X", "-q", "-d", db, "-f", sqlPath], { encoding: "utf8" });
  const errLines = (r.stderr || "").split("\n");
  if (r.status !== 0) {
    fail(`Production grants could not be reproduced in the rebuilt database.\n${errLines.filter((l) => /error|DETAIL|SCHEMA DRIFT/i.test(l)).join("\n")}`);
  }
  // --report-missing turns drift into a NOTICE; print it, so a reported object is seen, not swallowed.
  const drift = errLines.filter((l) => /NOTICE:\s+SCHEMA DRIFT/.test(l));
  if (drift.length) console.error(drift.join("\n"));
  // A GRANT/REVOKE on an object the job cannot act for is a WARNING that changes nothing.
  const noop = errLines.filter((l) => /WARNING:\s+no privileges (could be|were) (granted|revoked)/.test(l));
  if (noop.length) fail(`${noop.length} grant statement(s) changed nothing (an object owned by a role this job cannot act for); the reconcile is incomplete.`);
  summarize(r.stdout, statements);
}

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error(`self-test FAILED: ${msg}`); process.exit(1); } };
  const dump = [
    'GRANT ALL ON TABLE "public"."clients" TO "anon";',
    'GRANT ALL ON TABLE "public"."clients" TO "authenticated";',
    'GRANT SELECT("email") ON TABLE "public"."profiles" TO "anon";',
    'REVOKE ALL ON FUNCTION "public"."is_tenant_admin"("_tenant" "uuid") FROM PUBLIC;',
    'GRANT ALL ON FUNCTION "public"."is_tenant_admin"("_tenant" "uuid") TO "authenticated";',
    'REVOKE ALL ON PROCEDURE "public"."p_proc"() FROM PUBLIC;',
    'GRANT SELECT ON TABLE "public"."v_clients" TO "anon" WITH GRANT OPTION;',
    'GRANT ALL ON TABLE "public"."clients" TO "supabase_auth_admin";',
    'GRANT USAGE ON SCHEMA "public" TO "anon";',
    'GRANT ALL ON TABLE "storage"."objects" TO "anon";',
    'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";',
    'GRANT ALL ON SEQUENCE "public"."a""b_seq" TO "service_role";',
    "GRANT SELECT ON TABLE public.notes TO authenticated;",
  ].join("\n");
  const { statements: s, unparsed } = parseProductionAcl(dump);
  assert(unparsed.length === 0, `unexpected unparsed lines: ${unparsed.join(" / ")}`);
  assert(s.length === 9, `parsed ${s.length} statements, expected 9 (API roles, public only, quoted or not)`);
  assert(s.some((x) => x.kind === "PROCEDURE" && x.grantee === "PUBLIC"), "procedure REVOKE FROM PUBLIC is kept");
  assert(s.some((x) => x.name === "v_clients" && x.sql.endsWith("WITH GRANT OPTION;")), "WITH GRANT OPTION is kept");
  assert(!s.some((x) => x.sql.includes("supabase_auth_admin")), "non-API grantee is ignored");
  assert(!s.some((x) => x.sql.includes("storage")), "managed schemas are ignored");
  assert(s.some((x) => x.name === 'a"b_seq'), "doubled quotes in identifiers are unescaped");
  assert(s.some((x) => x.name === "notes" && x.grantee === "authenticated"), "unquoted pg_dump form is parsed");
  const odd = parseProductionAcl('GRANT ALL ON TYPE "public"."t" TO "anon";\nGRANT SELECT ON TABLE "public"."t" TO "anon" GRANTED BY "postgres";');
  assert(odd.unparsed.length === 1 && odd.unparsed[0].includes("GRANTED BY"), "a table ACL line for an API role in an unread shape is reported, not dropped; a type grant is out of scope");

  // `supabase migration list` in CI has no leading pipe; interactively it has one. Read by header.
  const noLead = ["   Local          | Remote         | Time (UTC)", "  ----------------|----------------|---------------------",
    "   20240101000000 | 20240101000000 | 2024-01-01 00:00:00", "   20250103000000 |                | 2025-01-03 00:00:00"].join("\n");
  const lead = ["  | Local          | Remote         | Time (UTC) |", "  | 20240101000000 | 20240101000000 | 2024-01-01 |", "  | 20250103000000 |                | 2025-01-03 |"].join("\n");
  for (const [label, text] of [["no leading pipe", noLead], ["leading pipe", lead]]) {
    const l = parseLedger(text);
    assert(l.headerFound && l.versions.has("20240101000000") && !l.versions.has("20250103000000"), `ledger (${label}) reads the Remote column only`);
  }
  assert(!parseLedger("no table here").headerFound, "a ledger without a header is reported");
  const j = parseLedger(JSON.stringify({ migrations: [{ local: "20240101000000", remote: "20240101000000" }, { local: "20250103000000", remote: "" }] }));
  assert(j.versions.size === 1 && j.versions.has("20240101000000"), "the JSON ledger form reads remote versions only");
  const d = parseDefaultPrivileges('ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";\nALTER DEFAULT PRIVILEGES FOR ROLE "postgres" GRANT SELECT ON TABLES TO "authenticated" WITH GRANT OPTION;\nALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";\nALTER DEFAULT PRIVILEGES FOR ROLE "postgres" GRANT ALL ON TYPES TO "anon";');
  assert(d.lines.length === 2, "postgres's public and schema-less defaults are reproduced, grant option included; other roles are not");
  assert(d.unparsed.length === 1, "an unread default line naming an API role is reported");

  const plan = resetPlan(["20250101000000_a.sql", "20250102000000_b.sql", "20250103000000_c.sql", "README.md"], new Set(["20250101000000", "20250103000000", "20990101000000"]));
  assert(plan.version === "20250103000000", "reset version is the newest recorded version present locally");
  assert(plan.pending.join() === "20250102000000" && plan.outOfOrder.join() === "20250102000000", "an older unrecorded migration is named out of order");

  const sql = buildReconcileSql(s);
  assert(sql.includes("SCHEMA DRIFT") && sql.includes("BEGIN;") && sql.includes("COMMIT;"), "one transaction that fails on drift");
  assert(sql.includes("'PROCEDURE'"), "procedures are reset with the PROCEDURE keyword");
  assert(sql.includes("RAISE EXCEPTION 'SCHEMA DRIFT") && !sql.includes("RAISE NOTICE 'SCHEMA DRIFT"), "drift fails the job's own reconcile");
  const reported = buildReconcileSql(s, { reportMissing: true });
  assert(reported.includes("RAISE NOTICE 'SCHEMA DRIFT") && !reported.includes("RAISE EXCEPTION 'SCHEMA DRIFT"), "the negative control reports drift instead of failing");
  console.log("reproduce-production-grants self-test: ok");
}

// Production's default privileges for objects `postgres` creates in `public`, for the API roles.
// Schema-less lines (FOR ROLE postgres, no IN SCHEMA) apply to every schema, public included.
const DEFAULT_ACL_LINE = /^ALTER DEFAULT PRIVILEGES FOR ROLE "?postgres"?( IN SCHEMA "?public"?)? (GRANT|REVOKE) .* ON (TABLES|SEQUENCES|FUNCTIONS|ROUTINES) (TO|FROM) (PUBLIC|"?(anon|authenticated|service_role)"?)( WITH GRANT OPTION)?;$/;
const DEFAULT_ACL_CANDIDATE = /^ALTER DEFAULT PRIVILEGES FOR ROLE "?postgres"?( IN SCHEMA "?public"?)? .*\b(TO|FROM) (PUBLIC|"?(anon|authenticated|service_role)"?)\b/;
export function parseDefaultPrivileges(dumpText) {
  const lines = dumpText.split("\n").map((l) => l.trim());
  return {
    lines: lines.filter((l) => DEFAULT_ACL_LINE.test(l)),
    unparsed: lines.filter((l) => !DEFAULT_ACL_LINE.test(l) && DEFAULT_ACL_CANDIDATE.test(l)),
  };
}

/**
 * New objects the change under review creates must start from production's defaults, not the local
 * stack's (measured in CI: tables default to DELETE/TRUNCATE/REFERENCES/TRIGGER for anon and
 * authenticated). Revoke what `postgres`'s per-schema defaults in `public` add for the API roles —
 * a per-schema default can only add to the built-in one, so this returns it to built-in — then
 * apply production's lines, if it has any.
 */
function reproduceDefaults() {
  const dumpPath = arg("--dump");
  const db = arg("--db");
  if (!dumpPath || !db) fail("usage: --defaults --dump <prod_schema.sql> --db <url>");
  const { lines, unparsed } = parseDefaultPrivileges(readFileSync(dumpPath, "utf8"));
  if (unparsed.length) fail(`${unparsed.length} production default-privilege line(s) naming an API role could not be parsed; refusing a partial reproduction.`);
  const sql = `\\set ON_ERROR_STOP on
BEGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
-- A schema-less default can also REMOVE PUBLIC's built-in EXECUTE on functions. Put it back, so a
-- function the change under review creates is as executable here as it will be on production
-- (Codex on #1487: otherwise CI hides a function production will expose).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
${lines.join("\n")}
-- It must hold: a table created now gets exactly what production's lines give.
CREATE TABLE public._ci_default_acl_check (id int);
SELECT 'DEFAULTS_CHECK|' || (SELECT coalesce(string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' ORDER BY 1), '') FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a WHERE c.oid = 'public._ci_default_acl_check'::regclass AND a.grantee <> c.relowner AND a.grantee <> 0);
DROP TABLE public._ci_default_acl_check;
-- And a function created now gets exactly its built-in ACL (owner + PUBLIC EXECUTE) when production
-- has no default lines: proacl stays NULL, or equals acldefault.
CREATE FUNCTION public._ci_default_acl_check_fn() RETURNS int LANGUAGE sql AS 'select 1';
SELECT 'DEFAULTS_FN_CHECK|' || (SELECT (p.proacl IS NULL OR p.proacl = acldefault('f'::"char", p.proowner))::text FROM pg_proc p WHERE p.oid = 'public._ci_default_acl_check_fn()'::regprocedure);
DROP FUNCTION public._ci_default_acl_check_fn();
COMMIT;
`;
  const dir = mkdtempSync(join(tmpdir(), "prod-defacl-"));
  writeFileSync(join(dir, "defaults.sql"), sql);
  const r = spawnSync("psql", ["-X", "-q", "-A", "-t", "-d", db, "-f", join(dir, "defaults.sql")], { encoding: "utf8" });
  if (r.status === 0 && !lines.length) {
    // With no production default lines, a new table must carry no API-role privilege at all.
    const row = r.stdout.split("\n").find((l) => l.startsWith("DEFAULTS_CHECK|"));
    const got = row === undefined ? "?" : row.slice("DEFAULTS_CHECK|".length).trim();
    if (got !== "") fail(`Default privileges did not hold: a new public table got API-role privileges (${got}) that production's defaults do not grant.`);
    const fnRow = r.stdout.split("\n").find((l) => l.startsWith("DEFAULTS_FN_CHECK|"));
    const fnGot = fnRow === undefined ? "?" : fnRow.slice("DEFAULTS_FN_CHECK|".length).trim();
    if (fnGot !== "true") fail(`Default privileges did not hold: a new public function did not get the built-in ACL (owner + PUBLIC EXECUTE) that production gives it (check returned ${fnGot}).`);
  }
  if (r.status !== 0) fail(`Production's default privileges could not be reproduced.\n${(r.stderr || "").split("\n").filter((l) => /ERROR|DETAIL/.test(l)).join("\n")}`);
  console.log(`Default privileges for objects postgres creates in public: built-in, plus ${lines.length} production line(s).`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- Default privileges reproduced for new objects: built-in plus **${lines.length}** production line(s)\n`);
}

function printLedger() {
  const path = arg("--parse-ledger");
  const { versions, headerFound } = parseLedger(readFileSync(path, "utf8"));
  if (!headerFound) console.error(`::warning::No "Remote" header in ${path}; no production versions read.`);
  process.stdout.write([...versions].sort().join("\n") + (versions.size ? "\n" : ""));
}

if (process.argv.includes("--self-test")) selfTest();
else if (process.argv.includes("--parse-ledger")) printLedger();
else if (process.argv.includes("--defaults")) reproduceDefaults();
else if (process.argv.includes("--reset-version")) resetVersion();
else reconcile();
