-- Human-authored, internal-only billing drafts. No issue/send/provider operation.
-- Legacy invoices remain untouched; nullable marker separates managed drafts.
ALTER TABLE public.paige_invoices
  ADD COLUMN IF NOT EXISTS billing_draft_version bigint,
  ADD COLUMN IF NOT EXISTS billing_draft jsonb,
  ADD COLUMN IF NOT EXISTS billing_last_operation_id uuid,
  ADD COLUMN IF NOT EXISTS billing_last_request jsonb;

-- Restrictive policies intersect existing permissive policies, without widening grants.
DROP POLICY IF EXISTS sales_draft_select_guard ON public.paige_invoices;
CREATE POLICY sales_draft_select_guard ON public.paige_invoices AS RESTRICTIVE
FOR SELECT TO authenticated USING (
  (billing_draft_version IS NULL AND billing_draft IS NULL
   AND billing_last_operation_id IS NULL AND billing_last_request IS NULL)
  OR (auth.uid() IS NOT NULL AND tenant_id = public.current_user_tenant_id()
      AND public.is_tenant_admin(tenant_id))
);
DROP POLICY IF EXISTS sales_draft_insert_guard ON public.paige_invoices;
CREATE POLICY sales_draft_insert_guard ON public.paige_invoices AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (
  billing_draft_version IS NULL AND billing_draft IS NULL
  AND billing_last_operation_id IS NULL AND billing_last_request IS NULL
);
DROP POLICY IF EXISTS sales_draft_update_guard ON public.paige_invoices;
CREATE POLICY sales_draft_update_guard ON public.paige_invoices AS RESTRICTIVE
FOR UPDATE TO authenticated USING (
  billing_draft_version IS NULL AND billing_draft IS NULL
  AND billing_last_operation_id IS NULL AND billing_last_request IS NULL
) WITH CHECK (
  billing_draft_version IS NULL AND billing_draft IS NULL
  AND billing_last_operation_id IS NULL AND billing_last_request IS NULL
);
DROP POLICY IF EXISTS sales_draft_delete_guard ON public.paige_invoices;
CREATE POLICY sales_draft_delete_guard ON public.paige_invoices AS RESTRICTIVE
FOR DELETE TO authenticated USING (
  billing_draft_version IS NULL AND billing_draft IS NULL
  AND billing_last_operation_id IS NULL AND billing_last_request IS NULL
);

CREATE OR REPLACE FUNCTION public.save_sales_billing_draft(
  _expected_tenant_id uuid, _invoice_id uuid, _expected_version bigint,
  _operation_id uuid, _draft jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid := public.current_user_tenant_id();
  v_row public.paige_invoices%ROWTYPE;
  v_exists boolean;
  v_request jsonb;
  v_client uuid;
  v_price_id uuid;
  v_price public.tenant_prices%ROWTYPE;
  v_product public.tenant_products%ROWTYPE;
  v_unit bigint;
  v_quantity bigint;
  v_total bigint;
  v_due bigint;
  v_bps bigint;
  v_kind text;
  v_item text;
  v_email text;
  v_memo text;
  v_date date;
  v_snapshot jsonb;
BEGIN
  -- Resolve caller/workspace and role before any caller-selected object lookup.
  IF v_actor IS NULL OR v_tenant IS NULL
     OR _expected_tenant_id IS DISTINCT FROM v_tenant
     OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'Billing draft access refused' USING ERRCODE = '42501';
  END IF;
  IF _invoice_id IS NULL OR _operation_id IS NULL OR _expected_version IS NULL
     OR _expected_version < 0 OR _expected_version >= 9223372036854775807 THEN
    RAISE EXCEPTION 'Invalid draft identity or version' USING ERRCODE = '22023';
  END IF;
  IF _draft IS NULL OR jsonb_typeof(_draft) <> 'object'
     OR octet_length(_draft::text) > 12000 THEN
    RAISE EXCEPTION 'Invalid draft input' USING ERRCODE = '22023';
  END IF;
  v_request := jsonb_build_object('expected_version', _expected_version, 'draft', _draft);
  -- Serialize both create and edit on draft identity. Hash collisions only serialize.
  PERFORM pg_advisory_xact_lock(hashtextextended(_invoice_id::text, 81741));
  SELECT * INTO v_row FROM public.paige_invoices
    WHERE id = _invoice_id AND tenant_id = v_tenant FOR UPDATE;
  v_exists := FOUND;
  IF v_exists THEN
    IF v_row.billing_draft_version IS NULL OR v_row.status <> 'draft'
       OR v_row.hosted_invoice_url IS NOT NULL OR v_row.stripe_invoice_id IS NOT NULL
       OR v_row.sent_at IS NOT NULL OR v_row.paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'Draft unavailable' USING ERRCODE = '22023';
    END IF;
    IF v_row.billing_last_operation_id = _operation_id THEN
      IF v_row.billing_last_request IS DISTINCT FROM v_request THEN
        RAISE EXCEPTION 'Operation reused with different input' USING ERRCODE = '22023';
      END IF;
      -- Replay readback before any mutable catalogue validation/recalculation.
      RETURN jsonb_build_object('row', to_jsonb(v_row));
    END IF;
    IF v_row.billing_draft_version <> _expected_version THEN
      RAISE EXCEPTION 'Draft version conflict' USING ERRCODE = '40001';
    END IF;
  ELSIF _expected_version <> 0 THEN
    RAISE EXCEPTION 'Draft version conflict' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_object_keys(_draft) k WHERE k NOT IN
    ('client_id','price_id','item','unit_minor','quantity','kind','deposit_basis_points',
     'provider','currency','due_date','recipient_email','memo','cadence')) THEN
    RAISE EXCEPTION 'Unsupported draft field' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_draft->'client_id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(_draft->'item') IS DISTINCT FROM 'string'
     OR jsonb_typeof(_draft->'kind') IS DISTINCT FROM 'string'
     OR jsonb_typeof(_draft->'provider') IS DISTINCT FROM 'string'
     OR _draft->>'provider' NOT IN ('stripe','paypal')
     OR _draft->>'currency' IS DISTINCT FROM 'usd'
     OR jsonb_typeof(_draft->'quantity') IS DISTINCT FROM 'number'
     OR (_draft->>'quantity') !~ '^[0-9]{1,4}$' THEN
    RAISE EXCEPTION 'Invalid draft fields' USING ERRCODE = '22023';
  END IF;
  v_client := (_draft->>'client_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Client unavailable' USING ERRCODE = '22023';
  END IF;
  v_kind := _draft->>'kind';
  v_item := btrim(_draft->>'item');
  v_quantity := (_draft->>'quantity')::bigint;
  IF v_kind NOT IN ('one_time','deposit','recurring') OR length(v_item) NOT BETWEEN 1 AND 200
     OR v_quantity NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid item or quantity' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'recurring' THEN
    IF _draft->>'cadence' IS DISTINCT FROM 'monthly' THEN
      RAISE EXCEPTION 'Only monthly draft cadence is supported' USING ERRCODE = '22023';
    END IF;
  ELSIF _draft ? 'cadence' AND _draft->'cadence' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Cadence requires recurring kind' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'deposit' THEN
    IF jsonb_typeof(_draft->'deposit_basis_points') IS DISTINCT FROM 'number'
       OR (_draft->>'deposit_basis_points') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'Invalid deposit percentage' USING ERRCODE = '22023';
    END IF;
    v_bps := (_draft->>'deposit_basis_points')::bigint;
    IF v_bps NOT BETWEEN 1 AND 9999 THEN
      RAISE EXCEPTION 'Invalid deposit percentage' USING ERRCODE = '22023';
    END IF;
  ELSIF _draft ? 'deposit_basis_points' AND _draft->'deposit_basis_points' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Deposit percentage requires deposit kind' USING ERRCODE = '22023';
  END IF;

  IF _draft->>'price_id' IS NOT NULL THEN
    IF jsonb_typeof(_draft->'price_id') <> 'string'
       OR (_draft ? 'unit_minor' AND _draft->'unit_minor' <> 'null'::jsonb) THEN
      RAISE EXCEPTION 'Catalogue price cannot override unit amount' USING ERRCODE = '22023';
    END IF;
    v_price_id := (_draft->>'price_id')::uuid;
    SELECT * INTO v_price FROM public.tenant_prices
      WHERE id = v_price_id AND tenant_id = v_tenant AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Price unavailable' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_product FROM public.tenant_products
      WHERE id = v_price.product_id AND tenant_id = v_tenant AND status = 'active';
    IF NOT FOUND OR lower(v_price.currency) <> 'usd'
       OR (v_kind = 'recurring' AND (v_price.billing_interval IS DISTINCT FROM 'month'
                                   OR v_price.interval_count IS DISTINCT FROM 1))
       OR (v_kind <> 'recurring' AND v_price.billing_interval IS DISTINCT FROM 'one_time') THEN
      RAISE EXCEPTION 'Price unavailable for this draft' USING ERRCODE = '22023';
    END IF;
    v_unit := v_price.unit_amount;
  ELSE
    IF jsonb_typeof(_draft->'unit_minor') IS DISTINCT FROM 'number'
       OR (_draft->>'unit_minor') !~ '^[0-9]{1,10}$' THEN
      RAISE EXCEPTION 'Invalid custom amount' USING ERRCODE = '22023';
    END IF;
    v_unit := (_draft->>'unit_minor')::bigint;
  END IF;
  v_total := v_unit * v_quantity;
  IF v_unit < 1 OR v_total NOT BETWEEN 1 AND 2147483647 THEN
    RAISE EXCEPTION 'Amount outside supported range' USING ERRCODE = '22023';
  END IF;
  v_due := CASE WHEN v_kind = 'deposit' THEN (v_total * v_bps + 5000) / 10000 ELSE v_total END;
  IF v_due < 1 OR (v_kind = 'deposit' AND v_due >= v_total) THEN
    RAISE EXCEPTION 'Deposit must leave a positive due and remainder' USING ERRCODE = '22023';
  END IF;
  IF (_draft ? 'memo' AND jsonb_typeof(_draft->'memo') NOT IN ('string','null'))
     OR (_draft ? 'recipient_email' AND jsonb_typeof(_draft->'recipient_email') NOT IN ('string','null'))
     OR (_draft ? 'due_date' AND jsonb_typeof(_draft->'due_date') NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'Invalid optional draft fields' USING ERRCODE = '22023';
  END IF;
  v_memo := nullif(btrim(_draft->>'memo'), '');
  v_email := nullif(btrim(_draft->>'recipient_email'), '');
  IF length(v_memo) > 2000 OR length(v_email) > 254
     OR (v_email IS NOT NULL AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'Invalid memo or recipient' USING ERRCODE = '22023';
  END IF;
  IF nullif(_draft->>'due_date','') IS NOT NULL THEN
    IF (_draft->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Invalid due date' USING ERRCODE = '22023';
    END IF;
    v_date := (_draft->>'due_date')::date;
  END IF;
  v_snapshot := jsonb_build_object(
    'client_id',v_client,'price_id',v_price_id,'item',v_item,'unit_minor',v_unit,
    'quantity',v_quantity,'kind',v_kind,'deposit_basis_points',v_bps,
    'provider',_draft->>'provider','currency','usd','cadence',CASE WHEN v_kind='recurring' THEN 'monthly' END,
    'due_date',v_date,'recipient_email',v_email,'memo',v_memo,
    'total_minor',v_total,'due_now_minor',v_due,'remainder_minor',v_total-v_due,
    'price_snapshot',CASE WHEN v_price_id IS NOT NULL THEN jsonb_build_object(
       'price_id',v_price.id,'product_id',v_product.id,'product_name',v_product.name,
       'unit_minor',v_unit,'currency','usd','billing_interval',v_price.billing_interval,
       'interval_count',v_price.interval_count) END
  );
  IF v_exists THEN
    UPDATE public.paige_invoices SET contact_id=v_client, amount_total_cents=v_total::integer,
      currency='USD',line_items=jsonb_build_array(v_snapshot),due_date=v_date,memo=v_memo,
      billing_draft_version=_expected_version+1,billing_draft=v_snapshot,
      billing_last_operation_id=_operation_id,billing_last_request=v_request
      WHERE id=_invoice_id AND tenant_id=v_tenant RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,
      amount_total_cents,currency,line_items,due_date,memo,created_by,
      billing_draft_version,billing_draft,billing_last_operation_id,billing_last_request)
    VALUES (_invoice_id,v_tenant,v_client,'DRAFT-'||_invoice_id::text,'draft',v_total::integer,
      'USD',jsonb_build_array(v_snapshot),v_date,v_memo,v_actor,1,v_snapshot,_operation_id,v_request)
    ON CONFLICT DO NOTHING RETURNING * INTO v_row;
    IF NOT FOUND THEN
      -- Same refusal for collision in another tenant and any unavailable identity.
      RAISE EXCEPTION 'Draft unavailable' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN jsonb_build_object('row',to_jsonb(v_row));
END;
$$;
REVOKE ALL ON FUNCTION public.save_sales_billing_draft(uuid,uuid,bigint,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_sales_billing_draft(uuid,uuid,bigint,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_sales_billing_drafts(
  _expected_tenant_id uuid, _limit integer DEFAULT 50, _before_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant uuid := public.current_user_tenant_id();
  v_rows jsonb;
  v_more boolean;
  v_cursor uuid;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL
     OR _expected_tenant_id IS DISTINCT FROM v_tenant
     OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'Billing draft access refused' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid list limit' USING ERRCODE = '22023';
  END IF;
  WITH candidates AS (
    SELECT * FROM public.paige_invoices WHERE tenant_id=v_tenant
      AND billing_draft_version IS NOT NULL AND status='draft'
      AND (_before_id IS NULL OR id < _before_id)
    ORDER BY id DESC LIMIT _limit+1
  ), page AS (SELECT * FROM candidates ORDER BY id DESC LIMIT _limit)
  SELECT coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY id DESC) FROM page),'[]'::jsonb),
    (SELECT count(*) > _limit FROM candidates),(SELECT id FROM page ORDER BY id LIMIT 1)
    INTO v_rows,v_more,v_cursor;
  RETURN jsonb_build_object('rows',v_rows,'has_more',v_more,
    'next_cursor',CASE WHEN v_more THEN v_cursor END);
END;
$$;
REVOKE ALL ON FUNCTION public.list_sales_billing_drafts(uuid,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sales_billing_drafts(uuid,integer,uuid) TO authenticated;

-- Shared legacy/provider writers cannot turn this managed draft into an issued invoice.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.paige_invoices'::regclass
    AND conname='sales_billing_draft_shape') THEN
    ALTER TABLE public.paige_invoices ADD CONSTRAINT sales_billing_draft_shape CHECK (
      (billing_draft_version IS NULL AND billing_draft IS NULL
       AND billing_last_operation_id IS NULL AND billing_last_request IS NULL)
      OR (billing_draft_version IS NOT NULL AND billing_draft_version >= 1
          AND billing_draft IS NOT NULL AND jsonb_typeof(billing_draft)='object'
          AND billing_last_operation_id IS NOT NULL AND billing_last_request IS NOT NULL
          AND status='draft' AND hosted_invoice_url IS NULL AND stripe_invoice_id IS NULL
          AND sent_at IS NULL AND sent_to_email IS NULL AND paid_at IS NULL)
    );
  END IF;
END $$;
