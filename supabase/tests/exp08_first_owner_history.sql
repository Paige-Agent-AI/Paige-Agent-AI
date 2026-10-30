-- Minimal-schema engineering proof only. Original runner encloses the entire component in a
-- transaction and rolls back before its existing lifecycle proof. No production/SDK/RLS claim.
ALTER TABLE public.tenants ADD COLUMN created_at timestamptz NOT NULL DEFAULT '2020-01-01Z';
ALTER TABLE public.paige_audit_log ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
INSERT INTO public.tenants(id,account_type,owner_user_id) VALUES
 ('e8000000-0000-4000-8000-000000070001','standalone',NULL),
 ('e8000000-0000-4000-8000-000000070002','standalone',NULL),
 ('e8000000-0000-4000-8000-000000070003','standalone',NULL),
 ('e8000000-0000-4000-8000-000000070004','standalone','e8000000-0000-4000-8000-000000070100'),
 ('e8000000-0000-4000-8000-000000070005','sub_account',NULL),
 ('e8000000-0000-4000-8000-000000070006','standalone',NULL),
 ('e8000000-0000-4000-8000-000000070007','standalone',NULL);
INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role,status) VALUES
 ('e8000000-0000-4000-8000-000000071006','e8000000-0000-4000-8000-000000070006',
  'e8000000-0000-4000-8000-000000070100',true,'admin','suspended'),
 ('e8000000-0000-4000-8000-000000071007','e8000000-0000-4000-8000-000000070007',
  'e8000000-0000-4000-8000-000000070100',false,'owner','suspended');
INSERT INTO public.paige_audit_log(action,tenant_id,created_at) VALUES
 ('tenant:grant_co_owner','e8000000-0000-4000-8000-000000070002','2022-01-01Z'),
 ('tenant:revoke_co_owner','e8000000-0000-4000-8000-000000070002','2023-01-01Z'),
 ('tenant:deleted_injected_owner','e8000000-0000-4000-8000-000000070003','2019-01-01Z'),
 ('tenant:grant_co_owner','e8000000-0000-4000-8000-000000070004','2022-01-01Z');
CREATE FUNCTION proof.owner_history_cases() RETURNS TABLE(case_name text,passed boolean)
LANGUAGE plpgsql AS $$
DECLARE t uuid:='e8000000-0000-4000-8000-000000070001'; stamp timestamptz;
BEGIN
 RETURN QUERY SELECT 'fresh workspace',public._tenant_never_owned(t);
 RETURN QUERY SELECT 'missing workspace refused',NOT public._tenant_never_owned('e8000000-0000-4000-8000-000000079999');
 RETURN QUERY SELECT 'earliest accepted audit',first_owner_seated_at='2022-01-01Z'::timestamptz FROM public.tenants WHERE id='e8000000-0000-4000-8000-000000070002';
 RETURN QUERY SELECT 'injected parent excluded',public._tenant_never_owned('e8000000-0000-4000-8000-000000070003');
 RETURN QUERY SELECT 'pointer creation fallback precedes later audit',first_owner_seated_at='2020-01-01Z'::timestamptz FROM public.tenants WHERE id='e8000000-0000-4000-8000-000000070004';
 RETURN QUERY SELECT 'existing suspended boolean owner backfilled',first_owner_seated_at='2020-01-01Z'::timestamptz FROM public.tenants WHERE id='e8000000-0000-4000-8000-000000070006';
 RETURN QUERY SELECT 'existing suspended role-only owner backfilled',first_owner_seated_at='2020-01-01Z'::timestamptz FROM public.tenants WHERE id='e8000000-0000-4000-8000-000000070007';
 INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role,status)
 VALUES ('e8000000-0000-4000-8000-000000071001',t,'e8000000-0000-4000-8000-000000070100',false,'owner','suspended');
 SELECT first_owner_seated_at INTO stamp FROM public.tenants WHERE id=t;
 RETURN QUERY SELECT 'suspended role-only owner remembered',stamp IS NOT NULL AND NOT public._tenant_never_owned(t);
 DELETE FROM public.tenant_members WHERE tenant_id=t;
 RETURN QUERY SELECT 'deleted last seat does not erase history',NOT public._tenant_never_owned(t);
 BEGIN
   UPDATE public.tenants SET first_owner_seated_at=NULL WHERE id=t;
   RETURN QUERY SELECT 'clear refused',false;
 EXCEPTION WHEN insufficient_privilege THEN RETURN QUERY SELECT 'clear refused',true; END;
 BEGIN
   UPDATE public.tenants SET first_owner_seated_at=stamp-interval '1 day' WHERE id=t;
   RETURN QUERY SELECT 'rewrite refused',false;
 EXCEPTION WHEN insufficient_privilege THEN RETURN QUERY SELECT 'rewrite refused',true; END;
 INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role)
 VALUES ('e8000000-0000-4000-8000-000000071001',t,'e8000000-0000-4000-8000-000000070100',true,'owner');
 RETURN QUERY SELECT 'later owner preserves first time',first_owner_seated_at=stamp FROM public.tenants WHERE id=t;
 RETURN QUERY SELECT 'other tenant remains never owned',public._tenant_never_owned('e8000000-0000-4000-8000-000000070005');
 UPDATE public.tenant_members SET tenant_id='e8000000-0000-4000-8000-000000070005' WHERE tenant_id=t;
 DELETE FROM public.tenant_members WHERE tenant_id='e8000000-0000-4000-8000-000000070005';
 RETURN QUERY SELECT 'moved owner remains historical after deletion',NOT public._tenant_never_owned('e8000000-0000-4000-8000-000000070005');
 RETURN QUERY SELECT 'helper private',NOT has_function_privilege('authenticated','public._tenant_never_owned(uuid)','EXECUTE')
   AND NOT has_function_privilege('anon','public._tenant_never_owned(uuid)','EXECUTE')
   AND NOT has_function_privilege('service_role','public._tenant_never_owned(uuid)','EXECUTE');
END $$;
