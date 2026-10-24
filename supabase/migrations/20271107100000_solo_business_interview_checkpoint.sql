-- Experience 01 S1: EXTEND the existing private transcript with a bounded position.
-- CLI-generated as 20261012191452; forward-numbered after main's 20271025000100.
-- No business values, claims of confirmation, approval, or second onboarding store.
-- Existing append metadata is caller-supplied, so even a valid checkpoint is only
-- a navigation hint. Consumers MUST independently re-read canonical Setup facts.
begin;

create or replace function public.solo_business_interview_assert_thread(
  _thread_id uuid, _expected_tenant_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tid uuid;
begin
  if v_uid is null or _thread_id is null then
    raise exception 'An authenticated private Solo interview thread is required' using errcode='42501';
  end if;
  -- Keep workspace selection, tenant lifecycle, role and thread shape stable
  -- for this transaction. Lock order agrees with canonical Setup: profile,
  -- context meta, then tenant. Taking tenant first would invert a co-owner save.
  perform 1 from public.profiles where user_id=v_uid for share;
  if not found then raise exception 'Workspace selection is unavailable' using errcode='42501'; end if;
  v_tid := public.solo_setup_assert_canonical_tenant();
  if _expected_tenant_id is not null and v_tid is distinct from _expected_tenant_id then
    raise exception 'The active workspace changed. Reopen the interview.'
      using errcode='40001',hint='SETUP_TENANT_CHANGED';
  end if;
  perform 1 from public.tenant_setup_business_context_meta m where m.tenant_id=v_tid for share;
  perform 1 from public.tenants t
    where t.id=v_tid and t.account_type::text='standalone' and t.parent_tenant_id is null
      and t.status::text in ('trial','active') and t.archived_at is null
      and not coalesce(t.lifecycle_execution_paused,false)
      and t.features->'system_workspace' is distinct from 'true'::jsonb
    for share;
  if not found then raise exception 'An active top-level Solo workspace is required' using errcode='42501'; end if;
  -- Require a CURRENT active membership as well as canonical Owner scope.
  -- owner_user_id alone, platform/support access or stale JWT claims cannot
  -- preserve permission after a membership is revoked.
  perform 1 from public.tenant_members m where m.tenant_id=v_tid and m.user_id=v_uid
    and m.status='active' and m.is_owner for share;
  if not found or not public.is_tenant_owner(v_uid,v_tid)
    or public.solo_setup_access_scope() is distinct from 'owner_full' then
    raise exception 'Only the current Solo workspace Owner may use this interview' using errcode='42501';
  end if;
  perform 1 from public.paige_chat_threads t where t.id=_thread_id
    and t.caller_user_id=v_uid and t.tenant_id=v_tid and t.lens='coach'
    and t.contact_id is null and t.studio_session_id is null and not t.is_archived for update;
  if not found then raise exception 'This private Solo interview thread is unavailable' using errcode='42501'; end if;
  return v_tid;
end $$;
revoke all on function public.solo_business_interview_assert_thread(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.get_solo_business_interview_checkpoint(_thread_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tid uuid := public.solo_business_interview_assert_thread(_thread_id);
  v_turn public.paige_chat_turns%rowtype;
  v_checkpoint jsonb;
  v_fields constant text[] := array['publicName','industry','offers','deliveryModel','idealCustomer',
    'currentPriority','goals90Day','constraints','operatingPreferences','doNotAssume'];
begin
  select * into v_turn from public.paige_chat_turns t
    where t.thread_id=_thread_id and t.role='user' and t.interactive_terminal_state is null
      and t.work_id is null and t.bundle_ref ? 'solo_business_interview'
    order by t.seq desc limit 1;
  if not found then return null; end if;
  v_checkpoint := v_turn.bundle_ref->'solo_business_interview';
  -- Fail closed on malformed/caller-forged metadata; do not fall back to an
  -- older checkpoint after the newest namespace becomes invalid. No raw bundle
  -- or conversation content crosses this RPC.
  if jsonb_typeof(v_turn.bundle_ref) is distinct from 'object'
    or jsonb_typeof(v_checkpoint) is distinct from 'object' or pg_column_size(v_checkpoint)>2048 then return null; end if;
  if exists(select 1 from jsonb_object_keys(v_checkpoint) k where not k=any(array[
      'version','phase','nextField','sourceTurnId','sourceTurnSeq','updatedAt','contextRevisionAtCheckpoint']))
    or not (v_checkpoint ?& array['version','phase','nextField','sourceTurnId','sourceTurnSeq','updatedAt','contextRevisionAtCheckpoint'])
    or v_checkpoint->'version' is distinct from '1'::jsonb
    or jsonb_typeof(v_checkpoint->'phase') is distinct from 'string'
    or v_checkpoint->>'phase' not in ('active','paused','completed')
    or jsonb_typeof(v_checkpoint->'nextField') not in ('string','null')
    or (v_checkpoint->'nextField'<>'null'::jsonb and not (v_checkpoint->>'nextField'=any(v_fields)))
    or (v_checkpoint->>'phase'='completed' and v_checkpoint->'nextField'<>'null'::jsonb)
    or v_checkpoint->'sourceTurnId' is distinct from to_jsonb(v_turn.id::text)
    or v_checkpoint->'sourceTurnSeq' is distinct from to_jsonb(v_turn.seq)
    or jsonb_typeof(v_checkpoint->'updatedAt') is distinct from 'string'
    or char_length(v_checkpoint->>'updatedAt') not between 20 and 64
    or v_checkpoint->>'updatedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
    or jsonb_typeof(v_checkpoint->'contextRevisionAtCheckpoint') not in ('number','null')
    or (v_checkpoint->'contextRevisionAtCheckpoint'<>'null'::jsonb and
      (v_checkpoint->>'contextRevisionAtCheckpoint' !~ '^(0|[1-9][0-9]{0,15})$')) then return null; end if;
  if v_turn.seq<1 or v_turn.seq>9007199254740991
    or (v_checkpoint->'contextRevisionAtCheckpoint'<>'null'::jsonb
      and (v_checkpoint->>'contextRevisionAtCheckpoint')::bigint>9007199254740991) then return null; end if;
  return jsonb_build_object('tenantId',v_tid,'threadId',_thread_id,
    'phase',v_checkpoint->'phase','nextField',v_checkpoint->'nextField',
    'sourceTurnId',v_turn.id,'sourceTurnSeq',v_turn.seq,
    'checkpointUpdatedAt',v_checkpoint->'updatedAt',
    'contextRevisionAtCheckpoint',v_checkpoint->'contextRevisionAtCheckpoint');
end $$;
revoke all on function public.get_solo_business_interview_checkpoint(uuid) from public,anon,service_role;
grant execute on function public.get_solo_business_interview_checkpoint(uuid) to authenticated;

create or replace function public.save_solo_business_interview_checkpoint(
  _thread_id uuid, _expected_tenant_id uuid, _checkpoint jsonb,
  _expected_context_revision bigint default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tid uuid;
  v_turn public.paige_chat_turns%rowtype;
  v_revision bigint;
  v_checkpoint jsonb;
  v_existing jsonb;
  v_fields constant text[] := array['publicName','industry','offers','deliveryModel','idealCustomer',
    'currentPriority','goals90Day','constraints','operatingPreferences','doNotAssume'];
begin
  if _expected_tenant_id is null then raise exception 'The expected Solo workspace is required' using errcode='42501'; end if;
  v_tid := public.solo_business_interview_assert_thread(_thread_id,_expected_tenant_id);
  if jsonb_typeof(_checkpoint) is distinct from 'object' or pg_column_size(_checkpoint)>1024 then
    raise exception 'The interview position must be a bounded object' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(_checkpoint) k where k not in ('phase','nextField'))
    or not (_checkpoint ?& array['phase','nextField'])
    or jsonb_typeof(_checkpoint->'phase') is distinct from 'string'
    or _checkpoint->>'phase' not in ('active','paused','completed')
    or jsonb_typeof(_checkpoint->'nextField') not in ('string','null')
    or (_checkpoint->'nextField'<>'null'::jsonb and not (_checkpoint->>'nextField'=any(v_fields)))
    or (_checkpoint->>'phase'='completed' and _checkpoint->'nextField'<>'null'::jsonb) then
    raise exception 'Only an interview phase and a canonical operational field pointer are accepted' using errcode='22023';
  end if;
  if _expected_context_revision is not null then
    if _expected_context_revision<0 or _expected_context_revision>9007199254740991 then
      raise exception 'The Setup revision is invalid' using errcode='22023';
    end if;
    select m.revision into v_revision from public.tenant_setup_business_context_meta m
      where m.tenant_id=v_tid for share;
    if coalesce(v_revision,0) is distinct from _expected_context_revision then
      raise exception 'Setup changed. Read the current profile before continuing.' using errcode='40001',hint='SETUP_CONFLICT';
    end if;
  end if;
  select * into v_turn from public.paige_chat_turns t where t.thread_id=_thread_id
    and t.role='user' and t.interactive_terminal_state is null and t.work_id is null
    order by t.seq desc limit 1 for update;
  if not found then
    raise exception 'Send a business interview reply before saving its position' using errcode='55000',hint='INTERVIEW_TURN_REQUIRED';
  end if;
  if v_turn.bundle_ref is not null and jsonb_typeof(v_turn.bundle_ref)<>'object' then
    raise exception 'The current conversation metadata cannot be updated safely' using errcode='55000';
  end if;
  v_existing := public.get_solo_business_interview_checkpoint(_thread_id);
  if v_existing->>'sourceTurnId'=v_turn.id::text
    and v_existing->'phase'=_checkpoint->'phase' and v_existing->'nextField'=_checkpoint->'nextField'
    and v_existing->'contextRevisionAtCheckpoint' is not distinct from coalesce(to_jsonb(_expected_context_revision),'null'::jsonb) then
    return v_existing;
  end if;
  v_checkpoint := jsonb_build_object('version',1,'phase',_checkpoint->'phase','nextField',_checkpoint->'nextField',
    'sourceTurnId',v_turn.id,'sourceTurnSeq',v_turn.seq,'updatedAt',clock_timestamp(),
    'contextRevisionAtCheckpoint',_expected_context_revision);
  update public.paige_chat_turns set bundle_ref=jsonb_set(coalesce(bundle_ref,'{}'::jsonb),'{solo_business_interview}',v_checkpoint,true)
    where id=v_turn.id;
  -- No turn is appended and no assistant/system row, content, ASK_USER/approval
  -- state, thread counter, retention, timestamp, protected column or unrelated
  -- metadata is changed. A normal typed USER turn carries server-issued intent
  -- columns; its position sidecar leaves them byte-identical. Issued assistant
  -- settlement compares the entire bundle, so it must never be a target.
  return public.get_solo_business_interview_checkpoint(_thread_id);
end $$;
revoke all on function public.save_solo_business_interview_checkpoint(uuid,uuid,jsonb,bigint) from public,anon,service_role;
grant execute on function public.save_solo_business_interview_checkpoint(uuid,uuid,jsonb,bigint) to authenticated;

comment on function public.get_solo_business_interview_checkpoint(uuid) is
  'Owner-only private Solo interview position. Metadata is not canonical facts, a receipt, memory or approval; always re-read Setup.';
comment on function public.save_solo_business_interview_checkpoint(uuid,uuid,jsonb,bigint) is
  'Updates only a latest genuine private Solo USER turn''s bounded interview namespace, excluding terminal/work receipts. Protected columns and assistant bundles are unchanged; no fact is saved here.';
commit;
