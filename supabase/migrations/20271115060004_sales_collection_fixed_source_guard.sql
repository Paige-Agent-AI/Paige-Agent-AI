-- EXP04: one canonical read-only amount-basis contract, revalidated by the original save path.
-- The original executor's record lock, approval, exact replay, write/readback and Rail remain intact.
-- Existing recurring schedules keep their existing route; finite schedules require a verified total.
-- No obligation, charge, signing, send, approval channel or provider is created or activated.
BEGIN;
DO $preflight$
DECLARE entry record; p record; helper oid;
BEGIN
 -- Reuse the ORIGINAL accepted-payload validation chain, including signer consent,
 -- exact retained presentation and seal/event evidence. Never interpret legal words here.
 FOR entry IN SELECT * FROM (VALUES
  ('public._paige_accepted_commercial_payload(public.paige_agreements)','235026b37dfde7b0f151588c680c8ca9','s','jsonb'),
  ('public._paige_retained_commercial_payload(public.paige_agreements)','5347818ecd1dda3b7b28129e1b8f8033','s','jsonb'),
  ('public._paige_commercial_canonical_json(jsonb)','bbfeef876dc866c6d276d2be2662ae74','i','text')
 ) x(signature,body_hash,volatility,return_type) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(entry.signature);
  IF NOT FOUND OR md5(p.prosrc) IS DISTINCT FROM entry.body_hash OR p.prosecdef
    OR p.provolatile::text IS DISTINCT FROM entry.volatility
    OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
    OR p.prorettype IS DISTINCT FROM to_regtype(entry.return_type) OR p.proretset
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE') THEN
   RAISE EXCEPTION 'Original accepted commercial validator changed; reconcile before applying: %',entry.signature USING ERRCODE='55000';
  END IF;
 END LOOP;
 FOR entry IN SELECT * FROM (VALUES
  ('public.list_sales_collection_agreements(uuid,integer,uuid)','86532270bb5c0adb2ebff564a0dee81b','5c417ab5ff754506c60342d2c5f2d35b','authenticated'),
  ('public.preview_sales_collection_command(uuid,uuid,jsonb)','9ccde31a3199fefc4aac2afbd9547fc0','de97896559987f475de6972b8ef0a595','service_role'),
  ('public.execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb)','4a25621d37c0b292aa3b38d5b7f055f2','4a25621d37c0b292aa3b38d5b7f055f2','service_role')
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
  IF md5(p.prosrc)<>'7544b588965ce92018bf45020c00dcb1' OR p.prosecdef OR p.provolatile<>'s'
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
      -- Older agreements need no invented creation operation. The original accepted
      -- principal and its governed effectuation prove amount meaning only; they do
      -- NOT make a later schedule revision signed, effective, invoiced or paid.
      WHEN a.term_kind='installment' AND a.price_basis='negotiated'
        AND a.catalog_price_id IS NULL AND a.renews_on IS NULL
        AND a.effective_at IS NOT NULL
        AND EXISTS(SELECT 1 FROM public.paige_agreements s
          JOIN public.paige_sales_collection_operations o
            ON o.id=a.effective_operation_id AND o.tenant_id=a.tenant_id
          CROSS JOIN LATERAL (SELECT public._paige_accepted_commercial_payload(s) AS payload) accepted
          WHERE s.id=a.effective_signing_id AND s.tenant_id=a.tenant_id
            AND s.contact_id=a.contact_id AND s.offer_id=a.offer_id AND s.commercial_terms_id=a.id
            AND accepted.payload->'schema_version'='2'::jsonb
            AND accepted.payload->>'amount_basis'='total'
            AND accepted.payload->'principal_minor'=to_jsonb(a.agreed_amount_minor)
            AND accepted.payload->>'currency'=a.agreed_currency
            AND accepted.payload#>>'{engagement,price_basis}'='negotiated'
            AND accepted.payload#>'{source,terms_version}'=to_jsonb(a.effective_terms_version)
            AND s.commercial_presentation->>'payload_digest'=a.effective_source_digest
            AND o.command = jsonb_build_object('action','collection.effectuate_terms',
              'agreement_id',a.id::text,'signing_id',s.id::text,'signing_version',s.version,
              'expected_version',a.effective_terms_version,'payload_digest',a.effective_source_digest,
              'expected_updated_at',accepted.payload#>>'{source,terms_updated_at}',
              'sealed_sha256',s.sealed_sha256,'invoice_id',accepted.payload#>>'{source,invoice_id}',
              'invoice_draft_version',accepted.payload#>'{source,invoice_draft_version}')
            AND o.result @> jsonb_build_object('ok',true,'outcome','commercial_terms_effectuated','historical_receipt',true,
              'row',jsonb_build_object('id',a.id::text,'tenant_id',a.tenant_id::text,'status_at_execution','active',
                'signing_id',s.id::text,'signing_version',s.version,'terms_version',a.effective_terms_version,
                'source_digest',a.effective_source_digest,'actor_user_id',o.actor_user_id::text),
              'operation',jsonb_build_object('id',o.id::text,'action','collection.effectuate_terms'))
            AND EXISTS(SELECT 1 FROM public.paige_workspace_events r
              WHERE r.id::text=o.result->>'receipt_id' AND r.tenant_id=a.tenant_id AND r.actor_id=o.actor_user_id
                AND r.source_kind='capability_run' AND r.source_id=o.id AND r.source_revision=0
                AND r.outcome='capability_succeeded' AND r.capability_key='sales_effectuate_commercial_terms'
                AND r.detail->>'agreement_id'=a.id::text AND r.detail->>'signing_id'=s.id::text
                AND r.detail->'terms_version'=to_jsonb(a.effective_terms_version))) THEN 'total'
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
