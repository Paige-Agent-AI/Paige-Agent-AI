-- Paige pipeline create is intentional about same names. Production traced the tenant's
-- duplicate same-name pipelines to silent creation; the governed create now refuses when an
-- active pipeline already carries the exact name, unless the command explicitly says
-- allowSameName. The refusal is an exception so nothing is cached under the refused key and
-- the follow-up intentional create settles cleanly. This body is 20261204000000's core,
-- unchanged except for this one guard.
create or replace function public.configure_tenant_pipeline_core_identity(
  _tenant_id uuid,
  _command jsonb,
  _idempotency_key text,
  _actor_kind text default 'human'
)
returns jsonb language plpgsql security definer set search_path=public as $$
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

  select * into _cached from public.pipeline_command_results where tenant_id=_tenant and idempotency_key=_idempotency_key;
  if found then
    if _cached.command_hash<>_hash then raise exception 'PIPELINE_IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    return _cached.result;
  end if;

  if _action='create_pipeline' then
    if coalesce(btrim(_command->>'name'),'')='' then raise exception 'PIPELINE_NAME_REQUIRED' using errcode='22023'; end if;
    -- Same-name creation is intentional or refused: the tenant's duplicate same-name pipelines
    -- traced to silent creation. An exception (not a returned refusal) so nothing idempotency-caches
    -- under the refused key; the follow-up allowSameName call settles cleanly under its own key.
    -- Both actors converge on this core, so the guard serves the board and PAIGE alike (§18).
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
      _stage_index:=_stage_index+1;
      insert into public.pipeline_stages(pipeline_id,label,description,order_index,stage_type,tenant_id,move_policy)
      values(_id,btrim(_proposed_stage->>'label'),nullif(btrim(_proposed_stage->>'description'),''),_stage_index,'open',_tenant,case when _proposed_stage->>'movePolicy'='approval' then 'approval' else 'direct' end);
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
      values(_pipeline.id,btrim(_command->>'label'),nullif(btrim(_command->>'description'),''),(select coalesce(max(order_index),0)+1 from public.pipeline_stages where pipeline_id=_pipeline.id),'open',_tenant,case when _command->>'movePolicy'='approval' then 'approval' else 'direct' end) returning id into _id;
      update public.pipelines set updated_at=now() where id=_pipeline.id;
      _result:=jsonb_build_object('ok',true,'outcome','stage_created','stage_id',_id,'message','Stage added.');
    else
      select * into _stage from public.pipeline_stages where id=(_command->>'stageId')::uuid and tenant_id=_tenant for update;
      if not found then raise exception 'PIPELINE_STAGE_NOT_FOUND' using errcode='22023'; end if;
      if _stage.version<>coalesce((_command->>'expectedVersion')::bigint,0) then raise exception 'PIPELINE_VERSION_CONFLICT' using errcode='40001'; end if;
      if _action='update_stage' then
        if coalesce(btrim(_command->>'label'),'')='' then raise exception 'PIPELINE_STAGE_NAME_REQUIRED' using errcode='22023'; end if;
        update public.pipeline_stages set label=btrim(_command->>'label'),description=nullif(btrim(_command->>'description'),''),move_policy=case when _command->>'movePolicy'='approval' then 'approval' else 'direct' end,updated_at=now() where id=_stage.id;
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
