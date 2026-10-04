// One fresh database in an explicitly verified disposable local cluster. No hosted credentials or provider actions.
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';
const [binary, port, user, expectedDirectory] = process.argv.slice(2);
if (!binary || !/^\d+$/.test(port ?? '') || !user || !expectedDirectory) throw new Error('Usage: node scripts/sql/sales-invoice-snapshot-concurrency.mjs <psql> <local-port> <local-user> <verified-disposable-directory>');
const cwd = fileURLToPath(new URL('.',import.meta.url));
const args = database=>['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-t','-A'];
const sync = (database,sql)=>{
  const result=spawnSync(binary,args(database),{cwd,input:sql,encoding:'utf8',maxBuffer:4*1024*1024});
  if(result.status!==0) throw new Error(result.stderr.split(/\r?\n/).filter(line=>!line.includes('NOTICE:')).join('\n'));
  return result.stdout.trim();
};
const normalized=value=>value.trim().replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(normalized(sync('postgres','SHOW data_directory;')),normalized(expectedDirectory),'refuse any other cluster');
const database='sales_invoice_race_'+randomUUID().replaceAll('-','');
assert(/^sales_invoice_race_[a-f0-9]{32}$/.test(database));
sync('postgres',`CREATE DATABASE ${database};`);
const concurrent=sql=>new Promise(resolve=>{
  const child=spawn(binary,args(database),{cwd,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
  child.on('error',error=>resolve({code:1,stdout,stderr:String(error)}));
  child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(sql);
});
const tenant='20000000-0000-0000-0000-000000000001',invoice='60000000-0000-0000-0000-000000000088';
const draft={schema_version:2,client_id:'30000000-0000-0000-0000-000000000001',
  items:[{price_id:null,item:'First service',description:'Concurrent customer scope',unit_minor:999,quantity:2},{price_id:null,item:'Second service',unit_minor:1001,quantity:1}],
  kind:'deposit',deposit_basis_points:2500,currency:'usd',cadence:null,recipient_email:'billing@example.test',recipient_phone:null,
  email_source_method_id:null,phone_source_method_id:null,billing_address:null,agreement_id:null,processor_intent:null,
  payment_method_intents:['zelle','wire'],delivery_channel_intents:['email','sms'],due_date:null,memo:null};
const request=(version,operation,memo=null)=>`BEGIN; SET LOCAL test.actor='10000000-0000-0000-0000-000000000001';
SET LOCAL test.workspace='${tenant}'; SET LOCAL test.admin='true'; SET LOCAL ROLE authenticated;
SELECT save_sales_billing_draft('${tenant}','${invoice}',${version},'${operation}','${JSON.stringify({...draft,memo}).replaceAll("'","''")}'::jsonb); COMMIT;`;
try {
  const proof=readFileSync(new URL('sales-billing-drafts-proof.sql',import.meta.url),'utf8');
  const extension=readFileSync(new URL('sales-invoice-snapshot-proof.sql',import.meta.url),'utf8');
  sync(database,proof.replace('ROLLBACK;',()=>extension+'\nCOMMIT;'));
  const creates=await Promise.all([concurrent(request(0,'70000000-0000-0000-0000-000000000099')),concurrent(request(0,'70000000-0000-0000-0000-000000000099'))]);
  assert(creates.every(result=>result.code===0),'both exact-operation callers recover committed result: '+JSON.stringify(creates));
  const row=result=>JSON.parse(result.stdout.split(/\r?\n/).find(line=>line.startsWith('{"row":'))).row;
  assert.deepEqual(row(creates[0]),row(creates[1]));
  assert.equal(sync(database,`SELECT count(*) FROM paige_invoices WHERE id='${invoice}' AND billing_draft_version=1;`),'1');
  const edits=await Promise.all([concurrent(request(1,'70000000-0000-0000-0000-000000000097','First')),concurrent(request(1,'70000000-0000-0000-0000-000000000098','Second'))]);
  assert.equal(edits.filter(result=>result.code===0).length,1);assert(edits.find(result=>result.code!==0).stderr.includes('Draft version conflict'));
  assert.equal(sync(database,`SELECT billing_draft_version FROM paige_invoices WHERE id='${invoice}';`),'2');
  console.log('PASS: real PostgreSQL schema2 simultaneous same-operation creates commit one record; competing CAS edits commit one revision and refuse the loser. Local auth-helper stubs; hosted JWT UNVERIFIED.');
} finally {
  sync('postgres',`DROP DATABASE ${database};`);
  console.log('Disposable concurrency database removed.');
}
