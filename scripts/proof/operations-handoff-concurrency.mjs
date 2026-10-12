// Native two-connection proof. Never accepts a remote or customer database.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { retireSyntheticTenantSQL } from './operator-postgres-fixture.mjs';

const url = new URL(process.env.OPERATIONS_HANDOFF_TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
assert.equal(url.hostname, '127.0.0.1', 'Disposable loopback database required');
assert.ok(process.env.CI === 'true' && url.port === '54322' && url.pathname === '/postgres', 'Only isolated CI Supabase stack permitted');
const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', url.toString()];
const psql = process.env.PSQL_BIN || 'psql';
const run = sql => execFileSync(psql, args, { input: sql, encoding: 'utf8', windowsHide: true, timeout: 20000 }).trim();
const fixture = readFileSync(new URL('../../supabase/tests/operations_engagement_handoff.sql', import.meta.url), 'utf8');
let seed = fixture.slice(fixture.indexOf('insert into auth.users'), fixture.indexOf('create function pg_temp.handoff'));
assert.ok(seed.includes('insert into public.paige_agreements'), 'Canonical handoff fixture required');
const ids = new Map([...seed.matchAll(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g)].map(m => [m[0], randomUUID()]));
const id = key => { assert.ok(ids.has(key)); return ids.get(key); };
seed = seed.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, key => id(key));
const suffix = randomUUID().slice(0, 8);
seed = seed.replaceAll('@tests.invalid', `-${suffix}@tests.invalid`).replaceAll('test-ops-handoff-', `test-ops-handoff-${suffix}-`);
const tenant = id('eb810000-0000-4000-8000-000000001111');
const foreign = id('eb820000-0000-4000-8000-000000002222');
const actor = id('eb810000-0000-4000-8000-000000000002');
const peer = id('eb810000-0000-4000-8000-000000000001');
const agreement = id('eb810000-0000-4000-8000-00000000a001');
const contact = id('eb810000-0000-4000-8000-00000000c001');
const terms = id('eb810000-0000-4000-8000-00000000d001');
const offer = id('eb810000-0000-4000-8000-00000000f001');
const users = ['eb810000-0000-4000-8000-000000000001','eb810000-0000-4000-8000-000000000002','eb820000-0000-4000-8000-000000000001'].map(id);
const processes = new Set();
let signingVersion;
const invoke = (request, name, caller) => new Promise((resolve, reject) => {
  const child = spawn(psql, args, { windowsHide: true });
  processes.add(child);
  let output = '', errors = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { errors += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  child.on('error', reject);
  child.on('close', code => {
    clearTimeout(timer); processes.delete(child);
    if (code !== 0) reject(new Error(`Isolated race query failed: ${errors}`));
    else resolve(output.trim().split(/\r?\n/).find(line => line.startsWith('{') || line.startsWith('40001:')));
  });
  child.stdin.end(`BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='12s';
    SET LOCAL application_name='${name}'; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','${caller}',true);
    CREATE TEMP TABLE race_result(v text);
    DO $$ BEGIN
      INSERT INTO race_result SELECT public.operations_engagement_handoff('${caller}','${tenant}','${agreement}',
        '${contact}','${terms}','${offer}',${signingVersion},repeat('a',64),repeat('b',64),
        (select updated_at from public.tenant_client_agreements where id='${terms}'),'${request}',
        'Concurrent fulfillment','${actor}',current_date,current_date+10,
        jsonb_build_array(jsonb_build_object('title','One real milestone','assigned_to_user_id','${actor}')),
        'Reviewed scope')::text;
    EXCEPTION WHEN SQLSTATE '40001' THEN INSERT INTO race_result VALUES(SQLSTATE||':'||SQLERRM); END $$;
    SELECT v FROM race_result; SELECT pg_sleep(2); COMMIT;`);
});
const clearPlans = () => run(`DELETE FROM public.plan_items WHERE tenant_id='${tenant}'; DELETE FROM public.plans WHERE tenant_id='${tenant}';`);
const observeWait = async names => {
  for (let i=0; i<40; i++) {
    if (run(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('${names[0]}','${names[1]}') AND wait_event_type='Lock' AND wait_event='advisory'`) !== '0') return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Concurrent lock wait was not observed');
};
try {
  run(`BEGIN; ${seed} UPDATE public.tenant_members SET role='admin' WHERE tenant_id='${tenant}' AND user_id='${peer}'; COMMIT;`);
  signingVersion = Number(run(`SELECT version FROM public.paige_agreements WHERE id='${agreement}'`));
  assert.ok(Number.isSafeInteger(signingVersion) && signingVersion > 0, 'Frozen source version required');
  for (const sameRequest of [true, false]) {
    const first = randomUUID(), second = sameRequest ? first : randomUUID();
    const names = [`ops-handoff-${suffix}-a`,`ops-handoff-${suffix}-b`];
    const attempts = [invoke(first,names[0],actor),invoke(second,names[1],peer)];
    // Attach rejection handling before observing; preserve failures without unhandled promises.
    const completion = Promise.allSettled(attempts);
    await observeWait(names);
    const settled = await completion;
    assert.ok(settled.every(r => r.status === 'fulfilled'), 'Both native sessions must complete');
    const values = settled.map(r => r.value);
    const results = values.filter(v => v?.startsWith('{')).map(v => JSON.parse(v));
    assert.equal(results.filter(r => r.replayed === false).length, 1);
    if (sameRequest) assert.equal(results.filter(r => r.replayed === true).length, 1);
    else assert.equal(values.filter(v => v?.startsWith('40001:OPERATIONS_HANDOFF_ALREADY_LINKED')).length, 1);
    assert.equal(run(`SELECT count(*) FROM public.plans WHERE tenant_id='${tenant}'`), '1');
    assert.equal(run(`SELECT count(*) FROM public.plan_items WHERE tenant_id='${tenant}'`), '1');
    assert.equal(results[0].client_accepted, false);
    clearPlans();
  }
  console.log('PASS: observed lock waits; duplicate request replays once; competing request conflicts; one canonical project/milestone; no client acceptance');
} finally {
  for (const child of processes) child.kill('SIGKILL');
  run(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s';
    DELETE FROM public.plan_items WHERE tenant_id='${tenant}'; DELETE FROM public.plans WHERE tenant_id='${tenant}';
    DELETE FROM public.paige_agreements WHERE tenant_id='${tenant}';
    DELETE FROM public.tenant_client_agreements WHERE tenant_id='${tenant}';
    DELETE FROM public.tenant_products WHERE tenant_id='${tenant}'; DELETE FROM public.clients WHERE tenant_id='${tenant}';
    DELETE FROM public.audit_logs WHERE user_id IN (${users.map(u=>`'${u}'`).join(',')});
    DELETE FROM public.tenant_members WHERE tenant_id IN ('${tenant}','${foreign}');
    DELETE FROM public.profiles WHERE user_id IN (${users.map(u=>`'${u}'`).join(',')});
    ${retireSyntheticTenantSQL(tenant)} ${retireSyntheticTenantSQL(foreign)}
    DELETE FROM public.user_roles WHERE user_id IN (${users.map(u=>`'${u}'`).join(',')});
    DELETE FROM auth.users WHERE id IN (${users.map(u=>`'${u}'`).join(',')}); COMMIT;`);
  assert.equal(run(`SELECT count(*) FROM public.tenants WHERE id IN ('${tenant}','${foreign}')`), '0');
}
