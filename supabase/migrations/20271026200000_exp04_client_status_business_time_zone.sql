-- Experience 04 · E4-S1b: classify due dates in the business owner's configured time zone.
--
-- Owner ruling 2026-10-12: payment due-date, upcoming and overdue classifications use the
-- authenticated business owner's configured IANA time zone — never UTC, server time or the viewer's
-- browser zone as an implicit substitute. If the zone is missing or invalid, the read says so and the
-- composer withholds every due / upcoming / overdue judgement until the owner configures it.
--
-- WHERE THE ZONE LIVES. Grounding found no workspace-level zone the owner alone controls:
--   * calendars / staff_calendar_settings / internal_bookings default to 'America/New_York', so a
--     default is indistinguishable from a choice;
--   * profiles.coach_timezone is a per-PERSON field that set_coach_fields lets any tenant admin write
--     for any active member — including an admin of ANOTHER workspace the owner belongs to — so it
--     cannot be the authority for this business's money (independent review, PR #2085);
--   * tenants rows are UPDATE-able by tenant admins, so a column there would not be owner-only.
-- So the zone gets one small home of its own, written ONLY through set_business_time_zone by the
-- workspace's active owner and validated on write; nothing else may read or write the table.
-- It is a setting, not a ledger: one row per workspace, no history, no money.
--
-- Accepted zones: 'UTC' or an IANA Area/Location name known to this database. Abbreviations and
-- fixed-offset legacy names (EST, EST5EDT, Etc/GMT+12, Zulu …) are refused: they have no regional
-- daylight-saving rules and would silently misclassify a business that observes DST.
--
-- The read reports business_time_zone {state, zone}:
--   configured : a row exists and its zone still has the accepted shape
--   missing    : no row
--   invalid    : a row exists but its zone no longer has the accepted shape (defensive)
-- as_of_date is the owner-local calendar date of read_at, null unless configured. Everything else in
-- the read is carried verbatim from 20271026000100. Contractual due dates and payment timestamps are
-- returned unchanged.

CREATE TABLE IF NOT EXISTS public.tenant_business_time_zones (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  time_zone text NOT NULL CHECK (time_zone ~ '^(UTC|(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z][A-Za-z0-9_+-]*)?)$'),
  set_by uuid NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_business_time_zones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_business_time_zones FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.tenant_business_time_zones IS
 'Experience 04 E4-S1b: the business owner''s configured IANA time zone for payment due / upcoming / overdue classification. One row per workspace. Written only by set_business_time_zone (active owner); read only by definer functions.';

CREATE OR REPLACE FUNCTION public.set_business_time_zone(_expected_tenant_id uuid,_time_zone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE run uuid:=gen_random_uuid(); zone text:=nullif(btrim(_time_zone),'');
BEGIN
 IF auth.uid() IS NULL OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Business time zone workspace changed' USING ERRCODE='42501';
 END IF;
 -- The OWNER configures the business's zone; an admin, staff member or another workspace cannot.
 IF NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_expected_tenant_id
   AND tm.user_id=auth.uid() AND tm.is_owner AND tm.status='active') THEN
  RAISE EXCEPTION 'Only the business owner can set the business time zone' USING ERRCODE='42501';
 END IF;
 IF zone IS NULL THEN
  DELETE FROM public.tenant_business_time_zones WHERE tenant_id=_expected_tenant_id;
 ELSE
  IF zone !~ '^(UTC|(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z][A-Za-z0-9_+-]*)?)$'
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=zone) THEN
   RAISE EXCEPTION 'Unknown time zone' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.tenant_business_time_zones(tenant_id,time_zone,set_by,set_at)
  VALUES(_expected_tenant_id,zone,auth.uid(),now())
  ON CONFLICT(tenant_id) DO UPDATE SET time_zone=excluded.time_zone,set_by=excluded.set_by,set_at=excluded.set_at;
 END IF;
 PERFORM public.record_capability_run(_expected_tenant_id,auth.uid(),'set_business_time_zone','capability_succeeded',run,NULL);
 RETURN jsonb_build_object('time_zone',zone,'receipt_id',run);
END $$;
REVOKE ALL ON FUNCTION public.set_business_time_zone(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.set_business_time_zone(uuid,text) TO authenticated;
COMMENT ON FUNCTION public.set_business_time_zone(uuid,text) IS
 'Experience 04 E4-S1b: the active owner of the caller''s active workspace sets (or, with null, clears) the business time zone. UTC or an IANA Area/Location zone only. One receipt per call.';

CREATE OR REPLACE FUNCTION public.read_client_engagement_status(_expected_tenant_id uuid,_contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE run uuid:=gen_random_uuid(); read_at timestamptz:=clock_timestamp();
 client_name text; zone_state text; zone text; terms jsonb; terms_more boolean; signings jsonb; signings_more boolean;
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

 -- The business owner's configured time zone (see header). Read for the workspace, not the caller.
 SELECT z.time_zone INTO zone FROM public.tenant_business_time_zones z WHERE z.tenant_id=_expected_tenant_id;
 IF zone IS NULL THEN zone_state:='missing';
 ELSIF zone !~ '^(UTC|(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z][A-Za-z0-9_+-]*)?)$' THEN
  zone_state:='invalid'; zone:=NULL;
 ELSE zone_state:='configured';
 END IF;

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
  'client_name',left(client_name,200),'read_at',read_at,
  'business_time_zone',jsonb_build_object('state',zone_state,'zone',zone),
  'as_of_date',CASE WHEN zone_state='configured' THEN (read_at AT TIME ZONE zone)::date END,
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
 'Experience 04 E4-S1/S1b: read-only source projection of one client''s terms, signings, invoice balances by evidence class, open payment requests and delivery work, with the business owner''s configured time zone (state + zone) and the owner-local as_of_date. Owner/admin of the active workspace only. Not a ledger, mandate or authority.';
