// Controlled real-PostgreSQL RPC compatibility. Auth dependencies are synthetic;
// this is not deployed JWT, signed-in customer or native-provider acceptance.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { executeFinanceRead } from '../../supabase/functions/_shared/paige-spine/domains/finance_reads.ts';

const port = Number(process.env.FINANCE_PROOF_PORT ?? (process.env.CI ? 5432 : 55463));
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || port === 5432 && !process.env.CI) throw new Error('Dedicated fixture port required');
const psql = process.env.FINANCE_PROOF_PSQL ?? 'psql';
const database = `finance_fixture_spine_${process.pid}`;
assert.match(database, /^finance_fixture_spine_\d+$/);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const run = (db, input, extra = []) => spawnSync(psql, ['-X', '--no-password', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', ...extra], { input, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
function sql(db, input) { const result = run(db, input); assert.equal(result.status, 0, result.stderr); return result.stdout; }
sql('postgres', `CREATE DATABASE ${database};`);
try {
  const canonical = readFileSync(new URL('../../supabase/migrations/20270602000302_operator_provider_retirement.sql', import.meta.url), 'utf8');
  const disposition = canonical.match(/CREATE OR REPLACE FUNCTION public\.operator_retirement_disposition\(_table text\)[\s\S]*?\$\$;/)?.[0];
  assert.ok(disposition);
  sql(database, disposition);
  for (const [file, variable] of [['finance_source_authority.sql', 'apply_finance_migration'], ['finance_account_source_projections.sql', 'apply_account_migration'], ['finance_liability_source_projections.sql', 'apply_liability_migration'], ['finance_accounting_obligation_projections.sql', 'apply_obligation_migration']]) {
    const result = run(database, undefined, ['-v', variable + '=1', '-f', fileURLToPath(new URL('../../supabase/tests/' + file, import.meta.url))]);
    assert.equal(result.status, 0, result.stderr);
  }
  let actor = '10000000-0000-0000-0000-000000000001';
  const owner = actor, tenant = '20000000-0000-0000-0000-000000000001', entity = '30000000-0000-0000-0000-000000000001';
  const signatures = {
    current_user_tenant_id: [], read_finance_source_catalog: ['_expected_tenant_id'],
    read_finance_account_source: ['_expected_tenant', '_entity_id', '_binding_id'],
    read_finance_liability_source: ['_expected_tenant', '_entity_id', '_binding_id'],
    read_finance_accounting_obligations: ['_expected_tenant', '_entity_id', '_binding_id', '_domain'],
  };
  const literal = value => value === null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
  let afterRead;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    rpc: async (name, parameters = {}) => {
      assert.ok(Object.hasOwn(signatures, name), 'Unexpected fixture RPC');
      const values = signatures[name].map(key => { assert.ok(Object.hasOwn(parameters, key)); return literal(parameters[key]); });
      const result = run(database, `SET ROLE authenticated; SELECT set_config('test.actor',${literal(actor)},false); SELECT to_json(public.${name}(${values.join(',')}));`);
      if (result.status !== 0) return { data: null, error: { code: /ERROR:\s+(\w{5})/.exec(result.stderr)?.[1] ?? 'UNKNOWN' } };
      const data = JSON.parse(result.stdout.trim().split('\n').at(-1));
      afterRead?.(name);
      return { data, error: null };
    },
  };
  const command = suffix => ({ capability: 'finance.liability_source', entity_id: entity, binding_id: '50000000-0000-0000-0000-000000000' + suffix });
  assert.equal((await executeFinanceRead(client, { capability: 'finance.source_catalog' })).outcome, 'read');
  const debt = await executeFinanceRead(client, command('228'));
  assert.equal(debt.outcome, 'read', 'Sparse canonical terms must not discard legitimate balances');
  assert.equal(debt.evidence.records[0].outstandingBalance, '100.50');
  assert.equal(debt.evidence.records[0].principalPayment, null);
  assert.equal(debt.evidence.records[0].institutionUpdatedAt, null);
  const records = [];
  for (const suffix of ['229', '230', '231', '232']) {
    const result = await executeFinanceRead(client, command(suffix));
    assert.equal(result.outcome, 'read', `Distinct canonical card/LOC/loan terms must remain readable: ${suffix}/${result.reason}`);
    records.push(...result.evidence.records);
    assert.equal(result.evidence.company_wide_debt, null);
    assert.equal(result.evidence.institution_freshness_verified, false);
  }
  assert.equal(new Set(records.map(row => row.nativeId)).size, 4);
  assert.equal(records[0].outstandingBalance, '0');
  assert.equal(records[0].aprs, null);
  assert.equal((await executeFinanceRead(client, { ...command('228'), entity_id: '30000000-0000-0000-0000-000000000002' })).outcome, 'refused');
  actor = '10000000-0000-0000-0000-000000000002';
  assert.equal((await executeFinanceRead(client, command('228'))).outcome, 'refused');
  actor = owner;
  afterRead = name => { if (name === 'read_finance_liability_source') sql(database, "UPDATE public.finance_source_bindings SET verification_state='revoked',revision=revision+1 WHERE id='50000000-0000-0000-0000-000000000228';"); };
  assert.equal((await executeFinanceRead(client, command('228'))).outcome, 'refused');
  afterRead = undefined;
  sql(database, `DELETE FROM public.tenant_members WHERE tenant_id=${literal(tenant)} AND user_id=${literal(owner)};`);
  assert.equal((await executeFinanceRead(client, { capability: 'finance.source_catalog' })).outcome, 'refused');
  console.log('PASS real PostgreSQL RPC compatibility: sparse unknown terms, distinct native accounts/products, explicit zero, wrong company/tenant, post-read revocation and changed membership. Auth/provider/customer acceptance remains owed.');
} finally { sql('postgres', `DROP DATABASE ${database};`); }
