-- Experience 04 · E4-S1 "Where this client stands".
-- One read-only, tenant-authorized source projection for ONE client. It composes the canonical
-- owners and never re-derives them:
--   * commercial terms  -> public.tenant_client_agreements (collection_terms + version)
--   * signing           -> public.paige_agreements (status timestamps only; no body, no storage key)
--   * invoice balance   -> public._sales_invoice_balance_rows (the ONE Sales balance owner)
--   * payment requests  -> public.paige_invoice_provider_operations (state only; never a receipt)
--   * delivery work     -> public.plan_items (milestones and tasks linked to this client)
-- No table, ledger, store, scheduler, provider call or mutation is added. The only write is the
-- canonical capability receipt (record_capability_run), exactly as read_sales_collections does.
-- Schedule expansion and every derived label live in the shared TypeScript composer
-- (_shared/client-engagement/status.ts), which reuses the canonical Collections schedule model.
CREATE OR REPLACE FUNCTION public.read_client_engagement_status(_expected_tenant_id uuid,_contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE run uuid:=gen_random_uuid(); read_at timestamptz:=clock_timestamp();
 client_name text; terms jsonb; terms_more boolean; signings jsonb; signings_more boolean;
 invoices jsonb; invoices_more boolean; items jsonb; items_more boolean; work_counts jsonb; result jsonb;
BEGIN
 -- Caller scope is resolved from the session, never from the request (§9/§59).
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Client status workspace changed' USING ERRCODE='42501';
 END IF;
 -- Same owner/admin authority as every Sales read: an active member with role owner/admin whose
 -- active workspace is this tenant. Staff members, clients and foreign tenants are refused.
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 IF _contact_id IS NULL THEN RAISE EXCEPTION 'Client required' USING ERRCODE='22023'; END IF;
 -- A foreign or missing client is indistinguishable from an unauthorized one.
 IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=_contact_id AND tenant_id=_expected_tenant_id) THEN
  RAISE EXCEPTION 'Client unavailable' USING ERRCODE='42501';
 END IF;
 client_name:=public._sales_collection_client_name(_contact_id,_expected_tenant_id);

 -- Commercial terms for this client, newest first. Notes and fee doctrine are omitted.
 WITH picked AS (
  SELECT a.* FROM public.tenant_client_agreements a
  WHERE a.tenant_id=_expected_tenant_id AND a.contact_id=_contact_id
  ORDER BY a.created_at DESC,a.id DESC LIMIT 11)
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'offer_id',p.offer_id,
   'offer_name',(SELECT left(o.name,200) FROM public.tenant_products o WHERE o.id=p.offer_id AND o.tenant_id=_expected_tenant_id),
   'title',left(p.title,200),'status',p.status,
   'agreed_amount_minor',p.agreed_amount_minor,'agreed_currency',p.agreed_currency,
   'collection_terms',p.collection_terms,'collection_terms_version',p.collection_terms_version,
   'starts_on',p.starts_on,'ends_on',p.ends_on,'created_at',p.created_at,'updated_at',p.updated_at)
   ORDER BY p.created_at DESC,p.id DESC) FILTER (WHERE rn<=10),'[]'::jsonb),count(*)>10
 INTO terms,terms_more FROM (SELECT *,row_number() OVER (ORDER BY created_at DESC,id DESC) rn FROM picked) p;

 -- Signing documents: lifecycle facts only. Body, document path and storage keys never leave.
 WITH picked AS (
  SELECT s.* FROM public.paige_agreements s
  WHERE s.tenant_id=_expected_tenant_id AND s.contact_id=_contact_id
  ORDER BY s.created_at DESC,s.id DESC LIMIT 11)
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'commercial_terms_id',p.commercial_terms_id,'offer_id',p.offer_id,'title',left(p.title,200),
   'status',p.status,'version',p.version,'sent_at',p.sent_at,'viewed_at',p.viewed_at,
   'completed_at',p.completed_at,'declined_at',p.declined_at,'voided_at',p.voided_at,'expires_at',p.expires_at,
   'sealed',p.status='completed' AND p.sealed_storage_key IS NOT NULL AND p.content_sha256 IS NOT NULL AND p.sealed_sha256 IS NOT NULL,
   'created_at',p.created_at)
   ORDER BY p.created_at DESC,p.id DESC) FILTER (WHERE rn<=10),'[]'::jsonb),count(*)>10
 INTO signings,signings_more FROM (SELECT *,row_number() OVER (ORDER BY created_at DESC,id DESC) rn FROM picked) p;

 -- Invoices with the canonical balance split by evidence class, plus open payment requests.
 -- Test-environment provider money is reported separately so it can never read as real money.
 WITH picked AS (
  SELECT i.* FROM public.paige_invoices i
  WHERE i.tenant_id=_expected_tenant_id AND i.contact_id=_contact_id
  ORDER BY i.created_at DESC,i.id DESC LIMIT 51)
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'invoice_number',left(p.invoice_number,64),'status',p.status,
   'amount_minor',b.amount_minor,'currency',lower(p.currency),'due_date',p.due_date,
   'issued_at',p.billing_issued_at,'created_at',p.created_at,
   'commercial_terms_reference',CASE WHEN p.billing_draft ? 'commercial_terms_reference'
     THEN public._sales_invoice_terms_reference_shape(p.billing_draft->'commercial_terms_reference') END,
   'allocated_minor',b.allocated_minor,'remaining_minor',b.remaining_minor,
   'manual_recorded_minor',b.manual_minor,
   'provider_verified_live_minor',b.provider_minor-b.test_provider_minor,
   'provider_verified_test_minor',b.test_provider_minor,
   'reversal_count',(SELECT count(*) FROM public.paige_invoice_payments r
      WHERE r.tenant_id=_expected_tenant_id AND r.invoice_id=p.id AND r.kind='reversal'),
   'open_payment_requests',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'state',o.state,'amount_minor',o.amount_minor,'currency',lower(o.currency),'environment',o.environment,
      'purpose',o.purpose,'updated_at',o.updated_at) ORDER BY o.updated_at DESC),'[]'::jsonb)
     FROM public.paige_invoice_provider_operations o
     WHERE o.tenant_id=_expected_tenant_id AND o.invoice_id=p.id
       AND o.state IN ('prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown')),
   'failed_payment_requests',(SELECT count(*) FROM public.paige_invoice_provider_operations o
     WHERE o.tenant_id=_expected_tenant_id AND o.invoice_id=p.id AND o.state IN ('failed','expired')))
   ORDER BY p.created_at DESC,p.id DESC) FILTER (WHERE rn<=50),'[]'::jsonb),count(*)>50
 INTO invoices,invoices_more
 FROM (SELECT *,row_number() OVER (ORDER BY created_at DESC,id DESC) rn FROM picked) p
 CROSS JOIN LATERAL public._sales_invoice_balance_rows(_expected_tenant_id,p.id) b;

 -- Delivery work linked to this client. Reminders are personal nudges, not delivery work.
 SELECT jsonb_build_object(
   'total',count(*),
   'done',count(*) FILTER (WHERE status='done'),
   'cancelled',count(*) FILTER (WHERE status='cancelled'),
   'blocked',count(*) FILTER (WHERE status='blocked'),
   'open',count(*) FILTER (WHERE status IN ('open','in_progress','blocked')),
   'overdue',count(*) FILTER (WHERE status IN ('open','in_progress','blocked') AND due_at IS NOT NULL AND due_at<read_at),
   'undated_open',count(*) FILTER (WHERE status IN ('open','in_progress','blocked') AND due_at IS NULL))
 INTO work_counts FROM public.plan_items
 WHERE tenant_id=_expected_tenant_id AND contact_id=_contact_id AND item_type IN ('milestone','task');

 WITH picked AS (
  SELECT w.* FROM public.plan_items w
  WHERE w.tenant_id=_expected_tenant_id AND w.contact_id=_contact_id AND w.item_type IN ('milestone','task')
  ORDER BY (w.status IN ('done','cancelled')),w.due_at ASC NULLS LAST,w.id LIMIT 21)
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'plan_id',p.plan_id,'item_type',p.item_type,'title',left(p.title,200),'status',p.status,
   'due_at',p.due_at,'completed_at',p.completed_at,'assigned',p.assigned_to_user_id IS NOT NULL)
   ORDER BY rn) FILTER (WHERE rn<=20),'[]'::jsonb),count(*)>20
 INTO items,items_more
 FROM (SELECT *,row_number() OVER (ORDER BY (status IN ('done','cancelled')),due_at ASC NULLS LAST,id) rn FROM picked) p;

 result:=jsonb_build_object(
  'tenant_id',_expected_tenant_id,'contact_id',_contact_id,
  'client_name',left(client_name,200),'read_at',read_at,'as_of_date',(read_at AT TIME ZONE 'UTC')::date,
  'terms',terms,'terms_has_more',terms_more,
  'signings',signings,'signings_has_more',signings_more,
  'invoices',invoices,'invoices_has_more',invoices_more,
  'work',work_counts||jsonb_build_object('items',items,'items_has_more',items_more),
  -- Facts the platform does not record yet are declared, never inferred as zero.
  'not_recorded',jsonb_build_array('payment_disputes','provider_refunds','terms_effective_transition','installment_allocation'),
  'authority','read_only','provider_execution','none');
 IF octet_length(result::text)>524288 THEN
  RAISE EXCEPTION 'Client status is too large to read safely' USING ERRCODE='22023';
 END IF;
 -- No client name, amounts or terms in the receipt payload; the receipt proves the read happened.
 PERFORM public.record_capability_run(_expected_tenant_id,auth.uid(),'read_client_engagement_status','capability_succeeded',run,NULL);
 RETURN result||jsonb_build_object('receipt_id',run);
END $$;
REVOKE ALL ON FUNCTION public.read_client_engagement_status(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_client_engagement_status(uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.read_client_engagement_status(uuid,uuid) IS
 'Experience 04 E4-S1: read-only source projection of one client''s terms, signings, invoice balances by evidence class, open payment requests and delivery work. Owner/admin of the active workspace only. Not a ledger, mandate or authority.';
