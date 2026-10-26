-- EXP04: matched original accepted/effectuated evidence in the existing scoped read.
-- Evidence is not approval or execution authority. Original writers revalidate their source.
-- Keep older deposit/custom-quote read markers unverified. Additional finite kinds require
-- complete matching original evidence; no client label or proof object grants write authority.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $preflight$
DECLARE entry record; p record;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('list_sales_collection_agreements(uuid,integer,uuid)','5c417ab5ff754506c60342d2c5f2d35b','8a0cb33d5ca87cea2ea6eb90f02c7dd9','plpgsql','v',true,'jsonb','search_path=pg_catalog, public','authenticated',false),
  ('_sales_collection_amount_basis(public.tenant_client_agreements)','7544b588965ce92018bf45020c00dcb1','a7c2887fc4578d00a7e9cf84d6b53097','sql','s',false,'text','search_path=pg_catalog, public',NULL,false),
  ('_sales_collection_accepted_total_evidence(public.tenant_client_agreements)','65e7d7b962a6e994e85545d892d7949d','65e7d7b962a6e994e85545d892d7949d','sql','s',false,'jsonb','search_path=pg_catalog, public',NULL,true),
  ('preview_sales_collection_command(uuid,uuid,jsonb)','de97896559987f475de6972b8ef0a595','de97896559987f475de6972b8ef0a595','plpgsql','v',true,'jsonb','search_path=pg_catalog, public','service_role',false),
  ('execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb)','4a25621d37c0b292aa3b38d5b7f055f2','4a25621d37c0b292aa3b38d5b7f055f2','plpgsql','v',true,'jsonb','search_path=pg_catalog, public','service_role',false),
  ('_paige_accepted_commercial_payload(public.paige_agreements)','235026b37dfde7b0f151588c680c8ca9','235026b37dfde7b0f151588c680c8ca9','plpgsql','s',false,'jsonb','search_path=""',NULL,false),
  ('_paige_retained_commercial_payload(public.paige_agreements)','5347818ecd1dda3b7b28129e1b8f8033','5347818ecd1dda3b7b28129e1b8f8033','plpgsql','s',false,'jsonb','search_path=""',NULL,false),
  ('_paige_commercial_canonical_json(jsonb)','bbfeef876dc866c6d276d2be2662ae74','bbfeef876dc866c6d276d2be2662ae74','plpgsql','i',false,'text','search_path=""',NULL,false)
 ) x(signature,old_hash,new_hash,language,volatility,definer,return_type,path_setting,caller_role,optional) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.'||entry.signature);
  IF NOT FOUND THEN
   IF entry.optional THEN CONTINUE; END IF;
   RAISE EXCEPTION 'Original Collections evidence source unavailable: %',entry.signature USING ERRCODE='55000';
  END IF;
  IF md5(p.prosrc) NOT IN (entry.old_hash,entry.new_hash)
    OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname=entry.language)
    OR p.provolatile::text IS DISTINCT FROM entry.volatility OR p.prosecdef IS DISTINCT FROM entry.definer
    OR p.prorettype IS DISTINCT FROM to_regtype(entry.return_type) OR p.proretset
    OR p.proconfig IS DISTINCT FROM ARRAY[entry.path_setting]
    OR (entry.caller_role IS NOT NULL AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname=entry.caller_role) AND a.privilege_type='EXECUTE'))
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.privilege_type<>'EXECUTE'
        OR a.grantee NOT IN(p.proowner,coalesce((SELECT oid FROM pg_roles WHERE rolname=entry.caller_role),p.proowner))
        OR a.is_grantable AND a.grantee<>p.proowner) THEN
   RAISE EXCEPTION 'Original Collections evidence source/metadata changed: %',entry.signature USING ERRCODE='55000';
  END IF;
 END LOOP;
END $preflight$;

CREATE OR REPLACE FUNCTION public._sales_collection_accepted_total_evidence(_agreement public.tenant_client_agreements)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $evidence$
 SELECT (SELECT jsonb_build_object('schema_version',1,'kind','accepted_effective_principal',
 'tenant_id',a.tenant_id,'commercial_terms_id',a.id,'client_id',a.contact_id,'offer_id',a.offer_id,
 'principal_minor',a.agreed_amount_minor,'currency',a.agreed_currency,
 'current_terms_version',a.collection_terms_version,'accepted_terms_version',a.effective_terms_version,
 'signing_id',s.id,'signing_version',s.version,'source_digest',a.effective_source_digest,
 'operation_id',o.id,'receipt_id',o.result->'receipt_id') FROM public.paige_agreements s
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
                AND r.detail->'terms_version'=to_jsonb(a.effective_terms_version)))
 FROM (SELECT (_agreement).*) a
 WHERE a.term_kind IN ('installment','deposit','custom_quote') AND a.price_basis='negotiated'
   AND a.catalog_price_id IS NULL AND a.renews_on IS NULL AND a.effective_at IS NOT NULL;
$evidence$;
REVOKE ALL ON FUNCTION public._sales_collection_accepted_total_evidence(public.tenant_client_agreements) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE definition text; source text;
BEGIN
 SELECT pg_get_functiondef(oid),prosrc INTO definition,source FROM pg_proc
 WHERE oid='public._sales_collection_amount_basis(public.tenant_client_agreements)'::regprocedure;
 IF md5(source)='7544b588965ce92018bf45020c00dcb1' THEN
  EXECUTE replace(definition,$before$      -- Older agreements need no invented creation operation. The original accepted
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
$before$,$after$      -- One private original-source query supplies both meaning and inspectable evidence.
      WHEN a.term_kind IN ('installment','deposit','custom_quote') AND public._sales_collection_accepted_total_evidence(a) IS NOT NULL THEN 'total'
$after$);
 END IF;
 SELECT pg_get_functiondef(oid),prosrc INTO definition,source FROM pg_proc
 WHERE oid='public.list_sales_collection_agreements(uuid,integer,uuid)'::regprocedure;
 IF md5(source)='5c417ab5ff754506c60342d2c5f2d35b' THEN
  EXECUTE replace(definition,$before$'term_kind',a.term_kind,'agreed_amount_basis',public._sales_collection_amount_basis(a),$before$,$after$'term_kind',a.term_kind,'agreed_amount_basis',CASE WHEN a.term_kind IN ('deposit','custom_quote') THEN 'unverified' ELSE public._sales_collection_amount_basis(a) END,
    'agreed_amount_total_evidence',public._sales_collection_accepted_total_evidence(a),$after$);
 END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public._sales_collection_amount_basis(public.tenant_client_agreements)'::regprocedure) IS DISTINCT FROM 'a7c2887fc4578d00a7e9cf84d6b53097'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.list_sales_collection_agreements(uuid,integer,uuid)'::regprocedure) IS DISTINCT FROM '8a0cb33d5ca87cea2ea6eb90f02c7dd9'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public._sales_collection_accepted_total_evidence(public.tenant_client_agreements)'::regprocedure) IS DISTINCT FROM '65e7d7b962a6e994e85545d892d7949d' THEN
  RAISE EXCEPTION 'Original Collections evidence patch readback failed' USING ERRCODE='55000';
 END IF;
END $patch$;
COMMIT;
