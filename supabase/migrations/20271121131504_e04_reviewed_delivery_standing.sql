-- Add exact-version delivery decisions to the ORIGINAL scoped owner read.
-- No new RPC, grant, writer, trigger, decision or completion authority.
BEGIN;
DO $reader$
DECLARE p pg_catalog.pg_proc%ROWTYPE; expected_oid oid; original text; changed text;
 metadata jsonb; after_metadata jsonb;
 anchor text:=$anchor$'effective_terms',public._sales_client_effective_terms(_expected_tenant_id,_contact_id,p.id),$anchor$;
 replacement text:=$replacement$'effective_terms',public._sales_client_effective_terms(_expected_tenant_id,_contact_id,p.id),
    'reviewed_delivery',public._sales_client_reviewed_delivery(_expected_tenant_id,_contact_id,p.id),$replacement$;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public._sales_client_reviewed_delivery(uuid,uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'93f5fb101c0c54acab9ac2ac4a4f37e3'
  OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
   WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'Original private reviewed delivery projection changed' USING ERRCODE='23514';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public._sales_client_effective_terms(uuid,uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'2d0bb3db63603ffe58b66b492ffc37ef'
  OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
   WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'Original effective terms projection changed' USING ERRCODE='23514';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public.read_client_engagement_status(uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN ('4680297b25322dca36b44dbaaf528a39','9a5f7a5d0964b3fb0fbce8f11f97bbd2')
  OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
   WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable
    OR a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')))
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
   WHERE a.privilege_type='EXECUTE' AND a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')) THEN
  RAISE EXCEPTION 'Original scoped client status reader changed' USING ERRCODE='23514';
 END IF;
 expected_oid:=p.oid;
 metadata:=pg_catalog.to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'];
 IF pg_catalog.md5(p.prosrc)='4680297b25322dca36b44dbaaf528a39' THEN
  original:=pg_catalog.pg_get_functiondef(expected_oid);
  IF (pg_catalog.length(original)-pg_catalog.length(pg_catalog.replace(original,anchor,'')))/pg_catalog.length(anchor)<>1 THEN
   RAISE EXCEPTION 'Original delivery projection anchor changed' USING ERRCODE='23514';
  END IF;
  changed:=pg_catalog.replace(original,anchor,replacement);
  EXECUTE changed;
 END IF;
 SELECT pg_catalog.to_jsonb(x)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'] INTO after_metadata
 FROM pg_catalog.pg_proc x WHERE x.oid=expected_oid;
 IF 'public.read_client_engagement_status(uuid,uuid)'::regprocedure::oid<>expected_oid
  OR metadata IS DISTINCT FROM after_metadata
  OR (SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=expected_oid)<>'9a5f7a5d0964b3fb0fbce8f11f97bbd2' THEN
  RAISE EXCEPTION 'Additive original delivery readback differs' USING ERRCODE='23514';
 END IF;
END $reader$;
COMMIT;
