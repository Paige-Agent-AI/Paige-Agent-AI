-- Collection terms extend the canonical client agreement. Imports append canonical invoices and
-- manual receipts; staging/replay/source bindings are operational metadata, not another ledger.
ALTER TABLE public.tenant_client_agreements ADD COLUMN IF NOT EXISTS collection_terms jsonb,
  ADD COLUMN IF NOT EXISTS collection_terms_version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.tenant_client_agreements DROP CONSTRAINT IF EXISTS sales_collection_terms_shape;
ALTER TABLE public.tenant_client_agreements ADD CONSTRAINT sales_collection_terms_shape CHECK(
  (collection_terms IS NULL AND collection_terms_version=0) OR
  (jsonb_typeof(collection_terms)='object' AND collection_terms_version>0));
ALTER TABLE public.paige_invoices ADD COLUMN IF NOT EXISTS billing_import_provenance jsonb,
  ADD COLUMN IF NOT EXISTS billing_import_version bigint;
ALTER TABLE public.paige_invoices DROP CONSTRAINT IF EXISTS paige_invoices_status_check;
ALTER TABLE public.paige_invoices ADD CONSTRAINT paige_invoices_status_check
  CHECK(status IN ('draft','issued','sent','paid','void','uncollectible','recorded'));
ALTER TABLE public.paige_invoices DROP CONSTRAINT IF EXISTS sales_collection_recorded_shape;
ALTER TABLE public.paige_invoices ADD CONSTRAINT sales_collection_recorded_shape CHECK(
  (billing_import_provenance IS NULL AND billing_import_version IS NULL AND status<>'recorded') OR
  (status='recorded' AND jsonb_typeof(billing_import_provenance)='object'
   AND billing_import_provenance->>'evidence' IS NOT DISTINCT FROM 'owner_imported_unverified'
   AND billing_import_provenance->>'source' IS NOT DISTINCT FROM 'csv'
   AND billing_import_version IS NOT NULL AND billing_import_version>=1
   AND billing_draft_version IS NULL AND billing_document IS NULL AND billing_issued_at IS NULL
   AND hosted_invoice_url IS NULL AND stripe_invoice_id IS NULL AND sent_at IS NULL AND paid_at IS NULL));
ALTER TABLE public.paige_invoice_payments ADD COLUMN IF NOT EXISTS import_provenance jsonb;
ALTER TABLE public.paige_invoice_payments DROP CONSTRAINT IF EXISTS paige_invoice_payments_currency_check;
ALTER TABLE public.paige_invoice_payments ADD CONSTRAINT paige_invoice_payments_currency_check CHECK(currency ~ '^[a-z]{3}$');

CREATE TABLE IF NOT EXISTS public.paige_sales_collection_operations(
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id), command jsonb NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.paige_sales_import_batches(
  id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES public.tenants(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  source_account text NOT NULL CHECK(length(source_account) BETWEEN 1 AND 200),
  rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 200),
  content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
  review jsonb NOT NULL,state text NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','committed')),
  created_at timestamptz NOT NULL DEFAULT now(),committed_at timestamptz,
  CHECK((state='staged' AND committed_at IS NULL) OR (state='committed' AND committed_at IS NOT NULL)));
CREATE TABLE IF NOT EXISTS public.paige_sales_import_bindings(
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),source_account text NOT NULL,
  entity text NOT NULL CHECK(entity IN ('invoice','receipt')),entity_id text NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.paige_invoices(id),payment_id uuid REFERENCES public.paige_invoice_payments(id),
  row_digest text NOT NULL CHECK(row_digest ~ '^[a-f0-9]{64}$'),batch_id uuid NOT NULL REFERENCES public.paige_sales_import_batches(id),
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,source_account,entity,entity_id),
  CHECK((entity='invoice' AND payment_id IS NULL) OR (entity='receipt' AND payment_id IS NOT NULL)));
ALTER TABLE public.paige_sales_collection_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_sales_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_sales_import_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paige_sales_collection_operations,public.paige_sales_import_batches,public.paige_sales_import_bindings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.paige_sales_collection_operations,public.paige_sales_import_bindings TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.paige_sales_import_batches TO service_role;
CREATE INDEX IF NOT EXISTS sales_collection_batches_tenant ON public.paige_sales_import_batches(tenant_id,created_at,id);
CREATE INDEX IF NOT EXISTS sales_collection_receipt_export ON public.paige_invoice_payments(tenant_id,created_at,id);

CREATE OR REPLACE FUNCTION public._sales_collection_frozen() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME IN ('paige_sales_collection_operations','paige_sales_import_bindings') THEN
    RAISE EXCEPTION 'Collection history is append-only' USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='paige_sales_import_batches' THEN
    IF TG_OP='DELETE' OR OLD.state<>'staged' OR NEW.state<>'committed' OR NEW.committed_at IS NULL
      OR ROW(NEW.id,NEW.tenant_id,NEW.actor_user_id,NEW.source_account,NEW.rows,NEW.content_digest,NEW.review,NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.actor_user_id,OLD.source_account,OLD.rows,OLD.content_digest,OLD.review,OLD.created_at) THEN
      RAISE EXCEPTION 'Staged import input is immutable' USING ERRCODE='42501'; END IF;
  ELSIF TG_TABLE_NAME='paige_invoices' THEN
    IF OLD.billing_import_provenance IS NOT NULL AND (TG_OP='DELETE'
      OR (to_jsonb(NEW)-'billing_import_version'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'billing_import_version'-'updated_at')
      OR NEW.billing_import_version IS DISTINCT FROM OLD.billing_import_version+1) THEN
      RAISE EXCEPTION 'Imported invoice facts are immutable' USING ERRCODE='42501'; END IF;
    IF TG_OP='UPDATE' AND OLD.billing_import_provenance IS NULL AND NEW.billing_import_provenance IS NOT NULL THEN
      RAISE EXCEPTION 'Existing invoice cannot be relabelled imported' USING ERRCODE='42501'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._sales_collection_frozen() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sales_collection_import_frozen ON public.paige_invoices;
CREATE TRIGGER sales_collection_import_frozen BEFORE UPDATE OR DELETE ON public.paige_invoices FOR EACH ROW EXECUTE FUNCTION public._sales_collection_frozen();
DROP TRIGGER IF EXISTS sales_collection_operations_frozen ON public.paige_sales_collection_operations;
CREATE TRIGGER sales_collection_operations_frozen BEFORE UPDATE OR DELETE ON public.paige_sales_collection_operations FOR EACH ROW EXECUTE FUNCTION public._sales_collection_frozen();
DROP TRIGGER IF EXISTS sales_collection_binding_frozen ON public.paige_sales_import_bindings;
CREATE TRIGGER sales_collection_binding_frozen BEFORE UPDATE OR DELETE ON public.paige_sales_import_bindings FOR EACH ROW EXECUTE FUNCTION public._sales_collection_frozen();
DROP TRIGGER IF EXISTS sales_collection_batch_frozen ON public.paige_sales_import_batches;
CREATE TRIGGER sales_collection_batch_frozen BEFORE UPDATE OR DELETE ON public.paige_sales_import_batches FOR EACH ROW EXECUTE FUNCTION public._sales_collection_frozen();

CREATE OR REPLACE FUNCTION public._sales_collection_validate_terms(_terms jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE kind text:=_terms->>'kind';cadence text:=_terms->>'cadence';total bigint;n integer;anchor date;ending date;
  row jsonb;previous date;due date;sum_minor bigint:=0;months integer;fee jsonb;interest jsonb;
BEGIN
  IF jsonb_typeof(_terms) IS DISTINCT FROM 'object' OR octet_length(_terms::text)>64000
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(_terms) k WHERE k<>ALL(ARRAY['schema_version','kind','currency','total_cents','anchor_date','cadence','count','end_date','dates','deposit_cents','late_fee','interest']))
    OR _terms->'schema_version' IS DISTINCT FROM '1'::jsonb OR kind IS NULL OR kind<>ALL(ARRAY['full','installment','recurring','deposit','milestone','custom'])
    OR coalesce(_terms->>'currency','') !~ '^[a-z]{3}$' OR coalesce(_terms->>'total_cents','') !~ '^[1-9][0-9]{0,9}$'
    OR jsonb_typeof(_terms->'total_cents') IS DISTINCT FROM 'number'
    OR cadence IS NULL OR cadence<>ALL(ARRAY['monthly','quarterly','annual','custom'])
    OR coalesce(_terms->>'anchor_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid collection terms' USING ERRCODE='22023'; END IF;
  total:=(_terms->>'total_cents')::bigint;anchor:=(_terms->>'anchor_date')::date;
  IF total>2147483647 OR anchor<'1900-01-01' OR anchor>'9999-12-31' OR to_char(anchor,'YYYY-MM-DD')<>_terms->>'anchor_date' THEN RAISE EXCEPTION 'Invalid collection amount or anchor' USING ERRCODE='22023'; END IF;
  IF _terms->>'count' IS NOT NULL THEN
    IF jsonb_typeof(_terms->'count')<>'number' OR (_terms->>'count') !~ '^[1-9][0-9]{0,2}$' THEN RAISE EXCEPTION 'Invalid collection count' USING ERRCODE='22023'; END IF;
    n:=(_terms->>'count')::integer;IF n>240 THEN RAISE EXCEPTION 'Collection count is bounded' USING ERRCODE='22023'; END IF;
  END IF;
  IF _terms->>'end_date' IS NOT NULL THEN
    IF (_terms->>'end_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid collection end' USING ERRCODE='22023'; END IF;
    ending:=(_terms->>'end_date')::date;IF ending<anchor OR ending>'9999-12-31' OR to_char(ending,'YYYY-MM-DD')<>_terms->>'end_date' THEN RAISE EXCEPTION 'Invalid collection end' USING ERRCODE='22023'; END IF;
  END IF;
  IF (kind='full' AND n IS DISTINCT FROM 1) OR (kind='installment' AND (n IS NULL OR n<2)) OR (kind='deposit' AND n IS DISTINCT FROM 2)
    OR (kind<>'recurring' AND cadence<>'custom' AND (n IS NULL OR total<n)) THEN RAISE EXCEPTION 'Invalid collection schedule count' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(_terms->'dates') IS DISTINCT FROM 'array' OR jsonb_array_length(_terms->'dates')>240 THEN RAISE EXCEPTION 'Invalid collection dates' USING ERRCODE='22023'; END IF;
  IF cadence='custom' THEN
    IF jsonb_array_length(_terms->'dates')<1 OR n IS DISTINCT FROM jsonb_array_length(_terms->'dates') THEN RAISE EXCEPTION 'Explicit collection dates required' USING ERRCODE='22023'; END IF;
    FOR row IN SELECT value FROM jsonb_array_elements(_terms->'dates') LOOP
      IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(row) k WHERE k<>ALL(ARRAY['due_date','amount_cents','label']))
        OR coalesce(row->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(row->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$'
        OR (row->>'amount_cents')::bigint>2147483647 OR (row->>'label' IS NOT NULL AND (jsonb_typeof(row->'label')<>'string' OR length(row->>'label')>120)) THEN RAISE EXCEPTION 'Invalid explicit collection date' USING ERRCODE='22023'; END IF;
      IF jsonb_typeof(row->'amount_cents') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Integer minor units required' USING ERRCODE='22023';END IF;
      due:=(row->>'due_date')::date;
      IF (previous IS NULL AND due<>anchor) OR (previous IS NOT NULL AND due<=previous) OR (ending IS NOT NULL AND due>ending)
        OR due>'9999-12-31' OR to_char(due,'YYYY-MM-DD')<>row->>'due_date'
        OR (kind='recurring' AND (row->>'amount_cents')::bigint<>total) THEN RAISE EXCEPTION 'Collection dates must reconcile' USING ERRCODE='22023'; END IF;
      previous:=due;sum_minor:=sum_minor+(row->>'amount_cents')::bigint;
    END LOOP;
    IF kind<>'recurring' AND sum_minor<>total THEN RAISE EXCEPTION 'Collection amounts must reconcile' USING ERRCODE='22023'; END IF;
  ELSE
    IF jsonb_array_length(_terms->'dates')<>0 OR kind IN ('milestone','custom') THEN RAISE EXCEPTION 'Explicit collection dates required' USING ERRCODE='22023'; END IF;
    months:=CASE cadence WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 ELSE 12 END;
    IF n IS NOT NULL AND (anchor+make_interval(months=>(n-1)*months))::date>'9999-12-31' THEN RAISE EXCEPTION 'Collection dates exceed supported calendar' USING ERRCODE='22023';END IF;
    IF n IS NOT NULL AND ending IS NOT NULL AND (anchor+make_interval(months=>(n-1)*months))::date>ending THEN RAISE EXCEPTION 'End date truncates obligations' USING ERRCODE='22023'; END IF;
  END IF;
  IF kind='deposit' THEN
    IF coalesce(_terms->>'deposit_cents','') !~ '^[1-9][0-9]{0,9}$' OR (_terms->>'deposit_cents')::bigint>=total
      OR (cadence='custom' AND (_terms#>>'{dates,0,amount_cents}')::bigint<>(_terms->>'deposit_cents')::bigint) THEN RAISE EXCEPTION 'Invalid deposit allocation' USING ERRCODE='22023'; END IF;
  ELSIF _terms->>'deposit_cents' IS NOT NULL THEN RAISE EXCEPTION 'Unexpected deposit amount' USING ERRCODE='22023'; END IF;
  fee:=_terms->'late_fee';interest:=_terms->'interest';
  IF jsonb_typeof(fee) IS DISTINCT FROM 'object' OR jsonb_typeof(interest) IS DISTINCT FROM 'object'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(fee) k WHERE k<>ALL(ARRAY['fixed_cents','rate_bps','grace_days','agreement_basis']))
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(interest) k WHERE k<>ALL(ARRAY['annual_bps','agreement_basis']))
    OR coalesce(fee->>'fixed_cents','') !~ '^[0-9]{1,10}$' OR (fee->>'fixed_cents')::bigint>2147483647
    OR coalesce(fee->>'rate_bps','') !~ '^[0-9]{1,5}$' OR (fee->>'rate_bps')::integer>10000
    OR coalesce(fee->>'grace_days','') !~ '^[0-9]{1,4}$' OR (fee->>'grace_days')::integer>3650
    OR coalesce(interest->>'annual_bps','') !~ '^[0-9]{1,5}$' OR (interest->>'annual_bps')::integer>10000
    OR (fee->>'agreement_basis' IS NOT NULL AND (jsonb_typeof(fee->'agreement_basis')<>'string' OR length(fee->>'agreement_basis')>2000))
    OR (interest->>'agreement_basis' IS NOT NULL AND (jsonb_typeof(interest->'agreement_basis')<>'string' OR length(interest->>'agreement_basis')>2000))
    OR (((fee->>'fixed_cents')::bigint>0 OR (fee->>'rate_bps')::integer>0) AND coalesce(length(trim(fee->>'agreement_basis')),0)=0)
    OR ((interest->>'annual_bps')::integer>0 AND coalesce(length(trim(interest->>'agreement_basis')),0)=0) THEN RAISE EXCEPTION 'Agreed fee metadata required' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(fee->'fixed_cents') IS DISTINCT FROM 'number' OR jsonb_typeof(fee->'rate_bps') IS DISTINCT FROM 'number'
    OR jsonb_typeof(fee->'grace_days') IS DISTINCT FROM 'number' OR jsonb_typeof(interest->'annual_bps') IS DISTINCT FROM 'number'
    OR (kind='deposit' AND jsonb_typeof(_terms->'deposit_cents') IS DISTINCT FROM 'number') THEN RAISE EXCEPTION 'Integer fee metadata required' USING ERRCODE='22023';END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_collection_validate_terms(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._sales_collection_validate_import(_account text,_rows jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE row jsonb;received timestamptz;
BEGIN
  IF _account IS NULL OR length(trim(_account))=0 OR length(_account)>200 OR jsonb_typeof(_rows) IS DISTINCT FROM 'array'
    OR jsonb_array_length(_rows) NOT BETWEEN 1 AND 200 OR octet_length(_rows::text)>524288 THEN RAISE EXCEPTION 'Import is bounded' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(_rows) r GROUP BY r->>'entity',r->>'entity_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate source entities require review' USING ERRCODE='22023'; END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR row->>'entity' IS NULL OR row->>'entity' NOT IN ('invoice','receipt')
      OR jsonb_typeof(row->'entity_id') IS DISTINCT FROM 'string' OR length(trim(row->>'entity_id'))=0 OR length(row->>'entity_id')>200
      OR coalesce(row->>'currency','') !~ '^[a-z]{3}$' OR coalesce(row->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$'
      OR (row->>'amount_cents')::bigint>2147483647 THEN RAISE EXCEPTION 'Invalid import row' USING ERRCODE='22023'; END IF;
    IF jsonb_typeof(row->'amount_cents') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Integer imported minor units required' USING ERRCODE='22023';END IF;
    IF row->>'entity'='invoice' THEN
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(row) k WHERE k<>ALL(ARRAY['entity','entity_id','client_id','invoice_id','invoice_number','currency','amount_cents','due_date','memo']))
        OR coalesce(row->>'client_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR jsonb_typeof(row->'invoice_number') IS DISTINCT FROM 'string' OR length(trim(row->>'invoice_number'))=0 OR length(row->>'invoice_number')>100
        OR (row->>'memo' IS NOT NULL AND (jsonb_typeof(row->'memo')<>'string' OR length(row->>'memo')>2000)) THEN RAISE EXCEPTION 'Invalid invoice import' USING ERRCODE='22023'; END IF;
      IF row->>'due_date' IS NOT NULL AND ((row->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((row->>'due_date')::date,'YYYY-MM-DD')<>row->>'due_date') THEN RAISE EXCEPTION 'Invalid import due date' USING ERRCODE='22023'; END IF;
    ELSE
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(row) k WHERE k<>ALL(ARRAY['entity','entity_id','invoice_entity_id','invoice_id','payment_id','currency','amount_cents','method','received_at','reference']))
        OR ((row->>'invoice_id' IS NULL)=(row->>'invoice_entity_id' IS NULL))
        OR (row->>'invoice_entity_id' IS NOT NULL AND (jsonb_typeof(row->'invoice_entity_id')<>'string' OR length(trim(row->>'invoice_entity_id'))=0 OR length(row->>'invoice_entity_id')>200))
        OR row->>'method' IS NULL OR row->>'method' NOT IN ('zelle','cash','wire','check','bank_transfer','other')
        OR coalesce(row->>'received_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$'
        OR (row->>'reference' IS NOT NULL AND (jsonb_typeof(row->'reference')<>'string' OR length(row->>'reference')>200)) THEN RAISE EXCEPTION 'Invalid receipt import' USING ERRCODE='22023'; END IF;
      received:=(row->>'received_at')::timestamptz;
      IF to_char(received AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(row->>'received_at',19) OR received>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid or future receipt date' USING ERRCODE='22023'; END IF;
    END IF;
    IF row->>'invoice_id' IS NOT NULL AND (row->>'invoice_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR row->>'payment_id' IS NOT NULL AND (row->>'payment_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid canonical import reference' USING ERRCODE='22023'; END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._sales_collection_validate_import(text,jsonb) FROM PUBLIC,anon,authenticated;

-- Existing permissive invoice policies must not become a direct browser import writer.
DROP POLICY IF EXISTS sales_collection_import_service_only ON public.paige_invoices;
CREATE POLICY sales_collection_import_service_only ON public.paige_invoices AS RESTRICTIVE FOR ALL TO authenticated
  USING(billing_import_provenance IS NULL) WITH CHECK(billing_import_provenance IS NULL AND status<>'recorded');

CREATE OR REPLACE FUNCTION public._sales_collection_review_import(_tenant uuid,_account text,_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE row jsonb;source_invoice jsonb;invoice public.paige_invoices%ROWTYPE;payment public.paige_invoice_payments%ROWTYPE;
  binding public.paige_sales_import_bindings%ROWTYPE;conflicts jsonb:='[]';plans jsonb:='[]';index integer:=0;
  target uuid;total bigint;currency text;received bigint;already boolean;row_hash text;conflict text;allocations jsonb:='{}';allocation_key text;
BEGIN
  PERFORM public._sales_collection_validate_import(_account,_rows);
  FOR row IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    index:=index+1;conflict:=NULL;target:=NULL;total:=NULL;currency:=NULL;received:=0;already:=false;
    row_hash:=encode(extensions.digest(row::text,'sha256'),'hex');
    SELECT * INTO binding FROM public.paige_sales_import_bindings WHERE tenant_id=_tenant AND source_account=_account AND entity=row->>'entity' AND entity_id=row->>'entity_id';
    IF FOUND THEN
      IF binding.row_digest<>row_hash THEN conflict:='source_entity_changed'; ELSE already:=true;target:=binding.invoice_id; END IF;
    ELSIF row->>'entity'='invoice' THEN
      IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=(row->>'client_id')::uuid AND tenant_id=_tenant) THEN conflict:='client_mapping_unavailable';
      ELSIF row->>'invoice_id' IS NULL AND (SELECT count(*) FROM jsonb_array_elements(_rows) sibling WHERE sibling->>'entity'='invoice' AND sibling->>'client_id'=row->>'client_id' AND sibling->>'invoice_number'=row->>'invoice_number')>1 THEN conflict:='possible_duplicate_invoice_rows';
      ELSIF row->>'invoice_id' IS NOT NULL THEN
        SELECT * INTO invoice FROM public.paige_invoices WHERE id=(row->>'invoice_id')::uuid AND tenant_id=_tenant;
        IF NOT FOUND OR invoice.contact_id<>(row->>'client_id')::uuid OR invoice.amount_total_cents<>(row->>'amount_cents')::integer
          OR lower(invoice.currency)<>row->>'currency' OR invoice.due_date IS DISTINCT FROM (row->>'due_date')::date THEN conflict:='invoice_mapping_mismatch';
        ELSE target:=invoice.id;END IF;
      ELSE
        -- Do not guess whether a new source identity is an already-recorded obligation.
        IF EXISTS(SELECT 1 FROM public.paige_invoices i WHERE i.tenant_id=_tenant AND i.contact_id=(row->>'client_id')::uuid
          AND (i.invoice_number=row->>'invoice_number' OR i.billing_import_provenance->>'source_invoice_number'=row->>'invoice_number')) THEN conflict:='possible_existing_invoice_map_required'; END IF;
      END IF;
    ELSE
      IF row->>'invoice_id' IS NOT NULL THEN target:=(row->>'invoice_id')::uuid;
      ELSE
        SELECT value INTO source_invoice FROM jsonb_array_elements(_rows) WHERE value->>'entity'='invoice' AND value->>'entity_id'=row->>'invoice_entity_id';
        IF FOUND THEN
          total:=(source_invoice->>'amount_cents')::bigint;currency:=source_invoice->>'currency';
          target:=(source_invoice->>'invoice_id')::uuid;
          IF target IS NULL THEN SELECT invoice_id INTO target FROM public.paige_sales_import_bindings WHERE tenant_id=_tenant AND source_account=_account AND entity='invoice' AND entity_id=row->>'invoice_entity_id';END IF;
        ELSE SELECT invoice_id INTO target FROM public.paige_sales_import_bindings WHERE tenant_id=_tenant AND source_account=_account AND entity='invoice' AND entity_id=row->>'invoice_entity_id';
        END IF;
      END IF;
      IF target IS NOT NULL THEN
        SELECT * INTO invoice FROM public.paige_invoices WHERE id=target AND tenant_id=_tenant;
        IF NOT FOUND OR invoice.status NOT IN ('issued','recorded') OR lower(invoice.currency)<>row->>'currency' THEN conflict:='receipt_invoice_unavailable';
        ELSE total:=invoice.amount_total_cents;currency:=lower(invoice.currency);
          SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received FROM public.paige_invoice_payments WHERE tenant_id=_tenant AND invoice_id=target;
        END IF;
      ELSIF total IS NULL THEN conflict:='receipt_invoice_mapping_required';END IF;
      IF currency IS NOT NULL AND currency<>row->>'currency' THEN conflict:='receipt_currency_mismatch';END IF;
      IF row->>'payment_id' IS NOT NULL THEN
        SELECT * INTO payment FROM public.paige_invoice_payments WHERE id=(row->>'payment_id')::uuid AND tenant_id=_tenant AND invoice_id=target;
        IF NOT FOUND OR payment.kind<>'receipt' OR payment.amount_cents<>(row->>'amount_cents')::integer OR payment.currency<>row->>'currency'
          OR payment.method<>row->>'method' OR payment.received_at<>(row->>'received_at')::timestamptz THEN conflict:='receipt_mapping_mismatch';END IF;
      ELSIF conflict IS NULL THEN
        allocation_key:=coalesce(target::text,'source:'||(row->>'invoice_entity_id'));
        received:=received+coalesce((allocations->>allocation_key)::bigint,0)+(row->>'amount_cents')::bigint;
        allocations:=jsonb_set(allocations,ARRAY[allocation_key],to_jsonb(coalesce((allocations->>allocation_key)::bigint,0)+(row->>'amount_cents')::bigint),true);
        IF received>total THEN conflict:='receipt_exceeds_remaining';END IF;
        IF target IS NOT NULL AND EXISTS(SELECT 1 FROM public.paige_invoice_payments p WHERE p.tenant_id=_tenant AND p.invoice_id=target AND p.kind='receipt'
          AND p.amount_cents=(row->>'amount_cents')::integer AND p.currency=row->>'currency' AND p.received_at=(row->>'received_at')::timestamptz AND p.method=row->>'method') THEN conflict:='possible_existing_receipt_map_required';END IF;
        IF (SELECT count(*) FROM jsonb_array_elements(_rows) sibling WHERE sibling->>'entity'='receipt' AND sibling->>'payment_id' IS NULL
          AND sibling->>'invoice_id' IS NOT DISTINCT FROM row->>'invoice_id' AND sibling->>'invoice_entity_id' IS NOT DISTINCT FROM row->>'invoice_entity_id'
          AND sibling->>'amount_cents'=row->>'amount_cents' AND sibling->>'currency'=row->>'currency' AND sibling->>'method'=row->>'method'
          AND sibling->>'received_at'=row->>'received_at' AND sibling->>'reference' IS NOT DISTINCT FROM row->>'reference')>1 THEN conflict:='possible_duplicate_receipt_rows';END IF;
      END IF;
    END IF;
    IF conflict IS NOT NULL THEN conflicts:=conflicts||jsonb_build_array(jsonb_build_object('row',index,'entity',row->>'entity','entity_id',row->>'entity_id','code',conflict));END IF;
    plans:=plans||jsonb_build_array(jsonb_build_object('row',index,'entity',row->>'entity','entity_id',row->>'entity_id','already_imported',already,'target_invoice_id',target));
  END LOOP;
  RETURN jsonb_build_object('rows',plans,'conflicts',conflicts,'eligible_commit',jsonb_array_length(conflicts)=0,'provenance','owner_imported_unverified');
END $$;
REVOKE ALL ON FUNCTION public._sales_collection_review_import(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.read_sales_collection_command_result(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_sales_collection_operations%ROWTYPE;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  SELECT * INTO op FROM public.paige_sales_collection_operations WHERE id=_operation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF op.tenant_id<>_expected_tenant_id OR op.actor_user_id<>_actor_user_id OR op.command IS DISTINCT FROM _command THEN RAISE EXCEPTION 'Operation reused with different input' USING ERRCODE='22023';END IF;
  RETURN op.result;
END $$;
REVOKE ALL ON FUNCTION public.read_sales_collection_command_result(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_collection_command_result(uuid,uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.preview_sales_collection_command(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE agreement public.tenant_client_agreements%ROWTYPE;batch public.paige_sales_import_batches%ROWTYPE;review jsonb;
  action text:=_command->>'action';eligible boolean:=false;summary text;invoice public.paige_invoices%ROWTYPE;payment public.paige_invoice_payments%ROWTYPE;received bigint;consequence jsonb;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  IF jsonb_typeof(_command) IS DISTINCT FROM 'object' OR octet_length(_command::text)>600000 THEN RAISE EXCEPTION 'Invalid collection command' USING ERRCODE='22023';END IF;
  IF action IN ('collection.record_receipt','collection.reverse_receipt') THEN
    IF jsonb_typeof(_command->'expected_version') IS DISTINCT FROM 'number' OR coalesce(_command->>'expected_version','') !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'Invalid imported invoice version' USING ERRCODE='22023';END IF;
    SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id;
    eligible:=FOUND AND invoice.status='recorded' AND invoice.billing_import_provenance IS NOT NULL AND invoice.billing_import_version=(_command->>'expected_version')::bigint;
    IF action='collection.record_receipt' THEN
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k<>ALL(ARRAY['action','invoice_id','expected_version','amount_cents','currency','method','received_at','reference','notes']))
        OR jsonb_typeof(_command->'amount_cents') IS DISTINCT FROM 'number' OR coalesce(_command->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$' OR (_command->>'amount_cents')::bigint>2147483647
        OR coalesce(_command->>'currency','') !~ '^[a-z]{3}$' OR _command->>'method' IS NULL OR _command->>'method' NOT IN ('zelle','cash','wire','check','bank_transfer','other')
        OR coalesce(_command->>'received_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$'
        OR (_command->>'reference' IS NOT NULL AND (jsonb_typeof(_command->'reference')<>'string' OR length(_command->>'reference')>200))
        OR (_command->>'notes' IS NOT NULL AND (jsonb_typeof(_command->'notes')<>'string' OR length(_command->>'notes')>2000)) THEN RAISE EXCEPTION 'Invalid imported invoice receipt' USING ERRCODE='22023';END IF;
      IF to_char((_command->>'received_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(_command->>'received_at',19)
        OR (_command->>'received_at')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'Received date cannot be in the future' USING ERRCODE='22023';END IF;
      SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received FROM public.paige_invoice_payments WHERE tenant_id=_expected_tenant_id AND invoice_id=invoice.id;
      eligible:=eligible AND lower(invoice.currency)=_command->>'currency' AND received+(_command->>'amount_cents')::bigint<=invoice.amount_total_cents;
      summary:='Record the owner-reported off-platform receipt against this imported obligation. This does not charge money or verify a provider payment.';
    ELSE
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k<>ALL(ARRAY['action','invoice_id','expected_version','payment_id','reason']))
        OR jsonb_typeof(_command->'reason') IS DISTINCT FROM 'string' OR coalesce(length(trim(_command->>'reason')),0)=0 OR length(_command->>'reason')>500 THEN RAISE EXCEPTION 'Receipt reversal reason required' USING ERRCODE='22023';END IF;
      SELECT * INTO payment FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND tenant_id=_expected_tenant_id AND invoice_id=invoice.id AND kind='receipt';
      SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received FROM public.paige_invoice_payments WHERE tenant_id=_expected_tenant_id AND invoice_id=invoice.id;
      eligible:=eligible AND payment.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.paige_invoice_payments WHERE reverses_payment_id=payment.id);
      summary:='Append one full correction reversing the human-recorded receipt. Original history remains; no money is refunded.';
    END IF;
  ELSIF action='collection.save_terms' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k<>ALL(ARRAY['action','agreement_id','expected_version','terms']))
      OR coalesce(_command->>'expected_version','') !~ '^[0-9]{1,16}$' THEN RAISE EXCEPTION 'Invalid collection fields' USING ERRCODE='22023';END IF;
    PERFORM public._sales_collection_validate_terms(_command->'terms');
    SELECT * INTO agreement FROM public.tenant_client_agreements WHERE id=(_command->>'agreement_id')::uuid AND tenant_id=_expected_tenant_id;
    eligible:=FOUND AND agreement.collection_terms_version=(_command->>'expected_version')::bigint AND agreement.status IN ('draft','active','paused')
      AND agreement.agreed_amount_minor=(_command#>>'{terms,total_cents}')::bigint AND agreement.agreed_currency=_command#>>'{terms,currency}'
      AND EXISTS(SELECT 1 FROM public.clients WHERE id=agreement.contact_id AND tenant_id=_expected_tenant_id);
    summary:='Save this client agreement collection schedule and agreed fee metadata. No invoice, accrual or charge is created.';
  ELSIF action='collection.stage_import' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k<>ALL(ARRAY['action','source_account','rows'])) THEN RAISE EXCEPTION 'Invalid import fields' USING ERRCODE='22023';END IF;
    review:=public._sales_collection_review_import(_expected_tenant_id,_command->>'source_account',_command->'rows');eligible:=true;
    summary:='Stage up to 200 mapped historical CSV records for review. No invoice or receipt is created; conflicts remain explicit.';
  ELSIF action='collection.commit_import' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k<>ALL(ARRAY['action','batch_id','expected_digest'])) OR coalesce(_command->>'expected_digest','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid reviewed import identity' USING ERRCODE='22023';END IF;
    SELECT * INTO batch FROM public.paige_sales_import_batches WHERE id=(_command->>'batch_id')::uuid AND tenant_id=_expected_tenant_id AND actor_user_id=_actor_user_id;
    IF FOUND AND batch.state='staged' AND batch.content_digest=_command->>'expected_digest' THEN
      review:=public._sales_collection_review_import(_expected_tenant_id,batch.source_account,batch.rows);eligible:=coalesce((review->>'eligible_commit')::boolean,false);
    END IF;
    summary:='Import the exact reviewed CSV batch into canonical invoices and human-recorded receipts. No customer is created, payment charged or provider verification claimed.';
  ELSE RAISE EXCEPTION 'Unknown collection action' USING ERRCODE='22023';END IF;
  IF eligible AND action IN ('collection.record_receipt','collection.reverse_receipt') THEN
    consequence:=jsonb_build_object('invoice_number',invoice.invoice_number,'currency',lower(invoice.currency),
      'original_total_cents',invoice.amount_total_cents,'remaining_cents',invoice.amount_total_cents-received,
      'amount_cents',CASE WHEN action='collection.record_receipt' THEN (_command->>'amount_cents')::integer ELSE payment.amount_cents END,
      'method',CASE WHEN action='collection.record_receipt' THEN _command->>'method' ELSE payment.method END,
      'received_at',CASE WHEN action='collection.record_receipt' THEN (_command->>'received_at')::timestamptz ELSE payment.received_at END,
      'resulting_remaining_cents',invoice.amount_total_cents-received+CASE WHEN action='collection.record_receipt' THEN -(_command->>'amount_cents')::integer ELSE payment.amount_cents END);
  END IF;
  RETURN jsonb_build_object('eligible',eligible,'summary',summary,'review',review,'consequence',consequence);
END $$;
REVOKE ALL ON FUNCTION public.preview_sales_collection_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_sales_collection_command(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.execute_sales_collection_command(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE action text:=_command->>'action';tool text;result jsonb;prior jsonb;preview jsonb;review jsonb;
  agreement public.tenant_client_agreements%ROWTYPE;batch public.paige_sales_import_batches%ROWTYPE;
  binding public.paige_sales_import_bindings%ROWTYPE;row jsonb;target uuid;payment uuid;provenance jsonb;received bigint;invoice public.paige_invoices%ROWTYPE;written integer:=0;matched integer:=0;new_invoice_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  IF _operation_id IS NULL THEN RAISE EXCEPTION 'Collection operation required' USING ERRCODE='22023';END IF;
  tool:=CASE action WHEN 'collection.save_terms' THEN 'sales_save_collection_terms' WHEN 'collection.stage_import' THEN 'sales_stage_collection_import' WHEN 'collection.commit_import' THEN 'sales_commit_collection_import' WHEN 'collection.record_receipt' THEN 'sales_record_manual_payment' WHEN 'collection.reverse_receipt' THEN 'sales_reverse_manual_payment' END;
  IF tool IS NULL THEN RAISE EXCEPTION 'Unknown collection action' USING ERRCODE='22023';END IF;
  PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,action,tool,_governance);
  PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81747));
  prior:=public.read_sales_collection_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
  IF prior IS NOT NULL THEN RETURN prior;END IF;
  IF action IN ('collection.record_receipt','collection.reverse_receipt') THEN
    SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
  ELSIF action='collection.save_terms' THEN
    SELECT * INTO agreement FROM public.tenant_client_agreements WHERE id=(_command->>'agreement_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
  ELSIF action='collection.commit_import' THEN
    SELECT * INTO batch FROM public.paige_sales_import_batches WHERE id=(_command->>'batch_id')::uuid AND tenant_id=_expected_tenant_id AND actor_user_id=_actor_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed import unavailable' USING ERRCODE='42501';END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(_expected_tenant_id::text||':'||batch.source_account,81748));
    -- Existing receipt writers lock invoices too. Stable order avoids cross-import deadlocks.
    PERFORM i.id FROM public.paige_invoices i WHERE i.tenant_id=_expected_tenant_id AND i.id IN (
      SELECT (r.value->>'invoice_id')::uuid FROM jsonb_array_elements(batch.rows) r WHERE r.value->>'invoice_id' IS NOT NULL
      UNION
      SELECT b.invoice_id FROM jsonb_array_elements(batch.rows) r JOIN public.paige_sales_import_bindings b
        ON b.tenant_id=_expected_tenant_id AND b.source_account=batch.source_account AND b.entity='invoice' AND b.entity_id=r.value->>'invoice_entity_id'
      UNION
      SELECT (mapped.value->>'invoice_id')::uuid FROM jsonb_array_elements(batch.rows) receipt
        JOIN jsonb_array_elements(batch.rows) mapped ON mapped.value->>'entity'='invoice' AND mapped.value->>'entity_id'=receipt.value->>'invoice_entity_id'
        WHERE mapped.value->>'invoice_id' IS NOT NULL
    ) ORDER BY i.id FOR UPDATE;
  END IF;
  preview:=public.preview_sales_collection_command(_actor_user_id,_expected_tenant_id,_command);
  IF preview->'eligible' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Collection input is stale, unavailable or conflicted' USING ERRCODE='22023';END IF;
  IF action IN ('collection.record_receipt','collection.reverse_receipt') THEN
    IF action='collection.record_receipt' THEN
      INSERT INTO public.paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,reference,notes)
        VALUES(_operation_id,invoice.id,_expected_tenant_id,_actor_user_id,'receipt',(_command->>'amount_cents')::integer,_command->>'currency',_command->>'method',(_command->>'received_at')::timestamptz,_command->>'reference',_command->>'notes');
    ELSE
      SELECT to_jsonb(p) INTO row FROM public.paige_invoice_payments p WHERE p.id=(_command->>'payment_id')::uuid AND p.invoice_id=invoice.id AND p.tenant_id=_expected_tenant_id;
      INSERT INTO public.paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,reverses_payment_id,reason)
        VALUES(_operation_id,invoice.id,_expected_tenant_id,_actor_user_id,'reversal',(row->>'amount_cents')::integer,row->>'currency',row->>'method',(row->>'received_at')::timestamptz,(row->>'id')::uuid,_command->>'reason');
    END IF;
    UPDATE public.paige_invoices SET billing_import_version=billing_import_version+1 WHERE id=invoice.id AND billing_import_version=(_command->>'expected_version')::bigint RETURNING * INTO invoice;
    IF NOT FOUND THEN RAISE EXCEPTION 'Imported invoice changed' USING ERRCODE='40001';END IF;
    SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received FROM public.paige_invoice_payments WHERE invoice_id=invoice.id AND tenant_id=_expected_tenant_id;
    result:=jsonb_build_object('ok',true,'row',jsonb_build_object('id',invoice.id,'tenant_id',invoice.tenant_id,'status',invoice.status,'version',invoice.billing_import_version,'currency',lower(invoice.currency),'amount_cents',invoice.amount_total_cents,'manual_recorded_cents',received,'remaining_cents',invoice.amount_total_cents-received));
  ELSIF action='collection.save_terms' THEN
    UPDATE public.tenant_client_agreements SET collection_terms=_command->'terms',collection_terms_version=collection_terms_version+1
      WHERE id=agreement.id AND tenant_id=_expected_tenant_id AND collection_terms_version=(_command->>'expected_version')::bigint RETURNING * INTO agreement;
    IF NOT FOUND THEN RAISE EXCEPTION 'Collection terms changed' USING ERRCODE='40001';END IF;
    result:=jsonb_build_object('ok',true,'row',jsonb_build_object('id',agreement.id,'tenant_id',agreement.tenant_id,'collection_terms',agreement.collection_terms,'collection_terms_version',agreement.collection_terms_version));
  ELSIF action='collection.stage_import' THEN
    review:=preview->'review';
    INSERT INTO public.paige_sales_import_batches(id,tenant_id,actor_user_id,source_account,rows,content_digest,review)
      VALUES(_operation_id,_expected_tenant_id,_actor_user_id,_command->>'source_account',_command->'rows',encode(extensions.digest((_command->'rows')::text,'sha256'),'hex'),review) RETURNING * INTO batch;
    result:=jsonb_build_object('ok',true,'batch',jsonb_build_object('id',batch.id,'content_digest',batch.content_digest,'state',batch.state,'review',batch.review,'source_account',batch.source_account,'rows',batch.rows));
  ELSE
    FOR row IN SELECT value FROM jsonb_array_elements(batch.rows) ORDER BY CASE WHEN value->>'entity'='invoice' THEN 0 ELSE 1 END LOOP
      SELECT * INTO binding FROM public.paige_sales_import_bindings WHERE tenant_id=_expected_tenant_id AND source_account=batch.source_account AND entity=row->>'entity' AND entity_id=row->>'entity_id';
      IF FOUND THEN matched:=matched+1;CONTINUE;END IF;
      provenance:=jsonb_build_object('source','csv','source_account',batch.source_account,'entity_id',row->>'entity_id','batch_id',batch.id,'imported_by',_actor_user_id,'imported_at',clock_timestamp(),'evidence','owner_imported_unverified');
      IF row->>'entity'='invoice' THEN
        target:=(row->>'invoice_id')::uuid;payment:=NULL;
        IF target IS NULL THEN
          target:=gen_random_uuid();
          INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,due_date,memo,line_items,created_by,billing_import_provenance,billing_import_version)
            VALUES(target,_expected_tenant_id,(row->>'client_id')::uuid,'CSV-'||target::text,'recorded',(row->>'amount_cents')::integer,row->>'currency',(row->>'due_date')::date,row->>'memo','[]',_actor_user_id,provenance||jsonb_build_object('source_invoice_number',row->>'invoice_number'),1);
          new_invoice_ids:=array_append(new_invoice_ids,target);
          written:=written+1;
        ELSE matched:=matched+1;END IF;
      ELSE
        target:=(row->>'invoice_id')::uuid;
        IF target IS NULL THEN SELECT invoice_id INTO target FROM public.paige_sales_import_bindings WHERE tenant_id=_expected_tenant_id AND source_account=batch.source_account AND entity='invoice' AND entity_id=row->>'invoice_entity_id';END IF;
        payment:=(row->>'payment_id')::uuid;
        IF payment IS NULL THEN
          SELECT * INTO invoice FROM public.paige_invoices WHERE id=target AND tenant_id=_expected_tenant_id FOR UPDATE;
          IF NOT FOUND OR invoice.status NOT IN ('issued','recorded') OR lower(invoice.currency)<>row->>'currency' THEN RAISE EXCEPTION 'Receipt invoice changed' USING ERRCODE='42501';END IF;
          SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received FROM public.paige_invoice_payments WHERE invoice_id=target AND tenant_id=_expected_tenant_id;
          IF received+(row->>'amount_cents')::bigint>invoice.amount_total_cents THEN RAISE EXCEPTION 'Receipt exceeds remaining amount' USING ERRCODE='22023';END IF;
          payment:=gen_random_uuid();
          INSERT INTO public.paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,reference,import_provenance)
            VALUES(payment,target,_expected_tenant_id,_actor_user_id,'receipt',(row->>'amount_cents')::integer,row->>'currency',row->>'method',(row->>'received_at')::timestamptz,row->>'reference',provenance);
          IF NOT(target=ANY(new_invoice_ids)) THEN
            UPDATE public.paige_invoices SET
              billing_import_version=CASE WHEN status='recorded' THEN billing_import_version+1 ELSE billing_import_version END,
              billing_lifecycle_version=CASE WHEN status='issued' THEN billing_lifecycle_version+1 ELSE billing_lifecycle_version END
              WHERE id=target AND tenant_id=_expected_tenant_id;
          END IF;
          written:=written+1;
        ELSE matched:=matched+1;END IF;
      END IF;
      INSERT INTO public.paige_sales_import_bindings(tenant_id,source_account,entity,entity_id,invoice_id,payment_id,row_digest,batch_id)
        VALUES(_expected_tenant_id,batch.source_account,row->>'entity',row->>'entity_id',target,payment,encode(extensions.digest(row::text,'sha256'),'hex'),batch.id);
    END LOOP;
    UPDATE public.paige_sales_import_batches SET state='committed',committed_at=clock_timestamp() WHERE id=batch.id;
    result:=jsonb_build_object('ok',true,'batch',jsonb_build_object('id',batch.id,'state','committed','written',written,'matched',matched,'provenance','owner_imported_unverified'));
  END IF;
  PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,tool,'capability_succeeded',_operation_id,NULL);
  result:=result||jsonb_build_object('operation',jsonb_build_object('id',_operation_id,'action',action));
  INSERT INTO public.paige_sales_collection_operations(id,tenant_id,actor_user_id,command,result) VALUES(_operation_id,_expected_tenant_id,_actor_user_id,_command,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS sales_import_batch_tenant_identity ON public.paige_sales_import_batches(tenant_id,id);
ALTER TABLE public.paige_sales_import_bindings DROP CONSTRAINT IF EXISTS sales_import_binding_invoice_scope;
ALTER TABLE public.paige_sales_import_bindings ADD CONSTRAINT sales_import_binding_invoice_scope
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES public.paige_invoices(tenant_id,id);
ALTER TABLE public.paige_sales_import_bindings DROP CONSTRAINT IF EXISTS sales_import_binding_payment_scope;
ALTER TABLE public.paige_sales_import_bindings ADD CONSTRAINT sales_import_binding_payment_scope
  FOREIGN KEY(tenant_id,invoice_id,payment_id) REFERENCES public.paige_invoice_payments(tenant_id,invoice_id,id);
ALTER TABLE public.paige_sales_import_bindings DROP CONSTRAINT IF EXISTS sales_import_binding_batch_scope;
ALTER TABLE public.paige_sales_import_bindings ADD CONSTRAINT sales_import_binding_batch_scope
  FOREIGN KEY(tenant_id,batch_id) REFERENCES public.paige_sales_import_batches(tenant_id,id);

-- Match the established commercial-terms picker precedence, without email fallback or copied PII.
CREATE OR REPLACE FUNCTION public._sales_collection_client_name(_client uuid,_tenant uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT CASE WHEN nullif(trim(c.entity_name),'') IS NOT NULL AND (nullif(trim(c.entity_type),'') IS NOT NULL OR length(trim(concat_ws(' ',c.first_name,c.last_name)))=0)
    THEN trim(c.entity_name) ELSE coalesce(nullif(trim(concat_ws(' ',c.first_name,c.last_name)),''),nullif(trim(c.entity_name),''),'Unnamed contact') END
  FROM public.clients c WHERE c.id=_client AND c.tenant_id=_tenant
$$;
REVOKE ALL ON FUNCTION public._sales_collection_client_name(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.list_sales_collection_agreements(_expected_tenant_id uuid,_limit integer DEFAULT 50,_before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb;ids uuid[];more boolean;
BEGIN
  IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Collection workspace changed' USING ERRCODE='42501';END IF;
  PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Collection list is bounded' USING ERRCODE='22023';END IF;
  SELECT array_agg(id ORDER BY id DESC) INTO ids FROM(SELECT a.id FROM public.tenant_client_agreements a
    JOIN public.clients c ON c.id=a.contact_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=_expected_tenant_id AND (_before_id IS NULL OR a.id<_before_id) ORDER BY a.id DESC LIMIT _limit+1) selected;
  more:=coalesce(array_length(ids,1),0)>_limit;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'tenant_id',a.tenant_id,'client_id',a.contact_id,'client_name',public._sales_collection_client_name(a.contact_id,a.tenant_id),'offer_id',a.offer_id,'title',a.title,
    'status',a.status,'agreed_amount_minor',a.agreed_amount_minor,'agreed_currency',a.agreed_currency,
    'collection_terms',a.collection_terms,'collection_terms_version',a.collection_terms_version,
    'terms_current',a.collection_terms IS NOT NULL AND a.agreed_amount_minor=(a.collection_terms->>'total_cents')::bigint AND a.agreed_currency=a.collection_terms->>'currency') ORDER BY a.id DESC),'[]') INTO rows
    FROM public.tenant_client_agreements a WHERE a.tenant_id=_expected_tenant_id AND a.id=ANY(ids[1:_limit]);
  RETURN jsonb_build_object('rows',rows,'has_more',more,'next_cursor',CASE WHEN more THEN ids[_limit] ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.list_sales_collection_agreements(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_sales_collection_agreements(uuid,integer,uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.paige_sales_export_snapshots(
  id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES public.tenants(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  entity text NOT NULL CHECK(entity IN ('invoice','receipt')),membership_count integer NOT NULL CHECK(membership_count BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes');
CREATE TABLE IF NOT EXISTS public.paige_sales_export_members(
  snapshot_id uuid NOT NULL REFERENCES public.paige_sales_export_snapshots(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK(position BETWEEN 1 AND 10000),record_id uuid NOT NULL,
  PRIMARY KEY(snapshot_id,position),UNIQUE(snapshot_id,record_id));
ALTER TABLE public.paige_sales_export_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_sales_export_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paige_sales_export_snapshots,public.paige_sales_export_members FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.paige_sales_export_snapshots,public.paige_sales_export_members TO service_role;
CREATE INDEX IF NOT EXISTS sales_export_expiry ON public.paige_sales_export_snapshots(tenant_id,actor_user_id,expires_at);

CREATE OR REPLACE FUNCTION public.list_sales_collection_register(_expected_tenant_id uuid,_entity text DEFAULT 'invoice',_limit integer DEFAULT 50,_cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE capture public.paige_sales_export_snapshots%ROWTYPE;position_after integer:=0;rows jsonb;ids uuid[];positions integer[];more boolean;all_ids uuid[];read_at timestamptz:=clock_timestamp();
BEGIN
  IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Collection workspace changed' USING ERRCODE='42501';END IF;
  PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
  IF _entity IS NULL OR _entity NOT IN ('invoice','receipt') OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Collection register is bounded' USING ERRCODE='22023';END IF;
  IF _cursor IS NOT NULL THEN
    IF jsonb_typeof(_cursor) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(_cursor) k WHERE k<>ALL(ARRAY['snapshot_id','after_position','entity']))
      OR _cursor->>'entity' IS DISTINCT FROM _entity OR _cursor->>'snapshot_id' IS NULL OR coalesce(_cursor->>'after_position','') !~ '^[0-9]{1,5}$' THEN RAISE EXCEPTION 'Invalid export cursor' USING ERRCODE='22023';END IF;
    SELECT * INTO capture FROM public.paige_sales_export_snapshots WHERE id=(_cursor->>'snapshot_id')::uuid AND tenant_id=_expected_tenant_id AND actor_user_id=auth.uid() AND entity=_entity AND expires_at>clock_timestamp();
    IF NOT FOUND THEN RAISE EXCEPTION 'Export expired or unavailable' USING ERRCODE='42501';END IF;
    position_after:=(_cursor->>'after_position')::integer;
    IF position_after>capture.membership_count THEN RAISE EXCEPTION 'Invalid export position' USING ERRCODE='22023';END IF;
  ELSE
    -- Bounded opportunistic cleanup, reusing this read path; no new job or scheduler.
    DELETE FROM public.paige_sales_export_snapshots WHERE id IN(SELECT id FROM public.paige_sales_export_snapshots WHERE tenant_id=_expected_tenant_id AND actor_user_id=auth.uid() AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 5);
    IF (SELECT count(*) FROM public.paige_sales_export_snapshots WHERE tenant_id=_expected_tenant_id AND actor_user_id=auth.uid() AND expires_at>clock_timestamp())>=100 THEN RAISE EXCEPTION 'Too many active export snapshots; retry after expiry' USING ERRCODE='22023';END IF;
    IF _entity='invoice' THEN
      SELECT array_agg(id ORDER BY created_at,id) INTO all_ids FROM(SELECT id,created_at FROM public.paige_invoices WHERE tenant_id=_expected_tenant_id ORDER BY created_at,id LIMIT 10001) visible;
    ELSE
      SELECT array_agg(id ORDER BY created_at,id) INTO all_ids FROM(SELECT p.id,p.created_at FROM public.paige_invoice_payments p JOIN public.paige_invoices i ON i.id=p.invoice_id AND i.tenant_id=p.tenant_id WHERE p.tenant_id=_expected_tenant_id ORDER BY p.created_at,p.id LIMIT 10001) visible;
    END IF;
    IF coalesce(array_length(all_ids,1),0)>10000 THEN RAISE EXCEPTION 'Export exceeds 10000 records; no complete export produced' USING ERRCODE='22023';END IF;
    INSERT INTO public.paige_sales_export_snapshots(id,tenant_id,actor_user_id,entity,membership_count) VALUES(gen_random_uuid(),_expected_tenant_id,auth.uid(),_entity,coalesce(array_length(all_ids,1),0)) RETURNING * INTO capture;
    INSERT INTO public.paige_sales_export_members(snapshot_id,position,record_id) SELECT capture.id,ordinality::integer,id FROM unnest(all_ids) WITH ORDINALITY records(id,ordinality);
  END IF;
  SELECT array_agg(record_id ORDER BY position),array_agg(position ORDER BY position) INTO ids,positions FROM(SELECT record_id,position FROM public.paige_sales_export_members WHERE snapshot_id=capture.id AND position>position_after ORDER BY position LIMIT _limit+1) page;
  IF _entity='invoice' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'tenant_id',i.tenant_id,'client_id',i.contact_id,'client_name',public._sales_collection_client_name(i.contact_id,i.tenant_id),'invoice_number',i.invoice_number,
      'source_invoice_number',i.billing_import_provenance->>'source_invoice_number','status',i.status,'version',coalesce(i.billing_import_version,i.billing_lifecycle_version,i.billing_draft_version),'amount_cents',i.amount_total_cents,'currency',lower(i.currency),'due_date',i.due_date,'created_at',i.created_at,
      'manual_recorded_cents',coalesce(p.received,0),'remaining_cents',i.amount_total_cents-coalesce(p.received,0),'receipt_count',coalesce(p.records,0),
      'record_kind',CASE WHEN i.billing_import_provenance IS NOT NULL THEN 'imported' WHEN i.billing_draft_version IS NOT NULL THEN 'managed' ELSE 'provider_or_legacy' END,
      'provenance',CASE WHEN i.billing_import_provenance IS NOT NULL THEN 'owner_imported_unverified' ELSE 'canonical_record' END) ORDER BY i.created_at,i.id),'[]') INTO rows
      FROM public.paige_invoices i LEFT JOIN LATERAL(SELECT sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) received,count(*) records FROM public.paige_invoice_payments WHERE invoice_id=i.id AND tenant_id=_expected_tenant_id) p ON true
      WHERE i.tenant_id=_expected_tenant_id AND i.id=ANY(ids[1:_limit]);
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'tenant_id',p.tenant_id,'invoice_id',p.invoice_id,'client_id',i.contact_id,'client_name',public._sales_collection_client_name(i.contact_id,i.tenant_id),
      'invoice_number',i.invoice_number,'source_invoice_number',i.billing_import_provenance->>'source_invoice_number',
      'kind',p.kind,'amount_cents',p.amount_cents,'currency',p.currency,'method',p.method,'received_at',p.received_at,'created_at',p.created_at,
      'reference',p.reference,'notes',p.notes,'reason',p.reason,'actor_user_id',p.actor_user_id,'reverses_payment_id',p.reverses_payment_id,
      'provenance',CASE WHEN p.import_provenance IS NOT NULL THEN 'owner_imported_unverified' ELSE 'human_recorded' END) ORDER BY p.created_at,p.id),'[]') INTO rows
      FROM public.paige_invoice_payments p JOIN public.paige_invoices i ON i.id=p.invoice_id AND i.tenant_id=p.tenant_id WHERE p.tenant_id=_expected_tenant_id AND p.id=ANY(ids[1:_limit]);
  END IF;
  more:=coalesce(array_length(ids,1),0)>_limit;
  IF jsonb_array_length(rows)<>least(_limit,coalesce(array_length(ids,1),0)) THEN RAISE EXCEPTION 'Export membership changed; no complete export produced' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('rows',rows,'has_more',more,'snapshot_at',capture.created_at,'membership_captured_at',capture.created_at,'facts_read_at',read_at,'export_completed_at',CASE WHEN NOT more THEN clock_timestamp() ELSE NULL END,'membership_count',capture.membership_count,
    'next_cursor',CASE WHEN more THEN jsonb_build_object('snapshot_id',capture.id,'after_position',positions[_limit],'entity',_entity) ELSE NULL END,
    'balance_basis','manual_recorded_only','membership_boundary','canonical_ids_snapshot');
END $$;
REVOKE ALL ON FUNCTION public.list_sales_collection_register(uuid,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_sales_collection_register(uuid,text,integer,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_sales_collection_import(_expected_tenant_id uuid,_batch_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE batch public.paige_sales_import_batches%ROWTYPE;
BEGIN
  IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Collection workspace changed' USING ERRCODE='42501';END IF;
  PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
  SELECT * INTO batch FROM public.paige_sales_import_batches WHERE id=_batch_id AND tenant_id=_expected_tenant_id AND actor_user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed import unavailable' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('id',batch.id,'source_account',batch.source_account,'rows',batch.rows,'content_digest',batch.content_digest,'state',batch.state,'review',batch.review,'created_at',batch.created_at,'committed_at',batch.committed_at);
END $$;
REVOKE ALL ON FUNCTION public.read_sales_collection_import(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_sales_collection_import(uuid,uuid) TO authenticated;

-- One declared read seam delegates to the existing canonical readers and scope gates.
CREATE OR REPLACE FUNCTION public.read_sales_collections(_expected_tenant_id uuid,_entity text,_limit integer DEFAULT 25,_cursor jsonb DEFAULT NULL,_before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Collection workspace changed' USING ERRCODE='42501';END IF;
  PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
  IF _entity IS NULL OR _entity NOT IN ('agreement','invoice','receipt') OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid collection read' USING ERRCODE='22023';
  END IF;
  IF _entity='agreement' THEN
    IF _cursor IS NOT NULL THEN RAISE EXCEPTION 'Agreement read requires before-id only' USING ERRCODE='22023';END IF;
    RETURN public.list_sales_collection_agreements(_expected_tenant_id,_limit,_before_id);
  END IF;
  IF _before_id IS NOT NULL THEN RAISE EXCEPTION 'Register read requires snapshot cursor only' USING ERRCODE='22023';END IF;
  IF _cursor IS NOT NULL AND (jsonb_typeof(_cursor)<>'object' OR _cursor->>'entity' IS DISTINCT FROM _entity) THEN
    RAISE EXCEPTION 'Collection cursor entity mismatch' USING ERRCODE='22023';
  END IF;
  RETURN public.list_sales_collection_register(_expected_tenant_id,_entity,_limit,_cursor);
END $$;
REVOKE ALL ON FUNCTION public.read_sales_collections(uuid,text,integer,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_collections(uuid,text,integer,jsonb,uuid) TO authenticated;
