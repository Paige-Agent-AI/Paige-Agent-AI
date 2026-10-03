// Creates and drops one fresh database in the explicitly verified disposable local cluster.
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';
const [binary, port, user, expectedDirectory] = process.argv.slice(2);
if (!binary || !/^\d+$/.test(port ?? '') || !user || !expectedDirectory) throw new Error('Usage: node scripts/sql/sales-billing-concurrency-proof.mjs <psql> <local-port> <local-user> <verified-disposable-data-directory>');
const cwd = fileURLToPath(new URL('.', import.meta.url));
const args = database => ['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-t','-A'];
function sync(database, sql) {
  const result = spawnSync(binary, args(database), { cwd, input: sql, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const normalized = value => value.trim().replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(normalized(sync('postgres','SHOW data_directory;')), normalized(expectedDirectory), 'refuse any other cluster');
const database = 'sales_billing_race_' + randomUUID().replaceAll('-','');
assert(/^sales_billing_race_[a-f0-9]{32}$/.test(database));
sync('postgres',`CREATE DATABASE ${database};`);
function concurrent(sql) {
  return new Promise(resolve => {
    const child = spawn(binary,args(database),{cwd,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr=''; child.stdout.on('data',data=>{stdout+=data;}); child.stderr.on('data',data=>{stderr+=data;});
    child.on('error',error=>resolve({code:1,stdout,stderr:String(error)}));
    child.on('close',code=>resolve({code,stdout,stderr})); child.stdin.end(sql);
  });
}
const tenant='20000000-0000-0000-0000-000000000001', invoice='60000000-0000-0000-0000-000000000088';
const draft={client_id:'30000000-0000-0000-0000-000000000001',price_id:null,item:'Concurrency proof',unit_minor:1000,quantity:1,kind:'one_time',provider:'stripe',currency:'usd'};
function request(version,operation,memo='') {
  const payload=JSON.stringify({...draft,memo}).replaceAll("'","''");
  return `BEGIN; SET LOCAL test.actor='10000000-0000-0000-0000-000000000001'; SET LOCAL test.workspace='${tenant}'; SET LOCAL test.admin='true'; SET LOCAL ROLE authenticated;
SELECT public.save_sales_billing_draft('${tenant}','${invoice}',${version},'${operation}','${payload}'::jsonb); COMMIT;`;
}
try {
  const proof=readFileSync(new URL('sales-billing-drafts-proof.sql',import.meta.url),'utf8');
  sync(database,proof.replace('ROLLBACK;','COMMIT;'));
  const operation='70000000-0000-0000-0000-000000000099';
  const creates=await Promise.all([concurrent(request(0,operation)),concurrent(request(0,operation))]);
  assert(creates.every(result=>result.code===0),'both exact-operation callers must recover success: '+JSON.stringify(creates));
  const row=result=>JSON.parse(result.stdout.split(/\r?\n/).find(line=>line.startsWith('{"row":'))).row;
  assert.deepEqual(row(creates[0]),row(creates[1]),'same operation must return exactly one persisted result');
  assert.equal(sync(database,`SELECT count(*) FROM paige_invoices WHERE id='${invoice}' AND billing_draft_version=1;`),'1');
  const edits=await Promise.all([concurrent(request(1,'70000000-0000-0000-0000-000000000097','First edit')),concurrent(request(1,'70000000-0000-0000-0000-000000000098','Second edit'))]);
  assert.equal(edits.filter(result=>result.code===0).length,1,'only one competing expected-version edit may commit');
  assert(edits.find(result=>result.code!==0).stderr.includes('Draft version conflict'),'loser must refuse stale version');
  assert.equal(sync(database,`SELECT billing_draft_version FROM paige_invoices WHERE id='${invoice}';`),'2');
  console.log('PASS: two simultaneous creates recover one exact-operation record; two simultaneous edits commit one version and refuse the other. Real PostgreSQL roles, local auth-helper stubs.');
} finally {
  sync('postgres',`DROP DATABASE ${database};`);
  console.log('Disposable concurrency database removed.');
}
