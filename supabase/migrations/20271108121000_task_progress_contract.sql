-- ANT-21: start existing canonical CRM tasks through their governed writer.
-- Additive task.update patch.status='in_progress' only for pending/in_progress.
-- No historical migration, caller signature, role/grant, approval, replay, Rail,
-- provider, scheduler or Planning item contract changes. No data backfill.
--
-- Restate the current executor whole so the incumbent crm-patch-field generator
-- and its native pg_get_functiondef twin derive exactly the installed allowlist.
-- Base is 20270516000000 plus the installed 20270523000000 dynamic canonical
-- hash/replay/name-guard patch. All later INT346 admission/executor routines,
-- locked stored arguments, service-only wrapper and authority remain unchanged.
-- CREATE OR REPLACE preserves the existing function identity, owner and ACL.
-- migration-lint-ignore: pattern-2 -- existing executor body restated; its prior
-- INSERT/SELECT statements are unchanged and no new bulk insert is introduced.
begin;

CREATE OR REPLACE FUNCTION public.execute_crm_command_reversible(_tenant_id uuid, _actor_id uuid, _command jsonb, _idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor uuid := _actor_id;
  v_tenant uuid := _tenant_id;
  v_action text := nullif(btrim(_command->>'action'), '');
  v_reported_action text;
  v_hash text;
  v_cached public.crm_command_results%rowtype;
  v_contact public.clients%rowtype;
  v_business public.businesses%rowtype;
  v_task public.tasks%rowtype;
  v_note public.client_notes%rowtype;
  v_deal public.deals%rowtype;
  v_pipeline_result jsonb;
  v_old_sub text;
  v_old_approval_channel text;
  v_is_admin boolean := false;
  v_is_coach boolean := false;
  v_can_touch_contact boolean := false;
  v_expected timestamptz;
  v_patch jsonb := coalesce(_command->'patch', '{}'::jsonb);
  v_unknown text[];
  v_result jsonb;
  v_readback jsonb;
  v_capability text;
  v_run_id uuid;
  v_company_owner uuid;
  v_created record;
begin
  -- Only the verified server action door can reach this executor. Tenant and actor are
  -- resolved there from the caller JWT, then re-bound to an active role again here.
  if coalesce(auth.jwt()->>'role','') <> 'service_role' or auth.uid() is not null then
    raise exception 'CRM_INTERNAL_EXECUTOR_REQUIRED' using errcode = '42501';
  end if;
  if v_actor is null then
    raise exception 'CRM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  if v_tenant is null then
    raise exception 'CRM_TENANT_REQUIRED' using errcode = '42501';
  end if;
  if _command is null or jsonb_typeof(_command) <> 'object'
     or v_action is null
     or coalesce(btrim(_idempotency_key), '') = ''
     or length(_idempotency_key) > 200 then
    raise exception 'CRM_COMMAND_INVALID' using errcode = '22023';
  end if;
  perform 1 from public.tenants tenant_row where tenant_row.id=v_tenant and tenant_row.status in ('trial','active','past_due') for update;
  if not found then raise exception 'CRM_TENANT_SUSPENDED' using errcode='42501'; end if;

  perform 1 from public.tenant_members tm
   where tm.tenant_id = v_tenant and tm.user_id = v_actor and tm.status = 'active' and tm.role in ('owner','admin') for update;
  v_is_admin:=found;
  v_is_coach:=false;
  if not (v_is_admin or v_is_coach) then
    raise exception 'CRM_FORBIDDEN' using errcode = '42501';
  end if;

  -- The command table is only a tenant-bound replay/cache seam. It does not replace audit or Rail.
  v_hash := encode(extensions.digest(convert_to(public.crm_effective_command(_command)::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('crm-command:' || v_tenant::text || ':' || v_actor::text || ':' || _idempotency_key, 0));
  select * into v_cached
    from public.crm_command_results
   where tenant_id = v_tenant and actor_user_id = v_actor and idempotency_key = _idempotency_key
   for update;
  if found then
    if not public.crm_command_hash_matches(v_cached.command_hash,v_hash,_command) then
      raise exception 'CRM_IDEMPOTENCY_REUSE' using errcode = '22023';
    end if;
    return v_cached.result || jsonb_build_object('replayed', true);
  end if;

  v_reported_action := case when v_action = 'deal.update' and _command->>'receipt_action' in ('deal.assign_owner','deal.assign_contact') then _command->>'receipt_action' else v_action end;

  if v_action not in (
    'contact.create','contact.update','contact.archive','contact.restore',
    'contact.link_company','contact.unlink_company',
    'company.create','company.update','company.archive','company.restore',
    'task.create','task.update','task.assign','task.reschedule','task.complete','task.reopen','task.cancel',
    'activity.log','deal.create','deal.update','deal.move','deal.close','deal.reopen'
  ) then
    raise exception 'CRM_ACTION_UNAVAILABLE' using errcode = '0A000';
  end if;
  if v_action in ('contact.create','contact.update') and v_patch ? 'tags'
    and not public.crm_tags_are_valid(v_patch->'tags') then
    raise exception 'CRM_TAGS_INVALID' using errcode='22023';
  end if;

  if v_action like 'deal.%' then
    if coalesce(_command->>'approval_channel','') not in ('operator_card','standing_autonomy_setting') then
      raise exception 'CRM_DEAL_AUTHORITY_REQUIRED' using errcode='42501';
    end if;
    if v_action = 'deal.move' then
      if coalesce(_command->>'deal_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or coalesce(_command->>'pipeline_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or coalesce(_command->>'target_stage_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(_command->'expected_version') is distinct from 'number'
        or jsonb_typeof(_command->'expected_target_version') is distinct from 'number' then
        raise exception 'CRM_DEAL_MOVE_INVALID' using errcode='22023';
      end if;
      v_pipeline_result := public.execute_pipeline_deal_move_as_paige(
        v_tenant,v_actor,
        jsonb_build_object('type','move-deal','dealId',_command->>'deal_id','pipelineId',_command->>'pipeline_id',
          'targetStageId',_command->>'target_stage_id','expectedVersion',(_command->>'expected_version')::bigint,
          'expectedTargetVersion',(_command->>'expected_target_version')::bigint,'reason',nullif(btrim(_command->>'reason'),'')),
        _idempotency_key,_command->>'approval_channel'
      );
    else
      v_old_sub:=current_setting('request.jwt.claim.sub',true);
      v_old_approval_channel:=current_setting('app.crm_approval_channel',true);
      begin
        perform set_config('request.jwt.claim.sub',v_actor::text,true);
        perform set_config('app.crm_approval_channel',_command->>'approval_channel',true);
        if v_action='deal.create' then
          v_pipeline_result:=public.configure_tenant_pipeline_core_identity(v_tenant,jsonb_strip_nulls(jsonb_build_object(
            'type','create-deal','title',_command->>'title','pipelineId',_command->>'pipeline_id','stageId',_command->>'stage_id',
            'clientId',_command->>'contact_id','ownerUserId',_command->>'owner_user_id','valueCents',_command->'value_cents',
            'currency',_command->>'currency','expectedCloseDate',_command->>'expected_close_date','offerType',_command->>'offer_type',
            'tags',coalesce(_command->'tags','[]'::jsonb),'notes',_command->>'notes'
          )),_idempotency_key,'paige');
        elsif v_action='deal.update' then
          if (_command ? 'owner_user_id' and coalesce(_command->>'receipt_action','')<>'deal.assign_owner')
            or (_command ? 'contact_id' and coalesce(_command->>'receipt_action','')<>'deal.assign_contact') then
            raise exception 'CRM_DEAL_ASSIGNMENT_ACTION_REQUIRED' using errcode='42501';
          end if;
          if not (_command ? 'title' or _command ? 'value_cents' or _command ? 'currency'
            or _command ? 'expected_close_date' or _command ? 'offer_type' or _command ? 'tags' or _command ? 'notes'
            or (_command ? 'owner_user_id' and _command->>'receipt_action'='deal.assign_owner')
            or (_command ? 'contact_id' and _command->>'receipt_action'='deal.assign_contact')) then
            raise exception 'CRM_DEAL_PATCH_REQUIRED' using errcode='22023';
          end if;
          v_pipeline_result:=public.configure_tenant_pipeline_core_identity(v_tenant,
            jsonb_strip_nulls(jsonb_build_object(
              'type','update-deal','dealId',_command->>'deal_id','expectedVersion',_command->'expected_version',
              'title',_command->>'title','valueCents',_command->'value_cents','currency',_command->>'currency',
              'expectedCloseDate',_command->>'expected_close_date','offerType',_command->>'offer_type',
              'tags',_command->'tags','notes',_command->>'notes'
            ))
            || case when _command ? 'contact_id' then jsonb_build_object('clientId',_command->'contact_id') else '{}'::jsonb end
            || case when _command ? 'owner_user_id' then jsonb_build_object('ownerUserId',_command->'owner_user_id') else '{}'::jsonb end,
            _idempotency_key,'paige');
        elsif v_action='deal.close' then
          v_pipeline_result:=public.configure_tenant_pipeline_core_identity(v_tenant,jsonb_strip_nulls(jsonb_build_object(
            'type','record-outcome','dealId',_command->>'deal_id','expectedVersion',_command->'expected_version',
            'outcomeType',_command->>'outcome_type','reason',_command->>'reason','notes',_command->>'notes',
            'outcomeDate',_command->>'outcome_date','targetStageId',_command->>'target_stage_id'
          )),_idempotency_key,'paige');
        else
          v_pipeline_result:=public.configure_tenant_pipeline_core_identity(v_tenant,jsonb_build_object(
            'type','reopen-deal','dealId',_command->>'deal_id','expectedVersion',_command->'expected_version',
            'targetStageId',_command->>'target_stage_id'
          ),_idempotency_key,'paige');
        end if;
        perform set_config('app.crm_approval_channel',coalesce(v_old_approval_channel,''),true);
        perform set_config('request.jwt.claim.sub',coalesce(v_old_sub,''),true);
      exception when others then
        perform set_config('app.crm_approval_channel',coalesce(v_old_approval_channel,''),true);
        perform set_config('request.jwt.claim.sub',coalesce(v_old_sub,''),true);
        raise;
      end;
    end if;
    if coalesce((v_pipeline_result->>'ok')::boolean,false) is not true then
      raise exception 'CRM_DEAL_NOT_EXECUTED:%',coalesce(v_pipeline_result->>'outcome','unknown') using errcode='P0001';
    end if;
    select * into v_deal from public.deals d where d.id=(v_pipeline_result->>'deal_id')::uuid and d.tenant_id=v_tenant;
    if not found then raise exception 'CRM_READBACK_FAILED' using errcode='P0002'; end if;
    v_readback:=jsonb_build_object(
      'id',v_deal.id,'title',v_deal.title,'pipeline_id',v_deal.pipeline_id,'stage_id',v_deal.stage_id,
      'contact_id',v_deal.contact_client_id,'owner_user_id',v_deal.owner_user_id,'status',v_deal.status,
      'value_cents',v_deal.value_cents,'currency',v_deal.currency,'expected_close_date',v_deal.expected_close_date,
      'actual_close_date',v_deal.actual_close_date,'lost_reason',v_deal.lost_reason,'offer_type',v_deal.offer_type,
      'tags',v_deal.tags,'notes',v_deal.notes,'version',v_deal.version,'updated_at',v_deal.updated_at
    );
    v_capability:=case v_reported_action when 'deal.create' then 'deal_create' when 'deal.update' then 'crm_update_deal' when 'deal.assign_owner' then 'crm_assign_deal_owner' when 'deal.assign_contact' then 'crm_assign_deal_contact' when 'deal.close' then 'crm_close_deal' when 'deal.reopen' then 'crm_reopen_deal' else 'deal_move_stage' end;

  elsif v_action = 'contact.create' then
    if jsonb_typeof(v_patch) <> 'object' then
      raise exception 'CRM_PATCH_INVALID' using errcode = '22023';
    end if;
    select array_agg(k order by k) into v_unknown
      from jsonb_object_keys(v_patch) k
     where k not in ('first_name','last_name','contact_methods','entity_name','entity_type','title','lifecycle_stage','source','tags','primary_offer','notes','do_not_contact','website','linkedin_url','street_address','city','state','zip_code','funding_goal','monthly_revenue');
    if coalesce(array_length(v_unknown, 1), 0) > 0 then
      raise exception 'CRM_PATCH_FIELDS_INVALID:%', array_to_string(v_unknown, ',') using errcode = '22023';
    end if;

    -- The whole address list is checked before anything is written.
    if v_patch ? 'contact_methods' then
      perform public.contact_methods_canonical(v_patch->'contact_methods');
    end if;
    if nullif(btrim(v_patch->>'first_name'),'') is null or nullif(btrim(v_patch->>'last_name'),'') is null then raise exception 'CRM_CONTACT_NAME_INCOMPLETE' using errcode='22023'; end if;
    select * into v_created from public.create_contact_v2(
      p_first_name := v_patch->>'first_name',
      p_last_name := v_patch->>'last_name',
      p_email := public.contact_methods_primary(v_patch->'contact_methods', 'email'),
      p_phone := public.contact_methods_primary(v_patch->'contact_methods', 'phone'),
      p_entity_name := v_patch->>'entity_name',
      p_title := v_patch->>'title',
      p_lifecycle_stage := coalesce(nullif(v_patch->>'lifecycle_stage',''), 'new_lead'),
      p_source := coalesce(nullif(v_patch->>'source',''), 'paige'),
      p_tags := case when jsonb_typeof(v_patch->'tags') = 'array'
                     then array(select jsonb_array_elements_text(v_patch->'tags')) else '{}'::text[] end,
      p_primary_offer := v_patch->>'primary_offer',
      p_notes := v_patch->>'notes',
      p_assigned_coach_user_id := case when v_is_coach and not v_is_admin then v_actor else null end,
      p_tenant_id := v_tenant,
      p_created_by := v_actor,
      p_channel := 'api'
    );
    if not coalesce(v_created.was_created, false) then
      raise exception 'CRM_CONTACT_ALREADY_EXISTS:%', v_created.contact_id using errcode = 'P0001';
    end if;
    select * into v_contact from public.clients c where c.id = v_created.contact_id and c.tenant_id = v_tenant;
    if not found then raise exception 'CRM_READBACK_FAILED' using errcode = 'P0002'; end if;
    if v_patch ? 'contact_methods' then
      perform public._replace_client_contact_methods(v_tenant, v_contact.id, v_patch->'contact_methods');
    end if;
    update public.clients c set
      entity_type = case when v_patch ? 'entity_type' then nullif(btrim(v_patch->>'entity_type'),'') else c.entity_type end,
      do_not_contact = case when v_patch ? 'do_not_contact' then (v_patch->>'do_not_contact')::boolean else c.do_not_contact end,
      website = case when v_patch ? 'website' then nullif(btrim(v_patch->>'website'),'') else c.website end,
      linkedin_url = case when v_patch ? 'linkedin_url' then nullif(btrim(v_patch->>'linkedin_url'),'') else c.linkedin_url end,
      street_address = case when v_patch ? 'street_address' then nullif(btrim(v_patch->>'street_address'),'') else c.street_address end,
      city = case when v_patch ? 'city' then nullif(btrim(v_patch->>'city'),'') else c.city end,
      state = case when v_patch ? 'state' then nullif(btrim(v_patch->>'state'),'') else c.state end,
      zip_code = case when v_patch ? 'zip_code' then nullif(btrim(v_patch->>'zip_code'),'') else c.zip_code end,
      funding_goal = case when v_patch ? 'funding_goal' then (v_patch->>'funding_goal')::numeric else c.funding_goal end,
      monthly_revenue = case when v_patch ? 'monthly_revenue' then (v_patch->>'monthly_revenue')::numeric else c.monthly_revenue end,
      updated_at = clock_timestamp()
    where c.id = v_contact.id returning * into v_contact;
    v_capability := 'crm_create_contact';

  elsif v_action like 'contact.%' then
    if coalesce(_command->>'contact_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'CRM_CONTACT_NOT_FOUND' using errcode = 'P0002';
    end if;
    select * into v_contact from public.clients c
     where c.id = (_command->>'contact_id')::uuid and c.tenant_id = v_tenant
     for update;
    if not found then
      raise exception 'CRM_CONTACT_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_can_touch_contact := public.crm_actor_can_access_record(v_tenant,v_actor,'contact',v_contact.id);
    if not v_can_touch_contact then
      raise exception 'CRM_FORBIDDEN' using errcode = '42501';
    end if;
    if coalesce(_command->>'expected_updated_at','') = '' then
      raise exception 'CRM_EXPECTED_VERSION_REQUIRED' using errcode = '22023';
    end if;
    begin v_expected := (_command->>'expected_updated_at')::timestamptz;
    exception when others then raise exception 'CRM_EXPECTED_VERSION_INVALID' using errcode = '22023'; end;
    if v_contact.updated_at is distinct from v_expected then
      raise exception 'CRM_VERSION_CONFLICT' using errcode = '40001';
    end if;

    if v_action = 'contact.update' then
      if jsonb_typeof(v_patch) <> 'object' or v_patch = '{}'::jsonb then
        raise exception 'CRM_PATCH_INVALID' using errcode = '22023';
      end if;
      select array_agg(k order by k) into v_unknown
        from jsonb_object_keys(v_patch) k
       where k not in ('first_name','last_name','contact_methods','add_contact_methods','entity_name','entity_type','title','lifecycle_stage','source','tags','primary_offer','current_notes','do_not_contact','website','linkedin_url','street_address','city','state','zip_code','funding_goal','monthly_revenue');
      if coalesce(array_length(v_unknown, 1), 0) > 0 then
        raise exception 'CRM_PATCH_FIELDS_INVALID:%', array_to_string(v_unknown, ',') using errcode = '22023';
      end if;
      if v_patch ? 'lifecycle_stage' and coalesce(v_patch->>'lifecycle_stage','') not in (
        'new_lead','qualified','nurturing','hot_lead','negotiating','won','client_active','client_paused','client_churned','client_funded','client_alumni'
      ) then raise exception 'CRM_LIFECYCLE_INVALID' using errcode = '22023'; end if;
      -- Addresses first, so the contact's version below is the last write in this command.
      if v_patch ? 'contact_methods' and v_patch ? 'add_contact_methods' then
        raise exception 'CRM_PATCH_INVALID' using errcode = '22023';
      end if;
      if v_patch ? 'contact_methods' then
        perform public._replace_client_contact_methods(v_tenant, v_contact.id, v_patch->'contact_methods');
      elsif v_patch ? 'add_contact_methods' then
        perform public._add_client_contact_methods(v_tenant, v_contact.id, v_patch->'add_contact_methods');
      end if;
      update public.clients c set
        first_name = case when v_patch ? 'first_name' then coalesce(nullif(btrim(v_patch->>'first_name'),''), c.first_name) else c.first_name end,
        last_name = case when v_patch ? 'last_name' then coalesce(nullif(btrim(v_patch->>'last_name'),''), c.last_name) else c.last_name end,
        entity_name = case when v_patch ? 'entity_name' then nullif(btrim(v_patch->>'entity_name'),'') else c.entity_name end,
        entity_type = case when v_patch ? 'entity_type' then nullif(btrim(v_patch->>'entity_type'),'') else c.entity_type end,
        title = case when v_patch ? 'title' then nullif(btrim(v_patch->>'title'),'') else c.title end,
        lifecycle_stage = case when v_patch ? 'lifecycle_stage' then v_patch->>'lifecycle_stage' else c.lifecycle_stage end,
        source = case when v_patch ? 'source' then nullif(btrim(v_patch->>'source'),'') else c.source end,
        tags = case when v_patch ? 'tags' and jsonb_typeof(v_patch->'tags') = 'array' then array(select jsonb_array_elements_text(v_patch->'tags')) else c.tags end,
        primary_offer = case when v_patch ? 'primary_offer' then nullif(btrim(v_patch->>'primary_offer'),'') else c.primary_offer end,
        current_notes = case when v_patch ? 'current_notes' then nullif(v_patch->>'current_notes','') else c.current_notes end,
        do_not_contact = case when v_patch ? 'do_not_contact' then (v_patch->>'do_not_contact')::boolean else c.do_not_contact end,
        website = case when v_patch ? 'website' then nullif(btrim(v_patch->>'website'),'') else c.website end,
        linkedin_url = case when v_patch ? 'linkedin_url' then nullif(btrim(v_patch->>'linkedin_url'),'') else c.linkedin_url end,
        street_address = case when v_patch ? 'street_address' then nullif(btrim(v_patch->>'street_address'),'') else c.street_address end,
        city = case when v_patch ? 'city' then nullif(btrim(v_patch->>'city'),'') else c.city end,
        state = case when v_patch ? 'state' then nullif(btrim(v_patch->>'state'),'') else c.state end,
        zip_code = case when v_patch ? 'zip_code' then nullif(btrim(v_patch->>'zip_code'),'') else c.zip_code end,
        funding_goal = case when v_patch ? 'funding_goal' then (v_patch->>'funding_goal')::numeric else c.funding_goal end,
        monthly_revenue = case when v_patch ? 'monthly_revenue' then (v_patch->>'monthly_revenue')::numeric else c.monthly_revenue end,
        updated_at = clock_timestamp()
      where c.id = v_contact.id
      returning * into v_contact;
    elsif v_action = 'contact.archive' then
      update public.clients c set status = 'archived', updated_at = clock_timestamp()
       where c.id = v_contact.id returning * into v_contact;
    elsif v_action = 'contact.restore' then
      if v_contact.merged_into_contact_id is not null then
        raise exception 'CRM_CONTACT_MERGED' using errcode = '42501';
      end if;
      update public.clients c set status = 'active', updated_at = clock_timestamp()
       where c.id = v_contact.id returning * into v_contact;
    elsif v_action in ('contact.link_company','contact.unlink_company') then
      if v_action = 'contact.link_company' then
        if coalesce(_command->>'company_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'CRM_BUSINESS_NOT_FOUND' using errcode = 'P0002';
        end if;
        select * into v_business from public.businesses b
         where b.id = (_command->>'company_id')::uuid and b.tenant_id = v_tenant and b.is_active is true
         for update;
        if not found then raise exception 'CRM_BUSINESS_NOT_FOUND' using errcode = 'P0002'; end if;
        if not public.crm_actor_can_access_record(v_tenant,v_actor,'company',v_business.id) then raise exception 'CRM_FORBIDDEN' using errcode='42501'; end if;
      end if;
      update public.clients c
         set primary_business_id = case when v_action = 'contact.link_company' then v_business.id else null end,
             updated_at = clock_timestamp()
       where c.id = v_contact.id returning * into v_contact;
    end if;
    v_capability := case v_action when 'contact.update' then 'crm_update_contact' when 'contact.archive' then 'crm_archive_contact' when 'contact.restore' then 'crm_restore_contact' when 'contact.link_company' then 'crm_link_contact_company' else 'crm_unlink_contact_company' end;

  elsif v_action = 'task.create' then
    if jsonb_typeof(v_patch) <> 'object' or coalesce(btrim(v_patch->>'title'),'') = '' then
      raise exception 'CRM_PATCH_INVALID' using errcode = '22023';
    end if;
    select array_agg(k order by k) into v_unknown from jsonb_object_keys(v_patch) k
     where k not in ('title','description','assignee_user_id','contact_id','company_id','deal_id','due_date','track','metadata');
    if v_patch ? 'metadata' and pg_catalog.jsonb_typeof(v_patch->'metadata') is distinct from 'object' then raise exception 'CRM_TASK_METADATA_INVALID' using errcode='22023'; end if;
    if coalesce(array_length(v_unknown, 1), 0) > 0 then
      raise exception 'CRM_PATCH_FIELDS_INVALID:%', array_to_string(v_unknown, ',') using errcode = '22023';
    end if;
    if v_patch ? 'contact_id' then
      -- The canonical tasks table has no contact relationship. Never accept and silently discard
      -- one; callers may use the supported company/deal links until that domain seam exists.
      raise exception 'CRM_TASK_CONTACT_LINK_UNAVAILABLE' using errcode = '0A000';
    end if;
    -- A contact link is not task-assignment consent. Default to the requesting operator, never
    -- silently to a portal identity; an explicit assignee is still tenant-authorized below.
    if coalesce(v_patch->>'assignee_user_id','') = '' then
      v_patch := v_patch || jsonb_build_object('assignee_user_id',v_actor);
    end if;
    perform 1 from public.tenant_members tm
     where tm.tenant_id=v_tenant and tm.user_id=(v_patch->>'assignee_user_id')::uuid and tm.status='active' for update;
    if not found then
      perform 1 from public.clients c where c.tenant_id=v_tenant and c.linked_user_id=(v_patch->>'assignee_user_id')::uuid
        and (v_is_admin or c.assigned_coach_user_id=v_actor) for update;
      if not found then raise exception 'CRM_ASSIGNEE_FORBIDDEN' using errcode = '42501'; end if;
    end if;
    if v_patch ? 'company_id' then
      select * into v_business from public.businesses b where b.id=(v_patch->>'company_id')::uuid and b.tenant_id=v_tenant for update;
      if not found then raise exception 'CRM_BUSINESS_NOT_FOUND' using errcode = 'P0002'; end if;
      if not public.crm_actor_can_access_record(v_tenant,v_actor,'company',v_business.id) then raise exception 'CRM_FORBIDDEN' using errcode='42501'; end if;
    end if;
    if v_patch ? 'deal_id' then
      select * into v_deal from public.deals d where d.id=(v_patch->>'deal_id')::uuid and d.tenant_id=v_tenant for update;
      if not found then raise exception 'CRM_DEAL_NOT_FOUND' using errcode = 'P0002'; end if;
      -- The canonical Pipeline core is tenant-admin only; task linkage must not create a
      -- side door into a deal merely because a caller knows its same-tenant identifier.
      if not v_is_admin then raise exception 'CRM_FORBIDDEN' using errcode='42501'; end if;
    end if;
    perform pg_catalog.set_config('app.suppress_task_assignment_notification','on',true);
    insert into public.tasks(tenant_id,user_id,title,description,biz_id,deal_id,due_date,track,status,metadata,updated_at)
    values(v_tenant,(v_patch->>'assignee_user_id')::uuid,btrim(v_patch->>'title'),nullif(btrim(v_patch->>'description'),''),
      nullif(v_patch->>'company_id','')::uuid,nullif(v_patch->>'deal_id','')::uuid,nullif(v_patch->>'due_date','')::timestamptz,
      nullif(btrim(v_patch->>'track'),''),'pending',case when jsonb_typeof(v_patch->'metadata')='object' then v_patch->'metadata' else null end,clock_timestamp())
    returning * into v_task;
    v_capability := 'crm_create_task';

  elsif v_action like 'task.%' then
    if coalesce(_command->>'task_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'CRM_TASK_NOT_FOUND' using errcode = 'P0002';
    end if;
    select * into v_task from public.tasks t where t.id=(_command->>'task_id')::uuid and t.tenant_id=v_tenant for update;
    if not found then raise exception 'CRM_TASK_NOT_FOUND' using errcode = 'P0002'; end if;
    if not public.crm_actor_can_access_record(v_tenant,v_actor,'task',v_task.id) then raise exception 'CRM_FORBIDDEN' using errcode = '42501'; end if;
    if coalesce(_command->>'expected_updated_at','') = '' then raise exception 'CRM_EXPECTED_VERSION_REQUIRED' using errcode = '22023'; end if;
    begin v_expected := (_command->>'expected_updated_at')::timestamptz;
    exception when others then raise exception 'CRM_EXPECTED_VERSION_INVALID' using errcode = '22023'; end;
    if coalesce(v_task.updated_at,v_task.created_at) is distinct from v_expected then raise exception 'CRM_VERSION_CONFLICT' using errcode = '40001'; end if;

    if v_action = 'task.update' then
      if jsonb_typeof(v_patch) <> 'object' or v_patch = '{}'::jsonb then raise exception 'CRM_PATCH_INVALID' using errcode = '22023'; end if;
      if v_patch ? 'metadata' and pg_catalog.jsonb_typeof(v_patch->'metadata') is distinct from 'object' then raise exception 'CRM_TASK_METADATA_INVALID' using errcode='22023'; end if;
      select array_agg(k order by k) into v_unknown from jsonb_object_keys(v_patch) k where k not in ('title','description','track','metadata','status');
      if coalesce(array_length(v_unknown,1),0)>0 then raise exception 'CRM_PATCH_FIELDS_INVALID:%',array_to_string(v_unknown,',') using errcode='22023'; end if;
      -- Starting work is the only added status patch. Terminal transitions keep
      -- their existing named commands, approval policy and canonical receipts.
      if v_patch ? 'status' and (jsonb_typeof(v_patch->'status') is distinct from 'string'
        or v_patch->>'status' is distinct from 'in_progress') then
        raise exception 'CRM_TASK_STATUS_INVALID' using errcode='22023';
      end if;
      if v_patch ? 'status' and coalesce(v_task.status::text,'') not in ('pending','in_progress') then
        raise exception 'CRM_TASK_STATUS_TRANSITION_INVALID' using errcode='22023';
      end if;
      if v_patch ? 'title' and coalesce(btrim(v_patch->>'title'),'')='' then raise exception 'CRM_TASK_TITLE_REQUIRED' using errcode='22023'; end if;
      update public.tasks t set
        title=case when v_patch ? 'title' then btrim(v_patch->>'title') else t.title end,
        description=case when v_patch ? 'description' then nullif(btrim(v_patch->>'description'),'') else t.description end,
        status=case when v_patch ? 'status' then 'in_progress' else t.status end,
        track=case when v_patch ? 'track' then nullif(btrim(v_patch->>'track'),'') else t.track end,
        metadata=case when v_patch ? 'metadata' and jsonb_typeof(v_patch->'metadata')='object' then v_patch->'metadata' else t.metadata end,
        updated_at=clock_timestamp() where t.id=v_task.id returning * into v_task;
      v_capability := case v_action when 'task.update' then 'crm_update_task' when 'task.reschedule' then 'crm_reschedule_task' when 'task.complete' then 'crm_complete_task' when 'task.reopen' then 'crm_reopen_task' else 'crm_update_task' end;
    elsif v_action = 'task.reschedule' then
      if not (v_patch ? 'due_date') then raise exception 'CRM_DUE_DATE_REQUIRED' using errcode='22023'; end if;
      update public.tasks t set due_date=nullif(v_patch->>'due_date','')::timestamptz,updated_at=clock_timestamp()
       where t.id=v_task.id returning * into v_task;
      v_capability := case v_action when 'task.update' then 'crm_update_task' when 'task.reschedule' then 'crm_reschedule_task' when 'task.complete' then 'crm_complete_task' when 'task.reopen' then 'crm_reopen_task' else 'crm_update_task' end;
    elsif v_action = 'task.complete' then
      update public.tasks t set status='completed',updated_at=clock_timestamp() where t.id=v_task.id returning * into v_task;
      v_capability := case v_action when 'task.update' then 'crm_update_task' when 'task.reschedule' then 'crm_reschedule_task' when 'task.complete' then 'crm_complete_task' when 'task.reopen' then 'crm_reopen_task' else 'crm_update_task' end;
    elsif v_action = 'task.reopen' then
      update public.tasks t set status='pending',updated_at=clock_timestamp() where t.id=v_task.id returning * into v_task;
      v_capability := 'crm_reopen_task';
    elsif v_action = 'task.cancel' then
      update public.tasks t set status='cancelled',updated_at=clock_timestamp() where t.id=v_task.id returning * into v_task;
      v_capability := 'crm_cancel_task';
    elsif v_action = 'task.assign' then
      if not v_is_admin then raise exception 'CRM_ASSIGNMENT_APPROVAL_REQUIRED' using errcode='42501'; end if;
      if coalesce(v_patch->>'assignee_user_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'CRM_ASSIGNEE_FORBIDDEN' using errcode='42501';
      end if;
      perform 1 from public.tenant_members tm
       where tm.tenant_id=v_tenant and tm.user_id=(v_patch->>'assignee_user_id')::uuid and tm.status='active' for update;
      if not found then
        perform 1 from public.clients c where c.tenant_id=v_tenant and c.linked_user_id=(v_patch->>'assignee_user_id')::uuid for update;
        if not found then raise exception 'CRM_ASSIGNEE_FORBIDDEN' using errcode='42501'; end if;
      end if;
      perform pg_catalog.set_config('app.suppress_task_assignment_notification','on',true);
      update public.tasks t set user_id=(v_patch->>'assignee_user_id')::uuid,updated_at=clock_timestamp()
       where t.id=v_task.id returning * into v_task;
      v_capability := 'crm_assign_task';
    end if;

  elsif v_action = 'activity.log' then
    if coalesce(_command->>'contact_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'CRM_CONTACT_NOT_FOUND' using errcode='P0002';
    end if;
    select * into v_contact from public.clients c where c.id=(_command->>'contact_id')::uuid and c.tenant_id=v_tenant for update;
    if not found then raise exception 'CRM_CONTACT_NOT_FOUND' using errcode='P0002'; end if;
    if not public.crm_actor_can_access_record(v_tenant,v_actor,'contact',v_contact.id) then raise exception 'CRM_FORBIDDEN' using errcode='42501'; end if;
    if coalesce(v_patch->>'channel','') not in ('call','email','sms','meeting','note') then raise exception 'CRM_ACTIVITY_CHANNEL_INVALID' using errcode='22023'; end if;
    if coalesce(btrim(v_patch->>'subject'),'')='' and coalesce(btrim(v_patch->>'body'),'')='' then raise exception 'CRM_ACTIVITY_CONTENT_REQUIRED' using errcode='22023'; end if;
    insert into public.client_notes(contact_id,tenant_id,author_user_id,body,tags)
    values(
      v_contact.id,v_tenant,v_actor,
      concat_ws(E'
',nullif(btrim(v_patch->>'subject'),''),nullif(btrim(v_patch->>'body'),'')),
      array['activity',v_patch->>'channel']
    ) returning * into v_note;
    update public.clients c
       set last_contacted_at=clock_timestamp(),updated_at=clock_timestamp()
     where c.id=v_contact.id returning * into v_contact;
    v_readback:=jsonb_build_object(
      'id',v_note.id,'contact_id',v_contact.id,'client_ref',v_contact.account_number,
      'channel',v_patch->>'channel','storage','client_notes','subject',nullif(btrim(v_patch->>'subject'),''),
      'body',v_note.body,'status','logged','external_effect',false,'created_at',v_note.created_at
    );
    v_capability := 'crm_log_activity';
  elsif v_action = 'company.create' then
    if coalesce(_command->>'contact_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'CRM_CONTACT_NOT_FOUND' using errcode = 'P0002';
    end if;
    select * into v_contact from public.clients c
     where c.id = (_command->>'contact_id')::uuid and c.tenant_id = v_tenant
     for update;
    if not found then raise exception 'CRM_CONTACT_NOT_FOUND' using errcode = 'P0002'; end if;
    if not public.crm_actor_can_access_record(v_tenant,v_actor,'contact',v_contact.id) then
      raise exception 'CRM_FORBIDDEN' using errcode = '42501';
    end if;
    if jsonb_typeof(v_patch) <> 'object' or coalesce(btrim(v_patch->>'legal_name'),'') = '' then
      raise exception 'CRM_PATCH_INVALID' using errcode = '22023';
    end if;
    select array_agg(k order by k) into v_unknown from jsonb_object_keys(v_patch) k
     where k not in ('legal_name','entity_type','dba','website','business_email','business_phone','naics','revenue_band','state_of_formation');
    if coalesce(array_length(v_unknown, 1), 0) > 0 then
      raise exception 'CRM_PATCH_FIELDS_INVALID:%', array_to_string(v_unknown, ',') using errcode = '22023';
    end if;
    v_company_owner:=v_contact.linked_user_id;
    if v_company_owner is null then
      select t.owner_user_id into v_company_owner from public.tenants t where t.id=v_tenant
        and exists(select 1 from public.tenant_members tm where tm.tenant_id=t.id and tm.user_id=t.owner_user_id and tm.status='active' and tm.role='owner');
      if v_company_owner is null then raise exception 'CRM_COMPANY_OWNER_SETUP_REQUIRED' using errcode='42501'; end if;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('business-primary:'||v_tenant::text||':'||v_company_owner::text,0));
    insert into public.businesses(
      tenant_id, owner_user_id, legal_name, entity_type, dba, website, business_email, business_phone,
      naics, revenue_band, state_of_formation, is_active, is_primary, updated_at
    ) values (
      v_tenant, v_company_owner, btrim(v_patch->>'legal_name'), nullif(v_patch->>'entity_type','')::public.entity_type, nullif(btrim(v_patch->>'dba'),''),
      nullif(btrim(v_patch->>'website'),''), nullif(btrim(v_patch->>'business_email'),''),
      nullif(btrim(v_patch->>'business_phone'),''), nullif(btrim(v_patch->>'naics'),''),
      nullif(btrim(v_patch->>'revenue_band'),''), nullif(btrim(v_patch->>'state_of_formation'),''),
      true, not exists(select 1 from public.businesses b where b.tenant_id = v_tenant and b.owner_user_id = v_company_owner and b.is_primary), clock_timestamp()
    ) returning * into v_business;
    if v_contact.primary_business_id is null then
      update public.clients set primary_business_id = v_business.id, updated_at = clock_timestamp()
       where id = v_contact.id returning * into v_contact;
    end if;
    v_capability := 'crm_create_company';

  elsif v_action like 'company.%' then
    if coalesce(_command->>'company_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'CRM_BUSINESS_NOT_FOUND' using errcode = 'P0002';
    end if;
    select * into v_business from public.businesses b
     where b.id = (_command->>'company_id')::uuid and b.tenant_id = v_tenant
     for update;
    if not found then raise exception 'CRM_BUSINESS_NOT_FOUND' using errcode = 'P0002'; end if;
    if not public.crm_actor_can_access_record(v_tenant,v_actor,'company',v_business.id) then raise exception 'CRM_FORBIDDEN' using errcode = '42501'; end if;
    if coalesce(_command->>'expected_updated_at','') = '' then
      raise exception 'CRM_EXPECTED_VERSION_REQUIRED' using errcode = '22023';
    end if;
    begin v_expected := (_command->>'expected_updated_at')::timestamptz;
    exception when others then raise exception 'CRM_EXPECTED_VERSION_INVALID' using errcode = '22023'; end;
    if coalesce(v_business.updated_at, v_business.created_at) is distinct from v_expected then
      raise exception 'CRM_VERSION_CONFLICT' using errcode = '40001';
    end if;
    if v_action = 'company.update' then
      if jsonb_typeof(v_patch) <> 'object' or v_patch = '{}'::jsonb then
        raise exception 'CRM_PATCH_INVALID' using errcode = '22023';
      end if;
      select array_agg(k order by k) into v_unknown from jsonb_object_keys(v_patch) k
       where k not in ('legal_name','entity_type','dba','website','business_email','business_phone','naics','revenue_band','state_of_formation');
      if coalesce(array_length(v_unknown, 1), 0) > 0 then
        raise exception 'CRM_PATCH_FIELDS_INVALID:%', array_to_string(v_unknown, ',') using errcode = '22023';
      end if;
      update public.businesses b set
        legal_name = case when v_patch ? 'legal_name' then coalesce(nullif(btrim(v_patch->>'legal_name'),''), b.legal_name) else b.legal_name end,
        entity_type = case when v_patch ? 'entity_type' then nullif(v_patch->>'entity_type','')::public.entity_type else b.entity_type end,
        dba = case when v_patch ? 'dba' then nullif(btrim(v_patch->>'dba'),'') else b.dba end,
        website = case when v_patch ? 'website' then nullif(btrim(v_patch->>'website'),'') else b.website end,
        business_email = case when v_patch ? 'business_email' then nullif(btrim(v_patch->>'business_email'),'') else b.business_email end,
        business_phone = case when v_patch ? 'business_phone' then nullif(btrim(v_patch->>'business_phone'),'') else b.business_phone end,
        naics = case when v_patch ? 'naics' then nullif(btrim(v_patch->>'naics'),'') else b.naics end,
        revenue_band = case when v_patch ? 'revenue_band' then nullif(btrim(v_patch->>'revenue_band'),'') else b.revenue_band end,
        state_of_formation = case when v_patch ? 'state_of_formation' then nullif(btrim(v_patch->>'state_of_formation'),'') else b.state_of_formation end,
        updated_at = clock_timestamp()
      where b.id = v_business.id returning * into v_business;
    elsif v_action = 'company.archive' then
      if not v_is_admin then raise exception 'CRM_FORBIDDEN' using errcode = '42501'; end if;
      -- Archiving changes company availability only. Relationship and primary-state changes remain
      -- explicit link/unlink operations so restore can be genuinely reversible.
      update public.businesses b set is_active = false, updated_at = clock_timestamp()
       where b.id = v_business.id returning * into v_business;
    elsif v_action = 'company.restore' then
      if not v_is_admin then raise exception 'CRM_FORBIDDEN' using errcode = '42501'; end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('business-primary:'||v_tenant::text||':'||v_business.owner_user_id::text,0));
      -- Restoring an archived primary after another active primary appeared must not create two.
      -- Keep the already-active primary stable and truthfully restore this row as secondary; changing
      -- the other company would be an unapproved collateral mutation.
      update public.businesses b set
        is_active = true,
        is_primary = case when b.is_primary and exists(
          select 1 from public.businesses sibling
           where sibling.tenant_id=v_tenant and sibling.owner_user_id=b.owner_user_id
             and sibling.id<>b.id and sibling.is_active and sibling.is_primary
        ) then false else b.is_primary end,
        updated_at = clock_timestamp()
       where b.id = v_business.id returning * into v_business;
    end if;
    v_capability := case v_action when 'company.update' then 'crm_update_company' when 'company.archive' then 'crm_archive_company' else 'crm_restore_company' end;
  end if;

  if v_action like 'deal.%' then
    null; -- readback came from the canonical Pipeline executor above.
  elsif v_action like 'contact.%' then
    select jsonb_build_object(
      'id',c.id,'client_ref',c.account_number,'first_name',c.first_name,'last_name',c.last_name,
      'contact_methods',public._client_contact_methods_json(c.id),'entity_name',c.entity_name,'entity_type',c.entity_type,'title',c.title,
      'lifecycle_stage',c.lifecycle_stage,'status',c.status,'tags',c.tags,
      'primary_business_id',c.primary_business_id,'do_not_contact',c.do_not_contact,'website',c.website,'linkedin_url',c.linkedin_url,
      'street_address',c.street_address,'city',c.city,'state',c.state,'zip_code',c.zip_code,
      'funding_goal',c.funding_goal,'monthly_revenue',c.monthly_revenue,'updated_at',c.updated_at
    ) into v_readback from public.clients c where c.id = v_contact.id and c.tenant_id = v_tenant;
  elsif v_action like 'company.%' then
    select jsonb_build_object(
      'id',b.id,'legal_name',b.legal_name,'entity_type',b.entity_type,'dba',b.dba,'website',b.website,
      'business_email',b.business_email,'business_phone',b.business_phone,'naics',b.naics,
      'revenue_band',b.revenue_band,'state_of_formation',b.state_of_formation,
      'is_active',b.is_active,'is_primary',b.is_primary,'updated_at',b.updated_at
    ) into v_readback from public.businesses b where b.id = v_business.id and b.tenant_id = v_tenant;
  elsif v_action like 'task.%' then
    select jsonb_build_object(
      'id',t.id,'title',t.title,'description',t.description,'status',t.status,'assignee_user_id',t.user_id,
      'company_id',t.biz_id,'deal_id',t.deal_id,'due_date',t.due_date,'track',t.track,
      'metadata',t.metadata,'external_effect',false,'notification_sent',false,'updated_at',t.updated_at
    ) into v_readback from public.tasks t where t.id=v_task.id and t.tenant_id=v_tenant;
  end if;
  if v_readback is null then
    raise exception 'CRM_READBACK_FAILED' using errcode = 'P0002';
  end if;

  v_run_id := (
    substr(md5(v_tenant::text || ':' || v_actor::text || ':' || _idempotency_key),1,8) || '-' ||
    substr(md5(v_tenant::text || ':' || v_actor::text || ':' || _idempotency_key),9,4) || '-' ||
    substr(md5(v_tenant::text || ':' || v_actor::text || ':' || _idempotency_key),13,4) || '-' ||
    substr(md5(v_tenant::text || ':' || v_actor::text || ':' || _idempotency_key),17,4) || '-' ||
    substr(md5(v_tenant::text || ':' || v_actor::text || ':' || _idempotency_key),21,12)
  )::uuid;

  -- Receipt failure aborts the transaction. This command never reports an unrecorded success.
  perform public.record_capability_run(
    v_tenant, v_actor, v_capability, 'capability_succeeded', v_run_id,
    null, null, null, null,
    jsonb_build_object(
      'action',v_reported_action,
      'record_kind',case when v_reported_action like 'contact.%' then 'contact' when v_reported_action like 'company.%' then 'company' when v_reported_action like 'task.%' then 'task' when v_reported_action like 'deal.%' then 'deal' else 'activity' end,
      'record_id',v_readback->>'id',
      'client_ref',v_readback->>'client_ref',
      'idempotency_key',_idempotency_key
    )
  );

  v_result := jsonb_build_object(
    'ok',true,
    'action',v_reported_action,
    'outcome','succeeded',
    'readback',v_readback,
    'receipt_recorded',true,
    'correlation_id',v_run_id,
    'replayed',false
  );

  insert into public.crm_command_results(tenant_id,idempotency_key,command_hash,actor_user_id,action,result)
  values(v_tenant,_idempotency_key,v_hash,v_actor,v_reported_action,v_result);

  return v_result;
end
$function$;

commit;
