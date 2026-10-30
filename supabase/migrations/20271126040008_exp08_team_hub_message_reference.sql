-- EXP08 original A2 slice1(b): reopen an original Team Hub source by reference.
-- Read-only metadata, original active-seat/workspace/channel gates, no new record store.
-- The original list_messages reader still authorizes and returns the actual message/thread.
BEGIN;
SET LOCAL lock_timeout='2s';
-- Refuse an unknown same-name implementation; replay only this exact bounded reader.
DO $guard$ DECLARE f pg_proc; BEGIN
 SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.team_hub_message_reference(uuid,uuid)');
 IF FOUND AND (md5(f.prosrc)<>'9a1213b77cd4efd6443ebd6b02b60d45' OR NOT f.prosecdef OR f.provolatile<>'s'
   OR f.proowner<>'postgres'::regrole OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
     WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE')) THEN
  RAISE EXCEPTION 'EXP08 message reference prerequisite drift';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.team_hub_message_reference(p_expected_tenant uuid,p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE refusal text:=public._team_hub_refusal(p_expected_tenant); m public.team_hub_messages;
 root public.team_hub_messages; boundary bytea; i int; before_id uuid; before_at timestamptz;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 IF p_message_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO m FROM public.team_hub_messages x WHERE x.id=p_message_id
  AND x.tenant_id=p_expected_tenant AND x.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 PERFORM 1 FROM public._team_hub_visible(p_expected_tenant,auth.uid(),m.channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 SELECT * INTO root FROM public.team_hub_messages x WHERE x.id=coalesce(m.parent_message_id,m.id)
  AND x.tenant_id=p_expected_tenant AND x.channel_id=m.channel_id AND x.parent_message_id IS NULL
  AND x.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 -- Strict keyset reads exclude their boundary. Use the immediate UUID successor at the SAME
 -- native timestamp so the target is included even among many rows sharing a microsecond.
 -- These are cursor bytes, never a fabricated message or a new identity.
 before_at:=m.created_at; before_id:=m.id;
 IF m.parent_message_id IS NOT NULL THEN
  IF m.id='ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid THEN
   before_at:=m.created_at+interval '1 microsecond';
  ELSE
   boundary:=uuid_send(m.id);
   FOR i IN REVERSE 15..0 LOOP
    IF get_byte(boundary,i)<255 THEN boundary:=set_byte(boundary,i,get_byte(boundary,i)+1); EXIT; END IF;
    boundary:=set_byte(boundary,i,0);
   END LOOP;
   before_id:=encode(boundary,'hex')::uuid;
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'channel_id',m.channel_id,'thread_root_id',root.id,'message_id',m.id,
  'cursor',CASE WHEN m.parent_message_id IS NULL THEN NULL ELSE
   jsonb_build_object('created_at',before_at,'id',before_id) END);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_message_reference(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_message_reference(uuid,uuid) TO authenticated;
COMMIT;
