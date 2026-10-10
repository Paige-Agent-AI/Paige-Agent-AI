import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { retireSyntheticTenantSQL } from "./operator-postgres-fixture.mjs";

const url = new URL(process.env.BUSINESS_MISSION_TEST_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
assert.equal(url.hostname, "127.0.0.1", "Disposable loopback database required");
assert.ok((url.port === "55439" && url.pathname === "/business_mission_contract") || (process.env.CI === "true" && url.port === "54322" && url.pathname === "/postgres"), "Disposable Mission test database required");
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", url.toString()];
const psqlBin = process.env.PSQL_BIN || "psql";
const run = (sql) => execFileSync(psqlBin, args, { input: sql, encoding: "utf8", windowsHide: true }).trim();
const uid = randomUUID();
const tenant = randomUUID();
const createKey = randomUUID();
const revisionKeys = [randomUUID(), randomUUID()];
const suffix = randomUUID().slice(0, 12);
const claims = JSON.stringify({ sub: uid, role: "authenticated" }).replaceAll("'", "''");
const accountNumber = 9500000 + Math.floor(Math.random() * 400000);

const cleanup = () => {
  run(`
    ALTER TABLE public.business_mission_brief_versions DISABLE TRIGGER business_mission_brief_immutable;
    DELETE FROM public.business_mission_mutation_receipts WHERE tenant_id='${tenant}';
    DELETE FROM public.business_mission_brief_versions WHERE tenant_id='${tenant}';
    DELETE FROM public.business_missions WHERE tenant_id='${tenant}';
    ALTER TABLE public.business_mission_brief_versions ENABLE TRIGGER business_mission_brief_immutable;
    DELETE FROM public.paige_audit_log WHERE tenant_id='${tenant}';
    DELETE FROM public.tenant_members WHERE tenant_id='${tenant}';
    DELETE FROM public.profiles WHERE user_id='${uid}';
    ${retireSyntheticTenantSQL(tenant)}
    DELETE FROM auth.users WHERE id='${uid}';
  `);
};

run(`
  INSERT INTO auth.users(id,aud,role,email) VALUES('${uid}','authenticated','authenticated','mission-race-${suffix}@tests.invalid');
  INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand,owner_user_id)
    VALUES('${tenant}','mission-race-${suffix}','Mission Race','active','standalone','MRC',${accountNumber},'{}','{}','${uid}');
  INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
    VALUES('${tenant}','${uid}','owner','active',true,now());
  INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${uid}','${tenant}')
    ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;
`);

const invoke = (sql) => new Promise((resolve, reject) => {
  const child = spawn(psqlBin, args, { windowsHide: true });
  let stdout = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.resume();
  child.on("error", () => reject(new Error("concurrency process unavailable")));
  child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error("concurrency query failed")));
  child.stdin.end(sql);
});

try {
  const createSql = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','${claims}',true);
    SELECT public.create_business_mission('${createKey}','Concurrent Mission','Prove one durable Mission',current_date+30,'Baseline','Strategy','{}','One Mission','Record only','{}','{}',NULL,'owner_ui',NULL);
    SELECT pg_sleep(1); COMMIT;`;
  const created = await Promise.all([invoke(createSql), invoke(createSql)]);
  const createJson = created.map((output) => JSON.parse(output.split(/\r?\n/).find((line) => line.includes('"mission_id"'))));
  assert.equal(createJson.filter((item) => item.replayed === false).length, 1);
  assert.equal(createJson.filter((item) => item.replayed === true).length, 1);
  assert.equal(run(`SELECT count(*) FROM public.business_missions WHERE tenant_id='${tenant}'`), "1");
  assert.equal(run(`SELECT count(*) FROM public.business_mission_brief_versions WHERE tenant_id='${tenant}'`), "1");
  assert.equal(run(`SELECT count(*) FROM public.business_mission_mutation_receipts WHERE tenant_id='${tenant}'`), "1");
  const mission = run(`SELECT id FROM public.business_missions WHERE tenant_id='${tenant}'`);

  const reviseSql = (key, label) => `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','${claims}',true);
    CREATE TEMP TABLE race_result(v text);
    DO $$ BEGIN
      INSERT INTO race_result SELECT public.revise_business_mission_brief('${mission}',1,'${key}','${label}',current_date+31,'Measured baseline','Revised strategy','{}','One Mission','Record only','{}','{}','Concurrent revision',NULL,NULL)::text;
    EXCEPTION WHEN OTHERS THEN INSERT INTO race_result VALUES(SQLSTATE||':'||SQLERRM); END $$;
    SELECT v FROM race_result; SELECT pg_sleep(1); COMMIT;`;
  const revised = await Promise.all([invoke(reviseSql(revisionKeys[0], "Revision A")), invoke(reviseSql(revisionKeys[1], "Revision B"))]);
  const lines = revised.map((output) => output.split(/\r?\n/).find((line) => line.includes('"mission_id"') || line.startsWith("40001:")));
  assert.equal(lines.filter((line) => line?.startsWith("{")).length, 1);
  assert.equal(lines.filter((line) => line === "40001:MISSION_REVISION_CONFLICT").length, 1);
  assert.equal(run(`SELECT revision FROM public.business_missions WHERE id='${mission}'`), "2");
  assert.equal(run(`SELECT count(*) FROM public.business_mission_brief_versions WHERE mission_id='${mission}'`), "2");
  assert.equal(run(`SELECT count(*) FROM public.business_mission_mutation_receipts WHERE mission_id='${mission}'`), "2");
  console.log("PASS: concurrent duplicate create produced one Mission plus one replay; competing revisions produced one commit plus one revision conflict.");
} finally {
  cleanup();
}
