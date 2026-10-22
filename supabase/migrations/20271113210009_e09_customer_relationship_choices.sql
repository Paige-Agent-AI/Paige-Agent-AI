-- Read selectable original CRM relationships. This does not select a business,
-- create membership, change staff workspace, or authorize a later customer act.
BEGIN;

DO $lease$
DECLARE expected record; actual record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.client_portal_relationship_id(uuid)','da4f00851ef119e4a364aecad7292543'),
  ('public.resolve_tenant_brand(uuid)','75be1824be31ba5ac637b671213240c9')
 ) e(signature,body_md5) LOOP
  SELECT md5(prosrc) body_md5,pg_get_userbyid(proowner) owner,prosecdef,provolatile
   INTO actual FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF actual.body_md5 IS DISTINCT FROM expected.body_md5 OR actual.owner IS DISTINCT FROM 'postgres'
    OR actual.prosecdef IS DISTINCT FROM true OR actual.provolatile IS DISTINCT FROM 's' THEN
   RAISE EXCEPTION 'Customer relationship source changed (%); review composition',expected.signature
    USING ERRCODE='42501';
  END IF;
 END LOOP;
END $lease$;

CREATE FUNCTION public.client_portal_relationship_choices(
 p_limit integer DEFAULT 20,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb;
BEGIN
 IF actor IS NULL THEN
  RAISE EXCEPTION 'customer authentication required' USING ERRCODE='42501';
 END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'customer relationship page invalid' USING ERRCODE='22023';
 END IF;
 -- The argument is a pagination cursor, never an actor or authority. Resolve
 -- each business through the same current open/unmerged native relationship.
 WITH candidates AS MATERIALIZED (
  SELECT c.id,c.tenant_id FROM public.clients c
   WHERE c.linked_user_id=actor AND (p_after IS NULL OR c.id>p_after)
    AND c.id=public.client_portal_relationship_id(c.tenant_id)
   ORDER BY c.id LIMIT p_limit+1
 ), page AS (
  SELECT c.*,row_number() OVER (ORDER BY c.id) rn FROM candidates c
 ), visible AS (
  SELECT p.id,p.tenant_id,p.rn,b.tenant_name,
   coalesce(b.logo_url,l.brand_logo_url) logo_url,b.logo_dark_url
  FROM page p JOIN public.resolve_tenant_brand(p.tenant_id) b ON true
   LEFT JOIN public.tenant_legal_profile l ON l.tenant_id=p.tenant_id
  WHERE p.rn<=p_limit
 )
 SELECT jsonb_build_object('contract_version',1,'actor_id',actor,
  'relationships',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'client_id',v.id,'tenant_id',v.tenant_id,'business_name',v.tenant_name,
   'logo_url',v.logo_url,'logo_dark_url',v.logo_dark_url) ORDER BY v.id)
   FROM visible v),'[]'::jsonb),
  'has_more',(SELECT count(*)>p_limit FROM candidates),
  'next_after',CASE WHEN (SELECT count(*)>p_limit FROM candidates)
   THEN (SELECT p.id FROM page p WHERE p.rn=p_limit) ELSE NULL END)
 INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.client_portal_relationship_choices(integer,uuid)
 FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_relationship_choices(integer,uuid) TO authenticated;
COMMENT ON FUNCTION public.client_portal_relationship_choices(integer,uuid) IS
 'Auth-bound bounded original CRM relationship/public-brand choices. No selection, grant, staff context, private records or execution authority; every later frame/action must reauthorize.';

COMMIT;
