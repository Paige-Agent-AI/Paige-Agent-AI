-- CLI-created unused forward carrier. Extend the original Solo Zapier MCP lifecycle;
-- keep existing encrypted rows, native writers and deployed-client ABIs.
begin;

do $original_source$
begin
 if not exists(select 1 from pg_attribute where attrelid='public.tenant_mcp_connections'::regclass
  and attname='zapier_generation' and atttypid='uuid'::regtype and attnotnull and not attisdropped) then
  raise exception 'ZAPIER_MCP_EXISTING_GENERATION_MISSING'; end if;
 if (select md5(prosrc) from pg_proc where oid='public.set_tenant_mcp_approved_capabilities(text,text[],uuid,jsonb)'::regprocedure) is distinct from 'f1010d0118cba5571a89e04505d2a411' then raise exception 'ZAPIER_MCP_SOURCE_CHANGED_set_tenant_mcp_approved_capabilities'; end if;
 if (select md5(prosrc) from pg_proc where oid='public.begin_tenant_mcp_oauth(uuid,text,text,text,text,text,text,text,text,uuid)'::regprocedure) is distinct from '6d050ef34b7f1238960bd30721c592cc' then raise exception 'ZAPIER_MCP_SOURCE_CHANGED_begin_tenant_mcp_oauth'; end if;
 if (select md5(prosrc) from pg_proc where oid='public.consume_tenant_mcp_oauth_state(text)'::regprocedure) is distinct from 'b02372566cb7a3f5cd797de5d25f0e99' then raise exception 'ZAPIER_MCP_SOURCE_CHANGED_consume_tenant_mcp_oauth_state'; end if;
 if (select md5(prosrc) from pg_proc where oid='public.rotate_tenant_mcp_tokens(uuid,text,text,text,timestamp with time zone)'::regprocedure) is distinct from '2608e466a0e9124c8b74d818fc6c6cd7' then raise exception 'ZAPIER_MCP_SOURCE_CHANGED_rotate_tenant_mcp_tokens'; end if;
 if (select md5(prosrc) from pg_proc where oid='public.set_tenant_zapier_mcp_connection(uuid,text,text,text,timestamp with time zone,text,text,text,text[],text,uuid)'::regprocedure) is distinct from '00b77191aba013ebe02f9b0d4b24685b' then raise exception 'ZAPIER_MCP_SOURCE_CHANGED_set_tenant_zapier_mcp_connection'; end if;
 if (select md5(prosrc) from pg_proc where oid='public._zapier_cancel_on_workspace_switch()'::regprocedure) is distinct from '48d7b3e4219e09fbde66da2905f09686' then raise exception 'ZAPIER_MCP_SOURCE_CHANGED__zapier_cancel_on_workspace_switch'; end if;
 if (select md5(prosrc) from pg_proc where oid='public.clear_tenant_mcp_connection(text,uuid)'::regprocedure) is distinct from 'dc36f559edf87540df51ce718a016d4a' then raise exception 'ZAPIER_MCP_SOURCE_CHANGED_clear_tenant_mcp_connection'; end if;
 if (select md5(prosrc) from pg_proc where oid='public.get_tenant_mcp_secret(uuid,text)'::regprocedure) is distinct from '6da731119d2e612c636ce02f647e87ae' then raise exception 'ZAPIER_MCP_SOURCE_CHANGED_get_tenant_mcp_secret'; end if;
 if (select md5(prosrc) from pg_proc where oid='public.update_tenant_mcp_probe(uuid,text,text,text,jsonb)'::regprocedure) is distinct from 'a286f5759102aa97a4686d86eb7058d5' then raise exception 'ZAPIER_MCP_SOURCE_CHANGED_update_tenant_mcp_probe'; end if;
end $original_source$;

alter table public.tenant_mcp_connections
 add column zapier_refresh_claim uuid,
 add column zapier_refresh_claimed_at timestamptz,
 add column zapier_refresh_completed_at timestamptz,
 add constraint zapier_mcp_refresh_claim_pair check
  ((zapier_refresh_claim is null)=(zapier_refresh_claimed_at is null)),
 add constraint zapier_mcp_refresh_completion_bound check
  (zapier_refresh_completed_at is null or zapier_refresh_claim is not null);
alter table public.tenant_mcp_oauth_state
 add column requested_scopes text[],
 add column zapier_connection_generation uuid,
 add column zapier_finalized_at timestamptz;

-- Already-issued callbacks have a ten-minute lifetime and no recorded scope list.
-- Preserve those real consumers with unknown (NULL) legacy scopes, not an invented
-- grant. New attempts always freeze a non-NULL list. Remove this transition only
-- after the prior Edge deployment and its pending callbacks have drained.
update public.tenant_mcp_oauth_state s set zapier_connection_generation=c.zapier_generation
 from public.tenant_mcp_connections c where s.tenant_id=c.tenant_id
  and s.provider='zapier' and c.provider='zapier' and s.consumed_at is null
  and s.expires_at>clock_timestamp();

-- Reuse the original Zapier Rail generation field, preserving existing values.
-- An identity/credential change invalidates any in-flight renewal. Health checks and
-- tool approval edits do not. n8n keeps its existing independent lifecycle contract.
create function private.zapier_mcp_generation_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.provider<>'zapier' then return new; end if;
 if tg_op='INSERT' then
  new.zapier_generation:=gen_random_uuid();
  new.zapier_refresh_claim:=null; new.zapier_refresh_claimed_at:=null; new.zapier_refresh_completed_at:=null;
 elsif row(new.server_url_ct,new.auth_kind,new.transport,
  new.oauth_issuer,new.oauth_client_id,new.oauth_client_secret_ct,new.oauth_scopes,new.enabled)
  is distinct from row(old.server_url_ct,old.auth_kind,old.transport,
  old.oauth_issuer,old.oauth_client_id,old.oauth_client_secret_ct,old.oauth_scopes,old.enabled) then
  new.zapier_generation:=gen_random_uuid();
  new.zapier_refresh_claim:=null; new.zapier_refresh_claimed_at:=null; new.zapier_refresh_completed_at:=null;
 end if;
 return new;
end $$;
revoke all on function private.zapier_mcp_generation_changed() from public,anon,authenticated,service_role;
create trigger tenant_zapier_mcp_generation before insert or update on public.tenant_mcp_connections
 for each row execute function private.zapier_mcp_generation_changed();

-- Service callers already authenticated the user. Recheck and lock original Solo
-- tenant/member eligibility inside each credential transaction, including after waits.
create function private.zapier_mcp_assert_actor(_tenant uuid,_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare active_tenant uuid;
begin
 select active_tenant_id into active_tenant from public.profiles where user_id=_actor for share;
 perform 1 from public.tenants where id=_tenant for share;
 perform 1 from public.tenant_members where tenant_id=_tenant and user_id=_actor for share;
 if _actor is null or (active_tenant is not null and active_tenant<>_tenant) or not exists(select 1 from public.tenants t
  where t.id=_tenant and t.status='active' and t.archived_at is null
   and t.account_type::text='standalone' and t.parent_tenant_id is null
   and not public.is_company_workspace(t.id))
  or public.is_tenant_admin_as(_actor,_tenant) is distinct from true then
  raise exception 'MCP_FORBIDDEN' using errcode='42501';
 end if;
end $$;
revoke all on function private.zapier_mcp_assert_actor(uuid,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.begin_tenant_mcp_oauth(_tenant_id uuid, _provider text, _state text, _verifier text, _redirect_uri text, _issuer text, _resource text, _client_id text, _client_secret text DEFAULT NULL::text, _actor uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p text := public._mcp_check_provider(_provider);
BEGIN
  IF _p='zapier' AND current_setting('paige.zapier_mcp_write',true) IS DISTINCT FROM 'begin' THEN
    RAISE EXCEPTION 'MCP_OAUTH_RESTART_REQUIRED' USING ERRCODE='40001';
  END IF;
  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'MCP_NO_TENANT' USING ERRCODE = '22023'; END IF;
  IF COALESCE(btrim(_state), '') = '' OR COALESCE(btrim(_verifier), '') = '' THEN
    RAISE EXCEPTION 'MCP_OAUTH_BAD_REQUEST' USING ERRCODE = '22023';
  END IF;

  -- Only one flow at a time per tenant and provider. A second attempt replaces the first
  -- rather than leaving an older, still-redeemable state behind.
  DELETE FROM public.tenant_mcp_oauth_state
   WHERE tenant_id = _tenant_id AND provider = _p AND consumed_at IS NULL;

  -- Opportunistic cleanup of anything that has aged out anywhere. This table is small and
  -- write-rare, so it costs nothing and means an expired verifier does not sit at rest
  -- waiting for a retention job that does not exist yet.
  DELETE FROM public.tenant_mcp_oauth_state WHERE expires_at < now() - interval '1 hour';

  INSERT INTO public.tenant_mcp_oauth_state
    (tenant_id, provider, state, code_verifier_ct, redirect_uri, issuer, resource,
     client_id, client_secret_ct, created_by)
  VALUES
    (_tenant_id, _p, _state, public.platform_encrypt(_verifier), _redirect_uri, _issuer,
     _resource, _client_id,
     CASE WHEN _client_secret IS NULL OR _client_secret = '' THEN NULL
          ELSE public.platform_encrypt(_client_secret) END,
     _actor);
END;
$function$;
CREATE OR REPLACE FUNCTION public.consume_tenant_mcp_oauth_state(_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.tenant_mcp_oauth_state;
BEGIN
  IF EXISTS(select 1 from public.tenant_mcp_oauth_state where state=_state and provider='zapier')
    AND current_setting('paige.zapier_mcp_write',true) IS DISTINCT FROM 'consume' THEN
    RAISE EXCEPTION 'MCP_OAUTH_RESTART_REQUIRED' USING ERRCODE='40001';
  END IF;
  UPDATE public.tenant_mcp_oauth_state
     SET consumed_at = now()
   WHERE state = _state
     AND consumed_at IS NULL
     AND expires_at > now()
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;

  RETURN jsonb_build_object(
    'found', true,
    -- Returned so the caller can compare it in constant time rather than trusting that a
    -- lookup keyed on it is the same guarantee. It is the value the caller already sent.
    'state', _row.state,
    'tenant_id', _row.tenant_id,
    'provider', _row.provider,
    'code_verifier', public.platform_decrypt(_row.code_verifier_ct),
    'redirect_uri', _row.redirect_uri,
    'issuer', _row.issuer,
    'resource', _row.resource,
    'client_id', _row.client_id,
    'client_secret', CASE WHEN _row.client_secret_ct IS NULL THEN NULL
                          ELSE public.platform_decrypt(_row.client_secret_ct) END
  );
END;
$function$;

create function public.begin_tenant_zapier_mcp_oauth(_tenant uuid,_actor uuid,_state text,
 _verifier text,_redirect_uri text,_issuer text,_resource text,_client_id text,
 _client_secret text,_requested_scopes text[])
returns void language plpgsql security definer set search_path='' as $$
declare generation uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,920));
 perform private.zapier_mcp_assert_actor(_tenant,_actor);
 if _requested_scopes is null or cardinality(_requested_scopes)>512 or exists(
  select 1 from unnest(_requested_scopes) s where s is null or s !~ '^[!-~]+$'
   or position(chr(34) in s)>0 or position(chr(92) in s)>0
 ) then raise exception 'MCP_OAUTH_BAD_REQUEST' using errcode='22023'; end if;
 select c.zapier_generation into generation from public.tenant_mcp_connections c
  where c.tenant_id=_tenant and c.provider='zapier' for update;
 -- Keep historical attempts; expire old pending/exchanging flows rather than let
 -- their later callbacks replace the new consent. The original begin stays the writer.
 update public.tenant_mcp_oauth_state set expires_at=least(expires_at,clock_timestamp()),
  consumed_at=coalesce(consumed_at,clock_timestamp()) where tenant_id=_tenant and provider='zapier';
 perform set_config('paige.zapier_mcp_write','begin',true);
 perform public.begin_tenant_mcp_oauth(_tenant,'zapier',_state,_verifier,_redirect_uri,
  _issuer,_resource,_client_id,_client_secret,_actor);
 perform set_config('paige.zapier_mcp_write','',true);
 update public.tenant_mcp_oauth_state set requested_scopes=_requested_scopes,
  zapier_connection_generation=generation where state=_state and tenant_id=_tenant
   and provider='zapier' and created_by=_actor;
end $$;
revoke all on function public.begin_tenant_zapier_mcp_oauth(uuid,uuid,text,text,text,text,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.begin_tenant_zapier_mcp_oauth(uuid,uuid,text,text,text,text,text,text,text,text[]) to service_role;

create function public.consume_tenant_zapier_mcp_oauth(_tenant uuid,_actor uuid,_state text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare flow public.tenant_mcp_oauth_state; consumed jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,920));
 perform private.zapier_mcp_assert_actor(_tenant,_actor);
 select * into flow from public.tenant_mcp_oauth_state where state=_state
  and tenant_id=_tenant and provider='zapier' and created_by=_actor
  and consumed_at is null and expires_at>clock_timestamp() for update;
 if not found then return jsonb_build_object('found',false); end if;
 -- The original atomic state consumer still performs the single-use redemption
 -- and the only verifier/secret decryption. The wrapper adds actor/provider binding.
 perform set_config('paige.zapier_mcp_write','consume',true);
 consumed:=public.consume_tenant_mcp_oauth_state(_state);
 perform set_config('paige.zapier_mcp_write','',true);
 return consumed || jsonb_build_object('requested_scopes',flow.requested_scopes);
end $$;
revoke all on function public.consume_tenant_zapier_mcp_oauth(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.consume_tenant_zapier_mcp_oauth(uuid,uuid,text) to service_role;

create function public.complete_tenant_zapier_mcp_oauth(_tenant uuid,_actor uuid,_state text,
 _access_token text,_refresh_token text,_expires_at timestamptz,_scopes text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare flow public.tenant_mcp_oauth_state; generation uuid; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,920));
 perform private.zapier_mcp_assert_actor(_tenant,_actor);
 select c.zapier_generation into generation from public.tenant_mcp_connections c
  where c.tenant_id=_tenant and c.provider='zapier' for update;
 select * into flow from public.tenant_mcp_oauth_state where state=_state
  and tenant_id=_tenant and provider='zapier' and created_by=_actor
  and consumed_at is not null and zapier_finalized_at is null
  and expires_at>clock_timestamp() for update;
 if not found or flow.zapier_connection_generation is distinct from generation then
  raise exception 'MCP_OAUTH_NOT_ACTIVE' using errcode='40001'; end if;
 if _scopes is null or (flow.requested_scopes is not null and not (_scopes <@ flow.requested_scopes))
  or (_expires_at is not null and _expires_at<=clock_timestamp()) then
  raise exception 'MCP_OAUTH_BAD_REQUEST' using errcode='22023'; end if;
 -- Original encrypted credential writer and its approval/cache reset, unchanged.
 perform set_config('paige.zapier_mcp_write','oauth',true);
 result:=public.set_tenant_zapier_mcp_connection(_tenant,flow.resource,_access_token,
  _refresh_token,_expires_at,flow.issuer,flow.client_id,
  case when flow.client_secret_ct is null then null else public.platform_decrypt(flow.client_secret_ct) end,
  _scopes,null,_actor);
 perform set_config('paige.zapier_mcp_write','',true);
 update public.tenant_mcp_oauth_state set zapier_finalized_at=clock_timestamp() where id=flow.id;
 select c.zapier_generation into generation from public.tenant_mcp_connections c
  where c.tenant_id=_tenant and c.provider='zapier';
 return result || jsonb_build_object('generation',generation);
end $$;
revoke all on function public.complete_tenant_zapier_mcp_oauth(uuid,uuid,text,text,text,timestamptz,text[]) from public,anon,authenticated;
grant execute on function public.complete_tenant_zapier_mcp_oauth(uuid,uuid,text,text,text,timestamptz,text[]) to service_role;
-- Extend the original writers/readers in place. Their ABIs and existing ACLs remain.
CREATE OR REPLACE FUNCTION public.set_tenant_zapier_mcp_connection(_tenant_id uuid, _server_url text, _access_token text, _refresh_token text, _expires_at timestamp with time zone, _issuer text, _client_id text, _client_secret text DEFAULT NULL::text, _scopes text[] DEFAULT NULL::text[], _label text DEFAULT NULL::text, _actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$ BEGIN
 IF current_setting('paige.zapier_mcp_write',true) IS DISTINCT FROM 'oauth' THEN
  RAISE EXCEPTION 'MCP_OAUTH_RESTART_REQUIRED' USING ERRCODE='40001';
 END IF;
 IF _tenant_id IS NULL THEN RAISE EXCEPTION 'MCP_NO_TENANT' USING ERRCODE='22023';END IF;
 IF COALESCE(btrim(_server_url),'')='' OR _server_url !~* '^https://' THEN RAISE EXCEPTION 'MCP_INSECURE_URL' USING ERRCODE='22023';END IF;
 IF COALESCE(btrim(_access_token),'')='' THEN RAISE EXCEPTION 'MCP_NO_TOKEN' USING ERRCODE='22023';END IF;
 INSERT INTO public.tenant_mcp_connections
  (tenant_id,provider,label,server_url_ct,auth_token_ct,auth_token_last4,refresh_token_ct,access_token_expires_at,
   oauth_issuer,oauth_client_id,oauth_client_secret_ct,oauth_scopes,transport,auth_kind,auth_header_name,enabled,status,last_error,created_by,updated_by,updated_at)
 VALUES(_tenant_id,'zapier',NULLIF(btrim(COALESCE(_label,'')),''),public.platform_encrypt(_server_url),public.platform_encrypt(_access_token),right(_access_token,4),
  CASE WHEN COALESCE(_refresh_token,'')='' THEN NULL ELSE public.platform_encrypt(_refresh_token) END,_expires_at,_issuer,_client_id,
  CASE WHEN COALESCE(_client_secret,'')='' THEN NULL ELSE public.platform_encrypt(_client_secret) END,COALESCE(_scopes,ARRAY[]::text[]),
  'http','oauth',NULL,true,'pending_verification',NULL,_actor,_actor,now())
 ON CONFLICT(tenant_id,provider) DO UPDATE SET
  label=COALESCE(NULLIF(btrim(COALESCE(_label,'')),''),tenant_mcp_connections.label),
  server_url_ct=EXCLUDED.server_url_ct,
  auth_token_ct=EXCLUDED.auth_token_ct,
  auth_token_last4=EXCLUDED.auth_token_last4,
  refresh_token_ct=EXCLUDED.refresh_token_ct,
  access_token_expires_at=EXCLUDED.access_token_expires_at,
  oauth_issuer=EXCLUDED.oauth_issuer,
  oauth_client_id=EXCLUDED.oauth_client_id,
  oauth_client_secret_ct=EXCLUDED.oauth_client_secret_ct,
  oauth_scopes=EXCLUDED.oauth_scopes,
  transport='http',
  auth_kind='oauth',
  auth_header_name=NULL,
  approved_capabilities='[]'::jsonb,
  capability_pins='{}'::jsonb,
  tools_cache=NULL,
  enabled=true,
  status='pending_verification',
  last_error=NULL,
  updated_by=EXCLUDED.updated_by,
  updated_at=now(),
  zapier_generation=gen_random_uuid(),
  zapier_refresh_claim=NULL,
  zapier_refresh_claimed_at=NULL,
  zapier_refresh_completed_at=NULL;
 RETURN jsonb_build_object('ok',true,'provider','zapier','status','pending_verification','auth_kind','oauth');
END $function$;
CREATE OR REPLACE FUNCTION public.rotate_tenant_mcp_tokens(_tenant_id uuid, _provider text, _access_token text, _refresh_token text DEFAULT NULL::text, _expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p text := public._mcp_check_provider(_provider);
BEGIN
  IF _p='zapier' AND current_setting('paige.zapier_mcp_write',true) IS DISTINCT FROM 'refresh' THEN
    RAISE EXCEPTION 'MCP_OAUTH_RESTART_REQUIRED' USING ERRCODE='40001';
  END IF;
  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'MCP_NO_TENANT' USING ERRCODE = '22023'; END IF;
  IF COALESCE(btrim(_access_token), '') = '' THEN
    RAISE EXCEPTION 'MCP_NO_TOKEN' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tenant_mcp_connections SET
    auth_token_ct           = public.platform_encrypt(_access_token),
    auth_token_last4        = right(_access_token, 4),
    -- Only replaced when the server issued a new one; a server that does not rotate
    -- must not have its still-valid refresh token erased.
    refresh_token_ct        = CASE WHEN _refresh_token IS NULL OR _refresh_token = ''
                                   THEN refresh_token_ct
                                   ELSE public.platform_encrypt(_refresh_token) END,
    access_token_expires_at = CASE WHEN _p='zapier' THEN _expires_at ELSE COALESCE(_expires_at, access_token_expires_at) END,
    updated_at              = now()
  WHERE tenant_id = _tenant_id AND provider = _p;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_tenant_mcp_secret(_tenant_id uuid, _provider text DEFAULT 'zapier'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.tenant_mcp_connections; _p text := public._mcp_check_provider(_provider);
BEGIN
  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'MCP_NO_TENANT' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _row FROM public.tenant_mcp_connections
   WHERE tenant_id = _tenant_id AND provider = _p;
  -- A 'url' connection's credential IS its address, so it needs no token or grant to be
  -- configured. Everything else needs one of the two.
  IF _row.tenant_id IS NULL OR _row.server_url_ct IS NULL
     OR (_row.auth_kind <> 'url'
         AND _row.auth_token_ct IS NULL AND _row.refresh_token_ct IS NULL) THEN
    RETURN jsonb_build_object('configured', false, 'generation', _row.zapier_generation);
  END IF;
  IF _row.enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('configured', true, 'enabled', false, 'generation', _row.zapier_generation);
  END IF;
  RETURN jsonb_build_object(
    'configured', true, 'enabled', true, 'provider', _row.provider,
    'server_url', public.platform_decrypt(_row.server_url_ct),
    'auth_token', CASE WHEN _row.auth_token_ct IS NULL THEN NULL
                       ELSE public.platform_decrypt(_row.auth_token_ct) END,
    'refresh_token', CASE WHEN _row.refresh_token_ct IS NULL THEN NULL
                          ELSE public.platform_decrypt(_row.refresh_token_ct) END,
    'auth_kind', _row.auth_kind,
    'auth_header_name', _row.auth_header_name,
    'expires_at', _row.access_token_expires_at,
    'oauth_issuer', _row.oauth_issuer,
    'oauth_client_id', _row.oauth_client_id,
    'oauth_client_secret', CASE WHEN _row.oauth_client_secret_ct IS NULL THEN NULL
                                ELSE public.platform_decrypt(_row.oauth_client_secret_ct) END,
    'transport', _row.transport,
    -- Restored. What the workspace authorised, and the contract it authorised it against.
    -- Absent, the governed caller reads them as "nothing approved" and refuses everything.
    'approved_capabilities', COALESCE(_row.approved_capabilities, '[]'::jsonb),
    'capability_pins', COALESCE(_row.capability_pins, '{}'::jsonb),
    'oauth_scopes', COALESCE(_row.oauth_scopes, ARRAY[]::text[]),
    'generation', _row.zapier_generation,
    'refresh_claim', _row.zapier_refresh_claim,
    'refresh_claimed_at', _row.zapier_refresh_claimed_at,
    'refresh_completed_at', _row.zapier_refresh_completed_at
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.clear_tenant_mcp_connection(_provider text, _tenant_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p text := public._mcp_check_provider(_provider); _tenant uuid;
BEGIN
  _tenant := public._mcp_resolve_tenant(_tenant_id, true);
  IF _p='zapier' THEN
    IF current_setting('paige.zapier_mcp_write',true) IS DISTINCT FROM 'disconnect' THEN
      RAISE EXCEPTION 'MCP_OAUTH_RESTART_REQUIRED' USING ERRCODE='40001';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text,920));
    PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=auth.uid() FOR SHARE;
    _tenant := public._mcp_resolve_tenant(_tenant_id,true);
    UPDATE public.tenant_mcp_oauth_state SET expires_at=least(expires_at,clock_timestamp()),
      consumed_at=coalesce(consumed_at,clock_timestamp())
    WHERE tenant_id=_tenant AND provider='zapier';
  END IF;
  UPDATE public.tenant_mcp_connections SET
    server_url_ct           = NULL,
    auth_token_ct           = NULL,
    auth_token_last4        = NULL,
    refresh_token_ct        = NULL,
    access_token_expires_at = NULL,
    oauth_issuer            = NULL,
    oauth_client_id         = NULL,
    oauth_client_secret_ct  = NULL,
    oauth_scopes            = ARRAY[]::text[],
    auth_header_name        = NULL,
    tools_cache             = NULL,
    -- What Paige was allowed to run goes with it. Leaving these is how a disconnect
    -- becomes a pause rather than a revocation.
    approved_capabilities   = '[]'::jsonb,
    capability_pins         = '{}'::jsonb,
    enabled                 = false,
    status                  = 'unconfigured',
    last_error              = NULL,
    updated_by              = auth.uid(),
    updated_at              = now()
  WHERE tenant_id = _tenant AND provider = _p;
END;
$function$;
CREATE OR REPLACE FUNCTION public._zapier_cancel_on_workspace_switch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$ BEGIN
 IF OLD.active_tenant_id IS DISTINCT FROM NEW.active_tenant_id THEN UPDATE public.tenant_zapier_api_oauth_attempts SET status='cancelled' WHERE actor_id=NEW.user_id AND status IN ('pending','exchanging'); UPDATE public.tenant_mcp_oauth_state SET expires_at=least(expires_at,clock_timestamp()),
  consumed_at=coalesce(consumed_at,clock_timestamp())
  WHERE created_by=NEW.user_id AND provider='zapier' AND zapier_finalized_at IS NULL;
 END IF;RETURN NEW;END $function$;

CREATE OR REPLACE FUNCTION public.update_tenant_mcp_probe(_tenant_id uuid, _provider text, _status text, _last_error text DEFAULT NULL::text, _tools_cache jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p text := public._mcp_check_provider(_provider);
BEGIN
  IF _p='zapier' AND current_setting('paige.zapier_mcp_write',true) IS DISTINCT FROM 'probe' THEN
    RAISE EXCEPTION 'MCP_OAUTH_RESTART_REQUIRED' USING ERRCODE='40001';
  END IF;
  IF _status IS NOT NULL AND _status NOT IN ('unconfigured', 'pending_verification', 'connected', 'error') THEN
    RAISE EXCEPTION 'MCP_BAD_STATUS' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tenant_mcp_connections SET
    status         = COALESCE(_status, status),
    -- Provider error text is unbounded external content. It is retained for
    -- operators but is never returned by any tenant-reachable read above.
    last_error     = _last_error,
    tools_cache    = COALESCE(_tools_cache, tools_cache),
    last_probed_at = now(),
    updated_at     = now()
  WHERE tenant_id = _tenant_id AND provider = _p;
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_tenant_mcp_approved_capabilities(_provider text, _capabilities text[], _tenant_id uuid DEFAULT NULL::uuid, _pins jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p      text := public._mcp_check_provider(_provider);
  _tenant uuid;
  _clean  text[];
  _pinmap jsonb;
  _bad    integer;
BEGIN
  IF _p='zapier' AND current_setting('paige.zapier_mcp_write',true) IS DISTINCT FROM 'approval' THEN
    RAISE EXCEPTION 'MCP_OAUTH_RESTART_REQUIRED' USING ERRCODE='40001';
  END IF;
  _tenant := public._mcp_resolve_tenant(_tenant_id, true);

  -- Refuse by name rather than letting the table CHECK reject the statement generically.
  -- A blank entry is still dropped quietly, because that is a UI artefact rather than a
  -- decision; a real name that cannot be stored raises, so an admin is never told that
  -- five capabilities were approved when one of them was silently discarded.
  SELECT count(*) INTO _bad
    FROM unnest(COALESCE(_capabilities, ARRAY[]::text[])) AS c
   WHERE btrim(c) <> '' AND c !~ '^[A-Za-z0-9_.:-]{1,64}$';

  IF _bad > 0 THEN
    -- The offending name is deliberately NOT echoed back: it is provider-controlled text,
    -- and an error message is one more place it would travel.
    RAISE EXCEPTION 'MCP_INVALID_CAPABILITY_NAME: % capability name(s) are not valid tool names and were not approved', _bad
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), ARRAY[]::text[]) INTO _clean
    FROM unnest(COALESCE(_capabilities, ARRAY[]::text[])) AS c
   WHERE btrim(c) <> '';

  IF COALESCE(array_length(_clean, 1), 0) > 200 THEN
    RAISE EXCEPTION 'MCP_TOO_MANY_CAPABILITIES' USING ERRCODE = '22023';
  END IF;

  -- Only pins for names actually being approved are kept. A pin for anything else is
  -- dropped rather than stored, so the pin map can never describe a capability the
  -- workspace did not approve.
  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO _pinmap
    FROM jsonb_each(COALESCE(_pins, '{}'::jsonb)) e
   WHERE e.key = ANY(_clean);

  UPDATE public.tenant_mcp_connections
     SET approved_capabilities = to_jsonb(_clean),
         capability_pins       = _pinmap,
         updated_at            = now(),
         updated_by            = auth.uid()
   WHERE tenant_id = _tenant AND provider = _p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP_NOT_CONNECTED: connect the provider before approving anything'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'provider', _p,
    'approved_count', COALESCE(array_length(_clean, 1), 0),
    -- Reported so a caller can see when it approved something it could not pin, rather
    -- than discovering it later as a capability that refuses to run.
    'pinned_count', (SELECT count(*) FROM jsonb_object_keys(_pinmap))
  );
END;
$function$;

create function public.claim_tenant_zapier_mcp_refresh(_tenant uuid,_actor uuid,_generation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.tenant_mcp_connections; claim uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,920));
 perform private.zapier_mcp_assert_actor(_tenant,_actor);
 select * into c from public.tenant_mcp_connections where tenant_id=_tenant and provider='zapier' for update;
 if not found or c.zapier_generation is distinct from _generation then
  return jsonb_build_object('state','changed'); end if;
 if not c.enabled or c.auth_kind<>'oauth' or c.server_url_ct is null or c.auth_token_ct is null then
  return jsonb_build_object('state','not_connected'); end if;
 if c.zapier_refresh_claim is not null and c.zapier_refresh_completed_at is null then
  -- A lost refresh response may already have rotated the token. Never steal or
  -- replay that claim; only the same in-flight response or explicit reconnect can finish it.
  return jsonb_build_object('state',case when c.zapier_refresh_claimed_at>clock_timestamp()-interval '30 seconds'
   then 'busy' else 'reauthorization_required' end);
 end if;
 if c.access_token_expires_at is null or c.access_token_expires_at>clock_timestamp()+interval '60 seconds' then
  return jsonb_build_object('state','current','secret',public.get_tenant_mcp_secret(_tenant,'zapier'));
 end if;
 if c.refresh_token_ct is null or nullif(c.oauth_client_id,'') is null or nullif(c.oauth_issuer,'') is null then
  return jsonb_build_object('state','reauthorization_required'); end if;
 claim:=gen_random_uuid();
 update public.tenant_mcp_connections set zapier_refresh_claim=claim,zapier_refresh_claimed_at=clock_timestamp(),
  zapier_refresh_completed_at=null
  where tenant_id=_tenant and provider='zapier';
 return jsonb_build_object('state','claimed','claim',claim,
  'secret',public.get_tenant_mcp_secret(_tenant,'zapier'));
end $$;
revoke all on function public.claim_tenant_zapier_mcp_refresh(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_tenant_zapier_mcp_refresh(uuid,uuid,uuid) to service_role;

create function public.finish_tenant_zapier_mcp_refresh(_tenant uuid,_actor uuid,_generation uuid,_claim uuid,
 _access_token text,_refresh_token text,_expires_at timestamptz,_scopes text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.tenant_mcp_connections;
begin
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,920));
 perform private.zapier_mcp_assert_actor(_tenant,_actor);
 select * into c from public.tenant_mcp_connections where tenant_id=_tenant and provider='zapier' for update;
 if not found or not c.enabled or c.auth_kind<>'oauth'
  or c.zapier_generation is distinct from _generation or _claim is null
  or c.zapier_refresh_claim is distinct from _claim or c.zapier_refresh_completed_at is not null then
  return jsonb_build_object('state','changed'); end if;
 if nullif(_access_token,'') is null or (_expires_at is not null and _expires_at<=clock_timestamp())
  or _scopes is null or not (_scopes <@ coalesce(c.oauth_scopes,array[]::text[])) then
  raise exception 'MCP_OAUTH_BAD_REQUEST' using errcode='22023'; end if;
 -- Keep one encrypted rotation writer. Retain a non-rotating refresh token there.
 perform set_config('paige.zapier_mcp_write','refresh',true);
 perform public.rotate_tenant_mcp_tokens(_tenant,'zapier',_access_token,_refresh_token,_expires_at);
 perform set_config('paige.zapier_mcp_write','',true);
 update public.tenant_mcp_connections set oauth_scopes=_scopes
  where tenant_id=_tenant and provider='zapier';
 -- Keep the completion nonce on the SAME row, even if narrowing scopes changed its
 -- generation. A lost save response can then be reconciled/failed against this exact
 -- rotation; a later reconnect or renewal replaces the nonce and cannot be touched.
 update public.tenant_mcp_connections set zapier_refresh_claim=_claim,
  zapier_refresh_claimed_at=c.zapier_refresh_claimed_at,zapier_refresh_completed_at=clock_timestamp()
  where tenant_id=_tenant and provider='zapier';
 return jsonb_build_object('state','current','secret',public.get_tenant_mcp_secret(_tenant,'zapier'));
end $$;
revoke all on function public.finish_tenant_zapier_mcp_refresh(uuid,uuid,uuid,uuid,text,text,timestamptz,text[]) from public,anon,authenticated;
grant execute on function public.finish_tenant_zapier_mcp_refresh(uuid,uuid,uuid,uuid,text,text,timestamptz,text[]) to service_role;

create function public.fail_tenant_zapier_mcp_refresh(_tenant uuid,_actor uuid,_generation uuid,_claim uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,920));
 perform private.zapier_mcp_assert_actor(_tenant,_actor);
 perform 1 from public.tenant_mcp_connections where tenant_id=_tenant and provider='zapier'
  and zapier_refresh_claim=_claim and _claim is not null and enabled
  and (zapier_generation=_generation or zapier_refresh_completed_at is not null) for update;
 if not found then return false; end if;
 -- Retain the claim after uncertain provider/rotation failure. A subsequent
 -- connection check cannot automatically repeat a possibly consumed refresh token.
 update public.tenant_mcp_connections set zapier_refresh_completed_at=null where tenant_id=_tenant and provider='zapier';
 perform set_config('paige.zapier_mcp_write','probe',true);
 perform public.update_tenant_mcp_probe(_tenant,'zapier','error','authorization_renewal_unconfirmed',null);
 perform set_config('paige.zapier_mcp_write','',true);
 return true;
end $$;
revoke all on function public.fail_tenant_zapier_mcp_refresh(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_tenant_zapier_mcp_refresh(uuid,uuid,uuid,uuid) to service_role;

create function public.record_tenant_zapier_mcp_probe(_tenant uuid,_actor uuid,_generation uuid,
 _status text,_last_error text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,920));
 perform private.zapier_mcp_assert_actor(_tenant,_actor);
 perform 1 from public.tenant_mcp_connections where tenant_id=_tenant and provider='zapier'
  and zapier_generation=_generation and enabled
  and (_status<>'connected' or ((zapier_refresh_claim is null or zapier_refresh_completed_at is not null)
   and (auth_kind<>'oauth' or access_token_expires_at is null or access_token_expires_at>clock_timestamp()))) for update;
 if not found then return false; end if;
 perform set_config('paige.zapier_mcp_write','probe',true);
 perform public.update_tenant_mcp_probe(_tenant,'zapier',_status,_last_error,null);
 perform set_config('paige.zapier_mcp_write','',true);
 return true;
end $$;
revoke all on function public.record_tenant_zapier_mcp_probe(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_tenant_zapier_mcp_probe(uuid,uuid,uuid,text,text) to service_role;

create function public.zapier_mcp_read_authorized(_tenant uuid,_actor uuid,_generation uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.uid()=_actor and public.current_user_tenant_id()=_tenant
  and public.is_tenant_admin_as(_actor,_tenant)
  and exists(select 1 from public.tenants t where t.id=_tenant and t.status='active'
   and t.archived_at is null and t.account_type::text='standalone'
   and t.parent_tenant_id is null and not public.is_company_workspace(t.id))
  and exists(select 1 from public.tenant_mcp_connections c where c.tenant_id=_tenant
   and c.provider='zapier' and c.zapier_generation=_generation and c.enabled
   and (c.zapier_refresh_claim is null or c.zapier_refresh_completed_at is not null)
   and (c.auth_kind<>'oauth' or c.access_token_expires_at is null or c.access_token_expires_at>clock_timestamp())),false);
$$;
revoke all on function public.zapier_mcp_read_authorized(uuid,uuid,uuid) from public,anon;
grant execute on function public.zapier_mcp_read_authorized(uuid,uuid,uuid) to authenticated,service_role;

create function public.zapier_mcp_action_authorized(_tenant uuid,_actor uuid,_generation uuid,
 _capability text,_pin text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.zapier_mcp_read_authorized(_tenant,_actor,_generation)
  and exists(select 1 from public.tenant_mcp_connections c where c.tenant_id=_tenant and c.provider='zapier'
   and c.approved_capabilities ? _capability and c.capability_pins->>_capability=_pin);
$$;
revoke all on function public.zapier_mcp_action_authorized(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.zapier_mcp_action_authorized(uuid,uuid,uuid,text,text) to authenticated,service_role;

create function public.set_tenant_zapier_mcp_approval(_tenant uuid,_actor uuid,_generation uuid,
 _capabilities text[],_pins jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is distinct from _actor then raise exception 'MCP_FORBIDDEN' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,920));
 perform private.zapier_mcp_assert_actor(_tenant,_actor);
 if public.current_user_tenant_id() is distinct from _tenant then raise exception 'MCP_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.tenant_mcp_connections where tenant_id=_tenant and provider='zapier'
  and zapier_generation=_generation and enabled for update;
 if not found then raise exception 'MCP_CONNECTION_CHANGED' using errcode='40001'; end if;
 -- Same approval writer, transaction and original tool-pin policy; no new authority store.
 perform set_config('paige.zapier_mcp_write','approval',true);
 result:=public.set_tenant_mcp_approved_capabilities('zapier',_capabilities,_tenant,_pins);
 perform set_config('paige.zapier_mcp_write','',true);
 return result;
end $$;
revoke all on function public.set_tenant_zapier_mcp_approval(uuid,uuid,uuid,text[],jsonb) from public,anon;
grant execute on function public.set_tenant_zapier_mcp_approval(uuid,uuid,uuid,text[],jsonb) to authenticated,service_role;

-- Detach exactly the grant the user saw before spending its saved credential on
-- provider revocation. Reconnecting in another request cannot revoke a newer grant.
create function public.disconnect_tenant_zapier_mcp(_tenant uuid,_actor uuid,_generation uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare generation uuid;
begin
 if auth.uid() is distinct from _actor then raise exception 'MCP_FORBIDDEN' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,920));
 perform private.zapier_mcp_assert_actor(_tenant,_actor);
 if public.current_user_tenant_id() is distinct from _tenant then raise exception 'MCP_FORBIDDEN' using errcode='42501'; end if;
 select c.zapier_generation into generation from public.tenant_mcp_connections c
  where c.tenant_id=_tenant and c.provider='zapier' for update;
 if generation is distinct from _generation then return false; end if;
 perform set_config('paige.zapier_mcp_write','disconnect',true);
 perform public.clear_tenant_mcp_connection('zapier',_tenant);
 perform set_config('paige.zapier_mcp_write','',true);
 return true;
end $$;
revoke all on function public.disconnect_tenant_zapier_mcp(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.disconnect_tenant_zapier_mcp(uuid,uuid,uuid) to authenticated;

-- Explicitly retain restricted existing service-only credential boundaries.
revoke all on function public.get_tenant_mcp_secret(uuid,text) from public,anon,authenticated;
grant execute on function public.get_tenant_mcp_secret(uuid,text) to service_role;
revoke all on function public.set_tenant_zapier_mcp_connection(uuid,text,text,text,timestamptz,text,text,text,text[],text,uuid) from public,anon,authenticated;
grant execute on function public.set_tenant_zapier_mcp_connection(uuid,text,text,text,timestamptz,text,text,text,text[],text,uuid) to service_role;

commit;
