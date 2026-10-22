-- Forward280004 after actual E09 frontier270009; no historical migration edited.
-- Native document/layout versions under ONE original agreement. No backfill,
-- document rendering, approval, sending, signing, obligation or payment effect.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE IF NOT EXISTS public.paige_agreement_document_preparations (
  id uuid PRIMARY KEY,
  agreement_id uuid NOT NULL REFERENCES public.paige_agreements(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  revision_no bigint NOT NULL CHECK(revision_no>0),
  client_id uuid NOT NULL,
  source_version integer NOT NULL CHECK(source_version>0),
  source_updated_at timestamptz NOT NULL,
  actor_user_id uuid NOT NULL,
  content_storage_key text NOT NULL,
  document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[a-f0-9]{64}$'),
  document_byte_length integer NOT NULL CHECK(document_byte_length BETWEEN 5 AND 26214400),
  manifest_canonical text NOT NULL CHECK(pg_catalog.octet_length(manifest_canonical) BETWEEN 2 AND 1048576),
  preparation_sha256 text NOT NULL CHECK(preparation_sha256 ~ '^[a-f0-9]{64}$'),
  commercial_payload_digest text CHECK(commercial_payload_digest ~ '^[a-f0-9]{64}$'),
  event_id uuid NOT NULL UNIQUE REFERENCES public.paige_agreement_events(id),
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(agreement_id,revision_no)
);
COMMENT ON TABLE public.paige_agreement_document_preparations IS
  'Immutable native PDF/layout preparations of the original agreement. Selection is not approval, signing, current-source proof, financial terms or execution. No historical backfill.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_paige_agreement_document_preparation_current
  ON public.paige_agreement_document_preparations(agreement_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_paige_agreement_document_preparation_history
  ON public.paige_agreement_document_preparations(tenant_id,agreement_id,revision_no DESC);
ALTER TABLE public.paige_agreement_document_preparations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paige_agreement_document_preparations FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._paige_document_preparation_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Retained document preparations are immutable' USING ERRCODE='23514'; END IF;
  IF OLD.is_current AND NOT NEW.is_current
    AND (pg_catalog.to_jsonb(NEW)-'is_current')=(pg_catalog.to_jsonb(OLD)-'is_current') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Retained document preparations are immutable' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION public._paige_document_preparation_immutable() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_paige_document_preparation_immutable ON public.paige_agreement_document_preparations;
CREATE TRIGGER trg_paige_document_preparation_immutable BEFORE UPDATE OR DELETE
  ON public.paige_agreement_document_preparations FOR EACH ROW EXECUTE FUNCTION public._paige_document_preparation_immutable();
DROP TRIGGER IF EXISTS trg_paige_document_preparation_no_truncate ON public.paige_agreement_document_preparations;
CREATE TRIGGER trg_paige_document_preparation_no_truncate BEFORE TRUNCATE
  ON public.paige_agreement_document_preparations FOR EACH STATEMENT EXECUTE FUNCTION public._paige_document_preparation_immutable();

-- Deliberate initial hold, only for NEW selected preparations. Legacy agreements
-- have none and retain their existing engine. The later canonical approved send
-- integration must replace this hold with exact original approval/receipt checks.
CREATE OR REPLACE FUNCTION public._paige_preparation_legacy_effect_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.paige_agreement_document_preparations p
    WHERE p.agreement_id=NEW.id AND p.tenant_id=NEW.tenant_id AND p.is_current) INTO selected;
  IF selected AND (
    (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('sent','viewed','partially_signed','completed'))
    OR NEW.content_storage_key IS DISTINCT FROM OLD.content_storage_key
    OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
    OR NEW.sealed_storage_key IS DISTINCT FROM OLD.sealed_storage_key
    OR NEW.sealed_sha256 IS DISTINCT FROM OLD.sealed_sha256) THEN
    RAISE EXCEPTION 'Prepared-document signature requests require the canonical approved send integration' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_preparation_legacy_effect_hold() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_paige_preparation_legacy_effect_hold ON public.paige_agreements;
CREATE TRIGGER trg_paige_preparation_legacy_effect_hold
  BEFORE UPDATE OF status,content_storage_key,content_sha256,sealed_storage_key,sealed_sha256
  ON public.paige_agreements FOR EACH ROW EXECUTE FUNCTION public._paige_preparation_legacy_effect_hold();

CREATE OR REPLACE FUNCTION public._paige_preparation_legacy_token_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF ((NEW.token_hash IS NOT NULL AND NEW.token_hash IS DISTINCT FROM OLD.token_hash)
    OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('viewed','signed')))
    AND EXISTS(SELECT 1 FROM public.paige_agreement_document_preparations p
      WHERE p.agreement_id=NEW.agreement_id AND p.tenant_id=NEW.tenant_id AND p.is_current) THEN
    RAISE EXCEPTION 'Prepared-document signing requires the canonical approved send integration' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_preparation_legacy_token_hold() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_paige_preparation_legacy_token_hold ON public.paige_agreement_signers;
CREATE TRIGGER trg_paige_preparation_legacy_token_hold BEFORE UPDATE OF token_hash,status
  ON public.paige_agreement_signers FOR EACH ROW EXECUTE FUNCTION public._paige_preparation_legacy_token_hold();

-- Same native party identity binding as the existing TypeScript preparation
-- constructor. Private projection only; outer domain readers/writers authorize.
CREATE OR REPLACE FUNCTION public._agreement_preparation_parties(_tenant uuid,_agreement uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',s.id,'signer_role',s.signer_role,'signing_order',s.signing_order,
    'identity_sha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(public._paige_commercial_canonical_json(
      pg_catalog.jsonb_build_object('id',s.id,'full_name',s.full_name,'email',s.email,'signer_role',s.signer_role,'signing_order',s.signing_order)),
      'UTF8')),'hex')) ORDER BY s.signing_order,s.id),'[]'::jsonb)
    FROM public.paige_agreement_signers s WHERE s.agreement_id=_agreement AND s.tenant_id=_tenant;
$$;
REVOKE ALL ON FUNCTION public._agreement_preparation_parties(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._read_agreement_document_preparation(
  _actor uuid,_tenant uuid,_agreement uuid,_preparation uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE; p public.paige_agreement_document_preparations%ROWTYPE;
BEGIN
  PERFORM public._sales_invoice_actor(_actor,_tenant);
  SELECT * INTO a FROM public.paige_agreements WHERE id=_agreement AND tenant_id=_tenant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agreement preparation unavailable in this business' USING ERRCODE='42501'; END IF;
  IF _preparation IS NULL THEN
    SELECT * INTO p FROM public.paige_agreement_document_preparations WHERE agreement_id=_agreement AND tenant_id=_tenant AND is_current;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('state','none'); END IF;
  ELSE
    SELECT * INTO p FROM public.paige_agreement_document_preparations WHERE id=_preparation AND agreement_id=_agreement AND tenant_id=_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Agreement preparation unavailable in this business' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN pg_catalog.jsonb_build_object('state','retained','id',p.id,'agreement_id',p.agreement_id,'tenant_id',p.tenant_id,
    'client_id',p.client_id,'revision_no',p.revision_no,'source_version',p.source_version,'source_updated_at',p.source_updated_at,
    'actor_user_id',p.actor_user_id,'content_storage_key',p.content_storage_key,'document_sha256',p.document_sha256,
    'document_byte_length',p.document_byte_length,'manifest_canonical',p.manifest_canonical,'manifest',p.manifest_canonical::jsonb,
    'preparation_sha256',p.preparation_sha256,'commercial_payload_digest',p.commercial_payload_digest,
    'event_id',p.event_id,'is_selected',p.is_current,'created_at',p.created_at,
    'source_scope','agreement_and_parties','commercial_verification',CASE WHEN p.commercial_payload_digest IS NULL THEN 'not_applicable' ELSE 'not_checked' END,
    'source_matches',a.status='draft' AND a.contact_id=p.client_id AND a.version=p.source_version AND a.updated_at=p.source_updated_at
      AND public._agreement_preparation_parties(_tenant,_agreement)=(p.manifest_canonical::jsonb)->'signers'
      AND NOT EXISTS(SELECT 1 FROM public.paige_agreement_signers s WHERE s.agreement_id=_agreement AND s.tenant_id=_tenant
        AND (s.status<>'pending' OR s.token_hash IS NOT NULL OR s.signed_at IS NOT NULL OR s.declined_at IS NOT NULL
          OR s.esign_consent_at IS NOT NULL OR s.esign_consent_slug IS NOT NULL OR s.esign_consent_version IS NOT NULL OR s.esign_consent_sha256 IS NOT NULL)));
END $$;
REVOKE ALL ON FUNCTION public._read_agreement_document_preparation(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._read_agreement_document_preparation(uuid,uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.read_agreement_document_preparation(
  _expected_tenant_id uuid,_agreement_id uuid,_preparation_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
    RAISE EXCEPTION 'Agreement business context changed' USING ERRCODE='42501'; END IF;
  RETURN public._read_agreement_document_preparation(auth.uid(),_expected_tenant_id,_agreement_id,_preparation_id)
    - ARRAY['content_storage_key','manifest_canonical'];
END $$;
REVOKE ALL ON FUNCTION public.read_agreement_document_preparation(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_agreement_document_preparation(uuid,uuid,uuid) TO authenticated;

-- Only the existing trusted server may attest an actual verified Storage object.
-- It uses the ONE native TypeScript field/PDF validator, never a caller-authored
-- actor/manifest. SQL repeats canonical source, party, byte-hash and CAS checks.
CREATE OR REPLACE FUNCTION public._retain_agreement_document_preparation(
  _actor uuid,_tenant uuid,_agreement uuid,_client uuid,_version integer,_updated_at timestamptz,
  _request uuid,_expected_current uuid,_storage_key text,_manifest_canonical text,_manifest_digest text,
  _commercial_payload_digest text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE; p public.paige_agreement_document_preparations%ROWTYPE;
  m jsonb; parties jsonb; current_id uuid; revision bigint; event uuid;
BEGIN
  PERFORM public._sales_invoice_actor(_actor,_tenant);
  SELECT * INTO a FROM public.paige_agreements WHERE id=_agreement AND tenant_id=_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agreement preparation unavailable in this business' USING ERRCODE='42501'; END IF;
  IF _request IS NULL OR _client IS NULL OR _version IS NULL OR _updated_at IS NULL
    OR _manifest_canonical IS NULL OR pg_catalog.octet_length(_manifest_canonical) NOT BETWEEN 2 AND 1048576
    OR _manifest_digest IS NULL OR _manifest_digest !~ '^[a-f0-9]{64}$'
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(_manifest_canonical,'UTF8')),'hex') IS DISTINCT FROM _manifest_digest
    OR (_commercial_payload_digest IS NOT NULL AND _commercial_payload_digest !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'Exact preparation bytes and identity required' USING ERRCODE='22023'; END IF;
  m:=_manifest_canonical::jsonb;
  IF pg_catalog.jsonb_typeof(m) IS DISTINCT FROM 'object' OR (m-ARRAY['schema_version','source','document','signers','fields'])<>'{}'::jsonb
    OR NOT(m ?& ARRAY['schema_version','source','document','signers','fields']) OR m->'schema_version' IS DISTINCT FROM '1'::jsonb
    OR pg_catalog.jsonb_typeof(m->'source') IS DISTINCT FROM 'object'
    OR ((m->'source')-ARRAY['tenant_id','agreement_id','client_id','version','updated_at'])<>'{}'::jsonb
    OR NOT((m->'source') ?& ARRAY['tenant_id','agreement_id','client_id','version','updated_at'])
    OR (m#>>'{source,tenant_id}')::uuid IS DISTINCT FROM _tenant OR (m#>>'{source,agreement_id}')::uuid IS DISTINCT FROM _agreement
    OR (m#>>'{source,client_id}')::uuid IS DISTINCT FROM _client OR (m#>>'{source,version}')::integer IS DISTINCT FROM _version
    OR (m#>>'{source,updated_at}')::timestamptz IS DISTINCT FROM _updated_at
    OR pg_catalog.jsonb_typeof(m->'document') IS DISTINCT FROM 'object'
    OR ((m->'document')-ARRAY['sha256','byte_length','pages'])<>'{}'::jsonb OR NOT((m->'document') ?& ARRAY['sha256','byte_length','pages'])
    OR coalesce(m#>>'{document,sha256}','') !~ '^[a-f0-9]{64}$'
    OR pg_catalog.jsonb_typeof(m#>'{document,byte_length}') IS DISTINCT FROM 'number'
    OR (m#>>'{document,byte_length}')::numeric NOT BETWEEN 5 AND 26214400
    OR (m#>>'{document,byte_length}')::numeric<>pg_catalog.trunc((m#>>'{document,byte_length}')::numeric)
    OR pg_catalog.jsonb_typeof(m#>'{document,pages}') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(m#>'{document,pages}') NOT BETWEEN 1 AND 250
    OR pg_catalog.jsonb_typeof(m->'signers') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(m->'signers')>100
    OR pg_catalog.jsonb_typeof(m->'fields') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(m->'fields')>500
    OR _storage_key IS NULL OR pg_catalog.split_part(_storage_key,'/',1)<>_tenant::text
    OR pg_catalog.split_part(_storage_key,'/',2)<>_agreement::text
    OR pg_catalog.array_length(pg_catalog.string_to_array(_storage_key,'/'),1)<>3
    OR pg_catalog.split_part(_storage_key,'/',3) !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,240}\.pdf$' THEN
    RAISE EXCEPTION 'Exact native preparation contract required' USING ERRCODE='22023'; END IF;

  SELECT * INTO p FROM public.paige_agreement_document_preparations WHERE id=_request FOR UPDATE;
  IF FOUND THEN
    IF p.tenant_id<>_tenant OR p.agreement_id<>_agreement OR p.actor_user_id<>_actor OR p.client_id<>_client
      OR p.source_version<>_version OR p.source_updated_at<>_updated_at OR p.content_storage_key<>_storage_key
      OR p.manifest_canonical<>_manifest_canonical OR p.preparation_sha256<>_manifest_digest
      OR p.commercial_payload_digest IS DISTINCT FROM _commercial_payload_digest THEN
      RAISE EXCEPTION 'Preparation request does not match this recorded intent' USING ERRCODE='23514'; END IF;
    RETURN pg_catalog.jsonb_build_object('state','recorded','historical_receipt',true,'id',p.id,'event_id',p.event_id,
      'revision_no',p.revision_no,'document_sha256',p.document_sha256,'preparation_sha256',p.preparation_sha256,
      'is_selected',p.is_current,'replayed',true);
  END IF;
  IF a.contact_id IS DISTINCT FROM _client OR a.version IS DISTINCT FROM _version OR a.updated_at IS DISTINCT FROM _updated_at
    OR a.status<>'draft' OR a.content_storage_key IS NOT NULL OR a.content_sha256 IS NOT NULL
    OR a.sealed_storage_key IS NOT NULL OR a.sealed_sha256 IS NOT NULL OR a.commercial_presentation IS NOT NULL THEN
    RAISE EXCEPTION 'Agreement source changed or is already retained' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.paige_agreement_signers WHERE agreement_id=_agreement AND tenant_id=_tenant FOR SHARE;
  IF EXISTS(SELECT 1 FROM public.paige_agreement_signers WHERE agreement_id=_agreement AND tenant_id=_tenant
    AND (status<>'pending' OR token_hash IS NOT NULL OR signed_at IS NOT NULL OR declined_at IS NOT NULL
      OR esign_consent_at IS NOT NULL OR esign_consent_slug IS NOT NULL OR esign_consent_version IS NOT NULL OR esign_consent_sha256 IS NOT NULL)) THEN
    RAISE EXCEPTION 'A signing request is already underway' USING ERRCODE='23514'; END IF;
  parties:=public._agreement_preparation_parties(_tenant,_agreement);
  IF parties IS DISTINCT FROM m->'signers' THEN RAISE EXCEPTION 'Agreement parties changed' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(m->'fields') f WHERE
    pg_catalog.jsonb_typeof(f) IS DISTINCT FROM 'object'
    OR (f-ARRAY['id','signer_id','kind','page','x','y','width','height','required','label'])<>'{}'::jsonb
    OR NOT(f ?& ARRAY['id','signer_id','kind','page','x','y','width','height','required','label'])
    OR f->>'kind' NOT IN ('signature','initials','signed_date','text','checkbox')
    OR NOT EXISTS(SELECT 1 FROM public.paige_agreement_signers s WHERE s.id=(f->>'signer_id')::uuid AND s.agreement_id=_agreement AND s.tenant_id=_tenant))
    OR (SELECT count(DISTINCT (f->>'id')::uuid) FROM pg_catalog.jsonb_array_elements(m->'fields') f)<>pg_catalog.jsonb_array_length(m->'fields') THEN
    RAISE EXCEPTION 'Exact original signer field assignment required' USING ERRCODE='23514'; END IF;
  SELECT id INTO current_id FROM public.paige_agreement_document_preparations
    WHERE agreement_id=_agreement AND tenant_id=_tenant AND is_current FOR UPDATE;
  IF current_id IS DISTINCT FROM _expected_current THEN RAISE EXCEPTION 'Selected preparation changed' USING ERRCODE='23514'; END IF;
  SELECT coalesce(pg_catalog.max(revision_no),0)+1 INTO revision FROM public.paige_agreement_document_preparations WHERE agreement_id=_agreement;
  UPDATE public.paige_agreement_document_preparations SET is_current=false WHERE id=current_id;
  INSERT INTO public.paige_agreement_events(agreement_id,tenant_id,event_type,actor_kind,actor_user_id,detail)
    VALUES(_agreement,_tenant,'edited','owner',_actor,pg_catalog.jsonb_build_object('action','document_preparation_recorded',
      'preparation_id',_request,'preparation_sha256',_manifest_digest,'document_sha256',m#>>'{document,sha256}','source_version',_version)) RETURNING id INTO event;
  INSERT INTO public.paige_agreement_document_preparations(id,agreement_id,tenant_id,revision_no,client_id,source_version,source_updated_at,
    actor_user_id,content_storage_key,document_sha256,document_byte_length,manifest_canonical,preparation_sha256,commercial_payload_digest,event_id)
    VALUES(_request,_agreement,_tenant,revision,_client,_version,_updated_at,_actor,_storage_key,m#>>'{document,sha256}',
      (m#>>'{document,byte_length}')::integer,_manifest_canonical,_manifest_digest,_commercial_payload_digest,event);
  RETURN pg_catalog.jsonb_build_object('state','recorded','historical_receipt',true,'id',_request,'event_id',event,'revision_no',revision,
    'document_sha256',m#>>'{document,sha256}','preparation_sha256',_manifest_digest,'is_selected',true,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public._retain_agreement_document_preparation(uuid,uuid,uuid,uuid,integer,timestamptz,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._retain_agreement_document_preparation(uuid,uuid,uuid,uuid,integer,timestamptz,uuid,uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.list_agreement_document_preparations(
  _expected_tenant_id uuid,_agreement_id uuid,_limit integer DEFAULT 20,_before_revision bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE; items jsonb; total integer;
BEGIN
  IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
    RAISE EXCEPTION 'Agreement business context changed' USING ERRCODE='42501'; END IF;
  PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
  SELECT * INTO a FROM public.paige_agreements WHERE id=_agreement_id AND tenant_id=_expected_tenant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agreement preparation unavailable in this business' USING ERRCODE='42501'; END IF;
  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 20 OR (_before_revision IS NOT NULL AND _before_revision<1) THEN
    RAISE EXCEPTION 'Invalid preparation history page' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO total FROM (SELECT 1 FROM public.paige_agreement_document_preparations p
    WHERE p.agreement_id=_agreement_id AND p.tenant_id=_expected_tenant_id AND (_before_revision IS NULL OR p.revision_no<_before_revision)
    ORDER BY p.revision_no DESC LIMIT _limit+1) q;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id,'revision_no',p.revision_no,'source_version',p.source_version,
    'created_at',p.created_at,'is_selected',p.is_current,'document_sha256',p.document_sha256,'preparation_sha256',p.preparation_sha256,
    'event_id',p.event_id,'actor_user_id',p.actor_user_id) ORDER BY p.revision_no DESC),'[]'::jsonb) INTO items FROM
    (SELECT * FROM public.paige_agreement_document_preparations p WHERE p.agreement_id=_agreement_id AND p.tenant_id=_expected_tenant_id
      AND (_before_revision IS NULL OR p.revision_no<_before_revision) ORDER BY p.revision_no DESC LIMIT _limit) p;
  RETURN pg_catalog.jsonb_build_object('items',items,'has_more',total>_limit);
END $$;
REVOKE ALL ON FUNCTION public.list_agreement_document_preparations(uuid,uuid,integer,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_agreement_document_preparations(uuid,uuid,integer,bigint) TO authenticated;

COMMIT;
