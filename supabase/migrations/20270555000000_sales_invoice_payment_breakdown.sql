-- Customer document ledger is a bounded projection of canonical immutable receipts/corrections.
-- Historical DRAFT-* invoice numbers and all frozen document/digest facts remain untouched.
CREATE OR REPLACE FUNCTION public._sales_invoice_payment_ledger(_tenant uuid,_invoice uuid,_limit integer,_cursor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; version bigint; as_of timestamptz; after_ordinal bigint:=0;
 receipt_total bigint; reversal_total bigint; count_rows bigint; rows jsonb; last_ordinal bigint; more boolean; next_cursor jsonb;
BEGIN
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid invoice ledger limit' USING ERRCODE='22023'; END IF;
 -- Every canonical receipt/correction writer locks this invoice and advances its version.
 -- A share lock makes one page internally consistent; later pages refuse any changed version.
 SELECT * INTO invoice FROM public.paige_invoices WHERE tenant_id=_tenant AND id=_invoice
  AND billing_draft_version IS NOT NULL AND billing_document IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice document unavailable' USING ERRCODE='42501'; END IF;
 version:=coalesce(invoice.billing_lifecycle_version,invoice.billing_draft_version); as_of:=invoice.updated_at;
 IF _cursor IS NOT NULL THEN
  IF jsonb_typeof(_cursor) IS DISTINCT FROM 'object' OR octet_length(_cursor::text)>1500 OR (SELECT count(*) FROM jsonb_object_keys(_cursor))<>5
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(_cursor) k WHERE k NOT IN ('invoice_id','version','invoice_number','as_of','ordinal'))
   OR coalesce(_cursor->>'ordinal','') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid invoice ledger cursor' USING ERRCODE='22023'; END IF;
  IF _cursor->>'invoice_id' IS DISTINCT FROM _invoice::text
   OR _cursor->'version' IS DISTINCT FROM to_jsonb(version) OR _cursor->>'invoice_number' IS DISTINCT FROM invoice.invoice_number
   OR _cursor->'as_of' IS DISTINCT FROM to_jsonb(as_of) THEN
   RAISE EXCEPTION 'Invoice ledger changed; restart document read' USING ERRCODE='40001'; END IF;
  after_ordinal:=(_cursor->>'ordinal')::bigint;
 END IF;
 SELECT coalesce(sum(amount_cents) FILTER(WHERE kind='receipt'),0),coalesce(sum(amount_cents) FILTER(WHERE kind='reversal'),0),count(*)
  INTO receipt_total,reversal_total,count_rows FROM public.paige_invoice_payments WHERE tenant_id=_tenant AND invoice_id=_invoice;
 IF after_ordinal>count_rows THEN RAISE EXCEPTION 'Invalid invoice ledger cursor position' USING ERRCODE='22023'; END IF;
 WITH ordered AS (
  SELECT p.*,row_number() OVER ordering AS ordinal,
   sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) OVER (ordering ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_received
  FROM public.paige_invoice_payments p WHERE tenant_id=_tenant AND invoice_id=_invoice
  WINDOW ordering AS (ORDER BY created_at,CASE WHEN kind='receipt' THEN 0 ELSE 1 END,id)
 ), page AS (SELECT * FROM ordered WHERE ordinal>after_ordinal ORDER BY ordinal LIMIT _limit)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'amount_cents',amount_cents,'currency',currency,'method',method,
   'received_at',received_at,'posted_at',created_at,'reverses_payment_id',reverses_payment_id,'ordinal',ordinal,
   'running_received_cents',running_received,'running_remaining_cents',invoice.amount_total_cents-running_received,
   'provenance',CASE WHEN import_provenance IS NOT NULL THEN 'owner_imported_unverified' ELSE 'human_recorded' END) ORDER BY ordinal),'[]'::jsonb),max(ordinal)
  INTO rows,last_ordinal FROM page;
 more:=coalesce(last_ordinal,after_ordinal)<count_rows;
 IF more THEN next_cursor:=jsonb_build_object('invoice_id',_invoice,'version',version,'invoice_number',invoice.invoice_number,'as_of',as_of,'ordinal',last_ordinal); END IF;
 RETURN jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,'current_invoice_number',invoice.invoice_number,
  'original_invoice_number',invoice.billing_document->'invoice_number','status',invoice.status,'version',version,
  'document',invoice.billing_document,'document_input_digest',invoice.billing_document_digest,
  'manual_recorded_cents',receipt_total-reversal_total,'remaining_cents',invoice.amount_total_cents-receipt_total+reversal_total,
  'payment_ledger',jsonb_build_object('rows',rows,'receipt_total_cents',receipt_total,'reversal_total_cents',reversal_total,'count',count_rows,'as_of',as_of,'complete',after_ordinal=0 AND NOT more),
  'has_more',more,'next_cursor',next_cursor);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.read_sales_invoice_payment_ledger(_expected_tenant_id uuid,_invoice_id uuid,_limit integer DEFAULT 100,_cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid:=public.current_user_tenant_id(); actor uuid:=auth.uid();
BEGIN
 IF tenant IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public._sales_invoice_actor(actor,tenant);
 RETURN public._sales_invoice_payment_ledger(tenant,_invoice_id,_limit,_cursor);
END $$;
REVOKE ALL ON FUNCTION public.read_sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_public_sales_invoice_payment_ledger(_token_hash text,_limit integer DEFAULT 100,_cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE grant_row public.paige_invoice_access_grants%ROWTYPE; invoice public.paige_invoices%ROWTYPE;
BEGIN
 IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO grant_row FROM public.paige_invoice_access_grants WHERE token_hash=_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=grant_row.invoice_id AND tenant_id=grant_row.tenant_id
  AND status='issued' AND billing_issued_snapshot_version=grant_row.issued_snapshot_version FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN public._sales_invoice_payment_ledger(invoice.tenant_id,invoice.id,_limit,_cursor);
END $$;
REVOKE ALL ON FUNCTION public.read_public_sales_invoice_payment_ledger(text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_sales_invoice_payment_ledger(text,integer,jsonb) TO service_role;

-- Change only display wording after the existing canonical preview checks and scope resolution.
DO $$ BEGIN
 IF to_regprocedure('public._sales_invoice_preview_before_payment_breakdown(uuid,uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) RENAME TO _sales_invoice_preview_before_payment_breakdown;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_preview_before_payment_breakdown(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.preview_sales_invoice_command(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; invoice public.paige_invoices%ROWTYPE; receipt public.paige_invoice_payments%ROWTYPE; amount bigint; balance bigint; date_label text; method_label text; invoice_label text;
BEGIN
 result:=public._sales_invoice_preview_before_payment_breakdown(_actor_user_id,_expected_tenant_id,_command);
 IF result->>'eligible'='true' AND _command->>'action' IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') THEN
  SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id;
  balance:=(result->>'remaining_cents')::bigint;
  invoice_label:=CASE WHEN invoice.invoice_number LIKE 'DRAFT-%' THEN 'previously issued invoice' ELSE 'invoice '||invoice.invoice_number END;
  IF _command->>'action'='invoice.record_manual_payment' THEN
   amount:=(_command->>'amount_cents')::bigint; date_label:=to_char((_command->>'received_at')::timestamptz AT TIME ZONE 'UTC','FMMonth DD, YYYY')||' (UTC)';
   method_label:=initcap(replace(_command->>'method','_',' '));
   result:=jsonb_set(result,'{summary}',to_jsonb(format('Record $%s USD received by %s on %s for %s. Outstanding after this record: $%s USD. This is a human-recorded payment, not provider verification.',
    to_char(amount::numeric/100,'FM999999999999990.00'),method_label,date_label,invoice_label,to_char((balance-amount)::numeric/100,'FM999999999999990.00'))));
  ELSE
   SELECT * INTO receipt FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND tenant_id=_expected_tenant_id AND invoice_id=invoice.id;
   result:=jsonb_set(result,'{summary}',to_jsonb(format('Reverse the recorded $%s USD payment for %s. Outstanding after this correction: $%s USD. This corrects the business record and does not refund or transfer money.',
    to_char(receipt.amount_cents::numeric/100,'FM999999999999990.00'),invoice_label,to_char((balance+receipt.amount_cents)::numeric/100,'FM999999999999990.00'))));
  END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) TO service_role;
