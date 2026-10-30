-- Rollback-only catalog/literal-contract proof on the existing rebuilt schema.
-- No Auth/business fixtures, arming, trigger, Task, approval or provider effect.
-- This does not replace authenticated positive or original engine/Rail proof.
begin;
do $proof$
declare chain jsonb; invalid jsonb; n integer; role_name text; signature text;
begin
  foreach n in array array[1,2,20] loop
    select jsonb_agg(jsonb_build_object('id',('e0500000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
      'position',i,'action_kind','owner.task','tool_key',null,
      'config',jsonb_build_object('title','Review internal responsibility '||i)) order by i)
      into chain from generate_series(1,n) i;
    if public._owner_task_literal_chain_supported(chain) is distinct from true then
      raise exception 'FAIL: supported literal chain length %',n;
    end if;
  end loop;
  -- Last valid chain has twenty steps. A twenty-first is not silently truncated.
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    null,'{}'::jsonb,'[]'::jsonb,
    chain||jsonb_build_array((chain->0)||jsonb_build_object(
      'id','e0500000-0000-4000-8000-000000000021','position',21)),
    jsonb_build_array(chain->0,chain->0),
    jsonb_build_array(jsonb_set(chain->0,'{position}','2')),
    jsonb_build_array(jsonb_set(chain->0,'{action_kind}','"provider.send"')),
    jsonb_build_array(jsonb_set(chain->0,'{tool_key}','"raw.tool"')),
    jsonb_build_array(jsonb_set(chain->0,'{config,title}','"{{contact.name}}"')),
    jsonb_build_array(jsonb_set(chain->0,'{config,title}','""')),
    jsonb_build_array(jsonb_set(chain->0,'{config,title}','17')),
    jsonb_build_array(jsonb_set(chain->0,'{config,description}','null')),
    jsonb_build_array(jsonb_set(chain->0,'{config,to}','"outside@example.invalid"')),
    jsonb_build_array((chain->0)||'{"auto_approve":true}'::jsonb),
    jsonb_build_array(jsonb_set(chain->0,'{config,title}',to_jsonb(repeat('x',501)))),
    jsonb_build_array(jsonb_set(chain->0,'{config,description}',to_jsonb(repeat('x',10001))))
  )) loop
    if public._owner_task_literal_chain_supported(invalid) is distinct from false then
      raise exception 'FAIL: unsupported chain accepted';
    end if;
  end loop;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach signature in array array['_owner_task_literal_chain_supported(jsonb)',
      '_owner_task_source_snapshot(uuid,uuid)','paige_owner_task_hold_context()',
      '_read_owner_task_act(uuid,uuid,text)'] loop
      if has_function_privilege(role_name,'public.'||signature,'EXECUTE') then
        raise exception 'FAIL: private contract callable by %',role_name;
      end if;
    end loop;
  end loop;
  signature:='public.control_owner_task_automation(uuid,text,timestamptz,jsonb,jsonb)';
  if not has_function_privilege('authenticated',signature,'EXECUTE')
    or has_function_privilege('anon',signature,'EXECUTE')
    or has_function_privilege('service_role',signature,'EXECUTE') then
    raise exception 'FAIL: original human control ACL changed';
  end if;
  raise notice 'PASS: literal bounds, unsupported arguments and original public/private ACLs';
end $proof$;
rollback;
