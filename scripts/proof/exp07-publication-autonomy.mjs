import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const bin = process.env.PSQL_BIN || 'psql';
const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At'];
function psql(sql) {
  return spawnSync(bin, args, { input: sql, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
}
const database = psql('select current_database();');
if (database.status !== 0 || database.stdout.trim() !== 'social_presence_connection_readiness_contract')
  throw Error('This proof requires its existing isolated synthetic database');
const suite = spawnSync(bin, [...args, '-f', 'supabase/tests/exp07_publication_autonomy.sql'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
if (suite.status !== 0) { process.stderr.write(suite.stderr || String(suite.error)); process.exit(1); }
process.stdout.write(suite.stderr.split('\n').filter(line => /NOTICE:.*(passed|checks)/.test(line)).join('\n') + '\n');
const migration = readFileSync('supabase/migrations/20271133000027_exp07_publication_autonomy_catalogue.sql', 'utf8');
const guard = migration.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)?.[0];
if (!guard) throw Error('The actual migration guard was not found');
const definition = name => {
  const result = psql(`select pg_get_functiondef('public.${name}(uuid)'::regprocedure);`);
  if (result.status !== 0 || !result.stdout.includes('CREATE OR REPLACE FUNCTION')) throw Error('Native source lookup failed');
  const sql = result.stdout.trim();
  return sql.endsWith(';') ? sql : sql + ';';
};
const current = definition('list_tool_autonomy');
const prior = definition('_list_tool_autonomy_before_exp07_publication');
for (const [label, mutation] of [
  ['wrapper source', current.replace("'social_post_publish'", "'changed_post_publish'")],
  ['predecessor source', prior.replace("'sales_record_provider_disposition'", "'changed_provider_disposition'")],
  ['wrapper ACL', 'GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO anon;'],
  ['predecessor ACL', 'GRANT EXECUTE ON FUNCTION public._list_tool_autonomy_before_exp07_publication(uuid) TO authenticated;'],
  ['security mode', 'ALTER FUNCTION public.list_tool_autonomy(uuid) SECURITY INVOKER;'],
  ['search path', "ALTER FUNCTION public.list_tool_autonomy(uuid) SET search_path TO public;"],
]) {
  if (mutation === current || mutation === prior) throw Error(`Mutation did not change ${label}`);
  const result = psql(`BEGIN;\n${mutation}\n${guard}\nROLLBACK;`);
  if (result.status === 0 || !result.stderr.includes('23514')) throw Error(`Actual migration admitted ${label} drift: ${result.stderr}`);
  console.log(`PASS: actual migration refuses ${label} drift and transaction rolls back`);
}
const final = psql(guard);
if (final.status !== 0 || definition('list_tool_autonomy') !== current || definition('_list_tool_autonomy_before_exp07_publication') !== prior)
  throw Error('Negative probes changed the original catalogue');
console.log('PASS: EXP07 original native suite, catalogue replay/authority and six actual-guard drift controls');
