-- EXP04 O11: one original invoice query, explicit native business date.
-- No API grants, financial writer, provider call, ledger or customer admission.
-- Native accepted-requester/current-relationship/publication remains a separate
-- original Portal consumer contract. A versioned read does not prove safe publication.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $e04_invoice_observation$
DECLARE core pg_proc%ROWTYPE; zone pg_proc%ROWTYPE; p pg_proc%ROWTYPE; spec record; step record;
 core_oid oid; zone_oid oid; core_metadata jsonb; zone_metadata jsonb;
 old_core text; old_zone text; new_core text; new_zone text; inverse text;
 legacy_body text:='
DECLARE facts jsonb;
BEGIN
 facts:=public._client_portal_invoice_facts_for_client(_tenant,_client,p_limit,p_after,(now() AT TIME ZONE ''UTC'')::date);
 RETURN (facts-''_native_sources'')||jsonb_build_object(''invoices'',coalesce(
  (SELECT jsonb_agg(value-''issued_snapshot_version'' ORDER BY ordinality)
   FROM jsonb_array_elements(facts->''invoices'') WITH ORDINALITY),''[]''::jsonb));
END;
'; zone_tail text:=' SELECT z.time_zone,z.set_at INTO zone,zone_set_at FROM public.tenant_business_time_zones z
 WHERE z.tenant_id=_expected_tenant_id;
 IF zone IS NULL THEN zone_state:=''missing'';
 ELSE
  -- Same degrade as the client status read: an unrecognised stored zone is ''invalid'', not an error.
  BEGIN
   local_date:=(read_at AT TIME ZONE zone)::date; zone_state:=''configured'';
  EXCEPTION WHEN invalid_parameter_value THEN
   zone_state:=''invalid''; zone:=NULL; local_date:=NULL;
  END;
 END IF;

 RETURN jsonb_build_object(
  ''state'',zone_state,''zone'',zone,
  ''set_at'',CASE WHEN zone_state=''missing'' THEN NULL ELSE zone_set_at END,
  ''local_date'',local_date,''read_at'',read_at,
  -- Whether THIS caller may change it (set_business_time_zone is owner-only).
  ''can_set'',owner);
END '; zone_delegate text:=' RETURN public._business_time_zone_for_tenant(_expected_tenant_id,read_at)||jsonb_build_object(''can_set'',owner);
END;
';
BEGIN
 SELECT * INTO STRICT core FROM pg_proc WHERE oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb)'::regprocedure;
 SELECT * INTO STRICT zone FROM pg_proc WHERE oid='public.read_business_time_zone(uuid)'::regprocedure;
 core_oid:=core.oid;zone_oid:=zone.oid;old_core:=core.prosrc;old_zone:=zone.prosrc;
 core_metadata:=to_jsonb(core)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'];
 zone_metadata:=to_jsonb(zone)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'];
 -- Complete original scope/owner/ABI/ACL gates, not a service-role shortcut.
 FOR spec IN SELECT * FROM (VALUES
  ('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb)',false,0,ARRAY['_tenant','_client','p_limit','p_after'],ARRAY['search_path=""'],ARRAY['postgres']),
  ('public.read_business_time_zone(uuid)',true,0,ARRAY['_expected_tenant_id'],ARRAY['search_path=pg_catalog, public'],ARRAY['postgres','authenticated']),
  ('public.client_portal_invoices(uuid,integer,jsonb)',true,3,ARRAY['p_tenant_id','p_limit','p_after'],ARRAY['search_path=public, pg_temp'],ARRAY['postgres','authenticated','service_role']),
  ('public._client_portal_billing_client(uuid)',true,0,ARRAY['p_tenant_id'],ARRAY['search_path=public, pg_temp'],ARRAY['postgres']),
  ('public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb)',true,2,ARRAY['p_tenant_id','p_expected_client_id','p_limit','p_after'],ARRAY['search_path=public, pg_temp'],ARRAY['postgres','authenticated'])
 ) s(identity,definer,defaults,names,settings,roles) LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(spec.identity);
  IF p.prorettype<>'jsonb'::regtype AND spec.identity<>'public._client_portal_billing_client(uuid)'
   OR (spec.identity='public._client_portal_billing_client(uuid)' AND p.prorettype<>'uuid'::regtype)
   OR p.prosecdef IS DISTINCT FROM spec.definer OR p.provolatile<>'v' OR p.pronargdefaults<>spec.defaults
   OR p.proargnames IS DISTINCT FROM spec.names OR p.proconfig IS DISTINCT FROM spec.settings
   OR pg_get_userbyid(p.proowner)<>'postgres' OR p.proretset OR p.provariadic<>0 OR p.proargmodes IS NOT NULL
   OR p.proallargtypes IS NOT NULL OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.proacl IS NULL
   OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable
     OR pg_get_userbyid(a.grantee)<>ALL(spec.roles))
   OR (SELECT count(DISTINCT a.grantee) FROM aclexplode(p.proacl) a)<>cardinality(spec.roles) THEN
   RAISE EXCEPTION 'Original invoice/calendar authority metadata changed: %',spec.identity USING ERRCODE='23514';
  END IF;
 END LOOP;
 FOR spec IN SELECT * FROM (VALUES
  ('public.client_portal_invoices(uuid,integer,jsonb)','91f0344a6231205da5763af3755f0ad3'),
  ('public._client_portal_billing_client(uuid)','7785ae6623f447c23b040d06d3c701a2'),
  ('public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb)','a13ec7e7ebd4985091aba7381e851a87')
 ) s(identity,hash) LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure(spec.identity)) IS DISTINCT FROM spec.hash THEN
   RAISE EXCEPTION 'Original invoice scope body changed: %',spec.identity USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF md5(old_core)='d86613d312960b0d507898210e7e5197' AND md5(old_zone)='4fc91b47874d78ccac6728dcd95eb126' THEN
  FOR spec IN SELECT * FROM (VALUES ('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)','a307bf9e57e5b2ad692c74a329e683cd',ARRAY['_tenant','_client','p_limit','p_after','p_as_of']::text[]),
('public._business_time_zone_for_tenant(uuid,timestamp with time zone)','5c149760b8cd699b4621f755e1f2eab1',ARRAY['_expected_tenant_id','_read_at']::text[]),
('public._client_portal_invoice_observation_for_client(uuid,uuid)','83f32502da913d873d3454e4fc12671d',ARRAY['_tenant','_client']::text[])) s(identity,hash,names) LOOP
   IF to_regprocedure(spec.identity) IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected partial native invoice source: %',spec.identity USING ERRCODE='23514';
   END IF;
  END LOOP;
  new_core:=old_core;
  FOR step IN SELECT * FROM (VALUES ('  _today date := (now() AT TIME ZONE ''UTC'')::date;','  _today date := p_as_of;'),
('  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';
  END IF;','  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';
  END IF;
  IF p_as_of IS NOT NULL AND NOT isfinite(p_as_of) THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_INPUT_INVALID'' USING ERRCODE=''22023'';
  END IF;'),
('      i.billing_issued_at AS issued_at,','      i.billing_issued_at AS issued_at, i.billing_issued_snapshot_version AS issued_snapshot_version,'),
('      ''issued_at'', p.issued_at, ''due_date'', p.due_date,','      ''issued_at'', p.issued_at, ''due_date'', p.due_date,
      ''issued_snapshot_version'', p.issued_snapshot_version,'),
('    ''read_at'', statement_timestamp()','    ''_native_sources'', jsonb_build_object(''as_of_date'',p_as_of,''all_facts_identity'',
      encode(extensions.digest(coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM facts f),''[]''::jsonb)::text,''sha256''),''hex'')),
    ''read_at'', statement_timestamp()')) s(before,after) LOOP
   IF (length(new_core)-length(replace(new_core,step.before,'')))/length(step.before)<>1 THEN
    RAISE EXCEPTION 'Original financial query factoring anchor changed' USING ERRCODE='23514';
   END IF;
   new_core:=replace(new_core,step.before,step.after);
  END LOOP;
  IF md5(new_core)<>'a307bf9e57e5b2ad692c74a329e683cd' THEN RAISE EXCEPTION 'Native financial query differs' USING ERRCODE='23514';END IF;
  inverse:=new_core;
  FOR step IN SELECT * FROM (VALUES ('  _today date := (now() AT TIME ZONE ''UTC'')::date;','  _today date := p_as_of;'),
('  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';
  END IF;','  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';
  END IF;
  IF p_as_of IS NOT NULL AND NOT isfinite(p_as_of) THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_INPUT_INVALID'' USING ERRCODE=''22023'';
  END IF;'),
('      i.billing_issued_at AS issued_at,','      i.billing_issued_at AS issued_at, i.billing_issued_snapshot_version AS issued_snapshot_version,'),
('      ''issued_at'', p.issued_at, ''due_date'', p.due_date,','      ''issued_at'', p.issued_at, ''due_date'', p.due_date,
      ''issued_snapshot_version'', p.issued_snapshot_version,'),
('    ''read_at'', statement_timestamp()','    ''_native_sources'', jsonb_build_object(''as_of_date'',p_as_of,''all_facts_identity'',
      encode(extensions.digest(coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM facts f),''[]''::jsonb)::text,''sha256''),''hex'')),
    ''read_at'', statement_timestamp()')) s(before,after) LOOP
   inverse:=replace(inverse,step.after,step.before);
  END LOOP;
  IF inverse<>old_core THEN RAISE EXCEPTION 'Whole original financial query inverse differs' USING ERRCODE='23514';END IF;
  IF (length(old_zone)-length(replace(old_zone,zone_tail,'')))/length(zone_tail)<>1 THEN
   RAISE EXCEPTION 'Original business calendar factoring anchor changed' USING ERRCODE='23514';
  END IF;
  new_zone:=replace(old_zone,zone_tail,zone_delegate);
  IF md5(new_zone)<>'6effd52ad7b9ab0f09319c2e4d422620' OR replace(new_zone,zone_delegate,zone_tail)<>old_zone THEN
   RAISE EXCEPTION 'Whole original calendar inverse differs' USING ERRCODE='23514';
  END IF;
 EXECUTE format('CREATE FUNCTION public._client_portal_invoice_facts_for_client(_tenant uuid,_client uuid,p_limit integer,p_after jsonb,p_as_of date) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='''' AS %L',new_core);
 REVOKE ALL ON FUNCTION public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date) FROM PUBLIC,anon,authenticated,service_role;
 ALTER FUNCTION public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date) OWNER TO postgres;
 EXECUTE format('CREATE FUNCTION public._business_time_zone_for_tenant(_expected_tenant_id uuid,_read_at timestamptz) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='''' AS %L','
DECLARE read_at timestamptz:=_read_at;
 zone text; zone_set_at timestamptz; zone_state text; local_date date;
BEGIN
 IF _expected_tenant_id IS NULL OR _read_at IS NULL OR NOT isfinite(_read_at) THEN
  RAISE EXCEPTION ''BUSINESS_TIME_ZONE_INPUT_INVALID'' USING ERRCODE=''22023'';
 END IF;
 SELECT z.time_zone,z.set_at INTO zone,zone_set_at FROM public.tenant_business_time_zones z
 WHERE z.tenant_id=_expected_tenant_id;
 IF zone IS NULL THEN zone_state:=''missing'';
 ELSE
  -- Same degrade as the client status read: an unrecognised stored zone is ''invalid'', not an error.
  BEGIN
   local_date:=(read_at AT TIME ZONE zone)::date; zone_state:=''configured'';
  EXCEPTION WHEN invalid_parameter_value THEN
   zone_state:=''invalid''; zone:=NULL; local_date:=NULL;
  END;
 END IF;

 RETURN jsonb_build_object(
  ''state'',zone_state,''zone'',zone,
  ''set_at'',CASE WHEN zone_state=''missing'' THEN NULL ELSE zone_set_at END,
  ''local_date'',local_date,''read_at'',read_at);
END ');
 REVOKE ALL ON FUNCTION public._business_time_zone_for_tenant(uuid,timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role;
 ALTER FUNCTION public._business_time_zone_for_tenant(uuid,timestamp with time zone) OWNER TO postgres;
 EXECUTE format('CREATE FUNCTION public._client_portal_invoice_observation_for_client(_tenant uuid,_client uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='''' AS %L','
DECLARE read_at timestamptz:=statement_timestamp(); calendar jsonb; facts jsonb; query jsonb; identity text;
BEGIN
 IF _tenant IS NULL OR _client IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.clients c WHERE c.id=_client AND c.tenant_id=_tenant) THEN
  RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';
 END IF;
 calendar:=public._business_time_zone_for_tenant(_tenant,read_at);
 query:=jsonb_build_object(''limit'',5,''after'',null,''as_of_date'',calendar->''local_date'');
 facts:=public._client_portal_invoice_facts_for_client(_tenant,_client,5,null,(calendar->>''local_date'')::date);
 identity:=encode(extensions.digest(jsonb_build_object(
  ''schema_version'',1,''tenant_id'',_tenant,''client_id'',_client,''query'',query,
  ''calendar'',calendar-''read_at'',''facts'',facts-''read_at'')::text,''sha256''),''hex'');
 RETURN jsonb_build_object(''schema_version'',1,''tenant_id'',_tenant,''client_id'',_client,
  ''query'',query,''calendar'',calendar,''facts'',facts,''observation_identity'',identity,''read_at'',read_at);
END;
');
 REVOKE ALL ON FUNCTION public._client_portal_invoice_observation_for_client(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
 ALTER FUNCTION public._client_portal_invoice_observation_for_client(uuid,uuid) OWNER TO postgres;

  EXECUTE replace(pg_get_functiondef(core_oid),old_core,legacy_body);
  EXECUTE replace(pg_get_functiondef(zone_oid),old_zone,new_zone);
 ELSIF md5(old_core)<>'0a70d5ed7b157fa68472bbf24785be1a' OR md5(old_zone)<>'6effd52ad7b9ab0f09319c2e4d422620' THEN
  RAISE EXCEPTION 'Original financial/calendar source requires reconciliation' USING ERRCODE='23514';
 END IF;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=core_oid;
 IF to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'] IS DISTINCT FROM core_metadata
  OR md5(p.prosrc)<>'0a70d5ed7b157fa68472bbf24785be1a' THEN RAISE EXCEPTION 'Original four-argument invoice ABI changed' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=zone_oid;
 IF to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'] IS DISTINCT FROM zone_metadata
  OR md5(p.prosrc)<>'6effd52ad7b9ab0f09319c2e4d422620' THEN RAISE EXCEPTION 'Original owner calendar ABI changed' USING ERRCODE='23514';END IF;
 FOR spec IN SELECT * FROM (VALUES ('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)','a307bf9e57e5b2ad692c74a329e683cd',ARRAY['_tenant','_client','p_limit','p_after','p_as_of']::text[]),
('public._business_time_zone_for_tenant(uuid,timestamp with time zone)','5c149760b8cd699b4621f755e1f2eab1',ARRAY['_expected_tenant_id','_read_at']::text[]),
('public._client_portal_invoice_observation_for_client(uuid,uuid)','83f32502da913d873d3454e4fc12671d',ARRAY['_tenant','_client']::text[])) s(identity,hash,names) LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(spec.identity);
  IF md5(p.prosrc)<>spec.hash OR p.prosecdef OR p.provolatile<>'v' OR p.pronargdefaults<>0
   OR p.proargnames IS DISTINCT FROM spec.names OR p.prorettype<>'jsonb'::regtype OR p.proretset
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR pg_get_userbyid(p.proowner)<>'postgres'
   OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.proisstrict
   OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.proacl IS NULL
   OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'Private native financial source readback differs: %',spec.identity USING ERRCODE='23514';
  END IF;
 END LOOP;
END $e04_invoice_observation$;
COMMENT ON FUNCTION public._client_portal_invoice_observation_for_client(uuid,uuid) IS
 'Private versioned original invoice source, not requester authorization, a completed action, a receipt store or safe final publication. Original native accepted-requester/current-relationship/publication chain must govern any consumer. No API grant or provider effect.';
COMMENT ON FUNCTION public._business_time_zone_for_tenant(uuid,timestamptz) IS
 'Private factoring of the original configured business calendar. Explicit observation time; missing/invalid remains explicit. Does not confer actor permission. Original owner reader retains its authorization and response.';
COMMIT;
