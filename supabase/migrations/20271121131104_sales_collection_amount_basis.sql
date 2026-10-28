-- EXP04: preserve the meaning of the ORIGINAL commercial amount in the existing read.
-- No obligation, balance, signing, payment, permission, writer or schedule is created here.
-- Catalogue installment prices are per payment; price_basis is provenance, not amount semantics.
-- A negotiated installment total needs the original immutable governed fixed-creation operation
-- with the same tenant/client/offer and every original economic fact. Legacy ambiguity stays so.
-- Old consumers ignore the additive fields. New consumers treat older readers as unverified.
-- Guard the exact original body: never silently replace a concurrent shared-reader change.
DO $migration$
DECLARE definition text; source text;
BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO definition,source FROM pg_proc p
 WHERE p.oid='public.list_sales_collection_agreements(uuid,integer,uuid)'::regprocedure;
 IF md5(source)='86532270bb5c0adb2ebff564a0dee81b' THEN RETURN; END IF;
 IF md5(source) IS DISTINCT FROM '31e466f42a39aa0424c9c67353d9a85b' THEN
  RAISE EXCEPTION 'Collections agreement reader changed; reconcile original source before applying' USING ERRCODE='55000';
 END IF;
 -- Replace only the projection fragment, retaining the complete current signature, security,
 -- search path, tenant/actor/client checks, bounds, sorting, cursor and function ACL.
 EXECUTE replace(definition,$projection$'status',a.status,'agreed_amount_minor',a.agreed_amount_minor,'agreed_currency',a.agreed_currency,$projection$,$projection$'status',a.status,'agreed_amount_minor',a.agreed_amount_minor,'agreed_currency',a.agreed_currency,
    'term_kind',a.term_kind,'agreed_amount_basis',CASE
      WHEN a.agreed_amount_minor IS NULL OR a.agreed_currency IS NULL THEN 'unverified'
      WHEN a.term_kind='one_time' THEN 'total'
      WHEN a.term_kind='recurring' THEN 'per_cycle'
      WHEN a.term_kind='installment' AND a.price_basis='catalog'
        AND a.catalog_price_snapshot_kind='installment' THEN 'per_installment'
      WHEN a.term_kind='installment' AND a.price_basis='negotiated'
        AND a.catalog_price_id IS NULL AND a.renews_on IS NULL
        AND EXISTS(SELECT 1 FROM public.paige_sales_collection_operations o
          WHERE o.tenant_id=a.tenant_id AND o.result#>>'{row,id}'=a.id::text
            AND o.command->>'action'='collection.create_commercial_terms'
            AND o.actor_user_id=a.created_by
            AND o.command @> jsonb_build_object('action','collection.create_commercial_terms',
              'client_id',a.contact_id::text,'offer_id',a.offer_id::text,'term_kind',a.term_kind,
              'agreed_amount_minor',a.agreed_amount_minor,'agreed_currency',a.agreed_currency,
              'billing_interval',a.billing_interval,'interval_count',a.interval_count,
              'installments_total',a.installments_total,'payment_schedule',a.payment_schedule,
              'starts_on',a.starts_on,'ends_on',a.ends_on)
            AND o.result @> jsonb_build_object('ok',true,'outcome','commercial_terms_created',
              'row',jsonb_build_object('id',a.id::text,'tenant_id',a.tenant_id::text,
                'client_id',a.contact_id::text,'offer_id',a.offer_id::text,
                'amount_cents',a.agreed_amount_minor,'currency',a.agreed_currency))) THEN 'total'
      ELSE 'unverified' END,$projection$);
END $migration$;

-- Bounded per-page provenance lookup against the existing immutable operations, not a new ledger.
CREATE INDEX IF NOT EXISTS sales_collection_fixed_creation_source
 ON public.paige_sales_collection_operations(tenant_id,((result#>>'{row,id}')))
 WHERE command->>'action'='collection.create_commercial_terms';
