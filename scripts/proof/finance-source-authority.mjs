// Actual Finance migration against disposable loopback PostgreSQL; never uses deployed credentials.
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.FINANCE_PROOF_PORT ?? (process.env.CI ? 5432 : 55463));
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || (port === 5432 && !process.env.CI)) throw new Error('Dedicated fixture port required');
const psql = process.env.FINANCE_PROOF_PSQL ?? 'psql';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const args = database => ['-X', '--no-password', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'];
const fixture = fileURLToPath(new URL('../../supabase/tests/finance_source_authority.sql', import.meta.url));
function run(database, input, extra = []) {
  const result = spawnSync(psql, [...args(database), ...extra], { input, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error) throw result.error;
  return result;
}
function sql(database, text) {
  const result = run(database, text);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const actor = `SET ROLE authenticated; SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);`;
const save = name => `SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003',1,'managed_entity','${name}');`;
function holding(database, text) {
  const child = spawn(psql, args(database), { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '';
  let ready;
  const held = new Promise(resolve => { ready = resolve; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', data => { output += data; if (output.includes('FINANCE_LOCK_HELD')) ready(); });
    child.stderr.on('data', data => { error += data; });
    child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
  });
  child.stdin.end(`BEGIN; ${actor} ${text} SELECT 'FINANCE_LOCK_HELD'; SELECT pg_sleep(1); COMMIT;`);
  return { held: Promise.race([held, done.then(() => { throw new Error('Lock acknowledgement missing'); })]), done };
}
async function competing(database, text) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, args(database), { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(error)));
    child.stdin.end(text);
  });
}
for (const leg of ['absent', 'replay1', 'replay2']) {
  const database = `finance_fixture_${process.pid}_${leg}`;
  sql('postgres', `CREATE DATABASE ${database};`);
  try {
    const result = run(database, undefined, ['-v', `apply_finance_migration=${leg === 'absent' ? 0 : 1}`, '-f', fixture]);
    if (leg === 'absent') {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /read_finance_source_catalog.*does not exist/);
      console.log('PASS failing-first: Finance catalog does not exist before migration');
      continue;
    }
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Finance source authority PASS/);
    const first = holding(database, save('Test Concurrent Company A'));
    await first.held;
    await competing(database, `${actor} SELECT public.fixture_expect_error($q$${save('Test Concurrent Company B')}$q$,'40001');`);
    await first.done;
    assert.equal(sql(database, "SELECT version||':'||legal_name FROM finance_company_entities WHERE id='30000000-0000-0000-0000-000000000003';").trim(), '2:Test Concurrent Company A');
    assert.equal(sql(database, 'SELECT count(*) FROM fixture_receipts;').trim(), '4');
    // Same version/request replays the one committed result, without a second receipt.
    sql(database, `${actor} ${save('Test Concurrent Company A')}`);
    assert.equal(sql(database, 'SELECT count(*) FROM fixture_receipts;').trim(), '4');
    const create = `SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005',0,'managed_entity','Test Concurrent Creation');`;
    const creation = holding(database, create);
    await creation.held;
    const replay = await competing(database, `${actor} ${create}`);
    await creation.done;
    assert.match(replay, /"replayed": true/);
    assert.equal(sql(database, 'SELECT count(*) FROM fixture_receipts;').trim(), '5');
    sql(database, `
      INSERT INTO quickbooks_connections VALUES('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',true);
      INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace,verification_state,verification_reference,verified_at)
       VALUES('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000002','sandbox','test-realm-2','verified','60000000-0000-0000-0000-000000000002',now());`);
    const observation = `INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,evidence_digest)
      VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002',1,'test-concurrent','bank_accounts',now(),'partial',repeat('c',64));`;
    const ingest = holding(database, `RESET ROLE; ${observation}`);
    await ingest.held;
    await competing(database, `UPDATE quickbooks_connections SET is_active=false WHERE id='40000000-0000-0000-0000-000000000002';`);
    await ingest.done;
    sql(database, `SELECT public.fixture_expect_error($q$${observation.replace('test-concurrent', 'test-after-revoke')}$q$,'42501');`);
    console.log(`PASS ${leg}: actual migration, role/tenant/source guards, receipt rollback, concurrent update and replay`);
  } finally {
    // Only a hardcoded, newly-created fixture database on loopback can reach this operation.
    sql('postgres', `DROP DATABASE ${database} WITH (FORCE);`);
  }
}
console.log('Finance PostgreSQL proof PASS. Canonical dependency fixtures; live-provider/authenticated acceptance owed.');
