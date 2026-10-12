// Native decision race against a disposable CI database; never remote/customer data.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { retireSyntheticTenantSQL } from './operator-postgres-fixture.mjs';

const url = new URL(process.env.OPERATIONS_CLIENT_TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
assert.ok(process.env.CI === 'true' && url.hostname === '127.0.0.1'
  && url.port === '54322' && url.pathname === '/postgres', 'Only disposable loopback CI stack permitted');
const psql = process.env.PSQL_BIN || 'psql';
const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', url.toString()];
const run = sql => execFileSync(psql, args, { input: sql, encoding: 'utf8', windowsHide: true, timeout: 20000 }).trim();
const fixture = readFileSync(new URL('../../supabase/tests/operations_delivery_client_review.sql', import.meta.url), 'utf8');
const boundary = fixture.indexOf('-- Identity is revalidated per read;');
assert.ok(boundary > 0, 'Canonical awaiting-client fixture boundary required');
let seed = fixture.slice(0, boundary).replace(/^begin;\s*$/m, '');
const ids = new Map([...seed.matchAll(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g)].map(m => [m[0], randomUUID()]));
const id = key => { assert.ok(ids.has(key)); return ids.get(key); };
seed = seed.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, key => id(key));
const suffix = randomUUID().slice(0, 8);
seed = seed.replaceAll('@tests.invalid', `-${suffix}@tests.invalid`)
  .replaceAll('test-ops-delivery', `test-ops-delivery-${suffix}`);
const tenant = id('ed010000-0000-4000-8000-000000001111');
const client = id('ed010000-0000-4000-8000-000000000004');
const users = [1,2,3,4].map(n => id(`ed010000-0000-4000-8000-00000000000${n}`));
const processes = new Set();
let releaseId, expectedUpdated;
const invoke = (decision, name) => new Promise((resolve, reject) => {
  const child = spawn(psql, args, { windowsHide: true });
  processes.add(child);
  let output = '', errors = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { errors += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  child.on('error', reject);
  child.on('close', code => {
    clearTimeout(timer); processes.delete(child);
    if (code !== 0) reject(new Error(`Isolated client race failed: ${errors}`));
    else resolve(output.trim().split(/\r?\n/).find(line => line.startsWith('{') || line.startsWith('40001:')));
  });
  child.stdin.end(`BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='12s';
    SET LOCAL application_name='${name}'; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','${client}',true);
    CREATE TEMP TABLE decision_result(v text);
    DO $$ BEGIN
      INSERT INTO decision_result SELECT public.operations_delivery_client_decide_scoped(
        '${releaseId}','${client}','${tenant}','${expectedUpdated}', '${decision}','Documented client decision')::text;
    EXCEPTION WHEN SQLSTATE '40001' THEN INSERT INTO decision_result VALUES(SQLSTATE||':'||SQLERRM); END $$;
    SELECT v FROM decision_result; SELECT pg_sleep(2); COMMIT;`);
});
const observeWait = async names => {
  for (let i=0; i<40; i++) {
    if (run(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('${names[0]}','${names[1]}') AND wait_event_type='Lock'`) !== '0') return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Actual concurrent client decision lock wait was not observed');
};
try {
  run(`BEGIN; ${seed} SELECT set_config('request.jwt.claim.sub','',true); COMMIT;`);
  const source = JSON.parse(run(`SELECT json_build_object('id',id,'updated_at',updated_at) FROM public.operations_delivery_client_releases WHERE tenant_id='${tenant}'`));
  releaseId = source.id; expectedUpdated = source.updated_at;
  assert.ok(/^[0-9a-f-]{36}$/.test(releaseId) && Number.isFinite(Date.parse(expectedUpdated)), 'Exact authoritative release required');
  const names = [`ops-client-${suffix}-a`,`ops-client-${suffix}-b`];
  const completion = Promise.allSettled([invoke('accepted',names[0]),invoke('client_revision_requested',names[1])]);
  await observeWait(names);
  const settled = await completion;
  assert.ok(settled.every(r => r.status === 'fulfilled'), 'Both client sessions must complete');
  const values = settled.map(r => r.value);
  const successes = values.filter(v => v?.startsWith('{')).map(v => JSON.parse(v));
  assert.equal(successes.length, 1, 'Only one client decision commits');
  assert.equal(values.filter(v => v?.startsWith('40001:DELIVERY_CLIENT_DECISION_CHANGED')).length, 1);
  assert.equal(successes[0].actor_id, client);
  assert.equal(run(`SELECT count(*) FROM public.audit_logs WHERE user_id='${client}' AND action='delivery_client_decision'`), '1');
  assert.equal(run(`SELECT state FROM public.operations_delivery_client_releases WHERE id='${releaseId}'`), successes[0].state);
  assert.equal(run(`SELECT state FROM public.operations_delivery_submissions WHERE tenant_id='${tenant}'`), 'approved');
  console.log('PASS: native client decision lock observed; one decision and audit fact; competing stale request refused; internal approval preserved');
} finally {
  for (const child of processes) child.kill('SIGKILL');
  run(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s';
    DELETE FROM public.operations_delivery_client_releases WHERE tenant_id='${tenant}';
    DELETE FROM public.operations_delivery_submissions WHERE tenant_id='${tenant}';
    DELETE FROM public.studio_artifact_versions WHERE tenant_id='${tenant}';
    DELETE FROM public.studio_sessions WHERE tenant_id='${tenant}';
    DELETE FROM public.plan_items WHERE tenant_id='${tenant}'; DELETE FROM public.plans WHERE tenant_id='${tenant}';
    DELETE FROM public.clients WHERE tenant_id='${tenant}';
    DELETE FROM public.audit_logs WHERE user_id IN (${users.map(u=>`'${u}'`).join(',')});
    DELETE FROM public.tenant_members WHERE tenant_id='${tenant}';
    DELETE FROM public.profiles WHERE user_id IN (${users.map(u=>`'${u}'`).join(',')});
    ${retireSyntheticTenantSQL(tenant)}
    DELETE FROM public.user_roles WHERE user_id IN (${users.map(u=>`'${u}'`).join(',')});
    DELETE FROM auth.users WHERE id IN (${users.map(u=>`'${u}'`).join(',')}); COMMIT;`);
  assert.equal(run(`SELECT count(*) FROM public.tenants WHERE id='${tenant}'`), '0');
}
