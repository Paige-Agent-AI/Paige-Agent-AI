// Actual Finance migration against disposable loopback PostgreSQL; never uses deployed credentials.
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const port = Number(process.env.FINANCE_PROOF_PORT ?? (process.env.CI ? 5432 : 55463));
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || (port === 5432 && !process.env.CI)) throw new Error('Dedicated fixture port required');
const psql = process.env.FINANCE_PROOF_PSQL ?? 'psql';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const args = database => ['-X', '--no-password', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'];
const fixture = fileURLToPath(new URL('../../supabase/tests/finance_source_authority.sql', import.meta.url));
const suite = process.argv[2] ?? 'source';
if (!['source', 'accounts', 'liabilities', 'accounting'].includes(suite)) throw new Error('Closed Finance proof suite required');
const accountFixture = fileURLToPath(new URL('../../supabase/tests/finance_account_source_projections.sql', import.meta.url));
const obligationFixture = fileURLToPath(new URL('../../supabase/tests/finance_accounting_obligation_projections.sql', import.meta.url));
const liabilityFixture = fileURLToPath(new URL('../../supabase/tests/finance_liability_source_projections.sql', import.meta.url));
function run(database, input, extra = [], timeout = 30000) {
  const result = spawnSync(psql, [...args(database), ...extra], { input, env, encoding: 'utf8', windowsHide: true, timeout });
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
  let released = false;
  const release = () => { if (!released) { released = true; child.stdin.end('COMMIT;\n'); } };
  const deadline = setTimeout(() => { if (!released) { released = true; child.stdin.end('ROLLBACK;\n'); } }, 20000);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', data => { output += data; if (output.includes('FINANCE_LOCK_HELD')) ready(); });
    child.stderr.on('data', data => { error += data; });
    child.on('close', code => { clearTimeout(deadline); code === 0 ? resolve() : reject(new Error(error)); });
  });
  child.stdin.write(`BEGIN; ${actor} ${text} SELECT 'FINANCE_LOCK_HELD';\n`);
  return { held: Promise.race([held, done.then(() => { throw new Error('Lock acknowledgement missing'); })]), done, release };
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
async function blockedCompetitor(database, text, release) {
  const outcome = competing(database, `SET application_name='finance-proof-lock-waiter'; ${text}`).then(value => ({ value }), error => ({ error }));
  let waiting = false;
  try {
    for (let probe = 0; probe < 10; probe++) {
      if (sql(database, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='finance-proof-lock-waiter' AND wait_event_type='Lock');").trim() === 't') { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally { release(); }
  const result = await outcome;
  if (result.error) throw result.error;
  assert.equal(waiting, true, 'Concurrent authority/identity change did not wait on the held transaction');
  return result.value;
}
for (const leg of ['absent', 'replay1', 'replay2']) {
  const database = `finance_fixture_${process.pid}_${leg}`;
  sql('postgres', `CREATE DATABASE ${database};`);
  try {
    // Actual canonical disposition definition; role/archive authority remains an
    // explicit fixture dependency, never authenticated Operator acceptance.
    const canonical = readFileSync(new URL('../../supabase/migrations/20270602000302_operator_provider_retirement.sql', import.meta.url), 'utf8');
    const disposition = canonical.match(/CREATE OR REPLACE FUNCTION public\.operator_retirement_disposition\(_table text\)[\s\S]*?\$\$;/)?.[0];
    assert.ok(disposition, 'Canonical retirement disposition missing');
    sql(database, disposition);
    let result = run(database, undefined, ['-v', `apply_finance_migration=${leg === 'absent' && suite === 'source' ? 0 : 1}`, '-f', fixture]);
    if (leg === 'absent' && suite === 'accounts') {
      assert.equal(result.status, 0, result.stderr);
      result = run(database, undefined, ['-v', 'apply_account_migration=0', '-f', accountFixture]);
    }
    if (leg === 'absent' && (suite === 'accounting' || suite === 'liabilities')) {
      assert.equal(result.status, 0, result.stderr);
      result = run(database, undefined, ['-v', 'apply_account_migration=1', '-f', accountFixture]);
      assert.equal(result.status, 0, result.stderr);
      result = run(database, undefined, ['-v', suite === 'accounting' ? 'apply_obligation_migration=0' : 'apply_liability_migration=0', '-f', suite === 'accounting' ? obligationFixture : liabilityFixture]);
    }
    if (leg === 'absent') {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, suite === 'source' ? /read_finance_source_catalog.*does not exist/ : suite === 'accounts' ? /read_finance_account_source.*does not exist/ : suite === 'accounting' ? /read_finance_accounting_obligations.*does not exist/ : /read_finance_liability_source.*does not exist/);
      console.log(`PASS failing-first: Finance ${suite} contract does not exist before migration`);
      continue;
    }
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Finance source authority PASS/);
    const first = holding(database, save('Test Concurrent Company A'));
    await first.held;
    await blockedCompetitor(database, `${actor} SELECT public.fixture_expect_error($q$${save('Test Concurrent Company B')}$q$,'40001');`, first.release);
    await first.done;
    assert.equal(sql(database, "SELECT version||':'||legal_name FROM finance_company_entities WHERE id='30000000-0000-0000-0000-000000000003';").trim(), '2:Test Concurrent Company A');
    assert.equal(sql(database, 'SELECT count(*) FROM fixture_receipts;').trim(), '4');
    // Same version/request replays the one committed result, without a second receipt.
    sql(database, `${actor} ${save('Test Concurrent Company A')}`);
    assert.equal(sql(database, 'SELECT count(*) FROM fixture_receipts;').trim(), '4');
    const create = `SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005',0,'managed_entity','Test Concurrent Creation');`;
    const creation = holding(database, create);
    await creation.held;
    const replay = await blockedCompetitor(database, `${actor} ${create}`, creation.release);
    await creation.done;
    assert.match(replay, /"replayed": true/);
    assert.equal(sql(database, 'SELECT count(*) FROM fixture_receipts;').trim(), '5');
    // An unchanged current-version save must preserve bindings and the receipt.
    sql(database, `${actor} SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005',1,'managed_entity','Test Concurrent Creation');`);
    assert.equal(sql(database, "SELECT version FROM finance_company_entities WHERE id='30000000-0000-0000-0000-000000000005';").trim(), '1');
    assert.equal(sql(database, 'SELECT count(*) FROM fixture_receipts;').trim(), '5');
    sql(database, `
      INSERT INTO quickbooks_connections(id,user_id,is_active,qb_realm_id) VALUES('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',true,'test-realm-2');
      INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace,verification_state,verification_reference,verified_at)
       VALUES('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000002','sandbox','test-realm-2','verified','60000000-0000-0000-0000-000000000002',now());`);
    const observation = `INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,evidence_digest)
      VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002',1,'test-concurrent','bank_accounts',now(),'partial',repeat('c',64));`;
    const ingest = holding(database, `RESET ROLE; ${observation}`);
    await ingest.held;
    await blockedCompetitor(database, `UPDATE quickbooks_connections SET is_active=false WHERE id='40000000-0000-0000-0000-000000000002';`, ingest.release);
    await ingest.done;
    sql(database, `SELECT public.fixture_expect_error($q$${observation.replace('test-concurrent', 'test-after-revoke')}$q$,'42501');`);
    sql(database, `INSERT INTO quickbooks_connections(id,user_id,is_active,qb_realm_id) VALUES('40000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001',true,'test-concurrent-binding');`);
    const bindingInsert = `INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace,verification_state,verification_reference,verified_at)
      VALUES('50000000-0000-0000-0000-000000000013','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000013','sandbox','test-concurrent-binding','verified','60000000-0000-0000-0000-000000000013',now());`;
    const bindingCreation = holding(database, `RESET ROLE; ${bindingInsert}`);
    await bindingCreation.held;
    await blockedCompetitor(database, `UPDATE quickbooks_connections SET is_active=false WHERE id='40000000-0000-0000-0000-000000000013';`, bindingCreation.release);
    await bindingCreation.done;
    assert.equal(sql(database, "SELECT verification_state||':'||revision FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000013';").trim(), 'revoked:2');
    sql(database, `INSERT INTO quickbooks_connections(id,user_id,is_active,qb_realm_id) VALUES('40000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000001',true,'test-company-binding');`);
    const companyBinding = bindingInsert.replaceAll('000000000013', '000000000014').replace('test-concurrent-binding', 'test-company-binding');
    const companyCreation = holding(database, `RESET ROLE; ${companyBinding}`);
    await companyCreation.held;
    await blockedCompetitor(database, "UPDATE finance_company_entities SET is_active=false,version=version+1 WHERE id='30000000-0000-0000-0000-000000000001';", companyCreation.release);
    await companyCreation.done;
    assert.equal(sql(database, "SELECT verification_state||':'||revision FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000014';").trim(), 'revoked:2');
    sql(database, `INSERT INTO quickbooks_connections(id,user_id,is_active,qb_realm_id) VALUES('40000000-0000-0000-0000-000000000015','10000000-0000-0000-0000-000000000001',true,'test-setup-binding');`);
    sql(database, `SELECT public.fixture_expect_error($q$${companyBinding.replaceAll('000000000014','000000000015').replace('test-company-binding','test-setup-binding')}$q$,'42501');`);
    sql(database, "UPDATE finance_company_entities SET is_active=true,version=version+1 WHERE id='30000000-0000-0000-0000-000000000001';");
    const setupBinding = companyBinding.replaceAll('000000000014','000000000015').replace('test-company-binding','test-setup-binding');
    const setupCreation = holding(database, `RESET ROLE; ${setupBinding}`);
    await setupCreation.held;
    await blockedCompetitor(database, "UPDATE tenants SET brand=jsonb_set(brand,'{business_brief,legalName}','\"Changed Company\"') WHERE id='20000000-0000-0000-0000-000000000001';", setupCreation.release);
    await setupCreation.done;
    assert.equal(sql(database, "SELECT verification_state||':'||revision FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000015';").trim(), 'revoked:2');
    sql(database, `SELECT public.fixture_expect_error($q$${setupBinding}$q$,'42501');`);
    sql(database, "UPDATE tenants SET brand=jsonb_set(brand,'{business_brief,legalName}','\"Test Company A\"') WHERE id='20000000-0000-0000-0000-000000000001';");
    assert.equal(sql(database, "SELECT verification_state||':'||revision FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000015';").trim(), 'revoked:2');
    sql(database, `INSERT INTO agency_team_members VALUES('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','agency_specialist','active',ARRAY['20000000-0000-0000-0000-000000000001'::uuid]);`);
    const agencyActor = `SELECT set_config('test.actor','10000000-0000-0000-0000-000000000003',false);`;
    const agencyRead = holding(database, `${agencyActor} SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001');`);
    await agencyRead.held;
    await blockedCompetitor(database, "UPDATE agency_team_members SET status='inactive' WHERE user_id='10000000-0000-0000-0000-000000000003';", agencyRead.release);
    await agencyRead.done;
    sql(database, `SET ROLE authenticated; ${agencyActor} SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001')$q$,'42501');`);
    if (suite === 'accounts' || suite === 'accounting' || suite === 'liabilities') {
      const accounts = run(database, undefined, ['-v', 'apply_account_migration=1', '-f', accountFixture]);
      assert.equal(accounts.status, 0, accounts.stderr);
      assert.match(accounts.stdout, /Finance account projections PASS/);
      sql(database, `INSERT INTO quickbooks_connections(id,user_id,is_active,qb_realm_id) VALUES('40000000-0000-0000-0000-000000000203','10000000-0000-0000-0000-000000000001',true,'synthetic-concurrent-snapshot');
        INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace,verification_state,verification_reference,verified_at)
        VALUES('50000000-0000-0000-0000-000000000203','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000203','sandbox','synthetic-concurrent-snapshot','verified','60000000-0000-0000-0000-000000000203',now());`);
      const replace = `SELECT public.replace_finance_account_source_snapshot('50000000-0000-0000-0000-000000000203',1,0,'2026-01-01T00:00:00Z','complete',true,repeat('c',64),'[]');`;
      const snapshotWrite = holding(database, `RESET ROLE; ${replace}`);
      await snapshotWrite.held;
      // Identical version/evidence retries must reach CAS, not a unique-index 23505.
      await blockedCompetitor(database, `SELECT public.fixture_expect_error($q$${replace}$q$,'40001');`, snapshotWrite.release);
      await snapshotWrite.done;
      assert.equal(sql(database, "SELECT version FROM finance_account_source_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000203';").trim(), '1');
      assert.equal(sql(database, "SELECT count(*) FROM finance_source_observations WHERE binding_id='50000000-0000-0000-0000-000000000203';").trim(), '1');
    }
    if (suite === 'accounting') {
      const obligations = run(database, undefined, ['-v', 'apply_obligation_migration=1', '-f', obligationFixture]);
      assert.equal(obligations.status, 0, obligations.stderr);
      assert.match(obligations.stdout, /Finance accounting obligations PASS/);
      const replace = "SELECT public.fixture_obligation_write('[]',2,2);";
      const write = holding(database, `RESET ROLE; ${replace}`);
      await write.held;
      await blockedCompetitor(database, `SELECT public.fixture_expect_error($q$${replace}$q$,'40001');`, write.release);
      await write.done;
      assert.equal(sql(database, "SELECT version FROM finance_accounting_obligation_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000240' AND domain='bills';").trim(), '3');
      assert.equal(sql(database, "SELECT count(*) FROM finance_source_observations WHERE binding_id='50000000-0000-0000-0000-000000000240' AND domain='bills';").trim(), '3');
    }
    if (suite === 'liabilities') {
      const liabilities = run(database, undefined, ['-v', 'apply_liability_migration=1', '-f', liabilityFixture]);
      assert.equal(liabilities.status, 0, liabilities.stderr);
      assert.match(liabilities.stdout, /Finance liability projections PASS/);
      const replace = `SELECT public.fixture_liability_write('[]',2,2);`;
      const liabilityWrite = holding(database, `RESET ROLE; ${replace}`);
      await liabilityWrite.held;
      await blockedCompetitor(database, `SELECT public.fixture_expect_error($q$${replace}$q$,'40001');`, liabilityWrite.release);
      await liabilityWrite.done;
      assert.equal(sql(database, "SELECT version FROM finance_liability_source_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000228';").trim(), '3');
      assert.equal(sql(database, "SELECT count(*) FROM finance_source_observations WHERE binding_id='50000000-0000-0000-0000-000000000228' AND domain='liabilities';").trim(), '3');
    }
    console.log(`PASS ${leg}: actual migration, role/tenant/source guards, receipt rollback, concurrent update and replay`);
  } finally {
    // Only a hardcoded, newly-created fixture database on loopback can reach this operation.
    const cleanup = run('postgres', `DROP DATABASE ${database} WITH (FORCE);`, [], 60000);
    assert.equal(cleanup.status, 0, cleanup.stderr);
  }
}
console.log('Finance PostgreSQL proof PASS. Canonical dependency fixtures; live-provider/authenticated acceptance owed.');
