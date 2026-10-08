-- CLI-created bounded authenticated observation. No mutation or continuation authority.
create or replace function public.read_paige_durable_observation(_thread uuid,_intent uuid,_work uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid:=public.current_user_tenant_id(); w public.paige_durable_work%rowtype; t public.paige_chat_threads%rowtype; verified boolean:=false; artifact uuid; matched bigint; accepted boolean; recovery text;
begin
 if auth.role() is distinct from 'authenticated' or actor is null or tenant is null then return null; end if;
 select * into t from public.paige_chat_threads where id=_thread and caller_user_id=actor and tenant_id=tenant and not is_archived;
 if not found or t.interactive_latest_intent is distinct from _intent then return null; end if;
 if not exists(select 1 from public.tenants where id=tenant and status='active') or not exists(select 1 from public.tenant_members where tenant_id=tenant and user_id=actor and status='active') then return null; end if;
 select * into w from public.paige_durable_work where id=_work and thread_id=_thread and tenant_id=tenant and initiating_user_id=actor;
 if not found then return null; end if;
 if not ((w.capability_key='document_generate' and w.work_kind='document_authoring') or (w.capability_key='deep_research' and w.work_kind='research')) then return null; end if;
 -- Matches Document's owner/admin permission after the canonical title-role retirement.
 -- An initiating actor or a historical authority snapshot is not current permission.
 if not(public.has_tenant_role(actor,tenant,'owner') or public.has_tenant_role(actor,tenant,'admin')) then return null; end if;
 -- Original chat intent and domain work intent are deliberately distinct for documents.
 select count(*),bool_and(e->>'outcome'='durable_accepted' and e->>'tool'=w.capability_key) into matched,accepted from public.paige_chat_turns r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.bundle_ref->'interactive'->'effects')='array' then r.bundle_ref->'interactive'->'effects' else '[]'::jsonb end) e where r.thread_id=_thread and r.role='assistant' and r.interactive_intent_id=_intent and r.interactive_actor_id=actor and r.interactive_tenant_id=tenant and r.interactive_terminal_state is not null and e->>'work_id'=_work::text;
 if matched<>1 or accepted is distinct from true then return null; end if;
 if w.status='succeeded' and w.terminal_outcome->'verified_readback'='true'::jsonb and w.settled_at is not null and w.settled_at<=now() and w.settled_at>=w.created_at then
  if w.capability_key='document_generate' then
   select count(*),min(m.id::text)::uuid into matched,artifact from public.marketing_content m where m.work_id=w.id and m.tenant_id=tenant and m.kind='document' and m.id::text=w.terminal_outcome->>'content_id' and m.document_revision::text=w.terminal_outcome->>'document_revision';
   verified:=matched=1 and (select count(*) from public.marketing_content where work_id=w.id)=1;
   if verified then
    begin
     verified:=exists(select 1 from public.marketing_content m where m.id=artifact and nullif(btrim(m.title),'') is not null and char_length(m.title)<=200 and m.body::jsonb->>'title'=m.title and m.body::jsonb->>'docType' in ('guide','one_pager','ebook','checklist','worksheet','proposal','offer_letter','sales_offer','agreement_draft') and jsonb_typeof(m.body::jsonb->'blocks')='array' and jsonb_array_length(m.body::jsonb->'blocks') between 1 and 80 and pg_column_size(m.body::jsonb->'blocks')<=2097152)
      and (select count(*) from public.paige_chat_turns c where c.work_id=w.id)=1
      and exists(select 1 from public.paige_chat_turns c where c.work_id=w.id and c.thread_id=_thread and c.role='assistant' and c.id::text=w.terminal_outcome->>'completion_turn_id' and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.bundle_ref->'paige_artifact')='array' then c.bundle_ref->'paige_artifact' else '[]'::jsonb end) a where a->>'id'=artifact::text and a->>'tenant_id'=tenant::text and a->>'artifactType'='document'));
    exception when invalid_text_representation then verified:=false;
    end;
   end if;
  else
   select count(*),min(r.id::text)::uuid into matched,artifact from public.research_runs r where r.work_id=w.id and r.tenant_id=tenant and r.user_id=actor and r.id::text=w.terminal_outcome->>'run_id' and r.question=w.request_payload->>'question' and r.configured and r.stop_reason='answered' and r.coverage->>'stop_reason'='answered' and r.coverage->'configured'='true'::jsonb and jsonb_typeof(r.findings)='array' and jsonb_array_length(r.findings)>0;
   verified:=matched=1 and (select count(*) from public.research_runs where work_id=w.id)=1;
   if verified then
    verified:=not exists(select 1 from public.research_sources s where s.run_id=artifact and (s.tenant_id is distinct from tenant or s.user_id is distinct from actor or s.source_index is null or s.source_index<1))
     and not exists(select 1 from public.research_sources s where s.run_id=artifact group by s.source_index having count(*)>1)
     and not exists(select 1 from public.research_runs r cross join lateral jsonb_array_elements(r.findings) f where r.id=artifact and (jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'text') is distinct from 'string' or nullif(btrim(f->>'text'),'') is null or jsonb_typeof(f->'citations') is distinct from 'array' or case when jsonb_typeof(f->'citations')='array' then jsonb_array_length(f->'citations')=0 else true end))
     and not exists(select 1 from public.research_runs r cross join lateral jsonb_array_elements(r.findings) f cross join lateral jsonb_array_elements(case when jsonb_typeof(f->'citations')='array' then f->'citations' else '[]'::jsonb end) c where r.id=artifact and not exists(select 1 from public.research_sources s where s.run_id=artifact and s.tenant_id=tenant and s.user_id=actor and not s.excluded and s.url~'^https?://' and to_jsonb(s.source_index)=c));
   end if;
  end if;
 end if;
 recovery:=case when w.status in ('expired','outcome_unknown') then 'reconciliation_required' when w.status='succeeded' and not verified then 'terminal_unverified' else 'observed' end;
 return jsonb_build_object('workId',w.id,'threadId',_thread,'intentId',_intent,'workIntentId',w.intent_id,'tenantId',tenant,'actorId',actor,'state',w.status,'version',w.version,'recoveryState',recovery,'approvalState','unavailable','cancelled',w.status='cancelled','artifactVerified',verified,'artifactRef',case when verified then artifact else null end);
end $$;
revoke all on function public.read_paige_durable_observation(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.read_paige_durable_observation(uuid,uuid,uuid) to authenticated;
