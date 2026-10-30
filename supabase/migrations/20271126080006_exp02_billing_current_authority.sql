-- Original Billing producer currentness after the existing workspace advisory wait.
-- Order: EXP05 published80005, then this80006, then EXP08 published80008.
-- No new function, grant, table, caller, lock order, provider act or target-workspace ABI.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $billing_current_authority$
DECLARE
  spec record;
  p pg_catalog.pg_proc%ROWTYPE;
  original_oid oid;
  before_metadata jsonb;
  corrected text;
  anchor text := E'  PERFORM pg_advisory_xact_lock(hashtextextended(''platform_billing_contacts:'' || _t::text, 0));\n';
  addition text := E'  -- Re-resolve after waiting, retaining the workspace whose lock was acquired.\n'
    '  IF public.platform_billing_workspace_owner_scope() IS DISTINCT FROM _t THEN\n'
    '    RAISE EXCEPTION ''billing_workspace_owner_only'' USING ERRCODE = ''42501'';\n'
    '  END IF;\n';
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('public.platform_billing_workspace_owner_scope()',
      '3d33a31f95f308784853f7b3816b1e8c', '3d33a31f95f308784853f7b3816b1e8c', NULL::text[], 's', false),
    ('public.platform_billing_contact_designate(uuid,text)',
      '7a5ee44d62f25eae831ca9c3883ff906', 'f94a50f885e70e09267d69956f0e7334', ARRAY['p_user_id','p_designation'], 'v', true),
    ('public.platform_billing_contact_revoke(uuid)',
      'c67dc4c18e72fde1dbc89d15be09edd9', 'e641bac2c38e3b5daa17a73811dff11e', ARRAY['p_contact_id'], 'v', true)
  ) v(signature, original_digest, corrected_digest, argument_names, volatility, app_callable)
  LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc
      WHERE oid = pg_catalog.to_regprocedure(spec.signature);
    IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN (spec.original_digest, spec.corrected_digest)
      OR pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres' OR NOT p.prosecdef
      OR p.prorettype <> (CASE WHEN spec.app_callable THEN 'jsonb'::regtype ELSE 'uuid'::regtype END)
      OR p.proretset OR p.pronargdefaults <> 0
      OR p.proargnames IS DISTINCT FROM spec.argument_names
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
      OR p.provolatile::text <> spec.volatility OR p.proparallel <> 'u'
      OR p.proisstrict OR p.proleakproof OR p.prokind <> 'f' OR p.provariadic <> 0
      OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
      OR p.proacl IS NULL
      OR (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl)) <> (CASE WHEN spec.app_callable THEN 2 ELSE 1 END)
      OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
        WHERE a.grantor <> p.proowner OR a.privilege_type <> 'EXECUTE' OR a.is_grantable
          OR (a.grantee <> p.proowner AND (NOT spec.app_callable OR a.grantee <> 'authenticated'::regrole))) THEN
      RAISE EXCEPTION 'Original Billing current-authority prerequisite drift' USING ERRCODE = '23514';
    END IF;
    original_oid := p.oid;
    before_metadata := pg_catalog.to_jsonb(p) - 'prosrc';
    IF spec.app_callable AND pg_catalog.md5(p.prosrc) = spec.original_digest THEN
      IF (length(p.prosrc) - length(replace(p.prosrc, anchor, ''))) <> length(anchor) THEN
        RAISE EXCEPTION 'Original Billing advisory anchor drift' USING ERRCODE = '23514';
      END IF;
      corrected := pg_catalog.replace(p.prosrc, anchor, anchor || addition);
      IF pg_catalog.md5(corrected) <> spec.corrected_digest THEN
        RAISE EXCEPTION 'Billing current-authority correction differs from reviewed source' USING ERRCODE = '23514';
      END IF;
      EXECUTE pg_catalog.replace(pg_catalog.pg_get_functiondef(original_oid), p.prosrc, corrected);
    END IF;
    SELECT * INTO STRICT p FROM pg_catalog.pg_proc WHERE oid = original_oid;
    IF pg_catalog.md5(p.prosrc) <> spec.corrected_digest
      OR pg_catalog.to_jsonb(p) - 'prosrc' IS DISTINCT FROM before_metadata THEN
      RAISE EXCEPTION 'Original Billing metadata or current-authority correction changed' USING ERRCODE = '23514';
    END IF;
  END LOOP;
END $billing_current_authority$;
COMMIT;
