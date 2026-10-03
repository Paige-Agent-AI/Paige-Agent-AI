-- Forward-only versioned invoice snapshots; no historical rewrite, issue, send or provider call.
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
  v_line jsonb;
  v_lines jsonb;
  v_key text;
  v_phone text;
  v_email_method uuid;
  v_phone_method uuid;
  v_address jsonb;
  v_agreement_id uuid;
  v_agreement_snapshot jsonb;
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
     OR octet_length(_draft::text) > (CASE WHEN _draft->'schema_version'='2'::jsonb THEN 60000 ELSE 12000 END) THEN
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

  IF _draft ? 'schema_version' THEN
    IF _draft->'schema_version' IS DISTINCT FROM '2'::jsonb OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(_draft) k WHERE k NOT IN
       ('schema_version','client_id','items','kind','deposit_basis_points','currency','cadence',
        'recipient_email','recipient_phone','email_source_method_id','phone_source_method_id',
        'billing_address','agreement_id','processor_intent','payment_method_intents','delivery_channel_intents','due_date','memo'))
      OR jsonb_typeof(_draft->'client_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(_draft->'kind') IS DISTINCT FROM 'string'
      OR _draft->>'currency' IS DISTINCT FROM 'usd'
      OR jsonb_typeof(_draft->'items') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid versioned draft fields' USING ERRCODE='22023';
    END IF;
    v_client := (_draft->>'client_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id=v_client AND tenant_id=v_tenant) THEN
      RAISE EXCEPTION 'Client unavailable' USING ERRCODE='22023';
    END IF;
    v_kind := _draft->>'kind';
    IF v_kind NOT IN ('one_time','deposit','recurring') OR jsonb_array_length(_draft->'items') NOT BETWEEN 1 AND 50
      OR (v_kind='recurring' AND _draft->>'cadence' IS DISTINCT FROM 'monthly')
      OR (v_kind<>'recurring' AND _draft->'cadence' IS DISTINCT FROM 'null'::jsonb) THEN
      RAISE EXCEPTION 'Invalid billing structure' USING ERRCODE='22023';
    END IF;
    IF v_kind='deposit' THEN
      IF jsonb_typeof(_draft->'deposit_basis_points') IS DISTINCT FROM 'number'
        OR (_draft->>'deposit_basis_points') !~ '^[0-9]{1,4}$' THEN
        RAISE EXCEPTION 'Invalid deposit percentage' USING ERRCODE='22023';
      END IF;
      v_bps := (_draft->>'deposit_basis_points')::bigint;
      IF v_bps NOT BETWEEN 1 AND 9999 THEN RAISE EXCEPTION 'Invalid deposit percentage' USING ERRCODE='22023'; END IF;
    ELSIF _draft->'deposit_basis_points' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'Deposit percentage requires deposit kind' USING ERRCODE='22023';
    END IF;
    v_total := 0; v_lines := '[]'::jsonb;
    FOR v_line IN SELECT value FROM jsonb_array_elements(_draft->'items') LOOP
      IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(v_line) k WHERE k NOT IN ('price_id','item','unit_minor','quantity'))
        OR jsonb_typeof(v_line->'item') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'number'
        OR (v_line->>'quantity') !~ '^[0-9]{1,4}$' THEN
        RAISE EXCEPTION 'Invalid invoice item' USING ERRCODE='22023';
      END IF;
      v_item := btrim(v_line->>'item'); v_quantity := (v_line->>'quantity')::bigint;
      IF length(v_item) NOT BETWEEN 1 AND 200 OR v_quantity NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Invalid item or quantity' USING ERRCODE='22023';
      END IF;
      v_price_id := NULL; v_price := NULL; v_product := NULL;
      IF v_line->>'price_id' IS NOT NULL THEN
        IF jsonb_typeof(v_line->'price_id') IS DISTINCT FROM 'string' OR v_line->'unit_minor' IS DISTINCT FROM 'null'::jsonb THEN
          RAISE EXCEPTION 'Catalogue price cannot override unit amount' USING ERRCODE='22023';
        END IF;
        v_price_id := (v_line->>'price_id')::uuid;
        SELECT * INTO v_price FROM public.tenant_prices WHERE id=v_price_id AND tenant_id=v_tenant AND active;
        IF NOT FOUND THEN RAISE EXCEPTION 'Price unavailable' USING ERRCODE='22023'; END IF;
        SELECT * INTO v_product FROM public.tenant_products WHERE id=v_price.product_id AND tenant_id=v_tenant AND status='active';
        IF NOT FOUND OR lower(v_price.currency)<>'usd'
          OR (v_kind='recurring' AND (v_price.billing_interval IS DISTINCT FROM 'month' OR v_price.interval_count IS DISTINCT FROM 1))
          OR (v_kind<>'recurring' AND v_price.billing_interval IS DISTINCT FROM 'one_time') THEN
          RAISE EXCEPTION 'Price unavailable for this draft' USING ERRCODE='22023';
        END IF;
        v_unit := v_price.unit_amount;
      ELSE
        IF v_line->'price_id' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(v_line->'unit_minor') IS DISTINCT FROM 'number'
          OR (v_line->>'unit_minor') !~ '^[0-9]{1,10}$' THEN
          RAISE EXCEPTION 'Invalid custom amount' USING ERRCODE='22023';
        END IF;
        v_unit := (v_line->>'unit_minor')::bigint;
      END IF;
      IF v_unit IS NULL OR v_unit NOT BETWEEN 1 AND 2147483647 OR v_total+v_unit*v_quantity > 2147483647 THEN
        RAISE EXCEPTION 'Amount outside supported range' USING ERRCODE='22023';
      END IF;
      v_total := v_total+v_unit*v_quantity;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('price_id',v_price_id,'item',v_item,
        'unit_minor',v_unit,'quantity',v_quantity,'price_snapshot',CASE WHEN v_price_id IS NOT NULL THEN
          jsonb_build_object('price_id',v_price.id,'product_id',v_product.id,'product_name',v_product.name,'unit_minor',v_unit,
            'currency','usd','billing_interval',v_price.billing_interval,'interval_count',v_price.interval_count) END));
    END LOOP;
    v_due := CASE WHEN v_kind='deposit' THEN (v_total*v_bps+5000)/10000 ELSE v_total END;
    IF v_due<1 OR (v_kind='deposit' AND v_due>=v_total) THEN
      RAISE EXCEPTION 'Deposit must leave a positive due and remainder' USING ERRCODE='22023';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['recipient_email','recipient_phone','memo','due_date','processor_intent',
      'email_source_method_id','phone_source_method_id','agreement_id'] LOOP
      IF NOT (_draft ? v_key) OR jsonb_typeof(_draft->v_key) NOT IN ('string','null') THEN
        RAISE EXCEPTION 'Invalid optional draft fields' USING ERRCODE='22023';
      END IF;
    END LOOP;
    v_email := nullif(btrim(_draft->>'recipient_email'),''); v_phone := nullif(btrim(_draft->>'recipient_phone'),'');
    v_memo := nullif(btrim(_draft->>'memo'),'');
    IF length(v_email)>254 OR (v_email IS NOT NULL AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
      OR length(v_phone)>40 OR (v_phone IS NOT NULL AND (v_phone !~ '^\+?[0-9 ()\-.]+$'
        OR length(regexp_replace(v_phone,'[^0-9]','','g')) NOT BETWEEN 7 AND 15)) OR length(v_memo)>2000
      OR (nullif(_draft->>'processor_intent','') IS NOT NULL AND (_draft->>'processor_intent') !~ '^[a-z][a-z0-9_-]{0,79}$')
      THEN
      RAISE EXCEPTION 'Invalid contact or delivery intent' USING ERRCODE='22023';
    END IF;
    -- A selected known method is exact provenance; manual overrides carry no method id.
    v_email_method := nullif(_draft->>'email_source_method_id','')::uuid;
    v_phone_method := nullif(_draft->>'phone_source_method_id','')::uuid;
    IF (v_email_method IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.client_contact_methods
      WHERE id=v_email_method AND tenant_id=v_tenant AND client_id=v_client AND kind='email' AND btrim(value)=v_email))
      OR (v_phone_method IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.client_contact_methods
      WHERE id=v_phone_method AND tenant_id=v_tenant AND client_id=v_client AND kind='phone' AND btrim(value)=v_phone)) THEN
      RAISE EXCEPTION 'Contact method unavailable' USING ERRCODE='22023';
    END IF;
    v_address := NULL;
    IF _draft->'billing_address' IS DISTINCT FROM 'null'::jsonb THEN
      IF jsonb_typeof(_draft->'billing_address') IS DISTINCT FROM 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(_draft->'billing_address') k WHERE k NOT IN ('line1','line2','city','region','postal_code','country')) THEN
        RAISE EXCEPTION 'Invalid billing address' USING ERRCODE='22023';
      END IF;
      v_address := '{}'::jsonb;
      FOREACH v_key IN ARRAY ARRAY['line1','line2','city','region','postal_code','country'] LOOP
        IF NOT ((_draft->'billing_address') ? v_key) OR jsonb_typeof(_draft->'billing_address'->v_key) NOT IN ('string','null')
          OR length(_draft->'billing_address'->>v_key)>(CASE WHEN v_key IN ('line1','line2') THEN 200 ELSE 100 END) THEN
          RAISE EXCEPTION 'Invalid billing address field' USING ERRCODE='22023';
        END IF;
        v_address := v_address || jsonb_build_object(v_key,nullif(btrim(_draft->'billing_address'->>v_key),''));
      END LOOP;
    END IF;
    v_agreement_id := nullif(_draft->>'agreement_id','')::uuid; v_agreement_snapshot := NULL;
    IF v_agreement_id IS NOT NULL THEN
      SELECT jsonb_build_object('id',id,'title',title,'version',version,'status',status) INTO v_agreement_snapshot
        FROM public.paige_agreements WHERE id=v_agreement_id AND tenant_id=v_tenant AND contact_id=v_client
        AND status IN ('draft','sent','viewed','partially_signed','completed') AND (expires_at IS NULL OR expires_at>now());
      IF NOT FOUND THEN RAISE EXCEPTION 'Agreement unavailable' USING ERRCODE='22023'; END IF;
    END IF;
    IF jsonb_typeof(_draft->'payment_method_intents') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid payment method intent' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(_draft->'delivery_channel_intents') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid delivery channel intent' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(_draft->'delivery_channel_intents')>2 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(_draft->'delivery_channel_intents') m
      WHERE jsonb_typeof(m)<>'string' OR (m#>>'{}') NOT IN ('email','sms'))
      OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(_draft->'delivery_channel_intents')) THEN
      RAISE EXCEPTION 'Invalid delivery channel intent' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(_draft->'payment_method_intents')>12 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(_draft->'payment_method_intents') m
      WHERE jsonb_typeof(m)<>'string' OR (m#>>'{}') !~ '^[a-z][a-z0-9_]{0,63}$')
      OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(_draft->'payment_method_intents')) THEN
      RAISE EXCEPTION 'Invalid payment method intent' USING ERRCODE='22023';
    END IF;
    IF nullif(_draft->>'due_date','') IS NOT NULL THEN
      IF (_draft->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid due date' USING ERRCODE='22023'; END IF;
      v_date := (_draft->>'due_date')::date;
    END IF;
    v_snapshot := jsonb_build_object('schema_version',2,'client_id',v_client,'items',v_lines,
      'kind',v_kind,'deposit_basis_points',v_bps,'currency','usd','cadence',CASE WHEN v_kind='recurring' THEN 'monthly' END,
      'recipient_email',v_email,'recipient_phone',v_phone,'email_source_method_id',v_email_method,'phone_source_method_id',v_phone_method,
      'billing_address',v_address,'agreement_id',v_agreement_id,'agreement_snapshot',v_agreement_snapshot,
      'processor_intent',nullif(_draft->>'processor_intent',''),'payment_method_intents',_draft->'payment_method_intents',
      'delivery_channel_intents',_draft->'delivery_channel_intents','due_date',v_date,'memo',v_memo,
      'total_minor',v_total,'due_now_minor',v_due,'remainder_minor',v_total-v_due);
  ELSE

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
  END IF; -- payload schema branch; CAS revision remains separate.
  IF v_exists THEN
    UPDATE public.paige_invoices SET contact_id=v_client, amount_total_cents=v_total::integer,
      currency='USD',line_items=coalesce(v_lines,jsonb_build_array(v_snapshot)),due_date=v_date,memo=v_memo,
      billing_draft_version=_expected_version+1,billing_draft=v_snapshot,
      billing_last_operation_id=_operation_id,billing_last_request=v_request
      WHERE id=_invoice_id AND tenant_id=v_tenant RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,
      amount_total_cents,currency,line_items,due_date,memo,created_by,
      billing_draft_version,billing_draft,billing_last_operation_id,billing_last_request)
    VALUES (_invoice_id,v_tenant,v_client,'DRAFT-'||_invoice_id::text,'draft',v_total::integer,
      'USD',coalesce(v_lines,jsonb_build_array(v_snapshot)),v_date,v_memo,v_actor,1,v_snapshot,_operation_id,v_request)
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

