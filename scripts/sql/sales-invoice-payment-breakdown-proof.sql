-- Executes within the existing disposable canonical invoice proof transaction.
RESET ROLE;

SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true),set_config('test.workspace','20000000-0000-0000-0000-000000000001',true);
SET ROLE authenticated;
CREATE TEMP TABLE ledger_page1 AS SELECT read_sales_invoice_payment_ledger('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000091',1) result;
SELECT proof_assert((SELECT result#>>'{payment_ledger,count}' FROM ledger_page1)='3' AND (SELECT result->>'has_more' FROM ledger_page1)='true','ledger first page bounded with full canonical count');
SELECT proof_assert((SELECT result#>>'{payment_ledger,receipt_total_cents}' FROM ledger_page1)='1000' AND (SELECT result#>>'{payment_ledger,reversal_total_cents}' FROM ledger_page1)='400' AND (SELECT result->>'remaining_cents' FROM ledger_page1)='400','ledger totals include all receipts and corrections beyond page');
CREATE TEMP TABLE ledger_page2 AS SELECT read_sales_invoice_payment_ledger('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000091',100,(SELECT result->'next_cursor' FROM ledger_page1)) result;
SELECT proof_assert((SELECT jsonb_array_length(result#>'{payment_ledger,rows}') FROM ledger_page2)=2 AND (SELECT result->>'has_more' FROM ledger_page2)='false','ledger next page retrieves remaining canonical facts');
SELECT proof_assert((SELECT result#>>'{payment_ledger,rows,1,running_remaining_cents}' FROM ledger_page2)='400' AND (SELECT result#>>'{payment_ledger,rows,1,kind}' FROM ledger_page2)='reversal','last running balance accounts for correction');
SELECT proof_assert((SELECT result#>>'{payment_ledger,as_of}' FROM ledger_page1)=(SELECT result#>>'{payment_ledger,as_of}' FROM ledger_page2),'pages bind same canonical as-of');
SELECT proof_denied($q$SELECT read_sales_invoice_payment_ledger('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000091',NULL)$q$,'22023','NULL ledger limit refused');
SELECT proof_denied($q$SELECT read_sales_invoice_payment_ledger('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000091',101)$q$,'22023','unbounded ledger limit refused');
SELECT proof_denied($q$SELECT read_sales_invoice_payment_ledger('20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000507')$q$,'42501','cross-workspace ledger refused');
SELECT proof_denied($q$SELECT read_sales_invoice_payment_ledger('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000507')$q$,'42501','cross-invoice ledger refused');
SELECT proof_denied($q$SELECT read_sales_invoice_payment_ledger('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000091',1,(SELECT result->'next_cursor' FROM ledger_page1)||'{"invoice_id":"60000000-0000-0000-0000-000000000501"}')$q$,'40001','cursor cannot move to another invoice');
SELECT proof_denied($q$SELECT read_public_sales_invoice_payment_ledger(repeat('b',64))$q$,'42501','browser cannot invoke service token resolver');
RESET ROLE;
UPDATE tenant_members SET role='member' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT proof_denied($q$SELECT read_sales_invoice_payment_ledger('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000091')$q$,'42501','member ledger refused');
RESET ROLE;
UPDATE tenant_members SET role='owner' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET ROLE service_role;
CREATE TEMP TABLE public_ledger AS SELECT read_public_sales_invoice_payment_ledger(repeat('b',64)) result;
SELECT proof_assert((SELECT result#>>'{payment_ledger,complete}' FROM public_ledger)='true','public ledger complete only when whole history fits');
SELECT proof_assert((SELECT result#>>'{payment_ledger,rows,2,received_at}' FROM public_ledger)<>(SELECT result#>>'{payment_ledger,rows,2,posted_at}' FROM public_ledger),'received date stays distinct from posted correction chronology');
SELECT proof_assert((SELECT result->>'current_invoice_number' FROM public_ledger)=(SELECT result->>'original_invoice_number' FROM public_ledger),'legacy DRAFT number retained without rewriting original reference');
SELECT proof_assert((SELECT NOT(result::text ~ 'actor_user_id|actor_label|Owner receipt|reference|notes|reason|tenant_id') FROM public_ledger),'public ledger excludes private attribution references and tenant IDs');
SELECT proof_assert(read_public_sales_invoice_payment_ledger(repeat('f',64)) IS NULL,'unknown bearer grant unavailable');
SELECT proof_assert(read_public_sales_invoice_payment_ledger('invalid') IS NULL,'malformed bearer hash unavailable');
SELECT proof_denied($q$SELECT read_public_sales_invoice_payment_ledger(repeat('b',64),NULL)$q$,'22023','public NULL page limit refused');
SELECT proof_assert(preview_sales_invoice_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','{"action":"invoice.record_manual_payment","invoice_id":"60000000-0000-0000-0000-000000000091","expected_version":5,"amount_cents":100,"currency":"usd","method":"cash","received_at":"2026-10-01T12:00:00Z"}')->>'summary' LIKE '%$1.00 USD%October 01, 2026%previously issued invoice%$3.00 USD%','canonical approval summary uses dollars date and remaining balance');
SELECT proof_assert(preview_sales_invoice_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','{"action":"invoice.reverse_manual_payment","invoice_id":"60000000-0000-0000-0000-000000000091","expected_version":5,"payment_id":"70000000-0000-0000-0000-000000000104","reason":"Correction"}')->>'summary' LIKE '%$6.00 USD%previously issued invoice%$10.00 USD%does not refund%','canonical correction preview has human money and conservation');
RESET ROLE;
-- Fixture-only larger immutable ledger proves paging beyond the legacy 50-row read; no business writes claimed.
INSERT INTO paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,reference,import_provenance)
 SELECT ('72000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'60000000-0000-0000-0000-000000000501','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','receipt',10,'usd','cash','2026-08-01T12:00:00Z','PRIVATE IMPORT REFERENCE',CASE WHEN i=1 THEN '{"source":"csv","account":"PRIVATE SOURCE"}'::jsonb ELSE NULL END FROM generate_series(1,60) i;
INSERT INTO paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,reverses_payment_id,reason)
 SELECT ('73000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'60000000-0000-0000-0000-000000000501','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','reversal',10,'usd','cash','2026-08-01T12:00:00Z',('72000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'PRIVATE CORRECTION REASON' FROM generate_series(1,60) i;
UPDATE paige_invoices SET billing_lifecycle_version=billing_lifecycle_version+1 WHERE id='60000000-0000-0000-0000-000000000501';
SET ROLE authenticated;
CREATE TEMP TABLE large_ledger1 AS SELECT read_sales_invoice_payment_ledger('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000501') result;
CREATE TEMP TABLE large_ledger2 AS SELECT read_sales_invoice_payment_ledger('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000501',100,(SELECT result->'next_cursor' FROM large_ledger1)) result;
SELECT proof_assert((SELECT jsonb_array_length(result#>'{payment_ledger,rows}') FROM large_ledger1)=100 AND (SELECT jsonb_array_length(result#>'{payment_ledger,rows}') FROM large_ledger2)=20,'120 facts retrieved across two bounded pages');
SELECT proof_assert((SELECT result#>>'{payment_ledger,count}' FROM large_ledger1)='120' AND (SELECT result#>>'{payment_ledger,complete}' FROM large_ledger1)='false','large history explicitly incomplete on first page');
SELECT proof_assert((SELECT result#>>'{payment_ledger,receipt_total_cents}' FROM large_ledger1)='600' AND (SELECT result#>>'{payment_ledger,reversal_total_cents}' FROM large_ledger2)='600' AND (SELECT result->>'remaining_cents' FROM large_ledger2)='1000','all-row receipt correction totals conserve obligation');
SELECT proof_assert((SELECT result#>>'{payment_ledger,rows,59,kind}' FROM large_ledger1)='receipt' AND (SELECT result#>>'{payment_ledger,rows,60,kind}' FROM large_ledger1)='reversal','same-posted-time corrections follow receipts causally');
SELECT proof_assert((SELECT result#>>'{payment_ledger,rows,19,running_received_cents}' FROM large_ledger2)='0' AND (SELECT result#>>'{payment_ledger,rows,19,running_remaining_cents}' FROM large_ledger2)='1000','running balance spans both pages');
SELECT proof_assert((SELECT result#>>'{payment_ledger,rows,0,provenance}' FROM large_ledger1)='owner_imported_unverified' AND (SELECT NOT(result::text ~ 'PRIVATE IMPORT|PRIVATE SOURCE|PRIVATE CORRECTION') FROM large_ledger1),'import provenance honest without private source details');
RESET ROLE;
SELECT proof_assert(NOT EXISTS(SELECT 1 FROM ledger_originals old JOIN paige_invoices current USING(id) WHERE old.invoice_number IS DISTINCT FROM current.invoice_number OR old.billing_document IS DISTINCT FROM current.billing_document OR old.billing_document_digest IS DISTINCT FROM current.billing_document_digest OR old.billing_issued_at IS DISTINCT FROM current.billing_issued_at OR old.billing_issued_by IS DISTINCT FROM current.billing_issued_by),'ledger migration preserves all historical numbers documents digest and issuer facts');
