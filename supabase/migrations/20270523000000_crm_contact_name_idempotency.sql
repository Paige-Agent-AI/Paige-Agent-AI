-- INT-140 (20270523000000, renumbered from 20270411000000 after main took that version): one canonical identity projection for governed CRM replay hashing.
--
-- The authenticated Edge action door constructs __paige_canonical_identity_v1 only after its
-- strict request parser and canonical command boundary. The executable command keeps the display
-- spelling; this function exposes only the server-derived identity spelling to idempotency hashes.
-- A malformed or mismatched internal projection is ignored and the actual command remains the hash
-- source, so even a trusted internal caller cannot accidentally alias a different action.
create or replace function public.crm_effective_command(_command jsonb)
returns jsonb language sql immutable set search_path='' as $$
  with source as (
    select case
      when pg_catalog.jsonb_typeof(_command->'__paige_canonical_identity_v1')='object'
        and _command->'__paige_canonical_identity_v1'->>'action'=_command->>'action'
      then (_command->'__paige_canonical_identity_v1')
        || case when _command ? 'approval_channel'
          then pg_catalog.jsonb_build_object('approval_channel',_command->'approval_channel')
          else '{}'::jsonb end
      else _command-'__paige_canonical_identity_v1'-'__paige_legacy_display_v1'
    end as command
  )
  select case when command->>'action' in ('deal.assign_owner','deal.assign_contact') then
    pg_catalog.jsonb_build_object(
      'action','deal.update','deal_id',command->>'deal_id','expected_version',command->'expected_version',
      'receipt_action',command->>'action','approval_channel',command->>'approval_channel'
    )
    || case when command->>'action'='deal.assign_owner' then pg_catalog.jsonb_build_object('owner_user_id',command->'owner_user_id') else '{}'::jsonb end
    || case when command->>'action'='deal.assign_contact' then pg_catalog.jsonb_build_object('contact_id',command->'contact_id') else '{}'::jsonb end
  else command end
  from source
$$;
revoke all on function public.crm_effective_command(jsonb) from public,anon,authenticated,service_role;

-- Rows written before this migration retain the display-command hash. New rows use the canonical
-- identity hash. During a lost-response retry, accept the old hash only for a contact.create command
-- carrying the server-derived identity envelope; every other action and malformed envelope remains
-- exact-hash-only. This is a read/replay compatibility seam, never a second write identity.
create or replace function public.crm_command_hash_matches(
  _stored_hash text,
  _effective_hash text,
  _command jsonb
) returns boolean language sql immutable set search_path='' as $$
  select coalesce(
    _stored_hash=_effective_hash
    or (
      _command->>'action'='contact.create'
      and pg_catalog.jsonb_typeof(_command->'__paige_canonical_identity_v1')='object'
      and _command->'__paige_canonical_identity_v1'->>'action'=_command->>'action'
      and (
        _stored_hash=pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to((_command-'__paige_canonical_identity_v1'-'__paige_legacy_display_v1')::text,'UTF8'),
            'sha256'
          ),
          'hex'
        )
        or (
          pg_catalog.jsonb_typeof(_command->'__paige_legacy_display_v1')='object'
          and _command->'__paige_legacy_display_v1'->>'action'=_command->>'action'
          and _stored_hash=pg_catalog.encode(
            extensions.digest(
              pg_catalog.convert_to(
                (
                  (_command->'__paige_legacy_display_v1')
                  || case when _command ? 'approval_channel'
                    then pg_catalog.jsonb_build_object('approval_channel',_command->'approval_channel')
                    else '{}'::jsonb end
                )::text,
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          )
        )
      )
    ),
    false
  )
$$;
revoke all on function public.crm_command_hash_matches(text,text,jsonb) from public,anon,authenticated,service_role;

-- Patch only the installed hash/check expressions and the governed contact-create name guard. This
-- preserves every later authorization and readback hardening in the three functions. Each expected
-- predecessor must occur exactly once; otherwise migration application fails closed.
do $migration$
declare
  definition text;
  rewritten text;
  old_expression constant text := 'v_hash := encode(extensions.digest(convert_to(_command::text, ''UTF8''), ''sha256''), ''hex'');';
  new_expression constant text := 'v_hash := encode(extensions.digest(convert_to(public.crm_effective_command(_command)::text, ''UTF8''), ''sha256''), ''hex'');';
  old_reversible_match constant text := 'if v_cached.command_hash <> v_hash then';
  new_reversible_match constant text := 'if not public.crm_command_hash_matches(v_cached.command_hash,v_hash,_command) then';
  old_execute_match constant text := 'if v_cached.command_hash<>v_hash then';
  new_execute_match constant text := 'if not public.crm_command_hash_matches(v_cached.command_hash,v_hash,_command) then';
  old_read_match constant text := 'if v_cached.command_hash not in (v_operator_hash,v_standing_hash) then';
  new_read_match constant text := 'if not (public.crm_command_hash_matches(v_cached.command_hash,v_operator_hash,_command||pg_catalog.jsonb_build_object(''approval_channel'',''operator_card'')) or public.crm_command_hash_matches(v_cached.command_hash,v_standing_hash,_command||pg_catalog.jsonb_build_object(''approval_channel'',''standing_autonomy_setting''))) then';
  old_contact_create constant text := 'select * into v_created from public.create_contact_v2(';
  new_contact_create constant text := 'if nullif(btrim(v_patch->>''first_name''),'''') is null or nullif(btrim(v_patch->>''last_name''),'''') is null then raise exception ''CRM_CONTACT_NAME_INCOMPLETE'' using errcode=''22023''; end if;' || pg_catalog.chr(10) || '    select * into v_created from public.create_contact_v2(';
begin
  select pg_catalog.pg_get_functiondef('public.execute_crm_command_reversible(uuid,uuid,jsonb,text)'::pg_catalog.regprocedure)
    into definition;
  if definition is null
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,old_expression,'')))
      / pg_catalog.length(old_expression) <> 1 then
    raise exception 'CRM_IDEMPOTENCY_HASH_PATCH_DRIFT';
  end if;
  rewritten := pg_catalog.replace(definition,old_expression,new_expression);
  if (pg_catalog.length(rewritten)-pg_catalog.length(pg_catalog.replace(rewritten,old_reversible_match,'')))
      / pg_catalog.length(old_reversible_match) <> 1 then
    raise exception 'CRM_IDEMPOTENCY_REPLAY_PATCH_DRIFT';
  end if;
  rewritten := pg_catalog.replace(rewritten,old_reversible_match,new_reversible_match);
  if (pg_catalog.length(rewritten)-pg_catalog.length(pg_catalog.replace(rewritten,old_contact_create,'')))
      / pg_catalog.length(old_contact_create) <> 1 then
    raise exception 'CRM_CONTACT_NAME_GUARD_PATCH_DRIFT';
  end if;
  rewritten := pg_catalog.replace(rewritten,old_contact_create,new_contact_create);
  execute rewritten;

  select pg_catalog.pg_get_functiondef('public.execute_crm_command(uuid,uuid,jsonb,text)'::pg_catalog.regprocedure)
    into definition;
  if definition is null
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,old_execute_match,'')))
      / pg_catalog.length(old_execute_match) <> 1 then
    raise exception 'CRM_IDEMPOTENCY_EXECUTE_PATCH_DRIFT';
  end if;
  execute pg_catalog.replace(definition,old_execute_match,new_execute_match);

  select pg_catalog.pg_get_functiondef('public.read_crm_command_result(uuid,uuid,jsonb,text)'::pg_catalog.regprocedure)
    into definition;
  if definition is null
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,old_read_match,'')))
      / pg_catalog.length(old_read_match) <> 1 then
    raise exception 'CRM_IDEMPOTENCY_READ_PATCH_DRIFT';
  end if;
  execute pg_catalog.replace(definition,old_read_match,new_read_match);
end
$migration$;

comment on function public.crm_effective_command(jsonb) is
  'Server-only effective CRM command projection used by readback and execution idempotency hashes. Preserves executable display values while hashing the action-door-derived canonical identity.';
comment on function public.crm_command_hash_matches(text,text,jsonb) is
  'Server-only exact hash matcher with a narrow pre-rollout contact-create replay fallback (pre-20270523000000). The authenticated action door admits a legacy display projection only after proving it canonicalizes to the same command identity.';
