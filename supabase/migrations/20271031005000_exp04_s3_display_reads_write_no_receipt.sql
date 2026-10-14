-- Experience 04 E4-S3 "See it, then verify it" — PR beta: a page that only DISPLAYS a setting or a
-- client's standing writes no receipt; PAIGE's chat read is recorded once, by PAIGE's executor.
--
-- WHAT IS WRONG TODAY. read_business_time_zone, find_clients_for_status and read_client_engagement_status
-- each PERFORM record_capability_run on EVERY call, and the Rail's display credits every capability_run
-- to PAIGE. So Setup › Business profile wrote "Completed a step for you / Paige did this for you" on each
-- page load, and the Collections board and the client record (both mounted by this PR) would have done
-- the same on every visit — a person looking at their own business, reported as PAIGE acting
-- (journey doc §15 F8c/F8d; cross-track contract §2.5 "one ledger").
--
-- WHAT THIS CHANGES.
--  (1) The three readers are recreated with the SAME signature, SECURITY DEFINER, pinned search_path,
--      in-body caller checks (current_user_tenant_id() = _expected_tenant_id, the owner/admin seat via
--      _sales_invoice_actor, the client-in-tenant check, the search bounds and LIKE escaping) and the
--      SAME response — minus three things only: the `run` id, the `PERFORM record_capability_run(...)`
--      line and the `receipt_id` key. Bodies are otherwise byte-identical to their newest definitions
--      (20271029000100 for the zone read and the lookup; 20271026200000 for the client status).
--  (2) PAIGE's chat answer is recorded by the paige-ai-chat executor (service role, idempotent per tool
--      call, detail.channel='paige_chat'), shipped dormant in PR alpha: it records only when the read it
--      answered from did NOT already write a receipt, which is true from this migration on. One answered
--      question → one Rail line. A name search that needed a "which client?" writes nothing.
--  (3) The Rail wording for the two chat-read keys becomes true now that only PAIGE's executor writes
--      them: CREATE OR REPLACE of the PR-alpha display wrapper (no second rename — the chain stays one
--      link longer, not two). "Business time zone changed" stays the owner's act (owner_staff).
--      find_clients_for_status gets no copy: no row is written with that key any more.
--
-- WHAT THIS DOES NOT CHANGE. set_business_time_zone (the owner's real act keeps its receipt and its
-- receipt_id), record_capability_run, paige_workspace_events, tenant_business_time_zones (Exp05 reads it
-- directly inside its own DEFINER and is unaffected), every grant (re-asserted below: authenticated only;
-- never PUBLIC, anon or service_role), and every receipt already written (the ledger is append-only).
--
-- DEPLOY ORDER (§37). Every consumer already tolerates a missing receipt_id: the composer's parser
-- (status.ts, PR alpha) accepts absent/null, Setup's parseBusinessTimeZone never read it, and the chat
-- dispatcher reads only matches/more. paige-ai-chat with that parser must be live (edge-live) before this
-- applies; otherwise client-standing answers fail closed to "unavailable" (never a wrong number).

-- (1) The three readers, without their receipt.
CREATE OR REPLACE FUNCTION public.read_business_time_zone(_expected_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE read_at timestamptz:=clock_timestamp();
 zone text; zone_set_at timestamptz; zone_state text; local_date date; owner boolean;
BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Business time zone workspace changed' USING ERRCODE='42501';
 END IF;
 -- Owner or admin of the active workspace may read it; staff, clients and other workspaces may not.
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 owner:=EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_expected_tenant_id
   AND tm.user_id=auth.uid() AND tm.is_owner AND tm.status='active');

 SELECT z.time_zone,z.set_at INTO zone,zone_set_at FROM public.tenant_business_time_zones z
 WHERE z.tenant_id=_expected_tenant_id;
 IF zone IS NULL THEN zone_state:='missing';
 ELSE
  -- Same degrade as the client status read: an unrecognised stored zone is 'invalid', not an error.
  BEGIN
   local_date:=(read_at AT TIME ZONE zone)::date; zone_state:='configured';
  EXCEPTION WHEN invalid_parameter_value THEN
   zone_state:='invalid'; zone:=NULL; local_date:=NULL;
  END;
 END IF;

 RETURN jsonb_build_object(
  'state',zone_state,'zone',zone,
  'set_at',CASE WHEN zone_state='missing' THEN NULL ELSE zone_set_at END,
  'local_date',local_date,'read_at',read_at,
  -- Whether THIS caller may change it (set_business_time_zone is owner-only).
  'can_set',owner);
END $$;
REVOKE ALL ON FUNCTION public.read_business_time_zone(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_business_time_zone(uuid) TO authenticated;
COMMENT ON FUNCTION public.read_business_time_zone(uuid) IS
 'Experience 04 E4-S2/E4-S3: the active workspace''s business time zone {state configured|missing|invalid, zone, set_at, local_date, can_set}. Owner/admin of the active workspace only. A pure read: it writes no receipt (PAIGE''s chat answer is recorded by her executor).';

CREATE OR REPLACE FUNCTION public.find_clients_for_status(_expected_tenant_id uuid,_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q text:=btrim(_query); pattern text; found jsonb; more boolean;
BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Client search workspace changed' USING ERRCODE='42501';
 END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 IF q IS NULL OR length(q)<2 OR length(q)>120 THEN
  RAISE EXCEPTION 'Search for a client with 2 to 120 characters' USING ERRCODE='22023';
 END IF;
 -- The search text is data, never a pattern: escape LIKE wildcards before wrapping it.
 pattern:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';

 WITH hits AS (
  SELECT c.id,public._sales_collection_client_name(c.id,_expected_tenant_id) AS name,c.status,
   -- Exact name or exact email ranks first, so "Jane Doe" beats "Jane Doe-Smith".
   (lower(trim(concat_ws(' ',c.first_name,c.last_name)))=lower(q)
    OR lower(trim(coalesce(c.entity_name,'')))=lower(q)
    OR lower(trim(coalesce(c.email,'')))=lower(q)) AS exact
  FROM public.clients c
  WHERE c.tenant_id=_expected_tenant_id
   AND (concat_ws(' ',c.first_name,c.last_name) ILIKE pattern
    OR coalesce(c.entity_name,'') ILIKE pattern
    -- Email matches only when typed in full: a fragment must not enumerate addresses.
    OR lower(trim(coalesce(c.email,'')))=lower(q))
  ORDER BY exact DESC,name,c.id
  LIMIT 6)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'name',h.name,'status',h.status,'exact',h.exact)
   ORDER BY h.exact DESC,h.name,h.id) FILTER (WHERE rn<=5),'[]'::jsonb),count(*)>5
 INTO found,more
 FROM (SELECT *,row_number() OVER (ORDER BY exact DESC,name,id) rn FROM hits) h;

 RETURN jsonb_build_object('matches',found,'more',more);
END $$;
REVOKE ALL ON FUNCTION public.find_clients_for_status(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.find_clients_for_status(uuid,text) TO authenticated;
COMMENT ON FUNCTION public.find_clients_for_status(uuid,text) IS
 'Experience 04 E4-S2/E4-S3: up to five clients of the caller''s active workspace matching a name, business name or exact email, for the client-status answer. Names and status only. Owner/admin only. A pure read: it writes no receipt.';

CREATE OR REPLACE FUNCTION public.read_client_engagement_status(_expected_tenant_id uuid,_contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE read_at timestamptz:=clock_timestamp();
 client_name text; zone_state text; zone text; as_of date; terms jsonb; terms_more boolean; signings jsonb; signings_more boolean;
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
 ELSE
  -- Convert once here; a zone this database does not recognise degrades to 'invalid' instead of
  -- making the whole client status unreadable.
  BEGIN
   as_of:=(read_at AT TIME ZONE zone)::date; zone_state:='configured';
  EXCEPTION WHEN invalid_parameter_value THEN
   zone_state:='invalid'; zone:=NULL; as_of:=NULL;
  END;
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
  'as_of_date',as_of,
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
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_client_engagement_status(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_client_engagement_status(uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.read_client_engagement_status(uuid,uuid) IS
 'Experience 04 E4-S1/S1b/S3: read-only source projection of one client''s terms, signings, invoice balances by evidence class, open payment requests and delivery work, with the business owner''s configured time zone (state + zone) and the owner-local as_of_date. Owner/admin of the active workspace only. Not a ledger, mandate or authority. A pure read: it writes no receipt (the client record displays it; PAIGE''s chat answer is recorded by her executor).';

-- (3) The Rail wording. CREATE OR REPLACE of the PR-alpha link (20271031004000), which still delegates to
-- the same `_before_exp04_owner_attribution` predecessor; the rename is NOT repeated.
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE _result jsonb;
BEGIN
  _result:=public._workspace_event_display_before_exp04_owner_attribution(_source_kind,_outcome,_capability);
  IF _source_kind IS DISTINCT FROM 'capability_run' THEN RETURN _result; END IF;
  IF _capability='set_business_time_zone' THEN
    -- Only the owner can save the business time zone (public.set_business_time_zone is owner-only and
    -- PAIGE cannot save it from chat), so the act is the person's. 'owner_staff' is the canonical human
    -- actor value (paige_client_events), rendered as "Person".
    RETURN _result||jsonb_build_object('actor_type','owner_staff',
      'title',CASE WHEN _outcome='capability_succeeded' THEN 'Business time zone changed' ELSE 'Business time zone not changed' END,
      'summary',CASE WHEN _outcome='capability_succeeded'
        THEN 'The business owner changed the business time zone. Due and overdue payment dates follow the saved zone.'
        ELSE 'The change did not go through. The saved zone is unchanged.' END);
  END IF;
  -- From this migration on, only PAIGE's chat executor writes these two keys (the SQL readers write
  -- none), so they are PAIGE's reads, in read words: nothing was changed. Any other outcome keeps the
  -- inherited wording.
  IF _outcome='capability_succeeded' AND _capability='read_business_time_zone' THEN
    RETURN _result||jsonb_build_object('title','Checked your business time zone',
      'summary','PAIGE read this setting to answer you in chat. Nothing was changed.');
  END IF;
  IF _outcome='capability_succeeded' AND _capability='read_client_engagement_status' THEN
    RETURN _result||jsonb_build_object('title','Checked where a client stands',
      'summary','PAIGE read one client''s terms, invoices and delivery to answer you in chat. Nothing was changed.');
  END IF;
  RETURN _result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public._workspace_event_display(text,text,text) IS
  'Rail display for workspace events. E4-S3: delegates to _workspace_event_display_before_exp04_owner_attribution; renders the owner-only set_business_time_zone receipt as the owner''s act (owner_staff) and PAIGE''s two chat reads (read_business_time_zone, read_client_engagement_status) in read words. Every other key is unchanged.';
