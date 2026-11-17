-- CLI-created 20261113165557; empty/unapplied carrier moved forward after verified production28.
-- EXP08 finite binding repair. No approval, claim, execution or protected-table grant is changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $scope$
DECLARE signature text; expected text; f record; relation regclass;
BEGIN
 FOR signature,expected IN SELECT * FROM (VALUES
  ('public.current_user_tenant_id()','f16384fd81d48901441185bec66f939f'),
  ('public._team_hub_is_active(uuid,uuid)','0bb50fd64a0410d09df23e7e6e29ab2d')
 ) p(signature,expected) LOOP
  SELECT p.*,pg_get_userbyid(p.proowner) owner INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(signature);
  IF NOT FOUND OR f.owner<>'postgres' OR md5(replace(f.prosrc,chr(13),''))<>expected THEN
   RAISE EXCEPTION 'Original binding scope source changed: %',signature USING ERRCODE='55000'; END IF;
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['public.team_hub_message_cards'::regclass,
  'public.team_hub_agent_turns'::regclass,'public.team_hub_messages'::regclass] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=relation AND c.relrowsecurity
    AND c.relacl=acldefault('r',c.relowner) AND pg_get_userbyid(c.relowner)='postgres') THEN
   RAISE EXCEPTION 'Original private binding table boundary changed: %',relation USING ERRCODE='55000'; END IF;
 END LOOP;
 IF to_regprocedure('public.team_hub_card_binding(uuid,text[])') IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.team_hub_card_binding(uuid,text[])')
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='s'
   AND p.proconfig=ARRAY['search_path=""'] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
   AND md5(replace(p.prosrc,chr(13),''))='a94bc7933fc6fe20a015dd9f4dbc7c6e') THEN
  RAISE EXCEPTION 'Existing binding projection source/authority changed' USING ERRCODE='55000'; END IF;
END $scope$;

-- A definer is necessary ONLY to derive this input-token exclusion fact from the existing protected
-- card relation. JWT identity + current native membership are checked inside; no row metadata escapes.
CREATE OR REPLACE FUNCTION public.team_hub_card_binding(p_expected_user_id uuid,p_fingerprints text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $binding$
DECLARE actor uuid:=auth.uid(); tenant uuid:=public.current_user_tenant_id(); bound jsonb;
BEGIN
 IF actor IS NULL OR p_expected_user_id IS DISTINCT FROM actor OR tenant IS NULL
  OR NOT coalesce(public._team_hub_is_active(tenant,actor),false) THEN
  RETURN jsonb_build_object('ok',false,'code','scope_changed'); END IF;
 IF p_fingerprints IS NULL OR coalesce(array_ndims(p_fingerprints),1)<>1 OR cardinality(p_fingerprints)>100
  OR EXISTS(SELECT 1 FROM unnest(p_fingerprints) fp WHERE fp IS NULL OR fp !~ '^[0-9a-f]{16}$') THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A known own proposal from a different workspace is NOT an unbound current proposal.
 -- Refuse the batch without identifying its workspace or leaking another person's binding.
 IF EXISTS(SELECT 1 FROM public.paige_pending_confirmations p WHERE p.user_id=actor
  AND p.thread_id IS NULL AND p.fingerprint=ANY(p_fingerprints) AND p.tenant_id IS DISTINCT FROM tenant) THEN
  RETURN jsonb_build_object('ok',false,'code','scope_changed'); END IF;
 SELECT coalesce(jsonb_agg(q.fingerprint ORDER BY q.fingerprint),'[]'::jsonb) INTO bound FROM (
  SELECT DISTINCT p.fingerprint FROM public.paige_pending_confirmations p
   WHERE p.user_id=actor AND p.tenant_id=tenant AND p.thread_id IS NULL AND p.fingerprint=ANY(p_fingerprints)
    AND EXISTS(SELECT 1 FROM public.team_hub_message_cards c WHERE c.confirmation_id=p.id)
 ) q;
 -- Intentionally no live/expiry/channel-visibility filter: a previously issued private card token
 -- remains excluded from Chat even when consumed, expired, or no longer visible. This grants no act.
 RETURN jsonb_build_object('ok',true,'bound',bound);
END
$binding$;
ALTER FUNCTION public.team_hub_card_binding(uuid,text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.team_hub_card_binding(uuid,text[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_card_binding(uuid,text[]) TO authenticated;
COMMIT;
