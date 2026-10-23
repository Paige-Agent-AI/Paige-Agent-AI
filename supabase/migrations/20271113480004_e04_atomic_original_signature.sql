-- Original1352 signing transaction. No new agreement/event store or authority.
-- The Edge caller verifies actual retained bytes and appearance before this act.
-- Native original preparation/token/effect triggers remain in force, unmodified.
-- No caller is changed by applying this function alone; ordinary clients cannot execute it.
CREATE OR REPLACE FUNCTION public._paige_signature_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status='signed' THEN
      RAISE EXCEPTION 'Recorded signature evidence is immutable' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status='signed' AND
    ROW(OLD.id,OLD.tenant_id,OLD.agreement_id,OLD.full_name,OLD.email,OLD.signer_role,OLD.signing_order,
      OLD.typed_name,OLD.signature_image_png,OLD.signed_at,OLD.esign_consent_at,OLD.esign_consent_slug,
      OLD.esign_consent_version,OLD.esign_consent_sha256,OLD.signing_ip,OLD.signing_user_agent)
    IS DISTINCT FROM
    ROW(NEW.id,NEW.tenant_id,NEW.agreement_id,NEW.full_name,NEW.email,NEW.signer_role,NEW.signing_order,
      NEW.typed_name,NEW.signature_image_png,NEW.signed_at,NEW.esign_consent_at,NEW.esign_consent_slug,
      NEW.esign_consent_version,NEW.esign_consent_sha256,NEW.signing_ip,NEW.signing_user_agent) THEN
    RAISE EXCEPTION 'Recorded signature evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_signature_evidence_immutable() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_paige_signature_evidence_immutable ON public.paige_agreement_signers;
CREATE TRIGGER trg_paige_signature_evidence_immutable BEFORE UPDATE OR DELETE ON public.paige_agreement_signers
  FOR EACH ROW EXECUTE FUNCTION public._paige_signature_evidence_immutable();

CREATE OR REPLACE FUNCTION public._record_agreement_signature(
  _token_hash text,_agreement_version integer,_content_sha256 text,_content_storage_key text,
  _typed_name text,_signature_image_png text,_consent_read boolean,_consent_esign boolean,
  _consent_slug text,_consent_version integer,_consent_sha256 text,_ip inet,_user_agent text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  initial public.paige_agreement_signers%ROWTYPE;
  signer public.paige_agreement_signers%ROWTYPE;
  agreement public.paige_agreements%ROWTYPE;
  act_at timestamptz;
  consent_event uuid;
  signature_event uuid;
  remaining bigint;
  event_detail jsonb;
BEGIN
  IF _token_hash IS NULL OR _token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501';
  END IF;
  -- Resolve original identity from the credential. Never accept tenant/signer IDs.
  SELECT * INTO initial FROM public.paige_agreement_signers WHERE token_hash=_token_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501'; END IF;

  -- Short native transaction only: no file/provider work while holding these locks.
  -- Same parent serializes signature progress with original void/expiry updates.
  SELECT * INTO agreement FROM public.paige_agreements
    WHERE id=initial.agreement_id AND tenant_id=initial.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501'; END IF;
  SELECT * INTO signer FROM public.paige_agreement_signers
    WHERE id=initial.id AND agreement_id=agreement.id AND tenant_id=agreement.tenant_id FOR UPDATE;
  act_at:=pg_catalog.clock_timestamp();
  IF NOT FOUND OR signer.token_hash IS DISTINCT FROM _token_hash
    OR signer.token_revoked_at IS NOT NULL OR signer.token_expires_at IS NULL
    OR signer.token_expires_at<=act_at THEN
    RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501';
  END IF;
  IF agreement.status NOT IN ('sent','viewed','partially_signed','completed')
    OR (agreement.status<>'completed' AND agreement.expires_at IS NOT NULL AND agreement.expires_at<=act_at) THEN
    RAISE EXCEPTION 'Agreement cannot be signed in its current state' USING ERRCODE='23514';
  END IF;

  IF signer.status='signed' THEN
    -- Read actual retained evidence. Never retroactively invent missing old events.
    SELECT id INTO consent_event FROM public.paige_agreement_events
      WHERE agreement_id=agreement.id AND tenant_id=agreement.tenant_id AND signer_id=signer.id
        AND event_type='consented' AND actor_kind='signer' ORDER BY seq LIMIT 1;
    SELECT id INTO signature_event FROM public.paige_agreement_events
      WHERE agreement_id=agreement.id AND tenant_id=agreement.tenant_id AND signer_id=signer.id
        AND event_type='signed' AND actor_kind='signer' ORDER BY seq LIMIT 1;
  ELSE
    IF signer.status NOT IN ('pending','viewed') OR agreement.status='completed' THEN
      RAISE EXCEPTION 'Agreement cannot be signed in its current state' USING ERRCODE='23514';
    END IF;
    IF agreement.version IS DISTINCT FROM _agreement_version
      OR agreement.content_sha256 IS DISTINCT FROM _content_sha256
      OR agreement.content_storage_key IS DISTINCT FROM _content_storage_key
      OR _content_sha256 IS NULL OR _content_sha256 !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Retained presentation changed before signing' USING ERRCODE='23514';
    END IF;
    IF _consent_read IS DISTINCT FROM true OR _consent_esign IS DISTINCT FROM true
      OR pg_catalog.length(pg_catalog.btrim(coalesce(_typed_name,''))) NOT BETWEEN 2 AND 200
      OR pg_catalog.length(coalesce(_typed_name,''))>200
      OR pg_catalog.length(pg_catalog.btrim(coalesce(_consent_slug,''))) NOT BETWEEN 1 AND 100
      OR _consent_version IS NULL OR _consent_version<1
      OR _consent_sha256 IS NULL OR _consent_sha256 !~ '^[a-f0-9]{64}$'
      OR pg_catalog.length(coalesce(_signature_image_png,''))>400000 THEN
      RAISE EXCEPTION 'Explicit signature and consent evidence is required' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM public.paige_agreement_signers earlier
      WHERE earlier.agreement_id=agreement.id AND earlier.tenant_id=agreement.tenant_id
        AND earlier.signing_order<signer.signing_order AND earlier.status<>'signed') THEN
      RAISE EXCEPTION 'Earlier signatures are still outstanding' USING ERRCODE='23514';
    END IF;
    -- Unchanged native original token/effect/order/tier/consent triggers still enforce this UPDATE.
    UPDATE public.paige_agreement_signers SET status='signed',signed_at=act_at,typed_name=_typed_name,
      signature_image_png=_signature_image_png,esign_consent_at=act_at,esign_consent_slug=_consent_slug,
      esign_consent_version=_consent_version,esign_consent_sha256=_consent_sha256,
      signing_ip=_ip,signing_user_agent=pg_catalog.left(coalesce(_user_agent,''),500)
      WHERE id=signer.id AND agreement_id=agreement.id AND tenant_id=agreement.tenant_id;
    event_detail:=pg_catalog.jsonb_build_object('signature_record_id',signer.id,
      'document_version',agreement.version,'document_sha256',agreement.content_sha256);
    INSERT INTO public.paige_agreement_events
      (agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_email,ip,user_agent,detail,created_at)
      VALUES(agreement.id,agreement.tenant_id,signer.id,'consented','signer',signer.email,_ip,
        pg_catalog.left(coalesce(_user_agent,''),500),event_detail,act_at) RETURNING id INTO consent_event;
    INSERT INTO public.paige_agreement_events
      (agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_email,ip,user_agent,detail,created_at)
      VALUES(agreement.id,agreement.tenant_id,signer.id,'signed','signer',signer.email,_ip,
        pg_catalog.left(coalesce(_user_agent,''),500),event_detail,act_at) RETURNING id INTO signature_event;
  END IF;
  SELECT count(*) INTO remaining FROM public.paige_agreement_signers
    WHERE agreement_id=agreement.id AND tenant_id=agreement.tenant_id AND status<>'signed';
  -- Completion still requires the ORIGINAL real PDF seal and verified Storage readback.
  IF signer.status<>'signed' AND remaining>0 AND agreement.status IN ('sent','viewed') THEN
    UPDATE public.paige_agreements SET status='partially_signed'
      WHERE id=agreement.id AND tenant_id=agreement.tenant_id;
    agreement.status:='partially_signed';
  END IF;
  RETURN pg_catalog.jsonb_build_object('state','recorded','replayed',signer.status='signed',
    'signing_id',agreement.id,'signer_id',signer.id,'signed_at',CASE WHEN signer.status='signed' THEN signer.signed_at ELSE act_at END,
    'consented_event_id',consent_event,'signed_event_id',signature_event,
    'audit_complete',consent_event IS NOT NULL AND signature_event IS NOT NULL,
    'outstanding_count',remaining,'agreement_status',agreement.status);
END $$;
REVOKE ALL ON FUNCTION public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)
  TO service_role;
COMMENT ON FUNCTION public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)
  IS 'EXP04: service-only original signer/consent/audit transaction, existing privileges and native holds. Not payment authority or prepared-send approval. Missing old events are reported, never invented.';
