import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Private original financial query only. Synthetic schema/identity/signing/provider
// facts and direct-owner execution are NOT public Auth/Portal/customer acceptance.
export function proveActualClientFinancialRead({run,read}){
 let checks=0;const check=(label,ok)=>{assert(ok,label);checks++;console.log('ACTUAL CLIENT FINANCIAL PASS '+label);};
 const value=q=>JSON.parse(run(q).split(/\r?\n/).filter(s=>s.startsWith('{')).at(-1));
 const fixture=JSON.parse(read('supabase/tests/fixtures/exp04_reviewed_commercial_native.sql').match(/\$e04_fixture\$([\s\S]*?)\$e04_fixture\$::jsonb/)[1]);
 const tenant=fixture.tenant_id,client=fixture.client_id,invoice=fixture.effective.invoice_id;
 assert(tenant&&client&&invoice,'original fixture references required');
 const plain='e044c198-0000-4000-8000-000000000001';
 // Explicit selected-schema ports for the ORIGINAL query's presentation columns.
 // No deployed schema, customer, relationship, role or account is changed.
 run("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS name text;ALTER TABLE paige_invoices ADD COLUMN IF NOT EXISTS due_date date;UPDATE tenants SET name='Synthetic native client business' WHERE id='"+tenant+"';UPDATE paige_invoices SET billing_issued_at=coalesce(billing_issued_at,'2026-10-01T00:00:00Z'),billing_issued_snapshot_version=coalesce(billing_issued_snapshot_version,1),billing_document=coalesce(billing_document,'{}'::jsonb) WHERE id='"+invoice+"';");
 // Use the already-installed genuine PostgreSQL pgcrypto extension in the same
 // namespace as the deployed original query, ONLY inside the owned temporary DB.
 run("CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;");
 run(read('supabase/tests/fixtures/exp04_client_invoice_financial_facts.sql'));
 const query=(version=3,t=tenant,c=client,limit=20)=>"SELECT _client_portal_invoice_facts_for_client('"+t+"','"+c+"',"+limit+",NULL,'2026-11-01',"+(version===null?'NULL':version)+");";
 const point=(version=3)=>value(query(version));
 const safeClient='e044c203-0000-4000-8000-000000000001';
 // Dedicated transient CLIENT row only inside rollback; no new business/Auth identity.
 const safe=(version)=>value("BEGIN;INSERT INTO clients(id,tenant_id) VALUES('"+safeClient+"','"+tenant+"');UPDATE paige_invoices SET contact_id='"+safeClient+"',status='issued',billing_issued_at='2026-10-01',billing_issued_snapshot_version=1,billing_document='{}'::jsonb WHERE id='"+plain+"';"+query(version,tenant,safeClient)+"ROLLBACK;");
 const withoutClock=v=>Object.fromEntries(Object.entries(v).filter(([k])=>k!=='read_at'));
 const metadata=()=>run("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='_client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)'::regprocedure;");
 const wrapper=()=>run("SELECT to_jsonb(p)::text FROM pg_proc p WHERE oid='_client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)'::regprocedure;");
 const meta=metadata(),legacyWrapper=wrapper(),old=point(1),oldTwo=point(2),safeLegacy=safe(1),safeTwo=safe(2);
 assert.throws(()=>point(3),/CLIENT_INVOICE_INPUT_INVALID/);check('prior original query cannot express current adjustment evidence',true);
 const source=read('supabase/tests/fixtures/exp04_client_invoice_actual_financial_facts.sql');
 run('BEGIN;'+source+'COMMIT;');run('BEGIN;'+source+'COMMIT;');
 check('original six-argument OID metadata and private ACL retained',metadata()===meta);
 check('whole original five-argument adapter remains exact',wrapper()===legacyWrapper);
 assert.equal(safeLegacy.invoices.length,1);assert.deepEqual(withoutClock(safe(1)),withoutClock(safeLegacy));check('all accurate legacy fields except the actual read clock remain exact',true);
 assert.deepEqual(withoutClock(safe(2)),withoutClock(safeTwo));check('accurate explicit2 fields keep their original semantics and source identity',true);
 const current=point(),row=current.invoices.find(r=>r.id===invoice);
 const summary=value("SELECT _sales_invoice_read('"+tenant+"','"+invoice+"',0,3)->'financial_summary';");
 check('same original client and invoice remain present',current.tenant_id===tenant&&current.invoice_count===old.invoice_count&&!!row);
 check('explicit current representation retains independent TEST evidence',current.payment_evidence_version===2&&current.financial_evidence_version===3&&row.test_provider_minor===String(summary.test_provider_minor));
 assert.equal(row.remaining_minor,String(summary.outstanding_minor));check('current outstanding copies the canonical native summary',row.remaining_minor==='210000');
 check('refund and credit are separate canonical customer facts',row.refund_payable_minor==='15000'&&row.credit_minor==='20000'&&row.provider_net_minor===String(summary.provider_net_minor));
 assert.deepEqual(current.invoices.map(r=>r.id).sort(),old.invoices.map(r=>r.id).sort());
 check('every same-client source member remains, not just the selected invoice',current.invoices.length>1);
 // Independent native per-invoice oracle; never derive expectations from the new client DTO.
 const original=current.invoices.map(r=>({status:r.status,summary:value("SELECT _sales_invoice_read('"+tenant+"','"+r.id+"',0,3)->'financial_summary';")}));
 for(const balance of current.balances){
  const rows=original.filter(r=>r.status!=='void'&&r.summary.currency===balance.currency),known=rows.every(r=>r.summary.standing==='recorded');
  for(const[key,sourceKey]of [['remaining_minor','outstanding_minor'],['refund_payable_minor','refund_payable_minor'],['credit_minor','credit_minor'],['provider_net_minor','provider_net_minor']]){
   const expected=known?String(rows.reduce((n,r)=>n+r.summary[sourceKey],0)):null;
   assert.equal(balance[key],expected,'canonical currency '+key);
  }
 }
 check('all currency totals copy native adjusted facts and preserve any unknownness',true);
 check('current source has a genuine causal difference from older gross facts',old.invoices.find(r=>r.id===invoice).remaining_minor!==row.remaining_minor||oldTwo.invoices.find(r=>r.id===invoice).remaining_minor!==row.remaining_minor);
 assert.throws(()=>point(1),/CLIENT_INVOICE_FINANCIAL_VIEW_CHANGED/);assert.throws(()=>point(2),/CLIENT_INVOICE_FINANCIAL_VIEW_CHANGED/);check('wrong older money representations refuse instead of claiming current debt',true);
 const unknown=value("BEGIN;UPDATE tenant_client_agreements SET status='inactive' WHERE id=(SELECT commercial_terms_id FROM paige_agreements WHERE id=(SELECT (billing_draft#>>'{agreement_snapshot,id}')::uuid FROM paige_invoices WHERE id='"+invoice+"'));"+query()+"ROLLBACK;");
 const held=unknown.invoices.find(r=>r.id===invoice);check('held original source keeps the invoice without a fabricated zero or payment link',held.remaining_minor===null&&held.payable===false&&held.past_due===null&&unknown.open_count===null);
 check('held currency totals never silently omit unknown debt',unknown.balances.find(b=>b.currency===row.currency).remaining_minor===null&&unknown.balances.find(b=>b.currency===row.currency).refund_payable_minor===null&&unknown.balances.find(b=>b.currency===row.currency).provider_net_minor===null);
 const voided=value("BEGIN;UPDATE paige_invoices SET status='void' WHERE id='"+invoice+"';"+query()+"ROLLBACK;");
 const voidRow=voided.invoices.find(r=>r.id===invoice);check('void status remains separate from paid and excludes current obligations',voidRow.status==='void'&&voidRow.remaining_minor===null&&voidRow.financial_standing==='not_applicable'&&voidRow.payable===false&&voidRow.past_due===false);
 check('trusted private client filter does not broaden to another client',value(query(3,tenant,'ffffffff-ffff-4fff-8fff-ffffffffffff')).invoices.length===0);
 for(const version of [null,0,4]){assert.throws(()=>point(version),/CLIENT_INVOICE_INPUT_INVALID/);check('invalid direct representation refused '+version,true);}
 for(const mutation of ["GRANT EXECUTE ON FUNCTION _client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer) TO authenticated;","ALTER FUNCTION _client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer) STABLE;","GRANT EXECUTE ON FUNCTION _sales_invoice_read(uuid,uuid,integer,integer) TO service_role;"]){
  assert.throws(()=>run('BEGIN;'+mutation+source+'ROLLBACK;'),/source\/authority changed|requires reconciliation/);check('authority or source drift refuses installation',true);
 }
 const after=point();assert.deepEqual(withoutClock(after),withoutClock(current));assert(Number.isFinite(Date.parse(after.read_at))&&Date.parse(after.read_at)>=Date.parse(current.read_at));check('rollback/refusal retain financial/source facts while the genuine read clock advances',true);
 return{proof:'E04_ACTUAL_CLIENT_FINANCIAL_QUERY',status:'PASS',checks,sample:current,source_hashes:Object.fromEntries(['scripts/sql/sales-actual-client-financial-read-proof.mjs','supabase/tests/fixtures/exp04_client_invoice_actual_financial_facts.sql'].map(f=>[f,createHash('sha256').update(read(f)).digest('hex')])),boundary:'Original current financial engine and private client query; synthetic selected schema/identity/signing/provider ports and direct-owner execution; genuine local pgcrypto in the deployed namespace. No public resolver/Auth/calendar transport/Portal/provider/customer acceptance.'};
}
