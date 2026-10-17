-- E09 Communications + Support: the customer <-> business human thread lives in the ONE
-- canonical inbox (public.messages / public.threads) as channel 'portal'. No second inbox.
-- Customer rows are written only by client_portal_send_message (auth-subject-bound relationship);
-- business replies only by comms_portal_reply (current-workspace business admin). Portal rows never
-- touch a provider: inbound is 'received', outbound is 'delivered' to the portal store, so the
-- provider-execution queue trigger (queued/sent only) is never engaged. Private Cura history
-- (paige_chat_threads) is NOT copied here. Viewing is never recorded as 'read'.
BEGIN;

ALTER TABLE public.messages DROP CONSTRAINT messages_channel_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_channel_type_check
  CHECK (channel_type = ANY (ARRAY['email','sms','whatsapp','instagram','facebook','voice','portal']));

-- Structural shape of a portal row, whatever writes it (including service role).
ALTER TABLE public.messages ADD CONSTRAINT messages_portal_shape CHECK (
  channel_type <> 'portal' OR (
    contact_id IS NOT NULL AND connector_id IS NULL AND provider_message_id IS NULL
    AND jsonb_typeof(meta->'portal') = 'object'
    AND (meta #>> '{portal,request_id}') IS NOT NULL
    AND ((direction = 'inbound' AND status = 'received' AND meta #>> '{portal,author_role}' = 'customer')
      OR (direction = 'outbound' AND status = 'delivered' AND meta #>> '{portal,author_role}' = 'business'))
  ));

-- One row per caller-supplied request: a retried send never duplicates.
CREATE UNIQUE INDEX messages_portal_request
  ON public.messages ((meta #>> '{portal,request_id}'))
  WHERE channel_type = 'portal';

CREATE OR REPLACE FUNCTION public._portal_message_body(p_body text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT CASE WHEN length(btrim(coalesce(p_body,''))) BETWEEN 1 AND 4000 THEN btrim(p_body) END $$;
REVOKE ALL ON FUNCTION public._portal_message_body(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_send_message(
  p_body text, p_request_id uuid, p_kind text DEFAULT 'message', p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client public.clients%ROWTYPE;
  _client_id uuid;
  _body text := public._portal_message_body(p_body);
  _existing public.messages%ROWTYPE;
  _row public.messages%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_REQUIRED'); END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('message','help') THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_KIND'); END IF;
  IF _body IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_BODY'); END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_RELATIONSHIP'); END IF;
  -- Serialize against access changes and re-prove the relationship under the lock.
  SELECT c.* INTO _client FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active'
  FOR SHARE OF c, t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_RELATIONSHIP'); END IF;

  SELECT * INTO _existing FROM public.messages
  WHERE channel_type = 'portal' AND meta #>> '{portal,request_id}' = p_request_id::text;
  IF FOUND THEN
    IF _existing.tenant_id = _client.tenant_id AND _existing.contact_id = _client.id
      AND _existing.direction = 'inbound' AND _existing.meta #>> '{portal,author_user_id}' = _uid::text
      AND _existing.body_text = _body AND _existing.meta #>> '{portal,kind}' = p_kind THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'message_id', _existing.id, 'created_at', _existing.created_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
  END IF;

  BEGIN
    INSERT INTO public.messages (tenant_id, thread_key, contact_id, channel_type, direction, status,
      sender, recipients, subject, body_text, meta, sent_at)
    VALUES (_client.tenant_id, 'contact:' || _client.tenant_id::text || ':' || _client.id::text, _client.id,
      'portal', 'inbound', 'received',
      jsonb_build_object('kind', 'customer', 'name', nullif(btrim(concat_ws(' ', _client.first_name, _client.last_name)), '')),
      '[]'::jsonb, CASE WHEN p_kind = 'help' THEN 'Help request' END, _body,
      jsonb_build_object('portal', jsonb_build_object('request_id', p_request_id, 'author_user_id', _uid,
        'author_role', 'customer', 'kind', p_kind)),
      now())
    RETURNING * INTO _row;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent retry of the same request won the insert; answer from its row.
    SELECT * INTO _existing FROM public.messages
    WHERE channel_type = 'portal' AND meta #>> '{portal,request_id}' = p_request_id::text;
    IF FOUND AND _existing.contact_id = _client.id AND _existing.meta #>> '{portal,author_user_id}' = _uid::text
      AND _existing.body_text = _body AND _existing.meta #>> '{portal,kind}' = p_kind THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'message_id', _existing.id, 'created_at', _existing.created_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
  END;
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'message_id', _row.id, 'created_at', _row.created_at);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_send_message(text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_send_message(text, uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.client_portal_conversation(
  p_tenant_id uuid DEFAULT NULL, p_before timestamptz DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  _rows jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client_id AND c.linked_user_id = _uid;
  -- Explicit allowlist: portal rows of THIS relationship only. Email/SMS/voice history, provider
  -- identifiers, staff identities and internal metadata are never projected to the customer.
  SELECT coalesce(jsonb_agg(m.item ORDER BY m.created_at DESC, m.id DESC), '[]'::jsonb) INTO _rows
  FROM (
    SELECT x.created_at, x.id, jsonb_build_object(
      'id', x.id,
      'author', CASE WHEN x.direction = 'inbound' THEN 'customer' ELSE 'business' END,
      'kind', coalesce(x.meta #>> '{portal,kind}', 'message'),
      'body', x.body_text,
      'created_at', x.created_at) AS item
    FROM public.messages x
    WHERE x.channel_type = 'portal' AND x.tenant_id = _tenant AND x.contact_id = _client_id
      AND (p_before IS NULL OR x.created_at < p_before)
    ORDER BY x.created_at DESC, x.id DESC
    LIMIT _limit
  ) m;
  RETURN jsonb_build_object('tenant_id', _tenant, 'messages', _rows, 'has_more', jsonb_array_length(_rows) = _limit);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_conversation(uuid, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_conversation(uuid, timestamptz, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.comms_portal_reply(
  p_tenant_id uuid, p_contact_id uuid, p_body text, p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client public.clients%ROWTYPE;
  _tenant_name text;
  _body text := public._portal_message_body(p_body);
  _existing public.messages%ROWTYPE;
  _row public.messages%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  -- The same authority that reads this inbox (messages_select): current workspace, business admin.
  IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_user_tenant_id()
    OR NOT public.is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not authorized for this business inbox' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_REQUIRED'); END IF;
  IF _body IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_BODY'); END IF;
  SELECT c.* INTO _client FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.id = p_contact_id AND c.tenant_id = p_tenant_id AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active'
  FOR SHARE OF c, t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND'); END IF;
  IF _client.linked_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'PORTAL_NOT_CONNECTED'); END IF;

  SELECT * INTO _existing FROM public.messages
  WHERE channel_type = 'portal' AND meta #>> '{portal,request_id}' = p_request_id::text;
  IF FOUND THEN
    IF _existing.tenant_id = p_tenant_id AND _existing.contact_id = _client.id AND _existing.direction = 'outbound'
      AND _existing.meta #>> '{portal,author_user_id}' = _uid::text AND _existing.body_text = _body THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'message_id', _existing.id, 'created_at', _existing.created_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
  END IF;

  SELECT t.name INTO _tenant_name FROM public.tenants t WHERE t.id = p_tenant_id;
  BEGIN
    INSERT INTO public.messages (tenant_id, thread_key, contact_id, channel_type, direction, status,
      sender, recipients, body_text, meta, sent_at)
    VALUES (p_tenant_id, 'contact:' || p_tenant_id::text || ':' || _client.id::text, _client.id,
      'portal', 'outbound', 'delivered',
      jsonb_build_object('kind', 'business', 'user_id', _uid), '[]'::jsonb, _body,
      jsonb_build_object('portal', jsonb_build_object('request_id', p_request_id, 'author_user_id', _uid,
        'author_role', 'business', 'kind', 'message')),
      now())
    RETURNING * INTO _row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO _existing FROM public.messages
    WHERE channel_type = 'portal' AND meta #>> '{portal,request_id}' = p_request_id::text;
    IF FOUND AND _existing.contact_id = _client.id AND _existing.direction = 'outbound'
      AND _existing.meta #>> '{portal,author_user_id}' = _uid::text AND _existing.body_text = _body THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'message_id', _existing.id, 'created_at', _existing.created_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
  END;
  -- In-app notice for the customer. Content stays in the portal; no provider is contacted.
  INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
  VALUES (_client.linked_user_id, 'system',
    coalesce('New message from ' || nullif(btrim(_tenant_name), ''), 'New message from your team'),
    'Open your messages to read and reply.', '/app/messages',
    jsonb_build_object('kind', 'portal_message', 'message_id', _row.id, 'tenant_id', p_tenant_id));
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'message_id', _row.id, 'created_at', _row.created_at);
END;
$$;
REVOKE ALL ON FUNCTION public.comms_portal_reply(uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comms_portal_reply(uuid, uuid, text, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.client_portal_send_message(text, uuid, text, uuid) IS
  'Customer -> business portal message (kind message|help) into the canonical inbox thread for the caller''s own relationship. Idempotent per request id; no provider.';
COMMENT ON FUNCTION public.client_portal_conversation(uuid, timestamptz, integer) IS
  'Customer-safe projection of the caller''s portal messages only. Never email/SMS/voice history, staff identity or internal metadata.';
COMMENT ON FUNCTION public.comms_portal_reply(uuid, uuid, text, uuid) IS
  'Business admin reply on the portal channel for a connected customer of the current workspace. Writes a delivered portal row and an in-app notice; no provider egress.';
COMMIT;
