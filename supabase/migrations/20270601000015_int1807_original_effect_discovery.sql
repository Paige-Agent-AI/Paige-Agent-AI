-- CLI-created #1807 caller-bound original Pipeline effect discovery.
-- Read-only: no approval consumption, execution, settlement, retry or activation.
-- Publication number is reserved/verified by the release owner before merge.
begin;
create or replace function public.find_pipeline_metadata_original_effect(
 _thread uuid, _intent uuid
) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
 v_actor uuid := auth.uid();
 v_tenant uuid := public.current_user_tenant_id();
 v_frame jsonb;
 v_effect uuid;
 v_terminal_count bigint;
 v_cards bigint;
 v_occurrences bigint;
 v_allowed boolean;
begin
 if auth.role() is distinct from 'authenticated' or v_actor is null or v_tenant is null
  or _thread is null or _intent is null
  or public.is_tenant_admin(v_tenant) is distinct from true then return null; end if;
 if not exists(select 1 from public.tenants t where t.id = v_tenant and t.status = 'active')
  or not exists(select 1 from public.tenant_members m where m.tenant_id = v_tenant
   and m.user_id = v_actor and m.status = 'active') then return null; end if;
 if not exists(select 1 from public.paige_chat_threads t where t.id = _thread
  and t.caller_user_id = v_actor and t.tenant_id = v_tenant and t.is_archived is false
  and t.interactive_latest_intent = _intent) then return null; end if;
 -- The unique protected terminal index is canonical. Also reject unexpected
 -- multiplicity rather than choosing an arbitrary terminal if that invariant drifts.
 select count(*) into v_terminal_count from public.paige_chat_turns r
  where r.thread_id = _thread and r.role = 'assistant' and r.interactive_intent_id = _intent
   and r.interactive_actor_id = v_actor and r.interactive_tenant_id = v_tenant
   and r.interactive_terminal_state is not null;
 if v_terminal_count <> 1 then return null; end if;
 select r.bundle_ref->'paige_resume'->'approval_outcome' into v_frame
  from public.paige_chat_turns r where r.thread_id = _thread and r.role = 'assistant'
   and r.interactive_intent_id = _intent and r.interactive_actor_id = v_actor
   and r.interactive_tenant_id = v_tenant and r.interactive_terminal_state is not null;
 if jsonb_typeof(v_frame->'actions') is distinct from 'array' then return null; end if;
 if exists(select 1 from jsonb_array_elements(v_frame->'actions') a
  where jsonb_typeof(a) is distinct from 'object'
   or jsonb_typeof(a->'fingerprint') is distinct from 'string'
   or coalesce(a->>'fingerprint','') = ''
   or jsonb_typeof(a->'outcome') is distinct from 'string'
   or a->>'outcome' not in ('ran','not_run','unconfirmed')) then return null; end if;
 -- Count EVERY matching card/token observation before accepting its outcome.
 -- In particular, ran + not_run is ambiguous, not one successful match. Do not
 -- discard unissued/unspent cards to make multiple referenced effects look unique.
 select count(distinct c.id), count(*), min(c.id::text)::uuid,
  bool_and(jsonb_typeof(a->'fingerprint') = 'string'
   and jsonb_typeof(a->'outcome') = 'string' and a->>'outcome' in ('ran','unconfirmed'))
  into v_cards, v_occurrences, v_effect, v_allowed
  from public.paige_pending_confirmations c
  cross join lateral jsonb_array_elements(v_frame->'actions') a
  where c.thread_id = _thread and c.user_id = v_actor and c.tenant_id = v_tenant
   and c.tool_name = 'pipeline_configure'
   and a->>'fingerprint' = c.fingerprint || ':' || c.issued_in_request::text;
 if v_cards <> 1 or v_occurrences <> 1 or v_allowed is distinct from true then return null; end if;
 -- Issuance nonce is NOT execution intent. Only the protected terminal token join
 -- supplies that link; the existing caller-bound resolver proves consumed issuance,
 -- original update command/key and PostgreSQL command hash. A receipt hash is not proof.
 if public.read_pipeline_metadata_original(_thread, _intent, v_effect) is null then return null; end if;
 return v_effect;
end $$;
revoke all on function public.find_pipeline_metadata_original_effect(uuid,uuid) from public,anon,service_role;
grant execute on function public.find_pipeline_metadata_original_effect(uuid,uuid) to authenticated;
commit;
