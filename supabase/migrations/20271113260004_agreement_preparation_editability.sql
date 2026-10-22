-- EXP04: the original closed preparation read mirrors existing freeze rules.
-- Same record, author floor, JSON shape, signature, owner, ACL and search_path.
-- Read projection only: no business data, document, signature or event rewrite.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$
DECLARE
 original_body text:=$original$
DECLARE
  _tenant uuid := public.current_user_tenant_id();
  _row public.paige_agreements%ROWTYPE;
  _signers jsonb;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL OR _expected_tenant_id IS DISTINCT FROM _tenant
    OR public.is_tenant_admin(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Agreement workspace or authority unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO _row FROM public.paige_agreements WHERE id=_signing_id AND tenant_id=_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agreement workspace or authority unavailable' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',s.id,'full_name',s.full_name,'email',s.email,'signer_role',s.signer_role,
    'signing_order',s.signing_order,'status',s.status,'signed_at',s.signed_at,
    'declined_at',s.declined_at) ORDER BY s.signing_order,s.id),'[]'::jsonb) INTO _signers
    FROM public.paige_agreement_signers s WHERE s.agreement_id=_row.id AND s.tenant_id=_tenant;
  RETURN pg_catalog.jsonb_build_object('agreement',pg_catalog.jsonb_build_object(
    'id',_row.id,'contact_id',_row.contact_id,'offer_id',_row.offer_id,'commercial_terms_id',_row.commercial_terms_id,
    'title',_row.title,'body_source',_row.body_source,'source_version_id',_row.source_version_id,
    'body_markdown',_row.body_markdown,'has_source_document',_row.document_path IS NOT NULL,
    'status',_row.status,'version',_row.version,'updated_at',_row.updated_at,'expires_at',_row.expires_at,
    'can_edit',_row.status='draft' AND _row.content_sha256 IS NULL AND _row.content_storage_key IS NULL,
    'content_sha256',_row.content_sha256,'sealed_sha256',_row.sealed_sha256),
    'signers',_signers);
END;
$original$;
 replacement_body text:=$replacement$
DECLARE
  _tenant uuid := public.current_user_tenant_id();
  _row public.paige_agreements%ROWTYPE;
  _signers jsonb;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL OR _expected_tenant_id IS DISTINCT FROM _tenant
    OR public.is_tenant_admin(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Agreement workspace or authority unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO _row FROM public.paige_agreements WHERE id=_signing_id AND tenant_id=_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agreement workspace or authority unavailable' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',s.id,'full_name',s.full_name,'email',s.email,'signer_role',s.signer_role,
    'signing_order',s.signing_order,'status',s.status,'signed_at',s.signed_at,
    'declined_at',s.declined_at) ORDER BY s.signing_order,s.id),'[]'::jsonb) INTO _signers
    FROM public.paige_agreement_signers s WHERE s.agreement_id=_row.id AND s.tenant_id=_tenant;
  RETURN pg_catalog.jsonb_build_object('agreement',pg_catalog.jsonb_build_object(
    'id',_row.id,'contact_id',_row.contact_id,'offer_id',_row.offer_id,'commercial_terms_id',_row.commercial_terms_id,
    'title',_row.title,'body_source',_row.body_source,'source_version_id',_row.source_version_id,
    'body_markdown',_row.body_markdown,'has_source_document',_row.document_path IS NOT NULL,
    'status',_row.status,'version',_row.version,'updated_at',_row.updated_at,'expires_at',_row.expires_at,
    'can_edit',_row.status='draft' AND _row.content_sha256 IS NULL AND _row.content_storage_key IS NULL
      AND _row.sealed_sha256 IS NULL AND _row.sealed_storage_key IS NULL,
    'content_sha256',_row.content_sha256,'sealed_sha256',_row.sealed_sha256),
    'signers',_signers);
END;
$replacement$;
 current_body text;
 definition text;
BEGIN
 SELECT prosrc INTO current_body FROM pg_catalog.pg_proc
  WHERE oid='public.read_paige_agreement_preparation(uuid,uuid)'::regprocedure;
 IF current_body=replacement_body THEN RETURN; END IF;
 IF current_body IS DISTINCT FROM original_body THEN
  RAISE EXCEPTION 'Original agreement preparation reader changed; reconcile before applying';
 END IF;
 definition:=pg_catalog.pg_get_functiondef('public.read_paige_agreement_preparation(uuid,uuid)'::regprocedure);
 IF pg_catalog.strpos(definition,original_body)=0 THEN
  RAISE EXCEPTION 'Original agreement preparation definition changed; reconcile before applying';
 END IF;
 EXECUTE pg_catalog.replace(definition,original_body,replacement_body);
END $migration$;
COMMIT;
