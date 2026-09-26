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
 * 20260805140000_fix271_marketplace_table_grants.sql:5-8). A proof that exercises a policy as
 * `authenticated` then dies at the grant layer — `permission denied for table clients` — before the
 * policy is ever evaluated, and each lane had started pasting production's grants into its own test
 * file. That is four copies of a guess, each one wrong the day production changes.
 *
 * WHAT IT DOES. It reads production's ACL from the read-only schema dump the premerge proof already
 * takes (`supabase db dump --linked`, which is pg_dump — no rows leave production), then, in ONE
 * transaction against the rebuilt database:
 *   1. resets every `public` table, view, sequence and function to its built-in default ACL for
 *      the three API roles and PUBLIC (extension-owned objects are left alone);
 *   2. applies production's GRANT/REVOKE statements for those roles — pg_dump writes an ACL as the
 *      difference from that same default, so reset-then-apply reproduces it exactly;
 *   3. refuses to commit if any production statement names an object the migrations did not
 *      create, and lists every such object — that is schema drift, and it is reported where it is.
 *
 * WHAT IT LEAVES ALONE, AND SAYS SO. Objects named by a migration production has not recorded yet
 * (the change under review) keep the grants their migrations wrote — reproducing production there
 * would overwrite the very change being proven. They are listed in the summary. `storage`, `auth`
 * and the other Supabase-managed schemas are not touched.
 *
 * WHAT IT PRINTS. Counts, not grants: the CI log of a public repository is public, and the full
 * production ACL is not something to publish. The one exception is a failure, which names the
 * object that could not be granted.
 *
 * Usage:
 *   node scripts/ci/reproduce-production-grants.mjs --dump <prod_schema.sql> \
 *     --recorded <recorded_versions.txt> --db <postgres url> [--migrations supabase/migrations]
 *   node scripts/ci/reproduce-production-grants.mjs --self-test
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const API_ROLES = ["anon", "authenticated", "service_role"];

// pg_dump writes one grantee per statement, on one line:
//   GRANT ALL ON TABLE "public"."clients" TO "authenticated";
//   REVOKE ALL ON FUNCTION "public"."f"("_x" "uuid") FROM PUBLIC;
//   GRANT SELECT("col") ON TABLE "public"."t" TO "anon";
// The Supabase CLI dumps with every identifier quoted; plain pg_dump quotes only when it must.
const ACL_LINE =
  /^(GRANT|REVOKE) (.+?) ON (TABLE|SEQUENCE|FUNCTION) (?:"public"|public)\.(?:"((?:[^"]|"")+)"|([a-z_][a-z0-9_$]*))(\(.*\))? (TO|FROM) (PUBLIC|"[^"]+"|[a-z_][a-z0-9_]*);$/;

/** Production's API-role ACL statements for `public`, in dump order. */
export function parseProductionAcl(dumpText) {
  const statements = [];
  for (const raw of dumpText.split("\n")) {
    const line = raw.trim();
    const m = ACL_LINE.exec(line);
    if (!m) continue;
    const grantee = m[8] === "PUBLIC" ? "PUBLIC" : m[8].replace(/^"|"$/g, "");
    if (grantee !== "PUBLIC" && !API_ROLES.includes(grantee)) continue;
    statements.push({ sql: line, kind: m[3], name: m[4] !== undefined ? m[4].replace(/""/g, '"') : m[5], grantee });
  }
  return statements;
}

/** Migration versions in the tree that production has not recorded yet. */
export function pendingMigrations(files, recorded) {
  return files
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .filter((f) => !recorded.has(f.slice(0, 14)))
    .sort();
}

/** Object names a pending migration mentions, as whole identifiers. */
export function namesTouchedBy(pendingText, names) {
  const text = pendingText.toLowerCase();
  const touched = new Set();
  for (const name of names) {
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`).test(text)) touched.add(name);
  }
  return touched;
}

function dollarQuote(s) {
  let tag = "acl";
  while (s.includes(`$${tag}$`)) tag += "_";
  return `$${tag}$${s}$${tag}$`;
}

/** The single transaction that reproduces production's ACL in the rebuilt database. */
export function buildReconcileSql(statements, excluded) {
  const kept = statements.filter((s) => !excluded.has(s.name));
  const excludedList = [...excluded].sort();
  const rows = kept.length
    ? kept.map((s) => `(${dollarQuote(s.sql)}, ${dollarQuote(`${s.kind.toLowerCase()} public.${s.name}`)})`).join(",\n")
    : "";
  return `\\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE _prod_acl (stmt text NOT NULL, object text NOT NULL) ON COMMIT DROP;
${rows ? `INSERT INTO _prod_acl (stmt, object) VALUES\n${rows};` : ""}
CREATE TEMP TABLE _excluded (name text PRIMARY KEY) ON COMMIT DROP;
${excludedList.length ? `INSERT INTO _excluded VALUES ${excludedList.map((n) => `(${dollarQuote(n)})`).join(", ")};` : ""}

-- What the migrations alone produced, for the before/after count.
CREATE TEMP TABLE _before ON COMMIT DROP AS SELECT * FROM pg_temp._api_acl();

DO $reset$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname, c.relkind FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f','S')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
      AND c.relname NOT IN (SELECT name FROM _excluded)
  LOOP
    EXECUTE format('REVOKE ALL ON %s public.%I FROM PUBLIC, anon, authenticated, service_role',
      CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.relname);
  END LOOP;
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f','p','w')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      AND p.proname NOT IN (SELECT name FROM _excluded)
  LOOP
    -- A function's built-in default is owner plus EXECUTE for PUBLIC; pg_dump writes the rest.
    EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC, anon, authenticated, service_role',
      CASE WHEN (SELECT prokind FROM pg_proc WHERE oid = r.oid) = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON %s %s TO PUBLIC',
      CASE WHEN (SELECT prokind FROM pg_proc WHERE oid = r.oid) = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.oid::regprocedure);
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
    RAISE EXCEPTION 'SCHEMA DRIFT: production grants on % object(s) the migration chain does not create: %',
      cardinality(missing), array_to_string(ARRAY(SELECT DISTINCT unnest(missing) ORDER BY 1), '; ');
  END IF;
END
$apply$;

CREATE TEMP TABLE _after ON COMMIT DROP AS SELECT * FROM pg_temp._api_acl();
\\echo RECONCILE_SUMMARY_BEGIN
SELECT 'added' AS change, grantee, privilege, count(*) FROM (SELECT * FROM _after EXCEPT SELECT * FROM _before) x GROUP BY 1,2,3
UNION ALL
SELECT 'removed', grantee, privilege, count(*) FROM (SELECT * FROM _before EXCEPT SELECT * FROM _after) x GROUP BY 1,2,3
ORDER BY 1,2,3;
\\echo RECONCILE_SUMMARY_END
COMMIT;
`;
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

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function summarize(stdout, statements, excluded, pending) {
  const block = stdout.split("RECONCILE_SUMMARY_BEGIN")[1]?.split("RECONCILE_SUMMARY_END")[0] ?? "";
  const rows = block.split("\n").map((l) => l.trim()).filter((l) => /\|/.test(l) && !/^change\s*\|/.test(l) && !/^-+\+/.test(l));
  const lines = [
    "### Production grants reproduced in the rebuilt database",
    "",
    `- Production ACL statements for the API roles in \`public\`: **${statements.length}**`,
    `- Migrations production has not recorded (the change under review): **${pending.length}**`,
    `- Objects left with their migration grants because a pending migration names them: **${excluded.size}**${excluded.size ? ` — ${[...excluded].sort().map((n) => `\`${n}\``).join(", ")}` : ""}`,
    "",
    "Privileges the migration chain alone did not match production on (changed by this step):",
    "",
    "| change | grantee | privilege | objects |",
    "|---|---|---|---|",
    ...(rows.length ? rows.map((r) => `| ${r.split("|").map((c) => c.trim()).join(" | ")} |`) : ["| none | | | 0 |"]),
  ];
  const text = lines.join("\n") + "\n";
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

function main() {
  const dumpPath = arg("--dump");
  const recordedPath = arg("--recorded");
  const db = arg("--db");
  const migrationsDir = arg("--migrations") ?? "supabase/migrations";
  if (!dumpPath || !recordedPath || !db) {
    console.error("usage: --dump <prod_schema.sql> --recorded <recorded_versions.txt> --db <url> [--migrations dir]");
    process.exit(2);
  }
  const statements = parseProductionAcl(readFileSync(dumpPath, "utf8"));
  // A dump with no API-role grants means the dump or the parser is wrong, not that production
  // grants nothing — refuse rather than strip every grant from the rebuilt database.
  const minStatements = Number(arg("--min-statements") ?? 100); // lowered only by fixture tests
  if (statements.length < minStatements) {
    console.error(`::error::Only ${statements.length} production ACL statements parsed from ${dumpPath}; refusing to reset grants on that basis.`);
    process.exit(1);
  }
  const recorded = new Set(readFileSync(recordedPath, "utf8").split("\n").map((s) => s.trim()).filter((s) => /^\d{14}$/.test(s)));
  const files = readdirSync(migrationsDir);
  // Same reasoning: an empty ledger read would mark every migration pending and exclude everything.
  if (recorded.size < files.length / 2) {
    console.error(`::error::Production reports ${recorded.size} recorded migrations for ${files.length} files; the ledger read failed, refusing to guess what is pending.`);
    process.exit(1);
  }
  const pending = pendingMigrations(files, recorded);
  const pendingText = pending.map((f) => readFileSync(join(migrationsDir, f), "utf8")).join("\n");
  const excluded = namesTouchedBy(pendingText, [...new Set(statements.map((s) => s.name))].concat(
    // also objects a pending migration creates, which have no production statement yet
    [...pendingText.matchAll(/(?:table|view|function|sequence)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1]),
  ));
  const dir = mkdtempSync(join(tmpdir(), "prod-acl-"));
  const sqlPath = join(dir, "reconcile.sql");
  writeFileSync(sqlPath, `\\set ON_ERROR_STOP on\n${API_ACL_FN}\n${buildReconcileSql(statements, excluded)}`);
  let stdout;
  try {
    stdout = execFileSync("psql", ["-X", "-q", "-d", db, "-f", sqlPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const msg = String(e.stderr || e.message).split("\n").filter((l) => /ERROR|DETAIL|SCHEMA DRIFT/.test(l)).join("\n");
    console.error(`::error::Production grants could not be reproduced in the rebuilt database.\n${msg}`);
    process.exit(1);
  }
  summarize(stdout, statements, excluded, pending);
}

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error(`self-test FAILED: ${msg}`); process.exit(1); } };
  const dump = [
    'GRANT ALL ON TABLE "public"."clients" TO "anon";',
    'GRANT ALL ON TABLE "public"."clients" TO "authenticated";',
    'GRANT SELECT("email") ON TABLE "public"."profiles" TO "anon";',
    'REVOKE ALL ON FUNCTION "public"."is_tenant_admin"("_tenant" "uuid") FROM PUBLIC;',
    'GRANT ALL ON FUNCTION "public"."is_tenant_admin"("_tenant" "uuid") TO "authenticated";',
    'GRANT ALL ON TABLE "public"."clients" TO "supabase_auth_admin";',
    'GRANT USAGE ON SCHEMA "public" TO "anon";',
    'GRANT ALL ON TABLE "storage"."objects" TO "anon";',
    'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";',
    'GRANT ALL ON SEQUENCE "public"."a""b_seq" TO "service_role";',
    "GRANT SELECT ON TABLE public.notes TO authenticated;",
  ].join("\n");
  const s = parseProductionAcl(dump);
  assert(s.length === 7, `parsed ${s.length} statements, expected 7 (API roles, public only, quoted or not)`);
  assert(s.some((x) => x.name === "notes" && x.grantee === "authenticated"), "unquoted pg_dump form is parsed");
  assert(!s.some((x) => x.sql.includes("supabase_auth_admin")), "non-API grantee must be ignored");
  assert(!s.some((x) => x.sql.includes("storage")), "managed schemas must be ignored");
  assert(s.find((x) => x.kind === "FUNCTION" && x.grantee === "PUBLIC")?.name === "is_tenant_admin", "function REVOKE FROM PUBLIC is kept");
  assert(s.some((x) => x.name === 'a"b_seq'), "doubled quotes in identifiers are unescaped");
  const pending = pendingMigrations(["20250101000000_a.sql", "20250102000000_b.sql", "README.md"], new Set(["20250101000000"]));
  assert(pending.length === 1 && pending[0].startsWith("20250102"), "only unrecorded migrations are pending");
  const touched = namesTouchedBy("REVOKE SELECT ON public.clients FROM anon; -- client_memory_x", ["clients", "client_memory", "profiles"]);
  assert(touched.has("clients") && !touched.has("client_memory") && !touched.has("profiles"), "whole-identifier match only");
  const sql = buildReconcileSql(s, new Set(["profiles"]));
  assert(!sql.includes('"profiles" TO'), "excluded objects are not granted");
  assert(sql.includes("SCHEMA DRIFT"), "missing objects fail the transaction");
  assert(sql.includes("BEGIN;") && sql.includes("COMMIT;"), "one transaction");
  console.log("reproduce-production-grants self-test: ok");
}

if (process.argv.includes("--self-test")) selfTest();
else main();
