-- Factor ONE original financial query; do not create an authorization bypass.
-- Public Billing retains the caller-JWT resolver, relationship SHARE locks,
-- identity/role/revocation checks and every original API grant. The private
-- invoker core has NO API grant. A native consumer must first prove its original
-- accepted requester and current relationship under the existing scope locks.
BEGIN;
DO $financial_core$
DECLARE p pg_catalog.pg_proc%ROWTYPE; original_oid oid; before_metadata jsonb;
 original_body text; core_body text; original_definition text; core_oid oid;
 declarations text:=E'  _client uuid;\n  _tenant uuid;\n';
 resolver text:=E'  _client := public._client_portal_billing_client(p_tenant_id);\n  IF _client IS NULL THEN RETURN NULL; END IF;\n  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client;';
 null_guard text:=E'  IF _tenant IS NULL OR _client IS NULL THEN\n    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';\n  END IF;';
 wrapper text:=E'\nDECLARE\n  _client uuid;\n  _tenant uuid;\nBEGIN\n  _client := public._client_portal_billing_client(p_tenant_id);\n  IF _client IS NULL THEN RETURN NULL; END IF;\n  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client;\n  RETURN public._client_portal_invoice_facts_for_client(_tenant,_client,p_limit,p_after);\nEND;\n';
 expected record;
BEGIN
 -- Existing authority is owned by these original bodies, never the new core.
 FOR expected IN SELECT * FROM (VALUES
  ('public._client_portal_billing_client(uuid)','7785ae6623f447c23b040d06d3c701a2'),
  ('public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb)','a13ec7e7ebd4985091aba7381e851a87')
 ) v(identity,body_hash) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(expected.identity);
  IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>expected.body_hash
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
   OR p.provolatile<>'v' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.proacl IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
    WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR (a.grantee<>p.proowner
     AND (expected.identity<>'public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb)'
      OR a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated'))))
   OR (expected.identity='public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb)'
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated'))) THEN
   RAISE EXCEPTION 'Original client invoice authority changed: %',expected.identity USING ERRCODE='23514';
  END IF;
 END LOOP;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.client_portal_invoices(uuid,integer,jsonb)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN ('28df84d29fcde1e64bb09153f4d3e77b','91f0344a6231205da5763af3755f0ad3')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.pronargs<>3 OR p.pronargdefaults<>3
  OR p.proargnames IS DISTINCT FROM ARRAY['p_tenant_id','p_limit','p_after']::text[]
  OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
  OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
  OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
  OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable
   OR a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated'),(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role')))
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated'))
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role')) THEN
  RAISE EXCEPTION 'Original public client invoice reader changed' USING ERRCODE='23514';
 END IF;
 original_oid:=p.oid;original_body:=p.prosrc;
 before_metadata:=pg_catalog.to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'];
 core_oid:=pg_catalog.to_regprocedure('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb)');
 IF core_oid IS NOT NULL THEN
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=core_oid;
  IF pg_catalog.md5(p.prosrc)<>'d86613d312960b0d507898210e7e5197' OR p.prosecdef OR p.provolatile<>'v'
   OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.pronargs<>4 OR p.pronargdefaults<>0
   OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_client','p_limit','p_after']::text[]
   OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
   OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
   OR p.proacl IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
    WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner) THEN
   RAISE EXCEPTION 'Original private invoice facts changed' USING ERRCODE='23514';
  END IF;
 END IF;
 IF pg_catalog.md5(original_body)='28df84d29fcde1e64bb09153f4d3e77b' THEN
  IF (pg_catalog.length(original_body)-pg_catalog.length(pg_catalog.replace(original_body,declarations,'')))/pg_catalog.length(declarations)<>1
   OR (pg_catalog.length(original_body)-pg_catalog.length(pg_catalog.replace(original_body,resolver,'')))/pg_catalog.length(resolver)<>1 THEN
   RAISE EXCEPTION 'Original invoice factoring anchors changed' USING ERRCODE='23514';
  END IF;
  core_body:=pg_catalog.replace(pg_catalog.replace(original_body,declarations,''),resolver,null_guard);
  IF pg_catalog.md5(core_body)<>'d86613d312960b0d507898210e7e5197' THEN
   RAISE EXCEPTION 'Original invoice query changed' USING ERRCODE='23514';
  END IF;
  EXECUTE pg_catalog.format('CREATE OR REPLACE FUNCTION public._client_portal_invoice_facts_for_client(_tenant uuid,_client uuid,p_limit integer,p_after jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='''' AS %L',core_body);
  REVOKE ALL ON FUNCTION public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
  original_definition:=pg_catalog.pg_get_functiondef(original_oid);
  EXECUTE pg_catalog.replace(original_definition,original_body,wrapper);
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=original_oid;
 IF 'public.client_portal_invoices(uuid,integer,jsonb)'::regprocedure::oid<>original_oid
  OR pg_catalog.to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'] IS DISTINCT FROM before_metadata
  OR pg_catalog.md5(p.prosrc)<>'91f0344a6231205da5763af3755f0ad3' THEN
  RAISE EXCEPTION 'Original public invoice ABI or authority changed' USING ERRCODE='23514';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'d86613d312960b0d507898210e7e5197' OR p.prosecdef OR p.provolatile<>'v'
  OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.pronargs<>4 OR p.pronargdefaults<>0
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_client','p_limit','p_after']::text[]
  OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
  OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
  OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
  OR p.proacl IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
   WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'Private invoice facts readback differs' USING ERRCODE='23514';
 END IF;
END $financial_core$;
COMMENT ON FUNCTION public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb) IS
 'Owner-only original financial query, not actor authorization. Original public JWT scope or independently proven native accepted-requester/current-relationship scope must precede use. No API grant, provider effect, receipt store or alternate ledger.';
COMMIT;
