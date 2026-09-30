-- Paige Long-Form Capability — durable document authoring on the one work envelope.
--
-- This migration adds no second job table, scheduler, artifact store, transcript, or agreement
-- record. A bounded brief rides paige_durable_work; the worker uses the existing lease/transition
-- contract; the verified draft remains marketing_content; completion reconstructs through the
-- existing Paige chat turn + artifact card. Agreement-shaped output remains a draft artifact only.

alter table public.paige_durable_work
  add column if not exists request_payload jsonb,
  add column if not exists dispatch_started_attempt integer not null default 0;

alter table public.paige_durable_work
  drop constraint if exists paige_durable_work_request_payload_ck;
alter table public.paige_durable_work
  add constraint paige_durable_work_request_payload_ck check (
    request_payload is null
    or (jsonb_typeof(request_payload) = 'object' and pg_column_size(request_payload) <= 65536)
  );
alter table public.paige_durable_work
  drop constraint if exists paige_durable_work_dispatch_attempt_ck;
alter table public.paige_durable_work
  add constraint paige_durable_work_dispatch_attempt_ck check (
    dispatch_started_attempt between 0 and attempt_count
  );

comment on column public.paige_durable_work.request_payload is
  'Immutable bounded internal work input. Never raw document output, web content, credentials, or reusable permission.';
comment on column public.paige_durable_work.dispatch_started_attempt is
  'Highest attempt whose worker crossed the atomic dispatch-start gate. Prevents duplicate provider dispatch within one attempt.';

-- The canonical artifact and transcript gain correlation only. They remain their existing homes.
alter table public.marketing_content
  add column if not exists work_id uuid references public.paige_durable_work(id) on delete set null,
  add column if not exists document_revision integer not null default 1;
alter table public.marketing_content
  drop constraint if exists marketing_content_document_revision_ck;
alter table public.marketing_content
  add constraint marketing_content_document_revision_ck check (document_revision >= 1);
create index if not exists marketing_content_work_idx
  on public.marketing_content(work_id) where work_id is not null;

alter table public.paige_chat_turns
  add column if not exists work_id uuid references public.paige_durable_work(id) on delete set null;
create unique index if not exists paige_chat_turns_work_uk
  on public.paige_chat_turns(work_id) where work_id is not null;

-- request_payload is allowed to move null -> one immutable bounded value inside the submit RPC.
-- Every other identity field remains frozen exactly as in the substrate migration.
create or replace function public._paige_durable_work_protect_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.initiating_user_id is distinct from old.initiating_user_id
     or new.intent_id is distinct from old.intent_id
     or new.thread_id is distinct from old.thread_id
     or new.capability_key is distinct from old.capability_key
     or new.work_kind is distinct from old.work_kind
     or new.authority_context is distinct from old.authority_context
     or new.scope_epoch is distinct from old.scope_epoch
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at
     or (old.request_payload is not null and new.request_payload is distinct from old.request_payload) then
    raise exception 'DURABLE_WORK_IDENTITY_IMMUTABLE' using errcode = '22023';
  end if;
  return new;
end
$$;

-- Authenticated submission: identity, tenant, role, thread, authority snapshot and scope are all
-- resolved on the server. A replay of the same intent returns the same work row and never posts a
-- second worker dispatch. pg_net is merely the wake-up; the row remains the source of truth.
create or replace function public.submit_paige_document_work(
  _intent_id uuid,
  _thread_id uuid,
  _request_payload jsonb
)
returns table (
  work_id uuid,
  work_status text,
  work_version bigint,
  resumed_existing boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  _actor uuid := auth.uid();
  _tenant uuid;
  _created record;
  _stored jsonb;
  _authority jsonb;
  _scope text;
begin
  if _actor is null then
    raise exception 'DURABLE_DOCUMENT_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if _intent_id is null or _thread_id is null then
    raise exception 'DURABLE_DOCUMENT_IDENTITY_REQUIRED' using errcode = '22023';
  end if;
  if _request_payload is null or jsonb_typeof(_request_payload) <> 'object'
     or pg_column_size(_request_payload) > 65536
     or (_request_payload->>'version') is distinct from '1'
     or nullif(btrim(_request_payload->>'title'), '') is null
     or char_length(_request_payload->>'title') > 200
     or nullif(btrim(_request_payload->>'brief'), '') is null
     or char_length(_request_payload->>'brief') > 12000 then
    raise exception 'DURABLE_DOCUMENT_BRIEF_INVALID' using errcode = '22023';
  end if;
  if (_request_payload->>'doc_type') not in (
    'guide','one_pager','ebook','checklist','worksheet','proposal','offer_letter','sales_offer','agreement_draft'
  ) then
    raise exception 'DURABLE_DOCUMENT_TYPE_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(_request_payload) as keys(key)
    where key not in ('version','doc_type','title','brief','audience','purpose','required_facts',
                      'target_content_id','expected_revision')
  ) then
    raise exception 'DURABLE_DOCUMENT_BRIEF_UNKNOWN_FIELD' using errcode = '22023';
  end if;
  if ((_request_payload ? 'target_content_id') <> (_request_payload ? 'expected_revision'))
     or ((_request_payload ? 'target_content_id') and (
       nullif(_request_payload->>'target_content_id', '') is null
       or (_request_payload->>'target_content_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (_request_payload->>'expected_revision') !~ '^[1-9][0-9]*$'
     )) then
    raise exception 'DURABLE_DOCUMENT_REVISION_TARGET_INVALID' using errcode = '22023';
  end if;
  if ((_request_payload ? 'audience') and (
        jsonb_typeof(_request_payload->'audience') <> 'string'
        or nullif(btrim(_request_payload->>'audience'), '') is null
        or char_length(_request_payload->>'audience') > 2000
      )) or ((_request_payload ? 'purpose') and (
        jsonb_typeof(_request_payload->'purpose') <> 'string'
        or nullif(btrim(_request_payload->>'purpose'), '') is null
        or char_length(_request_payload->>'purpose') > 2000
      )) then
    raise exception 'DURABLE_DOCUMENT_CONTEXT_INVALID' using errcode = '22023';
  end if;
  if (_request_payload ? 'required_facts') and jsonb_typeof(_request_payload->'required_facts') <> 'object' then
    raise exception 'DURABLE_DOCUMENT_REQUIRED_FACTS_INVALID' using errcode = '22023';
  end if;
  if (_request_payload ? 'required_facts') and (
    (select count(*) from jsonb_object_keys(_request_payload->'required_facts')) > 50
    or exists (
      select 1 from jsonb_each(_request_payload->'required_facts') as facts(key,value)
       where char_length(key) not between 1 and 100
          or jsonb_typeof(value) not in ('string','number','boolean')
          or (jsonb_typeof(value) = 'string' and (
            nullif(btrim(value #>> '{}'), '') is null or char_length(value #>> '{}') > 2000
          ))
    )
  ) then
    raise exception 'DURABLE_DOCUMENT_REQUIRED_FACTS_INVALID' using errcode = '22023';
  end if;


  select t.tenant_id into _tenant
    from public.paige_chat_threads t
   where t.id = _thread_id
     and t.caller_user_id = _actor
     and not t.is_archived;
  if _tenant is null or _tenant is distinct from public.current_user_tenant_id() then
    raise exception 'DURABLE_DOCUMENT_THREAD_FORBIDDEN' using errcode = '42501';
  end if;
  if not (public.has_tenant_role(_actor, _tenant, 'owner')
      or public.has_tenant_role(_actor, _tenant, 'admin')
      or public.has_tenant_role(_actor, _tenant, 'coach')) then
    raise exception 'DURABLE_DOCUMENT_ROLE_FORBIDDEN' using errcode = '42501';
  end if;

  _authority := jsonb_build_object(
    'tenant_id', _tenant::text,
    'actor_user_id', _actor::text,
    'authority_source', 'server_resolved',
    'role_gate', 'admin_or_coach',
    'approval_reusable', false
  );
  _scope := 'tenant:' || _tenant::text || ':thread:' || _thread_id::text;

  select * into _created
    from public.create_paige_durable_work(
      _tenant, _actor, _intent_id, _thread_id, 'document_generate', 'document_authoring',
      _authority, _scope, 60, 5
    );

  select w.request_payload into _stored
    from public.paige_durable_work w where w.id = _created.work_id for update;
  if _stored is null then
    update public.paige_durable_work
       set request_payload = _request_payload, updated_at = now(), version = version + 1
     where id = _created.work_id;
  elsif _stored is distinct from _request_payload then
    raise exception 'DURABLE_WORK_INTENT_REPLAY_MISMATCH' using errcode = '22023';
  end if;

  -- A replay of active work is also a wake-up. The worker's atomic dispatch gate makes duplicate
  -- delivery harmless, while this closes the lost-first-wake path. Terminal/reconciliation states
  -- are returned truthfully below and are never described as newly resumed work.
  if not _created.resumed_existing or _created.work_status = 'claimed' then
    begin
      perform net.http_post(
        url := 'https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/paige-document-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-token', public.cron_token_header()
        ),
        body := jsonb_build_object('mode', 'run', 'work_id', _created.work_id)
      );
    exception when others then
      -- The one-minute recovery sweep owns a missed wake-up. Submission remains accepted.
      raise warning 'submit_paige_document_work wake-up failed for %: %', _created.work_id, sqlerrm;
    end;
  end if;

  return query
    select _created.work_id, _created.work_status,
           (select w.version from public.paige_durable_work w where w.id = _created.work_id),
           _created.resumed_existing;
end
$$;
revoke all on function public.submit_paige_document_work(uuid,uuid,jsonb) from public, anon;
grant execute on function public.submit_paige_document_work(uuid,uuid,jsonb) to authenticated;

-- Atomic per-attempt dispatch gate. Duplicate HTTP delivery, overlapping cron ticks and Retry all
-- stop here before a second model call.
create or replace function public.start_paige_document_work_execution(_work_id uuid)
returns table (
  work_id uuid,
  work_status text,
  server_idempotency_key text,
  tenant_id uuid,
  initiating_user_id uuid,
  thread_id uuid,
  attempt_count integer,
  request_payload jsonb
)
language plpgsql security definer set search_path = '' as $$
declare _row public.paige_durable_work%rowtype;
begin
  select * into _row from public.paige_durable_work w where w.id = _work_id for update;
  if not found or _row.work_kind <> 'document_authoring' then
    raise exception 'DURABLE_WORK_NOT_FOUND' using errcode = '42501';
  end if;
  if _row.status <> 'claimed' or _row.lease_until <= now() then
    raise exception 'DURABLE_WORK_NOT_CLAIMABLE' using errcode = '55000';
  end if;
  if _row.dispatch_started_attempt >= _row.attempt_count then
    raise exception 'DURABLE_WORK_ALREADY_DISPATCHED' using errcode = '55000';
  end if;
  if _row.request_payload is null then
    raise exception 'DURABLE_WORK_PAYLOAD_MISSING' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.tenants t where t.id = _row.tenant_id and t.status = 'active'
  ) or not exists (
    select 1 from public.tenant_members m
     where m.tenant_id = _row.tenant_id and m.user_id = _row.initiating_user_id and m.status = 'active'
  ) or not (public.has_tenant_role(_row.initiating_user_id, _row.tenant_id, 'owner')
      or public.has_tenant_role(_row.initiating_user_id, _row.tenant_id, 'admin')
      or public.has_tenant_role(_row.initiating_user_id, _row.tenant_id, 'coach'))
    or not exists (
      select 1 from public.paige_chat_threads t
       where t.id = _row.thread_id and t.tenant_id = _row.tenant_id
         and t.caller_user_id = _row.initiating_user_id and not t.is_archived
    ) then
    perform public.transition_paige_durable_work(
      _row.id, _row.idempotency_key, 'blocked', null,
      'Document work is paused because its workspace authority changed.',
      'authority_changed', 'authority_changed', 300, false
    );
    return query select _row.id, 'blocked'::text, _row.idempotency_key, _row.tenant_id,
                        _row.initiating_user_id, _row.thread_id, _row.attempt_count,
                        _row.request_payload;
    return;
  end if;

  update public.paige_durable_work as w
     set dispatch_started_attempt = w.attempt_count,
         heartbeat_at = now(), lease_until = now() + interval '15 minutes',
         safe_summary = 'Paige is authoring your document.',
         updated_at = now(), version = w.version + 1
   where w.id = _row.id
   returning w.* into _row;

  return query select _row.id, _row.status, _row.idempotency_key, _row.tenant_id,
                      _row.initiating_user_id, _row.thread_id, _row.attempt_count,
                      _row.request_payload;
end
$$;
revoke all on function public.start_paige_document_work_execution(uuid) from public, anon, authenticated;
grant execute on function public.start_paige_document_work_execution(uuid) to service_role;

-- Failure/outcome-unknown transition and its Rail receipt are one transaction. If either write
-- cannot land, neither lands and the claimed envelope remains available for reconciliation.
create or replace function public.settle_paige_document_work_failure(
  _work_id uuid,
  _server_idempotency_key text,
  _new_status text,
  _error_code text,
  _safe_summary text
)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  _work public.paige_durable_work%rowtype;
  _outcome text;
begin
  select * into _work from public.paige_durable_work w where w.id = _work_id for update;
  if not found or _work.work_kind <> 'document_authoring'
     or _work.idempotency_key is distinct from _server_idempotency_key then
    raise exception 'DURABLE_DOCUMENT_SETTLEMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if _new_status not in ('failed','outcome_unknown') or nullif(btrim(_error_code), '') is null then
    raise exception 'DURABLE_DOCUMENT_SETTLEMENT_INVALID' using errcode = '22023';
  end if;

  perform public.transition_paige_durable_work(
    _work.id, _work.idempotency_key, _new_status,
    case when _new_status = 'failed' then jsonb_build_object('error_code', _error_code) else null end,
    _safe_summary, null, _error_code, 300, false
  );
  _outcome := case when _new_status = 'failed' then 'capability_failed'
                   else 'capability_outcome_unknown' end;
  perform public.record_capability_run(
    _work.tenant_id, _work.initiating_user_id, 'document_generate',
    _outcome, _work.id, null,
    _work.id::text || ':' || _work.attempt_count::text, null, null,
    jsonb_build_object('work_id', _work.id, 'error_code', _error_code)
  );
  return _new_status;
end
$$;
revoke all on function public.settle_paige_document_work_failure(uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.settle_paige_document_work_failure(uuid,text,text,text,text)
  to service_role;
-- One transaction owns artifact persistence, exact readback, reconnect turn and terminal success.
-- A connection loss cannot commit one without the others.
create or replace function public.complete_paige_document_work(
  _work_id uuid,
  _server_idempotency_key text,
  _doc_type text,
  _title text,
  _blocks jsonb,
  _provider text,
  _model text,
  _tokens_used integer,
  _latency_ms integer
)
returns table (
  content_id uuid,
  document_revision integer,
  completion_turn_id uuid,
  receipt_recorded boolean,
  work_status text
)
language plpgsql security definer set search_path = '' as $$
declare
  _work public.paige_durable_work%rowtype;
  _content public.marketing_content%rowtype;
  _target uuid;
  _expected integer;
  _body text;
  _history jsonb := '[]'::jsonb;
  _turn uuid;
  _inserted_turn boolean := false;
begin
  select * into _work from public.paige_durable_work w where w.id = _work_id for update;
  if not found or _work.idempotency_key is distinct from _server_idempotency_key
     or _work.work_kind <> 'document_authoring' then
    raise exception 'DURABLE_WORK_NOT_FOUND' using errcode = '42501';
  end if;
  if _work.status = 'succeeded' then
    select * into _content from public.marketing_content m
     where m.id = ((_work.terminal_outcome->>'content_id')::uuid) and m.tenant_id = _work.tenant_id;
    select t.id into _turn from public.paige_chat_turns t where t.work_id = _work.id;
    if _content.id is null or _turn is null then
      raise exception 'DURABLE_DOCUMENT_SUCCESS_READBACK_MISSING' using errcode = '55000';
    end if;
    return query select _content.id, _content.document_revision, _turn, true, 'succeeded'::text;
    return;
  end if;
  if _work.status <> 'claimed' or _work.dispatch_started_attempt <> _work.attempt_count then
    raise exception 'DURABLE_WORK_NOT_CLAIMED' using errcode = '55000';
  end if;
  if _doc_type not in ('guide','one_pager','ebook','checklist','worksheet','proposal','offer_letter','sales_offer','agreement_draft')
     or nullif(btrim(_title), '') is null or char_length(_title) > 200
     or _blocks is null or jsonb_typeof(_blocks) <> 'array'
     or jsonb_array_length(_blocks) not between 1 and 80
     or pg_column_size(_blocks) > 2097152 then
    raise exception 'DURABLE_DOCUMENT_OUTPUT_INVALID' using errcode = '22023';
  end if;

  _target := nullif(_work.request_payload->>'target_content_id', '')::uuid;
  _expected := nullif(_work.request_payload->>'expected_revision', '')::integer;
  _body := jsonb_build_object('docType', _doc_type, 'title', btrim(_title), 'blocks', _blocks)::text;

  if _target is null then
    insert into public.marketing_content(
      id, tenant_id, created_by, kind, title, body, brief, status, meta, work_id, document_revision
    ) values (
      _work.id, _work.tenant_id, _work.initiating_user_id, 'document', btrim(_title), _body,
      _work.request_payload->>'brief', 'draft',
      jsonb_build_object('document_purpose', case when _doc_type = 'agreement_draft' then 'agreement_draft' else 'draft' end),
      _work.id, 1
    ) on conflict (id) do nothing;
    select * into _content from public.marketing_content m
     where m.id = _work.id and m.tenant_id = _work.tenant_id for update;
    if _content.id is null or _content.work_id is distinct from _work.id then
      raise exception 'DURABLE_DOCUMENT_ARTIFACT_CONFLICT' using errcode = '55000';
    end if;
  else
    select * into _content from public.marketing_content m
     where m.id = _target and m.tenant_id = _work.tenant_id and m.kind = 'document' for update;
    if _content.id is null then
      raise exception 'DURABLE_DOCUMENT_TARGET_NOT_FOUND' using errcode = 'P0002';
    end if;
    if _content.work_id is distinct from _work.id then
      if _expected is null or _content.document_revision <> _expected then
        perform public.transition_paige_durable_work(
          _work.id, _work.idempotency_key, 'blocked', null,
          'This document changed before Paige could apply the revision.',
          'version_conflict', 'version_conflict', 300, false
        );
        return query select null::uuid, _content.document_revision, null::uuid, false, 'blocked'::text;
        return;
      end if;
      _history := case when jsonb_typeof(_content.meta->'document_versions') = 'array'
        then _content.meta->'document_versions' else '[]'::jsonb end;
      _history := _history || jsonb_build_array(jsonb_build_object(
        'revision', _content.document_revision,
        'title', _content.title,
        'body', _content.body,
        'at', now()
      ));
      if jsonb_array_length(_history) > 20 then
        select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) into _history
          from jsonb_array_elements(_history) with ordinality
         where ordinality > jsonb_array_length(_history) - 20;
      end if;
      update public.marketing_content as m
         set title = btrim(_title), body = _body, brief = _work.request_payload->>'brief',
             meta = jsonb_set(coalesce(m.meta, '{}'::jsonb), '{document_versions}', _history, true)
                    || jsonb_build_object('document_purpose', case when _doc_type = 'agreement_draft' then 'agreement_draft' else 'draft' end),
             work_id = _work.id, document_revision = m.document_revision + 1, updated_at = now()
       where m.id = _content.id
       returning m.* into _content;
    end if;
  end if;

  -- Exact persisted readback; an empty/mismatched row can never become success.
  select * into _content from public.marketing_content m
   where m.id = _content.id and m.tenant_id = _work.tenant_id;
  if _content.id is null or _content.body is distinct from _body
     or _content.title is distinct from btrim(_title)
     or _content.kind <> 'document' or _content.work_id is distinct from _work.id then
    raise exception 'DURABLE_DOCUMENT_READBACK_MISMATCH' using errcode = '55000';
  end if;

  insert into public.paige_chat_turns(
    thread_id, role, content, surfaces_used, load_id, model, tokens_used, latency_ms,
    bundle_ref, tool_calls, work_id
  ) values (
    _work.thread_id, 'assistant', 'Your document is ready: ' || _content.title || '.',
    array['vibe-studio'], null, nullif(_model, ''), _tokens_used, _latency_ms,
    jsonb_build_object('paige_artifact', jsonb_build_array(jsonb_build_object(
      'id', _content.id, 'title', _content.title, 'artifactType', 'document',
      'tenant_id', _work.tenant_id
    ))), null, _work.id
  ) on conflict do nothing
  returning id into _turn;
  _inserted_turn := found;
  if not _inserted_turn then
    select t.id into _turn from public.paige_chat_turns t where t.work_id = _work.id;
  else
    update public.paige_chat_threads
       set message_count = message_count + 1, last_message_at = now(),
           auto_delete_at = now() + interval '90 days', updated_at = now()
     where id = _work.thread_id and tenant_id = _work.tenant_id
       and caller_user_id = _work.initiating_user_id;
  end if;
  if _turn is null then
    raise exception 'DURABLE_DOCUMENT_TURN_READBACK_MISSING' using errcode = '55000';
  end if;

  perform public.transition_paige_durable_work(
    _work.id, _work.idempotency_key, 'succeeded',
    jsonb_build_object(
      'verified_readback', true,
      'content_id', _content.id,
      'document_revision', _content.document_revision,
      'completion_turn_id', _turn,
      'artifact_type', 'document',
      'document_purpose', case when _doc_type = 'agreement_draft' then 'agreement_draft' else 'draft' end,
      'provider', nullif(_provider, ''),
      'model', nullif(_model, '')
    ),
    'Your document is ready to review.', null, null, 300, false
  );

  -- Receipt persistence is part of the same transaction as artifact, turn and success. A
  -- capability that produced a document but bypassed the Rail is not a successful completion.
  perform public.record_capability_run(
    _work.tenant_id, _work.initiating_user_id, 'document_generate',
    'capability_succeeded', _work.id, null,
    _work.id::text || ':' || _work.attempt_count::text, null, null,
    jsonb_build_object(
      'work_id', _work.id,
      'content_id', _content.id,
      'document_revision', _content.document_revision,
      'verified_readback', true,
      'document_purpose', case when _doc_type = 'agreement_draft' then 'agreement_draft' else 'draft' end
    )
  );

  insert into public.audit_logs(user_id, entity, action, entity_id, data)
  values (_work.initiating_user_id, 'marketing_content', 'durable_document_complete', _content.id,
          jsonb_build_object('tenant_id', _work.tenant_id, 'work_id', _work.id,
                             'document_revision', _content.document_revision));

  return query select _content.id, _content.document_revision, _turn, true, 'succeeded'::text;
end
$$;
revoke all on function public.complete_paige_document_work(uuid,text,text,text,jsonb,text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.complete_paige_document_work(uuid,text,text,text,jsonb,text,text,integer,integer)
  to service_role;

-- Only work whose provider dispatch never began is reclaimed automatically. A lost lease after
-- dispatch becomes outcome_unknown and is never blindly retried.
create or replace function public.recover_paige_document_work(_limit integer default 10)
returns table (work_id uuid)
language plpgsql security definer set search_path = '' as $$
declare _row public.paige_durable_work%rowtype;
begin
  for _row in
    select * from public.paige_durable_work w
     where w.work_kind = 'document_authoring'
       and w.status = 'claimed'
       and w.lease_until <= now()
     order by w.created_at
     for update skip locked
     limit greatest(1, least(coalesce(_limit, 10), 25))
  loop
    begin
      if not exists (
        select 1 from public.tenant_members m
         where m.tenant_id = _row.tenant_id and m.user_id = _row.initiating_user_id and m.status = 'active'
      ) or not (public.has_tenant_role(_row.initiating_user_id, _row.tenant_id, 'owner')
          or public.has_tenant_role(_row.initiating_user_id, _row.tenant_id, 'admin')
          or public.has_tenant_role(_row.initiating_user_id, _row.tenant_id, 'coach')) then
        perform public.transition_paige_durable_work(
          _row.id, _row.idempotency_key, 'blocked', null,
          'Document work is paused because its workspace authority changed.',
          'authority_changed', 'authority_changed', 300, false
        );
        continue;
      end if;

      if _row.dispatch_started_attempt < _row.attempt_count then
        perform public.transition_paige_durable_work(
          _row.id, _row.idempotency_key, 'expired', null,
          'A worker wake-up was missed; Paige is safely resuming the same document work.',
          null, 'lease_expired', 300, false
        );
        perform public.transition_paige_durable_work(
          _row.id, _row.idempotency_key, 'claimed', null,
          'Paige is authoring your document.', null, null, 60, true
        );
        return query select _row.id;
      else
        perform public.settle_paige_document_work_failure(
          _row.id, _row.idempotency_key, 'outcome_unknown',
          'provider_outcome_unknown',
          'Paige is reconciling document work whose outcome is not yet known.'
        );
      end if;
    exception when others then
      raise warning 'recover_paige_document_work skipped % after settlement error: %', _row.id, sqlerrm;
    end;
  end loop;
end
$$;
revoke all on function public.recover_paige_document_work(integer) from public, anon, authenticated;
grant execute on function public.recover_paige_document_work(integer) to service_role;

-- Reuse the platform's existing pg_cron + pg_net + Vault cron-token scheduler. This is a wake-up
-- for the canonical envelope, not a second job system. A missed tick merely delays recovery.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('paige-document-worker')
      where exists (select 1 from cron.job where jobname = 'paige-document-worker');
    perform cron.schedule(
      'paige-document-worker', '* * * * *',
      $job$
        select net.http_post(
          url := 'https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/paige-document-worker',
          headers := jsonb_build_object('Content-Type','application/json','x-cron-token',public.cron_token_header()),
          body := '{"mode":"sweep"}'::jsonb
        );
      $job$
    );
  else
    raise notice 'pg_cron is not installed — durable document wake-up recovery is not scheduled';
  end if;
end
$cron$;
