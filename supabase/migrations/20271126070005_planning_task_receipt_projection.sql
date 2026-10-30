begin;

-- Project the existing native commit receipt. No new writer, authority, claim,
-- retry policy or receipt store; all installed task preconditions stay exact.
do $task_receipt$
declare
  target regprocedure := 'public.plan_assign_task_scoped(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text,text,uuid)'::regprocedure;
  original_source text;
  original_definition text;
  before_metadata jsonb;
  old_return text := $old$return jsonb_build_object('ok', true, 'item_id', v_item_id,
    'tenant_id', v_tenant, 'actor_id', v_actor);$old$;
  new_return text := $new$-- operations_task_native_receipt_v1: original native audit/Rail identity only.
  return jsonb_build_object('ok', true, 'item_id', v_item_id,
    'tenant_id', v_tenant, 'actor_id', v_actor,
    'railRecorded', v_result->'railRecorded',
    'receipt_status', v_result->'receipt_status',
    'receipt_run_id', v_result->'receipt_run_id');$new$;
begin
  -- Compare resolved default expressions, not parser source-position offsets.
  select prosrc, pg_get_functiondef(oid), (to_jsonb(p)-'prosrc'-'proargdefaults')
      || jsonb_build_object('proargdefaults',pg_get_expr(proargdefaults,0))
    into strict original_source, original_definition, before_metadata
    from pg_proc p where oid=target;
  if position('operations_task_native_receipt_v1' in original_source)>0 then
    if (length(original_source)-length(replace(original_source,new_return,'')))/length(new_return)<>1
       or md5(replace(original_source,new_return,old_return))<>'6117c2fba66658677ead7a457d83479e' then
      raise exception 'PLANNING_SOURCE_CHANGED: incomplete task receipt projection';
    end if;
    return;
  end if;
  if md5(original_source)<>'6117c2fba66658677ead7a457d83479e'
     or (length(original_source)-length(replace(original_source,old_return,'')))/length(old_return)<>1 then
    raise exception 'PLANNING_SOURCE_CHANGED: scoped task writer changed';
  end if;
  execute replace(original_definition,old_return,new_return);
  if (select (to_jsonb(p)-'prosrc'-'proargdefaults')
        || jsonb_build_object('proargdefaults',pg_get_expr(proargdefaults,0)) from pg_proc p where oid=target) is distinct from before_metadata
     or (select md5(replace(prosrc,new_return,old_return)) from pg_proc where oid=target)
        <>'6117c2fba66658677ead7a457d83479e' then
    raise exception 'PLANNING_SOURCE_CHANGED: task identity, authority or metadata changed';
  end if;
end $task_receipt$;

commit;
