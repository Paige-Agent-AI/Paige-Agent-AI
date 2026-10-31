-- UNMOUNTED O5 candidate. Extend the ONE canonical financial position with
-- retained provider facts; original two-argument/legacy balance contracts stay exact.
-- No ledger, credit, refund, charge, collection decision, job or event is written.
CREATE FUNCTION public._sales_invoice_financial_position_rows(
 _tenant uuid,_invoice uuid,_evidence_version integer
) RETURNS TABLE(invoice_id uuid,financial_position jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE base record; payment public.paige_invoice_payments%rowtype;
 op public.paige_invoice_provider_operations%rowtype; entry public.paige_invoice_operations%rowtype;
 snapshot jsonb; item jsonb; movement jsonb; sources jsonb;
 refunded numeric; refund_pending numeric; refund_delta numeric; dispute_debit numeric; dispute_credit numeric;
 test_adjustments integer; pending boolean; review boolean; observed_net numeric;
BEGIN
 IF _tenant IS NULL OR _evidence_version IS DISTINCT FROM 3 THEN
  RAISE EXCEPTION 'Financial evidence version unavailable' USING ERRCODE='22023';
 END IF;
 FOR base IN SELECT b.* FROM public._sales_invoice_financial_position_rows(_tenant,_invoice) b LOOP
  refunded:=0;refund_pending:=0;refund_delta:=0;dispute_debit:=0;dispute_credit:=0;
  test_adjustments:=0;pending:=false;review:=false;sources:='[]'::jsonb;
  FOR payment IN SELECT p.* FROM public.paige_invoice_payments p
   WHERE p.tenant_id=_tenant AND p.invoice_id=base.invoice_id AND p.evidence_kind='provider_verified'
   ORDER BY p.id LOOP
   SELECT p.* INTO op FROM public.paige_invoice_provider_operations p WHERE p.id=payment.provider_operation_id;
   IF NOT FOUND OR payment.kind IS DISTINCT FROM 'receipt' OR op.state IS DISTINCT FROM 'settled'
    OR op.tenant_id IS DISTINCT FROM _tenant OR op.invoice_id IS DISTINCT FROM base.invoice_id
    OR op.actor_user_id IS DISTINCT FROM payment.actor_user_id
    OR op.allocation_payment_id IS DISTINCT FROM payment.id OR op.amount_minor IS DISTINCT FROM payment.amount_cents::bigint
    OR op.currency IS DISTINCT FROM payment.currency OR op.provider IS DISTINCT FROM payment.provider
    OR op.merchant_account_id IS DISTINCT FROM payment.merchant_account_id
    OR op.environment IS DISTINCT FROM payment.provider_environment OR op.environment NOT IN('live','test')
    OR op.verified_readback->>'provider_transaction_id' IS DISTINCT FROM payment.provider_transaction_id
    OR op.verified_readback->>'provider_settlement_id' IS DISTINCT FROM payment.provider_settlement_id
    OR op.provider_observation_version IS NULL OR op.provider_observation_version<0
    OR (op.provider_observation_version=0) IS DISTINCT FROM (op.provider_observation_operation_id IS NULL) THEN
    RAISE EXCEPTION 'Original financial source unavailable' USING ERRCODE='55000';
   END IF;
   -- A read of retained history does not require the old merchant to remain
   -- connected. This grants no authority for a NEW provider request.
   IF op.provider_observation_version>0 THEN
    SELECT e.* INTO entry FROM public.paige_invoice_operations e WHERE e.id=op.provider_observation_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Original financial source unavailable' USING ERRCODE='55000'; END IF;
    snapshot:=public._sales_provider_observation_entry(op,entry,op.provider_observation_version-1,true);
    sources:=sources||jsonb_build_array(jsonb_build_object('provider_operation_id',op.id,
     'observation_id',entry.id,'observation_version',op.provider_observation_version,'environment',op.environment));
    IF op.environment='test' THEN
     test_adjustments:=test_adjustments+jsonb_array_length(snapshot->'refunds')+jsonb_array_length(snapshot->'disputes');
    ELSE
     review:=review OR jsonb_array_length(snapshot->'refunds')>0 OR jsonb_array_length(snapshot->'disputes')>0;
     FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'refunds') LOOP
      IF item->>'status'='succeeded' THEN refunded:=refunded+(item->>'amount_minor')::numeric; END IF;
      IF item->>'status' IN('pending','requires_action') THEN
       refund_pending:=refund_pending+(item->>'amount_minor')::numeric;pending:=true;
      END IF;
      FOR movement IN SELECT value FROM jsonb_array_elements(jsonb_build_array(item->'balance_transaction',item->'failure_balance_transaction')) WHERE value<>'null'::jsonb LOOP
       refund_delta:=refund_delta+(movement->>'amount_minor')::numeric;
       pending:=pending OR movement->>'status'<>'available';
      END LOOP;
     END LOOP;
     FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'disputes') LOOP
      FOR movement IN SELECT value FROM jsonb_array_elements(item->'balance_transactions') LOOP
       IF (movement->>'amount_minor')::numeric<0 THEN dispute_debit:=dispute_debit-(movement->>'amount_minor')::numeric;
       ELSE dispute_credit:=dispute_credit+(movement->>'amount_minor')::numeric; END IF;
       pending:=pending OR movement->>'status'<>'available';
      END LOOP;
      -- A decision label is not money-movement evidence. An open or incompletely
      -- evidenced formal dispute stays unresolved, including won without return.
      pending:=pending OR item->>'status' IN('needs_response','under_review')
       OR (item->>'status'='lost' AND (jsonb_array_length(item->'balance_transactions')<>1
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(item->'balance_transactions') m WHERE (m->>'amount_minor')::numeric<0)))
       OR (item->>'status'='won' AND
        (jsonb_array_length(item->'balance_transactions')<>2 OR
         (SELECT coalesce(sum((m->>'amount_minor')::numeric),0) FROM jsonb_array_elements(item->'balance_transactions') m)<>0));
     END LOOP;
    END IF;
   END IF;
   IF op.environment='live' AND EXISTS(SELECT 1 FROM public.paige_durable_work w
    WHERE w.tenant_id=_tenant AND w.work_kind='sales_provider_observation'
     AND w.request_payload->>'operation_id'=op.id::text AND w.status<>'succeeded') THEN
    pending:=true;review:=true;
   END IF;
  END LOOP;
  observed_net:=base.live_provider_minor+refund_delta-dispute_debit+dispute_credit;
  IF observed_net<0 OR observed_net>base.live_provider_minor THEN
   observed_net:=NULL;pending:=true;review:=true;
  END IF;
  invoice_id:=base.invoice_id;
  financial_position:=to_jsonb(base)||jsonb_build_object('financial_evidence_version',3,
   'provider_refunded_minor',refunded,'provider_refund_pending_minor',refund_pending,
   'provider_refund_cash_delta_minor',refund_delta,'provider_dispute_debited_minor',dispute_debit,
   'provider_dispute_reinstated_minor',dispute_credit,'provider_observed_net_minor',observed_net,
   'provider_settled_net_minor',CASE WHEN pending THEN NULL ELSE observed_net END,
   'provider_verification_pending',pending,'commercial_review_required',review,
   'test_adjustment_count',test_adjustments,'provider_observation_sources',sources);
  RETURN NEXT;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_financial_position_rows(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
DO $private_acl$
BEGIN
 IF (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public._sales_invoice_financial_position_rows(uuid,uuid,integer)'::regprocedure
   AND a.grantee=p.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)<>1
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public._sales_invoice_financial_position_rows(uuid,uuid,integer)'::regprocedure
   AND (a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
  RAISE EXCEPTION 'Private financial evidence permission drift' USING ERRCODE='23514';
 END IF;
END $private_acl$;
