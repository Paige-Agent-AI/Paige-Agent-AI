-- DISPOSABLE component ports only, not Auth SDK/RLS/customer proof.
ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz, ADD COLUMN banned_until timestamptz;
ALTER TABLE public.tenant_members ADD COLUMN responsibilities text;
CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
CREATE TABLE public.audit_logs(user_id uuid,entity text,action text,entity_id uuid,data jsonb);
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT p.active_tenant_id FROM public.profiles p JOIN public.tenant_members m ON m.tenant_id=p.active_tenant_id
 AND m.user_id=p.user_id AND m.status='active' WHERE p.user_id=auth.uid() $$;
CREATE FUNCTION public.is_tenant_admin(t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=t AND user_id=auth.uid()
 AND status='active' AND (is_owner OR role IN ('owner','admin'))) $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
GRANT SELECT ON public.profiles,public.tenant_members TO authenticated;
CREATE FUNCTION proof.work_profile_cases() RETURNS TABLE(case_name text,passed boolean,detail text) LANGUAGE plpgsql AS $$
DECLARE n text; actor uuid; target uuid; expected boolean; succeeded boolean; result jsonb; err text;
 t uuid:='e8000000-0000-4000-8000-000000060010';
 holder uuid:='e8000000-0000-4000-8000-000000060100'; other uuid:='e8000000-0000-4000-8000-000000060300';
 before_rows jsonb; before_audit integer;
BEGIN
 FOREACH n IN ARRAY ARRAY['admin edits holder','coowner edits holder','holder edits coowner','owner edits self',
 'holder edits self','admin edits member','coowner edits admin','admin edits suspended owner','admin edits role-only owner',
 'member edits holder','missing target','foreign target','suspended actor','deleted actor','banned actor','unauthenticated',
 'title limit','responsibility limit','trim and null'] LOOP
  PERFORM proof.reset_rows(); TRUNCATE public.profiles,public.audit_logs;
  UPDATE public.tenants SET owner_user_id=holder WHERE id=t;
  INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role,status) VALUES
   ('e8000000-0000-4000-8000-000000061003',t,other,false,'admin','active');
  INSERT INTO public.profiles VALUES(holder,t),(other,t);
  actor:=other;target:=holder;expected:=false;
  IF n IN ('coowner edits holder','owner edits self','coowner edits admin','holder edits coowner') THEN
   UPDATE public.tenant_members SET is_owner=true,role='owner' WHERE user_id=other;
  END IF;
  CASE n
   WHEN 'holder edits coowner' THEN actor:=holder;target:=other;expected:=true;
   WHEN 'owner edits self' THEN target:=other;expected:=true;
   WHEN 'holder edits self' THEN actor:=holder;expected:=true;
   WHEN 'admin edits member' THEN UPDATE public.tenant_members SET is_owner=false,role='member',business_owner_id=NULL WHERE user_id=holder;expected:=true;
   WHEN 'coowner edits admin' THEN UPDATE public.tenant_members SET is_owner=false,role='admin',business_owner_id=NULL WHERE user_id=holder;expected:=true;
   WHEN 'admin edits suspended owner' THEN UPDATE public.tenant_members SET status='suspended' WHERE user_id=holder;
   WHEN 'admin edits role-only owner' THEN UPDATE public.tenant_members SET is_owner=false,business_owner_id=NULL WHERE user_id=holder;
   WHEN 'member edits holder' THEN UPDATE public.tenant_members SET role='member' WHERE user_id=other;
   WHEN 'missing target' THEN target:='e8000000-0000-4000-8000-000000069999';
   WHEN 'foreign target' THEN target:='e8000000-0000-4000-8000-000000060200';
   WHEN 'suspended actor' THEN UPDATE public.tenant_members SET status='suspended' WHERE user_id=actor;
   WHEN 'deleted actor' THEN UPDATE auth.users SET deleted_at=now() WHERE id=actor;
   WHEN 'banned actor' THEN UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=actor;
   WHEN 'unauthenticated' THEN actor:=NULL;
   WHEN 'trim and null' THEN actor:=holder;expected:=true;
   ELSE NULL;
  END CASE;
  -- Isolate identity admission from the independent owner-edit refusal: without the
  -- identity gate these Admin-to-Member writes would otherwise be permitted.
  IF n IN ('deleted actor','banned actor') THEN
   UPDATE public.tenant_members SET is_owner=false,role='member',business_owner_id=NULL WHERE user_id=target;
  END IF;
  PERFORM set_config('request.jwt.claim.sub',coalesce(actor::text,''),true);
  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_rows FROM public.tenant_members m;
  SELECT count(*) INTO before_audit FROM public.audit_logs;
  succeeded:=false;err:='';
  BEGIN
   SET LOCAL ROLE authenticated;
   result:=public.set_solo_team_member_work_profile(target,CASE WHEN n='title limit' THEN repeat('x',121) ELSE '  Team lead  ' END,
     CASE WHEN n='responsibility limit' THEN repeat('x',2001) WHEN n='trim and null' THEN '   ' ELSE '  Coordinate delivery  ' END);
   succeeded:=true;
  EXCEPTION WHEN OTHERS THEN err:=SQLSTATE||'/'||SQLERRM;
  END;
  RESET ROLE;
  IF succeeded THEN
   RETURN QUERY SELECT n,expected AND result->>'job_title'='Team lead'
     AND (SELECT count(*)=before_audit+1 FROM public.audit_logs)
     AND (n<>'trim and null' OR result->>'responsibilities' IS NULL), 'accepted';
  ELSE
   RETURN QUERY SELECT n,NOT expected
    AND CASE WHEN n IN ('admin edits holder','coowner edits holder','admin edits suspended owner','admin edits role-only owner')
      THEN err LIKE '42501/TEAM_OWNER_PROFILE_FORBIDDEN:%'
      WHEN n IN ('deleted actor','banned actor') THEN err LIKE '42501/TEAM_MEMBER_IDENTITY_UNAVAILABLE:%'
      ELSE true END
    AND before_rows=(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tenant_members m)
    AND (SELECT count(*)=before_audit FROM public.audit_logs),err;
  END IF;
 END LOOP;
END $$;
