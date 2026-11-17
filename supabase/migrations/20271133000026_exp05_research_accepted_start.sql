-- Persist the original accepted Chat reference inside the original Research
-- start transaction, before it can return permission to call a provider.
-- Applied20, the canonical terminal writer and global Stop/evidence stay intact.
begin;
set local lock_timeout = '3s';

do $research_accepted_start$
declare
  target regprocedure := 'public.advance_paige_research_work(uuid,uuid,uuid,uuid,uuid,jsonb,text,bigint,jsonb)'::regprocedure;
  source text;
  definition text;
  original_acl aclitem[];
  protected jsonb;
  declarations text := E'  evidence jsonb;';
  thread_read text := $old$  select * into thread from public.paige_chat_threads t where t.id=_thread_id
    and t.tenant_id=_tenant_id and t.caller_user_id=_actor_id and not t.is_archived
    and t.audience='workspace' for share nowait;$old$;
  thread_lock text := $new$  if _phase='begin' then
    -- The canonical Chat writer needs this lock. Acquire it NOWAIT before Work,
    -- rather than upgrading competing SHARE locks after taking the Work lock.
    select * into thread from public.paige_chat_threads t where t.id=_thread_id
      and t.tenant_id=_tenant_id and t.caller_user_id=_actor_id and not t.is_archived
      and t.audience='workspace' for update nowait;
  else
    select * into thread from public.paige_chat_threads t where t.id=_thread_id
      and t.tenant_id=_tenant_id and t.caller_user_id=_actor_id and not t.is_archived
      and t.audience='workspace' for share nowait;
  end if;$new$;
  claim text := '      -- Preparation reserved attempt 1 without dispatching it. Claim that same';
  acceptance text := $new$      -- Model counts come from the original server-resolved snapshot, never
      -- invented by this native writer or treated as execution authority.
      acceptance_record := w.authority_context->'chat_turn_record';
      if jsonb_typeof(acceptance_record) is distinct from 'object'
        or acceptance_record->'v' is distinct from '1'::jsonb
        or acceptance_record->>'state' is distinct from 'FINAL'
        or acceptance_record?'waiting_on'
        or coalesce(acceptance_record->>'mode','') not in
          ('pending','fast_answer','answer','research','action','build','multi_agent','clarify')
        or jsonb_typeof(acceptance_record->'rounds') is distinct from 'number'
        or jsonb_typeof(acceptance_record->'tools') is distinct from 'number'
        or coalesce(acceptance_record->>'rounds','') !~ '^(0|[1-9][0-9]{0,3})$'
        or coalesce(acceptance_record->>'tools','') !~ '^(0|[1-9][0-9]{0,3})$'
        or (acceptance_record?'resumed' and (
          jsonb_typeof(acceptance_record->'resumed') is distinct from 'object'
          or coalesce(acceptance_record#>>'{resumed,kind}','') not in ('approval','answer','work'))) then
        raise exception 'RESEARCH_ACCEPTANCE_RECORD_INVALID' using errcode='22023';
      end if;
      if (acceptance_record->>'rounds')::integer>1000
        or (acceptance_record->>'tools')::integer>=1000 then
        raise exception 'RESEARCH_ACCEPTANCE_RECORD_INVALID' using errcode='22023';
      end if;
      acceptance_bundle := jsonb_build_object(
        'turn_state',jsonb_build_object('v',1,'state','WAIT_WORK',
          -- Canonical reducer precedence: build > delegation > Research > action.
          -- Its snapshot precedes this sole tool batch; count this acceptance once.
          'mode',case when acceptance_record->>'mode' in ('build','multi_agent')
            then acceptance_record->>'mode' else 'research' end,
          'rounds',acceptance_record->'rounds',
          'tools',(acceptance_record->>'tools')::integer+1,
          'waiting_on',jsonb_build_object('kind','work','work_ids',jsonb_build_array(w.id)))
          || case when acceptance_record?'resumed' then jsonb_build_object('resumed',
            jsonb_build_object('kind',acceptance_record#>>'{resumed,kind}')) else '{}'::jsonb end,
        'interactive',jsonb_build_object('request_intent_id',w.intent_id,
          'effects',jsonb_build_array(jsonb_build_object('tool','deep_research',
            'outcome','durable_accepted','work_id',w.id))));
      acceptance_turn := public.paige_chat_interactive_settle(
        w.thread_id,w.initiating_user_id,w.tenant_id,w.intent_id,
        'Your original research work is recorded. Check its status here.',
        array['research']::text[],null,acceptance_bundle,null);
      if acceptance_turn is null or not exists(select 1 from public.paige_chat_turns t
        where t.id=acceptance_turn and t.thread_id=w.thread_id and t.role='assistant'
          and t.interactive_intent_id=w.intent_id and t.interactive_actor_id=w.initiating_user_id
          and t.interactive_tenant_id=w.tenant_id and t.interactive_terminal_state='WAIT_WORK'
          and t.bundle_ref=acceptance_bundle
          and t.content='Your original research work is recorded. Check its status here.'
          and t.surfaces_used=array['research']::text[] and t.model is null and t.tool_calls is null) then
        raise exception 'RESEARCH_ACCEPTANCE_UNCONFIRMED' using errcode='55000';
      end if;
      -- Preparation reserved attempt 1 without dispatching it. Claim that same$new$;
begin
  select p.prosrc,pg_get_functiondef(p.oid),p.proacl into source,definition,original_acl
    from pg_proc p where p.oid=target and p.prosecdef and p.provolatile='v'
      and pg_get_userbyid(p.proowner)='postgres'
      and p.proconfig=array['search_path=""','TimeZone=UTC']
      and p.proargnames=array['_work_id','_tenant_id','_actor_id','_thread_id','_intent_id',
        '_request_payload','_phase','_version','_checkpoint']::text[]
      and p.pronargdefaults=2 and p.prorettype='jsonb'::regtype
      and p.proacl=array['postgres=X/postgres','service_role=X/postgres']::aclitem[];
  if md5(source) is distinct from '60fdaa91ac2950f18f9522abd0148aba'
    or (length(source)-length(replace(source,declarations,'')))<>length(declarations)
    or (length(source)-length(replace(source,thread_read,'')))<>length(thread_read)
    or (length(source)-length(replace(source,claim,'')))<>length(claim) then
    raise exception 'C4E_RESEARCH_START_SOURCE_CHANGED';
  end if;
  select jsonb_object_agg(p.oid::text,to_jsonb(p)) into protected from pg_proc p
    where p.oid in (
      'public.paige_chat_interactive_settle(uuid,uuid,uuid,uuid,text,text[],text,jsonb,jsonb)'::regprocedure,
      'public.paige_chat_interactive_evidence(uuid,uuid,uuid,uuid)'::regprocedure);
  definition := replace(definition,declarations,declarations||E'\n  acceptance_record jsonb;\n  acceptance_bundle jsonb;\n  acceptance_turn uuid;');
  definition := replace(definition,thread_read,thread_lock);
  definition := replace(definition,claim,acceptance);
  execute definition;
  if not exists(select 1 from pg_proc p where p.oid=target
    and p.proacl is not distinct from original_acl and p.prosecdef and p.provolatile='v'
    and pg_get_userbyid(p.proowner)='postgres'
    and p.proconfig=array['search_path=""','TimeZone=UTC']
    and p.prosrc=replace(replace(replace(source,declarations,
      declarations||E'\n  acceptance_record jsonb;\n  acceptance_bundle jsonb;\n  acceptance_turn uuid;'),
      thread_read,thread_lock),claim,acceptance))
    or protected is distinct from (select jsonb_object_agg(p.oid::text,to_jsonb(p)) from pg_proc p
      where p.oid in (
        'public.paige_chat_interactive_settle(uuid,uuid,uuid,uuid,text,text[],text,jsonb,jsonb)'::regprocedure,
        'public.paige_chat_interactive_evidence(uuid,uuid,uuid,uuid)'::regprocedure)) then
    raise exception 'C4E_RESEARCH_START_READBACK_CHANGED';
  end if;
end $research_accepted_start$;
commit;
