-- E09 Journey & Progress: the customer sees ONLY the work the business explicitly shares.
-- public.plan_items stays the one canonical per-client work store (§18); no new task table, no new
-- RLS policy, plan_items writes stay RPC-only. Additive, all rows private by default (no backfill):
--   * plan_items.client_shared_at / client_shared_by — the explicit per-item share marker.
--   * plan_item_set_client_share  — the ONE writer of the marker: current-workspace business admin,
--     version-guarded, state-idempotent, audited into the planning audit sink (public.audit_logs,
--     entity 'plan_item', the sink plan_update_item writes; 20260712010000:53-54).
--   * client_portal_progress      — the customer's read: shared, non-cancelled milestones/tasks of the
--     caller's OWN relationship, title/state/due only. Customers cannot complete progress items.
--   * read_client_engagement_status — restated from its latest body (20271031005000:115-246) with
--     additive per-item `shared` + `updated_at`, a `shared` count and an item cap of 50.
--   * paige_customer_actions — the anon/authenticated table-level SELECT is narrowed to the ten
--     columns its readers use; initiated_by_admin_id and payload_json stop leaking to API roles.
--   * list_tool_autonomy — catalogue metadata only: plan_item_set_client_share becomes a row the
--     owner can see and turn off (rename-and-delegate, the 20271109010000 pattern).
BEGIN;

-- ── 1a. The share marker ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.plan_items
  ADD COLUMN client_shared_at timestamptz,
  ADD COLUMN client_shared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- Every write path, service role included: only a client-linked milestone or task can be shared.
ALTER TABLE public.plan_items ADD CONSTRAINT plan_items_client_share_shape CHECK (
  client_shared_at IS NULL OR (contact_id IS NOT NULL AND item_type IN ('milestone','task')));
CREATE INDEX idx_pi_client_shared ON public.plan_items(tenant_id, contact_id)
  WHERE client_shared_at IS NOT NULL;

-- A share is made TO one client, for work that is still going ahead. Every write path, service
-- role included, clears it when either stops being true:
--   * the client changes. plan_items.contact_id is ON DELETE SET NULL, and the referential SET NULL
--     runs as an UPDATE on this row, so without this the CHECK above would make deleting a client
--     fail. Re-pointing an item at a different client never carries the share across either.
--   * the item is cancelled. Reopening it later must not put it back in front of the client
--     without a new explicit share (owner decision D2; integrator ruling, round 2).
CREATE OR REPLACE FUNCTION public._plan_items_client_share_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.status = 'cancelled' THEN
    NEW.client_shared_at := NULL;
    NEW.client_shared_by := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._plan_items_client_share_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_plan_items_client_share_guard
  BEFORE UPDATE OF contact_id, status ON public.plan_items
  FOR EACH ROW EXECUTE FUNCTION public._plan_items_client_share_guard();

-- ── 1b. The owner's writer ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plan_item_set_client_share(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_item_id uuid, p_shared boolean,
  p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_account_type text;
  v_parent uuid;
  v_row public.plan_items%ROWTYPE;
  v_linked uuid;
  v_shared_at timestamptz;
  v_updated_at timestamptz;
BEGIN
  -- 1. Caller: the session subject, and the caller's own expectation of who they are.
  IF v_actor IS NULL OR p_expected_actor_id IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id
     OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  -- A workspace switch updates this same profile row; holding its lock serializes against it.
  PERFORM 1 FROM public.profiles WHERE user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE = '42501'; END IF;
  -- 2. Workspace and role: the current workspace, business owner/admin of it. Never a global role (§59).
  v_tenant := public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  IF p_item_id IS NULL OR p_shared IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  END IF;
  -- 3. Tier: a top-level agency manages sub-accounts, not a direct client book (§61 exception).
  SELECT t.account_type::text, t.parent_tenant_id INTO v_account_type, v_parent
  FROM public.tenants t WHERE t.id = v_tenant;
  IF v_account_type = 'agency' AND v_parent IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_SHARE_UNAVAILABLE');
  END IF;
  -- 4. Load. Another workspace's item is indistinguishable from a missing one.
  SELECT * INTO v_row FROM public.plan_items
  WHERE id = p_item_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ITEM_NOT_FOUND'); END IF;
  -- 5. Shape. Only a client-linked milestone or task is ever shareable.
  IF v_row.contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEM_NOT_CLIENT_LINKED');
  END IF;
  IF v_row.item_type NOT IN ('milestone','task') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEM_NOT_SHAREABLE');
  END IF;
  SELECT c.linked_user_id INTO v_linked FROM public.clients c
  WHERE c.id = v_row.contact_id AND c.tenant_id = v_tenant AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL
  FOR SHARE OF c;
  -- Sharing needs a live client. Withdrawing a share never does: unsharing is always allowed.
  IF NOT FOUND AND p_shared THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND');
  END IF;
  -- 6. State replay: a retry of a change that already landed answers from the row, writes nothing.
  IF (v_row.client_shared_at IS NOT NULL) = p_shared THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'item_id', v_row.id, 'shared', p_shared,
      'shared_at', v_row.client_shared_at, 'updated_at', v_row.updated_at);
  END IF;
  -- 7. Version: the owner shares exactly the title and status they last saw.
  IF p_expected_updated_at IS NULL OR v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEM_CHANGED', 'updated_at', v_row.updated_at);
  END IF;
  -- 8. Status: a cancelled item is never newly shown to a client.
  IF p_shared AND v_row.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEM_NOT_SHAREABLE');
  END IF;
  -- 9. Write.
  UPDATE public.plan_items SET
    client_shared_at = CASE WHEN p_shared THEN now() END,
    client_shared_by = CASE WHEN p_shared THEN v_actor END
  WHERE id = v_row.id
  RETURNING client_shared_at, updated_at INTO v_shared_at, v_updated_at;
  -- 10. Audit, in the planning audit sink. Fixed references only, never item prose.
  INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
  VALUES (v_actor, 'plan_item', CASE WHEN p_shared THEN 'plan_item.client_share' ELSE 'plan_item.client_unshare' END,
    v_row.id, jsonb_build_object('tenant_id', v_tenant, 'contact_id', v_row.contact_id, 'item_id', v_row.id));
  -- 11. Result. portal_connected says whether the client can see it yet.
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'item_id', v_row.id, 'shared', p_shared,
    'shared_at', v_shared_at, 'updated_at', v_updated_at, 'portal_connected', v_linked IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.plan_item_set_client_share(uuid, uuid, uuid, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.plan_item_set_client_share(uuid, uuid, uuid, boolean, timestamptz) TO authenticated;
COMMENT ON FUNCTION public.plan_item_set_client_share(uuid, uuid, uuid, boolean, timestamptz) IS
  'E09 Progress: the only writer of plan_items.client_shared_*. Business owner/admin of the current workspace; never a top-level agency. Version-guarded on updated_at; state-idempotent (a repeat returns replayed:true and writes nothing). Audited to audit_logs as plan_item.client_share / plan_item.client_unshare. No notification is sent.';

-- ── 1c. The customer's read ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_portal_progress(p_tenant_id uuid DEFAULT NULL, p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  _summary jsonb;
  _items jsonb;
  _has_more boolean;
  _now timestamptz := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  -- 42501 "select an authorized customer relationship" (more than one business) propagates as is.
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  -- Re-prove the relationship; the business is the client's own, never the argument's.
  SELECT c.tenant_id INTO _tenant FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active';
  IF _tenant IS NULL THEN RETURN NULL; END IF;

  -- Explicit allowlist. Summary text, priority, assignee, creator, sharer, plan, metadata, links and
  -- reminders are never projected. blocked reads as in_progress (owner decision D3).
  WITH visible AS (
    SELECT i.* FROM public.plan_items i
    WHERE i.tenant_id = _tenant AND i.contact_id = _client_id AND i.client_shared_at IS NOT NULL
      AND i.item_type IN ('milestone','task') AND i.status <> 'cancelled'
  ), ranked AS (
    SELECT v.*, row_number() OVER (ORDER BY (v.status = 'done'),
        CASE WHEN v.status <> 'done' THEN v.due_at END ASC NULLS LAST,
        CASE WHEN v.status = 'done' THEN v.completed_at END DESC NULLS LAST, v.id) AS rn
    FROM visible v
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'kind', r.item_type,
      'title', left(r.title, 200),
      'state', CASE r.status WHEN 'done' THEN 'done' WHEN 'open' THEN 'not_started' ELSE 'in_progress' END,
      'due_at', r.due_at,
      'completed_at', r.completed_at,
      'shared_at', r.client_shared_at,
      -- Only a parent the customer can see themselves; never a pointer at private work.
      'parent_id', (SELECT p.id FROM visible p WHERE p.id = r.parent_item_id AND p.item_type = 'milestone'))
      ORDER BY r.rn) FILTER (WHERE r.rn <= _limit), '[]'::jsonb),
    count(*) > _limit,
    jsonb_build_object(
      'shared', count(*),
      'done', count(*) FILTER (WHERE r.status = 'done'),
      'open', count(*) FILTER (WHERE r.status <> 'done'),
      'overdue', count(*) FILTER (WHERE r.status <> 'done' AND r.due_at IS NOT NULL AND r.due_at < _now))
  INTO _items, _has_more, _summary
  FROM ranked r;
  RETURN jsonb_build_object('tenant_id', _tenant, 'server_now', _now, 'summary', _summary,
    'items', _items, 'has_more', _has_more);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_progress(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_progress(uuid, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.client_portal_progress(uuid, integer) IS
  'E09 Progress: customer-safe projection of the work the business explicitly shared with the caller''s own relationship (shared, non-cancelled milestones and tasks). Title, state, due and done dates only; blocked reads as in_progress. Read-only: customers cannot complete progress items.';

-- ── 1e. read_client_engagement_status: additive share state ────────────────────────────────────
-- Restated from 20271031005000:115-246 (byte-identical to the live body, checked), changing only the
-- delivery-work block: + work.shared, + items[].shared / items[].updated_at, cap 20 -> 50.
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
 -- `shared` counts what this client can see in their portal (E09 Progress): shared and not
 -- cancelled, the same rule as client_portal_progress's summary.shared.
 SELECT jsonb_build_object(
   'total',count(*),
   'done',count(*) FILTER (WHERE status='done'),
   'cancelled',count(*) FILTER (WHERE status='cancelled'),
   'blocked',count(*) FILTER (WHERE status='blocked'),
   'open',count(*) FILTER (WHERE status IN ('open','in_progress','blocked')),
   'overdue',count(*) FILTER (WHERE status IN ('open','in_progress','blocked') AND due_at IS NOT NULL AND due_at<read_at),
   'undated_open',count(*) FILTER (WHERE status IN ('open','in_progress','blocked') AND due_at IS NULL),
   'shared',count(*) FILTER (WHERE client_shared_at IS NOT NULL AND status<>'cancelled'))
 INTO work_counts FROM public.plan_items
 WHERE tenant_id=_expected_tenant_id AND contact_id=_contact_id AND item_type IN ('milestone','task');

 -- Up to 50 items, so the owner can share past the first page. updated_at is the version the
 -- share writer (plan_item_set_client_share) compares against.
 WITH picked AS (
  SELECT w.* FROM public.plan_items w
  WHERE w.tenant_id=_expected_tenant_id AND w.contact_id=_contact_id AND w.item_type IN ('milestone','task')
  ORDER BY (w.status IN ('done','cancelled')),w.due_at ASC NULLS LAST,w.id LIMIT 51)
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'plan_id',p.plan_id,'item_type',p.item_type,'title',left(p.title,200),'status',p.status,
   'due_at',p.due_at,'completed_at',p.completed_at,'assigned',p.assigned_to_user_id IS NOT NULL,
   'shared',p.client_shared_at IS NOT NULL,'updated_at',p.updated_at)
   ORDER BY rn) FILTER (WHERE rn<=50),'[]'::jsonb),count(*)>50
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
 'Experience 04 E4-S1/S1b/S3: read-only source projection of one client''s terms, signings, invoice balances by evidence class, open payment requests and delivery work, with the business owner''s configured time zone (state + zone) and the owner-local as_of_date. Owner/admin of the active workspace only. Not a ledger, mandate or authority. A pure read: it writes no receipt (the client record displays it; PAIGE''s chat answer is recorded by her executor). E09 Progress: delivery items carry shared + updated_at (up to 50), and work.shared counts what the business shows this client.';

-- ── 1f. paige_customer_actions: stop leaking the proposer and the raw payload ──────────────────
-- §37 inventory (checked before writing this): the only API-role readers are useMyActions (selects
-- exactly the ten columns below), list_pending_customer_actions (INVOKER; selects id, action_type,
-- title, body, status, expires_at, created_at; filters contact_id) and the RLS policies (tenant_id,
-- contact_id, id). Neither dropped column is read by any of them. DEFINER writers run as owner.
REVOKE SELECT ON public.paige_customer_actions FROM anon, authenticated;
GRANT SELECT (id, tenant_id, contact_id, action_type, title, body, status, expires_at, created_at, updated_at)
  ON public.paige_customer_actions TO authenticated;

-- ── 1g. list_tool_autonomy: the owner can see and turn off the new chat control ────────────────
-- Metadata only, in the 20271109010000 pattern: delegate to the complete incumbent first so its
-- authorization and rows survive. No autonomy setting, provider permission or activation changes.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_client_share(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_client_share;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_client_share(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_client_share(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_client_share(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('plan_item_set_client_share','Show or hide work in a client''s portal','Planning')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
   FROM catalog c LEFT JOIN public.tenant_tool_autonomy a
    ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

COMMIT;
