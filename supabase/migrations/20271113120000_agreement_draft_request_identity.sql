-- E04 native preparation foundation. Same agreement/signers/events and SAVE writer.
-- Nullable metadata preserves all old rows/callers. No backfill, signature, send,
-- financial obligation, provider activation, Chat registration or new execution store.
BEGIN;
SET LOCAL lock_timeout='5s';

ALTER TABLE public.paige_agreements
  ADD COLUMN IF NOT EXISTS draft_creation_request_id uuid,
  ADD COLUMN IF NOT EXISTS draft_creation_request_sha256 text;

DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.paige_agreements'::regclass AND conname='pa_draft_creation_request_ck') THEN
    ALTER TABLE public.paige_agreements ADD CONSTRAINT pa_draft_creation_request_ck CHECK (
      (draft_creation_request_id IS NULL AND draft_creation_request_sha256 IS NULL)
      OR (draft_creation_request_id IS NOT NULL AND draft_creation_request_sha256 IS NOT NULL
        AND draft_creation_request_sha256 ~ '^[0-9a-f]{64}$')
    );
  END IF;
END;
$constraint$;

CREATE UNIQUE INDEX IF NOT EXISTS paige_agreements_draft_creation_request_uidx
  ON public.paige_agreements(tenant_id,draft_creation_request_id)
  WHERE draft_creation_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.preserve_agreement_draft_request() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
  IF OLD.draft_creation_request_id IS NOT NULL AND
    ROW(NEW.draft_creation_request_id,NEW.draft_creation_request_sha256,NEW.tenant_id,NEW.created_by)
      IS DISTINCT FROM
    ROW(OLD.draft_creation_request_id,OLD.draft_creation_request_sha256,OLD.tenant_id,OLD.created_by) THEN
    RAISE EXCEPTION 'The original draft creation identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.preserve_agreement_draft_request() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_preserve_agreement_draft_request ON public.paige_agreements;
CREATE TRIGGER trg_preserve_agreement_draft_request BEFORE UPDATE ON public.paige_agreements
  FOR EACH ROW EXECUTE FUNCTION public.preserve_agreement_draft_request();

-- Creation only. Editing remains the original SAVE with a real existing ID/CAS.
-- A recovered request returns the original identity and CURRENT metadata. Callers
-- must re-read that record, never assume its current content still equals the input.
CREATE OR REPLACE FUNCTION public.create_paige_agreement_draft_once(
  _expected_tenant_id uuid,
  _request_id uuid,
  _contact_id uuid,
  _title text,
  _body_markdown text,
  _offer_id uuid DEFAULT NULL,
  _commercial_terms_id uuid DEFAULT NULL,
  _body_source text DEFAULT 'paige_draft',
  _source_version_id uuid DEFAULT NULL,
  _document_path text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _title_t text := pg_catalog.btrim(coalesce(_title,''));
  _body_t text := pg_catalog.btrim(coalesce(_body_markdown,''));
  _path_t text := nullif(pg_catalog.btrim(coalesce(_document_path,'')),'');
  _digest text;
  _row public.paige_agreements%ROWTYPE;
  _saved jsonb;
  _recovered boolean;
  _event uuid;
BEGIN
  -- Same canonical authority as the native SAVE, including legitimate delegated
  -- company-workspace operators. No model-supplied actor or new role policy.
  IF _actor IS NULL OR _tenant IS NULL OR _expected_tenant_id IS DISTINCT FROM _tenant
    OR public.is_tenant_admin(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Agreement workspace or authority unavailable' USING ERRCODE='42501';
  END IF;
  IF _request_id IS NULL THEN
    RAISE EXCEPTION 'A stable draft creation request is required' USING ERRCODE='22023';
  END IF;
  IF _body_source IS NULL OR _body_source NOT IN ('paige_draft','tenant_template','tenant_upload')
    OR (_body_source='tenant_template' AND _source_version_id IS NULL)
    OR (_body_source<>'tenant_template' AND _source_version_id IS NOT NULL)
    OR (_body_source='tenant_upload' AND _body_t<>'')
    OR (_body_source<>'tenant_upload' AND _path_t IS NOT NULL) THEN
    RAISE EXCEPTION 'Review the exact document source before saving' USING ERRCODE='22023';
  END IF;
  -- The existing upload namespace remains authoritative. This validates a reference,
  -- not file existence, MIME, retained-byte integrity or document readiness.
  IF _body_source='tenant_upload' AND (_path_t IS NULL
    OR _path_t NOT LIKE _tenant::text||'/%'
    OR pg_catalog.strpos(_path_t,'..')>0 OR pg_catalog.strpos(_path_t,pg_catalog.chr(92))>0) THEN
    RAISE EXCEPTION 'Uploaded document reference unavailable' USING ERRCODE='42501';
  END IF;
  _digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('actor',_actor,'tenant',_tenant,'client',_contact_id,
      'title',_title_t,'body',CASE WHEN _body_source='tenant_upload' THEN NULL ELSE _body_t END,
      'offer',_offer_id,'terms',_commercial_terms_id,'source',_body_source,
      'source_version',_source_version_id,'path',_path_t)::text,'UTF8')),'hex');

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'paige-agreement-draft:'||_tenant::text||':'||_request_id::text,0));
  SELECT * INTO _row FROM public.paige_agreements
    WHERE tenant_id=_tenant AND draft_creation_request_id=_request_id;
  _recovered := FOUND;
  IF _recovered THEN
    IF _row.created_by IS DISTINCT FROM _actor OR _row.draft_creation_request_sha256 IS DISTINCT FROM _digest THEN
      RAISE EXCEPTION 'That draft request belongs to a different creation intent' USING ERRCODE='40001';
    END IF;
  ELSE
    -- ONE native writer: its client/offer/terms/template constraints, event and
    -- counterparty seed remain authoritative and transactional.
    _saved := public.save_paige_agreement(
      _expected_tenant_id:=_expected_tenant_id,_agreement_id:=NULL,_contact_id:=_contact_id,
      _title:=_title_t,_body_markdown:=CASE WHEN _body_source='tenant_upload' THEN NULL ELSE _body_t END,
      _offer_id:=_offer_id,_commercial_terms_id:=_commercial_terms_id,_body_source:=_body_source,
      _source_version_id:=_source_version_id,_document_path:=_path_t,_expected_updated_at:=NULL);
    UPDATE public.paige_agreements SET draft_creation_request_id=_request_id,draft_creation_request_sha256=_digest
      WHERE id=(_saved->>'id')::uuid AND tenant_id=_tenant AND created_by=_actor
        AND status='draft' AND draft_creation_request_id IS NULL
      RETURNING * INTO _row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The original draft could not be confirmed' USING ERRCODE='40001';
    END IF;
  END IF;

  SELECT id INTO _event FROM public.paige_agreement_events
    WHERE tenant_id=_tenant AND agreement_id=_row.id AND event_type='created'
      AND actor_kind='owner' AND actor_user_id=_actor ORDER BY seq LIMIT 1;
  IF _event IS NULL THEN
    RAISE EXCEPTION 'The original draft creation receipt is unavailable' USING ERRCODE='55000';
  END IF;
  RETURN pg_catalog.jsonb_build_object('state',CASE WHEN _recovered THEN 'recovered' ELSE 'created' END,
    'signing_id',_row.id,'signature_state',_row.status,'version',_row.version,
    'updated_at',_row.updated_at,'creation_event_id',_event);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_paige_agreement_draft_once(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_paige_agreement_draft_once(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text)
  TO authenticated;

-- Explicit human preparation DTO for ONE selected record. No token, token hash,
-- signing IP or storage key is returned. Existing status/Chat readers stay unchanged.
CREATE OR REPLACE FUNCTION public.read_paige_agreement_preparation(
  _expected_tenant_id uuid,_signing_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
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
    'status',_row.status,'version',_row.version,'updated_at',_row.updated_at,
    'can_edit',_row.status='draft' AND _row.content_sha256 IS NULL AND _row.content_storage_key IS NULL,
    'content_sha256',_row.content_sha256,'sealed_sha256',_row.sealed_sha256),
    'signers',_signers);
END;
$function$;
REVOKE ALL ON FUNCTION public.read_paige_agreement_preparation(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_paige_agreement_preparation(uuid,uuid) TO authenticated;

-- A later page may retain ONLY its opaque request ID, never private legal text.
-- Reconcile that original request before loading its selected preparation record.
-- A missing row is UNCONFIRMED, never proof of rollback or permission to create
-- a replacement: an earlier request may not yet have arrived at the lock.
CREATE OR REPLACE FUNCTION public.recover_paige_agreement_draft_creation(
  _expected_tenant_id uuid,_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _row public.paige_agreements%ROWTYPE;
  _event uuid;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR _expected_tenant_id IS DISTINCT FROM _tenant
    OR public.is_tenant_admin(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Agreement workspace or authority unavailable' USING ERRCODE='42501';
  END IF;
  IF _request_id IS NULL THEN
    RAISE EXCEPTION 'The original draft creation request is required' USING ERRCODE='22023';
  END IF;
  -- VOLATILE deliberately reads a fresh snapshot after waiting for a creator's
  -- transaction. A STABLE statement snapshot could miss the newly committed row.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'paige-agreement-draft:'||_tenant::text||':'||_request_id::text,0));
  SELECT * INTO _row FROM public.paige_agreements
    WHERE tenant_id=_tenant AND draft_creation_request_id=_request_id AND created_by=_actor;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('state','unconfirmed');
  END IF;
  SELECT id INTO _event FROM public.paige_agreement_events
    WHERE tenant_id=_tenant AND agreement_id=_row.id AND event_type='created'
      AND actor_kind='owner' AND actor_user_id=_actor ORDER BY seq LIMIT 1;
  IF _event IS NULL THEN
    RAISE EXCEPTION 'The original draft creation receipt is unavailable' USING ERRCODE='55000';
  END IF;
  RETURN pg_catalog.jsonb_build_object('state','recovered','signing_id',_row.id,
    'signature_state',_row.status,'version',_row.version,'updated_at',_row.updated_at,
    'creation_event_id',_event);
END;
$function$;
REVOKE ALL ON FUNCTION public.recover_paige_agreement_draft_creation(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recover_paige_agreement_draft_creation(uuid,uuid) TO authenticated;
COMMIT;
