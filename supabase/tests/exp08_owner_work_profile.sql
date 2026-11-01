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
CREATE FUNCTION proof.work_profile_cases(_scoped boolean DEFAULT false) RETURNS TABLE(case_name text,passed boolean,detail text) LANGUAGE plpgsql AS $$
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
   IF _scoped THEN
    result:=public.set_solo_team_member_work_profile(target,CASE WHEN n='title limit' THEN repeat('x',121) ELSE '  Team lead  ' END,
      CASE WHEN n='responsibility limit' THEN repeat('x',2001) WHEN n='trim and null' THEN '   ' ELSE '  Coordinate delivery  ' END,t,(SELECT id FROM public.tenant_members WHERE tenant_id=t AND user_id=target));
   ELSE
   result:=public.set_solo_team_member_work_profile(target,CASE WHEN n='title limit' THEN repeat('x',121) ELSE '  Team lead  ' END,
     CASE WHEN n='responsibility limit' THEN repeat('x',2001) WHEN n='trim and null' THEN '   ' ELSE '  Coordinate delivery  ' END);
   END IF;
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


CREATE FUNCTION proof.work_profile_scope_cases(_scoped boolean) RETURNS TABLE(case_name text,passed boolean,detail text) LANGUAGE plpgsql AS $$
DECLARE n text; a uuid:='e8000000-0000-4000-8000-000000060010';b uuid:='e8000000-0000-4000-8000-000000060020';
 actor uuid:='e8000000-0000-4000-8000-000000060300';target uuid:='e8000000-0000-4000-8000-000000060100';
 expected uuid; expected_member uuid; result jsonb; succeeded boolean; err text; before_rows jsonb;
BEGIN
 FOREACH n IN ARRAY ARRAY['same person in both workspaces','caller cannot select another workspace','missing expected workspace','membership replaced','missing captured membership','caller cannot select another membership','permitted captured workspace'] LOOP
  PERFORM proof.reset_rows();TRUNCATE public.profiles,public.audit_logs;
  UPDATE public.tenant_members SET is_owner=false,role='member',business_owner_id=NULL WHERE tenant_id=a AND user_id=target;
  INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role,status) VALUES
   ('e8000000-0000-4000-8000-000000061004',a,actor,false,'admin','active'),
   ('e8000000-0000-4000-8000-000000061005',b,target,false,'member','active'),
   ('e8000000-0000-4000-8000-000000061006',b,actor,false,'admin','active');
  INSERT INTO public.profiles VALUES(actor,CASE WHEN n='same person in both workspaces' THEN b ELSE a END);
  expected:=CASE WHEN n='caller cannot select another workspace' THEN b WHEN n='missing expected workspace' THEN NULL ELSE a END;
  expected_member:=CASE WHEN n='missing captured membership' THEN NULL WHEN n='caller cannot select another membership' THEN 'e8000000-0000-4000-8000-000000061005'::uuid ELSE 'e8000000-0000-4000-8000-000000061001'::uuid END;
  IF n='membership replaced' THEN
   DELETE FROM public.tenant_members WHERE tenant_id=a AND user_id=target;
   INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role,status) VALUES('e8000000-0000-4000-8000-000000061007',a,target,false,'member','active');
  END IF;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_rows FROM public.tenant_members m;
  succeeded:=false;err:='';
  BEGIN
   SET LOCAL ROLE authenticated;
   IF _scoped THEN result:=public.set_solo_team_member_work_profile(target,'Captured team title','Same original work details',expected,expected_member);
   ELSE result:=public.set_solo_team_member_work_profile(target,'Captured team title','Same original work details');END IF;
   succeeded:=true;
  EXCEPTION WHEN OTHERS THEN err:=SQLSTATE||'/'||SQLERRM;
  END;
  RESET ROLE;
  IF n='permitted captured workspace' THEN
   RETURN QUERY SELECT n,succeeded AND result->>'membership_id'='e8000000-0000-4000-8000-000000061001'
    AND EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=a AND user_id=target AND job_title='Captured team title')
    AND EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=b AND user_id=target AND job_title IS NULL)
    AND (SELECT count(*)=1 AND bool_and(data->>'tenant_id'=a::text) FROM public.audit_logs),coalesce(result::text,err);
  ELSE
   RETURN QUERY SELECT n,NOT succeeded AND CASE WHEN n IN ('membership replaced','missing captured membership','caller cannot select another membership') THEN err LIKE '42501/this team membership changed%' ELSE err LIKE '42501/your active workspace changed%' END
    AND before_rows=(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tenant_members m)
    AND (SELECT count(*)=0 FROM public.audit_logs),CASE WHEN succeeded THEN 'legacy call wrote to its then-current workspace' ELSE err END;
  END IF;
 END LOOP;
END $$;

-- Lost-response retries are state reconciliation, not another independent personnel event.
CREATE FUNCTION proof.work_profile_recovery_cases() RETURNS TABLE(case_name text,passed boolean,detail text) LANGUAGE plpgsql AS $$
DECLARE actor uuid:='e8000000-0000-4000-8000-000000060300'; target uuid:='e8000000-0000-4000-8000-000000060100';
 t uuid:='e8000000-0000-4000-8000-000000060010'; seat uuid:='e8000000-0000-4000-8000-000000061001'; r jsonb; first_receipt jsonb; refused boolean;
BEGIN
 PERFORM proof.reset_rows(); TRUNCATE public.profiles,public.audit_logs;
 UPDATE public.tenants SET owner_user_id=target WHERE id=t;
 UPDATE public.tenant_members SET is_owner=false,role='member',business_owner_id=NULL WHERE user_id=target;
 INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role,status) VALUES('e8000000-0000-4000-8000-000000061003',t,actor,false,'admin','active');
 INSERT INTO public.profiles VALUES(actor,t),(target,t);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 first_receipt:=public.set_solo_team_member_work_profile(target,' Recovery lead ',' Coordinate ',t,seat);
 r:=public.set_solo_team_member_work_profile(target,'Recovery lead','Coordinate');
 r:=public.set_solo_team_member_work_profile(target,' Recovery lead ',' Coordinate ',t,seat);
 RESET ROLE;
 RETURN QUERY SELECT 'same normalized lost-response retry',r=first_receipt AND (SELECT count(*)=1 FROM public.audit_logs),'original persisted values and audit read back';
 SET LOCAL ROLE authenticated;
 r:=public.set_solo_team_member_work_profile(target,'Recovery lead','Changed scope',t,seat);
 RESET ROLE;
 RETURN QUERY SELECT 'different authorized details still save',r->>'responsibilities'='Changed scope' AND (SELECT count(*)=2 FROM public.audit_logs),'original effect writer audit';
 UPDATE public.tenant_members SET is_owner=true,role='owner' WHERE user_id=target;
 refused:=false;
 BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM public.set_solo_team_member_work_profile(target,'Recovery lead','Changed scope',t,seat);
 EXCEPTION WHEN SQLSTATE '42501' THEN refused:=SQLERRM LIKE 'TEAM_OWNER_PROFILE_FORBIDDEN:%';
 END;
 RESET ROLE;
 RETURN QUERY SELECT 'same values cannot bypass owner authority',refused AND (SELECT count(*)=2 FROM public.audit_logs),'owner restriction checked before current-value receipt';
 refused:=false;
 BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM public.set_solo_team_member_work_profile('e8000000-0000-4000-8000-000000069999','','');
 EXCEPTION WHEN OTHERS THEN refused:=SQLERRM='team member not found in this workspace';
 END;
 RESET ROLE;
 RETURN QUERY SELECT 'empty missing target is not an unchanged receipt',refused AND (SELECT count(*)=2 FROM public.audit_logs),'original missing-member refusal preserved';
END $$;
