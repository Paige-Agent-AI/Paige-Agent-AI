// Real concurrent target RPCs, using the incumbent Mission/metric issuer contracts.
// Disposable local/CI database only. Synthetic fixture records are retired in finally.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { retireSyntheticTenantSQL } from "./operator-postgres-fixture.mjs";

const url = new URL(process.env.MISSION_TARGET_TEST_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
assert.equal(url.hostname, "127.0.0.1", "Disposable loopback database required");
assert.ok((url.port === "53567" && url.pathname === "/e2_target_v2") || (process.env.CI === "true" && url.port === "54322" && url.pathname === "/postgres"), "Disposable target test database required");
const bin = process.env.PSQL_BIN || "psql";
const flags = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", url.toString()];
const run = sql => execFileSync(bin, flags, { input: sql, encoding: "utf8", windowsHide: true }).trim();
const user = randomUUID(), tenant = randomUUID(), createKey = randomUUID();
const suffix = randomUUID().slice(0, 12);
const actor = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','${JSON.stringify({ sub: user, role: "authenticated" })}',true); SELECT set_config('request.jwt.claim.sub','${user}',true);`;
const payload = {
  title: "Grow active clients", metric: { key: "business.active_clients_current", version: "1.0.0", unit: "count", value_kind: "count", currency: null, dimensions: {}, range_key: "quarter", semantics: "current_snapshot", business_time_zone: null },
  period: { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z", time_zone: "UTC" }, comparison: "at_least", desired_value: "10", upper_value: null,
};
const invoke = sql => new Promise((resolve, reject) => {
  const child = spawn(bin, flags, { windowsHide: true }); let out = "", err = "";
  child.stdout.on("data", d => out += d); child.stderr.on("data", d => err += d);
  child.on("error", reject); child.on("close", c => c === 0 ? resolve(out) : reject(new Error(err)));
  child.stdin.end(sql);
});
const cleanup = () => run(`BEGIN;
  ALTER TABLE public.business_mission_target_versions DISABLE TRIGGER business_mission_target_version_immutable;
  ALTER TABLE public.business_mission_brief_versions DISABLE TRIGGER business_mission_brief_immutable;
  DELETE FROM public.business_mission_mutation_receipts WHERE tenant_id='${tenant}';
  DELETE FROM public.business_mission_target_versions WHERE tenant_id='${tenant}';
  DELETE FROM public.business_mission_targets WHERE tenant_id='${tenant}';
  DELETE FROM public.business_mission_brief_versions WHERE tenant_id='${tenant}';
  DELETE FROM public.business_missions WHERE tenant_id='${tenant}';
  ALTER TABLE public.business_mission_target_versions ENABLE TRIGGER business_mission_target_version_immutable;
  ALTER TABLE public.business_mission_brief_versions ENABLE TRIGGER business_mission_brief_immutable;
  DELETE FROM public.paige_audit_log WHERE tenant_id='${tenant}';
  DELETE FROM public.tenant_members WHERE tenant_id='${tenant}';
  DELETE FROM public.profiles WHERE user_id='${user}';
  ${retireSyntheticTenantSQL(tenant)}
  DELETE FROM auth.users WHERE id='${user}'; COMMIT;`);
try {
  run(`INSERT INTO auth.users(id,aud,role,email) VALUES('${user}','authenticated','authenticated','target-race-${suffix}@tests.invalid');
    INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand,owner_user_id)
      VALUES('${tenant}','test-tenant-target-${suffix}','Test target concurrency','active','standalone','TGT',${9700000 + Math.floor(Math.random() * 100000)},'{}','{}','${user}');
    INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES('${tenant}','${user}','owner','active',true);
    INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${user}','${tenant}') ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;`);
  const created = run(`BEGIN; ${actor} SELECT public.create_business_mission('${randomUUID()}','Target race','Grow carefully',NULL,'Measured baseline','Reviewed strategy','{}','Issued actual reaches target','Private direction','{}','{}',NULL,'owner_ui',NULL); COMMIT;`);
  const mission = JSON.parse(created.split(/\r?\n/).find(x => x.startsWith("{") && x.includes('"mission_id"'))).mission_id;
  const issued = run(`BEGIN; ${actor} SELECT public.issue_analytics_evidence_bundle('business.active_clients_current','1.0.0','{}','quarter',now()-interval '10 days',now(),'${tenant}'); COMMIT;`);
  const token = JSON.parse(issued.split(/\r?\n/).filter(x => x.startsWith("{" )).at(-1)).evidence_ref;
  const write = (key, target, value) => `BEGIN; ${actor}
    CREATE TEMP TABLE target_race_result(value text);
    DO $$ BEGIN INSERT INTO target_race_result SELECT public.save_business_mission_target('${key}','${mission}',1,${target ? `'${target}'` : "NULL"},${target ? 1 : "NULL"},'${JSON.stringify({ ...payload, desired_value: value })}'::jsonb,'${token}','Concurrent source proof')::text;
      EXCEPTION WHEN OTHERS THEN INSERT INTO target_race_result VALUES(SQLSTATE||':'||SQLERRM); END $$;
    SELECT value FROM target_race_result; SELECT pg_sleep(0.2); COMMIT;`;
  const outputs = await Promise.all([invoke(write(createKey, null, "10")), invoke(write(createKey, null, "10"))]);
  const results = outputs.map(o => {
    const row = o.split(/\r?\n/).find(x => x.startsWith("{") && x.includes('"target_id"'));
    assert.ok(row, "Target RPC refused: " + o.split(/\r?\n/).filter(x => /^[A-Z0-9]{5}:/.test(x)).join(","));
    return JSON.parse(row);
  });
  assert.equal(results.filter(x => x.replayed).length, 1);
  assert.equal(results[0].target_id, results[1].target_id);
  assert.equal(results[0].receipt_id, results[1].receipt_id);
  assert.equal(run(`SELECT count(*) FROM public.business_mission_targets WHERE tenant_id='${tenant}'`), "1");
  const competing = await Promise.all([invoke(write(randomUUID(), results[0].target_id, "11")), invoke(write(randomUUID(), results[0].target_id, "12"))]);
  const lines = competing.map(o => o.split(/\r?\n/).find(x => x.startsWith("{") && x.includes('"target_id"') || x.startsWith("40001:")));
  assert.equal(lines.filter(x => x?.startsWith("{")).length, 1);
  assert.equal(lines.filter(x => x === "40001:MISSION_TARGET_REVISION_CONFLICT").length, 1);
  assert.equal(run(`SELECT revision FROM public.business_mission_targets WHERE tenant_id='${tenant}'`), "2");
  assert.equal(run(`SELECT count(*) FROM public.business_mission_target_versions WHERE tenant_id='${tenant}'`), "2");
  assert.equal(run(`SELECT count(*) FROM public.business_mission_mutation_receipts WHERE tenant_id='${tenant}' AND operation LIKE 'target_%'`), "2");
  console.log("PASS: concurrent duplicate target create has one target/receipt and one replay; competing target revisions have one commit and one CAS refusal.");
} finally {
  cleanup();
  assert.equal(run(`SELECT count(*) FROM public.tenants WHERE id='${tenant}'`), "0");
  assert.equal(run(`SELECT count(*) FROM auth.users WHERE id='${user}'`), "0");
}
