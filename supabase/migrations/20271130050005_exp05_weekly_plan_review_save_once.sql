-- Original manual Planning review/save; no model/card redemption or schedule.
-- The CLI-created carrier is prospective. Reconcile its version before release.
begin;

-- Keep the original scoped producer ABI/authority; preserve its native receipt.
do $receipt_forward$
declare definition text; needle text := 'return jsonb_build_object(''ok'',true,''plan_id'',v_id,''tenant_id'',v_tenant,''actor_id'',v_actor);';
begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.plan_create_scoped(uuid,uuid,text,text,date,date,text,uuid,text)'::regprocedure)
  is distinct from '1db596540432768feeb6a2000cd29a93' then raise exception 'WEEKLY_PLAN_SCOPED_PRODUCER_CHANGED'; end if;
 select pg_get_functiondef('public.plan_create_scoped(uuid,uuid,text,text,date,date,text,uuid,text)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 then
  raise exception 'WEEKLY_PLAN_SCOPED_PRODUCER_CHANGED'; end if;
 execute replace(definition,needle,'return v_result || jsonb_build_object(''ok'',true,''plan_id'',v_id,''tenant_id'',v_tenant,''actor_id'',v_actor);');
end $receipt_forward$;

create function private.planning_weekly_review_scope(p_actor uuid,p_tenant uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from p_actor or p_tenant is null then
  raise exception 'WEEKLY_PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
 perform 1 from auth.users where id=p_actor for share;
 if not found then raise exception 'WEEKLY_PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
 perform 1 from public.profiles where user_id=p_actor and active_tenant_id=p_tenant for update;
 if not found or public.current_user_tenant_id() is distinct from p_tenant then
  raise exception 'WEEKLY_PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant and status='active'
  and account_type::text='standalone' and parent_tenant_id is null and not public.is_company_workspace(id) for share;
 if not found then raise exception 'WEEKLY_PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
 perform 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and status='active' for share;
 if not found then raise exception 'WEEKLY_PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
 perform 1 from public.user_roles where user_id=p_actor for share;
 -- Match the existing business-calendar and workspace-wide Work review authority.
 if not coalesce(public.is_tenant_member(p_tenant) and public.is_tenant_admin(p_tenant),false) then
  raise exception 'WEEKLY_PLAN_UNAVAILABLE' using errcode='42501'; end if;
end $$;
revoke all on function private.planning_weekly_review_scope(uuid,uuid) from public,anon,authenticated,service_role;

-- Read-only recovery of the ORIGINAL save attempt. It can never create a Plan.
create function public.get_weekly_plan_review_result_scoped(p_expected_actor_id uuid,p_expected_tenant_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.paige_durable_work%rowtype; result jsonb; plan_id uuid; source_key text; source_id uuid;
 current_work jsonb:='[]'; current_record jsonb; expected_version timestamptz;
begin
 perform private.planning_weekly_review_scope(p_expected_actor_id,p_expected_tenant_id);
 if p_request_id is null then raise exception 'WEEKLY_PLAN_INPUT_INVALID' using errcode='22023'; end if;
 select * into w from public.paige_durable_work where tenant_id=p_expected_tenant_id
  and initiating_user_id=p_expected_actor_id and intent_id=p_request_id for share;
 if not found then return jsonb_build_object('status','not_found'); end if;
 if w.capability_key is distinct from 'planning.create' or w.work_kind is distinct from 'planning_week_review'
  or w.thread_id is not null then raise exception 'WEEKLY_PLAN_UNAVAILABLE' using errcode='42501'; end if;
 if w.status is distinct from 'succeeded' then return jsonb_build_object('status','unknown'); end if;
 result:=w.terminal_outcome->'original_result'; plan_id:=(result->>'plan_id')::uuid;
 if w.terminal_outcome->>'verified_readback' is distinct from 'true' or plan_id is null
  or result->>'railRecorded' is distinct from 'true' or result->>'receipt_status' is distinct from 'recorded'
  or not exists(select 1 from public.plans p where p.id=plan_id and p.tenant_id=w.tenant_id and p.created_by=w.initiating_user_id
   and p.metadata->'weekly_plan_review_v1'->>'request_id'=p_request_id::text)
  or not exists(select 1 from public.paige_workspace_events e where e.tenant_id=w.tenant_id and e.actor_id=w.initiating_user_id
   and e.source_id=(result->>'receipt_run_id')::uuid and e.source_kind='capability_run' and e.capability_key='plan_create'
   and e.outcome='capability_succeeded' and e.detail->>'record_id'=plan_id::text and e.detail->>'record_table'='plans') then
  raise exception 'WEEKLY_PLAN_RECEIPT_UNAVAILABLE' using errcode='55000'; end if;
 -- Resolve permitted CURRENT work from original sources. The Plan stores only
 -- references/confirmed inputs, never a copied private Task title/body/deadline.
 -- Losing admin/source access therefore cannot disclose a retained source copy.
 for source_key in select value from jsonb_array_elements_text(w.request_payload->'included') loop
  source_id:=split_part(source_key,':',2)::uuid;
  select (s->>'updated_at')::timestamptz into expected_version from jsonb_array_elements(w.request_payload->'sources') s where s->>'key'=source_key;
  current_record:=null;
  if split_part(source_key,':',1)='crm' then
   select jsonb_build_object('key',source_key,'id',t.id,'source','crm','state','available','title',t.title,
    'status',t.status::text,'due_at',t.due_date,'updated_at',coalesce(t.updated_at,t.created_at),
    'changed_since_review',coalesce(t.updated_at,t.created_at) is distinct from expected_version)
    into current_record from public.tasks t where t.tenant_id=w.tenant_id and t.id=source_id;
  else
   select jsonb_build_object('key',source_key,'id',i.id,'source','planning','state','available','title',i.title,
    'status',i.status,'due_at',i.due_at,'updated_at',i.updated_at,'changed_since_review',i.updated_at is distinct from expected_version)
    into current_record from public.plan_items i where i.tenant_id=w.tenant_id and i.id=source_id and i.item_type in ('task','milestone');
  end if;
  current_work:=current_work||jsonb_build_array(coalesce(current_record,jsonb_build_object('key',source_key,'state','unavailable')));
 end loop;
 return jsonb_build_object('status','succeeded','request_id',p_request_id,'work_id',w.id,'historical',true,
  'plan_id',plan_id,'receipt_run_id',result->'receipt_run_id','current_work',current_work,'review_zone',w.request_payload->'zone');
end $$;
revoke all on function public.get_weekly_plan_review_result_scoped(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_weekly_plan_review_result_scoped(uuid,uuid,uuid) to authenticated;

-- One transaction: current authority/versions, original Work claim, original
-- Planning mutation + original audit/Rail, verified readback, terminal outcome.
-- Calling this is the human's explicit native Save; no autonomous tool calls it.
create function public.save_weekly_plan_review_scoped(p_expected_actor_id uuid,p_expected_tenant_id uuid,p_request_id uuid,p_review jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.paige_durable_work%rowtype; made record; source jsonb; fact jsonb;
 task public.tasks%rowtype; item public.plan_items%rowtype; source_id uuid; source_key text;
 facts jsonb:='{}'; seen text[]:='{}'; included text[]; dependencies jsonb; dependency text;
 owner_id uuid; effort bigint; used jsonb:='{}'; amount bigint; capacity jsonb; zone jsonb;
 starts date; ends date; r jsonb; plan_id uuid; receipt uuid; title text; summary text; version timestamptz;
begin
 perform private.planning_weekly_review_scope(p_expected_actor_id,p_expected_tenant_id);
 if p_request_id is null or p_review is null or jsonb_typeof(p_review) is distinct from 'object'
  or pg_column_size(p_review)>16000 or p_review->'v' is distinct from '1'::jsonb
  or exists(select 1 from jsonb_object_keys(p_review) k where k not in ('v','starts_on','zone','goal','sources','capacity_minutes','included'))
  or jsonb_typeof(p_review->'goal') is distinct from 'string' or length(btrim(p_review->>'goal')) not between 1 and 2000
  or coalesce(p_review->>'starts_on','') !~ '^\d{4}-\d{2}-\d{2}$'
  or jsonb_typeof(p_review->'sources') is distinct from 'array' or jsonb_array_length(p_review->'sources') not between 1 and 40
  or jsonb_typeof(p_review->'included') is distinct from 'array' or jsonb_array_length(p_review->'included') not between 1 and 40
  or jsonb_typeof(p_review->'capacity_minutes') is distinct from 'object' then
  raise exception 'WEEKLY_PLAN_INPUT_INVALID' using errcode='22023'; end if;
 -- The profile lock serializes both save and recovery; no second insertion is
 -- possible for this actor/tenant/request, including concurrent lost acknowledgements.
 select * into w from public.paige_durable_work where tenant_id=p_expected_tenant_id
  and initiating_user_id=p_expected_actor_id and intent_id=p_request_id for update;
 if found then
  if w.capability_key is distinct from 'planning.create' or w.work_kind is distinct from 'planning_week_review'
   or w.thread_id is not null or w.request_payload is distinct from p_review then
   raise exception 'WEEKLY_PLAN_REQUEST_CHANGED' using errcode='22023'; end if;
  return public.get_weekly_plan_review_result_scoped(p_expected_actor_id,p_expected_tenant_id,p_request_id);
 end if;
 starts:=(p_review->>'starts_on')::date; ends:=starts+6;
 if not isfinite(starts) or extract(isodow from starts)<>1 then raise exception 'WEEKLY_PLAN_WEEK_INVALID' using errcode='22023'; end if;
 zone:=public.read_business_time_zone(p_expected_tenant_id);
 if zone->>'state' is distinct from 'configured' or zone->>'zone' is distinct from p_review->>'zone' then
  raise exception 'WEEKLY_PLAN_ZONE_CHANGED' using errcode='40001'; end if;
 -- Lock the canonical zone through use; no device-zone fallback or Calendar write.
 perform 1 from public.tenant_business_time_zones where tenant_id=p_expected_tenant_id and time_zone=p_review->>'zone' for share;
 if not found then raise exception 'WEEKLY_PLAN_ZONE_CHANGED' using errcode='40001'; end if;
 capacity:=p_review->'capacity_minutes';
 if (select count(*) from jsonb_object_keys(capacity))>40 then raise exception 'WEEKLY_PLAN_INPUT_INVALID' using errcode='22023'; end if;
 for source_key,source in select key,value from jsonb_each(capacity) loop
  if source_key !~ '^[0-9a-f-]{36}$' or jsonb_typeof(source)<>'number' or source::text !~ '^\d{1,5}$'
   or source::text::integer>10080 or source::text::integer%15<>0 then raise exception 'WEEKLY_PLAN_INPUT_INVALID' using errcode='22023'; end if;
  perform 1 from public.tenant_members where tenant_id=p_expected_tenant_id and user_id=source_key::uuid and status='active' for share;
  if not found then raise exception 'WEEKLY_PLAN_OWNER_CHANGED' using errcode='40001'; end if;
 end loop;
 -- Facts always come from locked original rows. Input supplies only references,
 -- exact versions and explicitly reviewed estimates/dependencies, never row text.
 for source in select value from jsonb_array_elements(p_review->'sources') order by value->>'key' loop
  source_key:=source->>'key';
  if jsonb_typeof(source) is distinct from 'object' or coalesce(source_key,'') !~ '^(crm|planning):[0-9a-f-]{36}$'
   or source_key=any(seen) or exists(select 1 from jsonb_object_keys(source) k where k not in ('key','updated_at','minutes','dependencies'))
   or jsonb_typeof(source->'updated_at') is distinct from 'string'
   or source->>'updated_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
   or jsonb_typeof(source->'dependencies') is distinct from 'array' or jsonb_array_length(source->'dependencies')>40
   or exists(select 1 from jsonb_array_elements(source->'dependencies') d where jsonb_typeof(d) is distinct from 'string' or d#>>'{}' !~ '^(crm|planning):[0-9a-f-]{36}$')
   or (select count(distinct d) from jsonb_array_elements(source->'dependencies') d)<>jsonb_array_length(source->'dependencies')
   or (source->'minutes' is distinct from 'null'::jsonb and (jsonb_typeof(source->'minutes') is distinct from 'number'
    or source->>'minutes' !~ '^\d{1,10}$' or (source->>'minutes')::numeric>2147483647))
   or not (source ? 'minutes') then raise exception 'WEEKLY_PLAN_INPUT_INVALID' using errcode='22023'; end if;
  seen:=array_append(seen,source_key); source_id:=split_part(source_key,':',2)::uuid;
  if split_part(source_key,':',1)='crm' then
   select * into task from public.tasks where tenant_id=p_expected_tenant_id and id=source_id for share;
   if not found or coalesce(task.updated_at,task.created_at) is distinct from (source->>'updated_at')::timestamptz then
    raise exception 'WEEKLY_PLAN_SOURCE_CHANGED' using errcode='40001'; end if;
   fact:=jsonb_build_object('key',source_key,'title',task.title,'owner_id',task.user_id,'due_at',task.due_date,
    'status',case task.status::text when 'pending' then 'open' when 'completed' then 'done' else task.status::text end,
    'updated_at',coalesce(task.updated_at,task.created_at));
  else
   select * into item from public.plan_items where tenant_id=p_expected_tenant_id and id=source_id and item_type in ('task','milestone') for share;
   if not found or item.updated_at is distinct from (source->>'updated_at')::timestamptz then
    raise exception 'WEEKLY_PLAN_SOURCE_CHANGED' using errcode='40001'; end if;
   fact:=jsonb_build_object('key',source_key,'title',item.title,'owner_id',item.assigned_to_user_id,'due_at',item.due_at,
    'status',item.status,'updated_at',item.updated_at);
  end if;
  facts:=facts||jsonb_build_object(source_key,fact||jsonb_build_object('minutes',source->'minutes','dependencies',source->'dependencies'));
 end loop;
 select array_agg(value) into included from jsonb_array_elements_text(p_review->'included');
 if cardinality(included) is distinct from (select count(distinct x) from unnest(included) x)
  or exists(select 1 from unnest(included) x where not x=any(seen)) then raise exception 'WEEKLY_PLAN_INPUT_INVALID' using errcode='22023'; end if;
 -- This is a commit-time constraint check of the accepted proposal, not a second
 -- optimizer. Never permit an unavailable prerequisite or borrowed/unknown capacity.
 foreach source_key in array included loop
  fact:=facts->source_key; owner_id:=(fact->>'owner_id')::uuid; effort:=(fact->>'minutes')::bigint;
  if fact->>'status' not in ('open','in_progress') or owner_id is null or effort is null or not capacity ? owner_id::text then
   raise exception 'WEEKLY_PLAN_NOT_FEASIBLE' using errcode='22023'; end if;
  for dependency in select value from jsonb_array_elements_text(fact->'dependencies') loop
   if not facts ? dependency or (facts->dependency->>'status' is distinct from 'done' and
    (array_position(included,dependency) is null or array_position(included,dependency)>=array_position(included,source_key))) then
    raise exception 'WEEKLY_PLAN_DEPENDENCY_UNAVAILABLE' using errcode='22023'; end if;
  end loop;
  amount:=coalesce((used->>owner_id::text)::bigint,0)+effort;
  if amount>(capacity->>owner_id::text)::bigint then raise exception 'WEEKLY_PLAN_NOT_FEASIBLE' using errcode='22023'; end if;
  used:=used||jsonb_build_object(owner_id::text,amount);
 end loop;
 select * into made from public.create_paige_durable_work(p_expected_tenant_id,p_expected_actor_id,p_request_id,null,
  'planning.create','planning_week_review',jsonb_build_object('tenant_id',p_expected_tenant_id,'actor_user_id',p_expected_actor_id,'source','manual_operations_review'),
  'manual_operations_weekly_review_v1',300,1);
 select * into w from public.paige_durable_work where id=made.work_id for update;
 if w.request_payload is not null then raise exception 'WEEKLY_PLAN_REQUEST_CHANGED' using errcode='22023'; end if;
 update public.paige_durable_work set request_payload=p_review where id=w.id;
 title:='Week of '||starts::text||' — '||left(btrim(p_review->>'goal'),100);
 summary:='Goal: '||btrim(p_review->>'goal')||E'\nBusiness week: '||starts::text||' to '||ends::text||' ('||(p_review->>'zone')||E').\nAccepted commitments: '||cardinality(included)::text||'. Open the original plan to inspect their current authorized records.';
 summary:=summary||E'\n'||(cardinality(seen)-cardinality(included))::text||' other reviewed records are outside this accepted workload.'||
  E'\nCapacity is owner-confirmed net time for this work. Dates, assignments and Calendar reservations are unchanged. This plan does not approve or execute the underlying work.';
 if length(summary)>10000 then raise exception 'WEEKLY_PLAN_REVIEW_TOO_LARGE' using errcode='22023'; end if;
 r:=public.plan_create_scoped(p_expected_actor_id,p_expected_tenant_id,title,'week',starts,ends,'individual',p_expected_actor_id,summary);
 plan_id:=(r->>'plan_id')::uuid; receipt:=(r->>'receipt_run_id')::uuid;
 if r->>'ok' is distinct from 'true' or r->>'railRecorded' is distinct from 'true' or r->>'receipt_status' is distinct from 'recorded'
  or plan_id is null or receipt is null then raise exception 'WEEKLY_PLAN_RECEIPT_UNAVAILABLE' using errcode='55000'; end if;
 update public.plans set metadata=metadata||jsonb_build_object('weekly_plan_review_v1',jsonb_build_object(
  'request_id',p_request_id,'review',p_review,'used_minutes',used,'receipt_run_id',receipt,'reserves_time',false))
  where id=plan_id and tenant_id=p_expected_tenant_id and created_by=p_expected_actor_id returning updated_at into version;
 if not found or not exists(select 1 from public.paige_workspace_events e where e.tenant_id=p_expected_tenant_id and e.actor_id=p_expected_actor_id
  and e.source_id=receipt and e.source_kind='capability_run' and e.capability_key='plan_create' and e.outcome='capability_succeeded'
  and e.detail->>'record_table'='plans' and e.detail->>'record_id'=plan_id::text and (e.detail->>'source_version')::timestamptz=version) then
  raise exception 'WEEKLY_PLAN_RECEIPT_UNAVAILABLE' using errcode='55000'; end if;
 perform public.transition_paige_durable_work(w.id,w.idempotency_key,'succeeded',
  jsonb_build_object('verified_readback',true,'original_result',r),'The reviewed weekly plan was saved.');
 return public.get_weekly_plan_review_result_scoped(p_expected_actor_id,p_expected_tenant_id,p_request_id);
end $$;
revoke all on function public.save_weekly_plan_review_scoped(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_weekly_plan_review_scoped(uuid,uuid,uuid,jsonb) to authenticated;
-- Existing catalogue only: Limited native manual review, never Skills-runner
-- activation or a Live claim. Preserve customized/noncanonical descriptions.
update public.paige_skills s
 set description='Review permitted Tasks and Planning work with PAIGE or ZION, then confirm your goal, net available hours, effort and prerequisites in Operations. An eligible SOLO owner or administrator can explicitly save the reviewed weekly Plan and reopen its original receipt. This does not execute work, reserve Calendar time, enable automations or activate the separate Skills runner.',
 metadata=s.metadata||jsonb_build_object('catalogue_coverage',jsonb_build_object('version',1,'state','limited'))
 where s.id='0c0db79a-b1f3-4bba-9a1e-0fb94781473a' and s.slug='weekly_priorities_plan' and s.name='Weekly Priorities Plan'
 and s.category='operations_process' and s.scoping='platform' and s.created_by='system' and s.risk_level='draft' and s.status='active'
 and s.description=$weekly_copy$Drafts the week's operational priorities and focus plan for the business — the handful of highest-leverage outcomes for the week, sequenced with owners and mid-week checkpoints — and files it as a draft for approval. Reads open commitments and deadlines from the context layer and reuses the business's recurring weekly cadence; it plans the week, it does not execute or send anything. Internal operational planning, distinct from a per-client delivery status or a sales-pipeline view.$weekly_copy$
 and jsonb_typeof(s.metadata)='object' and not s.metadata ? 'catalogue_coverage';
commit;
