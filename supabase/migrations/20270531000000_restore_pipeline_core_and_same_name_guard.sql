-- HOTFIX: 20270530000000 re-emitted the pipeline core from the wrong historical body. The
-- live core at that moment was 20270204000000's wrapper: it implements the governed deal
-- branches (create_deal, update_deal, move_deal, record_outcome, reopen_deal) and forwards
-- every pipeline/stage action to configure_tenant_pipeline_core_identity_pre_command_desk.
-- The mistaken body predates both and, once applied, broke every governed CRM deal
-- create/update/close/reopen, regressed the board's deal-move policy, and silently dropped
-- stageType semantics. This migration restores the wrapper VERBATIM from 20270204000000 and
-- re-declares the desk function from its live production body (intact throughout) carrying
-- the same-name guard 20270530000000 intended, placed where create actually executes.
CREATE OR REPLACE FUNCTION public.configure_tenant_pipeline_core_identity_pre_command_desk(_tenant_id uuid, _command jsonb, _idempotency_key text, _actor_kind text DEFAULT 'human'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  _caller uuid:=auth.uid();
  _tenant uuid:=coalesce(_tenant_id,public.current_user_tenant_id());
  _action text:=replace(coalesce(_command->>'type',''),'-','_');
  _hash text:=md5(coalesce(_command,'{}'::jsonb)::text);
  _cached public.pipeline_command_results%rowtype;
  _pipeline public.pipelines%rowtype;
  _stage public.pipeline_stages%rowtype;
  _deal public.deals%rowtype;
  _from_stage public.pipeline_stages%rowtype;
  _result jsonb;
  _id uuid;
  _ordered uuid[];
  _proposed_stage jsonb;
  _stage_index int:=0;
  _expected bigint;
  _dependencies jsonb;
  _deal_count int:=0; _route_count int:=0; _automation_count int:=0; _approval_count int:=0; _history_count int:=0;
begin
  if _caller is null or _tenant is null or not (public.is_platform_owner() or _tenant=public.current_user_tenant_id()) then raise exception 'PIPELINE_FORBIDDEN' using errcode='42501'; end if;
  if not (public.is_platform_owner() or public.is_tenant_admin(_tenant)) then raise exception 'PIPELINE_FORBIDDEN' using errcode='42501'; end if;
  if _actor_kind not in ('human','paige') then raise exception 'PIPELINE_ACTOR_INVALID' using errcode='22023'; end if;
  if coalesce(btrim(_idempotency_key),'')='' then raise exception 'PIPELINE_IDEMPOTENCY_REQUIRED' using errcode='22023'; end if;

  -- stageType is read as CAMELCASE, like every other key this function takes from the command
  -- (`movePolicy`, `pipelineId`, `expectedVersion`, `stageId`). useSoloCampaigns forwards the
  -- command object verbatim with no serializer, so reading 'stage_type' here would evaluate to
  -- NULL, fall through the absent-value rule, and silently write 'open' while reporting success.
  -- The sibling `create_pipeline_with_stages` DOES read snake_case, which is exactly how that bug
  -- would get copied in.
  if nullif(_command->>'stageType','') is not null and _command->>'stageType' not in ('open','won','lost') then
    raise exception 'PIPELINE_STAGE_TYPE_INVALID' using errcode='22023';
  end if;

  select * into _cached from public.pipeline_command_results where tenant_id=_tenant and idempotency_key=_idempotency_key;
  if found then
    if _cached.command_hash<>_hash then raise exception 'PIPELINE_IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    return _cached.result;
  end if;

  if _action='create_pipeline' then
    if coalesce(btrim(_command->>'name'),'')='' then raise exception 'PIPELINE_NAME_REQUIRED' using errcode='22023'; end if;
    -- Same-name creation is intentional or refused. An exception so nothing idempotency-caches
    -- under the refused key; the follow-up allowSameName call settles cleanly under its own key.
    -- Placed in the desk function where create actually executes for both actors.
    if (_command->>'allowSameName')::boolean is distinct from true
       and exists (select 1 from public.pipelines p where p.tenant_id=_tenant and p.archived_at is null and btrim(p.name)=btrim(_command->>'name')) then
      raise exception 'PIPELINE_NAME_EXISTS: an active pipeline already carries this exact name. Read pipeline_catalogue, show every same-name match with its PPL reference, and ask. The create command may carry allowSameName true only when the operator explicitly wants a second pipeline with this exact name.' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('pipeline-default:'||_tenant::text,0));
    insert into public.pipelines(name,description,is_default,created_by,tenant_id,lifecycle_status)
    values(btrim(_command->>'name'),nullif(btrim(_command->>'description'),''),not exists(select 1 from public.pipelines where tenant_id=_tenant),_caller,_tenant,'draft') returning id into _id;
    if _command ? 'stages' and jsonb_typeof(_command->'stages')<>'array' then raise exception 'PIPELINE_STAGES_INVALID' using errcode='22023'; end if;
    for _proposed_stage in select * from jsonb_array_elements(coalesce(_command->'stages','[]'::jsonb)) loop
      if coalesce(btrim(_proposed_stage->>'label'),'')='' then raise exception 'PIPELINE_STAGE_NAME_REQUIRED' using errcode='22023'; end if;
      if nullif(_proposed_stage->>'stageType','') is not null and _proposed_stage->>'stageType' not in ('open','won','lost') then
        raise exception 'PIPELINE_STAGE_TYPE_INVALID' using errcode='22023';
      end if;
      _stage_index:=_stage_index+1;
      insert into public.pipeline_stages(pipeline_id,label,description,order_index,stage_type,tenant_id,move_policy)
      values(_id,btrim(_proposed_stage->>'label'),nullif(btrim(_proposed_stage->>'description'),''),_stage_index,coalesce(nullif(_proposed_stage->>'stageType',''),'open'),_tenant,case when _proposed_stage->>'movePolicy'='approval' then 'approval' else 'direct' end);
    end loop;
    _result:=jsonb_build_object('ok',true,'outcome','created','pipeline_id',_id,'stage_count',_stage_index,'message',case when _stage_index=0 then 'Blank pipeline created as a draft. Add at least one named stage before activation.' else 'Editable pipeline proposal saved as a draft. Review every stage before activation.' end);
  elsif _action in ('update_pipeline','activate_pipeline','archive_pipeline','restore_pipeline','delete_pipeline') then
    select * into _pipeline from public.pipelines where id=(_command->>'pipelineId')::uuid and tenant_id=_tenant for update;
    if not found then raise exception 'PIPELINE_NOT_FOUND' using errcode='22023'; end if;
    _expected:=coalesce((_command->>'expectedVersion')::bigint,0);
    if _pipeline.version<>_expected then raise exception 'PIPELINE_VERSION_CONFLICT' using errcode='40001'; end if;
    if _action='update_pipeline' then
      if coalesce(btrim(_command->>'name'),'')='' then raise exception 'PIPELINE_NAME_REQUIRED' using errcode='22023'; end if;
      update public.pipelines set name=btrim(_command->>'name'),description=nullif(btrim(_command->>'description'),''),updated_at=now() where id=_pipeline.id;
      _result:=jsonb_build_object('ok',true,'outcome','updated','pipeline_id',_pipeline.id,'message','Pipeline details saved.');
    elsif _action='activate_pipeline' then
      if coalesce(btrim(_pipeline.name),'')='' or not exists(select 1 from public.pipeline_stages where pipeline_id=_pipeline.id and archived_at is null and btrim(label)<>'') then raise exception 'PIPELINE_ACTIVATION_INVALID' using errcode='22023'; end if;
      update public.pipelines set lifecycle_status='active',updated_at=now() where id=_pipeline.id;
      _result:=jsonb_build_object('ok',true,'outcome','activated','pipeline_id',_pipeline.id,'message','Pipeline activated.');
    elsif _action='restore_pipeline' then
      update public.pipelines set lifecycle_status='draft',updated_at=now() where id=_pipeline.id;
      _result:=jsonb_build_object('ok',true,'outcome','restored','pipeline_id',_pipeline.id,'message','Pipeline restored as a draft.');
    else
      select count(*) into _deal_count from public.deals where pipeline_id=_pipeline.id;
      select count(*) into _route_count from public.growth_forms where tenant_id=_tenant and pipeline_id=_pipeline.id;
      select count(*) into _automation_count from public.stage_automation_rules where tenant_id=_tenant and pipeline_id=_pipeline.id;
      select count(*) into _approval_count from public.pipeline_move_approvals where tenant_id=_tenant and deal_id in (select id from public.deals where pipeline_id=_pipeline.id);
      select count(*) into _history_count from public.deal_activities where deal_id in (select id from public.deals where pipeline_id=_pipeline.id);
      _dependencies:=jsonb_build_object('deals',_deal_count,'routes',_route_count,'approvals',_approval_count,'automations',_automation_count,'history',_history_count);
      if _deal_count+_route_count+_approval_count+_automation_count+_history_count>0 then
        _result:=jsonb_build_object('ok',false,'outcome','PIPELINE_DEPENDENCIES_UNRESOLVED','pipeline_id',_pipeline.id,'dependencies',_dependencies,'message','This pipeline still has dependent deals, routes, approvals, automations, or retained history. Resolve the listed dependencies before archiving or deleting it.');
      elsif _action='archive_pipeline' then
        update public.pipelines set lifecycle_status='archived',updated_at=now() where id=_pipeline.id;
        _result:=jsonb_build_object('ok',true,'outcome','archived','pipeline_id',_pipeline.id,'dependencies',_dependencies,'message','Pipeline archived.');
      else
        delete from public.pipelines where id=_pipeline.id;
        _result:=jsonb_build_object('ok',true,'outcome','deleted','pipeline_id',_pipeline.id,'dependencies',_dependencies,'message','Empty pipeline deleted.');
      end if;
    end if;
  elsif _action in ('create_stage','update_stage','archive_stage','restore_stage','delete_stage') then
    if _action='create_stage' then
      select * into _pipeline from public.pipelines where id=(_command->>'pipelineId')::uuid and tenant_id=_tenant for update;
      if not found then raise exception 'PIPELINE_NOT_FOUND' using errcode='22023'; end if;
      if _pipeline.version<>coalesce((_command->>'expectedVersion')::bigint,0) then raise exception 'PIPELINE_VERSION_CONFLICT' using errcode='40001'; end if;
      if coalesce(btrim(_command->>'label'),'')='' then raise exception 'PIPELINE_STAGE_NAME_REQUIRED' using errcode='22023'; end if;
      perform pg_advisory_xact_lock(hashtextextended('pipeline-stage-order:'||_pipeline.id::text,0));
      insert into public.pipeline_stages(pipeline_id,label,description,order_index,stage_type,tenant_id,move_policy)
      values(_pipeline.id,btrim(_command->>'label'),nullif(btrim(_command->>'description'),''),(select coalesce(max(order_index),0)+1 from public.pipeline_stages where pipeline_id=_pipeline.id),coalesce(nullif(_command->>'stageType',''),'open'),_tenant,case when _command->>'movePolicy'='approval' then 'approval' else 'direct' end) returning id into _id;
      update public.pipelines set updated_at=now() where id=_pipeline.id;
      _result:=jsonb_build_object('ok',true,'outcome','stage_created','stage_id',_id,'message','Stage added.');
    else
      select * into _stage from public.pipeline_stages where id=(_command->>'stageId')::uuid and tenant_id=_tenant for update;
      if not found then raise exception 'PIPELINE_STAGE_NOT_FOUND' using errcode='22023'; end if;
      if _stage.version<>coalesce((_command->>'expectedVersion')::bigint,0) then raise exception 'PIPELINE_VERSION_CONFLICT' using errcode='40001'; end if;
      if _action='update_stage' then
        if coalesce(btrim(_command->>'label'),'')='' then raise exception 'PIPELINE_STAGE_NAME_REQUIRED' using errcode='22023'; end if;
        update public.pipeline_stages set label=btrim(_command->>'label'),description=nullif(btrim(_command->>'description'),''),move_policy=case when _command->>'movePolicy'='approval' then 'approval' else 'direct' end,stage_type=coalesce(nullif(_command->>'stageType',''),_stage.stage_type),updated_at=now() where id=_stage.id;
        _result:=jsonb_build_object('ok',true,'outcome','stage_updated','stage_id',_stage.id,'message','Stage saved.');
      elsif _action='restore_stage' then
        update public.pipeline_stages set archived_at=null,archived_by=null,updated_at=now() where id=_stage.id;
        _result:=jsonb_build_object('ok',true,'outcome','stage_restored','stage_id',_stage.id,'message','Stage restored.');
      else
        select count(*) into _deal_count from public.deals where stage_id=_stage.id;
        select count(*) into _route_count from public.growth_forms where tenant_id=_tenant and stage_id=_stage.id;
        select count(*) into _automation_count from public.stage_automation_rules where tenant_id=_tenant and (from_stage_id=_stage.id or to_stage_id=_stage.id);
        select count(*) into _approval_count from public.pipeline_move_approvals where tenant_id=_tenant and (from_stage_id=_stage.id or to_stage_id=_stage.id);
        select count(*) into _history_count from public.deal_activities where payload->>'stage_id'=_stage.id::text or payload->>'from_stage_id'=_stage.id::text or payload->>'to_stage_id'=_stage.id::text;
        _dependencies:=jsonb_build_object('deals',_deal_count,'routes',_route_count,'approvals',_approval_count,'automations',_automation_count,'history',_history_count);
        if _deal_count+_route_count+_approval_count+_automation_count+_history_count>0 then
          _result:=jsonb_build_object('ok',false,'outcome','PIPELINE_DEPENDENCIES_UNRESOLVED','stage_id',_stage.id,'dependencies',_dependencies,'message','This stage still has dependent deals, routes, approvals, automations, or retained history. Resolve the listed dependencies before archiving or deleting it.');
        elsif _action='archive_stage' then
          update public.pipeline_stages set archived_at=now(),archived_by=_caller,updated_at=now() where id=_stage.id;
          _result:=jsonb_build_object('ok',true,'outcome','stage_archived','stage_id',_stage.id,'dependencies',_dependencies,'message','Stage archived.');
        else
          delete from public.pipeline_stages where id=_stage.id;
          _result:=jsonb_build_object('ok',true,'outcome','stage_deleted','stage_id',_stage.id,'dependencies',_dependencies,'message','Empty stage deleted.');
        end if;
      end if;
    end if;
  elsif _action='reorder_stages' then
    select * into _pipeline from public.pipelines where id=(_command->>'pipelineId')::uuid and tenant_id=_tenant for update;
    if not found then raise exception 'PIPELINE_NOT_FOUND' using errcode='22023'; end if;
    if _pipeline.version<>coalesce((_command->>'expectedVersion')::bigint,0) then raise exception 'PIPELINE_VERSION_CONFLICT' using errcode='40001'; end if;
    select array_agg(value::uuid order by ordinality) into _ordered from jsonb_array_elements_text(coalesce(_command->'orderedIds','[]'::jsonb)) with ordinality;
    if coalesce(array_length(_ordered,1),0)<>(select count(*) from public.pipeline_stages where pipeline_id=_pipeline.id and archived_at is null) or exists(select 1 from unnest(_ordered) id left join public.pipeline_stages s on s.id=id and s.pipeline_id=_pipeline.id and s.archived_at is null where s.id is null) then raise exception 'PIPELINE_STAGE_ORDER_INVALID' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended('pipeline-stage-order:'||_pipeline.id::text,0));
    for _deal_count in 1..array_length(_ordered,1) loop update public.pipeline_stages set order_index=_deal_count,updated_at=now() where id=_ordered[_deal_count]; end loop;
    update public.pipelines set updated_at=now() where id=_pipeline.id;
    _result:=jsonb_build_object('ok',true,'outcome','stages_reordered','pipeline_id',_pipeline.id,'message','Stage order saved.');
  elsif _action='move_deal' then
    select * into _deal from public.deals where id=(_command->>'dealId')::uuid and tenant_id=_tenant for update;
    if not found then raise exception 'PIPELINE_DEAL_NOT_FOUND' using errcode='22023'; end if;
    if _deal.version<>coalesce((_command->>'expectedVersion')::bigint,0) then
      return jsonb_build_object('ok',false,'outcome','PIPELINE_VERSION_CONFLICT','deal_id',_deal.id,'current_stage_id',_deal.stage_id,'current_version',_deal.version,'message','This deal changed somewhere else. Its current durable stage and version were returned; review them before making a new move.');
    end if;
    select * into _from_stage from public.pipeline_stages where id=_deal.stage_id;
    select * into _stage from public.pipeline_stages where id=(_command->>'targetStageId')::uuid and tenant_id=_tenant and pipeline_id=_deal.pipeline_id and archived_at is null;
    if not found then raise exception 'PIPELINE_TARGET_INVALID' using errcode='22023'; end if;
    if _stage.move_policy='approval' then
      insert into public.pipeline_move_approvals(tenant_id,deal_id,from_stage_id,to_stage_id,requested_by,actor_kind,reason,idempotency_key)
      values(_tenant,_deal.id,_deal.stage_id,_stage.id,_caller,_actor_kind,nullif(btrim(_command->>'reason'),''),_idempotency_key) returning id into _id;
      _result:=jsonb_build_object('ok',true,'outcome','held','approval_id',_id,'deal_id',_deal.id,'current_stage_id',_deal.stage_id,'requested_stage_id',_stage.id,'message','Approval is required. The deal stayed in '||_from_stage.label||' and a held request was recorded for '||_stage.label||'.');
    else
      update public.deals set stage_id=_stage.id,
             status=case _stage.stage_type when 'won' then 'won' when 'lost' then 'lost' else 'open' end,
             actual_close_date=case when _stage.stage_type in ('won','lost') then current_date else null end,
             updated_at=now() where id=_deal.id;
      insert into public.deal_activities(deal_id,type,summary,actor_user_id,payload)
      values(_deal.id,'stage_changed','Moved from '||_from_stage.label||' to '||_stage.label,_caller,jsonb_build_object('from_stage_id',_from_stage.id,'from_stage_label',_from_stage.label,'to_stage_id',_stage.id,'to_stage_label',_stage.label,'actor_kind',_actor_kind,'reason',nullif(btrim(_command->>'reason'),''),'idempotency_key',_idempotency_key));
      if _deal.contact_client_id is not null then
        begin
          perform public.record_rail_event(_deal.contact_client_id,'owner.crm_mutation','campaigns_pipeline',case when _actor_kind='paige' then 'paige_agent' else 'owner_staff' end,'Deal moved','Moved from '||_from_stage.label||' to '||_stage.label,jsonb_build_object('deal_id',_deal.id,'from_stage_id',_from_stage.id,'from_stage_label',_from_stage.label,'to_stage_id',_stage.id,'to_stage_label',_stage.label,'actor_kind',_actor_kind,'policy_result','allowed'),'deals',_deal.id,'owner_ops',null,now(),true,_tenant);
        exception when others then raise warning 'pipeline rail emit failed for deal %: %',_deal.id,sqlerrm; end;
      end if;
      _result:=jsonb_build_object('ok',true,'outcome','moved','deal_id',_deal.id,'from_stage_id',_from_stage.id,'to_stage_id',_stage.id,'message','Deal moved to '||_stage.label||'.');
    end if;
  else
    raise exception 'PIPELINE_ACTION_INVALID' using errcode='22023';
  end if;

  insert into public.audit_logs(user_id,entity,action,entity_id,data)
  values(_caller,'pipeline','pipeline.configure',coalesce((_result->>'pipeline_id')::uuid,(_result->>'stage_id')::uuid,(_result->>'deal_id')::uuid),jsonb_build_object('tenant_id',_tenant,'actor_kind',_actor_kind,'command',_action,'idempotency_key',_idempotency_key,'outcome',_result->>'outcome'));
  insert into public.pipeline_command_results(tenant_id,idempotency_key,command_hash,actor_user_id,actor_kind,result) values(_tenant,_idempotency_key,_hash,_caller,_actor_kind,_result);
  return _result;
end$$;

create or replace function public.configure_tenant_pipeline_core_identity(
  _tenant_id uuid,_command jsonb,_idempotency_key text,_actor_kind text default 'human'
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  _caller uuid:=auth.uid(); _tenant uuid:=coalesce(_tenant_id,public.current_user_tenant_id());
  _action text:=replace(coalesce(_command->>'type',''),'-','_');
  _hash text:=md5(coalesce(_command,'{}'::jsonb)::text);
  _cached public.pipeline_command_results%rowtype; _pipeline public.pipelines%rowtype;
  _deal public.deals%rowtype; _from_stage public.pipeline_stages%rowtype; _stage public.pipeline_stages%rowtype;
  _result jsonb; _id uuid; _outcome text; _reason text; _outcome_date date; _through text;
  _approval_channel text:=current_setting('app.crm_approval_channel',true);
begin
  if _action not in ('create_deal','update_deal','move_deal','record_outcome','reopen_deal') then return public.configure_tenant_pipeline_core_identity_pre_command_desk(_tenant_id,_command,_idempotency_key,_actor_kind); end if;
  if _caller is null or _tenant is null or not (public.is_platform_owner() or _tenant=public.current_user_tenant_id()) then raise exception 'PIPELINE_FORBIDDEN' using errcode='42501'; end if;
  if not (public.is_platform_owner() or public.is_tenant_admin(_tenant)) then raise exception 'PIPELINE_FORBIDDEN' using errcode='42501'; end if;
  if _actor_kind not in ('human','paige') then raise exception 'PIPELINE_ACTOR_INVALID' using errcode='22023'; end if;
  if _actor_kind='paige' and coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'PIPELINE_GOVERNED_EXECUTOR_REQUIRED' using errcode='42501'; end if;
  if _command is null or jsonb_typeof(_command)<>'object' or coalesce(btrim(_idempotency_key),'')='' or length(_idempotency_key)>200 then raise exception 'PIPELINE_COMMAND_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pipeline-command:'||_tenant::text||':'||_idempotency_key,0));
  select * into _cached from public.pipeline_command_results where tenant_id=_tenant and idempotency_key=_idempotency_key for update;
  if found then
    if _cached.command_hash is distinct from _hash or _cached.actor_user_id is distinct from _caller or _cached.actor_kind is distinct from _actor_kind then raise exception 'PIPELINE_IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    return _cached.result||jsonb_build_object('replayed',true);
  end if;
  _through:=case when _actor_kind='paige' then 'paige' when exists(select 1 from public.tenants t where t.id=_tenant and t.owner_user_id=_caller) then 'owner' else 'team_member' end;

  if _action='create_deal' then
    if coalesce(btrim(_command->>'title'),'')='' then raise exception 'PIPELINE_DEAL_TITLE_REQUIRED' using errcode='22023'; end if;
    select * into _pipeline from public.pipelines where id=(_command->>'pipelineId')::uuid and tenant_id=_tenant and lifecycle_status<>'archived' for update;
    if not found then raise exception 'PIPELINE_NOT_FOUND' using errcode='22023'; end if;
    select * into _stage from public.pipeline_stages where id=(_command->>'stageId')::uuid and tenant_id=_tenant and pipeline_id=_pipeline.id and archived_at is null for update;
    if not found or _stage.stage_type<>'open' then raise exception 'PIPELINE_OPEN_STAGE_REQUIRED' using errcode='22023'; end if;
    if nullif(_command->>'clientId','') is not null and not exists(select 1 from public.clients c where c.id=(_command->>'clientId')::uuid and c.tenant_id=_tenant) then raise exception 'PIPELINE_CLIENT_INVALID' using errcode='42501'; end if;
    if nullif(_command->>'ownerUserId','') is not null then
      perform 1 from public.tenant_members tm where tm.tenant_id=_tenant and tm.user_id=(_command->>'ownerUserId')::uuid and tm.status='active' for update;
      if not found then raise exception 'PIPELINE_OWNER_INVALID' using errcode='42501'; end if;
    end if;
    if _command ? 'valueCents' and (jsonb_typeof(_command->'valueCents') is distinct from 'number'
      or (_command->>'valueCents')::numeric<0 or (_command->>'valueCents')::numeric<>trunc((_command->>'valueCents')::numeric))
    then raise exception 'PIPELINE_VALUE_INVALID' using errcode='22023'; end if;
    if _command ? 'currency' and coalesce(_command->>'currency','') !~ '^[A-Z]{3}$' then raise exception 'PIPELINE_CURRENCY_INVALID' using errcode='22023'; end if;
    insert into public.deals(title,pipeline_id,stage_id,contact_client_id,owner_user_id,value_cents,currency,expected_close_date,offer_type,status,source,tags,notes,created_by,tenant_id)
    values(btrim(_command->>'title'),_pipeline.id,_stage.id,nullif(_command->>'clientId','')::uuid,coalesce(nullif(_command->>'ownerUserId','')::uuid,_caller),
      coalesce((_command->>'valueCents')::bigint,0),coalesce(nullif(_command->>'currency',''),'USD'),nullif(_command->>'expectedCloseDate','')::date,
      nullif(btrim(_command->>'offerType'),''),'open',case when _actor_kind='paige' then 'paige' else 'owner_entered' end,
      coalesce(array(select jsonb_array_elements_text(coalesce(_command->'tags','[]'::jsonb))),array[]::text[]),
      nullif(btrim(_command->>'notes'),''),_caller,_tenant) returning * into _deal;
    insert into public.deal_activities(deal_id,type,summary,actor_user_id,payload)
    values(_deal.id,'created','Deal created in '||_stage.label,_caller,jsonb_build_object('stage_id',_stage.id,'stage_label',_stage.label,'actor_kind',_actor_kind,'idempotency_key',_idempotency_key));
    _result:=jsonb_build_object('ok',true,'outcome','created','deal_id',_deal.id,'pipeline_id',_pipeline.id,'stage_id',_stage.id,'message','Deal created in '||_stage.label||'.');
  else
    select * into _deal from public.deals where id=(_command->>'dealId')::uuid and tenant_id=_tenant for update;
    if not found then raise exception 'PIPELINE_DEAL_NOT_FOUND' using errcode='22023'; end if;
    if _deal.version<>coalesce((_command->>'expectedVersion')::bigint,0) then return jsonb_build_object('ok',false,'outcome','PIPELINE_VERSION_CONFLICT','deal_id',_deal.id,'current_stage_id',_deal.stage_id,'current_version',_deal.version,'message','This deal changed somewhere else. Reload it before trying again.'); end if;
    if _action in ('move_deal','record_outcome') and coalesce(_deal.status,'open')<>'open' then raise exception 'PIPELINE_DEAL_ALREADY_CLOSED' using errcode='22023'; end if;
    if _action='reopen_deal' and coalesce(_deal.status,'open')='open' then raise exception 'PIPELINE_DEAL_ALREADY_OPEN' using errcode='22023'; end if;
    select * into _pipeline from public.pipelines where id=_deal.pipeline_id and tenant_id=_tenant and lifecycle_status<>'archived';
    if not found then raise exception 'PIPELINE_NOT_FOUND' using errcode='22023'; end if;

    if _action='update_deal' then
      if _command ? 'title' and coalesce(btrim(_command->>'title'),'')='' then raise exception 'PIPELINE_DEAL_TITLE_REQUIRED' using errcode='22023'; end if;
      if nullif(_command->>'clientId','') is not null and not exists(select 1 from public.clients c where c.id=(_command->>'clientId')::uuid and c.tenant_id=_tenant) then raise exception 'PIPELINE_CLIENT_INVALID' using errcode='42501'; end if;
      if nullif(_command->>'ownerUserId','') is not null then
        perform 1 from public.tenant_members tm where tm.tenant_id=_tenant and tm.user_id=(_command->>'ownerUserId')::uuid and tm.status='active' for update;
        if not found then raise exception 'PIPELINE_OWNER_INVALID' using errcode='42501'; end if;
      end if;
      if _command ? 'valueCents' and (jsonb_typeof(_command->'valueCents') is distinct from 'number'
        or (_command->>'valueCents')::numeric<0 or (_command->>'valueCents')::numeric<>trunc((_command->>'valueCents')::numeric))
      then raise exception 'PIPELINE_VALUE_INVALID' using errcode='22023'; end if;
      if _command ? 'currency' and coalesce(_command->>'currency','') !~ '^[A-Z]{3}$' then raise exception 'PIPELINE_CURRENCY_INVALID' using errcode='22023'; end if;
      update public.deals set
        title=case when _command ? 'title' then btrim(_command->>'title') else title end,
        contact_client_id=case when _command ? 'clientId' then nullif(_command->>'clientId','')::uuid else contact_client_id end,
        owner_user_id=case when _command ? 'ownerUserId' then nullif(_command->>'ownerUserId','')::uuid else owner_user_id end,
        value_cents=case when _command ? 'valueCents' then (_command->>'valueCents')::bigint else value_cents end,
        currency=case when _command ? 'currency' then _command->>'currency' else currency end,
        expected_close_date=case when _command ? 'expectedCloseDate' then nullif(_command->>'expectedCloseDate','')::date else expected_close_date end,
        offer_type=case when _command ? 'offerType' then nullif(btrim(_command->>'offerType'),'') else offer_type end,
        tags=case when _command ? 'tags' then coalesce(array(select jsonb_array_elements_text(_command->'tags')),array[]::text[]) else tags end,
        notes=case when _command ? 'notes' then nullif(btrim(_command->>'notes'),'') else notes end,
        updated_at=now() where id=_deal.id returning * into _deal;
      insert into public.deal_activities(deal_id,type,summary,actor_user_id,payload) values(_deal.id,'updated','Deal details updated',_caller,jsonb_build_object('actor_kind',_actor_kind,'idempotency_key',_idempotency_key));
      _result:=jsonb_build_object('ok',true,'outcome','updated','deal_id',_deal.id,'version',_deal.version,'message','Deal details saved.');
    elsif _action='move_deal' then
      select * into _from_stage from public.pipeline_stages where id=_deal.stage_id and tenant_id=_tenant and pipeline_id=_deal.pipeline_id;
      select * into _stage from public.pipeline_stages where id=(_command->>'targetStageId')::uuid and tenant_id=_tenant and pipeline_id=_deal.pipeline_id and archived_at is null for update;
      if not found then raise exception 'PIPELINE_TARGET_INVALID' using errcode='22023'; end if;
      if _stage.id=_from_stage.id then raise exception 'PIPELINE_ALREADY_IN_STAGE' using errcode='22023'; end if;
      if _stage.stage_type in ('won','lost') then
        _result:=jsonb_build_object('ok',false,'outcome','outcome_required','deal_id',_deal.id,'target_stage_id',_stage.id,'suggested_outcome',_stage.stage_type,'message','Record the exact outcome before moving this deal into a closing stage.');
      elsif _stage.move_policy='approval' then
        _result:=jsonb_build_object('ok',false,'outcome','approval_required','deal_id',_deal.id,'current_stage_id',_deal.stage_id,'requested_stage_id',_stage.id,'message','This stage requires the existing PAIGE approval path. No separate Pipeline approval was created, and the deal stayed in '||_from_stage.label||'.');
      else
        perform public.assert_pipeline_automation_not_active(_tenant,_deal.pipeline_id,_deal.stage_id,_stage.id);
        update public.deals set stage_id=_stage.id,status='open',actual_close_date=null,lost_reason=null,updated_at=now() where id=_deal.id returning * into _deal;
        insert into public.deal_activities(deal_id,type,summary,actor_user_id,payload)
        values(_deal.id,'stage_changed','Moved from '||_from_stage.label||' to '||_stage.label,_caller,jsonb_build_object('from_stage_id',_from_stage.id,'from_stage_label',_from_stage.label,'to_stage_id',_stage.id,'to_stage_label',_stage.label,'actor_kind',_actor_kind,'reason',nullif(btrim(_command->>'reason'),''),'idempotency_key',_idempotency_key));
        _result:=jsonb_build_object('ok',true,'outcome','moved','deal_id',_deal.id,'from_stage_id',_from_stage.id,'to_stage_id',_stage.id,'version',_deal.version,'message','Deal moved to '||_stage.label||'.');
      end if;
    elsif _action='record_outcome' then
      _outcome:=_command->>'outcomeType';
      if _outcome not in ('won','lost','not_fit','closed_without_decision') then raise exception 'PIPELINE_OUTCOME_INVALID' using errcode='22023'; end if;
      _reason:=nullif(btrim(_command->>'reason'),'');
      if _outcome<>'won' and _reason is null then raise exception 'PIPELINE_OUTCOME_REASON_REQUIRED' using errcode='22023'; end if;
      _outcome_date:=coalesce(nullif(_command->>'outcomeDate','')::date,current_date);
      if _outcome_date>current_date then raise exception 'PIPELINE_OUTCOME_DATE_INVALID' using errcode='22023'; end if;
      if nullif(_command->>'targetStageId','') is not null then
        select * into _stage from public.pipeline_stages where id=(_command->>'targetStageId')::uuid and tenant_id=_tenant and pipeline_id=_deal.pipeline_id and archived_at is null for update;
        if not found then raise exception 'PIPELINE_TARGET_INVALID' using errcode='22023'; end if;
        if (_outcome='won' and _stage.stage_type<>'won') or (_outcome in ('lost','not_fit','closed_without_decision') and _stage.stage_type<>'lost') then raise exception 'PIPELINE_OUTCOME_STAGE_MISMATCH' using errcode='22023'; end if;
        if _stage.move_policy='approval' and _approval_channel is distinct from 'operator_card' then raise exception 'PIPELINE_APPROVAL_REQUIRED' using errcode='42501'; end if;
        perform public.assert_pipeline_automation_not_active(_tenant,_deal.pipeline_id,_deal.stage_id,_stage.id);
      end if;
      insert into public.pipeline_deal_outcomes(tenant_id,pipeline_id,deal_id,outcome_type,reason,notes,outcome_date,recorded_by,created_through)
      values(_tenant,_deal.pipeline_id,_deal.id,_outcome,_reason,nullif(btrim(_command->>'notes'),''),_outcome_date,_caller,_through) returning id into _id;
      update public.deals set stage_id=coalesce(_stage.id,stage_id),status=case when _outcome='won' then 'won' else 'lost' end,
        actual_close_date=_outcome_date,lost_reason=case when _outcome='won' then null else _reason end,updated_at=now()
        where id=_deal.id returning * into _deal;
      insert into public.deal_activities(deal_id,type,summary,actor_user_id,payload)
      values(_deal.id,'outcome_recorded',case _outcome when 'won' then 'Marked won' when 'lost' then 'Marked lost' when 'not_fit' then 'Marked not a fit' else 'Closed without decision' end,_caller,
        jsonb_build_object('outcome_id',_id,'outcome_type',_outcome,'outcome_date',_outcome_date,'reason',_reason,'actor_kind',_actor_kind,'idempotency_key',_idempotency_key));
      _result:=jsonb_build_object('ok',true,'outcome','outcome_recorded','deal_id',_deal.id,'outcome_id',_id,'outcome_type',_outcome,'version',_deal.version,'message','Outcome recorded.');
    else
      select * into _stage from public.pipeline_stages where id=(_command->>'targetStageId')::uuid and tenant_id=_tenant and pipeline_id=_deal.pipeline_id and archived_at is null and stage_type='open' for update;
      if not found then raise exception 'PIPELINE_OPEN_STAGE_REQUIRED' using errcode='22023'; end if;
      if _stage.move_policy='approval' and _approval_channel is distinct from 'operator_card' then raise exception 'PIPELINE_APPROVAL_REQUIRED' using errcode='42501'; end if;
      perform public.assert_pipeline_automation_not_active(_tenant,_deal.pipeline_id,_deal.stage_id,_stage.id);
      insert into public.pipeline_deal_outcomes(tenant_id,pipeline_id,deal_id,outcome_type,outcome_date,recorded_by,created_through)
      values(_tenant,_deal.pipeline_id,_deal.id,'reopened',current_date,_caller,_through) returning id into _id;
      update public.deals set stage_id=_stage.id,status='open',actual_close_date=null,lost_reason=null,updated_at=now() where id=_deal.id returning * into _deal;
      insert into public.deal_activities(deal_id,type,summary,actor_user_id,payload)
      values(_deal.id,'reopened','Reopened in '||_stage.label,_caller,jsonb_build_object('outcome_id',_id,'to_stage_id',_stage.id,'to_stage_label',_stage.label,'actor_kind',_actor_kind,'idempotency_key',_idempotency_key));
      _result:=jsonb_build_object('ok',true,'outcome','reopened','deal_id',_deal.id,'outcome_id',_id,'to_stage_id',_stage.id,'version',_deal.version,'message','Deal reopened in '||_stage.label||'.');
    end if;
  end if;

  if (_result->>'ok')::boolean and _result->>'deal_id' is not null then
    select * into _deal from public.deals where id=(_result->>'deal_id')::uuid;
    if _deal.contact_client_id is not null then
      perform public.record_rail_event(_deal.contact_client_id,'owner.crm_mutation','campaigns_pipeline',case when _actor_kind='paige' then 'paige_agent' else 'owner_staff' end,
        case when _action='record_outcome' then 'Deal outcome recorded' when _action='create_deal' then 'Deal created' when _action='update_deal' then 'Deal updated' when _action='reopen_deal' then 'Deal reopened' else 'Deal moved' end,
        _result->>'message',jsonb_build_object('deal_id',_deal.id,'pipeline_id',_deal.pipeline_id,'action',_action,'outcome',_result->>'outcome','idempotency_key',_idempotency_key),
        'deals',_deal.id,'owner_ops',null,now(),true,_tenant);
    end if;
  end if;
  insert into public.audit_logs(user_id,entity,action,entity_id,data)
  values(_caller,'pipeline_deal','pipeline.deal.'||_action,coalesce((_result->>'deal_id')::uuid,_deal.id),jsonb_build_object('tenant_id',_tenant,'actor_kind',_actor_kind,'idempotency_key',_idempotency_key,'outcome',_result->>'outcome'));
  insert into public.pipeline_command_results(tenant_id,idempotency_key,command_hash,actor_user_id,actor_kind,result)
  values(_tenant,_idempotency_key,_hash,_caller,_actor_kind,_result);
  return _result;
end$$;
revoke all on function public.configure_tenant_pipeline_core_identity(uuid,jsonb,text,text) from public,anon,authenticated,service_role;

