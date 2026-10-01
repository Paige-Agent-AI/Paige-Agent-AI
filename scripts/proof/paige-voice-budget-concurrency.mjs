import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const url = new URL(process.env.PAIGE_VOICE_BUDGET_TEST_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
assert.equal(url.hostname, "127.0.0.1", "Disposable loopback database required");
assert.ok(process.env.CI === "true" && url.port === "54322" && url.pathname === "/postgres", "Disposable CI Supabase database required");
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", url.toString()];
const psqlBin = process.env.PSQL_BIN || "psql";
const run = (sql) => execFileSync(psqlBin, args, { input: sql, encoding: "utf8", windowsHide: true }).trim();

const actor = randomUUID();
const tenant = randomUUID();
const requests = [randomUUID(), randomUUID()];
const suffix = randomUUID().slice(0, 12);

const cleanup = () => {
  run(`
    DELETE FROM public.paige_voice_cost_reservations WHERE tenant_id='${tenant}';
    DELETE FROM public.paige_voice_tenant_budgets WHERE tenant_id='${tenant}';
    UPDATE public.paige_voice_platform_budget
       SET enabled=false, emergency_disabled=true, monthly_limit_usd=0,
           max_usd_per_1000_chars=0, updated_by=NULL, updated_at=now()
     WHERE singleton=true;
    DELETE FROM public.tenant_members WHERE tenant_id='${tenant}';
    DELETE FROM public.tenants WHERE id='${tenant}';
    DELETE FROM auth.users WHERE id='${actor}';
  `);
};

run(`
  INSERT INTO auth.users(id,aud,role,email)
    VALUES('${actor}','authenticated','authenticated','voice-budget-race-${suffix}@tests.invalid');
  INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features)
    VALUES('${tenant}','voice-budget-race-${suffix}','Voice Budget Race','active','standalone','VBR','{}');
  INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
    VALUES('${tenant}','${actor}','owner','active',true,now());
  INSERT INTO public.paige_voice_tenant_budgets(tenant_id,enabled,monthly_limit_usd)
    VALUES('${tenant}',true,0.20);
  UPDATE public.paige_voice_platform_budget
     SET enabled=true, emergency_disabled=false, monthly_limit_usd=0.20,
         max_usd_per_1000_chars=0.10, updated_at=now()
   WHERE singleton=true;
`);

const invoke = (requestRef) => new Promise((resolve, reject) => {
  const child = spawn(psqlBin, args, { windowsHide: true });
  let stdout = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.resume();
  child.on("error", () => reject(new Error("concurrency process unavailable")));
  child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error("concurrency query failed")));
  child.stdin.end(`
    BEGIN;
    SET LOCAL ROLE service_role;
    SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
    CREATE TEMP TABLE voice_budget_race_result(v text);
    DO $$ BEGIN
      INSERT INTO voice_budget_race_result
      SELECT public.reserve_paige_voice_cost_internal(
        '${actor}','${tenant}','elevenlabs-jessica-r1','${requestRef}',2000
      )::text;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO voice_budget_race_result VALUES(SQLSTATE||':'||SQLERRM);
    END $$;
    SELECT v FROM voice_budget_race_result;
    SELECT pg_sleep(1);
    COMMIT;
  `);
});

try {
  const outcomes = await Promise.all(requests.map(invoke));
  const lines = outcomes.map((output) => output.split(/\r?\n/).find((line) => line.includes('"reservation_id"') || line.startsWith("54000:")));
  assert.equal(lines.filter((line) => line?.includes('"reservation_id"')).length, 1, "exactly one reservation reaches the exact cap");
  assert.equal(lines.filter((line) => line === "54000:PAIGE_VOICE_TENANT_COST_LIMIT").length, 1, "the concurrent over-cap reservation is refused");
  assert.equal(run(`SELECT count(*) FROM public.paige_voice_cost_reservations WHERE tenant_id='${tenant}'`), "1");
  assert.equal(run(`SELECT sum(reserved_usd)=0.20 FROM public.paige_voice_cost_reservations WHERE tenant_id='${tenant}'`), "t");
  console.log("PASS: concurrent reservations serialized; one reached the exact tenant/platform cap and one failed over-cap.");
} finally {
  cleanup();
}
