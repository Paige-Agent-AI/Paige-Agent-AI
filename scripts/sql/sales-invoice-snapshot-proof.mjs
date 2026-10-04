// Executes only in an explicitly verified disposable local PostgreSQL cluster; rolls back all fixtures.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import ts from 'typescript';
const [binary, port, user, expectedDirectory] = process.argv.slice(2);
if (!binary || !/^\d+$/.test(port ?? '') || !user || !expectedDirectory) throw new Error('Usage: node scripts/sql/sales-invoice-snapshot-proof.mjs <psql> <local-port> <local-user> <verified-disposable-directory>');
const cwd = fileURLToPath(new URL('.', import.meta.url));
const run = sql => {
  const result = spawnSync(binary, ['-h','127.0.0.1','-p',port,'-U',user,'-d','postgres','-v','ON_ERROR_STOP=1','-t','-A'], { cwd, input: sql, encoding: 'utf8', maxBuffer: 4*1024*1024 });
  if (result.status !== 0) throw new Error(result.stderr.split(/\r?\n/).filter(line => !line.includes('NOTICE:')).join('\n'));
  return result.stdout.trim();
};
const normalized = value => value.trim().replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(normalized(run('SHOW data_directory;')), normalized(expectedDirectory), 'refuse any other cluster');
const proof = readFileSync(new URL('sales-billing-drafts-proof.sql', import.meta.url),'utf8');
const extension = readFileSync(new URL('sales-invoice-snapshot-proof.sql', import.meta.url),'utf8');
const runProof = (extra = '') => {
  const result = run(proof.replace('ROLLBACK;',() => extension+'\n'+extra+'\nROLLBACK;'));
  return JSON.parse(result.split(/\r?\n/).findLast(line => line.startsWith('{"snapshot_roundtrip":'))).snapshot_roundtrip;
};
const payload = runProof();
const source = readFileSync(new URL('../../src/solo/sales/invoiceDraftSnapshot.ts', import.meta.url),'utf8');
const javascript = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const decoded = api.normalizeInvoiceSnapshot(payload.row.billing_draft,payload.row.amount_total_cents);
assert(decoded, 'actual SQL multi-item contact/address snapshot must decode');
assert.equal(decoded.items[0].description,'Saved multiline\ndescription'); assert.deepEqual(decoded.payment_method_intents,['zelle','cash','wire']); assert.equal(decoded.processor_intent,null);
assert.equal(decoded.items.length,2); assert.deepEqual(decoded.delivery_channel_intents,['email','sms']);
assert.equal(decoded.billing_address.line2,'Suite 2'); assert.equal(decoded.billing_address.country,null);
assert.equal(decoded.agreement_snapshot.title,'Matching agreement');
assert.equal(api.snapshotEditInput(decoded).items[0].unit_minor,null,'edits re-resolve Catalog');
const draft = { ...api.snapshotEditInput(decoded), email_source_method_id:null, agreement_id:null, recipient_email:'override@example.test', memo:'Explicit invoice-only edit' };
const literal = JSON.stringify(draft).replaceAll("'","''");
const save = `public.save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000077',1,'70000000-0000-0000-0000-000000000080','${literal}'::jsonb)`;
const edited = runProof(`RESET ROLE;
UPDATE tenant_prices SET active=true,unit_amount=1500 WHERE id='50000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE snapshot_edit_result AS SELECT ${save} AS result;
SELECT proof_assert((SELECT result FROM snapshot_edit_result)=${save},'actual client edit exact replay');
SELECT jsonb_build_object('snapshot_roundtrip',jsonb_build_object('saved',(SELECT result FROM snapshot_edit_result),'listed',list_sales_billing_drafts('20000000-0000-0000-0000-000000000001')));`);
const moduleURL = (name, replacements = {}) => {
  let output = ts.transpileModule(readFileSync(new URL(`../../src/solo/sales/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  for (const [key,url] of Object.entries(replacements)) output = output.replaceAll(`'./${key}'`,`'${url}'`).replaceAll(`"./${key}"`,`"${url}"`);
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
};
const client = await import(moduleURL('invoiceDraftApi',{billingDrafts:moduleURL('billingDrafts'),invoiceDraftSnapshot:moduleURL('invoiceDraftSnapshot')}));
const saved = await client.saveInvoiceDraft(async()=>({data:edited.saved,error:null}),{
  openedTenantId:'20000000-0000-0000-0000-000000000001',invoiceId:'60000000-0000-0000-0000-000000000077',expectedVersion:1,operationId:'70000000-0000-0000-0000-000000000080',draft,
});
assert.equal(saved.ok,true); assert.equal(saved.value.version,2); assert.equal(saved.value.totalMinor,4001);
assert.equal(saved.value.snapshot.recipient_email,'override@example.test'); assert.equal(saved.value.snapshot.billing_address.line2,'Suite 2');
const listed = await client.listInvoiceDrafts(async()=>({data:edited.listed,error:null}),'20000000-0000-0000-0000-000000000001');
assert.equal(listed.ok,true); assert(listed.value.rows.some(row=>row.schemaVersion===1));
assert.deepEqual(listed.value.rows.find(row=>row.id===saved.value.id),saved.value,'canonical list readback after edit retains full snapshot');
console.log('PASS: real PostgreSQL v1/v2 role, tenant, provenance, aggregate, agreement and replay proof; actual SQL create -> dual reader -> edit serializer -> save/replay -> mixed-schema list readback. All fixtures rolled back. Hosted auth/provider proof UNVERIFIED.');
