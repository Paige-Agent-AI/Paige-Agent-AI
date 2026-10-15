import assert from 'node:assert/strict';

/** Runs ONLY inside commercial-presentation-pg's checked, unique disposable DB.
 * Load real canonical balance/package/receipt bodies; do not replace them with
 * synthetic totals or a second ledger. PDF hashes remain synthetic metadata.
 */
export async function proveAcceptedCommercialRecord({sql,read,scope,tenant,actor,client,offer,termsId,invoiceId,agreementId,prepared,input,presented,migration}){
 let checks=0;
 const extract=(source,name)=>{const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=source.indexOf('END $$;',start);assert(start>=0&&end>start,name);return source.slice(start,end+7);};
 sql(`ALTER TABLE profiles ADD COLUMN full_name text;
  ALTER TABLE clients ADD COLUMN entity_name text,ADD COLUMN entity_type text;
  ALTER TABLE paige_invoices ADD COLUMN invoice_number text DEFAULT 'SYN-1',ADD COLUMN amount_total_cents integer DEFAULT 350000,
    ADD COLUMN billing_issued_snapshot_version bigint,ADD COLUMN billing_issued_at timestamptz,ADD COLUMN billing_issued_by uuid,
    ADD COLUMN billing_document jsonb,ADD COLUMN billing_document_digest text,ADD COLUMN due_date date,
    ADD COLUMN billing_import_version bigint,ADD COLUMN billing_import_provenance jsonb,ADD COLUMN created_at timestamptz DEFAULT now();
  CREATE TABLE paige_invoice_payments(id uuid PRIMARY KEY,tenant_id uuid,invoice_id uuid,actor_user_id uuid,kind text,amount_cents integer,currency text,method text,received_at timestamptz,created_at timestamptz DEFAULT now(),reverses_payment_id uuid,import_provenance jsonb,evidence_kind text,provider text,provider_environment text,provider_verified_at timestamptz,reference text,notes text,reason text);
  CREATE TABLE paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT clock_timestamp(),actor_agent_slug text,actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
  CREATE TABLE paige_subagents(slug text,tenant_id uuid,rail_display_name text);CREATE SCHEMA realtime;
  CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
  UPDATE tenant_client_agreements SET collection_terms_version=1,agreed_amount_minor=350000,agreed_currency='usd' WHERE id='${termsId}';
  UPDATE paige_invoices SET billing_draft=billing_draft||jsonb_build_object('agreement_id','${agreementId}','delivery_channel_intents',jsonb_build_array('email')) WHERE id='${invoiceId}';`);
 const lifecycle=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql');
 sql(extract(lifecycle,'_sales_invoice_read').replace('public._sales_invoice_read(','public._sales_invoice_read_before_provider('));
 const balance=read('supabase/migrations/20270601000002_sales_performance_contract.sql');
 const balanceStart=balance.indexOf('CREATE OR REPLACE FUNCTION public._sales_invoice_balance_rows(');
 sql(balance.slice(balanceStart,balance.indexOf('$$;',balanceStart)+3)+extract(balance,'_sales_invoice_read'));
 sql(extract(read('supabase/migrations/20270547000000_sales_collections.sql'),'_sales_collection_validate_terms'));
 const rail12=read('supabase/migrations/20261212000000_paige_can_show_her_work.sql'),rail20=read('supabase/migrations/20261220000000_an_act_that_landed_but_was_not_recorded.sql');
 sql(extract(rail20,'_workspace_event_display')+extract(rail12,'_record_workspace_rail_event')+extract(rail20,'record_capability_run'));
 sql(read('supabase/migrations/20270598000001_sales_commercial_package_read.sql'));
 const conditions=read('supabase/migrations/20270601000009_sales_commercial_conditions.sql');
 const conditionsRead=conditions.indexOf('-- Only the existing read projection changes.');assert(conditionsRead>0);sql(conditions.slice(conditionsRead));
 const reference=read('supabase/migrations/20270601000013_sales_invoice_terms_reference.sql');
 sql(extract(reference,'_sales_invoice_terms_reference_shape'));
 const referenceRead=reference.indexOf("DO $$ DECLARE body text; prior text; BEGIN\n body:=pg_get_functiondef('public.read_sales_commercial_package");assert(referenceRead>0);sql(reference.slice(referenceRead));
 const call=`SELECT read_sales_accepted_agreement('${tenant}','${invoiceId}','${agreementId}');`;
 const owner=(prefix='')=>JSON.parse(sql(prefix+scope+'SET ROLE authenticated;'+call));
 const pkg=(prefix='')=>JSON.parse(sql(prefix+scope+`SET ROLE authenticated;SELECT read_sales_commercial_package('${tenant}','${invoiceId}');`));
 assert.throws(()=>owner(),/42883/);checks++;
 sql(read(migration));sql(read(migration));
 const signing=JSON.parse(sql("SET ROLE anon;SELECT row_to_json(p) FROM peek_agreement_signing(repeat('e',64)) p;"));
 assert.equal(signing.is_valid,true);checks++;assert.equal(signing.amount_minor,350000);checks++;
 assert.equal(owner().state,'unverified');checks++;
 const signers=JSON.parse(sql(`SELECT json_agg(id ORDER BY signing_order) FROM paige_agreement_signers WHERE agreement_id='${agreementId}';`));
 assert(signers.length>0);
 for(const signer of signers)sql(`UPDATE paige_agreement_signers SET status='signed',signed_at=now(),typed_name='Synthetic signer',esign_consent_at=now(),esign_consent_slug='synthetic-consent',esign_consent_version=1,esign_consent_sha256=repeat('c',64) WHERE id='${signer}';`);
 assert.equal(owner().state,'unverified');checks++;
 sql(`UPDATE paige_agreements SET status='completed',completed_at=now(),sealed_sha256=repeat('b',64),sealed_storage_key='${tenant}/${agreementId}/sealed-synthetic.pdf' WHERE id='${agreementId}';`);
 const accepted=owner();assert.equal(accepted.state,'recorded');checks++;
 assert.deepEqual(accepted.payload,prepared.payload);checks++;
 assert.equal(accepted.presented_body_markdown,presented);checks++;
 assert.equal(accepted.body_markdown,input.body_markdown);checks++;
 assert.equal(accepted.payload_digest,prepared.payload_digest);checks++;
 assert(!JSON.stringify(accepted).includes('storage_key'));checks++;
 const result=pkg();assert.equal(result.compatibility.signed_economics,'recorded_immutable_presentation');checks++;
 assert(!result.missing_fields.includes('signed_terms_compatibility'));checks++;
 assert.equal(result.accepted_commercial_terms.principal_minor,350000);checks++;
 assert.deepEqual(result.accepted_commercial_terms.obligations.map(x=>x.amount_cents),[50000,...Array(10).fill(30000)]);checks++;
 assert.equal(result.invoice.outstanding_minor,350000);checks++;
 assert.equal(result.invoice.allocated_minor,0);checks++;
 assert(!JSON.stringify(result).includes(input.body_markdown));checks++;
 assert(!JSON.stringify(result).includes('storage_key'));checks++;
 assert.equal(sql(`SELECT status FROM tenant_client_agreements WHERE id='${termsId}';`),'draft');checks++;
 const again=owner();assert.deepEqual(again.payload,accepted.payload);checks++;
 assert.notEqual(again.receipt_id,accepted.receipt_id);checks++;
 const changed=pkg(`BEGIN;UPDATE tenant_client_agreements SET collection_terms_version=2,agreed_amount_minor=999900 WHERE id='${termsId}';`);
 assert.equal(changed.accepted_commercial_terms.principal_minor,350000);checks++;
 assert.equal(changed.commercial_terms.amount_minor,999900);checks++;
 assert(changed.conflicts.includes('accepted_commercial_terms_changed'));checks++;
 const invoiceChanged=pkg(`BEGIN;UPDATE paige_invoices SET billing_draft_version=2 WHERE id='${invoiceId}';`);
 assert(invoiceChanged.conflicts.includes('accepted_invoice_changed'));checks++;
 for(const mutation of [
  `UPDATE paige_agreements SET commercial_presentation=NULL WHERE id='${agreementId}';`,
  `UPDATE paige_agreements SET commercial_presentation=jsonb_set(commercial_presentation,'{payload_digest}',to_jsonb(repeat('d',64))) WHERE id='${agreementId}';`,
  `UPDATE paige_agreement_signers SET status='viewed' WHERE agreement_id='${agreementId}';`,
  `UPDATE paige_agreement_signers SET tenant_id='bbbbbbbb-0000-4000-8000-000000000002' WHERE agreement_id='${agreementId}';`,
 ]){assert.equal(owner('BEGIN;SET LOCAL session_replication_role=replica;'+mutation).state,'unverified');checks++;}
 for(const role of ['anon','service_role']){assert.throws(()=>sql(scope+`SET ROLE ${role};`+call),/42501/);checks++;}
 assert.throws(()=>owner(`BEGIN;UPDATE tenant_members SET role='member' WHERE user_id='${actor}';`),/42501/);checks++;
 assert.throws(()=>owner(`BEGIN;UPDATE profiles SET active_tenant_id='bbbbbbbb-0000-4000-8000-000000000002' WHERE user_id='${actor}';`),/42501/);checks++;
 assert.throws(()=>sql(scope+`SET ROLE authenticated;SELECT read_sales_accepted_agreement('${tenant}','${invoiceId}','00000000-0000-4000-8000-000000000001');`),/42501/);checks++;
 assert.equal(sql(`SELECT NOT has_function_privilege('authenticated','public._paige_retained_commercial_payload(public.paige_agreements)','EXECUTE') AND NOT has_function_privilege('anon','public._paige_accepted_commercial_payload(public.paige_agreements)','EXECUTE');`),'t');checks++;
 return checks;
}
