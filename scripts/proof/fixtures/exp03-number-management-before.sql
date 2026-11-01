-- Original deployed function-source fixture only, read 2026-10-30.
-- No tenant rows, credentials, provider effects or production execution.
CREATE OR REPLACE FUNCTION public.tenant_phone_number_rename(_id uuid, _friendly_name text, _tenant_id uuid DEFAULT NULL::uuid)
 RETURNS tenant_phone_numbers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_tenant uuid;
  v_row public.tenant_phone_numbers;
  v_name text;
begin
  if _id is null then
    raise exception 'NUMBER_ID_REQUIRED' using hint = 'NUMBER_ID_REQUIRED';
  end if;

  if v_caller is null then
    if _tenant_id is null then
      raise exception 'TENANT_REQUIRED_FOR_SERVICE_CALLER' using hint = 'TENANT_REQUIRED';
    end if;
    v_tenant := _tenant_id;
  else
    v_tenant := public.current_user_tenant_id();
    if v_tenant is null then
      raise exception 'NO_TENANT_FOR_CALLER' using hint = 'NO_TENANT';
    end if;
    if _tenant_id is not null and _tenant_id <> v_tenant and not public.is_platform_owner() then
      raise exception 'TENANT_MISMATCH' using hint = 'TENANT_MISMATCH';
    end if;
    if _tenant_id is not null and public.is_platform_owner() then
      v_tenant := _tenant_id;
    end if;
    if not (public.is_platform_owner()
            or public.has_any_role(v_caller, array['admin'])) then
      raise exception 'FORBIDDEN' using hint = 'FORBIDDEN';
    end if;
  end if;

  -- '' CLEARS the name; NULL also clears. This is the difference from
  -- `import_tenant_phone_number`, which coalesces and therefore cannot remove a label someone
  -- no longer wants — a control that can set but never unset is a control that half works.
  v_name := nullif(btrim(coalesce(_friendly_name, '')), '');
  if length(coalesce(v_name, '')) > 120 then
    raise exception 'NAME_TOO_LONG' using hint = 'NAME_TOO_LONG';
  end if;

  update public.tenant_phone_numbers
     set friendly_name = v_name, updated_at = now()
   where id = _id and tenant_id = v_tenant
  returning * into v_row;

  if not found then
    raise exception 'NUMBER_NOT_FOUND' using hint = 'NUMBER_NOT_FOUND';
  end if;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_phone_number_set_primary(_id uuid, _tenant_id uuid DEFAULT NULL::uuid)
 RETURNS tenant_phone_numbers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_tenant uuid;
  v_row public.tenant_phone_numbers;
begin
  if _id is null then
    raise exception 'NUMBER_ID_REQUIRED' using hint = 'NUMBER_ID_REQUIRED';
  end if;

  if v_caller is null then
    -- Service/trusted context. It must NAME the tenant; there is no session to infer one from,
    -- and guessing would be a cross-tenant write with no caller to blame.
    if _tenant_id is null then
      raise exception 'TENANT_REQUIRED_FOR_SERVICE_CALLER' using hint = 'TENANT_REQUIRED';
    end if;
    v_tenant := _tenant_id;
  else
    v_tenant := public.current_user_tenant_id();
    if v_tenant is null then
      raise exception 'NO_TENANT_FOR_CALLER' using hint = 'NO_TENANT';
    end if;
    -- A caller-supplied tenant is honoured ONLY when it agrees with the session's own, so the
    -- parameter can never be used to point this write at somebody else's workspace (§9).
    if _tenant_id is not null and _tenant_id <> v_tenant and not public.is_platform_owner() then
      raise exception 'TENANT_MISMATCH' using hint = 'TENANT_MISMATCH';
    end if;
    if _tenant_id is not null and public.is_platform_owner() then
      v_tenant := _tenant_id;
    end if;
    if not (public.is_platform_owner()
            or public.has_any_role(v_caller, array['admin'])) then
      raise exception 'FORBIDDEN' using hint = 'FORBIDDEN';
    end if;
  end if;

  -- Serialise per tenant BEFORE reading. `select ... for update` locks only the target row,
  -- so when a workspace currently has NO primary — the state of every workspace between its
  -- first purchase and its first choice — two concurrent calls both clear zero rows and both
  -- then try to set one. The second loses to `uq_tenant_phone_numbers_primary` with a raw
  -- 23505 that carries no hint, so it surfaces to the person as "try again in a moment"
  -- instead of what happened. Nothing corrupts either way; the advisory lock makes the second
  -- caller wait and then succeed, which is what they asked for.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 0));

  -- The row must be THIS tenant's, and it must be usable. Making a released or suspended number
  -- primary would point every outbound call at a number that cannot carry one.
  select * into v_row
  from public.tenant_phone_numbers
  where id = _id and tenant_id = v_tenant
  for update;

  if not found then
    raise exception 'NUMBER_NOT_FOUND' using hint = 'NUMBER_NOT_FOUND';
  end if;
  if v_row.status <> 'active' then
    raise exception 'NUMBER_NOT_ACTIVE' using hint = 'NUMBER_NOT_ACTIVE';
  end if;

  -- Clear first, then set. `uq_tenant_phone_numbers_primary` is a partial UNIQUE on
  -- (tenant_id) WHERE is_primary, so setting before clearing would violate it.
  update public.tenant_phone_numbers
     set is_primary = false, updated_at = now()
   where tenant_id = v_tenant and is_primary and id <> _id;

  update public.tenant_phone_numbers
     set is_primary = true, updated_at = now()
   where id = _id
  returning * into v_row;

  return v_row;
end;
$function$
;

