-- Experience 04 E4-S2 (ANT-51 / ANT-147): conversational client status + owner time-zone setup.
--
-- Two read-only seams, both SECURITY DEFINER behind the SAME owner/admin authority every Sales read
-- uses (public._sales_invoice_actor), scoped to the caller's active workspace and never to a value
-- the request supplies (§9/§59):
--
--   read_business_time_zone(tenant)       — the persisted business zone, for Setup's readback and for
--                                            PAIGE to say what is configured. No second store: it
--                                            reads tenant_business_time_zones (E4-S1b) and nothing else.
--   find_clients_for_status(tenant, text) — resolves "where does this client stand?" to a client of
--                                            THIS workspace by name, business name or exact email.
--                                            Returns names only (the established picker helper);
--                                            never an email, phone or note.
--
-- Writes stay where E4-S1b put them: only set_business_time_zone (active owner) changes the zone.
-- Each read records one capability receipt, matching read_client_engagement_status.

CREATE OR REPLACE FUNCTION public.read_business_time_zone(_expected_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE run uuid:=gen_random_uuid(); read_at timestamptz:=clock_timestamp();
 zone text; zone_set_at timestamptz; zone_state text; local_date date; owner boolean;
BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Business time zone workspace changed' USING ERRCODE='42501';
 END IF;
 -- Owner or admin of the active workspace may read it; staff, clients and other workspaces may not.
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 owner:=EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_expected_tenant_id
   AND tm.user_id=auth.uid() AND tm.is_owner AND tm.status='active');

 SELECT z.time_zone,z.set_at INTO zone,zone_set_at FROM public.tenant_business_time_zones z
 WHERE z.tenant_id=_expected_tenant_id;
 IF zone IS NULL THEN zone_state:='missing';
 ELSE
  -- Same degrade as the client status read: an unrecognised stored zone is 'invalid', not an error.
  BEGIN
   local_date:=(read_at AT TIME ZONE zone)::date; zone_state:='configured';
  EXCEPTION WHEN invalid_parameter_value THEN
   zone_state:='invalid'; zone:=NULL; local_date:=NULL;
  END;
 END IF;

 PERFORM public.record_capability_run(_expected_tenant_id,auth.uid(),'read_business_time_zone','capability_succeeded',run,NULL);
 RETURN jsonb_build_object(
  'state',zone_state,'zone',zone,
  'set_at',CASE WHEN zone_state='missing' THEN NULL ELSE zone_set_at END,
  'local_date',local_date,'read_at',read_at,
  -- Whether THIS caller may change it (set_business_time_zone is owner-only).
  'can_set',owner,'receipt_id',run);
END $$;
REVOKE ALL ON FUNCTION public.read_business_time_zone(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_business_time_zone(uuid) TO authenticated;
COMMENT ON FUNCTION public.read_business_time_zone(uuid) IS
 'Experience 04 E4-S2: the active workspace''s business time zone {state configured|missing|invalid, zone, set_at, local_date, can_set}. Owner/admin of the active workspace only. One receipt per read.';

CREATE OR REPLACE FUNCTION public.find_clients_for_status(_expected_tenant_id uuid,_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE run uuid:=gen_random_uuid(); q text:=btrim(_query); pattern text; found jsonb; more boolean;
BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Client search workspace changed' USING ERRCODE='42501';
 END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 IF q IS NULL OR length(q)<2 OR length(q)>120 THEN
  RAISE EXCEPTION 'Search for a client with 2 to 120 characters' USING ERRCODE='22023';
 END IF;
 -- The search text is data, never a pattern: escape LIKE wildcards before wrapping it.
 pattern:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';

 WITH hits AS (
  SELECT c.id,public._sales_collection_client_name(c.id,_expected_tenant_id) AS name,c.status,
   -- Exact name or exact email ranks first, so "Jane Doe" beats "Jane Doe-Smith".
   (lower(trim(concat_ws(' ',c.first_name,c.last_name)))=lower(q)
    OR lower(trim(coalesce(c.entity_name,'')))=lower(q)
    OR lower(trim(coalesce(c.email,'')))=lower(q)) AS exact
  FROM public.clients c
  WHERE c.tenant_id=_expected_tenant_id
   AND (concat_ws(' ',c.first_name,c.last_name) ILIKE pattern
    OR coalesce(c.entity_name,'') ILIKE pattern
    -- Email matches only when typed in full: a fragment must not enumerate addresses.
    OR lower(trim(coalesce(c.email,'')))=lower(q))
  ORDER BY exact DESC,name,c.id
  LIMIT 6)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'name',h.name,'status',h.status,'exact',h.exact)
   ORDER BY h.exact DESC,h.name,h.id) FILTER (WHERE rn<=5),'[]'::jsonb),count(*)>5
 INTO found,more
 FROM (SELECT *,row_number() OVER (ORDER BY exact DESC,name,id) rn FROM hits) h;

 PERFORM public.record_capability_run(_expected_tenant_id,auth.uid(),'find_clients_for_status','capability_succeeded',run,NULL);
 RETURN jsonb_build_object('matches',found,'more',more,'receipt_id',run);
END $$;
REVOKE ALL ON FUNCTION public.find_clients_for_status(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.find_clients_for_status(uuid,text) TO authenticated;
COMMENT ON FUNCTION public.find_clients_for_status(uuid,text) IS
 'Experience 04 E4-S2: up to five clients of the caller''s active workspace matching a name, business name or exact email, for the client-status answer. Names and status only. Owner/admin only. One receipt per search.';
