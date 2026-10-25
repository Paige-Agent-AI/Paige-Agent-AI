-- Original prepared agreement -> canonical message/Rail -> recorded publication.
-- No send, signature, payment, approval, ledger or second execution runtime.
-- Recipient signature/field/seal holds stay closed until their actual contracts
-- are integrated. This originating pathway remains unmounted.
BEGIN;
SET LOCAL lock_timeout='5s';

DO $guard$
DECLARE expected record; actual text;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('private.e04_agreement_email_binding(jsonb,boolean)','25d777de071baeda11bb44fbf9a5f518','25d777de071baeda11bb44fbf9a5f518'),
  ('public.finalize_comms_email_send(uuid,uuid,text,text,text,integer)','2d66695eb8e42f5e9232e839e05d090a','2d66695eb8e42f5e9232e839e05d090a'),
  ('public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)','3a2fa340fca9838aa9c6737f1e41ae61','3a2fa340fca9838aa9c6737f1e41ae61'),
  ('public._paige_preparation_legacy_effect_hold()','7e634cc60a69a2eaa11fa5b01722cb4e','b4581030968e238115700a14da16f9b7'),
  ('public._paige_preparation_legacy_token_hold()','46c36eb38a54080388b25f7ff315d0b9','46c36eb38a54080388b25f7ff315d0b9'),
  ('private.e04_agreement_email_origin(uuid,uuid,jsonb,boolean)','d82ec171bb9faa84cf3b84250e22320f','d82ec171bb9faa84cf3b84250e22320f')
 ) AS checks(identity,old_body,own_body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF NOT FOUND OR actual NOT IN (expected.old_body,expected.own_body) THEN
   RAISE EXCEPTION 'Original signing/publication source changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR expected IN SELECT * FROM (VALUES
  ('private.e04_prepared_publication_record(uuid,uuid,uuid)','7bb1989b7dbd714a66dcad9e265d68d4'),
  ('public._publish_prepared_agreement_request(uuid,uuid,uuid,text)','09307978bcbfec308cb580ede532d75e')
 ) AS checks(identity,own_body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF FOUND AND actual IS DISTINCT FROM expected.own_body THEN
   RAISE EXCEPTION 'Prepared publication implementation changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger
  WHERE tgrelid='public.paige_agreements'::regclass AND tgname='trg_paige_preparation_legacy_effect_hold'
   AND NOT tgisinternal AND tgenabled='O' AND tgfoid=to_regprocedure('public._paige_preparation_legacy_effect_hold()')) THEN
  RAISE EXCEPTION 'Original prepared effect fence changed; reconcile before applying' USING ERRCODE='23514'; END IF;
END $guard$;

-- Historical evidence only, not a new approval or sending permission. The
-- native publisher takes original actor -> agreement -> child-message locks.
CREATE OR REPLACE FUNCTION private.e04_prepared_publication_record(_tenant uuid,_agreement uuid,_preparation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE; p public.paige_agreement_document_preparations%ROWTYPE;
 e public.paige_agreement_events%ROWTYPE; m public.messages%ROWTYPE; b jsonb; child jsonb; source jsonb;
 seen_signers uuid[]:='{}'::uuid[]; expected_sha text;
BEGIN
 SELECT * INTO a FROM public.paige_agreements WHERE id=_agreement AND tenant_id=_tenant;
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE id=_preparation AND tenant_id=_tenant AND agreement_id=_agreement AND is_current;
 IF NOT FOUND OR a.contact_id IS DISTINCT FROM p.client_id OR a.version IS DISTINCT FROM p.source_version
  OR a.content_storage_key IS DISTINCT FROM p.content_storage_key OR a.content_sha256 IS DISTINCT FROM p.document_sha256
  OR p.preparation_sha256 IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.manifest_canonical,'UTF8')),'hex') THEN RETURN NULL; END IF;
 SELECT * INTO e FROM public.paige_agreement_events WHERE tenant_id=_tenant AND agreement_id=_agreement
  AND event_type='sent' AND detail->>'action'='prepared_signature_request_recorded'
  AND detail->>'preparation_id'=_preparation::text ORDER BY seq DESC LIMIT 1;
 IF NOT FOUND OR e.actor_kind IS DISTINCT FROM 'owner' OR e.actor_user_id IS NULL
  OR pg_catalog.jsonb_typeof(e.detail) IS DISTINCT FROM 'object'
  OR (e.detail-ARRAY['action','work_id','operation_id','request_sha256','preparation_id','preparation_sha256','document_sha256','child_receipts','receipt_sha256'])<>'{}'::jsonb
  OR NOT(e.detail ?& ARRAY['action','work_id','operation_id','request_sha256','preparation_id','preparation_sha256','document_sha256','child_receipts','receipt_sha256'])
  OR e.detail->>'preparation_sha256' IS DISTINCT FROM p.preparation_sha256
  OR e.detail->>'document_sha256' IS DISTINCT FROM p.document_sha256
  OR pg_catalog.jsonb_typeof(e.detail->'child_receipts') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_array_length(e.detail->'child_receipts') NOT BETWEEN 1 AND 100 THEN RETURN NULL; END IF;
 expected_sha:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(public._paige_commercial_canonical_json(e.detail-'receipt_sha256'),'UTF8')),'hex');
 IF e.detail->>'receipt_sha256' IS DISTINCT FROM expected_sha THEN RETURN NULL; END IF;
 FOR child IN SELECT value FROM pg_catalog.jsonb_array_elements(e.detail->'child_receipts') LOOP
  IF pg_catalog.jsonb_typeof(child) IS DISTINCT FROM 'object'
   OR (child-ARRAY['message_id','operation_id','signer_id','rail_event_id'])<>'{}'::jsonb
   OR NOT(child ?& ARRAY['message_id','operation_id','signer_id','rail_event_id']) THEN RETURN NULL; END IF;
  SELECT * INTO m FROM public.messages WHERE id=(child->>'message_id')::uuid AND tenant_id=_tenant;
  IF NOT FOUND OR m.provider_message_id IS NULL OR m.provider_message_id='' THEN RETURN NULL; END IF;
  b:=m.meta->'comms_email_binding';
  IF b->>'state' IS DISTINCT FROM 'provider_accepted' OR b->>'provider' IS DISTINCT FROM 'sendgrid'
   OR b->>'provider_message_id' IS DISTINCT FROM m.provider_message_id
   OR b->>'operation_id' IS DISTINCT FROM child->>'operation_id'
   OR b#>>'{governance,signer_id}' IS DISTINCT FROM child->>'signer_id'
   OR b#>>'{governance,agreement_work_id}' IS DISTINCT FROM e.detail->>'work_id'
   OR b#>>'{governance,agreement_operation_id}' IS DISTINCT FROM e.detail->>'operation_id'
   OR b#>>'{governance,agreement_request_sha256}' IS DISTINCT FROM e.detail->>'request_sha256'
   OR b->>'actor_user_id' IS DISTINCT FROM e.actor_user_id::text THEN RETURN NULL; END IF;
  source:=private.e04_agreement_email_binding(b,false);
  IF source IS NULL OR source->>'agreement_id' IS DISTINCT FROM _agreement::text OR source->>'preparation_id' IS DISTINCT FROM _preparation::text
   OR source->>'preparation_sha256' IS DISTINCT FROM p.preparation_sha256 OR source->>'document_sha256' IS DISTINCT FROM p.document_sha256
   OR (child->>'signer_id')::uuid=ANY(seen_signers)
   OR NOT EXISTS(SELECT 1 FROM public.paige_workspace_events rail
    WHERE rail.id=(child->>'rail_event_id')::uuid AND rail.tenant_id=_tenant AND rail.actor_id=e.actor_user_id
     AND rail.source_kind='capability_run' AND rail.source_id=(child->>'operation_id')::uuid AND rail.source_revision=0
     AND rail.outcome='capability_succeeded' AND rail.capability_key='comms_send_email') THEN RETURN NULL; END IF;
  seen_signers:=pg_catalog.array_append(seen_signers,(child->>'signer_id')::uuid);
 END LOOP;
 RETURN pg_catalog.jsonb_build_object('event_id',e.id,'work_id',e.detail->'work_id',
  'operation_id',e.detail->'operation_id','request_sha256',e.detail->'request_sha256',
  'receipt_sha256',expected_sha,'accepted_count',pg_catalog.cardinality(seen_signers));
END $$;
REVOKE ALL ON FUNCTION private.e04_prepared_publication_record(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._publish_prepared_agreement_request(_actor uuid,_tenant uuid,_operation uuid,_request_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb; a public.paige_agreements%ROWTYPE; p public.paige_agreement_document_preparations%ROWTYPE;
 m public.messages%ROWTYPE; b jsonb; source jsonb; rail_id uuid; event_id uuid; recorded jsonb;
 children jsonb:='[]'::jsonb; seen uuid[]:='{}'::uuid[]; detail jsonb; digest text; accepted integer; total integer; replayed boolean:=false;
BEGIN
 receipt:=private.e04_prepared_issuance_record(_actor,_tenant,_operation,_request_sha256);
 IF receipt IS NULL THEN RAISE EXCEPTION 'Original approved request unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.paige_agreements WHERE id=(receipt->>'agreement_id')::uuid AND tenant_id=_tenant FOR UPDATE;
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE id=(receipt->>'preparation_id')::uuid AND tenant_id=_tenant AND agreement_id=a.id AND is_current FOR SHARE;
 IF NOT FOUND OR a.status NOT IN ('draft','sent','viewed','partially_signed')
  OR (a.expires_at IS NOT NULL AND a.expires_at<=pg_catalog.clock_timestamp())
  OR a.contact_id IS DISTINCT FROM p.client_id OR a.version IS DISTINCT FROM p.source_version
  OR a.content_storage_key IS DISTINCT FROM p.content_storage_key OR a.content_sha256 IS DISTINCT FROM p.document_sha256 THEN
  RAISE EXCEPTION 'Original prepared publication changed' USING ERRCODE='23514'; END IF;
 FOR m IN SELECT * FROM public.messages WHERE tenant_id=_tenant
  AND meta#>>'{comms_email_binding,governance,agreement_work_id}'=receipt->>'work_id' ORDER BY id FOR SHARE LOOP
  b:=m.meta->'comms_email_binding';
  IF b->>'state' IS DISTINCT FROM 'provider_accepted' THEN CONTINUE; END IF;
  source:=private.e04_agreement_email_binding(b,false);
  IF source IS NULL OR source->>'agreement_id' IS DISTINCT FROM a.id::text OR source->>'preparation_id' IS DISTINCT FROM p.id::text
   OR source->>'actor_id' IS DISTINCT FROM _actor::text OR source->>'agreement_operation_id' IS DISTINCT FROM _operation::text
   OR source->>'request_sha256' IS DISTINCT FROM _request_sha256
   OR m.provider_message_id IS NULL OR m.provider_message_id=''
   OR b->>'provider_message_id' IS DISTINCT FROM m.provider_message_id OR b->>'provider' IS DISTINCT FROM 'sendgrid'
   OR (source#>>'{signer,id}')::uuid=ANY(seen) THEN
   RAISE EXCEPTION 'Original accepted message differs' USING ERRCODE='23514'; END IF;
  SELECT id INTO rail_id FROM public.paige_workspace_events WHERE tenant_id=_tenant AND actor_id=_actor
   AND source_kind='capability_run' AND source_id=(b->>'operation_id')::uuid AND source_revision=0
   AND outcome='capability_succeeded' AND capability_key='comms_send_email';
  IF NOT FOUND THEN RAISE EXCEPTION 'Original provider receipt unavailable' USING ERRCODE='23514'; END IF;
  children:=children||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('message_id',m.id,
   'operation_id',b->>'operation_id','signer_id',source#>>'{signer,id}','rail_event_id',rail_id));
  seen:=pg_catalog.array_append(seen,(source#>>'{signer,id}')::uuid);
 END LOOP;
 accepted:=pg_catalog.cardinality(seen);total:=pg_catalog.jsonb_array_length(receipt->'credentials');
 IF accepted<1 OR accepted>total THEN RAISE EXCEPTION 'Provider acceptance is not verified' USING ERRCODE='23514'; END IF;
 detail:=pg_catalog.jsonb_build_object('action','prepared_signature_request_recorded','work_id',receipt->'work_id',
  'operation_id',_operation,'request_sha256',_request_sha256,'preparation_id',p.id,'preparation_sha256',p.preparation_sha256,
  'document_sha256',p.document_sha256,'child_receipts',children);
 digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(public._paige_commercial_canonical_json(detail),'UTF8')),'hex');
 detail:=detail||pg_catalog.jsonb_build_object('receipt_sha256',digest);
 SELECT e.id INTO event_id FROM public.paige_agreement_events e WHERE e.tenant_id=_tenant AND e.agreement_id=a.id
  AND e.event_type='sent' AND e.actor_kind='owner' AND e.actor_user_id=_actor AND e.detail->>'action'='prepared_signature_request_recorded'
  AND e.detail->>'receipt_sha256'=digest ORDER BY e.seq DESC LIMIT 1;
 IF FOUND THEN replayed:=true;
 ELSE INSERT INTO public.paige_agreement_events(agreement_id,tenant_id,event_type,actor_kind,actor_user_id,detail)
  VALUES(a.id,_tenant,'sent','owner',_actor,detail) RETURNING id INTO event_id; END IF;
 recorded:=private.e04_prepared_publication_record(_tenant,a.id,p.id);
 IF recorded IS NULL OR recorded->>'event_id' IS DISTINCT FROM event_id::text THEN
  RAISE EXCEPTION 'Original publication receipt unverified' USING ERRCODE='23514'; END IF;
 IF a.status='draft' THEN UPDATE public.paige_agreements SET status='sent' WHERE id=a.id AND tenant_id=_tenant; a.status:='sent'; END IF;
 RETURN pg_catalog.jsonb_build_object('state','recorded','replayed',replayed,'agreement_id',a.id,'agreement_status',a.status,
  'receipt_id',event_id,'work_id',receipt->'work_id','operation_id',_operation,'request_sha256',_request_sha256,
  'provider_outcome',CASE WHEN accepted=total THEN 'provider_accepted' ELSE 'provider_partial' END,
  'accepted_count',accepted,'recipient_count',total,'delivery_confirmed',false);
END $$;
REVOKE ALL ON FUNCTION public._publish_prepared_agreement_request(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._publish_prepared_agreement_request(uuid,uuid,uuid,text) TO service_role;

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
  -- Only a real ORIGINAL canonical message/Rail publication receipt may let
  -- this draft record become sent. Other fields and all recipient/signature/
  -- sealed-file transitions remain under the original closed fences.
  IF OLD.status='draft' AND NEW.status='sent'
   AND (pg_catalog.to_jsonb(NEW)-ARRAY['status','updated_at'])
    IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['status','updated_at'])
   AND private.e04_prepared_publication_record(OLD.tenant_id,OLD.id,p.id) IS NOT NULL THEN RETURN NEW; END IF;
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

COMMIT;
