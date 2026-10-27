import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model.ts';

/** Additional assertions in the ORIGINAL fenced signing/effectuation runner.
 * Real native functions/operations; synthetic identity and file metadata only.
 * Does not establish hosted authorization, actual consent, PDF seal or settlement.
 */
export async function proveAcceptedCollectionSource({sql,read,quote,tenant,actor,c,prepared}){
 const json=q=>JSON.parse(sql(q));
 const literal=v=>quote(JSON.stringify(v))+'::jsonb';
 let checks=0;const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
 const source=c.p.source.agreement_id;
 // Complete the incumbent reduced document fixture's unused Collections columns.
 sql(`ALTER TABLE tenant_client_agreements ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS created_by uuid,ADD COLUMN IF NOT EXISTS billing_interval text,
  ADD COLUMN IF NOT EXISTS interval_count integer,ADD COLUMN IF NOT EXISTS payment_schedule text,
  ADD COLUMN IF NOT EXISTS renews_on date,ADD COLUMN IF NOT EXISTS catalog_price_snapshot_kind text;`);
 const collections=read('supabase/migrations/20270547000000_sales_collections.sql');
 const clientStart=collections.indexOf('CREATE OR REPLACE FUNCTION public._sales_collection_client_name(');
 const listEnd=collections.indexOf('TO authenticated;',clientStart)+'TO authenticated;'.length;
 assert(clientStart>=0&&listEnd>clientStart);sql(collections.slice(clientStart,listEnd));
 sql(read('supabase/migrations/20271118100104_sales_collection_amount_basis.sql'));
 const predecessor=json(`SET test.uid='${actor}';SET test.tenant='${tenant}';SET ROLE authenticated;SELECT list_sales_collection_agreements('${tenant}');`);
 equal(predecessor.rows.find(row=>row.id===c.terms)?.agreed_amount_basis,'unverified','Predecessor read cannot yet use original accepted/effective provenance');
 sql(read('supabase/migrations/20271118100204_sales_collection_fixed_source_guard.sql'));
 const evidenceMode=process.argv.includes('--accepted-total-evidence');
 const evidenceProof=evidenceMode?await(await import('./collection-total-evidence-proof.mjs')).proveCollectionTotalEvidence({sql,read,quote,tenant,actor,c}):null;
 checks+=evidenceProof?.checks??0;
 const basis=()=>sql(`SELECT _sales_collection_amount_basis(t) FROM tenant_client_agreements t WHERE id='${c.terms}';`);
 equal(sql(`SELECT count(*) FROM paige_sales_collection_operations WHERE command->>'action'='collection.create_commercial_terms' AND result#>>'{row,id}'='${c.terms}';`),'0','Original legacy signing fixture has no later fixed-creation receipt');
 const accepted=()=>json(`SELECT _paige_accepted_commercial_payload(a) FROM paige_agreements a WHERE id='${source}';`);
 equal(accepted(),prepared.payload,'Original accepted payload is still authoritative');
 equal(basis(),'total','A genuine original accepted/effective negotiated principal remains a fixed total without a later creation receipt');
 const originalProvenance=json(`SELECT jsonb_build_object('signing_id',effective_signing_id,'terms_version',effective_terms_version,'operation_id',effective_operation_id,'digest',effective_source_digest) FROM tenant_client_agreements WHERE id='${c.terms}';`);
 const mutationBasis=patch=>sql(`BEGIN;SET LOCAL session_replication_role=replica;${patch}SELECT _sales_collection_amount_basis(t) FROM tenant_client_agreements t WHERE id='${c.terms}';ROLLBACK;`);
 // Rollback-only corruptions bypass fixture triggers solely to exercise missing or
 // contradictory evidence. Actual source/effectuation guards stay installed.
 for(const patch of [
  `UPDATE tenant_client_agreements SET agreed_amount_minor=350001 WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET agreed_currency='eur' WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET contact_id='c2222222-0000-4000-8000-000000000002' WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET offer_id='${randomUUID()}' WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET tenant_id='bbbbbbbb-0000-4000-8000-000000000002' WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET effective_operation_id='${randomUUID()}' WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET effective_signing_id='${randomUUID()}' WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET effective_source_digest=repeat('f',64) WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET effective_terms_version=999 WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET effective_at=NULL,effective_signing_id=NULL,effective_terms_version=NULL,effective_operation_id=NULL,effective_source_digest=NULL WHERE id='${c.terms}';`,
  `UPDATE paige_agreements SET status='voided' WHERE id='${source}';`,
  `UPDATE paige_agreement_signers SET status='viewed' WHERE agreement_id='${source}';`,
  `DELETE FROM paige_agreement_events WHERE agreement_id='${source}' AND event_type='consented';`,
  `UPDATE paige_agreements SET sealed_sha256=repeat('e',64) WHERE id='${source}';`,
  `DELETE FROM paige_workspace_events WHERE source_id='${originalProvenance.operation_id}';`,
  `UPDATE paige_sales_collection_operations SET result=jsonb_set(result,'{row,tenant_id}',to_jsonb('bbbbbbbb-0000-4000-8000-000000000002'::text)) WHERE id='${originalProvenance.operation_id}';`,
  `UPDATE paige_sales_collection_operations SET command=jsonb_set(command,'{invoice_id}',to_jsonb('${randomUUID()}'::text)) WHERE id='${originalProvenance.operation_id}';`,
  `UPDATE paige_sales_collection_operations SET command=jsonb_set(command,'{expected_updated_at}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id='${originalProvenance.operation_id}';`,
 ])equal(mutationBasis(patch),'unverified','Changed/missing accepted evidence must not establish a total: '+patch);
 assert.throws(()=>mutationBasis(`UPDATE tenant_client_agreements SET effective_at=NULL WHERE id='${c.terms}';`),/23514:.*e04_effective_provenance_complete/);checks++;
 equal(mutationBasis(`UPDATE tenant_client_agreements SET term_kind='recurring' WHERE id='${c.terms}';`),'per_cycle','Old acceptance never makes a current recurring amount a finite principal');
 for(const kind of ['deposit','custom_quote']){
  equal(mutationBasis(`UPDATE tenant_client_agreements SET term_kind='${kind}' WHERE id='${c.terms}';`),evidenceMode?'total':'unverified','Additional finite kind requires the separate matched-evidence contract for '+kind);
  equal(mutationBasis(`UPDATE tenant_client_agreements SET term_kind='${kind}',effective_at=NULL,effective_signing_id=NULL,effective_terms_version=NULL,effective_operation_id=NULL,effective_source_digest=NULL WHERE id='${c.terms}';`),'unverified','No total inference without original accepted/effective evidence for '+kind);
 }
 equal(mutationBasis(`UPDATE tenant_client_agreements SET price_basis='catalog',catalog_price_snapshot_kind='installment' WHERE id='${c.terms}';`),'per_installment','Catalogue price retains its original per-payment meaning');
 equal(mutationBasis(`UPDATE tenant_client_agreements SET starts_on=starts_on+1,ends_on='2027-12-01',billing_interval='month',interval_count=2,installments_total=12,payment_schedule='custom',collection_terms_version=collection_terms_version+1 WHERE id='${c.terms}';`),'total','Later draft timing/schedule revisions do not erase proof of unchanged original principal');
 const preview=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-11-01',installment_cents:30000,first_installment_date:'2026-12-01',cadence:'monthly'});
 equal(preview.state,'ready','Reuse the original fixed calculation');
 const command={action:'collection.save_terms',agreement_id:c.terms,expected_version:prepared.payload.source.terms_version,terms:preview.terms};
 const governance={actor_user_id:actor,tenant_id:tenant,tool:'sales_save_collection_terms',action:command.action,approval_channel:'operator_card',approved_fingerprint:'a'.repeat(16),decision_receipt_recorded:true};
 const scope=`SET test.uid='${actor}';SET test.tenant='${tenant}';SET test.admin='true';SET test.member='true';SET ROLE service_role;`;
 equal(json(scope+`SELECT preview_sales_collection_command('${actor}','${tenant}',${literal(command)});`).eligible,true,'Original guarded preview permits an evidenced unchanged principal');
 const counts=()=>json('SELECT jsonb_build_object(\'operations\',(SELECT count(*) FROM paige_sales_collection_operations),\'receipts\',(SELECT count(*) FROM paige_workspace_events),\'signing_events\',(SELECT count(*) FROM paige_agreement_events),\'invoices\',(SELECT count(*) FROM paige_invoices),\'payments\',(SELECT count(*) FROM paige_invoice_payments));');
 const before=counts(),id=randomUUID();
 const save=()=>json(scope+`SELECT execute_sales_collection_command('${actor}','${tenant}','${id}',${literal(command)},${literal(governance)});`);
 const saved=save();equal(saved.ok,true,'Canonical save succeeds, with no alternate writer');
 equal(saved.row.collection_terms_version,command.expected_version+1,'Draft schedule advances once');
 equal(save(),saved,'Exact save retry returns original result without duplicate effect');
 equal(counts(),{...before,operations:before.operations+1,receipts:before.receipts+1},'Only original save operation/Rail are added; no invoice/payment/signature/event is created');
 equal(accepted(),prepared.payload,'Original accepted document/economics remain unchanged after draft correction');
 equal(json(`SELECT jsonb_build_object('signing_id',effective_signing_id,'terms_version',effective_terms_version,'operation_id',effective_operation_id,'digest',effective_source_digest) FROM tenant_client_agreements WHERE id='${c.terms}';`),originalProvenance,'Draft schedule is not newly signed or effectuated');
 equal(basis(),'total','Later-session source read retains the original principal meaning');
 const page=json(`SET test.uid='${actor}';SET test.tenant='${tenant}';SET ROLE authenticated;SELECT list_sales_collection_agreements('${tenant}');`);
 equal(page.rows.find(row=>row.id===c.terms)?.agreed_amount_basis,'total','Original scoped mounted-UI reader receives the same meaning');
 return {checks,evidenceProof,scope:'Original accepted payload/effectuation and governed draft save; synthetic authority and metadata files, no hosted signing or financial effect'};
}
