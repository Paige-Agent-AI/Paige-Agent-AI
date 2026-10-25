-- Originating approved agreement -> ORIGINAL canonical message admission.
-- No mounted caller, provider call, sender/runtime pin or additional outbox.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $guard$
DECLARE expected record; actual text;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('private.e04_prepared_issuance_record(uuid,uuid,uuid,text)','78228993b63b007430bb9d7f5213270b'),
  ('private.e04_prepared_issuance_write(uuid,uuid,uuid)','38ec7e5cac3bcfb27e75bfce7c2e965c'),
  ('public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)','3a2fa340fca9838aa9c6737f1e41ae61')
 ) AS dependencies(identity,body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF NOT FOUND OR actual IS DISTINCT FROM expected.body THEN
   RAISE EXCEPTION 'Original agreement message dependency changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 END LOOP;
 SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
  WHERE oid=to_regprocedure('private.e04_agreement_email_origin(uuid,uuid,jsonb,boolean)');
 IF FOUND AND actual IS DISTINCT FROM 'd82ec171bb9faa84cf3b84250e22320f' THEN
  RAISE EXCEPTION 'Agreement message source changed; reconcile before applying' USING ERRCODE='23514'; END IF;
END $guard$;

-- The source projection itself grants no email admission. Existing canonical
-- prepare/read/claim below reuse it; finalization/pre-send/provider stay original.
CREATE OR REPLACE FUNCTION private.e04_agreement_email_origin(
 _actor uuid,_tenant uuid,_governance jsonb,_fresh boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb; current_receipt jsonb; r jsonb; party jsonb; invitation jsonb; credential jsonb;
 w public.paige_durable_work%ROWTYPE; approval public.paige_pending_confirmations%ROWTYPE;
 document public.paige_agreement_document_preparations%ROWTYPE;
 a public.paige_agreements%ROWTYPE; s public.paige_agreement_signers%ROWTYPE;
 expected_commercial jsonb; k text;
BEGIN
 IF _fresh IS NULL OR pg_catalog.jsonb_typeof(_governance) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(_governance))<>13
  OR NOT(_governance ?& ARRAY['actor_user_id','tenant_id','tool','action','approval_channel',
    'decision_receipt_recorded','approved_fingerprint','purpose','agreement_work_id','agreement_operation_id',
    'agreement_request_sha256','signer_id','operation_id']) THEN
  RAISE EXCEPTION 'Agreement message origin invalid' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['actor_user_id','tenant_id','agreement_work_id','agreement_operation_id','signer_id','operation_id'] LOOP
  IF pg_catalog.jsonb_typeof(_governance->k) IS DISTINCT FROM 'string'
   OR coalesce(_governance->>k,'') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN
   RAISE EXCEPTION 'Agreement message origin invalid' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF pg_catalog.jsonb_typeof(_governance->'agreement_request_sha256') IS DISTINCT FROM 'string'
  OR coalesce(_governance->>'agreement_request_sha256','') !~ '^[a-f0-9]{64}$'
  OR pg_catalog.jsonb_typeof(_governance->'approved_fingerprint') IS DISTINCT FROM 'string'
  OR coalesce(_governance->>'approved_fingerprint','') !~ '^[a-f0-9]{16}$' THEN
  RAISE EXCEPTION 'Agreement message origin invalid' USING ERRCODE='22023'; END IF;
 IF _governance->>'actor_user_id' IS DISTINCT FROM _actor::text
  OR _governance->>'tenant_id' IS DISTINCT FROM _tenant::text
  OR _governance->>'tool' IS DISTINCT FROM 'agreement_send'
  OR _governance->>'action' IS DISTINCT FROM 'agreement.send'
  OR _governance->>'purpose' IS DISTINCT FROM 'agreement_signature_request'
  OR _governance->>'approval_channel' IS DISTINCT FROM 'chat-canonical'
  OR _governance->'decision_receipt_recorded' IS DISTINCT FROM 'true'::jsonb THEN
  RAISE EXCEPTION 'Original agreement message authority required' USING ERRCODE='42501'; END IF;
 -- ORIGINAL reader repeats current native person/business/role and the exact
 -- consumed original approval/claim/Work/request/preparation evidence.
 receipt:=private.e04_prepared_issuance_record(_actor,_tenant,
  (_governance->>'agreement_operation_id')::uuid,_governance->>'agreement_request_sha256');
 IF receipt IS NULL OR receipt->>'work_id' IS DISTINCT FROM _governance->>'agreement_work_id' THEN
  RAISE EXCEPTION 'Original agreement message authority required' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=(receipt->>'work_id')::uuid;
 SELECT * INTO approval FROM public.paige_pending_confirmations
  WHERE id=(w.authority_context->>'confirmation_id')::uuid AND tenant_id=_tenant AND user_id=_actor;
 IF NOT FOUND OR approval.fingerprint IS DISTINCT FROM _governance->>'approved_fingerprint' THEN
  RAISE EXCEPTION 'Original agreement message approval differs' USING ERRCODE='42501'; END IF;
 r:=approval.args->'request';
 SELECT value INTO party FROM pg_catalog.jsonb_array_elements(r->'recipients')
  WHERE value->>'id'=_governance->>'signer_id';
 SELECT value INTO invitation FROM pg_catalog.jsonb_array_elements(r->'messages')
  WHERE value->>'signer_id'=_governance->>'signer_id';
 SELECT value INTO credential FROM pg_catalog.jsonb_array_elements(receipt->'credentials')
  WHERE value->>'signer_id'=_governance->>'signer_id';
 IF party IS NULL OR invitation IS NULL OR credential IS NULL
  OR invitation->>'to' IS DISTINCT FROM party->>'email'
  OR r#>>'{sender,provider}' IS DISTINCT FROM 'sendgrid' THEN
  RAISE EXCEPTION 'Original agreement signer/message differs' USING ERRCODE='42501'; END IF;
 SELECT * INTO document FROM public.paige_agreement_document_preparations
  WHERE id=(receipt->>'preparation_id')::uuid AND tenant_id=_tenant AND agreement_id=(receipt->>'agreement_id')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original retained agreement unavailable' USING ERRCODE='42501'; END IF;
 IF _fresh THEN
  -- Match ORIGINAL issuance order: actor -> agreement -> original authority.
  -- Canonical message admission must take this source lock BEFORE its message
  -- lock. Nothing here finalizes a provider outcome or writes an agreement.
  SELECT * INTO a FROM public.paige_agreements
   WHERE id=document.agreement_id AND tenant_id=_tenant FOR UPDATE;
  IF NOT FOUND OR a.contact_id IS DISTINCT FROM document.client_id
   OR a.version IS DISTINCT FROM document.source_version
   OR a.content_storage_key IS DISTINCT FROM document.content_storage_key
   OR a.content_sha256 IS DISTINCT FROM document.document_sha256
   OR a.status NOT IN ('draft','sent','viewed','partially_signed')
   OR (a.expires_at IS NOT NULL AND a.expires_at<=pg_catalog.clock_timestamp()) THEN
   RAISE EXCEPTION 'Original agreement message source changed' USING ERRCODE='40001'; END IF;
  current_receipt:=private.e04_prepared_issuance_write(_tenant,a.id,document.id);
  IF current_receipt IS NULL OR current_receipt IS DISTINCT FROM receipt THEN
   RAISE EXCEPTION 'Original agreement message authority changed' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.paige_agreement_signers
   WHERE id=(_governance->>'signer_id')::uuid AND agreement_id=a.id AND tenant_id=_tenant FOR SHARE;
  IF NOT FOUND OR s.status NOT IN ('pending','viewed') OR s.token_revoked_at IS NOT NULL
   OR s.token_hash IS NULL OR s.token_expires_at IS NULL OR s.token_expires_at<=pg_catalog.clock_timestamp()
   OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(s.token_hash,'UTF8')),'hex') IS DISTINCT FROM credential->>'token_commitment'
   OR s.token_expires_at IS DISTINCT FROM (credential->>'expires_at')::timestamptz
   OR s.email IS DISTINCT FROM party->>'email' OR s.full_name IS DISTINCT FROM party->>'full_name'
   OR s.signer_role IS DISTINCT FROM party->>'signer_role' OR s.signing_order IS DISTINCT FROM (party->>'signing_order')::integer
   OR document.manifest_canonical::jsonb->'signers' IS DISTINCT FROM public._agreement_preparation_parties(_tenant,a.id) THEN
   RAISE EXCEPTION 'Original agreement signing credential changed' USING ERRCODE='42501'; END IF;
  IF document.commercial_payload_digest IS NOT NULL THEN
   expected_commercial:=pg_catalog.jsonb_build_object('schema_version',1,
    'payload',document.manifest_canonical::jsonb#>'{commercial,payload}','payload_digest',document.commercial_payload_digest,
    'presented_body_sha256',document.manifest_canonical::jsonb#>'{commercial,presented_body_sha256}',
    'content_storage_key',document.content_storage_key,'document_sha256',document.document_sha256);
   IF a.commercial_presentation IS DISTINCT FROM expected_commercial
    OR a.presented_body_markdown IS DISTINCT FROM document.manifest_canonical::jsonb#>>'{commercial,presented_body_markdown}' THEN
    RAISE EXCEPTION 'Original agreement commercial presentation changed' USING ERRCODE='40001'; END IF;
  ELSIF a.commercial_presentation IS NOT NULL OR a.presented_body_markdown IS NOT NULL THEN
   RAISE EXCEPTION 'Unreviewed agreement commercial presentation' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN pg_catalog.jsonb_build_object('kind','prepared_agreement_message_source','source_only',true,
  'tenant_id',_tenant,'actor_id',_actor,'work_id',w.id,'agreement_id',document.agreement_id,'client_id',document.client_id,
  'preparation_id',document.id,'preparation_sha256',document.preparation_sha256,'document_sha256',document.document_sha256,
  'content_storage_key',document.content_storage_key,'operation_id',_governance->'operation_id',
  'agreement_operation_id',_governance->'agreement_operation_id','request_sha256',_governance->'agreement_request_sha256',
  'credential_event_id',receipt->'event_id','credential_commitment',credential->'token_commitment',
  'credential_expires_at',credential->'expires_at','approved_fingerprint',approval.fingerprint,
  'decision_audit_id',w.authority_context->'decision_audit_id','signer',party,'message',invitation,'sender',r->'sender',
  'recipient_ids',(SELECT pg_catalog.jsonb_agg(entry.value->'id' ORDER BY entry.ordinal)
    FROM pg_catalog.jsonb_array_elements(r->'recipients') WITH ORDINALITY entry(value,ordinal)),
  'command',pg_catalog.jsonb_build_object('action','agreement.send','agreement_id',document.agreement_id,
    'agreement_work_id',w.id,'agreement_operation_id',_governance->'agreement_operation_id',
    'agreement_request_sha256',_governance->'agreement_request_sha256','signer_id',party->'id','operation_id',_governance->'operation_id'));
END $$;
REVOKE ALL ON FUNCTION private.e04_agreement_email_origin(uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;

DO $private_guard$
DECLARE actual text;
BEGIN
 SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('private.e04_agreement_email_binding(jsonb,boolean)');
 IF FOUND AND actual IS DISTINCT FROM '25d777de071baeda11bb44fbf9a5f518' THEN
  RAISE EXCEPTION 'Agreement binding source changed; reconcile before applying' USING ERRCODE='23514'; END IF;
END $private_guard$;
DO $comms_guard$
DECLARE expected record; actual text;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public._comms_email_governance(uuid,uuid,jsonb)','21bc84baaee0a89269cbae4eaade5fe4','3476f7a0ab6d51aefe9f30cfba86982f'),
  ('public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)','34fe39ac8f870cbcc6887f3e2fc3a8e0','8da3b64c24552123b973db96a74ab986'),
  ('public.read_comms_email_send_binding(uuid)','b1afe7cd33a951738c2f49c6660a5023','6bc0d581e141cfaf0221002d71564eaa'),
  ('public.claim_comms_email_send(uuid,uuid,boolean)','b457bccb225454101baba2355ee6baa6','7b1173ff7d53da5836e33c2d77366c77')
 ) AS dependencies(identity,prior_body,own_body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF NOT FOUND OR actual NOT IN (expected.prior_body,expected.own_body) THEN
   RAISE EXCEPTION 'Original Communications source changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 END LOOP;
END $comms_guard$;

-- Private domain comparison for the SAME original canonical message binding.
CREATE OR REPLACE FUNCTION private.e04_agreement_email_binding(_binding jsonb,_fresh boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE origin jsonb;
BEGIN
 origin:=private.e04_agreement_email_origin((_binding->>'actor_user_id')::uuid,
   (_binding->>'tenant_id')::uuid,_binding->'governance',_fresh);
 IF _binding->>'operation_id' IS DISTINCT FROM origin->>'operation_id'
  OR _binding->>'contact_id' IS DISTINCT FROM origin->>'client_id'
  OR _binding->>'recipient' IS DISTINCT FROM origin#>>'{message,to}'
  OR _binding->>'subject' IS DISTINCT FROM origin#>>'{message,subject}'
  OR _binding->>'body_text' IS DISTINCT FROM origin#>>'{message,body_text}'
  OR _binding->>'body_html' IS DISTINCT FROM origin#>>'{message,body_html}'
  OR _binding->>'connector_id' IS DISTINCT FROM origin#>>'{sender,connector_id}'
  OR _binding->>'from_address' IS DISTINCT FROM origin#>>'{sender,from_address}'
  OR _binding->>'provider' IS DISTINCT FROM 'sendgrid'
  OR _binding->'command' IS DISTINCT FROM origin->'command'
  OR _binding->>'approval_id' IS NOT NULL OR _binding->>'origin_action_id' IS NOT NULL
  OR _binding->>'origin_action_kind' IS NOT NULL THEN
  RAISE EXCEPTION 'COMMS_EMAIL_AGREEMENT_BINDING_CHANGED' USING ERRCODE='40001'; END IF;
 RETURN origin;
END $$;
REVOKE ALL ON FUNCTION private.e04_agreement_email_binding(jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._comms_email_governance(_actor uuid,_tenant uuid,_governance jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- Agreement HIGH authority is proved by its ORIGINAL consumed approval/Work,
 -- never relabeled as an operator-card generic email decision.
 IF _governance->>'purpose'='agreement_signature_request' THEN
  PERFORM private.e04_agreement_email_origin(_actor,_tenant,_governance,false);
  RETURN;
 END IF;
 IF _governance IS NULL OR jsonb_typeof(_governance)<>'object'
  OR _governance->>'actor_user_id' IS DISTINCT FROM _actor::text OR _governance->>'tenant_id' IS DISTINCT FROM _tenant::text
  OR _governance->>'tool' IS DISTINCT FROM 'comms_send_email' OR _governance->>'action' IS DISTINCT FROM 'comms.email_send'
  OR _governance->>'approval_channel' IS DISTINCT FROM 'operator_card'
  OR _governance->'decision_receipt_recorded' IS DISTINCT FROM 'true'::jsonb
  OR coalesce(_governance->>'approved_fingerprint','') !~ '^[0-9a-f]{16}$' THEN
  RAISE EXCEPTION 'COMMS_EMAIL_GOVERNANCE_REQUIRED' USING ERRCODE='42501';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_contact_id uuid,_recipient text,_connector_id uuid,_from_address text,_subject text,_body_text text,_body_html text,_content_digest text,_command jsonb,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
 _uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 _approval text; ap public.paige_pending_approvals%ROWTYPE; _act public.paige_actions%ROWTYPE;
 _live text; _cited text; _constraint text; _action_id uuid;
 agreement_source jsonb;
BEGIN
 PERFORM public._comms_email_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._comms_email_governance(_actor_user_id,_expected_tenant_id,_governance);
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;
 -- (6) The drafted reply this send answers, from the door's server-built governance record. NULL = none.
 _approval:=nullif(lower(btrim(_governance->>'approval_id')),'');
 IF _approval IS NOT NULL AND _approval !~ _uuid THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,32847));

 SELECT * INTO m FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=_operation_id::text;
 IF FOUND THEN
  b:=m.meta->'comms_email_binding';
  IF m.tenant_id IS DISTINCT FROM _expected_tenant_id OR b->>'actor_user_id' IS DISTINCT FROM _actor_user_id::text
   OR b->'command' IS DISTINCT FROM _command OR b->>'content_digest' IS DISTINCT FROM _content_digest
   OR lower(b->>'approval_id') IS DISTINCT FROM _approval THEN
   RAISE EXCEPTION 'COMMS_EMAIL_REPLAY_MISMATCH' USING ERRCODE='22023';
  END IF;
  IF _governance->>'purpose'='agreement_signature_request'
   AND b->'governance' IS DISTINCT FROM _governance THEN
   RAISE EXCEPTION 'COMMS_EMAIL_REPLAY_MISMATCH' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'state',b->>'state','message_id',m.id);
 END IF;

 -- ORIGINAL agreement lock precedes its child message, including distinct
 -- transport intents. A lost acknowledgement is inspected, never a new send.
 IF _governance->>'purpose'='agreement_signature_request' THEN
  agreement_source:=private.e04_agreement_email_origin(_actor_user_id,_expected_tenant_id,_governance,true);
  IF _operation_id::text IS DISTINCT FROM agreement_source->>'operation_id'
   OR _contact_id::text IS DISTINCT FROM agreement_source->>'client_id'
   OR _recipient IS DISTINCT FROM agreement_source#>>'{message,to}'
   OR _subject IS DISTINCT FROM agreement_source#>>'{message,subject}'
   OR _body_text IS DISTINCT FROM agreement_source#>>'{message,body_text}'
   OR _body_html IS DISTINCT FROM agreement_source#>>'{message,body_html}'
   OR _connector_id::text IS DISTINCT FROM agreement_source#>>'{sender,connector_id}'
   OR _from_address IS DISTINCT FROM agreement_source#>>'{sender,from_address}'
   OR _command IS DISTINCT FROM agreement_source->'command' THEN
   RAISE EXCEPTION 'COMMS_EMAIL_AGREEMENT_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM public.messages previous
    WHERE previous.tenant_id=_expected_tenant_id
     AND previous.meta#>>'{comms_email_binding,governance,purpose}'='agreement_signature_request'
     AND previous.meta#>>'{comms_email_binding,governance,agreement_work_id}'=agreement_source->>'work_id'
     AND previous.meta#>>'{comms_email_binding,governance,signer_id}'=agreement_source#>>'{signer,id}') THEN
   RAISE EXCEPTION 'COMMS_EMAIL_AGREEMENT_INTENT_ALREADY_RECORDED' USING ERRCODE='55000'; END IF;
 ELSE
 -- The command is the canonical approved shape; its fields must be the ones being prepared.
 IF _command IS NULL OR jsonb_typeof(_command)<>'object' OR _command->>'action' IS DISTINCT FROM 'comms.email_send'
  OR _command->>'contact_id' IS DISTINCT FROM _contact_id::text OR _command->>'subject' IS DISTINCT FROM _subject
  OR _command->>'body' IS DISTINCT FROM _body_text
  OR (_command->>'connector_id' IS NOT NULL AND _command->>'connector_id' IS DISTINCT FROM _connector_id::text) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023';
 END IF;

 END IF;

 -- (6) One live send per reply approval. The approval row is locked, so two confirms of different
 -- operations for the same reply serialize here; the second sees the first's send and is refused.
 IF _approval IS NOT NULL THEN
  SELECT * INTO ap FROM public.paige_pending_approvals WHERE id=_approval::uuid FOR UPDATE;
  BEGIN _action_id:=nullif(btrim(ap.metadata->>'action_id'),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN _action_id:=NULL; END;
  -- PPA -> exact canonical action. Lock every backlink deterministically before proving uniqueness.
  PERFORM 1 FROM public.paige_actions a WHERE a.approval_id=ap.id ORDER BY a.id FOR UPDATE;
  IF ap.id IS NOT NULL AND _action_id IS NOT NULL THEN
   SELECT * INTO _act FROM public.paige_actions a
    WHERE a.id=_action_id AND a.approval_id=ap.id AND a.tenant_id=ap.tenant_id;
  END IF;
  IF ap.id IS NULL OR ap.tenant_id IS DISTINCT FROM _expected_tenant_id
   OR _act.id IS NULL OR _act.action_kind NOT IN ('owner.lead_followup','client.followup','owner.followup_email') OR _act.contact_id IS DISTINCT FROM _contact_id
   OR (ap.contact_id IS NOT NULL AND ap.contact_id IS DISTINCT FROM _contact_id)
   OR (SELECT count(*) FROM public.paige_actions a WHERE a.approval_id=ap.id)<>1
   OR NOT EXISTS (SELECT 1 FROM public.paige_action_kinds k WHERE k.slug=_act.action_kind AND k.executor='send_via_approval') THEN
   RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_INVALID' USING ERRCODE='42501';
  END IF;
  IF ap.status IN ('approved','sent') THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_ALREADY_SENT' USING ERRCODE='55000'; END IF;
  IF ap.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_NOT_PENDING' USING ERRCODE='55000'; END IF;
  IF _act.status IS NULL OR _act.status NOT IN ('drafted','pending_approval') THEN
   RAISE EXCEPTION 'COMMS_EMAIL_ORIGIN_NOT_SENDABLE' USING ERRCODE='55000';
  END IF;
  -- A send prepared for this approval that has not failed or been refused …
  SELECT o.meta#>>'{comms_email_binding,state}' INTO _live FROM public.messages o
   WHERE o.meta ? 'comms_email_binding' AND lower(o.meta#>>'{comms_email_binding,approval_id}')=_approval
     AND coalesce(o.meta#>>'{comms_email_binding,state}','') NOT IN ('failed','refused')
   ORDER BY (o.meta#>>'{comms_email_binding,state}'='provider_accepted') DESC LIMIT 1;
  -- … or the send the approval itself cites (metadata.governed_send), whatever it was prepared for.
  IF _live IS NULL THEN
   _cited:=lower(btrim(ap.metadata#>>'{governed_send,operation_id}'));
   IF _cited ~ _uuid THEN
    SELECT o.meta#>>'{comms_email_binding,state}' INTO _live FROM public.messages o
     WHERE o.meta ? 'comms_email_binding' AND o.meta#>>'{comms_email_binding,operation_id}'=_cited
       AND o.tenant_id=_expected_tenant_id AND coalesce(o.meta#>>'{comms_email_binding,state}','') NOT IN ('failed','refused');
   END IF;
  END IF;
  IF _live='provider_accepted' THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_ALREADY_SENT' USING ERRCODE='55000'; END IF;
  IF _live IS NOT NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_SEND_IN_PROGRESS' USING ERRCODE='55000'; END IF;
 END IF;


 PERFORM 1 FROM public.clients WHERE id=_contact_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTACT_NOT_IN_WORKSPACE' USING ERRCODE='42501'; END IF;
 -- An approved business/witness signer belongs to the original agreement;
 -- it is not manufactured as another client contact method.
 IF agreement_source IS NULL THEN
 IF _recipient IS NULL OR _recipient IS DISTINCT FROM lower(btrim(_recipient)) OR length(_recipient)>320
  OR NOT EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.tenant_id=_expected_tenant_id AND cm.client_id=_contact_id
   AND cm.kind='email' AND lower(btrim(cm.value))=_recipient) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_RECIPIENT_CHANGED' USING ERRCODE='40001';
 END IF;

 END IF;

 SELECT * INTO c FROM public.channel_connectors WHERE id=_connector_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF c.id IS NULL OR c.active IS DISTINCT FROM true OR c.status IS DISTINCT FROM 'active' OR c.channel_type IS DISTINCT FROM 'email'
  OR c.provider IS NULL OR c.provider NOT IN ('resend','gmail','smtp','sendgrid') OR coalesce(length(btrim(c.from_address)),0)=0
  OR _from_address IS NULL OR lower(btrim(c.from_address)) IS DISTINCT FROM lower(btrim(_from_address))
  OR NOT coalesce(c.mailbox_class='shared_support'
    OR (c.mailbox_class='personal' AND c.mailbox_owner_user_id=_actor_user_id),false) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_SENDER_CHANGED' USING ERRCODE='40001';
 END IF;
 -- PAIGE Email (SendGrid): a connector row alone is never proof of sender identity (a workspace
 -- admin can write one). The From's domain must carry SendGrid verification facts that only the
 -- verification service can write (guard_tenant_email_domain_sendgrid_facts, 20271031000100).
 IF c.provider='sendgrid' AND NOT public._comms_email_sendgrid_sender_verified(_expected_tenant_id,c.from_address) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_SENDER_UNVERIFIED' USING ERRCODE='42501';
 END IF;

 IF _subject IS NULL OR length(btrim(_subject))=0 OR length(_subject)>200 OR _subject ~ E'[\r\n]'
  OR _body_text IS NULL OR length(btrim(_body_text))=0 OR length(_body_text)>10000
  OR _body_html IS NULL OR length(_body_html)=0 OR length(_body_html)>100000 THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023';
 END IF;
 IF _content_digest IS DISTINCT FROM encode(extensions.digest(convert_to(_recipient||E'\n'||_connector_id::text||E'\n'||_subject||E'\n'||_body_text,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DIGEST_MISMATCH' USING ERRCODE='22023';
 END IF;


 -- An earlier identical send whose outcome is not known must be reconciled, never re-sent.
 IF EXISTS (SELECT 1 FROM public.messages o WHERE o.tenant_id=_expected_tenant_id AND o.meta ? 'comms_email_binding'
   AND o.meta#>>'{comms_email_binding,recipient}'=_recipient AND o.meta#>>'{comms_email_binding,content_digest}'=_content_digest
   AND o.meta#>>'{comms_email_binding,state}' IN ('dispatching','unknown')) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_RECONCILIATION_REQUIRED' USING ERRCODE='55000';
 END IF;

 b:=jsonb_build_object('operation_id',_operation_id::text,'tenant_id',_expected_tenant_id,'actor_user_id',_actor_user_id,
  'contact_id',_contact_id,'recipient',_recipient,'connector_id',_connector_id,'from_address',lower(btrim(c.from_address)),
  'provider',c.provider,'subject',_subject,'body_text',_body_text,'body_html',_body_html,'content_digest',_content_digest,
  'command',_command,'governance',_governance,'state','prepared','attempts',0,'prepared_at',now(),'claimed_at',NULL,
  'finalized_at',NULL,'provider_message_id',NULL,'outcome_reason',NULL,'approval_id',_approval,'origin_action_id',_act.id,'origin_action_kind',_act.action_kind);
 BEGIN
  INSERT INTO public.messages(tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,recipients,sender,subject,body_text,body_html,meta)
  VALUES(_expected_tenant_id,_contact_id,_connector_id,'contact:'||_expected_tenant_id::text||':'||_contact_id::text,'email','outbound','draft',
   jsonb_build_array(jsonb_build_object('address',_recipient)),jsonb_build_object('address',lower(btrim(c.from_address))),
   _subject,_body_text,_body_html,jsonb_build_object('source','comms-email-command','comms_email_binding',b))
  RETURNING * INTO m;
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS _constraint = CONSTRAINT_NAME;
  IF _constraint='messages_comms_email_approval_live' THEN
   RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_SEND_IN_PROGRESS' USING ERRCODE='55000';
  END IF;
  RAISE;
 END;
 RETURN jsonb_build_object('ok',true,'replayed',false,'state','prepared','message_id',m.id);
END $$;

CREATE OR REPLACE FUNCTION public.read_comms_email_send_binding(_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
 ap public.paige_pending_approvals%ROWTYPE; a public.paige_actions%ROWTYPE;
 approval uuid; origin uuid; named uuid; origin_ok boolean:=true;
 agreement_source jsonb;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 b:=m.meta->'comms_email_binding'; IF b IS NULL THEN RETURN NULL; END IF;
 PERFORM public._comms_email_actor((b->>'actor_user_id')::uuid,m.tenant_id);
 -- Source is resolved BEFORE the message lock; claim takes the same parent
 -- first. Terminal history is never fresh permission or a re-send.
 IF b#>>'{governance,purpose}'='agreement_signature_request' THEN
  agreement_source:=private.e04_agreement_email_binding(b,b->>'state' IN ('prepared','dispatching'));
 END IF;
 -- Only a fresh prepared admission needs pending-origin eligibility. Original admitted outcomes
 -- and the incumbent bounded same-operation reconciliation do not acquire fresh approval authority.
 IF b->>'approval_id' IS NOT NULL AND b->>'state'='prepared' THEN
  BEGIN approval:=(b->>'approval_id')::uuid; origin:=(b->>'origin_action_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN approval:=NULL; origin:=NULL; END;
  SELECT * INTO ap FROM public.paige_pending_approvals WHERE id=approval FOR UPDATE;
  SELECT * INTO a FROM public.paige_actions WHERE id=origin FOR UPDATE;
  BEGIN named:=nullif(btrim(ap.metadata->>'action_id'),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN named:=NULL; END;
  origin_ok:=coalesce(ap.id IS NOT NULL AND origin IS NOT NULL AND a.id=origin AND named=origin
   AND ap.tenant_id=m.tenant_id AND a.tenant_id=m.tenant_id AND a.approval_id=ap.id
   AND a.contact_id=m.contact_id AND (ap.contact_id IS NULL OR ap.contact_id=m.contact_id)
   AND ap.status='pending' AND a.status IN ('drafted','pending_approval')
   AND a.action_kind IN ('owner.lead_followup','client.followup','owner.followup_email')
   AND a.action_kind=b->>'origin_action_kind'
   AND EXISTS (SELECT 1 FROM public.paige_action_kinds k WHERE k.slug=a.action_kind AND k.executor='send_via_approval')
   AND (SELECT count(*) FROM public.paige_actions x WHERE x.approval_id=ap.id)=1,false);
 END IF;
 -- Re-read after any origin-lock wait; a concurrent winning claim may have advanced state.
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE;
 IF ((m.meta->'comms_email_binding')-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason'])
  IS DISTINCT FROM (b-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason']) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_BINDING_CHANGED' USING ERRCODE='40001';
 END IF;
 b:=m.meta->'comms_email_binding';
 IF b->>'state' IS DISTINCT FROM 'prepared' THEN origin_ok:=true; END IF;
 SELECT * INTO c FROM public.channel_connectors WHERE id=m.connector_id AND tenant_id=m.tenant_id FOR SHARE;
 -- Recheck the ORIGINAL lease/approval after any connector wait. The parent
 -- agreement lock was acquired above; this adds no inverse message->parent lock.
 IF agreement_source IS NOT NULL THEN
  agreement_source:=private.e04_agreement_email_binding(b,b->>'state' IN ('prepared','dispatching'));
 END IF;
 RETURN b||jsonb_build_object('message_id',m.id,'tenant_id',m.tenant_id,'channel_type',m.channel_type,'message_status',m.status,
  'origin_eligible',origin_ok,'eligible',origin_ok AND m.channel_type='email' AND m.direction='outbound'
   AND m.tenant_id::text=b->>'tenant_id' AND m.contact_id::text=b->>'contact_id' AND m.connector_id::text=b->>'connector_id'
   AND m.subject IS NOT DISTINCT FROM b->>'subject' AND m.body_html IS NOT DISTINCT FROM b->>'body_html'
   AND m.recipients->0->>'address' IS NOT DISTINCT FROM b->>'recipient'
   AND coalesce(c.active=true AND c.status='active' AND c.channel_type='email' AND c.provider=b->>'provider'
    AND lower(btrim(c.from_address))=b->>'from_address',false)
   AND coalesce(c.mailbox_class='shared_support'
     OR (c.mailbox_class='personal' AND c.mailbox_owner_user_id=(b->>'actor_user_id')::uuid),false)
   AND (b->>'provider' IS DISTINCT FROM 'sendgrid' OR public._comms_email_sendgrid_sender_verified(m.tenant_id,b->>'from_address'))
   AND (agreement_source IS NOT NULL OR EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.tenant_id=m.tenant_id AND cm.client_id=m.contact_id
    AND cm.kind='email' AND lower(btrim(cm.value))=b->>'recipient')))
  || CASE WHEN agreement_source IS NOT NULL THEN jsonb_build_object('agreement_source',agreement_source) ELSE '{}'::jsonb END;
END $$;

CREATE OR REPLACE FUNCTION public.claim_comms_email_send(_message_id uuid,_operation_id uuid,_reconcile boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb; facts jsonb; attempts int;
 discovered jsonb; approval uuid; origin uuid;
BEGIN
 -- Discover without locks, then acquire actor -> PPA -> action -> message. Never enter through
 -- read_binding here: its connector lock belongs after origin/message in admission transactions.
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 discovered:=m.meta->'comms_email_binding';
 IF discovered IS NULL OR _operation_id IS NULL OR discovered->>'operation_id' IS DISTINCT FROM _operation_id::text THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CLAIM_INVALID' USING ERRCODE='22023';
 END IF;
 PERFORM public._comms_email_actor((discovered->>'actor_user_id')::uuid,m.tenant_id);
 -- Preserve actor -> original agreement/Work -> message. Never acquire the
 -- agreement for the first time after locking its child message.
 IF discovered#>>'{governance,purpose}'='agreement_signature_request' THEN
  PERFORM private.e04_agreement_email_binding(discovered,discovered->>'state' IN ('prepared','dispatching'));
 END IF;
 IF discovered->>'approval_id' IS NOT NULL AND discovered->>'state'='prepared' THEN
  BEGIN approval:=(discovered->>'approval_id')::uuid; origin:=(discovered->>'origin_action_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN approval:=NULL; origin:=NULL; END;
  PERFORM 1 FROM public.paige_pending_approvals WHERE id=approval FOR UPDATE;
  PERFORM 1 FROM public.paige_actions WHERE id=origin FOR UPDATE;
 END IF;
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE;
 b:=m.meta->'comms_email_binding';
 IF b IS NULL OR _operation_id IS NULL OR b->>'operation_id' IS DISTINCT FROM _operation_id::text
  OR (b-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason'])
   IS DISTINCT FROM (discovered-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason']) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CLAIM_INVALID' USING ERRCODE='22023';
 END IF;
 facts:=public.read_comms_email_send_binding(_message_id);
 IF b->>'state'='prepared' AND coalesce((b->>'attempts')::int,0)<>0 THEN
  RETURN jsonb_build_object('state','prepared','attempts',(b->>'attempts')::int,'admitted',false);
 END IF;
 IF b->>'approval_id' IS NOT NULL AND b->>'state'='prepared'
  AND coalesce((b->>'attempts')::int,0)=0 AND facts->'origin_eligible' IS DISTINCT FROM 'true'::jsonb THEN
  -- Known not admitted. Only the existing service finalizer writes the refusal/Rail. A JWT
  -- cancellation itself never writes a bound message or changes auth.uid(). No identity backfill.
  PERFORM public.finalize_comms_email_send(_message_id,_operation_id,'refused',NULL,'origin_not_sendable',NULL);
  RETURN jsonb_build_object('state','refused','attempts',0,'admitted',false);
 END IF;
 -- Serialize admission of identical content across distinct operations (each locks only its own
 -- row above), then refuse while another identical send is in flight or of unknown outcome.
 PERFORM pg_advisory_xact_lock(hashtextextended(m.tenant_id::text||E'\n'||coalesce(b->>'recipient','')||E'\n'||coalesce(b->>'content_digest',''),32848));
 IF facts->'eligible' IS DISTINCT FROM 'true'::jsonb
  OR NOT (CASE WHEN coalesce(_reconcile,false) THEN public._comms_email_reconcilable(b) ELSE b->>'state'='prepared' END)
  OR EXISTS (SELECT 1 FROM public.messages o WHERE o.tenant_id=m.tenant_id AND o.id<>m.id AND o.meta ? 'comms_email_binding'
   AND o.meta#>>'{comms_email_binding,recipient}'=b->>'recipient' AND o.meta#>>'{comms_email_binding,content_digest}'=b->>'content_digest'
   AND o.meta#>>'{comms_email_binding,state}' IN ('dispatching','unknown')) THEN
  -- Not admitted. The row may ALREADY read 'dispatching' (a concurrent winner just claimed it), so
  -- the reply must say so explicitly: send-message dispatches only on admitted=true.
  RETURN jsonb_build_object('state',b->>'state','attempts',coalesce((b->>'attempts')::int,0),'admitted',false);
 END IF;
 attempts:=coalesce((b->>'attempts')::int,0)+1;
 UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding}',
   b||jsonb_build_object('state','dispatching','attempts',attempts,'claimed_at',now())),error=NULL
  WHERE id=m.id;
 RETURN jsonb_build_object('state','dispatching','attempts',attempts,'admitted',true);
END $$;
COMMIT;
