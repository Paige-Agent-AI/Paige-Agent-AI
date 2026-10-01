-- Incoming contact sync belongs to the canonical connection's immutable business.
-- No backfill, credential issuance, provider call or existing grant is performed on apply.
-- Human configuration uses the existing mcp.connections.manage capability. This is NOT a
-- second chat confirmation channel: Paige cannot grant herself incoming authority.
-- The service writer locks connection -> grantor membership -> contact, and commits contacts,
-- addresses, assignment, external identity and the existing receipt together.
-- Production application requires named owner authorization. Allocated after pending 20270521000000.
BEGIN;

-- Extend the existing provenance constraint without copying legacy defaults or rewriting data.
-- Preserve its exact historical expression; only the generic connection_sync value is added.
DO $$ DECLARE prior_expression text; BEGIN
  SELECT pg_get_expr(conbin,conrelid) INTO prior_expression FROM pg_constraint
    WHERE conrelid='public.clients'::regclass AND conname='clients_mirror_source_chk';
  IF prior_expression IS NULL THEN RAISE EXCEPTION 'CONTACT_MIRROR_CONSTRAINT_MISSING'; END IF;
  ALTER TABLE public.clients DROP CONSTRAINT clients_mirror_source_chk;
  EXECUTE format('ALTER TABLE public.clients ADD CONSTRAINT clients_mirror_source_chk CHECK ((%s) OR mirror_source=%L)',
    prior_expression,'connection_sync');
END $$;

ALTER TABLE public.mcp_connections
  ADD COLUMN inbound_contacts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN inbound_contact_secret_hash text,
  ADD COLUMN inbound_contact_actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN inbound_contact_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN inbound_contact_granted_at timestamptz;

-- A relationship, not another connection/tenant/authority lookup. The connection owns scope.
ALTER TABLE public.mcp_connections ADD CONSTRAINT mcp_connections_id_tenant_key UNIQUE(connection_id,tenant_id);
CREATE TABLE public.mcp_connection_contacts (
  connection_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 255),
  client_id uuid NOT NULL,
  source_updated_at timestamptz NOT NULL,
  payload_hash text NOT NULL,
  PRIMARY KEY(connection_id, external_id),
  FOREIGN KEY(connection_id,tenant_id) REFERENCES public.mcp_connections(connection_id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY(client_id,tenant_id) REFERENCES public.clients(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX mcp_connection_contacts_client_idx ON public.mcp_connection_contacts(client_id);
ALTER TABLE public.mcp_connection_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_connection_contacts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_connection_contacts TO service_role;

CREATE UNIQUE INDEX mcp_contact_sync_receipt_once ON public.mcp_connection_receipts(connection_id, run_id)
  WHERE tool_name='paige.inbound.contacts.sync' AND detail->>'source'='connection_contact_sync';

CREATE FUNCTION public._mcp_contact_sync_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.connection_id IS DISTINCT FROM OLD.connection_id THEN
    RAISE EXCEPTION 'MCP_CONNECTION_BINDING_IMMUTABLE' USING ERRCODE='22023';
  END IF;
  -- Disconnect cannot leave a hidden incoming credential active. Re-enabling outbound does
  -- not revive it. Outbound OAuth refresh is independent and does not rotate an inbound secret.
  IF OLD.enabled AND NOT NEW.enabled THEN
    NEW.inbound_contacts_enabled := false;
    NEW.inbound_contact_secret_hash := NULL;
    NEW.inbound_contact_actor := NULL;
    NEW.inbound_contact_granted_at := NULL;
    NEW.inbound_contact_generation := OLD.inbound_contact_generation + 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._mcp_contact_sync_lifecycle() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER mcp_contact_sync_lifecycle BEFORE UPDATE ON public.mcp_connections
  FOR EACH ROW EXECUTE FUNCTION public._mcp_contact_sync_lifecycle();

CREATE FUNCTION public.get_mcp_contact_sync(_connection_id uuid, _tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE t uuid; c public.mcp_connections;
BEGIN
  t := public._mcp_resolve_tenant(_tenant_id,false);
  IF NOT ('mcp.connections.manage'=ANY(public._mcp_caller_capabilities(t,auth.uid()))) THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.mcp_connections WHERE connection_id=_connection_id AND tenant_id=t;
  IF c.connection_id IS NULL THEN RAISE EXCEPTION 'MCP_FORBIDDEN' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('connection_id',c.connection_id,'tenant_id',c.tenant_id,
    'enabled',c.enabled AND c.inbound_contacts_enabled AND
      ('mcp.connections.manage'=ANY(public._mcp_caller_capabilities(c.tenant_id,c.inbound_contact_actor))),
    'configured_enabled',c.inbound_contacts_enabled,
    'credential_configured',c.inbound_contact_secret_hash IS NOT NULL,
    'generation',c.inbound_contact_generation,'granted_at',c.inbound_contact_granted_at,
    'operation','contacts.create_update');
END;
$$;
REVOKE ALL ON FUNCTION public.get_mcp_contact_sync(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_mcp_contact_sync(uuid,uuid) TO authenticated;

CREATE FUNCTION public.create_mcp_inbound_connection(_label text, _tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE t uuid; cid uuid;
BEGIN
  t := public._mcp_resolve_tenant(_tenant_id,false);
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=t AND user_id=auth.uid() FOR SHARE;
  IF NOT ('mcp.connections.manage'=ANY(public._mcp_caller_capabilities(t,auth.uid()))) THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF _label IS NULL OR length(btrim(_label)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'MCP_BAD_LABEL' USING ERRCODE='22023'; END IF;
  -- An incoming-only connection has no invented outbound address or discovered tools.
  INSERT INTO public.mcp_connections(tenant_id,label,provider_key,auth_kind,created_by,updated_by)
    VALUES(t,btrim(_label),'generic-remote','none',auth.uid(),auth.uid()) RETURNING connection_id INTO cid;
  RETURN public.get_mcp_contact_sync(cid,t);
END;
$$;
REVOKE ALL ON FUNCTION public.create_mcp_inbound_connection(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_mcp_inbound_connection(text,uuid) TO authenticated;

CREATE FUNCTION public.set_mcp_contact_sync(
  _connection_id uuid, _enabled boolean, _secret text, _expected_generation bigint, _tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE t uuid; c public.mcp_connections;
BEGIN
  t := public._mcp_resolve_tenant(_tenant_id,false);
  SELECT * INTO c FROM public.mcp_connections WHERE connection_id=_connection_id FOR UPDATE;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=t AND user_id=auth.uid() FOR SHARE;
  IF c.connection_id IS NULL OR c.tenant_id IS DISTINCT FROM t OR
    NOT ('mcp.connections.manage'=ANY(public._mcp_caller_capabilities(t,auth.uid()))) THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF c.legacy_source IS NOT NULL THEN
    RAISE EXCEPTION 'MCP_LEGACY_CONNECTION_READONLY' USING ERRCODE='42501'; END IF;
  IF _expected_generation IS DISTINCT FROM c.inbound_contact_generation THEN
    RAISE EXCEPTION 'MCP_CONTACT_SYNC_STALE' USING ERRCODE='22023'; END IF;
  IF _enabled IS NULL OR (_enabled AND (NOT c.enabled OR _secret IS NULL OR length(_secret) NOT BETWEEN 32 AND 512
    OR _secret ~ '[[:space:][:cntrl:]]')) THEN
    RAISE EXCEPTION 'MCP_CONTACT_SYNC_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.mcp_connections SET inbound_contacts_enabled=_enabled,
    inbound_contact_secret_hash=CASE WHEN _enabled THEN encode(sha256(convert_to(_secret,'UTF8')),'hex') END,
    inbound_contact_actor=CASE WHEN _enabled THEN auth.uid() END,
    inbound_contact_granted_at=CASE WHEN _enabled THEN clock_timestamp() END,
    inbound_contact_generation=inbound_contact_generation+1,updated_by=auth.uid(),updated_at=clock_timestamp()
    WHERE connection_id=c.connection_id;
  PERFORM public.record_mcp_connection_receipt(c.connection_id,'paige.inbound.contacts.configure','executed',
    gen_random_uuid(),auth.uid(),jsonb_build_object('enabled',_enabled,'generation',c.inbound_contact_generation+1));
  RETURN public.get_mcp_contact_sync(c.connection_id,t);
END;
$$;
REVOKE ALL ON FUNCTION public.set_mcp_contact_sync(uuid,boolean,text,bigint,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_mcp_contact_sync(uuid,boolean,text,bigint,uuid) TO authenticated;

CREATE FUNCTION public.sync_mcp_connection_contact(
  _connection_id uuid, _secret text, _generation bigint, _event_id uuid,
  _external_id text, _source_updated_at timestamptz, _contact jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE c public.mcp_connections; binding public.mcp_connection_contacts; old_receipt jsonb;
  client uuid; assignee uuid; methods jsonb; fields jsonb; payload_hash text; result jsonb;
  email text; phone text; phone_usable boolean; created boolean := false;
BEGIN
  -- Not a browser writer or a way for a model to select a business. The service authenticates
  -- this independently configured credential; the request contains NO target tenant/actor.
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'MCP_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.mcp_connections WHERE connection_id=_connection_id FOR UPDATE;
  IF c.connection_id IS NULL OR NOT c.enabled OR NOT c.inbound_contacts_enabled
    OR _generation IS DISTINCT FROM c.inbound_contact_generation OR _secret IS NULL
    OR length(_secret) NOT BETWEEN 32 AND 512 OR c.inbound_contact_secret_hash IS NULL
    OR c.inbound_contact_secret_hash <> encode(sha256(convert_to(_secret,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'MCP_CONTACT_SYNC_FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=c.tenant_id AND user_id=c.inbound_contact_actor FOR SHARE;
  IF NOT ('mcp.connections.manage'=ANY(public._mcp_caller_capabilities(c.tenant_id,c.inbound_contact_actor))) THEN
    RAISE EXCEPTION 'MCP_CONTACT_SYNC_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF _event_id IS NULL OR _external_id IS NULL OR length(btrim(_external_id)) NOT BETWEEN 1 AND 255
    OR _source_updated_at IS NULL OR NOT isfinite(_source_updated_at)
    OR _source_updated_at > clock_timestamp()+interval '5 minutes'
    OR _contact IS NULL OR jsonb_typeof(_contact)<>'object' OR octet_length(_contact::text)>8192 THEN
    RAISE EXCEPTION 'MCP_CONTACT_SYNC_INVALID' USING ERRCODE='22023'; END IF;
  _external_id := btrim(_external_id);
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(_contact) k WHERE k NOT IN
    ('email','first_name','last_name','phone','tier','source','assigned_to_email'))
    OR EXISTS(SELECT 1 FROM jsonb_each(_contact) e WHERE jsonb_typeof(e.value) NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'MCP_CONTACT_FIELDS_REFUSED' USING ERRCODE='22023'; END IF;
  email := lower(btrim(_contact->>'email')); phone := NULLIF(btrim(_contact->>'phone'),'');
  IF email IS NULL OR length(email)>254 OR length(COALESCE(_contact->>'first_name',''))>100
    OR length(COALESCE(_contact->>'last_name',''))>100 OR length(COALESCE(_contact->>'source',''))>50
    OR (_contact->>'tier' IS NOT NULL AND _contact->>'tier' NOT IN ('lead','standard','premium','vip','internal','staff','free')) THEN
    RAISE EXCEPTION 'MCP_CONTACT_SYNC_INVALID' USING ERRCODE='22023'; END IF;
  -- Canonical address validation, not a second definition of a valid email.
  methods := jsonb_build_array(jsonb_build_object('kind','email','value',email,'is_primary',true));
  PERFORM public.contact_methods_canonical(methods);
  phone_usable := phone IS NOT NULL AND length(phone)<=40 AND length(regexp_replace(phone,'\D','','g')) BETWEEN 7 AND 15;
  IF phone_usable THEN methods := methods || jsonb_build_array(jsonb_build_object('kind','phone','value',phone,'is_primary',true)); END IF;
  payload_hash := encode(sha256(convert_to(jsonb_build_array(_external_id,_source_updated_at AT TIME ZONE 'UTC',_contact)::text,'UTF8')),'hex');
  SELECT detail INTO old_receipt FROM public.mcp_connection_receipts
    WHERE connection_id=c.connection_id AND run_id=_event_id AND tool_name='paige.inbound.contacts.sync'
      AND detail->>'source'='connection_contact_sync';
  IF FOUND THEN
    IF old_receipt->>'payload_hash' IS DISTINCT FROM payload_hash THEN
      RAISE EXCEPTION 'MCP_CONTACT_EVENT_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN old_receipt->'result' || jsonb_build_object('replayed',true);
  END IF;
  SELECT * INTO binding FROM public.mcp_connection_contacts
    WHERE connection_id=c.connection_id AND external_id=_external_id;
  IF FOUND AND (_source_updated_at < binding.source_updated_at OR
    (_source_updated_at=binding.source_updated_at AND payload_hash<>binding.payload_hash)) THEN
    RAISE EXCEPTION 'MCP_CONTACT_SOURCE_STALE' USING ERRCODE='22023'; END IF;
  IF _contact->>'assigned_to_email' IS NOT NULL THEN
    SELECT u.id INTO assignee FROM auth.users u JOIN public.tenant_members m ON m.user_id=u.id
      WHERE m.tenant_id=c.tenant_id AND m.status='active' AND lower(u.email)=lower(btrim(_contact->>'assigned_to_email'))
      FOR SHARE OF m;
    IF assignee IS NULL THEN RAISE EXCEPTION 'MCP_CONTACT_ASSIGNEE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  END IF;
  -- Same connection serializes incoming events. The canonical tenant address constraint
  -- arbitrates races with other connections/manual creators; a conflict rolls back EVERYTHING.
  client := binding.client_id;
  IF client IS NULL THEN client := public.client_id_for_address(c.tenant_id,'email',email); END IF;
  fields := jsonb_strip_nulls(jsonb_build_object('first_name',COALESCE(NULLIF(btrim(_contact->>'first_name'),''),'Unknown'),
    'last_name',COALESCE(btrim(_contact->>'last_name'),''),'tier',_contact->>'tier','source',_contact->>'source',
    'mirror_source','connection_sync','last_mirrored_at',clock_timestamp()));
  IF client IS NULL THEN
    client := public._create_client_with_contact_methods(c.tenant_id,fields || jsonb_build_object(
      'created_by',c.inbound_contact_actor,'status','active','source',COALESCE(_contact->>'source','connection_sync'),
      'lifecycle_stage','new_lead','created_by_channel_type','import'),methods);
    created := true;
  ELSE
    PERFORM 1 FROM public.clients WHERE id=client AND tenant_id=c.tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MCP_CONTACT_BINDING_INVALID' USING ERRCODE='42501'; END IF;
    PERFORM public._add_client_contact_methods(c.tenant_id,client,methods);
    UPDATE public.clients SET first_name=COALESCE(NULLIF(btrim(_contact->>'first_name'),''),first_name),
      last_name=COALESCE(btrim(_contact->>'last_name'),last_name),
      tier=COALESCE(fields->>'tier',tier),source=COALESCE(fields->>'source',source),
      mirror_source='connection_sync',last_mirrored_at=clock_timestamp() WHERE id=client AND tenant_id=c.tenant_id;
  END IF;
  IF assignee IS NOT NULL THEN
    INSERT INTO public.paige_coach_assignments(tenant_id,contact_id,assigned_role,rep_user_id,active,metadata)
      VALUES(c.tenant_id,client,'lead_owner',assignee,true,jsonb_build_object('source','connection_sync','connection_id',c.connection_id))
      ON CONFLICT(contact_id,assigned_role) WHERE active=true DO UPDATE SET rep_user_id=EXCLUDED.rep_user_id,active=true,
        tenant_id=EXCLUDED.tenant_id,metadata=public.paige_coach_assignments.metadata || EXCLUDED.metadata
        WHERE public.paige_coach_assignments.tenant_id IS NULL OR public.paige_coach_assignments.tenant_id=EXCLUDED.tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'MCP_CONTACT_ASSIGNEE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  END IF;
  INSERT INTO public.mcp_connection_contacts(connection_id,tenant_id,external_id,client_id,source_updated_at,payload_hash)
    VALUES(c.connection_id,c.tenant_id,_external_id,client,_source_updated_at,payload_hash)
    ON CONFLICT(connection_id,external_id) DO UPDATE SET source_updated_at=EXCLUDED.source_updated_at,payload_hash=EXCLUDED.payload_hash;
  result := jsonb_build_object('client_id',client,'action',CASE WHEN created THEN 'created' ELSE 'updated' END,'replayed',false);
  IF phone IS NOT NULL AND NOT phone_usable THEN result := result || jsonb_build_object('phone_not_saved','not a usable phone number'); END IF;
  PERFORM public.record_mcp_connection_receipt(c.connection_id,'paige.inbound.contacts.sync','executed',_event_id,c.inbound_contact_actor,
    jsonb_build_object('source','connection_contact_sync','generation',_generation,'payload_hash',payload_hash,'result',result));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_mcp_connection_contact(uuid,text,bigint,uuid,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_mcp_connection_contact(uuid,text,bigint,uuid,text,timestamptz,jsonb) TO service_role;
COMMIT;
