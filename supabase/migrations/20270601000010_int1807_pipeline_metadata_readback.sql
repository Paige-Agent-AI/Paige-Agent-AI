-- INT-1807 Phase A: read-only original-operation resolution. No execution,
-- terminal issuance, executor release, retry, rollout or receipt mutation.
-- CLI-created 20261008181153 renumbered after verified main/production tail 09;
-- active PR migration file lists were checked before reserving 10.
begin;
create or replace function public.read_pipeline_metadata_original(
 _thread uuid, _intent uuid, _effect uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
 v_actor uuid := auth.uid();
 v_tenant uuid := public.current_user_tenant_id();
 v_card public.paige_pending_confirmations%rowtype;
 v_frame jsonb;
 v_token text;
 v_count integer;
begin
 -- No operator exception; read only the caller's currently selected tenant and
 -- their own conversation. Service-role/anonymous calls cannot supply an actor.
 if v_actor is null or v_tenant is null or public.is_tenant_admin(v_tenant) is distinct from true then return null; end if;
 if not exists(select 1 from public.paige_chat_threads t where t.id=_thread
   and t.caller_user_id=v_actor and t.tenant_id=v_tenant) then return null; end if;
 select * into v_card from public.paige_pending_confirmations c
  where c.id=_effect and c.thread_id=_thread and c.user_id=v_actor
   and c.tenant_id=v_tenant and c.tool_name='pipeline_configure'
   and c.server_issued_at is not null and c.issued_in_request is not null
   and c.consumed_at is not null;
 if not found or jsonb_typeof(v_card.args->'command') is distinct from 'object'
   or v_card.args->'command'->>'type' is distinct from 'update-pipeline'
   or jsonb_typeof(v_card.args->'idempotency_key') is distinct from 'string'
   or coalesce(v_card.args->>'idempotency_key','')='' then return null; end if;
 select r.bundle_ref->'paige_resume'->'approval_outcome' into v_frame
  from public.paige_chat_turns r where r.thread_id=_thread and r.role='assistant'
   and r.interactive_intent_id=_intent and r.interactive_actor_id=v_actor
   and r.interactive_tenant_id=v_tenant and r.interactive_terminal_state is not null;
 if not found or jsonb_typeof(v_frame->'actions') is distinct from 'array' then return null; end if;
 v_token := v_card.fingerprint || ':' || v_card.issued_in_request::text;
 select count(*) into v_count from jsonb_array_elements(v_frame->'actions') a
  where a->>'fingerprint'=v_token and a->>'outcome' in ('ran','unconfirmed');
 -- Ambiguous/repeated/conflicting card observations never establish lineage.
 if v_count<>1 or (select count(*) from jsonb_array_elements(v_frame->'actions') a
   where a->>'fingerprint'=v_token)<>1 then return null; end if;
 return jsonb_build_object('tenantId',v_tenant,'actorId',v_actor,'actorKind','human',
  'idempotencyKey',v_card.args->>'idempotency_key',
  'commandHash',md5((v_card.args->'command')::text),'command',v_card.args->'command');
end $$;
revoke all on function public.read_pipeline_metadata_original(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.read_pipeline_metadata_original(uuid,uuid,uuid) to authenticated;
commit;
