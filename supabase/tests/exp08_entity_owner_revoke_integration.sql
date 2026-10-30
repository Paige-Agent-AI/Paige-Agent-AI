-- Loaded only into the runner's own disposable DB after REAL original helpers/revoke.
CREATE FUNCTION proof.revoke_setup() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM proof.reset_rows();
 TRUNCATE public.paige_audit_log;
 UPDATE public.tenants SET owner_user_id='e8000000-0000-4000-8000-000000060300'
  WHERE id='e8000000-0000-4000-8000-000000060010';
 INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role) VALUES
  ('e8000000-0000-4000-8000-000000061003','e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060300',true,'owner');
 PERFORM set_config('request.jwt.claim.sub','e8000000-0000-4000-8000-000000060300',false);
END $$;

CREATE FUNCTION proof.revoke_cases() RETURNS TABLE(case_name text,passed boolean,detail text) LANGUAGE plpgsql AS $$
DECLARE n text; old_other jsonb; refused boolean; refused_reason text;
BEGIN
 FOREACH n IN ARRAY ARRAY['holder_demotes_entity','entity_steps_down','person_demotes',
  'holder_refused','ordinary_member_refused','foreign_target_refused','last_owner_refused',
  'billing_paused_holder_refused','replacement_preserved','unsupported_tier_unchanged','repeat_refused'] LOOP
  PERFORM proof.revoke_setup();
  SELECT to_jsonb(b) INTO old_other FROM public.tenant_business_owners b
   WHERE id='e8000000-0000-4000-8000-000000060002';
  BEGIN
   IF n='entity_steps_down' THEN
    PERFORM set_config('request.jwt.claim.sub','e8000000-0000-4000-8000-000000060100',false);
   ELSIF n='person_demotes' THEN
    UPDATE public.tenant_members SET business_owner_id=NULL WHERE user_id='e8000000-0000-4000-8000-000000060100';
   ELSIF n='ordinary_member_refused' THEN
    UPDATE public.tenant_members SET is_owner=false,role='member' WHERE user_id='e8000000-0000-4000-8000-000000060300';
    -- Keep two other owners so the floor cannot accidentally mask a broken authority gate.
    INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role) VALUES
     ('e8000000-0000-4000-8000-000000061004','e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060200',true,'owner');
   ELSIF n='last_owner_refused' THEN
    UPDATE public.tenants SET owner_user_id=NULL WHERE id='e8000000-0000-4000-8000-000000060010';
    DELETE FROM public.tenant_members WHERE user_id='e8000000-0000-4000-8000-000000060300';
    PERFORM set_config('request.jwt.claim.sub','e8000000-0000-4000-8000-000000060100',false);
   ELSIF n='billing_paused_holder_refused' THEN
    UPDATE public.tenant_members SET status='suspended' WHERE user_id='e8000000-0000-4000-8000-000000060300';
   ELSIF n='replacement_preserved' THEN
    UPDATE public.tenant_business_owners SET representative_user_id='e8000000-0000-4000-8000-000000060300'
     WHERE id='e8000000-0000-4000-8000-000000060001';
   ELSIF n='unsupported_tier_unchanged' THEN
    UPDATE public.tenants SET account_type='agency' WHERE id='e8000000-0000-4000-8000-000000060010';
   END IF;
   refused:=false;refused_reason:=NULL;
   BEGIN
    PERFORM public.revoke_co_owner('e8000000-0000-4000-8000-000000060010',
     CASE n WHEN 'holder_refused' THEN 'e8000000-0000-4000-8000-000000060300'::uuid
      WHEN 'foreign_target_refused' THEN 'e8000000-0000-4000-8000-000000060200'::uuid
      ELSE 'e8000000-0000-4000-8000-000000060100'::uuid END);
   EXCEPTION WHEN insufficient_privilege OR check_violation THEN refused:=true;refused_reason:=SQLSTATE||': '||SQLERRM; END;
   IF n IN ('holder_refused','ordinary_member_refused','foreign_target_refused','last_owner_refused',
     'billing_paused_holder_refused','unsupported_tier_unchanged') THEN
    PERFORM proof.assert_true(refused AND NOT EXISTS(SELECT 1 FROM public.paige_audit_log),'refusal must have no audit/effect');
   ELSE
    PERFORM proof.assert_true(NOT refused,'original revoke must complete: '||coalesce(refused_reason,''));
    PERFORM proof.assert_true(EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id='e8000000-0000-4000-8000-000000060100'
     AND tenant_id='e8000000-0000-4000-8000-000000060010' AND NOT is_owner AND role='admin' AND business_owner_id IS NULL),'same original seat becomes admin and unlinks');
    PERFORM proof.assert_true((SELECT count(*)=1 FROM public.paige_audit_log WHERE action='tenant:revoke_co_owner'
     AND tenant_id='e8000000-0000-4000-8000-000000060010'
     AND actor_user_id=auth.uid() AND target_id='e8000000-0000-4000-8000-000000060100'),'one original audit');
    IF n<>'person_demotes' THEN
     PERFORM proof.assert_true(EXISTS(SELECT 1 FROM public.tenant_business_owners WHERE id='e8000000-0000-4000-8000-000000060001'
      AND CASE WHEN n='replacement_preserved' THEN representative_user_id='e8000000-0000-4000-8000-000000060300' AND owner_seat_vacant_since IS NULL
       ELSE representative_user_id IS NULL AND owner_seat_vacant_since IS NOT NULL END),'held vacancy or actual replacement preserved');
    END IF;
    IF n='repeat_refused' THEN
     refused:=false;
     BEGIN
      PERFORM public.revoke_co_owner('e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060100');
     EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
     PERFORM proof.assert_true(refused AND (SELECT count(*)=1 FROM public.paige_audit_log),'repeat does not add another audit/effect');
    END IF;
   END IF;
   PERFORM proof.assert_true(old_other=(SELECT to_jsonb(b) FROM public.tenant_business_owners b WHERE id='e8000000-0000-4000-8000-000000060002'),'other tenant legal owner unchanged');
   case_name:=n;passed:=true;detail:=NULL;
  EXCEPTION WHEN OTHERS THEN case_name:=n;passed:=false;detail:=SQLSTATE||': '||SQLERRM; END;
  RETURN NEXT;
 END LOOP;
END $$;
