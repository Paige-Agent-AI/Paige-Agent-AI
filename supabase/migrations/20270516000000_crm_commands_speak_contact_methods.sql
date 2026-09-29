-- Paige's governed CRM commands speak contact methods (20270515000000).
--
--   contact.create   takes `contact_methods`, the contact's complete address list.
--   contact.update   takes `add_contact_methods` (appends; never removes an address) or
--                    `contact_methods` (the complete list; anything left out is removed). Never both.
--   readback         returns `contact_methods` instead of a single email and phone.
--   merge preview    compares the two contacts' PRIMARY addresses; `loser_email_cleared` is true
--                    whenever the losing contact held an email, because every address moves.
--   merge            decides the transfer from the primaries, and moves every address.
--   execute          a unique violation that is NOT a clash on the command's idempotency key (an
--                    address another contact already holds) is re-raised as itself. It used to be
--                    reported as CRM_IDEMPOTENCY_REUSE, which told the operator the wrong thing.
--
-- The single `email` / `phone` patch keys leave both allowlists, so the patch schema Paige is shown
-- (generated from these allowlists by scripts/ci/crm-patch-field-gen.mjs) offers only the new keys.
--
-- The three functions are restated WHOLE, not edited in place: the patch-field guard derives the
-- allowlists from migration text, and an in-place edit is invisible to it. Each body is the live
-- production definition, reproduced byte for byte before editing — md5(prosrc) of the reproduction
-- matched production for all three on 2026-09-28 — with only the lines named above changed.
-- `_add_client_contact_methods` and `_replace_client_contact_methods` are granted to service_role
-- explicitly (below), for the executor and for Paige's MCP contact tools.

-- migration-lint-ignore: pattern-2 -- the INSERT … SELECT statements here are inside the three
-- executor bodies restated verbatim from production; this migration adds none and changes none.

-- ─── Helpers ────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.client_primary_address(_client_id uuid, _kind text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.value FROM public.client_contact_methods AS m
   WHERE m.client_id = _client_id AND m.kind = _kind AND m.is_primary
   ORDER BY m.position LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.client_primary_address(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_primary_address(uuid, text) TO service_role;

-- The primary value of a kind in an address list, after the list's own rules are applied.
CREATE FUNCTION public.contact_methods_primary(_methods jsonb, _kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT e->>'value'
    FROM pg_catalog.jsonb_array_elements(
           CASE WHEN _methods IS NULL OR _methods = 'null'::jsonb THEN '[]'::jsonb
                ELSE public.contact_methods_canonical(_methods) END) AS e
   WHERE e->>'kind' = _kind AND (e->>'is_primary')::boolean
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.contact_methods_primary(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_methods_primary(jsonb, text) TO authenticated, service_role;

-- Adds addresses to a contact and keeps every one it already has. An address it already holds is
-- not duplicated; it only becomes primary when marked so. A new address becomes primary only when
-- marked, or when the contact had none of that kind. Internal: reached from the governed executor
-- after it has resolved and authorised the contact.
CREATE FUNCTION public._add_client_contact_methods(_tenant_id uuid, _client_id uuid, _methods jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _combined jsonb;
BEGIN
  -- Shape, format, duplicates and two-primaries are refused exactly as for a full list.
  PERFORM public.contact_methods_canonical(_methods);

  WITH cur AS (
         SELECT m.kind, m.value, m.label, m.is_primary, m.position, m.match_key, 0 AS src
           FROM public.client_contact_methods AS m WHERE m.client_id = _client_id),
       added AS (
         SELECT e->>'kind' AS kind, pg_catalog.btrim(e->>'value') AS value,
                NULLIF(pg_catalog.btrim(e->>'label'), '') AS label,
                COALESCE((e->>'is_primary')::boolean, false) AS is_primary, o::int AS position,
                public.contact_method_match_key(e->>'kind', e->>'value') AS match_key, 1 AS src
           FROM pg_catalog.jsonb_array_elements(_methods) WITH ORDINALITY AS t(e, o)),
       promoted AS (SELECT a.kind, a.match_key FROM added AS a WHERE a.is_primary),
       merged AS (
         SELECT cur.kind, cur.value, cur.label, cur.is_primary, cur.position, cur.match_key, cur.src FROM cur
         UNION ALL
         SELECT a.kind, a.value, a.label, a.is_primary, a.position, a.match_key, a.src FROM added AS a
          WHERE NOT EXISTS (SELECT 1 FROM cur WHERE cur.kind = a.kind AND cur.match_key = a.match_key))
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'kind', m.kind, 'value', m.value, 'label', m.label,
           'is_primary', CASE WHEN EXISTS (SELECT 1 FROM promoted AS p WHERE p.kind = m.kind)
                              THEN EXISTS (SELECT 1 FROM promoted AS p WHERE p.kind = m.kind AND p.match_key = m.match_key)
                              ELSE m.is_primary END)
           ORDER BY m.kind, m.src, m.position)
    INTO _combined
    FROM merged AS m;

  RETURN public._replace_client_contact_methods(_tenant_id, _client_id, COALESCE(_combined, '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public._add_client_contact_methods(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
-- The service-role writers (the CRM executor, and Paige's MCP contact tools, which resolve the
-- workspace on the server before calling) name these explicitly rather than lean on default
-- privileges.
GRANT EXECUTE ON FUNCTION public._add_client_contact_methods(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._replace_client_contact_methods(uuid, uuid, jsonb) TO service_role;

-- ─── The three commands, restated whole ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_crm_command(_tenant_id uuid, _actor_id uuid, _command jsonb, _idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a text:=nullif(pg_catalog.btrim(_command->>'action'),''); p public.crm_command_previews%rowtype;
  c public.clients%rowtype; loser public.clients%rowtype; t public.tasks%rowtype; d public.deals%rowtype;
  deps jsonb; now_snap jsonb; v_result jsonb; readback jsonb; run_id uuid; changed int; target_count int;
  resolutions jsonb; owner_id uuid; field text; choice text; v_capability text; v_prior_auto_stub text; v_transfer_email boolean; v_loser_email_cleared boolean; v_lead_owner_id uuid; v_lead_owner_transferred boolean;
  v_hash text; v_cached public.crm_command_results%rowtype; effective_command jsonb;
  v_active_tenant uuid; v_actor_role text; v_autonomy_mode text; v_approval_channel text:=nullif(_command->>'approval_channel','');
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' or auth.uid() is not null then raise exception 'CRM_INTERNAL_EXECUTOR_REQUIRED' using errcode='42501'; end if;
  if _tenant_id is null or _actor_id is null or a is null or coalesce(pg_catalog.btrim(_idempotency_key),'')='' or pg_catalog.length(_idempotency_key)>200 or pg_catalog.jsonb_typeof(_command)<>'object' then raise exception 'CRM_COMMAND_INVALID' using errcode='22023'; end if;
  perform 1 from public.tenants tenant_row where tenant_row.id=_tenant_id and tenant_row.status in ('trial','active','past_due') for update;
  if not found then raise exception 'CRM_TENANT_SUSPENDED' using errcode='42501'; end if;
  select profile_row.active_tenant_id into v_active_tenant from public.profiles profile_row where profile_row.user_id=_actor_id for update;
  if not found or v_active_tenant is distinct from _tenant_id then raise exception 'CRM_ACTIVE_ACCOUNT_CHANGED' using errcode='42501'; end if;
  select tm.role into v_actor_role from public.tenant_members tm
    where tm.tenant_id=_tenant_id and tm.user_id=_actor_id and tm.status='active' and tm.role in ('owner','admin') for update;
  if not found then raise exception 'CRM_FORBIDDEN' using errcode='42501'; end if;
  effective_command:=public.crm_effective_command(_command);
  v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(effective_command::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm-command:'||_tenant_id::text||':'||_actor_id::text||':'||_idempotency_key,0));
  select * into v_cached from public.crm_command_results r where r.tenant_id=_tenant_id and r.actor_user_id=_actor_id and r.idempotency_key=_idempotency_key for update;
  if found then
    if v_cached.command_hash<>v_hash then raise exception 'CRM_IDEMPOTENCY_REUSE' using errcode='22023'; end if;
    -- Reuse the one cached-result authorization path so service-side retries cannot bypass
    -- current record access after a coach reassignment.
    return public.read_crm_command_result(_tenant_id,_actor_id,_command,_idempotency_key);
  end if;
  v_capability:=case a
    when 'contact.create' then 'crm_create_contact' when 'contact.update' then 'crm_update_contact'
    when 'contact.archive' then 'crm_archive_contact' when 'contact.restore' then 'crm_restore_contact'
    when 'contact.link_company' then 'crm_link_contact_company' when 'contact.unlink_company' then 'crm_unlink_contact_company'
    when 'contact.assign_coach' then 'crm_assign_coach' when 'contact.assign_owner' then 'crm_assign_contact_owner'
    when 'contact.merge' then 'crm_merge_contacts' when 'contact.hard_delete' then 'crm_hard_delete_contact'
    when 'contact.bulk_update' then 'crm_bulk_update_contacts' when 'company.create' then 'crm_create_company'
    when 'company.update' then 'crm_update_company' when 'company.archive' then 'crm_archive_company'
    when 'company.restore' then 'crm_restore_company' when 'task.create' then 'crm_create_task'
    when 'task.update' then 'crm_update_task' when 'task.assign' then 'crm_assign_task'
    when 'task.reschedule' then 'crm_reschedule_task' when 'task.complete' then 'crm_complete_task'
    when 'task.reopen' then 'crm_reopen_task' when 'task.cancel' then 'crm_cancel_task'
    when 'task.delete' then 'crm_delete_task' when 'activity.log' then 'crm_log_activity'
    when 'deal.create' then 'deal_create' when 'deal.update' then 'crm_update_deal'
    when 'deal.assign_owner' then 'crm_assign_deal_owner' when 'deal.assign_contact' then 'crm_assign_deal_contact'
    when 'deal.move' then 'deal_move_stage' when 'deal.close' then 'crm_close_deal'
    when 'deal.reopen' then 'crm_reopen_deal' when 'deal.delete' then 'crm_delete_deal' else null end;
  if v_capability is null then raise exception 'CRM_ACTION_UNAVAILABLE' using errcode='0A000'; end if;
  if v_approval_channel is null or v_approval_channel not in ('operator_card','standing_autonomy_setting') then raise exception 'CRM_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tool-autonomy:'||_tenant_id::text||':'||v_capability,0));
  select ta.mode into v_autonomy_mode from public.tenant_tool_autonomy ta where ta.tenant_id=_tenant_id and ta.tool_key=v_capability;
  v_autonomy_mode:=coalesce(v_autonomy_mode,'confirm');
  if v_autonomy_mode='off' or (v_autonomy_mode='confirm' and v_approval_channel<>'operator_card') then raise exception 'CRM_AUTONOMY_REFUSED' using errcode='42501'; end if;
  if a in ('contact.assign_coach','contact.assign_owner','contact.merge','contact.hard_delete','contact.bulk_update','task.assign','task.cancel','task.delete','deal.assign_owner','deal.assign_contact','deal.close','deal.reopen','deal.delete')
    and v_approval_channel<>'operator_card' then raise exception 'CRM_APPROVAL_REQUIRED' using errcode='42501'; end if;
  if a in ('contact.create','contact.update','contact.archive','contact.restore','contact.link_company','contact.unlink_company','company.create','company.update','company.archive','company.restore','task.create','task.update','task.assign','task.reschedule','task.complete','task.reopen','task.cancel','activity.log','deal.create','deal.update','deal.move','deal.close','deal.reopen') then
    return public.execute_crm_command_reversible(_tenant_id,_actor_id,_command,_idempotency_key);
  end if;
  if not exists(select 1 from public.tenant_members tm where tm.tenant_id=_tenant_id and tm.user_id=_actor_id and tm.status='active' and tm.role in ('owner','admin')) then raise exception 'CRM_FORBIDDEN' using errcode='42501'; end if;

  if a in ('contact.assign_coach','contact.assign_owner') then
    select * into c from public.clients where id=(_command->>'contact_id')::uuid and tenant_id=_tenant_id for update;
    if not found then raise exception 'CRM_CONTACT_NOT_FOUND' using errcode='P0002'; end if;
    if c.updated_at is distinct from (_command->>'expected_updated_at')::timestamptz then raise exception 'CRM_VERSION_CONFLICT' using errcode='40001'; end if;
    owner_id:=nullif(_command->>'owner_user_id','')::uuid;
    if owner_id is not null then
      perform 1 from public.tenant_members tm where tm.tenant_id=_tenant_id and tm.user_id=owner_id and tm.status='active' and (a='contact.assign_owner' or tm.role in ('owner','admin')) for update;
      if not found then raise exception 'CRM_ASSIGNEE_FORBIDDEN' using errcode='42501'; end if;
    end if;
    if a='contact.assign_coach' then
      perform pg_catalog.set_config('app.suppress_contact_assignment_notification','on',true);
      update public.clients set assigned_coach_user_id=owner_id,updated_at=pg_catalog.clock_timestamp() where id=c.id returning * into c;
    else update public.clients set lead_owner_user_id=owner_id,updated_at=pg_catalog.clock_timestamp() where id=c.id returning * into c; end if;
    readback:=pg_catalog.jsonb_build_object('id',c.id,'client_ref',c.account_number,'assigned_coach_user_id',c.assigned_coach_user_id,'lead_owner_user_id',c.lead_owner_user_id,'updated_at',c.updated_at,'external_effect',false,'notification_sent',false);
  elsif a in ('deal.assign_owner','deal.assign_contact') then
    return public.execute_crm_command_reversible(_tenant_id,_actor_id,effective_command,_idempotency_key);
  else
    if coalesce(_command->>'preview_id','') !~* '^[0-9a-f-]{36}$' then raise exception 'CRM_PREVIEW_REQUIRED' using errcode='22023'; end if;
    select * into p from public.crm_command_previews where id=(_command->>'preview_id')::uuid and tenant_id=_tenant_id and actor_user_id=_actor_id and action=a and consumed_at is null and expires_at>pg_catalog.now() for update;
    if not found then raise exception 'CRM_PREVIEW_INVALID_OR_EXPIRED' using errcode='42501'; end if;
    update public.crm_command_previews set consumed_at=pg_catalog.clock_timestamp() where id=p.id;
    if a='task.delete' then
      select * into t from public.tasks where id=(p.target_snapshot->>'task_id')::uuid and tenant_id=_tenant_id for update;
      if not found or coalesce(t.updated_at,t.created_at) is distinct from (p.target_snapshot->>'updated_at')::timestamptz then raise exception 'CRM_VERSION_CONFLICT' using errcode='40001'; end if;
      delete from public.tasks where id=t.id and tenant_id=_tenant_id;
      if exists(select 1 from public.tasks where id=t.id) then raise exception 'CRM_ABSENCE_READBACK_FAILED' using errcode='P0002'; end if;
      readback:=pg_catalog.jsonb_build_object('id',t.id,'absent',true,'deleted_count',1);
    elsif a='deal.delete' then
      select * into d from public.deals where id=(p.target_snapshot->>'deal_id')::uuid and tenant_id=_tenant_id for update;
      if not found or d.version<>(p.target_snapshot->>'version')::bigint then raise exception 'CRM_VERSION_CONFLICT' using errcode='40001'; end if;
      if exists(select 1 from public.paige_invoices where deal_id=d.id and tenant_id is distinct from _tenant_id) then raise exception 'CRM_CROSS_TENANT_DEPENDENCY' using errcode='42501'; end if;
      perform 1 from public.tasks where deal_id=d.id and tenant_id=_tenant_id for update;
      perform 1 from public.paige_invoices where deal_id=d.id and tenant_id=_tenant_id for update;
      perform 1 from public.deal_activities where deal_id=d.id for update;
      perform 1 from public.stage_automation_events where deal_id=d.id and tenant_id=_tenant_id for update;
      perform 1 from public.pipeline_move_approvals where deal_id=d.id and tenant_id=_tenant_id for update;
      perform 1 from public.pipeline_deal_outcomes where deal_id=d.id and tenant_id=_tenant_id for update;
      deps:=pg_catalog.jsonb_build_object('tasks',(select count(*) from public.tasks where deal_id=d.id and tenant_id=_tenant_id),'invoices',(select count(*) from public.paige_invoices where deal_id=d.id and tenant_id=_tenant_id),'activities',(select count(*) from public.deal_activities where deal_id=d.id),'automation_events',(select count(*) from public.stage_automation_events where deal_id=d.id and tenant_id=_tenant_id),'move_approvals',(select count(*) from public.pipeline_move_approvals where deal_id=d.id and tenant_id=_tenant_id),'outcomes',(select count(*) from public.pipeline_deal_outcomes where deal_id=d.id and tenant_id=_tenant_id));
      now_snap:=public.crm_deal_dependency_snapshot(_tenant_id,d.id);
      if deps is distinct from p.target_snapshot->'dependency_counts' or now_snap is distinct from p.target_snapshot->'dependency_set' then raise exception 'CRM_DEPENDENCY_CONFLICT' using errcode='40001'; end if;
      update public.tasks set deal_id=null,updated_at=pg_catalog.clock_timestamp() where deal_id=d.id and tenant_id=_tenant_id;
      update public.paige_invoices set deal_id=null,updated_at=pg_catalog.clock_timestamp() where deal_id=d.id and tenant_id=_tenant_id;
      delete from public.deals where id=d.id and tenant_id=_tenant_id;
      if exists(select 1 from public.deals where id=d.id) then raise exception 'CRM_ABSENCE_READBACK_FAILED' using errcode='P0002'; end if;
      readback:=pg_catalog.jsonb_build_object('id',d.id,'absent',true,'deleted_count',1,'dependency_counts',deps);
    elsif a='contact.hard_delete' then
      select * into c from public.clients where id=(p.target_snapshot->>'contact_id')::uuid and tenant_id=_tenant_id for update;
      if not found or c.updated_at is distinct from (p.target_snapshot->>'updated_at')::timestamptz then raise exception 'CRM_VERSION_CONFLICT' using errcode='40001'; end if;
      deps:=public.crm_contact_dependency_snapshot(c.id);
      if c.linked_user_id is not null or deps is distinct from p.target_snapshot->'dependency_snapshot' or (deps->>'total')::bigint<>0 then raise exception 'CRM_HARD_DELETE_UNSAFE' using errcode='42501'; end if;
      delete from public.clients where id=c.id and tenant_id=_tenant_id;
      if exists(select 1 from public.clients where id=c.id) then raise exception 'CRM_ABSENCE_READBACK_FAILED' using errcode='P0002'; end if;
      readback:=pg_catalog.jsonb_build_object('id',c.id,'client_ref',c.account_number,'absent',true,'deleted_count',1,'dependency_counts',deps);
    elsif a='contact.merge' then
      select * into c from public.clients where id=(p.target_snapshot->>'survivor_contact_id')::uuid and tenant_id=_tenant_id for update;
      select * into loser from public.clients where id=(p.target_snapshot->>'loser_contact_id')::uuid and tenant_id=_tenant_id for update;
      if c.id is null or loser.id is null or c.updated_at is distinct from (p.target_snapshot->>'survivor_updated_at')::timestamptz or loser.updated_at is distinct from (p.target_snapshot->>'loser_updated_at')::timestamptz then raise exception 'CRM_VERSION_CONFLICT' using errcode='40001'; end if;
      if c.status is distinct from 'active' or loser.status is distinct from 'active' or c.merged_into_contact_id is not null or loser.merged_into_contact_id is not null then raise exception 'CRM_MERGE_TARGET_INACTIVE' using errcode='42501'; end if;
      perform 1 from public.deals dependency_deal where dependency_deal.contact_client_id=loser.id for update;
      perform 1 from public.client_notes dependency_note where dependency_note.contact_id=loser.id for update;
      deps:=public.crm_contact_dependency_snapshot(loser.id);
      if deps is distinct from p.target_snapshot->'dependency_snapshot' then raise exception 'CRM_DEPENDENCY_CONFLICT' using errcode='40001'; end if;
      if (deps->>'unsupported')::bigint<>0 then raise exception 'CRM_MERGE_DEPENDENCIES_UNSUPPORTED' using errcode='42501'; end if;
      if c.linked_user_id is not null and loser.linked_user_id is not null and c.linked_user_id<>loser.linked_user_id then raise exception 'CRM_MERGE_IDENTITY_CONFLICT' using errcode='42501'; end if;
      resolutions:=p.target_snapshot->'resolutions';
      v_transfer_email:=coalesce(resolutions->>'email'='loser',false) or (not (resolutions ? 'email') and public.client_primary_address(c.id,'email') is null);
      -- Every address leaves the losing contact (the survivor keeps them all; the resolution only
      -- picks which is primary), so "loser email cleared" is true exactly when the loser held one.
      -- Read before the addresses move, so the receipt matches the preview.
      v_loser_email_cleared:=public.client_primary_address(loser.id,'email') is not null;
      owner_id:=case when resolutions->>'assigned_coach_user_id'='loser' or (not (resolutions ? 'assigned_coach_user_id') and c.assigned_coach_user_id is null) then loser.assigned_coach_user_id else c.assigned_coach_user_id end;
      if owner_id is not null then
        perform 1 from public.tenant_members tm
         where tm.tenant_id=_tenant_id and tm.user_id=owner_id and tm.status='active'
           and tm.role in ('owner','admin') for update;
        if not found then raise exception 'CRM_ASSIGNEE_FORBIDDEN' using errcode='42501'; end if;
      end if;
      -- §9/§59 security: a merge must never assign a TRANSFERRED lead_owner_user_id that is not an active
      -- member of the contact's tenant. can_access_contact() gates financial RLS on this field, so an
      -- inherited stale/removed/cross-tenant owner would silently regain financial access. Reuse the coach
      -- guard's membership predicate (lock + require active same-tenant membership; else refuse the whole
      -- merge before any write -- fail-closed, atomic), scoped to the TRANSFERRED value per the invariant: a
      -- value RETAINED from the survivor grants no new access via the merge and is out of this fix's scope
      -- (the broader can_access_contact membership-staleness hardening is a separate follow-up). Roles are
      -- intentionally unrestricted -- lead owners are legitimately reps, not only coaches; active
      -- same-tenant membership is the invariant.
      v_lead_owner_transferred:=resolutions->>'lead_owner_user_id'='loser' or (not (resolutions ? 'lead_owner_user_id') and c.lead_owner_user_id is null);
      v_lead_owner_id:=case when v_lead_owner_transferred then loser.lead_owner_user_id else c.lead_owner_user_id end;
      if v_lead_owner_transferred and v_lead_owner_id is not null then
        perform 1 from public.tenant_members tm
         where tm.tenant_id=_tenant_id and tm.user_id=v_lead_owner_id and tm.status='active' for update;
        if not found then raise exception 'CRM_LEAD_OWNER_FORBIDDEN' using errcode='42501'; end if;
      end if;
      -- Release the losing row's unique portal identity before transferring it. The loaded row
      -- variable retains the exact preview-bound value used below; the whole transaction rolls back on failure.
      update public.clients set
        linked_user_id=null
       where id=loser.id;
      perform public._merge_client_contact_methods(_tenant_id, c.id, loser.id, v_transfer_email,
        coalesce(resolutions->>'phone'='loser', false) or (not (resolutions ? 'phone') and public.client_primary_address(c.id,'phone') is null));
      perform pg_catalog.set_config('app.suppress_contact_assignment_notification','on',true);
      v_prior_auto_stub:=pg_catalog.current_setting('app.suppress_contact_auto_stub',true);
      perform pg_catalog.set_config('app.suppress_contact_auto_stub','on',true);
      update public.clients set
        entity_name=case when resolutions->>'entity_name'='loser' or (not (resolutions ? 'entity_name') and c.entity_name is null) then loser.entity_name else c.entity_name end,
        title=case when resolutions->>'title'='loser' or (not (resolutions ? 'title') and c.title is null) then loser.title else c.title end,
        linked_user_id=case when resolutions->>'linked_user_id'='loser' or (not (resolutions ? 'linked_user_id') and c.linked_user_id is null) then loser.linked_user_id else c.linked_user_id end,
        primary_business_id=case when resolutions->>'primary_business_id'='loser' or (not (resolutions ? 'primary_business_id') and c.primary_business_id is null) then loser.primary_business_id else c.primary_business_id end,
        assigned_coach_user_id=owner_id,
        lead_owner_user_id=v_lead_owner_id,
        tags=coalesce((select pg_catalog.array_agg(distinct x order by x) from pg_catalog.unnest(coalesce(c.tags,array[]::text[])||coalesce(loser.tags,array[]::text[])) x),array[]::text[]),
        updated_at=pg_catalog.clock_timestamp() where id=c.id returning * into c;
      perform pg_catalog.set_config('app.suppress_contact_auto_stub',coalesce(v_prior_auto_stub,''),true);
      update public.deals set contact_client_id=c.id,updated_at=pg_catalog.clock_timestamp() where contact_client_id=loser.id;
      update public.client_notes set contact_id=c.id,updated_at=pg_catalog.clock_timestamp() where contact_id=loser.id;
      perform pg_catalog.set_config('app.crm_merge_lineage_write','on',true);
      update public.clients set status='archived',merged_into_contact_id=c.id,merged_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=loser.id returning * into loser;
      readback:=pg_catalog.jsonb_build_object('id',c.id,'client_ref',c.account_number,'merged_contact_id',loser.id,'loser_archived',loser.status='archived','loser_email_cleared',v_loser_email_cleared,'dependency_counts',deps,'updated_at',c.updated_at,'external_effect',false,'notification_sent',false);
    elsif a='contact.bulk_update' then
      if p.target_snapshot->'patch' ? 'assigned_coach_user_id' and nullif(p.target_snapshot->'patch'->>'assigned_coach_user_id','') is not null then
        perform 1 from public.tenant_members tm
         where tm.tenant_id=_tenant_id and tm.user_id=(p.target_snapshot->'patch'->>'assigned_coach_user_id')::uuid
           and tm.status='active' and tm.role in ('owner','admin') for update;
        if not found then raise exception 'CRM_ASSIGNEE_FORBIDDEN' using errcode='42501'; end if;
      end if;
      if p.target_snapshot->'patch' ? 'tags' and not public.crm_tags_are_valid(p.target_snapshot->'patch'->'tags') then
        raise exception 'CRM_TAGS_INVALID' using errcode='22023';
      end if;
      select count(*) into target_count from pg_catalog.jsonb_array_elements(p.target_snapshot->'targets');
      perform 1 from public.clients target_client
       join pg_catalog.jsonb_array_elements(p.target_snapshot->'targets') x on target_client.id=(x->>'id')::uuid
       where target_client.tenant_id=_tenant_id order by target_client.id for update of target_client;
      select count(*) into changed from pg_catalog.jsonb_array_elements(p.target_snapshot->'targets') x
       left join public.clients target_client on target_client.id=(x->>'id')::uuid and target_client.tenant_id=_tenant_id
       where target_client.id is null or target_client.updated_at is distinct from (x->>'updated_at')::timestamptz;
      if changed>0 then raise exception 'CRM_BULK_TARGET_VERSION_CONFLICT:%',changed using errcode='40001'; end if;
      if p.target_snapshot->'patch' ? 'assigned_coach_user_id' then
        perform pg_catalog.set_config('app.suppress_contact_assignment_notification','on',true);
      end if;
      update public.clients target_client set
        lifecycle_stage=case when p.target_snapshot->'patch' ? 'lifecycle_stage' then p.target_snapshot->'patch'->>'lifecycle_stage' else target_client.lifecycle_stage end,
        tags=case when p.target_snapshot->'patch' ? 'tags' then array(select pg_catalog.jsonb_array_elements_text(p.target_snapshot->'patch'->'tags')) else target_client.tags end,
        do_not_contact=case when p.target_snapshot->'patch' ? 'do_not_contact' then (p.target_snapshot->'patch'->>'do_not_contact')::boolean else target_client.do_not_contact end,
        assigned_coach_user_id=case when p.target_snapshot->'patch' ? 'assigned_coach_user_id' then nullif(p.target_snapshot->'patch'->>'assigned_coach_user_id','')::uuid else target_client.assigned_coach_user_id end,
        updated_at=pg_catalog.clock_timestamp()
      where target_client.tenant_id=_tenant_id and target_client.id in (select (x->>'id')::uuid from pg_catalog.jsonb_array_elements(p.target_snapshot->'targets') x);
      get diagnostics changed=row_count;
      select pg_catalog.jsonb_build_object('updated_count',changed,'changed_since_preview_count',0,'refused_count',(p.preview->>'refused_count')::int,'external_effect',false,'notification_sent',false,'records',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',target_client.id,'client_ref',target_client.account_number,'lifecycle_stage',target_client.lifecycle_stage,'tags',target_client.tags,'do_not_contact',target_client.do_not_contact,'assigned_coach_user_id',target_client.assigned_coach_user_id,'updated_at',target_client.updated_at) order by target_client.id),'[]'::jsonb)) into readback
       from public.clients target_client where target_client.tenant_id=_tenant_id and target_client.id in (select (x->>'id')::uuid from pg_catalog.jsonb_array_elements(p.target_snapshot->'targets') x);
    else raise exception 'CRM_ACTION_UNAVAILABLE' using errcode='0A000'; end if;
  end if;
  run_id:=(pg_catalog.substr(pg_catalog.md5(_tenant_id::text||':'||_actor_id::text||':'||_idempotency_key),1,8)||'-'||pg_catalog.substr(pg_catalog.md5(_tenant_id::text||':'||_actor_id::text||':'||_idempotency_key),9,4)||'-'||pg_catalog.substr(pg_catalog.md5(_tenant_id::text||':'||_actor_id::text||':'||_idempotency_key),13,4)||'-'||pg_catalog.substr(pg_catalog.md5(_tenant_id::text||':'||_actor_id::text||':'||_idempotency_key),17,4)||'-'||pg_catalog.substr(pg_catalog.md5(_tenant_id::text||':'||_actor_id::text||':'||_idempotency_key),21,12))::uuid;
  v_capability:=case a
    when 'contact.assign_coach' then 'crm_assign_coach' when 'contact.assign_owner' then 'crm_assign_contact_owner'
    when 'contact.merge' then 'crm_merge_contacts' when 'contact.hard_delete' then 'crm_hard_delete_contact'
    when 'contact.bulk_update' then 'crm_bulk_update_contacts' when 'task.delete' then 'crm_delete_task'
    when 'deal.assign_owner' then 'crm_assign_deal_owner' when 'deal.assign_contact' then 'crm_assign_deal_contact'
    when 'deal.delete' then 'crm_delete_deal' else null end;
  if v_capability is null then raise exception 'CRM_RECEIPT_CAPABILITY_MISSING' using errcode='XX000'; end if;
  perform public.record_capability_run(_tenant_id,_actor_id,v_capability,'capability_succeeded',run_id,null,null,null,null,
    pg_catalog.jsonb_build_object('action',a,'record_id',readback->>'id','idempotency_key',_idempotency_key,'preview_id',_command->>'preview_id'));
  v_result:=pg_catalog.jsonb_build_object('ok',true,'action',a,'outcome','succeeded','readback',readback,'receipt_recorded',true,'correlation_id',run_id,'replayed',false);
  update public.crm_command_previews cp set result=v_result where cp.id=p.id;
  insert into public.crm_command_results(tenant_id,idempotency_key,command_hash,actor_user_id,action,result)
  values(_tenant_id,_idempotency_key,v_hash,_actor_id,a,v_result);
  return v_result;
exception when unique_violation then
  -- Only a clash on THIS idempotency key is a concurrent retry. Any other unique violation raised
  -- while the command ran (an address already held by another contact in the workspace) is the
  -- command's own refusal and is re-raised as itself, never reported as a reused key.
  if not exists (select 1 from public.crm_command_results r where r.tenant_id=_tenant_id and r.actor_user_id=_actor_id and r.idempotency_key=_idempotency_key) then
    raise;
  end if;
  select r.result into v_result from public.crm_command_results r where r.tenant_id=_tenant_id and r.actor_user_id=_actor_id and r.idempotency_key=_idempotency_key and r.command_hash=v_hash;
  if v_result is null then raise exception 'CRM_IDEMPOTENCY_REUSE' using errcode='22023'; end if;
  return v_result||pg_catalog.jsonb_build_object('replayed',true);
end$function$;

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
  v_hash := encode(extensions.digest(convert_to(_command::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('crm-command:' || v_tenant::text || ':' || v_actor::text || ':' || _idempotency_key, 0));
  select * into v_cached
    from public.crm_command_results
   where tenant_id = v_tenant and actor_user_id = v_actor and idempotency_key = _idempotency_key
   for update;
  if found then
    if v_cached.command_hash <> v_hash then
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
      select array_agg(k order by k) into v_unknown from jsonb_object_keys(v_patch) k where k not in ('title','description','track','metadata');
      if coalesce(array_length(v_unknown,1),0)>0 then raise exception 'CRM_PATCH_FIELDS_INVALID:%',array_to_string(v_unknown,',') using errcode='22023'; end if;
      if v_patch ? 'title' and coalesce(btrim(v_patch->>'title'),'')='' then raise exception 'CRM_TASK_TITLE_REQUIRED' using errcode='22023'; end if;
      update public.tasks t set
        title=case when v_patch ? 'title' then btrim(v_patch->>'title') else t.title end,
        description=case when v_patch ? 'description' then nullif(btrim(v_patch->>'description'),'') else t.description end,
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

CREATE OR REPLACE FUNCTION public.preview_crm_command(_tenant_id uuid, _actor_id uuid, _command jsonb, _preview_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a text:=nullif(pg_catalog.btrim(_command->>'action'),''); h text;
  cached public.crm_command_previews%rowtype; c1 public.clients%rowtype; c2 public.clients%rowtype;
  t public.tasks%rowtype; d public.deals%rowtype; snap jsonb; outp jsonb; deps jsonb; dependency_set jsonb;
  ids uuid[]; requested int; eligible int; refused int; patch jsonb:=coalesce(_command->'patch','{}'::jsonb);
  unknown text[]; conflict_rows jsonb; unresolved int; active_tenant uuid; actor_role text; capability text; autonomy_mode text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' or auth.uid() is not null then raise exception 'CRM_INTERNAL_EXECUTOR_REQUIRED' using errcode='42501'; end if;
  if _tenant_id is null or _actor_id is null or coalesce(pg_catalog.btrim(_preview_key),'')='' or pg_catalog.length(_preview_key)>200
    or pg_catalog.jsonb_typeof(_command)<>'object' then raise exception 'CRM_PREVIEW_INVALID' using errcode='22023'; end if;
  perform 1 from public.tenants tenant_row where tenant_row.id=_tenant_id and tenant_row.status in ('trial','active','past_due') for update;
  if not found then raise exception 'CRM_TENANT_SUSPENDED' using errcode='42501'; end if;
  select profile_row.active_tenant_id into active_tenant from public.profiles profile_row where profile_row.user_id=_actor_id for update;
  if not found or active_tenant is distinct from _tenant_id then raise exception 'CRM_ACTIVE_ACCOUNT_CHANGED' using errcode='42501'; end if;
  select tm.role into actor_role from public.tenant_members tm
    where tm.tenant_id=_tenant_id and tm.user_id=_actor_id and tm.status='active' and tm.role in ('owner','admin') for update;
  if not found then raise exception 'CRM_FORBIDDEN' using errcode='42501'; end if;
  if a not in ('contact.merge','contact.hard_delete','task.delete','deal.delete','contact.bulk_update') then raise exception 'CRM_PREVIEW_UNAVAILABLE' using errcode='0A000'; end if;
  capability:=case a when 'contact.merge' then 'crm_merge_contacts' when 'contact.hard_delete' then 'crm_hard_delete_contact'
    when 'contact.bulk_update' then 'crm_bulk_update_contacts' when 'task.delete' then 'crm_delete_task' when 'deal.delete' then 'crm_delete_deal' end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tool-autonomy:'||_tenant_id::text||':'||capability,0));
  select ta.mode into autonomy_mode from public.tenant_tool_autonomy ta where ta.tenant_id=_tenant_id and ta.tool_key=capability;
  if coalesce(autonomy_mode,'confirm')='off' then raise exception 'CRM_AUTONOMY_REFUSED' using errcode='42501'; end if;
  h:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(_command::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm-preview:'||_tenant_id::text||':'||_actor_id::text||':'||_preview_key,0));
  select * into cached from public.crm_command_previews where tenant_id=_tenant_id and actor_user_id=_actor_id and preview_key=_preview_key for update;
  if found then
    if cached.command_hash<>h then raise exception 'CRM_PREVIEW_IDEMPOTENCY_REUSE' using errcode='22023'; end if;
    if cached.consumed_at is not null and cached.result is not null then
      return cached.result||pg_catalog.jsonb_build_object('replayed',true);
    end if;
    if cached.expires_at<=pg_catalog.now()+interval '1 minute' then
      -- The advisory lock makes replacement single-writer. An expired, unexecuted preview is not an
      -- approval and may be replaced under the same stable retry key after every target/version check
      -- below runs again. A cached result above remains immutable and replayable.
      delete from public.crm_command_previews where id=cached.id;
    elsif cached.consumed_at is not null then
      raise exception 'CRM_PREVIEW_EXPIRED' using errcode='22023';
    else
      return cached.preview||pg_catalog.jsonb_build_object('preview_id',cached.id,'replayed',true,'expires_at',cached.expires_at);
    end if;
  end if;

  if a in ('contact.merge','contact.hard_delete') then
    if coalesce(_command->>'contact_id','') !~* '^[0-9a-f-]{36}$' then raise exception 'CRM_CONTACT_NOT_FOUND' using errcode='P0002'; end if;
    select * into c1 from public.clients where id=(_command->>'contact_id')::uuid and tenant_id=_tenant_id for update;
    if not found then raise exception 'CRM_CONTACT_NOT_FOUND' using errcode='P0002'; end if;
    if coalesce(_command->>'expected_updated_at','')='' or c1.updated_at is distinct from (_command->>'expected_updated_at')::timestamptz
      then raise exception 'CRM_VERSION_CONFLICT' using errcode='40001'; end if;
    deps:=public.crm_contact_dependency_snapshot(c1.id);
    if a='contact.hard_delete' then
      snap:=pg_catalog.jsonb_build_object('contact_id',c1.id,'updated_at',c1.updated_at,'dependency_snapshot',deps,'linked_user_id',c1.linked_user_id);
      outp:=pg_catalog.jsonb_build_object('action',a,'record_kind','contact','record_id',c1.id,'client_ref',c1.account_number,
        'eligible',c1.linked_user_id is null and (deps->>'total')::bigint=0,'dependency_counts',deps,
        'safe_refusal',case when c1.linked_user_id is not null then 'linked portal identity must be unlinked through its owning flow' when (deps->>'total')::bigint>0 then 'archive this contact or remove dependencies through their owning flows' else null end);
    else
      if coalesce(_command->>'loser_contact_id','') !~* '^[0-9a-f-]{36}$' or (_command->>'loser_contact_id')::uuid=c1.id then raise exception 'CRM_MERGE_TARGET_INVALID' using errcode='22023'; end if;
      select * into c2 from public.clients where id=(_command->>'loser_contact_id')::uuid and tenant_id=_tenant_id for update;
      if not found then raise exception 'CRM_CONTACT_NOT_FOUND' using errcode='P0002'; end if;
      if coalesce(_command->>'expected_loser_updated_at','')='' or c2.updated_at is distinct from (_command->>'expected_loser_updated_at')::timestamptz
        then raise exception 'CRM_VERSION_CONFLICT' using errcode='40001'; end if;
      if c1.status is distinct from 'active' or c2.status is distinct from 'active' or c1.merged_into_contact_id is not null or c2.merged_into_contact_id is not null then
        raise exception 'CRM_MERGE_TARGET_INACTIVE' using errcode='42501';
      end if;
      if c1.linked_user_id is null and c2.linked_user_id is not null and not (coalesce(_command->'resolutions','{}'::jsonb) ? 'linked_user_id') then
        raise exception 'CRM_MERGE_IDENTITY_RESOLUTION_REQUIRED' using errcode='22023';
      end if;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('field',x.field,'survivor',x.sv,'loser',x.lv,'resolution',coalesce(_command->'resolutions'->>x.field,case when x.sv is null and x.lv is not null then 'loser' else 'survivor' end)) order by x.field),'[]'::jsonb)
        into conflict_rows
        from (values
          ('email',public.client_primary_address(c1.id,'email'),public.client_primary_address(c2.id,'email')),('phone',public.client_primary_address(c1.id,'phone'),public.client_primary_address(c2.id,'phone')),('entity_name',c1.entity_name,c2.entity_name),('title',c1.title,c2.title),
          ('linked_user_id',c1.linked_user_id::text,c2.linked_user_id::text),('primary_business_id',c1.primary_business_id::text,c2.primary_business_id::text),
          ('assigned_coach_user_id',c1.assigned_coach_user_id::text,c2.assigned_coach_user_id::text),('lead_owner_user_id',c1.lead_owner_user_id::text,c2.lead_owner_user_id::text)
        ) x(field,sv,lv) where x.sv is distinct from x.lv and (x.sv is not null or x.lv is not null);
      if pg_catalog.jsonb_typeof(coalesce(_command->'resolutions','{}'::jsonb))<>'object' then raise exception 'CRM_MERGE_RESOLUTIONS_INVALID' using errcode='22023'; end if;
      select count(*) into unresolved from pg_catalog.jsonb_each_text(coalesce(_command->'resolutions','{}'::jsonb)) r
       where r.value not in ('survivor','loser') or r.key not in ('email','phone','entity_name','title','linked_user_id','primary_business_id','assigned_coach_user_id','lead_owner_user_id');
      if unresolved>0 then raise exception 'CRM_MERGE_RESOLUTIONS_INVALID' using errcode='22023'; end if;
      deps:=public.crm_contact_dependency_snapshot(c2.id);
      snap:=pg_catalog.jsonb_build_object('survivor_contact_id',c1.id,'survivor_updated_at',c1.updated_at,'loser_contact_id',c2.id,'loser_updated_at',c2.updated_at,
        'dependency_snapshot',deps,'resolutions',coalesce(_command->'resolutions','{}'::jsonb));
      outp:=pg_catalog.jsonb_build_object('action',a,'record_kind','contact_merge','survivor',pg_catalog.jsonb_build_object('id',c1.id,'client_ref',c1.account_number),
        'loser',pg_catalog.jsonb_build_object('id',c2.id,'client_ref',c2.account_number),'conflicts',conflict_rows,
        'transfer_effects',pg_catalog.jsonb_build_object(
          'loser_email_cleared',public.client_primary_address(c2.id,'email') is not null,
          'addresses_moved',(select count(*) from public.client_contact_methods cm where cm.client_id=c2.id),
          'loser_portal_identity_released',c2.linked_user_id is not null
        ),'dependency_counts',deps,
        'eligible',(deps->>'unsupported')::bigint=0 and not (c1.linked_user_id is not null and c2.linked_user_id is not null and c1.linked_user_id<>c2.linked_user_id),
        'safe_refusal',case
          when (deps->>'unsupported')::bigint>0 then 'one or more dependencies belong to another domain and cannot be silently reassigned'
          when c1.linked_user_id is not null and c2.linked_user_id is not null and c1.linked_user_id<>c2.linked_user_id then 'two different portal identities cannot be merged into one contact'
          else null end);
    end if;
  elsif a='task.delete' then
    select * into t from public.tasks where id=(_command->>'task_id')::uuid and tenant_id=_tenant_id for update;
    if not found then raise exception 'CRM_TASK_NOT_FOUND' using errcode='P0002'; end if;
    if coalesce(t.updated_at,t.created_at) is distinct from (_command->>'expected_updated_at')::timestamptz then raise exception 'CRM_VERSION_CONFLICT' using errcode='40001'; end if;
    snap:=pg_catalog.jsonb_build_object('task_id',t.id,'updated_at',coalesce(t.updated_at,t.created_at));
    outp:=pg_catalog.jsonb_build_object('action',a,'record_kind','task','record_id',t.id,'title',t.title,'affected_count',1,'eligible',true);
  elsif a='deal.delete' then
    select * into d from public.deals where id=(_command->>'deal_id')::uuid and tenant_id=_tenant_id for update;
    if not found then raise exception 'CRM_DEAL_NOT_FOUND' using errcode='P0002'; end if;
    if d.version<>coalesce((_command->>'expected_version')::bigint,0) then raise exception 'CRM_VERSION_CONFLICT' using errcode='40001'; end if;
    if exists(select 1 from public.paige_invoices where deal_id=d.id and tenant_id is distinct from _tenant_id) then raise exception 'CRM_CROSS_TENANT_DEPENDENCY' using errcode='42501'; end if;
    perform 1 from public.tasks where deal_id=d.id and tenant_id=_tenant_id for update;
    perform 1 from public.paige_invoices where deal_id=d.id and tenant_id=_tenant_id for update;
    perform 1 from public.deal_activities where deal_id=d.id for update;
    perform 1 from public.stage_automation_events where deal_id=d.id and tenant_id=_tenant_id for update;
    perform 1 from public.pipeline_move_approvals where deal_id=d.id and tenant_id=_tenant_id for update;
    perform 1 from public.pipeline_deal_outcomes where deal_id=d.id and tenant_id=_tenant_id for update;
    deps:=pg_catalog.jsonb_build_object('tasks',(select count(*) from public.tasks where deal_id=d.id and tenant_id=_tenant_id),'invoices',(select count(*) from public.paige_invoices where deal_id=d.id and tenant_id=_tenant_id),'activities',(select count(*) from public.deal_activities where deal_id=d.id),'automation_events',(select count(*) from public.stage_automation_events where deal_id=d.id and tenant_id=_tenant_id),'move_approvals',(select count(*) from public.pipeline_move_approvals where deal_id=d.id and tenant_id=_tenant_id),'outcomes',(select count(*) from public.pipeline_deal_outcomes where deal_id=d.id and tenant_id=_tenant_id));
    dependency_set:=public.crm_deal_dependency_snapshot(_tenant_id,d.id);
    snap:=pg_catalog.jsonb_build_object('deal_id',d.id,'version',d.version,'dependency_counts',deps,'dependency_set',dependency_set);
    outp:=pg_catalog.jsonb_build_object('action',a,'record_kind','deal','record_id',d.id,'title',d.title,'dependency_counts',deps,'affected_count',1+(deps->>'tasks')::int+(deps->>'invoices')::int+(deps->>'activities')::int+(deps->>'automation_events')::int+(deps->>'move_approvals')::int+(deps->>'outcomes')::int,'deleted_dependency_count',(deps->>'activities')::int+(deps->>'automation_events')::int+(deps->>'move_approvals')::int+(deps->>'outcomes')::int,'detached_task_count',(deps->>'tasks')::int,'detached_invoice_count',(deps->>'invoices')::int,'eligible',true);
  else
    if pg_catalog.jsonb_typeof(_command->'target_ids')<>'array' or pg_catalog.jsonb_array_length(_command->'target_ids')=0 or pg_catalog.jsonb_array_length(_command->'target_ids')>200 then raise exception 'CRM_BULK_TARGETS_INVALID' using errcode='22023'; end if;
    select pg_catalog.array_agg(distinct x::uuid order by x::uuid) into ids from pg_catalog.jsonb_array_elements_text(_command->'target_ids') x where x ~* '^[0-9a-f-]{36}$';
    requested:=pg_catalog.jsonb_array_length(_command->'target_ids');
    select count(*) into eligible from public.clients where tenant_id=_tenant_id and id=any(coalesce(ids,array[]::uuid[]));
    refused:=requested-eligible;
    if pg_catalog.jsonb_typeof(patch)<>'object' or patch='{}'::jsonb then raise exception 'CRM_PATCH_INVALID' using errcode='22023'; end if;
    select pg_catalog.array_agg(k order by k) into unknown from pg_catalog.jsonb_object_keys(patch) k where k not in ('lifecycle_stage','tags','do_not_contact','assigned_coach_user_id');
    if coalesce(pg_catalog.array_length(unknown,1),0)>0 then raise exception 'CRM_PATCH_FIELDS_INVALID:%',pg_catalog.array_to_string(unknown,',') using errcode='22023'; end if;
    if patch ? 'lifecycle_stage' and coalesce(patch->>'lifecycle_stage','') not in ('new_lead','qualified','nurturing','hot_lead','negotiating','won','client_active','client_paused','client_churned','client_funded','client_alumni') then raise exception 'CRM_LIFECYCLE_INVALID' using errcode='22023'; end if;
    if patch ? 'tags' and not public.crm_tags_are_valid(patch->'tags') then raise exception 'CRM_TAGS_INVALID' using errcode='22023'; end if;
    if patch ? 'do_not_contact' and pg_catalog.jsonb_typeof(patch->'do_not_contact')<>'boolean' then raise exception 'CRM_DO_NOT_CONTACT_INVALID' using errcode='22023'; end if;
    if patch ? 'assigned_coach_user_id' and nullif(patch->>'assigned_coach_user_id','') is not null and (patch->>'assigned_coach_user_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists(select 1 from public.tenant_members tm where tm.tenant_id=_tenant_id and tm.user_id=(patch->>'assigned_coach_user_id')::uuid and tm.status='active' and tm.role in ('owner','admin'))) then raise exception 'CRM_ASSIGNEE_FORBIDDEN' using errcode='42501'; end if;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',c.id,'updated_at',c.updated_at) order by c.id),'[]'::jsonb) into snap from public.clients c where c.tenant_id=_tenant_id and c.id=any(coalesce(ids,array[]::uuid[]));
    snap:=pg_catalog.jsonb_build_object('targets',snap,'patch',patch);
    outp:=pg_catalog.jsonb_build_object('action',a,'record_kind','contact','requested_count',requested,'eligible_count',eligible,'refused_count',refused,'patch',patch,'eligible_targets',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',c.id,'client_ref',c.account_number,'updated_at',c.updated_at) order by c.id),'[]'::jsonb) from public.clients c where c.tenant_id=_tenant_id and c.id=any(coalesce(ids,array[]::uuid[]))),'eligible',eligible>0);
  end if;
  insert into public.crm_command_previews(tenant_id,actor_user_id,preview_key,command_hash,action,target_snapshot,preview)
  values(_tenant_id,_actor_id,_preview_key,h,a,snap,outp) returning * into cached;
  return outp||pg_catalog.jsonb_build_object('preview_id',cached.id,'replayed',false,'expires_at',cached.expires_at);
end$function$;
