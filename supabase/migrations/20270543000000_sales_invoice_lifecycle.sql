-- First canonical managed-invoice lifecycle. Provider/order writers remain untouched.
ALTER TABLE public.paige_invoices
  ADD COLUMN IF NOT EXISTS billing_lifecycle_version bigint,
  ADD COLUMN IF NOT EXISTS billing_issued_snapshot_version bigint,
  ADD COLUMN IF NOT EXISTS billing_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_issued_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS billing_document jsonb,
  ADD COLUMN IF NOT EXISTS billing_document_digest text;
ALTER TABLE public.paige_invoices DROP CONSTRAINT IF EXISTS paige_invoices_status_check;
ALTER TABLE public.paige_invoices ADD CONSTRAINT paige_invoices_status_check
  CHECK(status IN ('draft','issued','sent','paid','void','uncollectible'));
ALTER TABLE public.paige_invoices DROP CONSTRAINT IF EXISTS sales_billing_draft_shape;
ALTER TABLE public.paige_invoices ADD CONSTRAINT sales_billing_draft_shape CHECK (
  (billing_draft_version IS NULL AND billing_draft IS NULL AND billing_last_operation_id IS NULL AND billing_last_request IS NULL
    AND billing_lifecycle_version IS NULL AND billing_issued_snapshot_version IS NULL AND billing_issued_at IS NULL AND billing_issued_by IS NULL
    AND billing_document IS NULL AND billing_document_digest IS NULL AND status<>'issued')
  OR (billing_draft_version IS NOT NULL AND billing_draft_version>=1 AND billing_draft IS NOT NULL AND jsonb_typeof(billing_draft)='object'
    AND billing_last_operation_id IS NOT NULL AND billing_last_request IS NOT NULL
    AND hosted_invoice_url IS NULL AND stripe_invoice_id IS NULL AND sent_at IS NULL AND sent_to_email IS NULL AND paid_at IS NULL
    AND ((status='draft' AND billing_lifecycle_version IS NULL AND billing_issued_snapshot_version IS NULL AND billing_issued_at IS NULL AND billing_issued_by IS NULL AND billing_document IS NULL AND billing_document_digest IS NULL)
      OR (status IN ('issued','void') AND billing_lifecycle_version IS NOT NULL AND billing_lifecycle_version>billing_draft_version
        AND billing_issued_snapshot_version IS NOT NULL AND billing_document IS NOT NULL AND billing_document_digest IS NOT NULL
        AND billing_issued_snapshot_version=billing_draft_version AND billing_issued_at IS NOT NULL AND billing_issued_by IS NOT NULL
        AND jsonb_typeof(billing_document)='object' AND billing_document_digest ~ '^[0-9a-f]{64}$')))
);

-- Immutable invoice-bound human facts, not provider receipts or a general allocation engine.
CREATE TABLE IF NOT EXISTS public.paige_invoice_payments (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES public.paige_invoices(id),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK(kind IN ('receipt','reversal')),
  amount_cents integer NOT NULL CHECK(amount_cents>0),
  currency text NOT NULL CHECK(currency='usd'),
  method text NOT NULL CHECK(method IN ('zelle','cash','wire','check','bank_transfer','other')),
  received_at timestamptz NOT NULL,
  reference text CHECK(length(reference)<=200),
  notes text CHECK(length(notes)<=2000),
  reverses_payment_id uuid UNIQUE REFERENCES public.paige_invoice_payments(id),
  reason text CHECK(length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((kind='receipt' AND reverses_payment_id IS NULL AND reason IS NULL)
    OR (kind='reversal' AND reverses_payment_id IS NOT NULL AND reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pip_invoice_idx ON public.paige_invoice_payments(tenant_id,invoice_id,created_at,id);

-- Business operation replay metadata, never an approval authority or second job system.
CREATE TABLE IF NOT EXISTS public.paige_invoice_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  invoice_id uuid NOT NULL REFERENCES public.paige_invoices(id),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  command jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Separate share/delivery grants prevent email preparation revoking a customer's prior share link.
CREATE TABLE IF NOT EXISTS public.paige_invoice_access_grants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  invoice_id uuid NOT NULL REFERENCES public.paige_invoices(id),
  issued_snapshot_version bigint NOT NULL,
  scope text NOT NULL CHECK(scope IN ('share','delivery')),
  delivery_operation_id uuid,
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((scope='share' AND delivery_operation_id IS NULL) OR (scope='delivery' AND delivery_operation_id IS NOT NULL))
);
ALTER TABLE public.paige_invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_invoice_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_invoice_access_grants ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_tenant_identity ON public.paige_invoices(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_payment_identity ON public.paige_invoice_payments(tenant_id,invoice_id,id);
ALTER TABLE public.paige_invoice_payments DROP CONSTRAINT IF EXISTS sales_payment_invoice_scope;
ALTER TABLE public.paige_invoice_payments ADD CONSTRAINT sales_payment_invoice_scope FOREIGN KEY(tenant_id,invoice_id) REFERENCES public.paige_invoices(tenant_id,id);
ALTER TABLE public.paige_invoice_payments DROP CONSTRAINT IF EXISTS sales_payment_reversal_scope;
ALTER TABLE public.paige_invoice_payments ADD CONSTRAINT sales_payment_reversal_scope FOREIGN KEY(tenant_id,invoice_id,reverses_payment_id) REFERENCES public.paige_invoice_payments(tenant_id,invoice_id,id);
ALTER TABLE public.paige_invoice_operations DROP CONSTRAINT IF EXISTS sales_operation_invoice_scope;
ALTER TABLE public.paige_invoice_operations ADD CONSTRAINT sales_operation_invoice_scope FOREIGN KEY(tenant_id,invoice_id) REFERENCES public.paige_invoices(tenant_id,id);
ALTER TABLE public.paige_invoice_access_grants DROP CONSTRAINT IF EXISTS sales_grant_invoice_scope;
ALTER TABLE public.paige_invoice_access_grants ADD CONSTRAINT sales_grant_invoice_scope FOREIGN KEY(tenant_id,invoice_id) REFERENCES public.paige_invoices(tenant_id,id);
REVOKE ALL ON public.paige_invoice_payments,public.paige_invoice_operations,public.paige_invoice_access_grants FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._sales_invoice_actor(_actor uuid,_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE active_tenant uuid;
BEGIN
  PERFORM 1 FROM auth.users WHERE id=_actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice actor unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenants WHERE id=_tenant AND status IN ('trial','active','past_due') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
  SELECT active_tenant_id INTO active_tenant FROM public.profiles WHERE user_id=_actor FOR UPDATE;
  IF NOT FOUND OR active_tenant IS DISTINCT FROM _tenant THEN RAISE EXCEPTION 'Active invoice workspace changed' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members WHERE user_id=_actor AND tenant_id=_tenant AND status='active' AND role IN ('owner','admin') FOR UPDATE;
  IF NOT FOUND OR _actor IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'Invoice workspace or authority unavailable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_actor(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._sales_invoice_actor(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_read(_tenant uuid,_invoice uuid,_payment_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.paige_invoices%ROWTYPE; received bigint; payments jsonb; payment_count bigint;
BEGIN
  SELECT * INTO r FROM public.paige_invoices WHERE tenant_id=_tenant AND id=_invoice AND billing_draft_version IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  IF _payment_limit IS NULL OR _payment_limit NOT BETWEEN 0 AND 50 THEN RAISE EXCEPTION 'Invalid receipt limit' USING ERRCODE='22023'; END IF;
  SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0),count(*)
    INTO received,payment_count FROM public.paige_invoice_payments WHERE tenant_id=_tenant AND invoice_id=_invoice;
  SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('actor_label',(SELECT nullif(trim(full_name),'') FROM public.profiles WHERE user_id=p.actor_user_id))||CASE WHEN p.kind='reversal' THEN jsonb_build_object('original_receipt',
    (SELECT to_jsonb(original) FROM public.paige_invoice_payments original WHERE original.id=p.reverses_payment_id AND original.tenant_id=_tenant AND original.invoice_id=_invoice)) ELSE '{}'::jsonb END
    ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO payments FROM
    (SELECT * FROM public.paige_invoice_payments WHERE tenant_id=_tenant AND invoice_id=_invoice ORDER BY created_at DESC,id DESC LIMIT _payment_limit) p;
  RETURN jsonb_build_object('id',r.id,'tenant_id',r.tenant_id,'invoice_number',r.invoice_number,'status',r.status,
    'amount_total_cents',r.amount_total_cents,'currency',lower(r.currency),'billing_draft_version',r.billing_draft_version,
    'billing_draft',r.billing_draft,'version',coalesce(r.billing_lifecycle_version,r.billing_draft_version),
    'issued_snapshot_version',r.billing_issued_snapshot_version,'issued_at',r.billing_issued_at,'issued_by',r.billing_issued_by,
    'document',r.billing_document,'document_input_digest',r.billing_document_digest,
    'manual_recorded_cents',received,'remaining_cents',r.amount_total_cents-received,'payments',payments,'payments_count',payment_count,'payments_has_more',payment_count>_payment_limit,
    'settlement',CASE WHEN r.status='void' THEN 'void' WHEN received=r.amount_total_cents AND received>0 THEN 'manually_recorded_settled'
      WHEN received>0 THEN 'manually_recorded_partial' ELSE 'unpaid' END);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_read(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._sales_invoice_read(uuid,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.read_sales_invoice(_expected_tenant_id uuid,_invoice_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
  PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
  RETURN public._sales_invoice_read(_expected_tenant_id,_invoice_id);
END $$;
REVOKE ALL ON FUNCTION public.read_sales_invoice(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_sales_invoices(_expected_tenant_id uuid,_limit integer DEFAULT 50,_before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb; ids uuid[]; more boolean;
BEGIN
  IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
  PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid invoice page' USING ERRCODE='22023'; END IF;
  SELECT array_agg(id ORDER BY id DESC) INTO ids FROM(SELECT id FROM public.paige_invoices WHERE tenant_id=_expected_tenant_id
    AND billing_draft_version IS NOT NULL AND (_before_id IS NULL OR id<_before_id) ORDER BY id DESC LIMIT _limit+1) q;
  more:=coalesce(array_length(ids,1),0)>_limit;
  SELECT coalesce(jsonb_agg(public._sales_invoice_read(_expected_tenant_id,id,0) ORDER BY id DESC),'[]'::jsonb) INTO rows FROM unnest(ids[1:_limit]) id;
  RETURN jsonb_build_object('rows',rows,'has_more',more,'next_cursor',CASE WHEN more THEN ids[_limit] ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.list_sales_invoices(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_sales_invoices(uuid,integer,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._sales_invoice_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME IN ('paige_invoice_payments','paige_invoice_operations') THEN
    RAISE EXCEPTION 'Invoice history is append-only' USING ERRCODE='42501';
  END IF;
  IF OLD.billing_issued_at IS NOT NULL THEN
    IF TG_OP='DELETE' OR ROW(NEW.tenant_id,NEW.contact_id,NEW.invoice_number,NEW.amount_total_cents,NEW.currency,NEW.line_items,
      NEW.due_date,NEW.memo,NEW.billing_draft,NEW.billing_draft_version,NEW.billing_last_operation_id,NEW.billing_last_request,
      NEW.billing_issued_snapshot_version,NEW.billing_issued_at,NEW.billing_issued_by,NEW.billing_document,NEW.billing_document_digest)
      IS DISTINCT FROM ROW(OLD.tenant_id,OLD.contact_id,OLD.invoice_number,OLD.amount_total_cents,OLD.currency,OLD.line_items,
      OLD.due_date,OLD.memo,OLD.billing_draft,OLD.billing_draft_version,OLD.billing_last_operation_id,OLD.billing_last_request,
      OLD.billing_issued_snapshot_version,OLD.billing_issued_at,OLD.billing_issued_by,OLD.billing_document,OLD.billing_document_digest) THEN
      RAISE EXCEPTION 'Issued invoice facts are immutable' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_immutable() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sales_invoice_frozen ON public.paige_invoices;
CREATE TRIGGER sales_invoice_frozen BEFORE UPDATE OR DELETE ON public.paige_invoices FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_immutable();
DROP TRIGGER IF EXISTS sales_invoice_payment_immutable ON public.paige_invoice_payments;
CREATE TRIGGER sales_invoice_payment_immutable BEFORE UPDATE OR DELETE ON public.paige_invoice_payments FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_immutable();
DROP TRIGGER IF EXISTS sales_invoice_operation_immutable ON public.paige_invoice_operations;
CREATE TRIGGER sales_invoice_operation_immutable BEFORE UPDATE OR DELETE ON public.paige_invoice_operations FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_immutable();

CREATE OR REPLACE FUNCTION public._sales_invoice_governance(_actor uuid,_tenant uuid,_action text,_tool text,_governance jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF _governance->>'actor_user_id' IS DISTINCT FROM _actor::text OR _governance->>'tenant_id' IS DISTINCT FROM _tenant::text
    OR _governance->>'tool' IS DISTINCT FROM _tool OR _governance->>'action' IS DISTINCT FROM _action
    OR _governance->>'approval_channel' IS DISTINCT FROM 'operator_card'
    OR _governance->'decision_receipt_recorded' IS DISTINCT FROM 'true'::jsonb
    OR coalesce(_governance->>'approved_fingerprint','') !~ '^[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'Canonical invoice governance required' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_governance(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._sales_invoice_governance(uuid,uuid,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.read_sales_invoice_command_result(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_operations%ROWTYPE;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  SELECT * INTO op FROM public.paige_invoice_operations WHERE id=_operation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF op.actor_user_id IS DISTINCT FROM _actor_user_id OR op.tenant_id IS DISTINCT FROM _expected_tenant_id OR op.command IS DISTINCT FROM _command
    THEN RAISE EXCEPTION 'Operation reused with different input' USING ERRCODE='22023'; END IF;
  RETURN op.result;
END $$;
REVOKE ALL ON FUNCTION public.read_sales_invoice_command_result(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_command_result(uuid,uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.preview_sales_invoice_command(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.paige_invoices%ROWTYPE; facts jsonb; eligible boolean:=false; summary text; receipt public.paige_invoice_payments%ROWTYPE; amount bigint;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  SELECT * INTO r FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id AND billing_draft_version IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  IF coalesce(r.billing_lifecycle_version,r.billing_draft_version) IS DISTINCT FROM (_command->>'expected_version')::bigint
    THEN RAISE EXCEPTION 'Invoice version conflict' USING ERRCODE='40001'; END IF;
  facts:=public._sales_invoice_read(_expected_tenant_id,r.id);
  CASE _command->>'action'
  WHEN 'invoice.publish' THEN
    eligible:=r.status='draft' AND r.billing_draft->'schema_version'='2'::jsonb AND r.amount_total_cents>0
      AND nullif(r.billing_draft->>'due_date','') IS NOT NULL AND r.billing_draft->>'processor_intent' IS NULL
      AND jsonb_array_length(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb))>0
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb)) m WHERE m NOT IN ('zelle','cash','wire','check','bank_transfer','other'));
    summary:='Publish the saved invoice as a frozen off-platform obligation. No email, online charge or payment receipt is created.';
  WHEN 'invoice.record_manual_payment' THEN
    IF coalesce(_command->>'amount_cents','') ~ '^[1-9][0-9]{0,9}$' THEN amount:=(_command->>'amount_cents')::bigint; END IF;
    eligible:=r.status='issued' AND amount>0 AND amount<=(facts->>'remaining_cents')::bigint AND _command->>'currency'='usd'
      AND coalesce(_command->>'method','') IN ('zelle','cash','wire','check','bank_transfer','other');
    summary:='Record '||coalesce(amount::text,'an invalid amount')||' USD cents received by '||coalesce(_command->>'method','an unavailable method')||' on '||coalesce(_command->>'received_at','an unavailable date')||' for invoice '||r.invoice_number||'. Outstanding after this record: '||(r.amount_total_cents-(facts->>'manual_recorded_cents')::bigint-coalesce(amount,0))::text||' USD cents. This is a human-recorded payment, not provider verification.';
  WHEN 'invoice.reverse_manual_payment' THEN
    SELECT * INTO receipt FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND invoice_id=r.id AND tenant_id=_expected_tenant_id AND kind='receipt';
    eligible:=FOUND AND r.status='issued' AND coalesce(length(trim(_command->>'reason')),0) BETWEEN 1 AND 500
      AND NOT EXISTS(SELECT 1 FROM public.paige_invoice_payments WHERE reverses_payment_id=receipt.id);
    summary:='Append a correction reversing '||coalesce(receipt.amount_cents::text,'the unavailable receipt')||' USD cents. Original receipt remains in history; no money is refunded.';
  WHEN 'invoice.void' THEN
    eligible:=r.status='issued' AND coalesce(length(trim(_command->>'reason')),0) BETWEEN 1 AND 500;
    summary:='Void this obligation and revoke its customer links. Existing human-recorded receipts remain visible; this does not refund a payment.';
  WHEN 'invoice.link_create' THEN
    eligible:=r.status='issued' AND coalesce(_command->>'expires_in_days','') ~ '^[1-9][0-9]?$'
      AND (_command->>'expires_in_days')::integer<=30 AND coalesce(_command->>'grant_scope','share')='share';
    summary:='Create an expiring customer-access link. Previous share links are revoked; delivery links remain independent. No email is sent.';
  ELSE RAISE EXCEPTION 'Unknown invoice action' USING ERRCODE='22023';
  END CASE;
  RETURN jsonb_build_object('invoice_id',r.id,'invoice_number',r.invoice_number,'version',facts->'version','issued_snapshot_version',r.billing_issued_snapshot_version,
    'document_input_digest',r.billing_document_digest,'amount_cents',r.amount_total_cents,'remaining_cents',facts->'remaining_cents',
    'currency',lower(r.currency),'status',r.status,'action',_command->>'action','eligible',coalesce(eligible,false),'summary',summary);
END $$;
REVOKE ALL ON FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.execute_sales_invoice_command(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.paige_invoices%ROWTYPE; receipt public.paige_invoice_payments%ROWTYPE; result jsonb; prior jsonb;
  action text:=_command->>'action'; tool text; amount bigint; received bigint; document jsonb; client jsonb; tenant jsonb;
  grant_id uuid; expiry timestamptz; hash text; scope text; allowed text[]; expected bigint;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  IF _operation_id IS NULL OR jsonb_typeof(_command) IS DISTINCT FROM 'object' OR octet_length(_command::text)>8000 THEN
    RAISE EXCEPTION 'Invalid invoice command' USING ERRCODE='22023'; END IF;
  tool:=CASE action WHEN 'invoice.publish' THEN 'sales_publish_invoice' WHEN 'invoice.record_manual_payment' THEN 'sales_record_manual_payment'
    WHEN 'invoice.reverse_manual_payment' THEN 'sales_reverse_manual_payment' WHEN 'invoice.void' THEN 'sales_void_invoice'
    WHEN 'invoice.link_create' THEN 'sales_create_invoice_link' END;
  IF tool IS NULL THEN RAISE EXCEPTION 'Unknown invoice action' USING ERRCODE='22023'; END IF;
  PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,action,tool,_governance);
  allowed:=ARRAY['action','invoice_id','expected_version'];
  IF action='invoice.record_manual_payment' THEN allowed:=allowed||ARRAY['amount_cents','currency','method','received_at','reference','notes'];
  ELSIF action='invoice.reverse_manual_payment' THEN allowed:=allowed||ARRAY['payment_id','reason'];
  ELSIF action='invoice.void' THEN allowed:=allowed||ARRAY['reason'];
  ELSIF action='invoice.link_create' THEN allowed:=allowed||ARRAY['expires_in_days','grant_scope','delivery_operation_id']; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE NOT(k=ANY(allowed)))
    OR coalesce(_command->>'expected_version','') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid invoice fields' USING ERRCODE='22023'; END IF;
  expected:=(_command->>'expected_version')::bigint;
  PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81742));
  prior:=public.read_sales_invoice_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF EXISTS(SELECT 1 FROM public.messages WHERE meta#>>'{sales_invoice_binding,operation_id}'=_operation_id::text) THEN
    RAISE EXCEPTION 'Operation already belongs to invoice delivery' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id AND billing_draft_version IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  IF coalesce(r.billing_lifecycle_version,r.billing_draft_version)<>expected THEN RAISE EXCEPTION 'Invoice version conflict' USING ERRCODE='40001'; END IF;
  IF action='invoice.publish' THEN
    IF r.status<>'draft' OR r.billing_issued_at IS NOT NULL OR r.amount_total_cents<1 OR lower(r.currency)<>'usd'
      OR r.billing_draft->'schema_version' IS DISTINCT FROM '2'::jsonb OR nullif(r.billing_draft->>'due_date','') IS NULL THEN RAISE EXCEPTION 'Complete this draft before publication' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb))<1 OR r.billing_draft->>'processor_intent' IS NOT NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb)) m
      WHERE m NOT IN ('zelle','cash','wire','check','bank_transfer','other')) THEN
      RAISE EXCEPTION 'Online merchant issuance is unavailable; choose off-platform methods' USING ERRCODE='22023'; END IF;
    SELECT to_jsonb(c) INTO client FROM public.clients c WHERE id=r.contact_id AND tenant_id=_expected_tenant_id;
    SELECT to_jsonb(t) INTO tenant FROM public.tenants t WHERE id=_expected_tenant_id;
    document:=jsonb_build_object('renderer_version','paige-invoice-html-v1','invoice_number',r.invoice_number,'published_at',now(),
      'issuer_name',coalesce(nullif(tenant->>'name',''),nullif(tenant->>'business_name',''),'Business'),
      'client_name',coalesce(nullif(client->>'entity_name',''),nullif(trim(coalesce(client->>'first_name','')||' '||coalesce(client->>'last_name','')),''),'Client'),
      'snapshot',r.billing_draft,'total_cents',r.amount_total_cents,'currency','usd');
    UPDATE public.paige_invoices SET status='issued',billing_lifecycle_version=expected+1,billing_issued_snapshot_version=billing_draft_version,
      billing_issued_at=now(),billing_issued_by=_actor_user_id,billing_document=document,
      billing_document_digest=encode(extensions.digest(convert_to(document::text,'UTF8'),'sha256'),'hex') WHERE id=r.id;
  ELSE
    IF r.status<>'issued' THEN RAISE EXCEPTION 'Invoice is not active' USING ERRCODE='22023'; END IF;
    SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received
      FROM public.paige_invoice_payments WHERE tenant_id=_expected_tenant_id AND invoice_id=r.id;
    IF action='invoice.record_manual_payment' THEN
      IF coalesce(_command->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$' OR _command->>'currency' IS DISTINCT FROM 'usd'
        OR coalesce(_command->>'method','') NOT IN ('zelle','cash','wire','check','bank_transfer','other')
        OR nullif(_command->>'received_at','') IS NULL OR length(_command->>'reference')>200 OR length(_command->>'notes')>2000 THEN
        RAISE EXCEPTION 'Check payment amount, method, currency and date' USING ERRCODE='22023'; END IF;
      amount:=(_command->>'amount_cents')::bigint;
      IF amount>2147483647 OR received+amount>r.amount_total_cents THEN RAISE EXCEPTION 'Payment exceeds outstanding balance' USING ERRCODE='22023'; END IF;
      IF (_command->>'received_at')::timestamptz>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Received date cannot be in the future' USING ERRCODE='22023'; END IF;
      INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,reference,notes)
        VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,'receipt',amount,'usd',_command->>'method',(_command->>'received_at')::timestamptz,_command->>'reference',_command->>'notes');
    ELSIF action='invoice.reverse_manual_payment' THEN
      IF coalesce(length(trim(_command->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Explain the correction' USING ERRCODE='22023'; END IF;
      SELECT * INTO receipt FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND tenant_id=_expected_tenant_id AND invoice_id=r.id AND kind='receipt';
      IF NOT FOUND OR EXISTS(SELECT 1 FROM public.paige_invoice_payments WHERE reverses_payment_id=receipt.id) THEN
        RAISE EXCEPTION 'Receipt unavailable or already reversed' USING ERRCODE='22023'; END IF;
      INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,reverses_payment_id,reason)
        VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,'reversal',receipt.amount_cents,receipt.currency,receipt.method,receipt.received_at,receipt.id,_command->>'reason');
    ELSIF action='invoice.void' THEN
      IF coalesce(length(trim(_command->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Explain why this invoice is void' USING ERRCODE='22023'; END IF;
      UPDATE public.paige_invoices SET status='void' WHERE id=r.id;
      UPDATE public.paige_invoice_access_grants SET revoked_at=now() WHERE invoice_id=r.id AND revoked_at IS NULL;
    ELSIF action='invoice.link_create' THEN
      IF coalesce(_command->>'expires_in_days','') !~ '^[1-9][0-9]?$' OR (_command->>'expires_in_days')::integer>30 THEN
        RAISE EXCEPTION 'Link expiry must be between one and 30 days' USING ERRCODE='22023'; END IF;
      scope:=coalesce(_command->>'grant_scope','share');
      IF scope<>'share' OR _command ? 'delivery_operation_id' THEN RAISE EXCEPTION 'Delivery grants use the governed sender' USING ERRCODE='22023'; END IF;
      hash:=_governance#>>'{generated_link,token_hash}';grant_id:=(_governance#>>'{generated_link,grant_id}')::uuid;
      IF coalesce(hash,'') !~ '^[0-9a-f]{64}$' OR grant_id IS NULL THEN RAISE EXCEPTION 'Trusted link material required' USING ERRCODE='42501'; END IF;
      expiry:=now()+make_interval(days=(_command->>'expires_in_days')::integer);
      UPDATE public.paige_invoice_access_grants SET revoked_at=now() WHERE tenant_id=_expected_tenant_id AND invoice_id=r.id AND scope='share' AND revoked_at IS NULL;
      INSERT INTO public.paige_invoice_access_grants(id,tenant_id,invoice_id,issued_snapshot_version,scope,token_hash,expires_at,actor_user_id)
        VALUES(grant_id,_expected_tenant_id,r.id,r.billing_issued_snapshot_version,'share',hash,expiry,_actor_user_id);
    END IF;
    UPDATE public.paige_invoices SET billing_lifecycle_version=expected+1 WHERE id=r.id;
  END IF;
  PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,tool,'capability_succeeded',_operation_id,NULL);
  result:=jsonb_build_object('ok',true,'row',public._sales_invoice_read(_expected_tenant_id,r.id),'operation',jsonb_build_object('id',_operation_id,'action',action));
  IF action='invoice.link_create' THEN result:=result||jsonb_build_object('link',jsonb_build_object('grant_id',grant_id,'expires_at',expiry,'token_returned',false,'link_recovery_required',true)); END IF;
  INSERT INTO public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result) VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,_command,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.execute_sales_invoice_command(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sales_invoice_command(uuid,uuid,uuid,jsonb,jsonb) TO service_role;

-- Token hash is service-resolved; coarse refusals never expose IDs or receipt details.
CREATE OR REPLACE FUNCTION public.read_public_sales_invoice(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE grant_row public.paige_invoice_access_grants%ROWTYPE; invoice public.paige_invoices%ROWTYPE; received bigint;
BEGIN
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO grant_row FROM public.paige_invoice_access_grants WHERE token_hash=_token_hash AND revoked_at IS NULL AND expires_at>now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO invoice FROM public.paige_invoices WHERE id=grant_row.invoice_id AND tenant_id=grant_row.tenant_id
    AND status='issued' AND billing_issued_snapshot_version=grant_row.issued_snapshot_version;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received
    FROM public.paige_invoice_payments WHERE invoice_id=invoice.id AND tenant_id=invoice.tenant_id;
  RETURN jsonb_build_object('document',invoice.billing_document,'document_input_digest',invoice.billing_document_digest,
    'manual_recorded_cents',received,'remaining_cents',invoice.amount_total_cents-received);
END $$;
REVOKE ALL ON FUNCTION public.read_public_sales_invoice(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_sales_invoice(text) TO service_role;
