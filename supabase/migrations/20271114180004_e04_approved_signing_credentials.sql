-- ORIGINAL approved request -> exact retained document/hash-only credentials.
-- No provider, sent/viewed/signed/sealed transition, payment or execution mount.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $guard$
DECLARE expected record; actual text; held pg_catalog.pg_trigger%ROWTYPE; columns text[];
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public._paige_preparation_legacy_effect_hold()','cf6487195d563aebd48002b17fa2b784','7e634cc60a69a2eaa11fa5b01722cb4e'),
  ('public._paige_preparation_legacy_token_hold()','d45740c4844cd11d93abf7ccd02671cb','46c36eb38a54080388b25f7ff315d0b9'),
  ('public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)','3a2fa340fca9838aa9c6737f1e41ae61','3a2fa340fca9838aa9c6737f1e41ae61'),
  ('public._freeze_paige_commercial_presentation(uuid,uuid,jsonb,text,text,text,text,text,text)','db14fdd6e75b2dc4cb3eb290388cc801','db14fdd6e75b2dc4cb3eb290388cc801'),
  ('public._validate_paige_commercial_presentation(uuid,uuid,jsonb,text,text,text,text,text,text)','61056f39c2e8c9a5fa7aab3641820a1b','61056f39c2e8c9a5fa7aab3641820a1b'),
  ('public.void_agreement_signing(uuid,uuid)','0945282e5dbc29a6994f735bb4b6a4a7','0945282e5dbc29a6994f735bb4b6a4a7'),
  ('public.void_paige_agreement(uuid,uuid,text)','41f229ff77076a6bd47d599eba65e467','41f229ff77076a6bd47d599eba65e467')
 ) AS checks(identity,prior_hash,own_hash) LOOP
  SELECT md5(prosrc) INTO actual FROM pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF NOT FOUND OR actual NOT IN (expected.prior_hash,expected.own_hash) THEN
   RAISE EXCEPTION 'Original prepared issuance dependency changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
 FOR expected IN SELECT * FROM (VALUES
  ('private.e04_prepared_issuance_record(uuid,uuid,uuid,text)','78228993b63b007430bb9d7f5213270b'),
  ('private.e04_prepared_issuance_write(uuid,uuid,uuid)','38ec7e5cac3bcfb27e75bfce7c2e965c'),
  ('public._read_prepared_agreement_credentials(uuid,uuid,uuid,text)','35117989911f1368790d9c34756fdc8b'),
  ('public._issue_prepared_agreement_credentials(uuid,uuid,uuid,text,jsonb)','8fd508a93c8817678ca07035a21e225b')
 ) AS checks(identity,own_hash) LOOP
  SELECT md5(prosrc) INTO actual FROM pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF FOUND AND actual IS DISTINCT FROM expected.own_hash THEN
   RAISE EXCEPTION 'Prepared issuance implementation changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
 SELECT * INTO held FROM pg_catalog.pg_trigger WHERE tgrelid='public.paige_agreement_signers'::regclass
  AND tgname='trg_paige_preparation_legacy_token_hold' AND NOT tgisinternal;
 IF NOT FOUND OR held.tgfoid IS DISTINCT FROM to_regprocedure('public._paige_preparation_legacy_token_hold()')
  OR held.tgtype<>19 OR held.tgenabled<>'O' OR held.tgnargs<>0 OR held.tgqual IS NOT NULL
  OR held.tgconstraint<>0 OR held.tgoldtable IS NOT NULL OR held.tgnewtable IS NOT NULL THEN
  RAISE EXCEPTION 'Original credential hold trigger changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname) INTO columns
  FROM pg_catalog.pg_attribute a WHERE a.attrelid=held.tgrelid AND a.attnum=ANY(held.tgattr);
 IF columns IS DISTINCT FROM ARRAY['status','token_hash']::text[]
  AND columns IS DISTINCT FROM ARRAY['status','token_expires_at','token_hash','token_revoked_at']::text[] THEN
  RAISE EXCEPTION 'Original credential hold columns changed; reconcile before applying' USING ERRCODE='23514'; END IF;
END $guard$;

-- Historical evidence is deliberately independent of fresh draft/provider,
-- lease and autonomy eligibility. Current original domain access still applies.
CREATE OR REPLACE FUNCTION private.e04_prepared_issuance_record(
 _actor uuid,_tenant uuid,_operation uuid,_request_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original jsonb; w public.paige_durable_work%ROWTYPE;
 p public.paige_agreement_document_preparations%ROWTYPE; e public.paige_agreement_events%ROWTYPE;
 approval public.paige_pending_confirmations%ROWTYPE; r jsonb; total integer;
BEGIN
 original:=public._read_prepared_agreement_work(_actor,_tenant,_operation,_request_sha256);
 IF original IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=(original->>'work_id')::uuid;
 SELECT count(*) INTO total FROM public.paige_agreement_events
  WHERE tenant_id=_tenant AND agreement_id=(original->>'agreement_id')::uuid AND event_type='edited'
   AND detail->>'action'='prepared_signature_credentials_recorded' AND detail->>'work_id'=w.id::text;
 IF total=0 THEN RETURN NULL; END IF;
 IF total<>1 THEN RAISE EXCEPTION 'Original credential evidence unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO e FROM public.paige_agreement_events
  WHERE tenant_id=_tenant AND agreement_id=(original->>'agreement_id')::uuid AND event_type='edited'
   AND detail->>'action'='prepared_signature_credentials_recorded' AND detail->>'work_id'=w.id::text;
 SELECT * INTO approval FROM public.paige_pending_confirmations WHERE id=(w.authority_context->>'confirmation_id')::uuid;
 r:=approval.args->'request';
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE id=(original->>'preparation_id')::uuid AND tenant_id=_tenant AND agreement_id=e.agreement_id;
 IF NOT FOUND OR e.actor_kind IS DISTINCT FROM 'owner' OR e.actor_user_id IS DISTINCT FROM _actor
  OR pg_catalog.jsonb_typeof(e.detail) IS DISTINCT FROM 'object'
  OR (e.detail-ARRAY['action','work_id','operation_id','request_sha256','preparation_id','preparation_sha256','document_sha256','credentials'])<>'{}'::jsonb
  OR NOT(e.detail ?& ARRAY['action','work_id','operation_id','request_sha256','preparation_id','preparation_sha256','document_sha256','credentials'])
  OR e.detail->>'operation_id' IS DISTINCT FROM _operation::text
  OR e.detail->>'request_sha256' IS DISTINCT FROM _request_sha256
  OR e.detail->>'preparation_id' IS DISTINCT FROM p.id::text
  OR e.detail->>'preparation_sha256' IS DISTINCT FROM p.preparation_sha256
  OR e.detail->>'document_sha256' IS DISTINCT FROM p.document_sha256
  OR p.preparation_sha256 IS DISTINCT FROM r->>'preparationSha256'
  OR p.document_sha256 IS DISTINCT FROM r#>>'{document,sha256}'
  OR p.preparation_sha256 IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.manifest_canonical,'UTF8')),'hex')
  OR pg_catalog.jsonb_typeof(e.detail->'credentials') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Original credential evidence unavailable' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_array_length(e.detail->'credentials')<>pg_catalog.jsonb_array_length(r->'recipients')
  OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(e.detail->'credentials') WITH ORDINALITY c(value,n)
   WHERE pg_catalog.jsonb_typeof(c.value) IS DISTINCT FROM 'object'
    OR (c.value-ARRAY['signer_id','token_commitment','expires_at'])<>'{}'::jsonb
    OR NOT(c.value ?& ARRAY['signer_id','token_commitment','expires_at'])
    OR pg_catalog.jsonb_typeof(c.value->'signer_id') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(c.value->'token_commitment') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(c.value->'expires_at') IS DISTINCT FROM 'string'
    OR c.value->>'signer_id' IS DISTINCT FROM r#>>ARRAY['recipients',(c.n-1)::text,'id']
    OR coalesce(c.value->>'token_commitment','') !~ '^[a-f0-9]{64}$'
    OR (c.value->>'expires_at')::timestamptz<=e.created_at
    OR (c.value->>'expires_at')::timestamptz>e.created_at+interval '720 hours')
  OR (SELECT count(DISTINCT c->>'token_commitment') FROM pg_catalog.jsonb_array_elements(e.detail->'credentials') c)
    <>pg_catalog.jsonb_array_length(e.detail->'credentials') THEN
  RAISE EXCEPTION 'Original credential evidence unavailable' USING ERRCODE='23514'; END IF;
 RETURN pg_catalog.jsonb_build_object('kind','prepared_agreement_credentials','state','recorded',
  'tenant_id',_tenant,'actor_id',_actor,'operation_id',_operation,'agreement_id',e.agreement_id,
  'preparation_id',p.id,'request_sha256',_request_sha256,'preparation_sha256',p.preparation_sha256,
  'document_sha256',p.document_sha256,'work_id',w.id,'event_id',e.id,'credentials',e.detail->'credentials');
END $$;
REVOKE ALL ON FUNCTION private.e04_prepared_issuance_record(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Only the exact first native write may use this context. This is not reusable
-- authority: every call repeats original current actor/Work/approval evidence.
CREATE OR REPLACE FUNCTION private.e04_prepared_issuance_write(_tenant uuid,_agreement uuid,_preparation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.paige_agreement_events%ROWTYPE; w public.paige_durable_work%ROWTYPE;
 p public.paige_pending_confirmations%ROWTYPE; a public.paige_audit_log%ROWTYPE; receipt jsonb;
BEGIN
 SELECT * INTO e FROM public.paige_agreement_events
  WHERE tenant_id=_tenant AND agreement_id=_agreement AND event_type='edited'
   AND detail->>'action'='prepared_signature_credentials_recorded'
   AND detail->>'preparation_id'=_preparation::text ORDER BY seq DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 receipt:=private.e04_prepared_issuance_record(e.actor_user_id,_tenant,
  (e.detail->>'operation_id')::uuid,e.detail->>'request_sha256');
 SELECT * INTO w FROM public.paige_durable_work WHERE id=(receipt->>'work_id')::uuid FOR SHARE;
 SELECT * INTO p FROM public.paige_pending_confirmations WHERE id=(w.authority_context->>'confirmation_id')::uuid FOR SHARE;
 SELECT * INTO a FROM public.paige_audit_log WHERE id=(w.authority_context->>'decision_audit_id')::uuid FOR SHARE;
 IF receipt IS NULL OR w.status IS DISTINCT FROM 'claimed' OR w.lease_until<=pg_catalog.clock_timestamp()
  OR p.expires_at<=pg_catalog.clock_timestamp()
  OR NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=_tenant AND t.status='active' AND t.archived_at IS NULL)
  OR NOT EXISTS(SELECT 1 FROM public.paige_agreement_document_preparations v WHERE v.id=_preparation
    AND v.agreement_id=_agreement AND v.tenant_id=_tenant AND v.is_current)
  OR coalesce(public.resolve_tool_autonomy(_tenant,'agreement_send'),'off') NOT IN ('confirm','auto')
  OR a.id IS NULL OR a.tenant_id IS DISTINCT FROM _tenant OR a.actor_user_id IS DISTINCT FROM e.actor_user_id
  OR a.action IS DISTINCT FROM 'sales.agreement_signature_request_governed_decision'
  OR a.target_type IS DISTINCT FROM 'agreement' OR a.target_id IS DISTINCT FROM _agreement
  OR a.payload->>'capability' IS DISTINCT FROM 'agreement_send' OR a.payload->>'decision' IS DISTINCT FROM 'execute'
  OR a.payload->>'risk' IS DISTINCT FROM 'high' OR a.payload->>'lane_effective' IS DISTINCT FROM 'confirm'
  OR a.payload->>'operation_id' IS DISTINCT FROM receipt->>'operation_id'
  OR a.payload->>'request_sha256' IS DISTINCT FROM receipt->>'request_sha256' THEN
  RAISE EXCEPTION 'Original credential write authority unavailable' USING ERRCODE='42501'; END IF;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION private.e04_prepared_issuance_write(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._read_prepared_agreement_credentials(
 _actor uuid,_tenant uuid,_operation uuid,_request_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb; c jsonb; s public.paige_agreement_signers%ROWTYPE;
 a public.paige_agreements%ROWTYPE; credentials jsonb:='[]'::jsonb;
BEGIN
 receipt:=private.e04_prepared_issuance_record(_actor,_tenant,_operation,_request_sha256);
 IF receipt IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public.paige_agreements WHERE id=(receipt->>'agreement_id')::uuid AND tenant_id=_tenant FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original credential readback unavailable' USING ERRCODE='23514'; END IF;
 FOR c IN SELECT value FROM pg_catalog.jsonb_array_elements(receipt->'credentials') LOOP
  SELECT * INTO s FROM public.paige_agreement_signers WHERE id=(c->>'signer_id')::uuid
   AND agreement_id=a.id AND tenant_id=_tenant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original credential readback unavailable' USING ERRCODE='23514'; END IF;
  IF s.token_hash IS NULL THEN
   -- ORIGINAL void removes the live verifier, not the original audit witness.
   -- A retired hash is NULL; never reconstruct it from readable history.
   IF a.status IS DISTINCT FROM 'voided' OR a.voided_at IS NULL OR s.token_revoked_at IS NULL
    OR s.token_expires_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e
     WHERE e.agreement_id=a.id AND e.tenant_id=_tenant AND e.event_type='voided' AND e.actor_kind='owner') THEN
    RAISE EXCEPTION 'Original credential readback unavailable' USING ERRCODE='23514'; END IF;
  ELSIF s.token_hash !~ '^[a-f0-9]{64}$'
   OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(s.token_hash,'UTF8')),'hex') IS DISTINCT FROM c->>'token_commitment'
   OR s.token_expires_at IS DISTINCT FROM (c->>'expires_at')::timestamptz THEN
   RAISE EXCEPTION 'Original credential readback unavailable' USING ERRCODE='23514';
  END IF;
  credentials:=credentials||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'signer_id',s.id,'token_hash',s.token_hash,'expires_at',c->'expires_at'));
 END LOOP;
 RETURN pg_catalog.jsonb_set(receipt,'{credentials}',credentials);
END $$;
REVOKE ALL ON FUNCTION public._read_prepared_agreement_credentials(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._read_prepared_agreement_credentials(uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public._paige_preparation_legacy_effect_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.paige_agreement_document_preparations%ROWTYPE; receipt jsonb; expected_commercial jsonb;
BEGIN
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE agreement_id=OLD.id AND tenant_id=OLD.tenant_id AND is_current;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('sent','viewed','partially_signed','completed'))
  OR NEW.sealed_storage_key IS DISTINCT FROM OLD.sealed_storage_key
  OR NEW.sealed_sha256 IS DISTINCT FROM OLD.sealed_sha256 THEN
  RAISE EXCEPTION 'Prepared-document signature requests require the canonical approved send integration' USING ERRCODE='23514'; END IF;
 IF NEW.content_storage_key IS DISTINCT FROM OLD.content_storage_key OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 THEN
  IF OLD.status<>'draft' OR NEW.status<>'draft' OR OLD.content_storage_key IS NOT NULL OR OLD.content_sha256 IS NOT NULL
   OR NEW.content_storage_key IS DISTINCT FROM p.content_storage_key OR NEW.content_sha256 IS DISTINCT FROM p.document_sha256
   OR (pg_catalog.to_jsonb(NEW)-ARRAY['content_storage_key','content_sha256','commercial_presentation','presented_body_markdown','updated_at'])
    IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['content_storage_key','content_sha256','commercial_presentation','presented_body_markdown','updated_at']) THEN
   RAISE EXCEPTION 'Prepared-document freeze differs from the reviewed source' USING ERRCODE='23514'; END IF;
  receipt:=private.e04_prepared_issuance_write(OLD.tenant_id,OLD.id,p.id);
  IF receipt IS NULL THEN RAISE EXCEPTION 'Prepared-document freeze requires original approved issuance' USING ERRCODE='23514'; END IF;
  IF p.commercial_payload_digest IS NOT NULL THEN
   expected_commercial:=pg_catalog.jsonb_build_object('schema_version',1,'payload',p.manifest_canonical::jsonb#>'{commercial,payload}',
    'payload_digest',p.commercial_payload_digest,'presented_body_sha256',p.manifest_canonical::jsonb#>'{commercial,presented_body_sha256}',
    'content_storage_key',p.content_storage_key,'document_sha256',p.document_sha256);
   IF NEW.commercial_presentation IS DISTINCT FROM expected_commercial
    OR NEW.presented_body_markdown IS DISTINCT FROM p.manifest_canonical::jsonb#>>'{commercial,presented_body_markdown}' THEN
    RAISE EXCEPTION 'Prepared commercial presentation differs from reviewed terms' USING ERRCODE='23514'; END IF;
  ELSIF NEW.commercial_presentation IS DISTINCT FROM OLD.commercial_presentation
   OR NEW.presented_body_markdown IS DISTINCT FROM OLD.presented_body_markdown THEN
   RAISE EXCEPTION 'Unreviewed commercial presentation refused' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_preparation_legacy_effect_hold() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._paige_preparation_legacy_token_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.paige_agreement_document_preparations%ROWTYPE; a public.paige_agreements%ROWTYPE;
 receipt jsonb; credential jsonb;
BEGIN
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE agreement_id=OLD.agreement_id AND tenant_id=OLD.tenant_id AND is_current;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('viewed','signed'))
  OR (OLD.token_revoked_at IS NOT NULL AND NEW.token_revoked_at IS NULL) THEN
  RAISE EXCEPTION 'Prepared-document signing requires the canonical approved send integration' USING ERRCODE='23514'; END IF;
 IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.token_expires_at IS DISTINCT FROM OLD.token_expires_at THEN
  -- Preserve ORIGINAL void_agreement_signing: it first authorizes/voids through
  -- void_paige_agreement, revokes access and records the original void event,
  -- then irreversibly removes the credential. This cannot replace or revive it.
  IF NEW.token_hash IS NULL AND NEW.token_expires_at IS NULL
   AND OLD.token_revoked_at IS NOT NULL AND NEW.token_revoked_at IS NOT DISTINCT FROM OLD.token_revoked_at
   AND (pg_catalog.to_jsonb(NEW)-ARRAY['token_hash','token_expires_at','updated_at'])
    IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['token_hash','token_expires_at','updated_at'])
   AND EXISTS(SELECT 1 FROM public.paige_agreements v WHERE v.id=OLD.agreement_id
    AND v.tenant_id=OLD.tenant_id AND v.status='voided' AND v.voided_at IS NOT NULL)
   AND EXISTS(SELECT 1 FROM public.paige_agreement_events e WHERE e.agreement_id=OLD.agreement_id
    AND e.tenant_id=OLD.tenant_id AND e.event_type='voided' AND e.actor_kind='owner'
    AND e.actor_user_id=auth.uid()) THEN RETURN NEW; END IF;
  IF OLD.token_hash IS NOT NULL OR OLD.token_revoked_at IS NOT NULL OR OLD.status<>'pending'
   OR NEW.token_hash IS NULL OR NEW.token_expires_at IS NULL OR NEW.token_revoked_at IS NOT NULL
   OR (pg_catalog.to_jsonb(NEW)-ARRAY['token_hash','token_expires_at','updated_at'])
    IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['token_hash','token_expires_at','updated_at']) THEN
   RAISE EXCEPTION 'Prepared-document credential replacement refused' USING ERRCODE='23514'; END IF;
  receipt:=private.e04_prepared_issuance_write(OLD.tenant_id,OLD.agreement_id,p.id);
 SELECT entry.value INTO credential FROM pg_catalog.jsonb_array_elements(receipt->'credentials') entry(value) WHERE entry.value->>'signer_id'=OLD.id::text;
  SELECT * INTO a FROM public.paige_agreements WHERE id=OLD.agreement_id AND tenant_id=OLD.tenant_id;
  IF receipt IS NULL OR credential IS NULL OR NEW.token_hash !~ '^[a-f0-9]{64}$'
   OR credential->>'token_commitment' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(NEW.token_hash,'UTF8')),'hex')
   OR (credential->>'expires_at')::timestamptz IS DISTINCT FROM NEW.token_expires_at
   OR a.status IS DISTINCT FROM 'draft' OR a.content_storage_key IS DISTINCT FROM p.content_storage_key
   OR a.content_sha256 IS DISTINCT FROM p.document_sha256 THEN
   RAISE EXCEPTION 'Prepared-document credential lacks exact original issuance' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_preparation_legacy_token_hold() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_paige_preparation_legacy_token_hold ON public.paige_agreement_signers;
CREATE TRIGGER trg_paige_preparation_legacy_token_hold
 BEFORE UPDATE OF token_hash,token_expires_at,token_revoked_at,status ON public.paige_agreement_signers
 FOR EACH ROW EXECUTE FUNCTION public._paige_preparation_legacy_token_hold();

CREATE OR REPLACE FUNCTION public._issue_prepared_agreement_credentials(
 _actor uuid,_tenant uuid,_operation uuid,_request_sha256 text,_credentials jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original jsonb; historical jsonb; w public.paige_durable_work%ROWTYPE;
 p public.paige_pending_confirmations%ROWTYPE; retained public.paige_agreement_document_preparations%ROWTYPE;
 a public.paige_agreements%ROWTYPE; r jsonb; snapshot jsonb; credentials jsonb; commitments jsonb;
 event_id uuid; issued_at timestamptz; expires_at timestamptz; credential jsonb; original_commitments jsonb;
BEGIN
 original:=public._read_prepared_agreement_work(_actor,_tenant,_operation,_request_sha256);
 IF original IS NULL THEN RAISE EXCEPTION 'Original approved Work required' USING ERRCODE='42501'; END IF;
 IF pg_catalog.jsonb_typeof(_credentials) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Exact signer credential hashes required' USING ERRCODE='22023'; END IF;
 IF pg_catalog.jsonb_array_length(_credentials) NOT BETWEEN 1 AND 100 OR EXISTS(
  SELECT 1 FROM pg_catalog.jsonb_array_elements(_credentials) c WHERE pg_catalog.jsonb_typeof(c) IS DISTINCT FROM 'object'
   OR (c-ARRAY['signer_id','token_hash'])<>'{}'::jsonb OR NOT(c ?& ARRAY['signer_id','token_hash'])
   OR pg_catalog.jsonb_typeof(c->'signer_id') IS DISTINCT FROM 'string'
   OR pg_catalog.jsonb_typeof(c->'token_hash') IS DISTINCT FROM 'string'
   OR coalesce(c->>'signer_id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   OR coalesce(c->>'token_hash','') !~ '^[a-f0-9]{64}$')
  OR (SELECT count(DISTINCT c->>'signer_id') FROM pg_catalog.jsonb_array_elements(_credentials) c)<>pg_catalog.jsonb_array_length(_credentials)
  OR (SELECT count(DISTINCT c->>'token_hash') FROM pg_catalog.jsonb_array_elements(_credentials) c)<>pg_catalog.jsonb_array_length(_credentials) THEN
  RAISE EXCEPTION 'Exact signer credential hashes required' USING ERRCODE='22023'; END IF;
 -- Actor -> ORIGINAL agreement -> commercial source -> pending -> Work. The
 -- exclusive agreement lock also serializes different approved intents.
 SELECT * INTO a FROM public.paige_agreements
  WHERE id=(original->>'agreement_id')::uuid AND tenant_id=_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original agreement unavailable' USING ERRCODE='42501'; END IF;
 historical:=private.e04_prepared_issuance_record(_actor,_tenant,_operation,_request_sha256);
 IF historical IS NOT NULL THEN
  SELECT pg_catalog.jsonb_agg(c-'expires_at' ORDER BY n)
   INTO original_commitments FROM pg_catalog.jsonb_array_elements(historical->'credentials') WITH ORDINALITY entry(c,n);
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signer_id',c->'signer_id','token_commitment',
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c->>'token_hash','UTF8')),'hex')) ORDER BY n)
   INTO commitments FROM pg_catalog.jsonb_array_elements(_credentials) WITH ORDINALITY entry(c,n);
  IF original_commitments IS DISTINCT FROM commitments THEN
   RAISE EXCEPTION 'Original credential hashes differ; reconcile without replacement' USING ERRCODE='40001'; END IF;
  RETURN public._read_prepared_agreement_credentials(_actor,_tenant,_operation,_request_sha256);
 END IF;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=(original->>'work_id')::uuid;
 SELECT * INTO p FROM public.paige_pending_confirmations WHERE id=(w.authority_context->>'confirmation_id')::uuid;
 snapshot:=p.args;r:=p.args->'request';
 PERFORM private.e04_prepared_confirmation_source(_actor,_tenant,snapshot);
 SELECT * INTO retained FROM public.paige_agreement_document_preparations
  WHERE id=(original->>'preparation_id')::uuid AND tenant_id=_tenant AND agreement_id=a.id AND is_current FOR SHARE;
 IF NOT FOUND OR a.content_storage_key IS NOT NULL OR a.content_sha256 IS NOT NULL
  OR a.commercial_presentation IS NOT NULL OR a.presented_body_markdown IS NOT NULL THEN
  RAISE EXCEPTION 'Original unissued source required' USING ERRCODE='40001'; END IF;
 IF pg_catalog.jsonb_array_length(_credentials)<>pg_catalog.jsonb_array_length(r->'recipients') OR EXISTS(
  SELECT 1 FROM pg_catalog.jsonb_array_elements(_credentials) WITH ORDINALITY entry(c,n)
   WHERE c->>'signer_id' IS DISTINCT FROM r#>>ARRAY['recipients',(n-1)::text,'id'])
  OR EXISTS(SELECT 1 FROM public.paige_agreement_signers s WHERE s.agreement_id=a.id AND s.tenant_id=_tenant
   AND (s.status<>'pending' OR s.token_hash IS NOT NULL OR s.token_revoked_at IS NOT NULL OR s.token_expires_at IS NOT NULL
    OR s.signed_at IS NOT NULL OR s.esign_consent_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'Original signer set changed' USING ERRCODE='40001'; END IF;
 IF retained.commercial_payload_digest IS NOT NULL THEN
  PERFORM public._validate_paige_commercial_presentation(_actor,_tenant,
   retained.manifest_canonical::jsonb#>'{commercial,payload}',retained.commercial_payload_digest,
   retained.manifest_canonical::jsonb#>>'{commercial,presented_body_markdown}',
   retained.manifest_canonical::jsonb#>>'{commercial,presented_body_sha256}',retained.content_storage_key,retained.document_sha256,'owner_ui');
 END IF;
 SELECT * INTO p FROM public.paige_pending_confirmations WHERE id=p.id FOR UPDATE;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=w.id FOR UPDATE;
 IF p.args IS DISTINCT FROM snapshot OR w.status IS DISTINCT FROM 'claimed' OR w.lease_until<=pg_catalog.clock_timestamp()
  OR p.expires_at<=pg_catalog.clock_timestamp() THEN
  RAISE EXCEPTION 'Original approval or Work expired or changed' USING ERRCODE='42501'; END IF;
 issued_at:=pg_catalog.clock_timestamp();
 -- Same ORIGINAL thirty-day signing window; never an invoice/payment date.
 expires_at:=least(issued_at+interval '720 hours',coalesce(a.expires_at,issued_at+interval '720 hours'));
 IF expires_at<=issued_at THEN RAISE EXCEPTION 'Agreement signing window expired' USING ERRCODE='42501'; END IF;
 SELECT pg_catalog.jsonb_agg(c||pg_catalog.jsonb_build_object('expires_at',expires_at) ORDER BY n)
  INTO credentials FROM pg_catalog.jsonb_array_elements(_credentials) WITH ORDINALITY entry(c,n);
 -- Owner-readable history retains a one-way witness, never the protected
 -- token_hash. The ORIGINAL signer column is the only live verifier store.
 SELECT pg_catalog.jsonb_agg((c-'token_hash')||pg_catalog.jsonb_build_object('token_commitment',
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c->>'token_hash','UTF8')),'hex')) ORDER BY n)
  INTO commitments FROM pg_catalog.jsonb_array_elements(credentials) WITH ORDINALITY entry(c,n);
 INSERT INTO public.paige_agreement_events(agreement_id,tenant_id,event_type,actor_kind,actor_user_id,created_at,detail)
  VALUES(a.id,_tenant,'edited','owner',_actor,issued_at,pg_catalog.jsonb_build_object(
   'action','prepared_signature_credentials_recorded','work_id',w.id,'operation_id',_operation,'request_sha256',_request_sha256,
   'preparation_id',retained.id,'preparation_sha256',retained.preparation_sha256,'document_sha256',retained.document_sha256,
   'credentials',commitments)) RETURNING id INTO event_id;
 -- Recheck original current Work/cohort/autonomy/audit after all source waits.
 PERFORM private.e04_prepared_issuance_write(_tenant,a.id,retained.id);
 IF retained.commercial_payload_digest IS NOT NULL THEN
  PERFORM public._freeze_paige_commercial_presentation(_actor,_tenant,
   retained.manifest_canonical::jsonb#>'{commercial,payload}',retained.commercial_payload_digest,
   retained.manifest_canonical::jsonb#>>'{commercial,presented_body_markdown}',
   retained.manifest_canonical::jsonb#>>'{commercial,presented_body_sha256}',retained.content_storage_key,retained.document_sha256,'owner_ui');
 ELSE
  UPDATE public.paige_agreements SET content_storage_key=retained.content_storage_key,content_sha256=retained.document_sha256
   WHERE id=a.id AND tenant_id=_tenant;
 END IF;
 FOR credential IN SELECT value FROM pg_catalog.jsonb_array_elements(credentials) LOOP
  UPDATE public.paige_agreement_signers SET token_hash=credential->>'token_hash',token_expires_at=(credential->>'expires_at')::timestamptz
   WHERE id=(credential->>'signer_id')::uuid AND agreement_id=a.id AND tenant_id=_tenant;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(credentials) c WHERE NOT EXISTS(
  SELECT 1 FROM public.paige_agreement_signers s WHERE s.id=(c->>'signer_id')::uuid AND s.agreement_id=a.id AND s.tenant_id=_tenant
   AND s.token_hash=c->>'token_hash' AND s.token_expires_at=(c->>'expires_at')::timestamptz AND s.token_revoked_at IS NULL)) THEN
  RAISE EXCEPTION 'Original credential readback required' USING ERRCODE='40001'; END IF;
 RETURN public._read_prepared_agreement_credentials(_actor,_tenant,_operation,_request_sha256);
END $$;
REVOKE ALL ON FUNCTION public._issue_prepared_agreement_credentials(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._issue_prepared_agreement_credentials(uuid,uuid,uuid,text,jsonb) TO service_role;
COMMIT;
