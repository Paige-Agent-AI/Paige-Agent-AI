RESET ROLE;
CREATE FUNCTION proof_governance(action text,tool text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('actor_user_id','10000000-0000-0000-0000-000000000001','tenant_id','20000000-0000-0000-0000-000000000001','action',action,'tool',tool,'approval_channel','operator_card','approved_fingerprint','0123456789abcdef','decision_receipt_recorded',true)
$$;
GRANT EXECUTE ON FUNCTION proof_governance(text,text) TO service_role;
SET LOCAL ROLE authenticated;
SELECT proof_denied($q$SELECT execute_sales_invoice_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000101','{}','{}')$q$,'42501','browser cannot bypass canonical command');
SET LOCAL ROLE service_role;
SELECT proof_denied($q$SELECT _sales_invoice_governance('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','invoice.publish','sales_publish_invoice',proof_governance('invoice.publish','sales_publish_invoice')||'{"approval_channel":"standing_autonomy_setting"}')$q$,'42501','high action refuses standing authority');
CREATE TEMP TABLE issued_result AS SELECT execute_sales_invoice_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000101','{"action":"invoice.publish","invoice_id":"60000000-0000-0000-0000-000000000091","expected_version":1}',proof_governance('invoice.publish','sales_publish_invoice')) result;
SELECT proof_assert((SELECT result#>>'{row,status}' FROM issued_result)='issued','publication real issued readback');
SELECT proof_assert((SELECT result FROM issued_result)=execute_sales_invoice_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000101','{"action":"invoice.publish","invoice_id":"60000000-0000-0000-0000-000000000091","expected_version":1}',proof_governance('invoice.publish','sales_publish_invoice')),'publication exact replay');
RESET ROLE;
SELECT proof_assert((SELECT count(*) FROM paige_workspace_events WHERE source_id='70000000-0000-0000-0000-000000000101')=1,'one durable canonical Rail fact');
CREATE FUNCTION proof_command(op integer,command jsonb,tool text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT execute_sales_invoice_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',('70000000-0000-0000-0000-'||lpad(op::text,12,'0'))::uuid,command||'{"invoice_id":"60000000-0000-0000-0000-000000000091"}',proof_governance(command->>'action',tool))
$$;
GRANT EXECUTE ON FUNCTION proof_command(integer,jsonb,text) TO service_role;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE partial_result AS SELECT proof_command(102,'{"action":"invoice.record_manual_payment","expected_version":2,"amount_cents":400,"currency":"usd","method":"cash","received_at":"2026-10-01T12:00:00Z","reference":"Owner receipt"}','sales_record_manual_payment') result;
SELECT proof_assert((SELECT result#>>'{row,remaining_cents}' FROM partial_result)='600','partial receipt reduces balance');
SELECT proof_assert((SELECT result#>>'{row,settlement}' FROM partial_result)='manually_recorded_partial','partial truth label');
SELECT proof_assert((SELECT result FROM partial_result)=proof_command(102,'{"action":"invoice.record_manual_payment","expected_version":2,"amount_cents":400,"currency":"usd","method":"cash","received_at":"2026-10-01T12:00:00Z","reference":"Owner receipt"}','sales_record_manual_payment'),'receipt exact replay before changed balance');
SELECT proof_denied($q$SELECT proof_command(103,'{"action":"invoice.record_manual_payment","expected_version":3,"amount_cents":601,"currency":"usd","method":"wire","received_at":"2026-10-01T12:00:00Z"}','sales_record_manual_payment')$q$,'22023','overpayment refused');
SELECT proof_assert(proof_command(104,'{"action":"invoice.record_manual_payment","expected_version":3,"amount_cents":600,"currency":"usd","method":"wire","received_at":"2026-10-01T12:00:00Z"}','sales_record_manual_payment')#>>'{row,settlement}'='manually_recorded_settled','full manually recorded settlement');
SELECT proof_assert(proof_command(105,'{"action":"invoice.reverse_manual_payment","expected_version":4,"payment_id":"70000000-0000-0000-0000-000000000102","reason":"Correct mistaken receipt"}','sales_reverse_manual_payment')#>>'{row,remaining_cents}'='400','reversal restores balance');
SELECT proof_denied($q$SELECT proof_command(106,'{"action":"invoice.reverse_manual_payment","expected_version":5,"payment_id":"70000000-0000-0000-0000-000000000102","reason":"Duplicate"}','sales_reverse_manual_payment')$q$,'22023','receipt cannot reverse twice');
RESET ROLE;
SELECT proof_assert((SELECT paid_at IS NULL AND status='issued' AND amount_total_cents=1000 FROM paige_invoices WHERE id='60000000-0000-0000-0000-000000000091'),'manual settlement preserves original obligation/provider fields');
SELECT proof_denied($q$UPDATE paige_invoice_payments SET reference='Erased history'$q$,'42501','receipt immutable');
UPDATE profiles SET active_tenant_id='20000000-0000-0000-0000-000000000002';
SET LOCAL ROLE service_role;
SELECT proof_denied($q$SELECT _sales_invoice_actor('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')$q$,'42501','workspace switch after edge refused');
RESET ROLE;
UPDATE profiles SET active_tenant_id='20000000-0000-0000-0000-000000000001';
INSERT INTO channel_connectors VALUES('80000000-0000-0000-0000-000000000101','20000000-0000-0000-0000-000000000001',true,'active','email','resend','business@example.test');
INSERT INTO channel_connectors VALUES
 ('80000000-0000-0000-0000-000000000102','20000000-0000-0000-0000-000000000001',false,'active','email','gmail','inactive@example.test'),
 ('80000000-0000-0000-0000-000000000103','20000000-0000-0000-0000-000000000001',true,'active','email','smtp',' '),
 ('80000000-0000-0000-0000-000000000104','20000000-0000-0000-0000-000000000001',true,'active','sms','resend','sms@example.test'),
 ('80000000-0000-0000-0000-000000000105','20000000-0000-0000-0000-000000000002',true,'active','email','resend','foreign@example.test');
SET LOCAL test.actor='10000000-0000-0000-0000-000000000001';
SET LOCAL test.workspace='20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT proof_assert(jsonb_array_length(list_sales_invoice_senders('20000000-0000-0000-0000-000000000001'))=1,'sender list excludes foreign inactive blank and non-email');
SELECT proof_denied($q$SELECT list_sales_invoice_senders('20000000-0000-0000-0000-000000000002')$q$,'42501','sender list workspace fence');
SELECT proof_denied($q$SELECT list_sales_invoices('20000000-0000-0000-0000-000000000001',NULL,NULL)$q$,'22023','null list limit refused');
SELECT proof_denied($q$SELECT list_sales_invoices('20000000-0000-0000-0000-000000000001',51,NULL)$q$,'22023','51 list limit refused');
SET LOCAL ROLE anon;
SELECT proof_denied($q$SELECT list_sales_invoice_senders('20000000-0000-0000-0000-000000000001')$q$,'42501','anonymous sender read denied');
RESET ROLE;
UPDATE tenant_members SET role='member';
SET LOCAL ROLE authenticated;
SELECT proof_denied($q$SELECT list_sales_invoice_senders('20000000-0000-0000-0000-000000000001')$q$,'42501','member sender read denied');
RESET ROLE;
UPDATE tenant_members SET role='owner';
UPDATE auth.users SET deleted_at=now();
SELECT proof_denied($q$SELECT _sales_invoice_actor('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')$q$,'42501','deleted actor denied');
UPDATE auth.users SET deleted_at=NULL,banned_until=now()+interval '1 day';
SELECT proof_denied($q$SELECT _sales_invoice_actor('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')$q$,'42501','banned actor denied');
UPDATE auth.users SET banned_until=NULL;
UPDATE tenants SET status='suspended';
SELECT proof_denied($q$SELECT _sales_invoice_actor('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')$q$,'42501','suspended workspace denied');
UPDATE tenants SET status='active';
SELECT proof_denied($q$INSERT INTO paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result) VALUES('70000000-0000-0000-0000-000000000199','20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000001','{}','{}')$q$,'23503','child composite tenant invoice integrity');
CREATE FUNCTION proof_delivery(op integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT prepare_sales_invoice_delivery('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000091',5,('70000000-0000-0000-0000-'||lpad(op::text,12,'0'))::uuid,'80000000-0000-0000-0000-000000000101','Invoice','<p>{{PAIGE_INVOICE_LINK}}</p>',encode(extensions.digest(convert_to('Invoice'||E'\n'||'<p>{{PAIGE_INVOICE_LINK}}</p>'||E'\n'||billing_document_digest||E'\n'||billing_issued_snapshot_version::text,'UTF8'),'sha256'),'hex'),proof_governance('invoice.email_send','billing_send_invoice')) FROM paige_invoices WHERE id='60000000-0000-0000-0000-000000000091'
$$;
-- Fixture wrapper reads canonical document only to build the service-bound digest.
GRANT USAGE ON SCHEMA extensions TO service_role;
GRANT EXECUTE ON FUNCTION proof_delivery(integer) TO service_role;
SET LOCAL test.actor='';
SET LOCAL ROLE service_role;
CREATE TEMP TABLE delivery_result AS SELECT proof_delivery(110) result;
CREATE TEMP TABLE second_delivery_result AS SELECT proof_delivery(111) result;
SELECT proof_assert((SELECT result->>'state' FROM delivery_result)='prepared','actual token-free delivery prepared');
SELECT proof_assert(proof_delivery(110)->>'replayed'='true','delivery prepare exact replay');
SELECT proof_denied($q$SELECT proof_delivery(101)$q$,'22023','email cannot reuse lifecycle operation');
SELECT proof_denied($q$SELECT proof_command(110,'{"action":"invoice.void","expected_version":5,"reason":"Collision"}','sales_void_invoice')$q$,'22023','lifecycle cannot reuse email operation');
SELECT proof_assert(claim_sales_invoice_delivery((SELECT (result->>'message_id')::uuid FROM delivery_result),'70000000-0000-0000-0000-000000000110','90000000-0000-0000-0000-000000000110',repeat('b',64),now()+interval '1 day')->>'state'='dispatching','single provider admission');
SELECT proof_denied($q$SELECT claim_sales_invoice_delivery((SELECT (result->>'message_id')::uuid FROM delivery_result),'70000000-0000-0000-0000-000000000110','90000000-0000-0000-0000-000000000111',repeat('c',64),now()+interval '1 day')$q$,'42501','second provider claimant refused');
SELECT proof_denied($q$SELECT claim_sales_invoice_delivery((SELECT (result->>'message_id')::uuid FROM second_delivery_result),'70000000-0000-0000-0000-000000000111','90000000-0000-0000-0000-000000000112',repeat('d',64),now()+interval '1 day')$q$,'42501','other prepared operation blocked by unresolved provider attempt');
SELECT finalize_sales_invoice_delivery((SELECT (result->>'message_id')::uuid FROM delivery_result),'70000000-0000-0000-0000-000000000110','unknown',NULL,'Ambiguous network');
SELECT proof_denied($q$SELECT proof_delivery(112)$q$,'55000','unknown delivery blocks new operation bypass');
SELECT proof_assert(read_public_sales_invoice(repeat('b',64))->>'remaining_cents'='400','public token reads aggregate balance');
RESET ROLE;
SELECT proof_assert((SELECT body_html='<p>{{PAIGE_INVOICE_LINK}}</p>' AND position('?token=' in meta::text)=0 FROM messages WHERE id=(SELECT (result->>'message_id')::uuid FROM delivery_result)),'no durable bearer token');
