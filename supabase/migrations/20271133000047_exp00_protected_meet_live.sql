-- EXP00: the checkout browser grant admits only the existing private Meet PAIGE
-- conversation. This path never creates a general Auth session or a new tenant.
begin;

alter table public.solo_beta_protected_signup_intake
  add column meet_thread_id uuid unique references public.paige_chat_threads(id) on delete set null,
  add column meet_turn_count integer not null default 0 check (meet_turn_count between 0 and 24),
  add column meet_greeting_count integer not null default 0 check (meet_greeting_count between 0 and 12),
  add column meet_turn_claim uuid,
  add column meet_turn_claimed_at timestamptz;

alter table public.paige_live_sessions
  add column protected_meet_reference_id uuid references public.solo_beta_protected_signup_intake(reference_id) on delete restrict,
  add column protected_meet_connection_id uuid,
  add constraint paige_live_sessions_protected_meet_connection check (
    (protected_meet_reference_id is null) = (protected_meet_connection_id is null)
  );
create unique index paige_live_sessions_protected_meet_current
  on public.paige_live_sessions(protected_meet_reference_id)
  where protected_meet_reference_id is not null and state <> 'ended';

-- One entitlement/owner/readback for initial control and continuing sockets.
-- The session gate never trusts the browser for actor, tenant, thread or scope.
create function public.solo_beta_protected_meet_scope(_reference_id uuid)
returns table (owner_id uuid, tenant_id uuid, thread_id uuid, deadline_at timestamptz, verified boolean)
language sql security definer stable set search_path = '' as $$
  select u.id,t.id,i.meet_thread_id,a.verification_deadline_at,u.email_confirmed_at is not null
  from public.solo_beta_protected_signup_intake i
  join public.solo_beta_protected_checkout_attempts a on a.reference_id=i.reference_id
  cross join lateral public.solo_beta_read_protected_workspace(i.reference_id,i.owner_user_id,i.provider_livemode) w
  join auth.users u on u.id=w.owner_user_id
  join public.tenants t on t.id=w.tenant_id and t.archived_at is null
    and not coalesce(t.lifecycle_execution_paused,false)
    and t.features->'system_workspace' is distinct from 'true'::jsonb
  join public.profiles p on p.user_id=u.id and p.active_tenant_id=t.id
  where auth.role()='service_role' and i.reference_id=_reference_id
    and (u.email_confirmed_at is not null or (a.trial_started_at<=now() and a.trial_ends_at>now()
      and coalesce(a.provider_state,'trialing')='trialing' and coalesce(a.provider_cancel_at_period_end,true)));
$$;
revoke all on function public.solo_beta_protected_meet_scope(uuid) from public,anon,authenticated;

create function public.solo_beta_protected_meet_relay_current(_session_id uuid, _connection_id uuid default null)
returns boolean language sql security definer stable set search_path = '' as $$
  select auth.role()='service_role' and exists (
    select 1 from public.paige_live_sessions l
    cross join lateral public.solo_beta_protected_meet_scope(l.protected_meet_reference_id) s
    join public.paige_chat_threads th on th.id=s.thread_id and th.caller_user_id=s.owner_id
      and th.tenant_id=s.tenant_id and th.lens='coach' and th.audience='workspace'
      and th.contact_id is null and th.studio_session_id is null and not th.is_archived
    where l.id=_session_id and l.protected_meet_reference_id is not null and not s.verified
      and s.deadline_at>now() and l.tenant_id=s.tenant_id and l.actor_user_id=s.owner_id and l.thread_id=s.thread_id
      and (_connection_id is null or l.protected_meet_connection_id=_connection_id)
      and l.state in ('connecting','listening','thinking','speaking','interrupted','held')
  );
$$;
revoke all on function public.solo_beta_protected_meet_relay_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.solo_beta_protected_meet_relay_current(uuid,uuid) to service_role;

create function public.solo_beta_protected_meet_control(
  _reference_id uuid, _resume_secret_hash text, _return_origin text, _operation text,
  _session_id uuid default null, _ticket_digest text default null, _transition text default null,
  _runtime_digest text default null, _claim uuid default null, _transcript text default null, _answer text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  intake public.solo_beta_protected_signup_intake;
  scoped record;
  live_session public.paige_live_sessions;
  v_thread_id uuid;
  v_epoch text;
  claimed uuid;
  history jsonb;
  acknowledged boolean;
  owner_turn_id uuid;
  owner_turn_seq bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'PROTECTED_MEET_FORBIDDEN' using errcode='42501';
  end if;
  if _operation is null or _operation not in (
    'context','resume_context','acknowledge','relay','transition','voice_claim','typed_claim','save_turn','greeting','greeting_current'
  ) then return null; end if;
  select * into intake from public.solo_beta_protected_signup_intake i
  where i.reference_id=_reference_id and i.resume_secret_hash=_resume_secret_hash and i.return_origin=_return_origin
  for update;
  if not found then return null; end if;
  select * into scoped from public.solo_beta_protected_meet_scope(_reference_id);
  if not found then return null; end if;
  if scoped.verified then return jsonb_build_object('code','canonical_sign_in_required'); end if;
  if scoped.deadline_at<=now() then return null; end if;
  v_thread_id := scoped.thread_id;

  -- Only this serialized paid enrollment can create its private coach thread.
  if v_thread_id is null and _operation='context' then
    insert into public.paige_chat_threads(caller_user_id,tenant_id,lens,title,auto_delete_at)
    values (scoped.owner_id,scoped.tenant_id,'coach','Meet PAIGE',now()+interval '90 days')
    returning id into v_thread_id;
    update public.solo_beta_protected_signup_intake
      set meet_thread_id=v_thread_id where reference_id=_reference_id;
  end if;
  if not exists (
    select 1 from public.paige_chat_threads th where th.id=v_thread_id and th.caller_user_id=scoped.owner_id
      and th.tenant_id=scoped.tenant_id and th.lens='coach' and th.audience='workspace'
      and th.contact_id is null and th.studio_session_id is null and not th.is_archived
  ) then return null; end if;
  v_epoch := scoped.tenant_id::text||'|protected-meet|'||v_thread_id::text;
  acknowledged := public.paige_live_acknowledgement_current_internal(scoped.owner_id,scoped.tenant_id);
  if _operation='context' then
    select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'role',h.role,'content',h.content) order by h.seq),'[]'::jsonb)
      into history from (
        select pt.id,pt.role,left(pt.content,3200) as content,pt.seq from public.paige_chat_turns pt
        where pt.thread_id=v_thread_id and pt.role in ('user','assistant')
        order by pt.seq desc limit 24
      ) h;
    return jsonb_build_object('thread_id',v_thread_id,'context_epoch',v_epoch,'acknowledged',acknowledged,'transcript',history);
  elsif _operation='resume_context' then
    return jsonb_build_object('thread_id',v_thread_id,'context_epoch',v_epoch,'acknowledged',acknowledged);
  end if;

  if _operation='acknowledge' then
    -- Same consent record and readiness checks as the authenticated self-service acknowledgment.
    if not public.live_conversation_tier_allows(scoped.tenant_id) or exists (
      select 1 from public.paige_live_tenant_availability a where a.tenant_id=scoped.tenant_id and not a.enabled
    ) then return null; end if;
    if not acknowledged then
      insert into public.paige_live_pilot_subjects(
        user_id,tenant_id,admitted_by,admitted_at,expires_at,accepted_default_provider_retention,
        accepted_procedural_single_speaker,acceptance_actor_user_id,updated_at
      ) values (scoped.owner_id,scoped.tenant_id,scoped.owner_id,now(),scoped.deadline_at,
        true,true,scoped.owner_id,now())
      on conflict (user_id,tenant_id) do update set admitted_by=excluded.admitted_by,admitted_at=now(),
        revoked_at=null,expires_at=excluded.expires_at,accepted_default_provider_retention=true,
        accepted_procedural_single_speaker=true,acceptance_actor_user_id=excluded.acceptance_actor_user_id,updated_at=now();
      insert into public.paige_audit_log(actor_user_id,actor_role,action,target_type,tenant_id,payload)
        values (scoped.owner_id,'authenticated','paige_live.accept_terms','paige_live_pilot_subjects',scoped.tenant_id,
          jsonb_build_object('retention_state','default_provider_retention','zero_retention_state','UNAVAILABLE',
            'single_speaker_acceptance','procedural_only','entry','protected_solo_checkout'));
    end if;
    return jsonb_build_object('accepted',true,'unchanged',acknowledged);
  end if;

  if _operation in ('greeting','greeting_current') then
    -- Hearing even a fixed provider-generated cue requires the same current
    -- personal acknowledgment and rollout as any other Live audio.
    if not public.paige_live_pilot_authorized_internal(scoped.owner_id,scoped.tenant_id) then
      return jsonb_build_object('code','live_audio_not_enabled');
    end if;
    if _operation='greeting_current' then return jsonb_build_object('ok',true); end if;
    if intake.meet_greeting_count>=12 then return null; end if;
    update public.solo_beta_protected_signup_intake
      set meet_greeting_count=meet_greeting_count+1 where reference_id=_reference_id;
    return jsonb_build_object('ok',true);
  end if;

  if _operation in ('relay','voice_claim') and
    not public.paige_live_pilot_authorized_internal(scoped.owner_id,scoped.tenant_id) then
    return jsonb_build_object('code','live_audio_not_enabled');
  end if;
  if _operation in ('relay','transition','voice_claim') then
    select * into live_session from public.paige_live_sessions l
      where l.protected_meet_reference_id=_reference_id
        and l.tenant_id=scoped.tenant_id and l.actor_user_id=scoped.owner_id and l.thread_id=v_thread_id
        and l.context_epoch=v_epoch and l.state<>'ended'
        and (_session_id is null or l.id=_session_id)
      for update;
    if not found and (_operation<>'relay' or _session_id is not null) then return null; end if;
  end if;

  if _operation='relay' then
    if _ticket_digest is null or _ticket_digest!~'^ticket:[0-9a-f]{64}$' then return null; end if;
    if live_session.id is null then
      insert into public.paige_live_sessions(
        tenant_id,actor_user_id,thread_id,context_epoch,entry_mode,state,availability,
        provider_session_ref,protected_meet_reference_id,protected_meet_connection_id)
      values (scoped.tenant_id,scoped.owner_id,v_thread_id,v_epoch,'embedded','connecting','PROOF OWED',
        _ticket_digest,_reference_id,gen_random_uuid()) returning * into live_session;
    else
      update public.paige_live_sessions set provider_session_ref=_ticket_digest,
        protected_meet_connection_id=gen_random_uuid(),state='reconnecting',availability='PROOF OWED',
        updated_at=now() where id=live_session.id;
    end if;
    return jsonb_build_object('ok',true,'session_id',live_session.id,'availability','PROOF OWED','code','relay_ticket_issued');
  end if;

  if _operation='transition' then
    if _session_id is null or _transition is null or _transition not in ('hold','resume','minimize','restore','retry','end') then
      return null;
    end if;
    return public.paige_live_session_transition_internal(scoped.owner_id,scoped.tenant_id,v_thread_id,v_epoch,_session_id,_transition);
  end if;

  if _operation in ('voice_claim','typed_claim') then
    if intake.meet_turn_count>=24 or intake.meet_turn_claimed_at>now()-interval '60 seconds' then return null; end if;
    if _operation='voice_claim' then
      if _session_id is null or _runtime_digest is null or _runtime_digest!~'^runtime:[0-9a-f]{64}$'
        or live_session.provider_session_ref is distinct from _runtime_digest or live_session.availability<>'LIVE'
        or live_session.state not in ('listening','thinking','speaking','interrupted') then return null; end if;
      update public.paige_live_sessions set provider_session_ref=null where id=live_session.id;
    end if;
    claimed := gen_random_uuid();
    update public.solo_beta_protected_signup_intake set meet_turn_claim=claimed,
      meet_turn_claimed_at=now(),meet_turn_count=meet_turn_count+1 where reference_id=_reference_id;
    select coalesce(jsonb_agg(jsonb_build_object('role',h.role,'content',h.content) order by h.seq),'[]'::jsonb)
      into history from (
        select pt.role,left(pt.content,1200) as content,pt.seq from public.paige_chat_turns pt
        where pt.thread_id=v_thread_id and pt.role in ('user','assistant')
        order by pt.seq desc limit 10
      ) h;
    return jsonb_build_object('claim',claimed,'owner_id',scoped.owner_id,'tenant_id',scoped.tenant_id,
      'thread_id',v_thread_id,'context_epoch',v_epoch,'history',history);
  end if;

  if _claim is null or intake.meet_turn_claim is distinct from _claim then return null; end if;
  update public.solo_beta_protected_signup_intake set meet_turn_claim=null,meet_turn_claimed_at=null where reference_id=_reference_id;
  if _answer is null then return jsonb_build_object('ok',true); end if;
  if _session_id is not null and (not public.solo_beta_protected_meet_relay_current(_session_id)
      or not public.paige_live_pilot_authorized_internal(scoped.owner_id,scoped.tenant_id)
      or not exists (select 1 from public.paige_live_sessions l where l.id=_session_id
        and l.protected_meet_reference_id=_reference_id and l.thread_id=v_thread_id)) then return null; end if;
  if _transcript is null or char_length(_transcript) not between 1 and 3200
      or char_length(_answer) not between 1 and 1200 then return null; end if;
  insert into public.paige_chat_turns(thread_id,role,content,surfaces_used)
    values (v_thread_id,'user',_transcript,array['solo_business_interview'])
    returning id,seq into owner_turn_id,owner_turn_seq;
  -- The existing EXP01 checkpoint is navigation only. Preserve the exact
  -- owned thread on verified return without claiming a Setup fact or revision.
  update public.paige_chat_turns set bundle_ref=jsonb_set(coalesce(bundle_ref,'{}'::jsonb),
    '{solo_business_interview}',jsonb_build_object(
      'version',1,'phase','active','nextField',null,'sourceTurnId',owner_turn_id::text,
      'sourceTurnSeq',owner_turn_seq,'updatedAt',clock_timestamp(),'contextRevisionAtCheckpoint',null
    ),true)
    where id=owner_turn_id;
  insert into public.paige_chat_turns(thread_id,role,content,surfaces_used)
    values (v_thread_id,'assistant',_answer,array['solo_business_interview']);
  update public.paige_chat_threads set message_count=message_count+2,last_message_at=now(),
    auto_delete_at=now()+interval '90 days' where id=v_thread_id;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.solo_beta_protected_meet_control(uuid,text,text,text,uuid,text,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.solo_beta_protected_meet_control(uuid,text,text,text,uuid,text,text,text,uuid,text,text) to service_role;

commit;
