begin;

-- Existing current-tenant Admin authority, for reminder time edits only.
-- Keep the five registered Planning bindings, all signatures and legacy paths.
do $reminder_admin$
declare
  spec record;
  installed record;
  metadata jsonb;
  restored text;
begin
  for spec in select * from (values
    ('public.plan_update_item(uuid,text,text,text,timestamptz,timestamptz,text,uuid,uuid)',
     array['9e57d9e3360bb896b70e8ac2506357ae','b60b4d6dc5f81c9b8b2ba956c77e6329'],
     array['search_path=public'],true,
     $old$_staff := public.has_any_role(_caller, ARRAY['admin','super_admin']);$old$,
     $new$-- reminder_tenant_admin_v1: no other field or item gains authority.
    _staff := public.has_any_role(_caller, ARRAY['admin','super_admin']) OR coalesce((
      _row.item_type='reminder' AND _row.status NOT IN ('done','cancelled')
      AND _row.tenant_id=public.current_user_tenant_id()
      AND (p_tenant_id IS NULL OR p_tenant_id=_row.tenant_id)
      AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=_row.tenant_id
        AND t.account_type::text='standalone' AND t.parent_tenant_id IS NULL)
      AND NOT public.is_company_workspace(_row.tenant_id)
      AND public.is_tenant_member(_row.tenant_id)
      AND coalesce(public.is_tenant_admin(_row.tenant_id),false)
      AND p_remind_at IS NOT NULL AND isfinite(p_remind_at) AND p_remind_at>clock_timestamp()
      AND p_title IS NULL AND p_summary IS NULL AND p_status IS NULL
      AND p_due_at IS NULL AND p_priority IS NULL AND p_assigned_to_user_id IS NULL
    ),false);$new$),
    ('public.plan_reschedule_reminder_versioned(uuid,uuid,uuid,timestamptz,timestamptz)',
     array['a0195455b58bf014fcb5ee1bf8347944'],array['search_path=""'],false,
     $old$IF NOT FOUND OR NOT coalesce(public.is_tenant_admin(v_tenant) OR v_row.created_by=v_actor,false)
    OR NOT coalesce(public.has_any_role(v_actor,ARRAY['admin','super_admin']) OR v_row.created_by=v_actor,false) THEN$old$,
     $new$-- reminder_tenant_admin_v1: retain current tenant Admin/creator gate.
  IF NOT FOUND OR NOT coalesce(public.is_tenant_admin(v_tenant) OR v_row.created_by=v_actor,false) THEN$new$)
  ) as s(signature,known_sources,settings,service_execute,old_text,new_text)
  loop
    select p.*,pg_get_functiondef(p.oid) as definition into strict installed
      from pg_proc p where p.oid=spec.signature::regprocedure;
    if installed.proowner<> 'postgres'::regrole or not installed.prosecdef
       or installed.proconfig is distinct from spec.settings
       or not has_function_privilege('authenticated',installed.oid,'EXECUTE')
       or has_function_privilege('anon',installed.oid,'EXECUTE')
       or has_function_privilege('service_role',installed.oid,'EXECUTE') is distinct from spec.service_execute then
      raise exception 'PLANNING_SOURCE_CHANGED: reminder authority metadata changed';
    end if;
    metadata := (to_jsonb(installed)-'prosrc'-'proargdefaults'-'definition')
      || jsonb_build_object('proargdefaults',pg_get_expr(installed.proargdefaults,0));
    if position('reminder_tenant_admin_v1' in installed.prosrc)>0 then
      restored := replace(installed.prosrc,spec.new_text,spec.old_text);
      if (length(installed.prosrc)-length(replace(installed.prosrc,spec.new_text,'')))/length(spec.new_text)<>1
         or not (md5(restored)=any(spec.known_sources)) then
        raise exception 'PLANNING_SOURCE_CHANGED: incomplete reminder Admin repair';
      end if;
      continue;
    end if;
    if not (md5(installed.prosrc)=any(spec.known_sources))
       or (length(installed.prosrc)-length(replace(installed.prosrc,spec.old_text,'')))/length(spec.old_text)<>1 then
      raise exception 'PLANNING_SOURCE_CHANGED: reminder writer changed';
    end if;
    execute replace(installed.definition,spec.old_text,spec.new_text);
    if (select (to_jsonb(p)-'prosrc'-'proargdefaults')
          || jsonb_build_object('proargdefaults',pg_get_expr(proargdefaults,0)) from pg_proc p where p.oid=installed.oid)
          is distinct from metadata
       or (select md5(replace(prosrc,spec.new_text,spec.old_text)) from pg_proc where oid=installed.oid)
          is distinct from md5(installed.prosrc) then
      raise exception 'PLANNING_SOURCE_CHANGED: reminder identity or unrelated source changed';
    end if;
  end loop;
end $reminder_admin$;

commit;
