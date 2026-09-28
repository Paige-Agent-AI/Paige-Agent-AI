-- Every place the database recognises or creates a contact from an address now reads and writes
-- contact methods (20270515000000), so a client writing from their second address is the SAME
-- client, and a contact is never created twice for one address.
--
--   resolve_contact_id            inbound attribution: any email, or any phone by its last ten digits
--   create_and_attach_conversation compose: resolve by any address, else create with it
--   create_contact_v2             dedupe on any email; the race closes on the methods' unique index
--   process_zapier_skool_intake   the same, for the tenant-bound intake route
--   find_duplicate_contacts       exact-email flag matches any address; shows the primary
--   resolve_client_id_by_email    any address (its existing cross-workspace reach is unchanged —
--                                 that is recorded as its own item, not widened or narrowed here)
--   accept_tenant_invite          a consumer invite links the contact holding that address
--   execute_crm_command (merge)   the survivor keeps BOTH contacts' addresses; the resolution
--                                 chooses which one is primary; the merged contact keeps none
--
-- The small functions are recreated whole from their live definitions with only the address
-- lines changed. The two large ones are edited where they stand, the way 20270504000000 edited
-- them: read the live definition, replace named fragments, and stop if any fragment is missing.

-- migration-lint-ignore: pattern-2 -- the INSERT … SELECT sources are COALESCEd names and a creator
-- guarded by EXISTS (conversations), or addresses read from existing method rows (merge).

-- ─── resolve_contact_id ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_contact_id(p_tenant uuid, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_id     uuid;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_tenant := public.current_user_tenant_id();
    IF p_tenant IS NOT NULL AND p_tenant <> v_tenant THEN RETURN NULL; END IF;
  ELSE
    v_tenant := p_tenant;
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;

  -- The linked portal user first, then an email, then a phone — the order this always used.
  IF p_user_id IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.clients c
     WHERE c.tenant_id = v_tenant AND c.linked_user_id = p_user_id
     ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  IF NULLIF(btrim(p_email), '') IS NOT NULL THEN
    v_id := public.client_id_for_address(v_tenant, 'email', p_email);
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  IF length(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g')) >= 10 THEN
    v_id := public.client_id_for_address(v_tenant, 'phone', p_phone);
  END IF;
  RETURN v_id;
END $function$;

-- ─── create_and_attach_conversation ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_and_attach_conversation(p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_channel text DEFAULT 'email'::text, p_tenant_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(contact_id uuid, thread_id uuid, thread_key text, was_existing boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller  uuid := auth.uid();
  _tenant  uuid := CASE WHEN _caller IS NULL THEN COALESCE(p_tenant_id, public.current_user_tenant_id())
                        ELSE public.current_user_tenant_id() END;
  _email   text := lower(NULLIF(btrim(p_email), ''));
  _phone_digits text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
  _channel text := lower(COALESCE(NULLIF(btrim(p_channel), ''), 'email'));
  _cid     uuid;
  _tid     uuid;
  _tkey    text;
  _thread_existed boolean := false;
  _creator uuid;
BEGIN
  IF _caller IS NOT NULL AND NOT public.has_any_role(_caller, ARRAY['admin','super_admin']) THEN
    RAISE EXCEPTION 'CONVO_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONVO_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  IF _email IS NULL AND _phone_digits IS NULL AND NULLIF(btrim(p_first_name), '') IS NULL THEN
    RAISE EXCEPTION 'CONVO_NO_IDENTITY: an email, phone, or name is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(_tenant::text || ':' || COALESCE(_email, _phone_digits, ''))
  );

  IF _email IS NOT NULL THEN
    _cid := public.client_id_for_address(_tenant, 'email', _email);
  END IF;
  IF _cid IS NULL AND _phone_digits IS NOT NULL THEN
    _cid := public.client_id_for_address(_tenant, 'phone', p_phone);
  END IF;

  IF _cid IS NULL THEN
    _creator := _caller;
    IF _creator IS NULL THEN
      SELECT owner_user_id INTO _creator FROM public.tenants WHERE id = _tenant;
    END IF;
    INSERT INTO public.clients (
      first_name, last_name,
      lifecycle_stage, source, status, created_by, tenant_id
    )
    SELECT
      COALESCE(NULLIF(btrim(p_first_name), ''), NULLIF(split_part(COALESCE(_email, ''), '@', 1), ''), 'New'),
      COALESCE(NULLIF(btrim(p_last_name), ''), 'Contact'),
      'new_lead', 'conversations', 'active', _creator, _tenant
    WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _creator)
    RETURNING id INTO _cid;

    IF _cid IS NULL THEN
      RAISE EXCEPTION 'CONVO_NO_CREATOR: could not resolve a valid creator (auth.users) for this tenant'
        USING ERRCODE = '23503';
    END IF;
    PERFORM public._attach_client_address(_tenant, _cid, 'email', p_email);
    PERFORM public._attach_client_address(_tenant, _cid, 'phone', p_phone);

    INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
    VALUES (_creator, 'client', 'create_and_attach_conversation', _cid,
            jsonb_build_object('tenant_id', _tenant, 'channel', _channel, 'via', 'conversations_compose'));
  END IF;

  -- §49 SMART-ROUTE — key on the CONTACT, not channel+counterparty. _cid is guaranteed non-null here
  -- (resolved or created-and-raised above), so a single per-contact thread serves EVERY channel. The
  -- channel argument no longer fragments; a later inbound reply on any channel coalesces into this row.
  _tkey := 'contact:' || _tenant::text || ':' || _cid::text;
  SELECT t.id INTO _tid FROM public.threads t
   WHERE t.tenant_id = _tenant AND t.thread_key = _tkey LIMIT 1;
  _thread_existed := _tid IS NOT NULL;   -- honest: only true when a real thread already exists (§13)

  contact_id   := _cid;
  thread_id    := _tid;        -- NULL when no thread exists yet; the first Send coalesces one
  thread_key   := _tkey;
  was_existing := _thread_existed;
  RETURN NEXT;
END;
$function$;

-- ─── create_contact_v2 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_contact_v2(p_first_name text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_entity_name text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_lifecycle_stage text DEFAULT 'new_lead'::text, p_source text DEFAULT 'paige'::text, p_tags text[] DEFAULT '{}'::text[], p_primary_offer text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_assigned_coach_user_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid, p_channel text DEFAULT NULL::text)
RETURNS TABLE(contact_id uuid, client_ref text, was_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _creator uuid := CASE WHEN auth.uid() IS NOT NULL THEN auth.uid() ELSE p_created_by END;
  _tenant uuid := CASE WHEN auth.uid() IS NOT NULL THEN public.current_user_tenant_id() ELSE p_tenant_id END;
  _id uuid;
  _existing uuid;
  _ref text;
  _email text := NULLIF(btrim(p_email), '');
BEGIN
  IF _creator IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_OPERATOR' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_TENANT' USING ERRCODE = '22023';
  END IF;
  IF _caller IS NOT NULL AND _creator IS DISTINCT FROM _caller THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Authenticated callers remain pinned to current_user_tenant_id(); supplied
  -- tenant and creator parameters never confer browser authority.
  IF _caller IS NOT NULL
     AND NOT public.is_platform_owner()
     AND NOT EXISTS (
       SELECT 1
       FROM public.tenant_members tm
       WHERE tm.tenant_id = _tenant
         AND tm.user_id = _caller
         AND tm.status = 'active'
         AND tm.role IN ('owner','admin')
     ) THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- The service path is actor-explicit. Re-authorize the creator/tenant pairing
  -- inside this SECURITY DEFINER boundary instead of trusting RPC parameters.
  IF _caller IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.tenant_members tm
       WHERE tm.tenant_id = _tenant
         AND tm.user_id = _creator
         AND tm.status = 'active'
         AND tm.role IN ('owner','admin')
     ) THEN
    RAISE EXCEPTION 'CONTACT_CREATOR_NOT_IN_TENANT' USING ERRCODE = '42501';
  END IF;

  -- A contact cannot be assigned to a foreign or revoked tenant seat.
  IF p_assigned_coach_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.tenant_members tm
       WHERE tm.tenant_id = _tenant
         AND tm.user_id = p_assigned_coach_user_id
         AND tm.status = 'active'
     ) THEN
    RAISE EXCEPTION 'CONTACT_COACH_NOT_IN_TENANT' USING ERRCODE = '42501';
  END IF;

  IF _email IS NOT NULL THEN
    _existing := public.client_id_for_address(_tenant, 'email', _email);
    IF _existing IS NOT NULL THEN
      SELECT account_number INTO _ref FROM public.clients WHERE id = _existing;
      contact_id := _existing;
      client_ref := _ref;
      was_created := false;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.clients (
      first_name, last_name, entity_name, title,
      lifecycle_stage, source, tags, primary_offer, current_notes,
      assigned_coach_user_id, status, created_by, tenant_id,
      created_by_channel_type
    ) VALUES (
      COALESCE(NULLIF(btrim(p_first_name), ''), NULLIF(split_part(COALESCE(_email, ''), '@', 1), ''), 'New'),
      COALESCE(NULLIF(btrim(p_last_name), ''), 'Contact'),
      NULLIF(btrim(p_entity_name), ''),
      NULLIF(btrim(p_title), ''),
      COALESCE(NULLIF(p_lifecycle_stage, ''), 'new_lead'),
      COALESCE(NULLIF(p_source, ''), 'paige'),
      COALESCE(p_tags, '{}'),
      NULLIF(btrim(p_primary_offer), ''),
      NULLIF(btrim(p_notes), ''),
      p_assigned_coach_user_id,
      'active',
      _creator,
      _tenant,
      NULLIF(btrim(p_channel), '')
    )
    RETURNING id, account_number INTO _id, _ref;
    -- Inside the block: a concurrent create of the same address loses on the methods' unique
    -- index, rolls its contact back, and returns the one that won.
    PERFORM public._attach_client_address(_tenant, _id, 'email', _email);
    PERFORM public._attach_client_address(_tenant, _id, 'phone', p_phone);
  EXCEPTION WHEN unique_violation THEN
    _existing := public.client_id_for_address(_tenant, 'email', _email);
    IF _existing IS NOT NULL THEN
      SELECT account_number INTO _ref FROM public.clients WHERE id = _existing;
      contact_id := _existing;
      client_ref := _ref;
      was_created := false;
      RETURN NEXT;
      RETURN;
    END IF;
    RAISE;
  END;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (
    _creator,
    'client',
    'create_contact',
    _id,
    jsonb_build_object(
      'tenant_id', _tenant,
      'source', p_source,
      'channel', p_channel
    )
  );

  contact_id := _id;
  client_ref := _ref;
  was_created := true;
  RETURN NEXT;
  RETURN;
END;
$function$;

-- ─── process_zapier_skool_intake ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_zapier_skool_intake(_route_token_hash text, _idempotency_key text, _payload_hash text, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE r public.tenant_zapier_intake_routes;e public.tenant_zapier_intake_events;existing public.tenant_zapier_intake_events;
 full_name text:=NULLIF(btrim(COALESCE(_payload->>'member_name',_payload->>'name','')),'');
 first_name text;last_name text;email text:=NULLIF(btrim(lower(COALESCE(_payload->>'email',''))),'');phone text:=NULLIF(btrim(COALESCE(_payload->>'phone','')),'');contact uuid;outcome text;operator_id uuid;
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'ZAPIER_INTAKE_SERVICE_ONLY' USING ERRCODE='42501';END IF;
 IF NULLIF(_route_token_hash,'') IS NULL OR NULLIF(_idempotency_key,'') IS NULL OR length(_idempotency_key)>180 OR NULLIF(_payload_hash,'') IS NULL THEN RAISE EXCEPTION 'ZAPIER_INTAKE_INVALID';END IF;
 SELECT * INTO r FROM public.tenant_zapier_intake_routes WHERE route_token_hash=_route_token_hash AND enabled FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'ZAPIER_INTAKE_ROUTE_NOT_FOUND' USING ERRCODE='42501';END IF;
 SELECT * INTO existing FROM public.tenant_zapier_intake_events WHERE tenant_id=r.tenant_id AND route_id=r.id AND idempotency_key=_idempotency_key FOR UPDATE;
 SELECT tm.user_id INTO operator_id FROM public.tenant_members tm
  WHERE tm.tenant_id=r.tenant_id AND tm.status='active' AND tm.role IN ('owner','admin')
   AND public.has_any_role(tm.user_id,ARRAY['admin','super_admin'])
  ORDER BY CASE tm.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,tm.user_id
  LIMIT 1;
 IF existing.id IS NOT NULL THEN
  IF existing.payload_hash IS DISTINCT FROM _payload_hash THEN RAISE EXCEPTION 'ZAPIER_INTAKE_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';END IF;
  IF existing.status<>'failed' THEN
   PERFORM public._record_workspace_rail_event(r.tenant_id,COALESCE(operator_id,r.created_by),'zapier_skool_intake',existing.id,1,'zapier_skool_intake_duplicate');
   RETURN jsonb_build_object('ok',true,'outcome','duplicate','receipt_id',existing.id);
  END IF;
  -- A failure is only terminal when REPLAYING THE SAME PAYLOAD cannot change the answer.
  -- payload_invalid is exactly that: the key is bound to one payload hash, so the delivery
  -- that failed validation will fail it again. Report it and stop.
  IF existing.failure_code IS DISTINCT FROM 'contact_write_failed' THEN
   PERFORM public._record_workspace_rail_event(r.tenant_id,COALESCE(operator_id,r.created_by),'zapier_skool_intake',existing.id,1,'zapier_skool_intake_failed');
   RETURN jsonb_build_object('ok',false,'outcome','failed','receipt_id',existing.id);
  END IF;
  -- contact_write_failed is NOT terminal. Its subtransaction rolled back, so nothing was
  -- written, and the causes are transient: a database error, or a moment with no eligible
  -- tenant operator to attribute the contact to. Replaying the stored failure forever would
  -- drop the lead permanently even after the condition cleared -- and Zapier's retry is the
  -- one thing that would otherwise have recovered it. Reprocess THIS receipt instead of
  -- opening a second one, so the idempotency key still owns exactly one row.
  e:=existing;
  UPDATE public.tenant_zapier_intake_events
     SET status='received',failure_code=NULL,processed_at=NULL,contact_id=NULL
   WHERE id=e.id;
 ELSE
  INSERT INTO public.tenant_zapier_intake_events(tenant_id,route_id,idempotency_key,payload_hash,payload_ct,status)
   VALUES(r.tenant_id,r.id,_idempotency_key,_payload_hash,public.platform_encrypt(_payload::text),'received') RETURNING * INTO e;
 END IF;
 IF email IS NULL AND full_name IS NULL THEN
  UPDATE public.tenant_zapier_intake_events SET status='failed',failure_code='payload_invalid',processed_at=clock_timestamp() WHERE id=e.id;
  outcome:='zapier_skool_intake_failed';
 ELSE
  first_name:=COALESCE(NULLIF(split_part(full_name,' ',1),''),NULLIF(split_part(COALESCE(email,''),'@',1),''),'New');
  last_name:=COALESCE(NULLIF(btrim(substr(COALESCE(full_name,''),length(first_name)+1)),''),'Contact');
  BEGIN
   -- Intake deduplication is tenant-bound: a member who already exists under ANY of their
   -- addresses is that contact, and the contact-methods unique index closes the
   -- concurrent-delivery window.
   IF email IS NOT NULL THEN
    contact:=public.client_id_for_address(r.tenant_id,'email',email);
   END IF;
   IF contact IS NULL THEN
    BEGIN
     -- #10 channel-of-origin: 'import', the established value for a contact that arrived
     -- from an external system (paige-bridge uses it for the same shape). 'integration' is
     -- NOT in clients_created_by_channel_type_chk (20260729020000) and would fail the check,
     -- and 'api' renders as "Paige" in CREATED_VIA_LABEL, which would credit Paige for a
     -- contact Zapier delivered. Exact provenance is already carried by source and tags.
     INSERT INTO public.clients(first_name,last_name,lifecycle_stage,source,tags,current_notes,status,created_by,tenant_id,created_by_channel_type)
     VALUES(first_name,last_name,'new_lead','zapier_skool',ARRAY['skool','zapier'],'Received through the tenant-bound Skool intake route.','active',operator_id,r.tenant_id,'import')
     RETURNING id INTO contact;
     PERFORM public._attach_client_address(r.tenant_id,contact,'email',email);
     PERFORM public._attach_client_address(r.tenant_id,contact,'phone',phone);
     INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
     VALUES(operator_id,'client','create_contact',contact,jsonb_build_object('tenant_id',r.tenant_id,'email',email,'source','zapier_skool','channel','integration'));
    EXCEPTION WHEN unique_violation THEN
     IF email IS NULL THEN RAISE;END IF;
     contact:=public.client_id_for_address(r.tenant_id,'email',email);
     IF contact IS NULL THEN RAISE;END IF;
    END;
   END IF;
   UPDATE public.tenant_zapier_intake_events SET status='processed',contact_id=contact,processed_at=clock_timestamp() WHERE id=e.id;
   outcome:='zapier_skool_intake_received';
  EXCEPTION WHEN OTHERS THEN
   UPDATE public.tenant_zapier_intake_events SET status='failed',failure_code='contact_write_failed',processed_at=clock_timestamp() WHERE id=e.id;
   outcome:='zapier_skool_intake_failed';
  END;
 END IF;
 PERFORM public._record_workspace_rail_event(r.tenant_id,COALESCE(operator_id,r.created_by),'zapier_skool_intake',e.id,0,outcome);
 RETURN jsonb_build_object('ok',outcome='zapier_skool_intake_received','outcome',CASE WHEN outcome='zapier_skool_intake_received' THEN 'processed' ELSE 'failed' END,'receipt_id',e.id);
END $function$;

-- ─── find_duplicate_contacts ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_duplicate_contacts(p_tenant_id uuid, p_first_name text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_limit integer DEFAULT 3)
RETURNS TABLE(id uuid, first_name text, last_name text, email text, phone text, entity_name text, lifecycle_stage text, source text, created_at timestamp with time zone, name_similarity real, email_exact boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT
      lower(btrim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, ''))) AS full_name,
      nullif(btrim(lower(p_email)), '') AS email_norm
  )
  SELECT
    c.id, c.first_name, c.last_name,
    (SELECT m.value FROM public.client_contact_methods m WHERE m.client_id = c.id AND m.kind = 'email' AND m.is_primary LIMIT 1),
    (SELECT m.value FROM public.client_contact_methods m WHERE m.client_id = c.id AND m.kind = 'phone' AND m.is_primary LIMIT 1),
    c.entity_name, c.lifecycle_stage, c.source, c.created_at,
    similarity(
      lower(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
      params.full_name
    ) AS name_similarity,
    (params.email_norm IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.client_contact_methods m
       WHERE m.client_id = c.id AND m.kind = 'email' AND m.match_key = params.email_norm)) AS email_exact
  FROM public.clients c, params
  WHERE c.tenant_id = p_tenant_id   -- §9: hard tenant scope; caller cannot widen it
    AND (
      (
        params.full_name <> ''
        -- `%` is index-accelerated (uses idx_clients_fullname_trgm); similarity()>0.6
        -- refines it to a strong match (see header note 2).
        AND lower(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) % params.full_name
        AND similarity(
              lower(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
              params.full_name
            ) > 0.6
      )
      OR (params.email_norm IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.client_contact_methods m
         WHERE m.client_id = c.id AND m.kind = 'email' AND m.match_key = params.email_norm))
    )
  ORDER BY email_exact DESC, name_similarity DESC, c.created_at ASC
  LIMIT greatest(1, least(coalesce(p_limit, 3), 10));
$function$;

-- ─── resolve_client_id_by_email ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_client_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT m.client_id
    FROM public.client_contact_methods m
    JOIN public.clients c ON c.id = m.client_id
   WHERE m.kind = 'email'
     AND m.match_key = public.contact_method_match_key('email', _email)
   ORDER BY c.created_at ASC LIMIT 1;
$function$;

-- ─── merge: move addresses, then resolve the primary ────────────────────────────────────────
-- The survivor keeps every address of both contacts. `_email_from_loser` / `_phone_from_loser`
-- carry the merge resolution: when true, the losing contact's primary becomes the survivor's
-- primary. A survivor with no address of a kind takes the loser's primary either way.
CREATE FUNCTION public._merge_client_contact_methods(_tenant_id uuid, _survivor uuid, _loser uuid, _email_from_loser boolean, _phone_from_loser boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _kind text;
  _moved jsonb;
  _loser_primary text;
  _survivor_had boolean;
  _base integer;
  _from_loser boolean;
BEGIN
  FOREACH _kind IN ARRAY ARRAY['email', 'phone'] LOOP
    _from_loser := CASE _kind WHEN 'email' THEN COALESCE(_email_from_loser, false) ELSE COALESCE(_phone_from_loser, false) END;
    SELECT m.value INTO _loser_primary FROM public.client_contact_methods AS m
     WHERE m.client_id = _loser AND m.kind = _kind AND m.is_primary LIMIT 1;
    _survivor_had := EXISTS (SELECT 1 FROM public.client_contact_methods AS m WHERE m.client_id = _survivor AND m.kind = _kind);

    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', m.value, 'label', m.label) ORDER BY m.position)
      INTO _moved
      FROM public.client_contact_methods AS m
     WHERE m.client_id = _loser AND m.kind = _kind;
    DELETE FROM public.client_contact_methods AS m WHERE m.client_id = _loser AND m.kind = _kind;
    CONTINUE WHEN _moved IS NULL;

    SELECT COALESCE(max(m.position) + 1, 0) INTO _base
      FROM public.client_contact_methods AS m WHERE m.client_id = _survivor AND m.kind = _kind;
    INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, label, is_primary, position)
    SELECT _tenant_id, _survivor, _kind, e->>'value', e->>'label', false, _base + (o - 1)::int
      FROM pg_catalog.jsonb_array_elements(_moved) WITH ORDINALITY AS t(e, o)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.client_contact_methods AS m
        WHERE m.client_id = _survivor AND m.kind = _kind
          AND m.match_key = public.contact_method_match_key(_kind, e->>'value'));

    IF _loser_primary IS NOT NULL AND (_from_loser OR NOT _survivor_had) THEN
      UPDATE public.client_contact_methods AS m
         SET is_primary = (m.match_key = public.contact_method_match_key(_kind, _loser_primary))
       WHERE m.client_id = _survivor AND m.kind = _kind;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._merge_client_contact_methods(uuid, uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- ─── Edits in place: the merge and the consumer-invite link ─────────────────────────────────
CREATE FUNCTION pg_temp.replace_fragment(_def text, _from text, _to text, _what text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  _count integer := (char_length(_def) - char_length(replace(_def, _from, ''))) / greatest(char_length(_from), 1);
BEGIN
  IF _count <> 1 THEN
    RAISE EXCEPTION 'contact methods: expected exactly one "%" fragment, found %', _what, _count;
  END IF;
  RETURN replace(_def, _from, _to);
END;
$$;

DO $$
DECLARE
  _def text := pg_get_functiondef('public.execute_crm_command(uuid,uuid,jsonb,text)'::regprocedure);
BEGIN
  -- The losing contact no longer releases a single email column: every address moves.
  _def := pg_temp.replace_fragment(_def,
$f$      update public.clients set
        linked_user_id=null,
        email=case when v_transfer_email then null else email end
       where id=loser.id;$f$,
$t$      update public.clients set
        linked_user_id=null
       where id=loser.id;
      perform public._merge_client_contact_methods(_tenant_id, c.id, loser.id, v_transfer_email,
        coalesce(resolutions->>'phone'='loser', false) or (not (resolutions ? 'phone') and c.phone is null));$t$,
    'merge releases the loser email');
  -- The survivor's address columns are no longer written by the merge; they follow its methods.
  _def := pg_temp.replace_fragment(_def,
$f$        email=case when v_transfer_email then loser.email else c.email end,
        phone=case when resolutions->>'phone'='loser' or (not (resolutions ? 'phone') and c.phone is null) then loser.phone else c.phone end,
$f$,
    '',
    'merge writes survivor email and phone');
  -- Every address leaves the losing contact now, so the receipt's "loser email cleared" is true
  -- exactly when the loser held one — the same answer the preview gives below.
  _def := pg_temp.replace_fragment(_def,
    $f$v_loser_email_cleared:=v_transfer_email and loser.email is not null;$f$,
    $t$v_loser_email_cleared:=loser.email is not null;$t$,
    'merge receipt email clearing');
  EXECUTE _def;
END $$;

DO $$
DECLARE
  _def text := pg_get_functiondef('public.preview_crm_command(uuid,uuid,jsonb,text)'::regprocedure);
BEGIN
  -- The approval preview discloses what the merge will do: every loser address moves to the
  -- survivor (the resolution picks the primary), so none is discarded and the loser keeps none.
  _def := pg_temp.replace_fragment(_def,
$f$          'loser_email_cleared',c2.email is not null and coalesce(_command->'resolutions'->>'email',case when c1.email is null then 'loser' else 'survivor' end)='loser',
$f$,
$t$          'loser_email_cleared',c2.email is not null,
          'addresses_moved',(select count(*) from public.client_contact_methods cm where cm.client_id=c2.id),
$t$,
    'merge preview email clearing');
  EXECUTE _def;
END $$;

DO $$
DECLARE
  _def text := pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure);
BEGIN
  -- A consumer invite links the unlinked contact holding the invited address, whichever of that
  -- contact's addresses it is.
  _def := pg_temp.replace_fragment(_def,
$f$          WHERE tenant_id = _tok.tenant_id AND linked_user_id IS NULL
            AND email IS NOT NULL
            AND lower(email) = lower(COALESCE(_tok.email, _email))
          ORDER BY created_at ASC LIMIT 1;$f$,
$t$          WHERE tenant_id = _tok.tenant_id AND linked_user_id IS NULL
            AND EXISTS (
              SELECT 1 FROM public.client_contact_methods AS cm
               WHERE cm.client_id = clients.id AND cm.kind = 'email'
                 AND cm.match_key = public.contact_method_match_key('email', COALESCE(_tok.email, _email)))
          ORDER BY created_at ASC LIMIT 1;$t$,
    'consumer invite links by email');
  -- A contact created by accepting the invite holds the sign-in address as a method.
  _def := pg_temp.replace_fragment(_def,
$f$        INSERT INTO public.clients (tenant_id, created_by, email, first_name, last_name, linked_user_id, onboarding_stage, status, created_by_channel_type)
        VALUES (_tok.tenant_id, COALESCE(_tok.created_by, _tenant_owner, _uid), _email, _first, _last, _uid, 'invited', 'active', 'invite')
        RETURNING id INTO _client_id;$f$,
$t$        INSERT INTO public.clients (tenant_id, created_by, first_name, last_name, linked_user_id, onboarding_stage, status, created_by_channel_type)
        VALUES (_tok.tenant_id, COALESCE(_tok.created_by, _tenant_owner, _uid), _first, _last, _uid, 'invited', 'active', 'invite')
        RETURNING id INTO _client_id;
        PERFORM public._attach_client_address(_tok.tenant_id, _client_id, 'email', _email);$t$,
    'consumer invite creates a contact with email');
  EXECUTE _def;
END $$;
