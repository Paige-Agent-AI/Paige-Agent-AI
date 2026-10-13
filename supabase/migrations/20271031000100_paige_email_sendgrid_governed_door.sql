-- ============================================================================
-- Experience 03 · S3 — PAIGE Email (SendGrid) through the ONE governed one-to-one email door.
--
-- OWNER POLICY (2026-10-13): a business's PAIGE Email sends through SendGrid; Resend stays the
-- Platform Operator's own comms. Existing Resend tenant connections are NOT converted. Customers see
-- "PAIGE Email", never a provider name. This migration changes no existing row.
--
-- WHAT THIS DOES (additive only):
--   1. tenant_email_domains gains three NULLABLE SendGrid verification facts (sendgrid_domain_id,
--      sendgrid_status, sendgrid_verified_at; default NULL). Every existing row reads NULL = "not
--      verified for SendGrid". Resend columns, statuses and triggers are untouched.
--   2. guard_tenant_email_domain_sendgrid_facts: ONLY the verification service (service role, or a
--      non-JWT context such as a migration) may write those facts. tenant_email_domains is FOR ALL to a
--      workspace admin under RLS, so without this an admin could forge "verified" and send as any
--      domain through the platform SendGrid credential. Moving a row to a different domain or business
--      clears the facts (a verified a.example cannot be renamed into a "verified" b.example).
--   3. _comms_email_sendgrid_sender_verified(tenant, from_address): the one SQL answer to "may this
--      business send as this From through SendGrid?" — its own domain row, sendgrid_status='verified',
--      a SendGrid domain id and a verification time.
--   4. prepare_comms_email_send: identical to 20270597000000 except the provider allow-list adds
--      'sendgrid', and a SendGrid sender must pass (3) (COMMS_EMAIL_SENDER_UNVERIFIED, 42501).
--   5. read_comms_email_send_binding: identical except a SendGrid binding is `eligible` only while (3)
--      still holds, so a domain whose verification lapses between approval and send is refused.
--   6. ONE SEND PER REPLY APPROVAL (Experience 03 round-3 security H1/M1, verifier MAJOR-1/2). The door
--      (comms-email-command) carries the drafted reply's approval in its server-built governance record
--      (_governance.approval_id). prepare_comms_email_send stores it on the binding
--      (comms_email_binding.approval_id, lowercased), so it is part of what the operation is: a replay of
--      the same operation naming a different approval (or dropping/adding one) is
--      COMMS_EMAIL_REPLAY_MISMATCH. Before preparing, it locks the approval row and refuses:
--        * COMMS_EMAIL_APPROVAL_INVALID (42501) — not this business's owner.lead_followup
--          approval whose action points back at it and is for THIS contact;
--        * COMMS_EMAIL_APPROVAL_ALREADY_SENT (55000) — the approval is approved/sent, or a send prepared for
--          it (or cited on it) was already accepted by the provider;
--        * COMMS_EMAIL_APPROVAL_SEND_IN_PROGRESS (55000) — a send prepared for it (or cited on it) is still
--          prepared/dispatching/unknown;
--        * COMMS_EMAIL_APPROVAL_NOT_PENDING (55000) — declined/skipped/escalated.
--      messages_comms_email_approval_live (UNIQUE on lower(binding.approval_id) while the binding is not
--      failed/refused) makes "one live send per approval" hold under concurrency too; a collision is
--      reported as COMMS_EMAIL_APPROVAL_SEND_IN_PROGRESS. A failed or refused send leaves the index, so the
--      owner can send again. Sends that name no approval are unchanged (approval_id NULL, never indexed).
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE (§13 — the honest SendGrid outcome contract):
--   * finalize_comms_email_send is unchanged and provider-agnostic: 'provider_accepted' needs the
--     provider's receipt id (SendGrid's X-Message-Id). HTTP 202 is provider ACCEPTANCE, never delivery
--     (delivery_confirmed stays false; messages.status 'sent' means handed to the provider).
--   * _comms_email_reconcilable is unchanged: it admits ONLY provider 'resend' (whose Idempotency-Key
--     replays the original send). SendGrid's v3 Mail Send has no idempotency replay and no free
--     per-message status API, so a SendGrid operation whose outcome is 'unknown' is NEVER re-dispatched
--     by reconcile. It stays 'unknown' (and, for a lead reply, keeps its approval at
--     COMMS_EMAIL_APPROVAL_SEND_IN_PROGRESS — item 6) until it is settled. The only automatic settle
--     path is the receipts migration (20271031000200, ingest_sendgrid_receipt →
--     _sendgrid_apply_governed_receipt): an unknown/dispatching SendGrid binding is correlated to a
--     signature-verified Event Webhook event ONLY when the event's custom_args paige_tenant_id,
--     paige_operation_id and paige_message_id ALL match the binding exactly, plus the recipient — the
--     triple send-message sets on every governed SendGrid send — and only then is SendGrid's message id
--     stored. Nothing here settles it, and an event that matches by fewer claims settles nothing.
--     (§13: this header previously said "a correlated webhook settles it" while the receipt step only
--     matched a stored provider id, which an unknown send never has; the custom_args triple match is
--     that settle path. If it is absent from 20271031000200, the send stays unknown for a person to
--     review — never re-sent.) The identical-content guard keeps refusing the same recipient + content
--     while it is unknown — no duplicate is possible.
--   * provision_email_connector_on_verify (Resend, hardcoded 'resend') is unchanged. No SendGrid
--     connector is provisioned here: a SendGrid connector is created deliberately (operator step), and
--     even then it sends nothing until (3) holds.
--
-- §59: _comms_email_sendgrid_sender_verified is SECURITY INVOKER, service_role-only, called from the
-- two SECURITY DEFINER functions below, which keep their 20270597000000 actor/eligibility guards and
-- their service_role-only grants. The guard trigger function is not callable directly (0A000).
-- §37 producer inventory: prepare_comms_email_send → comms-email-command (via _shared/comms-email/
-- adapter.ts) only; read_comms_email_send_binding → send-message, comms-email-command, claim_comms_
-- email_send. Signatures and response shapes are unchanged; only a SendGrid row's admission changes, and
-- the binding gains approval_id (NULL for every send that names no approval — every caller but the
-- lead-reply path). Consumers of the binding read named keys; none enumerates it, so the extra key is
-- inert for them. The new refusal codes reach the door as prepare errors; the adapter's generic
-- COMMS_EMAIL_PREPARE_REFUSED is mapped back to the specific code by comms-email-command.
-- ============================================================================

-- 1 ─ SendGrid verification facts (nullable, no default, no backfill).
ALTER TABLE public.tenant_email_domains
  ADD COLUMN IF NOT EXISTS sendgrid_domain_id text,
  ADD COLUMN IF NOT EXISTS sendgrid_status text,
  ADD COLUMN IF NOT EXISTS sendgrid_verified_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_email_domains_sendgrid_status_check'
                  AND conrelid='public.tenant_email_domains'::regclass) THEN
    ALTER TABLE public.tenant_email_domains ADD CONSTRAINT tenant_email_domains_sendgrid_status_check
      CHECK (sendgrid_status IS NULL OR sendgrid_status IN ('pending','verified','failed'));
  END IF;
  -- "verified" is a complete fact or it is not one: the provider's domain id and the time it verified.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_email_domains_sendgrid_verified_complete'
                  AND conrelid='public.tenant_email_domains'::regclass) THEN
    ALTER TABLE public.tenant_email_domains ADD CONSTRAINT tenant_email_domains_sendgrid_verified_complete
      CHECK (sendgrid_status IS DISTINCT FROM 'verified'
             OR (sendgrid_verified_at IS NOT NULL AND coalesce(length(btrim(sendgrid_domain_id)),0) > 0));
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_email_domains.sendgrid_status IS
  'PAIGE Email (SendGrid) domain authentication state: NULL (never checked) | pending | verified | failed. Written only by the verification service (guard_tenant_email_domain_sendgrid_facts). Independent of the Resend `status`.';

-- 2 ─ Provenance guard: only the verification service writes SendGrid facts.
CREATE OR REPLACE FUNCTION public.guard_tenant_email_domain_sendgrid_facts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _trusted boolean := auth.uid() IS NULL OR coalesce(auth.role(), '') = 'service_role';
  _facts_written boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _facts_written := NEW.sendgrid_domain_id IS NOT NULL OR NEW.sendgrid_status IS NOT NULL OR NEW.sendgrid_verified_at IS NOT NULL;
  ELSE
    _facts_written := NEW.sendgrid_domain_id IS DISTINCT FROM OLD.sendgrid_domain_id
      OR NEW.sendgrid_status IS DISTINCT FROM OLD.sendgrid_status
      OR NEW.sendgrid_verified_at IS DISTINCT FROM OLD.sendgrid_verified_at;
  END IF;
  IF _facts_written AND NOT _trusted THEN
    RAISE EXCEPTION 'PAIGE_EMAIL_VERIFICATION_PROTECTED: the sending domain''s verification can only be recorded by the verification service'
      USING ERRCODE = '42501';
  END IF;
  -- A verification belongs to one domain of one business. Re-pointing the row clears it, unless the
  -- trusted verification service is recording the new domain's facts in this same write.
  IF TG_OP = 'UPDATE' AND NOT _facts_written
     AND (lower(NEW.domain) IS DISTINCT FROM lower(OLD.domain) OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    NEW.sendgrid_domain_id := NULL;
    NEW.sendgrid_status := NULL;
    NEW.sendgrid_verified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_tenant_email_domain_sendgrid_facts() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_domain_sendgrid_facts ON public.tenant_email_domains;
CREATE TRIGGER trg_guard_domain_sendgrid_facts
  BEFORE INSERT OR UPDATE ON public.tenant_email_domains
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_email_domain_sendgrid_facts();

-- 3 ─ The one SQL answer: may this business send as this From through SendGrid?
CREATE OR REPLACE FUNCTION public._comms_email_sendgrid_sender_verified(_tenant uuid, _from_address text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    _tenant IS NOT NULL
    AND lower(btrim(_from_address)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    AND EXISTS (
      SELECT 1 FROM public.tenant_email_domains d
       WHERE d.tenant_id = _tenant
         AND lower(btrim(d.domain)) = split_part(lower(btrim(_from_address)), '@', 2)
         AND d.sendgrid_status = 'verified'
         AND d.sendgrid_verified_at IS NOT NULL
         AND coalesce(length(btrim(d.sendgrid_domain_id)), 0) > 0),
    false)
$$;
REVOKE ALL ON FUNCTION public._comms_email_sendgrid_sender_verified(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._comms_email_sendgrid_sender_verified(uuid, text) TO service_role;

-- 6 ─ One live send per reply approval (see header). No production binding carries approval_id
-- (read 2026-10-13: 35 messages, 6 bindings, 0 with approval_id), so the build cannot collide; the
-- check still fails the deploy loudly, with the reason, if one ever does (§13), and deletes nothing.
DO $$
DECLARE _dupes int;
BEGIN
 IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='messages_comms_email_approval_live') THEN RETURN; END IF;
 SELECT count(*) INTO _dupes FROM (
  SELECT 1 FROM public.messages
   WHERE meta ? 'comms_email_binding' AND meta#>>'{comms_email_binding,approval_id}' IS NOT NULL
     AND coalesce(meta#>>'{comms_email_binding,state}','') NOT IN ('failed','refused')
   GROUP BY lower(meta#>>'{comms_email_binding,approval_id}') HAVING count(*)>1) d;
 IF _dupes>0 THEN
  RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_DUPLICATES: % approval(s) already have more than one live governed send; resolve them before this index can be created',_dupes
   USING ERRCODE='23505';
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS messages_comms_email_approval_live
 ON public.messages ((lower(meta#>>'{comms_email_binding,approval_id}')))
 WHERE meta ? 'comms_email_binding' AND meta#>>'{comms_email_binding,approval_id}' IS NOT NULL
   AND coalesce(meta#>>'{comms_email_binding,state}','') NOT IN ('failed','refused');

COMMENT ON INDEX public.messages_comms_email_approval_live IS
 'Experience 03: at most one live (not failed/refused) governed email send per drafted-reply approval (comms_email_binding.approval_id). A failed or refused send leaves the index so the owner can send again.';

-- 4 ─ prepare_comms_email_send: 20270597000000 verbatim + the SendGrid admission + (6) (see header).
CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_contact_id uuid,_recipient text,_connector_id uuid,_from_address text,_subject text,_body_text text,_body_html text,_content_digest text,_command jsonb,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
 _uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 _approval text; ap public.paige_pending_approvals%ROWTYPE; _act public.paige_actions%ROWTYPE;
 _live text; _cited text; _constraint text;
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
  RETURN jsonb_build_object('ok',true,'replayed',true,'state',b->>'state','message_id',m.id);
 END IF;

 -- The command is the canonical approved shape; its fields must be the ones being prepared.
 IF _command IS NULL OR jsonb_typeof(_command)<>'object' OR _command->>'action' IS DISTINCT FROM 'comms.email_send'
  OR _command->>'contact_id' IS DISTINCT FROM _contact_id::text OR _command->>'subject' IS DISTINCT FROM _subject
  OR _command->>'body' IS DISTINCT FROM _body_text
  OR (_command->>'connector_id' IS NOT NULL AND _command->>'connector_id' IS DISTINCT FROM _connector_id::text) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023';
 END IF;

 PERFORM 1 FROM public.clients WHERE id=_contact_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTACT_NOT_IN_WORKSPACE' USING ERRCODE='42501'; END IF;
 IF _recipient IS NULL OR _recipient IS DISTINCT FROM lower(btrim(_recipient)) OR length(_recipient)>320
  OR NOT EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.tenant_id=_expected_tenant_id AND cm.client_id=_contact_id
   AND cm.kind='email' AND lower(btrim(cm.value))=_recipient) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_RECIPIENT_CHANGED' USING ERRCODE='40001';
 END IF;

 SELECT * INTO c FROM public.channel_connectors WHERE id=_connector_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF c.id IS NULL OR c.active IS DISTINCT FROM true OR c.status IS DISTINCT FROM 'active' OR c.channel_type IS DISTINCT FROM 'email'
  OR c.provider IS NULL OR c.provider NOT IN ('resend','gmail','smtp','sendgrid') OR coalesce(length(btrim(c.from_address)),0)=0
  OR _from_address IS NULL OR lower(btrim(c.from_address)) IS DISTINCT FROM lower(btrim(_from_address)) THEN
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

 -- (6) One live send per reply approval. The approval row is locked, so two confirms of different
 -- operations for the same reply serialize here; the second sees the first's send and is refused.
 IF _approval IS NOT NULL THEN
  SELECT * INTO ap FROM public.paige_pending_approvals WHERE id=_approval::uuid FOR UPDATE;
  IF ap.id IS NOT NULL AND btrim(ap.metadata->>'action_id') ~* _uuid THEN
   SELECT * INTO _act FROM public.paige_actions a
    WHERE a.id=lower(btrim(ap.metadata->>'action_id'))::uuid AND a.approval_id=ap.id AND a.tenant_id=ap.tenant_id;
  END IF;
  IF ap.id IS NULL OR ap.tenant_id IS DISTINCT FROM _expected_tenant_id
   OR _act.id IS NULL OR _act.action_kind IS DISTINCT FROM 'owner.lead_followup' OR _act.contact_id IS DISTINCT FROM _contact_id
   OR (ap.contact_id IS NOT NULL AND ap.contact_id IS DISTINCT FROM _contact_id) THEN
   RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_INVALID' USING ERRCODE='42501';
  END IF;
  IF ap.status IN ('approved','sent') THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_ALREADY_SENT' USING ERRCODE='55000'; END IF;
  IF ap.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_NOT_PENDING' USING ERRCODE='55000'; END IF;
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
  'finalized_at',NULL,'provider_message_id',NULL,'outcome_reason',NULL,'approval_id',_approval);
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

-- 5 ─ read_comms_email_send_binding: 20270597000000 verbatim + the SendGrid eligibility re-check.
CREATE OR REPLACE FUNCTION public.read_comms_email_send_binding(_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 b:=m.meta->'comms_email_binding'; IF b IS NULL THEN RETURN NULL; END IF;
 PERFORM public._comms_email_actor((b->>'actor_user_id')::uuid,m.tenant_id);
 SELECT * INTO c FROM public.channel_connectors WHERE id=m.connector_id AND tenant_id=m.tenant_id;
 RETURN b||jsonb_build_object('message_id',m.id,'tenant_id',m.tenant_id,'channel_type',m.channel_type,'message_status',m.status,
  'eligible',m.channel_type='email' AND m.direction='outbound'
   AND m.tenant_id::text=b->>'tenant_id' AND m.contact_id::text=b->>'contact_id' AND m.connector_id::text=b->>'connector_id'
   AND m.subject IS NOT DISTINCT FROM b->>'subject' AND m.body_html IS NOT DISTINCT FROM b->>'body_html'
   AND m.recipients->0->>'address' IS NOT DISTINCT FROM b->>'recipient'
   AND coalesce(c.active=true AND c.status='active' AND c.channel_type='email' AND c.provider=b->>'provider'
    AND lower(btrim(c.from_address))=b->>'from_address',false)
   AND (b->>'provider' IS DISTINCT FROM 'sendgrid' OR public._comms_email_sendgrid_sender_verified(m.tenant_id,b->>'from_address'))
   AND EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.tenant_id=m.tenant_id AND cm.client_id=m.contact_id
    AND cm.kind='email' AND lower(btrim(cm.value))=b->>'recipient'));
END $$;

REVOKE ALL ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.read_comms_email_send_binding(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_comms_email_send_binding(uuid) TO service_role;
