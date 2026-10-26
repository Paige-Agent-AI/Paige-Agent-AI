-- EXP04: one canonical read-only amount-basis contract, revalidated by the original save path.
-- The original executor's record lock, approval, exact replay, write/readback and Rail remain intact.
-- Existing recurring schedules keep their existing route; finite schedules require a verified total.
-- No obligation, charge, signing, send, approval channel or provider is created or activated.
BEGIN;
DO $preflight$
DECLARE entry record; p record; helper oid;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('public.list_sales_collection_agreements(uuid,integer,uuid)','86532270bb5c0adb2ebff564a0dee81b','5c417ab5ff754506c60342d2c5f2d35b','authenticated'),
  ('public.preview_sales_collection_command(uuid,uuid,jsonb)','9ccde31a3199fefc4aac2afbd9547fc0','de97896559987f475de6972b8ef0a595','service_role')
 ) x(signature,old_hash,new_hash,caller_role) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=entry.signature::regprocedure;
  IF md5(p.prosrc) NOT IN (entry.old_hash,entry.new_hash) OR NOT p.prosecdef
    OR p.provolatile<>'v' OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
    OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
    OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname=entry.caller_role) AND a.privilege_type='EXECUTE')
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.privilege_type<>'EXECUTE' OR a.grantee NOT IN(p.proowner,(SELECT oid FROM pg_roles WHERE rolname=entry.caller_role))
        OR a.is_grantable AND a.grantee<>p.proowner) THEN
   RAISE EXCEPTION 'Collections source or metadata changed; reconcile before applying: %',entry.signature USING ERRCODE='55000';
  END IF;
 END LOOP;
 helper:=to_regprocedure('public._sales_collection_amount_basis(public.tenant_client_agreements)');
 IF helper IS NOT NULL THEN
  SELECT * INTO p FROM pg_proc WHERE oid=helper;
  IF md5(p.prosrc)<>'4e31ac734abff5dff2274725876a837c' OR p.prosecdef OR p.provolatile<>'s'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR p.prorettype<>'text'::regtype OR p.proretset
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE') THEN
   RAISE EXCEPTION 'Collections private amount-basis helper changed; reconcile before applying' USING ERRCODE='55000';
  END IF;
 END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public._sales_collection_amount_basis(_agreement public.tenant_client_agreements)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $basis$
 SELECT CASE
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
      ELSE 'unverified' END
 FROM (SELECT (_agreement).*) a;
$basis$;
REVOKE ALL ON FUNCTION public._sales_collection_amount_basis(public.tenant_client_agreements) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE definition text; source text;
BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO definition,source FROM pg_proc p
 WHERE p.oid='public.list_sales_collection_agreements(uuid,integer,uuid)'::regprocedure;
 IF md5(source)='86532270bb5c0adb2ebff564a0dee81b' THEN
  EXECUTE replace(definition,$before$CASE
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
      ELSE 'unverified' END$before$,$after$public._sales_collection_amount_basis(a)$after$);
 END IF;
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO definition,source FROM pg_proc p
 WHERE p.oid='public.preview_sales_collection_command(uuid,uuid,jsonb)'::regprocedure;
 IF md5(source)='9ccde31a3199fefc4aac2afbd9547fc0' THEN
  EXECUTE replace(definition,$before$    summary:='Save this client agreement collection schedule and agreed fee metadata. No invoice, accrual or charge is created.';$before$,$after$    -- The original execute function holds this agreement FOR UPDATE before calling this preview.
    -- Revalidate current amount semantics here; a read or old approval cannot supply them.
    IF _command#>>'{terms,kind}'<>'recurring' AND public._sales_collection_amount_basis(agreement)<>'total' THEN
      eligible:=false;
      summary:='The original commercial amount is not a verified engagement total. Review its original terms before saving a finite collection schedule.';
    ELSE
    summary:='Save this client agreement collection schedule and agreed fee metadata. No invoice, accrual or charge is created.';
    END IF;$after$);
 END IF;
END $patch$;
COMMIT;
