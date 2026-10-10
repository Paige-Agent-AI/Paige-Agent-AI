-- Extend the existing Operator lifecycle seam. No email-based authorization,
-- tenant conversion, membership mutation, provider action or hard deletion.
-- Ordered after production's recorded migration 20270602000201.
CREATE OR REPLACE FUNCTION public.operator_read_account_details(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tenants;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'platform owner only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.tenants WHERE id = _tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('id',t.id,'name',t.name,'status',t.status,
    'account_type',t.account_type,'parent_tenant_id',t.parent_tenant_id,
    'version',md5(to_jsonb(t)::text));
END $$;

CREATE OR REPLACE FUNCTION public.operator_edit_account_details(
  _tenant_id uuid, _name text, _status text, _expected_version text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tenants; before_value jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'platform owner only' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) NOT BETWEEN 1 AND 200 OR _status IS NULL
    OR _status NOT IN ('trial','active','past_due','suspended','canceled') THEN
    RAISE EXCEPTION 'valid account name and status required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.tenants WHERE id = _tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'P0002'; END IF;
  IF _expected_version IS NULL OR md5(to_jsonb(t)::text) <> _expected_version THEN
    RAISE EXCEPTION 'account changed; reload before editing' USING ERRCODE = '40001';
  END IF;
  -- The existing internal classification is server-owned, never inferred from a name.
  IF EXISTS (SELECT 1 FROM public.tenant_revenue_classification WHERE tenant_id=t.id AND revenue_class='internal_test') THEN
    RAISE EXCEPTION 'internal account edits require the existing administrative procedure' USING ERRCODE = '42501';
  END IF;
  before_value := jsonb_build_object('name',t.name,'status',t.status);
  UPDATE public.tenants SET name=btrim(_name) WHERE id=t.id;
  -- Reuse canonical lifecycle transition and its transactional audit.
  IF t.status::text <> _status THEN
    PERFORM public.operator_set_tenant_status(t.id,_status,'Fleet account details');
  END IF;
  INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data)
    VALUES(auth.uid(),'tenant.details_edit','tenant',t.id,
      jsonb_build_object('before',before_value,'after',jsonb_build_object('name',btrim(_name),'status',_status)));
  RETURN public.operator_read_account_details(t.id);
END $$;

CREATE OR REPLACE FUNCTION public.operator_preview_account_deletion(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tenants; scope_ids uuid[]; account_rows jsonb; blockers jsonb := '[]'::jsonb; r record; n bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'platform owner only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.tenants WHERE id=_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'P0002'; END IF;
  WITH RECURSIVE tree AS (
    SELECT id,name,account_type FROM public.tenants WHERE id=_tenant_id
    UNION
    SELECT child.id,child.name,child.account_type FROM public.tenants child JOIN tree ON child.parent_tenant_id=tree.id
  ) SELECT array_agg(id),jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',account_type) ORDER BY name,id)
    INTO scope_ids,account_rows FROM tree;
  IF EXISTS(SELECT 1 FROM public.tenants WHERE id=ANY(scope_ids) AND account_type::text NOT IN ('agency','sub_account'))
    OR EXISTS(SELECT 1 FROM public.tenant_revenue_classification WHERE tenant_id=ANY(scope_ids) AND revenue_class='internal_test') THEN
    blockers := blockers || jsonb_build_array('Solo and internal accounts are protected from Agency cleanup.');
  END IF;
  -- Counts only, never connector credentials, messages, customer data or Auth records.
  FOR r IN SELECT c.table_schema,c.table_name,c.column_name FROM information_schema.columns c
    JOIN information_schema.tables b ON b.table_schema=c.table_schema AND b.table_name=c.table_name
    WHERE c.table_schema='public' AND b.table_type='BASE TABLE' AND c.udt_name='uuid'
      AND (c.column_name='tenant_id' OR c.column_name LIKE '%\_tenant\_id' ESCAPE '\')
      AND c.table_name <> 'tenants'
    ORDER BY c.table_name,c.column_name
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = ANY($1)',r.table_schema,r.table_name,r.column_name)
      INTO n USING scope_ids;
    IF n > 0 THEN blockers := blockers || jsonb_build_array(format('%s.%s: %s linked records require supported cleanup.',r.table_name,r.column_name,n)); END IF;
  END LOOP;
  IF t.stripe_customer_id IS NOT NULL OR t.stripe_subscription_id IS NOT NULL THEN
    blockers := blockers || jsonb_build_array('Billing references require the existing provider lifecycle procedure.');
  END IF;
  blockers := blockers || jsonb_build_array('Verified recovery and canonical whole-workspace deletion are not installed. No deletion can execute from this preview.');
  RETURN jsonb_build_object('tenant_id',t.id,'accounts',account_rows,'blockers',blockers,'execution_available',false);
END $$;

REVOKE ALL ON FUNCTION public.operator_read_account_details(uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.operator_edit_account_details(uuid,text,text,text) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.operator_preview_account_deletion(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operator_read_account_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_edit_account_details(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_preview_account_deletion(uuid) TO authenticated;
