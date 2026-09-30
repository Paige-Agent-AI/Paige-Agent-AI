-- Canonical durable-work envelope: identity, retry folding, transitions, and caller-safe readback.
-- Synthetic fixtures only; every write rolls back.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/paige_durable_work_envelope.sql "$DB_URL"
begin;

insert into auth.users (id, aud, role, email) values
  ('d7a00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'durable-owner@tests.invalid'),
  ('d7a00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'durable-outsider@tests.invalid');

insert into public.tenants (id, slug, name, status, account_type, account_number_prefix, features) values
  ('d7a00000-0000-4000-8000-000000000010', 'durable-work-a', 'Durable Work A', 'active', 'standalone', 'DWA', '{}'::jsonb),
  ('d7a00000-0000-4000-8000-000000000011', 'durable-work-b', 'Durable Work B', 'active', 'standalone', 'DWB', '{}'::jsonb);

insert into public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) values
  ('d7a00000-0000-4000-8000-000000000010', 'd7a00000-0000-4000-8000-000000000001', 'owner', 'active', true, now()),
  ('d7a00000-0000-4000-8000-000000000011', 'd7a00000-0000-4000-8000-000000000001', 'owner', 'active', true, now());

insert into public.paige_chat_threads (id, caller_user_id, tenant_id, lens, title) values
  ('d7a00000-0000-4000-8000-000000000020', 'd7a00000-0000-4000-8000-000000000001',
   'd7a00000-0000-4000-8000-000000000010', 'coach', 'Durable work proof');

do $$
declare
  _first record;
  _retry record;
  _transition record;
  _raised boolean;
  _authority jsonb := jsonb_build_object(
    'tenant_id', 'd7a00000-0000-4000-8000-000000000010',
    'actor_user_id', 'd7a00000-0000-4000-8000-000000000001',
    'authority_source', 'test_server_resolution'
  );
begin
  select * into _first from public.create_paige_durable_work(
    'd7a00000-0000-4000-8000-000000000010',
    'd7a00000-0000-4000-8000-000000000001',
    'd7a00000-0000-4000-8000-000000000030',
    'd7a00000-0000-4000-8000-000000000020',
    'documents.author', 'document', _authority, 'tenant-a:thread-a', 300, 3
  );
  if _first.work_id is null or _first.server_idempotency_key not like 'paige-work:%'
     or _first.work_status <> 'claimed' or _first.resumed_existing then
    raise exception 'DURABLE_WORK_CREATE_FAILED: %', row_to_json(_first);
  end if;

  select * into _retry from public.create_paige_durable_work(
    'd7a00000-0000-4000-8000-000000000010',
    'd7a00000-0000-4000-8000-000000000001',
    'd7a00000-0000-4000-8000-000000000030',
    'd7a00000-0000-4000-8000-000000000020',
    'documents.author', 'document', _authority, 'tenant-a:thread-a', 300, 3
  );
  if _retry.work_id is distinct from _first.work_id
     or _retry.server_idempotency_key is distinct from _first.server_idempotency_key
     or not _retry.resumed_existing then
    raise exception 'DURABLE_WORK_RETRY_DID_NOT_FOLD: first %, retry %', row_to_json(_first), row_to_json(_retry);
  end if;

  _raised := false;
  begin
    perform public.create_paige_durable_work(
      'd7a00000-0000-4000-8000-000000000010',
      'd7a00000-0000-4000-8000-000000000001',
      'd7a00000-0000-4000-8000-000000000030',
      'd7a00000-0000-4000-8000-000000000020',
      'research.deep', 'research', _authority, 'tenant-a:thread-a', 300, 3
    );
  exception when sqlstate '22023' then
    _raised := sqlerrm = 'DURABLE_WORK_INTENT_REPLAY_MISMATCH';
  end;
  if not _raised then raise exception 'DURABLE_WORK_REPLAY_MISMATCH_WAS_NOT_REFUSED'; end if;

  _raised := false;
  begin
    perform public.transition_paige_durable_work(
      _first.work_id, _first.server_idempotency_key, 'succeeded',
      '{"verified_readback":false}'::jsonb, 'Draft ready'
    );
  exception when sqlstate '22023' then
    _raised := sqlerrm = 'DURABLE_WORK_SUCCESS_REQUIRES_READBACK';
  end;
  if not _raised then raise exception 'DURABLE_WORK_UNVERIFIED_SUCCESS_WAS_NOT_REFUSED'; end if;

  perform public.transition_paige_durable_work(
    _first.work_id, _first.server_idempotency_key, 'outcome_unknown',
    null, 'Provider result requires reconciliation', null, 'provider_ambiguous'
  );

  _raised := false;
  begin
    perform public.transition_paige_durable_work(
      _first.work_id, _first.server_idempotency_key, 'claimed'
    );
  exception when sqlstate '55000' then
    _raised := sqlerrm = 'DURABLE_WORK_RECONCILIATION_REQUIRED';
  end;
  if not _raised then raise exception 'DURABLE_WORK_BLIND_RETRY_WAS_NOT_REFUSED'; end if;

  select * into _transition from public.transition_paige_durable_work(
    _first.work_id, _first.server_idempotency_key, 'claimed',
    null, 'Reconciled: no provider effect', null, null, 300, true
  );
  if _transition.work_attempt_count <> 2 or _transition.work_status <> 'claimed' then
    raise exception 'DURABLE_WORK_RECONCILED_RECLAIM_FAILED: %', row_to_json(_transition);
  end if;

  perform public.transition_paige_durable_work(
    _first.work_id, _first.server_idempotency_key, 'succeeded',
    '{"verified_readback":true,"artifact_count":1}'::jsonb, 'Agreement draft is ready'
  );

  _raised := false;
  begin
    perform public.transition_paige_durable_work(
      _first.work_id, _first.server_idempotency_key, 'failed',
      '{"error":"late_failure"}'::jsonb, 'Late failure'
    );
  exception when sqlstate '55000' then
    _raised := sqlerrm = 'DURABLE_WORK_TERMINAL_IMMUTABLE';
  end;
  if not _raised then raise exception 'DURABLE_WORK_TERMINAL_ROW_MUTATED'; end if;

  _raised := false;
  begin
    perform public.create_paige_durable_work(
      'd7a00000-0000-4000-8000-000000000011',
      'd7a00000-0000-4000-8000-000000000001',
      'd7a00000-0000-4000-8000-000000000031',
      'd7a00000-0000-4000-8000-000000000020',
      'documents.author', 'document',
      jsonb_build_object(
        'tenant_id', 'd7a00000-0000-4000-8000-000000000011',
        'actor_user_id', 'd7a00000-0000-4000-8000-000000000001'
      ),
      'tenant-b:forged-thread', 300, 3
    );
  exception when sqlstate '42501' then
    _raised := sqlerrm = 'DURABLE_WORK_THREAD_FORBIDDEN';
  end;
  if not _raised then raise exception 'DURABLE_WORK_CROSS_TENANT_THREAD_WAS_NOT_REFUSED'; end if;
end
$$;

do $$
begin
  if has_table_privilege('authenticated', 'public.paige_durable_work', 'select') then
    raise exception 'DURABLE_WORK_RAW_TABLE_EXPOSED_TO_AUTHENTICATED';
  end if;
  if has_table_privilege('service_role', 'public.paige_durable_work', 'update') then
    raise exception 'DURABLE_WORK_TRANSITION_SEAM_BYPASSABLE';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.create_paige_durable_work(uuid,uuid,uuid,uuid,text,text,jsonb,text,integer,integer)',
    'execute'
  ) then
    raise exception 'DURABLE_WORK_CREATE_EXPOSED_TO_AUTHENTICATED';
  end if;
  if not has_function_privilege('authenticated', 'public.get_paige_durable_work(uuid)', 'execute') then
    raise exception 'DURABLE_WORK_SAFE_READ_NOT_AVAILABLE';
  end if;
end
$$;

select set_config(
  'tests.durable_work_id',
  (select id::text from public.paige_durable_work
    where intent_id = 'd7a00000-0000-4000-8000-000000000030'),
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd7a00000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"d7a00000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.get_paige_durable_work(
    current_setting('tests.durable_work_id')::uuid
  )) <> 1 then
    raise exception 'DURABLE_WORK_INITIATOR_SAFE_READ_FAILED';
  end if;
end
$$;

select set_config('request.jwt.claim.sub', 'd7a00000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"d7a00000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.get_paige_durable_work(
    current_setting('tests.durable_work_id')::uuid
  )) <> 0 then
    raise exception 'DURABLE_WORK_OUTSIDER_SAFE_READ_LEAKED';
  end if;
end
$$;

reset role;
do $$ begin raise notice 'PAIGE_DURABLE_WORK_ENVELOPE_PROVEN'; end $$;
rollback;
