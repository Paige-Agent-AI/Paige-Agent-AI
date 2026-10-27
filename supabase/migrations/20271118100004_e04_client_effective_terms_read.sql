-- EXP04: original accepted/effectuated terms are historical source records,
-- separate from the mutable working plan. No writer, approval or ledger change.
-- Proposed forward version only; normal release still requires the current
-- shared frontier/order, exact review/CI and authorized production readback.
BEGIN;

DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public._paige_accepted_commercial_payload(public.paige_agreements)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'235026b37dfde7b0f151588c680c8ca9'
   OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS NULL
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
      WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'Original accepted signing reader changed' USING ERRCODE='23514';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public._paige_retained_commercial_payload(public.paige_agreements)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'5347818ecd1dda3b7b28129e1b8f8033'
   OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS NULL
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
      WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'Original retained commercial reader changed' USING ERRCODE='23514';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public.read_client_engagement_status(uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN ('401d2de2a7dd91192da36b242b12041d','4680297b25322dca36b44dbaaf528a39')
   OR NOT p.prosecdef OR p.provolatile<>'v'
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
      WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable
        OR a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')))
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
      WHERE a.privilege_type='EXECUTE' AND a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')) THEN
  RAISE EXCEPTION 'Original scoped client status reader changed' USING ERRCODE='23514';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public._sales_client_effective_terms(uuid,uuid,uuid)');
 IF FOUND AND (pg_catalog.md5(p.prosrc)<>'2d0bb3db63603ffe58b66b492ffc37ef' OR p.prosecdef OR p.provolatile<>'s'
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS NULL
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
      WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner)) THEN
  RAISE EXCEPTION 'Original effective snapshot projection changed' USING ERRCODE='23514';
 END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public._sales_client_effective_terms(_tenant uuid,_client uuid,_agreement uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $snapshot$
DECLARE t public.tenant_client_agreements%ROWTYPE; s public.paige_agreements%ROWTYPE;
 o public.paige_sales_collection_operations%ROWTYPE; p jsonb; base jsonb; receipt uuid;
BEGIN
 SELECT * INTO t FROM public.tenant_client_agreements
 WHERE id=_agreement AND tenant_id=_tenant AND contact_id=_client;
 IF NOT FOUND THEN RETURN NULL; END IF;
 base:=pg_catalog.jsonb_build_object('schema_version',1,'state','not_recorded',
  'tenant_id',t.tenant_id,'client_id',t.contact_id,'commercial_terms_id',t.id,'offer_id',t.offer_id,
  'working_terms_version',t.collection_terms_version);
 IF t.effective_signing_id IS NULL AND t.effective_terms_version IS NULL
  AND t.effective_at IS NULL AND t.effective_operation_id IS NULL AND t.effective_source_digest IS NULL THEN
  RETURN base;
 END IF;
 base:=pg_catalog.jsonb_set(base,'{state}','"unverified"'::jsonb);
 IF t.effective_signing_id IS NULL OR t.effective_terms_version IS NULL OR t.effective_at IS NULL
  OR t.effective_operation_id IS NULL OR t.effective_source_digest IS NULL
  OR t.effective_terms_version<0 OR t.effective_terms_version>9007199254740991
  OR t.collection_terms_version<t.effective_terms_version OR t.collection_terms_version>9007199254740991 THEN
  RETURN base;
 END IF;
 SELECT * INTO s FROM public.paige_agreements
 WHERE id=t.effective_signing_id AND tenant_id=t.tenant_id AND contact_id=t.contact_id
  AND offer_id=t.offer_id AND commercial_terms_id=t.id;
 IF NOT FOUND THEN RETURN base; END IF;
 -- The original private engine verifies consent, every signer, exact document
 -- revision, retained commercial capsule, audit events and sealed metadata.
 -- Downloaded-byte/hash verification stays with the original seal endpoint.
 p:=public._paige_accepted_commercial_payload(s);
 IF p IS NULL OR p->'schema_version' IS DISTINCT FROM '2'::jsonb
  OR p->>'amount_basis' IS DISTINCT FROM 'total'
  OR p#>'{source,terms_version}' IS DISTINCT FROM pg_catalog.to_jsonb(t.effective_terms_version)
  OR s.commercial_presentation->>'payload_digest' IS DISTINCT FROM t.effective_source_digest THEN
  RETURN base;
 END IF;
 SELECT * INTO o FROM public.paige_sales_collection_operations
 WHERE id=t.effective_operation_id AND tenant_id=t.tenant_id
  AND command=pg_catalog.jsonb_build_object('action','collection.effectuate_terms',
   'agreement_id',t.id::text,'signing_id',s.id::text,'signing_version',s.version,
   'expected_version',t.effective_terms_version,'payload_digest',t.effective_source_digest,
   'expected_updated_at',p#>>'{source,terms_updated_at}','sealed_sha256',s.sealed_sha256,
   'invoice_id',p#>>'{source,invoice_id}','invoice_draft_version',p#>'{source,invoice_draft_version}')
  AND result @> pg_catalog.jsonb_build_object('ok',true,'outcome','commercial_terms_effectuated','historical_receipt',true,
   'row',pg_catalog.jsonb_build_object('id',t.id::text,'tenant_id',t.tenant_id::text,'status_at_execution','active',
    'signing_id',s.id::text,'signing_version',s.version,'terms_version',t.effective_terms_version,
    'source_digest',t.effective_source_digest,'actor_user_id',actor_user_id::text),
   'operation',pg_catalog.jsonb_build_object('id',id::text,'action','collection.effectuate_terms'));
 IF NOT FOUND THEN RETURN base; END IF;
 -- JSON timestamp spelling depends on the session zone. Verify the same
 -- explicit-offset instant, rather than rejecting valid retained evidence
 -- because a later read uses another session zone. Malformed history is unknown.
 IF pg_catalog.jsonb_typeof(o.result#>'{row,effective_at}') IS DISTINCT FROM 'string'
  OR coalesce(o.result#>>'{row,effective_at}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
  RETURN base;
 END IF;
 BEGIN
  IF (o.result#>>'{row,effective_at}')::timestamptz IS DISTINCT FROM t.effective_at THEN RETURN base; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN base;
 END;
 SELECT r.id INTO receipt FROM public.paige_workspace_events r
 WHERE r.id::text=o.result->>'receipt_id' AND r.tenant_id=t.tenant_id AND r.actor_id=o.actor_user_id
  AND r.source_kind='capability_run' AND r.source_id=o.id AND r.source_revision=0
  AND r.outcome='capability_succeeded' AND r.capability_key='sales_effectuate_commercial_terms'
  AND r.detail->>'origin'='owner_ui' AND r.detail->>'agreement_id'=t.id::text
  AND r.detail->>'signing_id'=s.id::text AND r.detail->'terms_version'=pg_catalog.to_jsonb(t.effective_terms_version);
 IF receipt IS NULL THEN RETURN base; END IF;
 RETURN base||pg_catalog.jsonb_build_object('state','verified','terms_version',t.effective_terms_version,
  'signing_id',s.id,'signing_version',s.version,'completed_at',s.completed_at,
  'document_sha256',s.content_sha256,'sealed_sha256',s.sealed_sha256,
  'effectuated_at',t.effective_at,'operation_id',o.id,'receipt_id',receipt,
  'source_digest',t.effective_source_digest,'invoice_id',p#>>'{source,invoice_id}',
  'principal_minor',p->'principal_minor','currency',p->>'currency',
  'collection_terms',p->'collection_terms','engagement',p->'engagement',
  'working_differs',t.collection_terms_version IS DISTINCT FROM t.effective_terms_version
   OR pg_catalog.to_jsonb(t.agreed_amount_minor) IS DISTINCT FROM p->'principal_minor'
   OR pg_catalog.lower(t.agreed_currency) IS DISTINCT FROM p->>'currency'
   OR t.collection_terms IS DISTINCT FROM p->'collection_terms'
   OR t.starts_on::text IS DISTINCT FROM p#>>'{engagement,starts_on}'
   OR t.ends_on::text IS DISTINCT FROM p#>>'{engagement,ends_on}'
   OR t.price_basis::text IS DISTINCT FROM p#>>'{engagement,price_basis}');
END
$snapshot$;
REVOKE ALL ON FUNCTION public._sales_client_effective_terms(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public._sales_client_effective_terms(uuid,uuid,uuid) IS
 'EXP04 private read-only original accepted/effectuated commercial snapshot. Exact native signing, operation and Rail evidence; historical effectuation is distinct from current working terms and current permission. No financial calculation, document-byte readback or customer completion claim.';

DO $reader$
DECLARE original text; changed text; expected_oid oid;
 anchor text:=$anchor$'collection_terms',p.collection_terms,'collection_terms_version',p.collection_terms_version,$anchor$;
 replacement text:=$replacement$'collection_terms',p.collection_terms,'collection_terms_version',p.collection_terms_version,
    'effective_terms',public._sales_client_effective_terms(_expected_tenant_id,_contact_id,p.id),$replacement$;
 gap_anchor text:=$gap_before$  -- Facts the platform does not record yet are declared, never inferred as zero.
  'not_recorded',jsonb_build_array('payment_disputes','provider_refunds','terms_effective_transition','installment_allocation'),$gap_before$;
 gap_replacement text:=$gap_after$  -- Gaps in this projection are declared, never inferred as zero.
  'not_recorded',jsonb_build_array('payment_disputes','provider_refunds','installment_allocation'),$gap_after$;
BEGIN
 expected_oid:='public.read_client_engagement_status(uuid,uuid)'::regprocedure;
 IF (SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=expected_oid)='401d2de2a7dd91192da36b242b12041d' THEN
  original:=pg_catalog.pg_get_functiondef(expected_oid);
  IF (pg_catalog.length(original)-pg_catalog.length(pg_catalog.replace(original,anchor,'')))/pg_catalog.length(anchor)<>1
   OR (pg_catalog.length(original)-pg_catalog.length(pg_catalog.replace(original,gap_anchor,'')))/pg_catalog.length(gap_anchor)<>1 THEN
   RAISE EXCEPTION 'Original client status projection anchor changed' USING ERRCODE='23514';
  END IF;
  changed:=pg_catalog.replace(pg_catalog.replace(original,anchor,replacement),gap_anchor,gap_replacement);
  EXECUTE changed;
 END IF;
 IF 'public.read_client_engagement_status(uuid,uuid)'::regprocedure::oid<>expected_oid
  OR (SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=expected_oid)<>'4680297b25322dca36b44dbaaf528a39' THEN
  RAISE EXCEPTION 'Additive original client status readback differs' USING ERRCODE='23514';
 END IF;
END
$reader$;
COMMIT;
