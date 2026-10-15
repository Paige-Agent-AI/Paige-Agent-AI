-- E03: opted-in business form inquiries join the existing Messages -> Threads projection.
-- No mailbox, provider, scheduler, approval store or historical backfill is introduced.
-- Created with CLI 2.109.1 as 20261014223525, then renamed above the verified applied
-- frontier 20271101142133. Never rename an applied migration. Apply before the processor.

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS form_submission_id uuid;
COMMENT ON COLUMN public.messages.form_submission_id IS
  'E03 canonical form inquiry identity. Logical source reference retained if the original form is deleted; unique, service-authored and immutable. Not a second message store.';
CREATE UNIQUE INDEX IF NOT EXISTS messages_form_submission_once
  ON public.messages(form_submission_id) WHERE form_submission_id IS NOT NULL;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_channel_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_channel_type_check
  CHECK (channel_type IN ('email','sms','whatsapp','instagram','facebook','voice','form'));
ALTER TABLE public.messages ADD CONSTRAINT messages_form_inbound_only CHECK (
  (channel_type = 'form') = (form_submission_id IS NOT NULL)
  AND (channel_type <> 'form' OR (
    direction = 'inbound' AND status IN ('received','read') AND connector_id IS NULL
    AND provider_message_id IS NULL AND action_id IS NULL AND body_html IS NULL
    AND attachments = '[]'::jsonb
  ))
);

CREATE FUNCTION public._growth_form_message_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.form_submission_id IS NOT NULL THEN
    IF (to_jsonb(NEW) - ARRAY['status','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN
      RAISE EXCEPTION 'FORM_INQUIRY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.form_submission_id IS NOT NULL OR NEW.channel_type = 'form' THEN
    IF current_user <> 'service_role' THEN
      RAISE EXCEPTION 'FORM_INQUIRY_PROCESSOR_ONLY' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._growth_form_message_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_growth_form_message_guard BEFORE INSERT OR UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public._growth_form_message_guard();

-- Invoker, service-only. The native processor supplies labelled answers (identity numbers
-- already excluded by labelledAnswers), not a raw payload or browser-authored tenant/contact.
CREATE FUNCTION public.growth_record_form_inquiry(_submission_id uuid, _submitted_email text, _body_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  submission public.growth_form_submissions;
  form public.growth_forms;
  contact public.clients;
  email text;
  message_id uuid;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'FORM_INQUIRY_PROCESSOR_ONLY' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO submission FROM public.growth_form_submissions WHERE id = _submission_id FOR UPDATE;
  IF submission.id IS NULL THEN RAISE EXCEPTION 'FORM_INQUIRY_SUBMISSION_MISSING' USING ERRCODE = '22023'; END IF;
  SELECT * INTO form FROM public.growth_forms WHERE id = submission.form_id AND tenant_id = submission.tenant_id FOR SHARE;
  IF form.id IS NULL THEN RAISE EXCEPTION 'FORM_INQUIRY_WORKSPACE_MISMATCH' USING ERRCODE = '42501'; END IF;
  IF form.lead_reply_enabled IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok', false, 'reason', 'form_not_opted_in'); END IF;
  SELECT id INTO message_id FROM public.messages WHERE form_submission_id = submission.id;
  IF message_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'message_id', message_id, 'replayed', true); END IF;
  SELECT * INTO contact FROM public.clients WHERE id = submission.contact_id AND tenant_id = submission.tenant_id FOR SHARE;
  IF contact.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_contact'); END IF;
  -- Same primary-email source as the governed email door. A phone match must never
  -- attribute a stranger's typed email/inquiry to this existing client's history.
  SELECT lower(btrim(cm.value)) INTO email FROM public.client_contact_methods cm
    WHERE cm.tenant_id = submission.tenant_id AND cm.client_id = contact.id AND cm.kind = 'email' AND cm.is_primary
    ORDER BY cm.position ASC, cm.created_at ASC LIMIT 1;
  IF email IS NULL OR email IS DISTINCT FROM lower(btrim(_submitted_email)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'submitted_email_not_contact_email');
  END IF;
  IF _body_text IS NULL OR btrim(_body_text) = '' OR length(_body_text) > 10000 THEN
    RAISE EXCEPTION 'FORM_INQUIRY_CONTENT_INVALID' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.messages (
    tenant_id, contact_id, thread_key, channel_type, direction, status,
    sender, subject, body_text, sent_at, form_submission_id
  ) VALUES (
    submission.tenant_id, contact.id, 'contact:' || submission.tenant_id::text || ':' || contact.id::text,
    'form', 'inbound', 'received',
    jsonb_build_object('address', email, 'display_name', concat_ws(' ',contact.first_name,contact.last_name)),
    'Form inquiry: ' || left(coalesce(nullif(btrim(form.name),''),'Website form'),180),
    _body_text, submission.created_at, submission.id
  ) RETURNING id INTO message_id;
  -- Existing trg_messages_tenant derives the tenant; existing trg_messages_upsert_thread
  -- creates/wakes the one contact thread and increments unread exactly once.
  RETURN jsonb_build_object('ok', true, 'message_id', message_id, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.growth_record_form_inquiry(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.growth_record_form_inquiry(uuid,text,text) TO service_role;
