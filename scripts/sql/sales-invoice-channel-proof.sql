RESET ROLE;
CREATE FUNCTION proof_sms(op integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT prepare_sales_invoice_channel_delivery('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000091',5,('70000000-0000-0000-0000-'||lpad(op::text,12,'0'))::uuid,NULL,'Invoice','View {{PAIGE_INVOICE_LINK}}',encode(extensions.digest(convert_to('Invoice'||E'\n'||'View {{PAIGE_INVOICE_LINK}}'||E'\n'||billing_document_digest||E'\n'||billing_issued_snapshot_version::text,'UTF8'),'sha256'),'hex'),proof_governance('invoice.sms_send','billing_send_invoice'),'sms') FROM paige_invoices WHERE id='60000000-0000-0000-0000-000000000091'
$$;
GRANT USAGE ON SCHEMA extensions TO service_role;
GRANT EXECUTE ON FUNCTION proof_sms(integer) TO service_role;
SET LOCAL test.actor='';
SET LOCAL ROLE service_role;
CREATE TEMP TABLE sms_result AS SELECT proof_sms(210) result;
SELECT proof_assert((SELECT result->>'recipient' FROM sms_result)='+12025550123','SMS derives frozen recipient');
SELECT proof_assert(proof_sms(210)->>'replayed'='true','SMS exact operation replay');
SELECT proof_assert((SELECT result->>'message_id' FROM sms_result)=(SELECT proof_sms(210)->>'message_id'),'same message survives recovery');
CREATE TEMP TABLE sms_second AS SELECT proof_sms(211) result;
SELECT proof_assert(claim_sales_invoice_delivery((SELECT (result->>'message_id')::uuid FROM sms_result),'70000000-0000-0000-0000-000000000210','90000000-0000-0000-0000-000000000210',repeat('b',64),now()+interval '1 day')->>'state'='dispatching','SMS admits one provider attempt');
SELECT proof_denied($q$SELECT claim_sales_invoice_delivery((SELECT (result->>'message_id')::uuid FROM sms_second),'70000000-0000-0000-0000-000000000211','90000000-0000-0000-0000-000000000211',repeat('c',64),now()+interval '1 day')$q$,'42501','cross-operation SMS claim refused');
-- Payment inserts and invoice lifecycle updates cannot invalidate a claimed PDF.
SELECT proof_denied($q$SELECT proof_command(220,'{"action":"invoice.record_manual_payment","expected_version":5,"amount_cents":100,"currency":"usd","method":"cash","received_at":"2026-10-04T12:00:00Z"}','sales_record_manual_payment')$q$,'P5501','receipt blocked while dispatching');
SELECT proof_denied($q$SELECT proof_command(221,'{"action":"invoice.reverse_manual_payment","expected_version":5,"payment_id":"70000000-0000-0000-0000-000000000104","reason":"Correction"}','sales_reverse_manual_payment')$q$,'P5501','correction blocked while dispatching');
SELECT proof_denied($q$SELECT proof_command(222,'{"action":"invoice.void","expected_version":5,"reason":"Cancel"}','sales_void_invoice')$q$,'P5501','void blocked while dispatching');
RESET ROLE;
SELECT proof_assert((SELECT billing_lifecycle_version=5 FROM paige_invoices WHERE id='60000000-0000-0000-0000-000000000091'),'claimed version remains unchanged');
SELECT proof_assert(NOT EXISTS(SELECT 1 FROM paige_invoice_payments WHERE id IN ('70000000-0000-0000-0000-000000000220','70000000-0000-0000-0000-000000000221')),'refused receipts have no side effects');
SET LOCAL ROLE service_role;
SELECT finalize_sales_invoice_delivery((SELECT (result->>'message_id')::uuid FROM sms_result),'70000000-0000-0000-0000-000000000210','unknown',NULL,'not persisted');
SELECT proof_denied($q$SELECT proof_sms(212)$q$,'55000','unknown SMS prevents fresh operation bypass');
RESET ROLE;
SELECT proof_assert((SELECT body_html IS NULL AND body_text='View {{PAIGE_INVOICE_LINK}}' AND connector_id IS NULL AND recipients->0->>'address'='+12025550123' AND position('?token=' in meta::text)=0 FROM messages WHERE id=(SELECT (result->>'message_id')::uuid FROM sms_result)),'SMS durable content token-free and client snapshot exact');


SET LOCAL ROLE service_role;
SELECT proof_assert(proof_command(223,'{"action":"invoice.record_manual_payment","expected_version":5,"amount_cents":100,"currency":"usd","method":"cash","received_at":"2026-10-04T12:00:00Z"}','sales_record_manual_payment')#>>'{row,remaining_cents}'='300','finalized unknown releases financial mutation without claiming delivery');
RESET ROLE;
