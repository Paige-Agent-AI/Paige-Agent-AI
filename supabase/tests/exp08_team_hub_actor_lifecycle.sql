-- Isolated source integration only. Resolver/claims/tables are explicit ports, not Supabase Auth/RLS.
-- The runner loads the ORIGINAL active/participation/refusal implementations before the candidate.
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('proof.current_tenant',true),'')::uuid $$;
CREATE FUNCTION proof.actor_cases() RETURNS TABLE(case_name text,passed boolean,detail text) LANGUAGE plpgsql AS $$
DECLARE n text; expected text; actual text; target uuid;
BEGIN
 FOREACH n IN ARRAY ARRAY['active_owner','active_member','no_actor','ended_membership','suspended_seat',
  'conversations_off','wrong_workspace','missing_workspace','agency_held','subaccount_held','child_held',
  'deleted_identity','missing_identity_member','foreign_expected_ended_identity','revoked_reentry'] LOOP
  PERFORM proof.reset_rows();
  PERFORM set_config('request.jwt.claim.sub','e8000000-0000-4000-8000-000000060100',false);
  PERFORM set_config('proof.current_tenant','e8000000-0000-4000-8000-000000060010',false);
  expected:=NULL;target:='e8000000-0000-4000-8000-000000060010';
  BEGIN
   CASE n
    WHEN 'active_owner' THEN NULL;
    WHEN 'active_member' THEN
     UPDATE public.tenant_members SET business_owner_id=NULL,is_owner=false,role='member' WHERE user_id='e8000000-0000-4000-8000-000000060100';
    WHEN 'no_actor' THEN PERFORM set_config('request.jwt.claim.sub','',false);expected:='not_member';
    WHEN 'ended_membership' THEN DELETE FROM public.tenant_members WHERE user_id='e8000000-0000-4000-8000-000000060100';expected:='not_member';
    WHEN 'suspended_seat' THEN UPDATE public.tenant_members SET status='suspended' WHERE user_id='e8000000-0000-4000-8000-000000060100';expected:='not_member';
    WHEN 'conversations_off' THEN UPDATE public.tenant_members SET team_hub_access=false WHERE user_id='e8000000-0000-4000-8000-000000060100';expected:='conversations_off';
    WHEN 'wrong_workspace' THEN target:='e8000000-0000-4000-8000-000000060020';expected:='scope_changed';
    WHEN 'missing_workspace' THEN PERFORM set_config('proof.current_tenant','',false);expected:='not_member';
    WHEN 'agency_held' THEN UPDATE public.tenants SET account_type='agency' WHERE id=target;expected:='unavailable';
    WHEN 'subaccount_held' THEN UPDATE public.tenants SET account_type='sub_account' WHERE id=target;expected:='unavailable';
    WHEN 'child_held' THEN UPDATE public.tenants SET parent_tenant_id='e8000000-0000-4000-8000-000000060020' WHERE id=target;expected:='unavailable';
    WHEN 'deleted_identity','missing_identity_member','foreign_expected_ended_identity','revoked_reentry' THEN
     IF n='missing_identity_member' THEN
      UPDATE public.tenant_members SET business_owner_id=NULL,is_owner=false,role='member' WHERE user_id='e8000000-0000-4000-8000-000000060100';
     END IF;
     DELETE FROM auth.users WHERE id='e8000000-0000-4000-8000-000000060100';
     IF n='foreign_expected_ended_identity' THEN target:='e8000000-0000-4000-8000-000000060020'; END IF;
     IF n='revoked_reentry' THEN
      DELETE FROM public.tenant_members WHERE user_id='e8000000-0000-4000-8000-000000060100';
      INSERT INTO auth.users VALUES ('e8000000-0000-4000-8000-000000060100');
     END IF;
     expected:='not_member';
   END CASE;
   actual:=public._team_hub_refusal(target);
   PERFORM proof.assert_true(actual IS NOT DISTINCT FROM expected,format('expected %L, got %L',expected,actual));
   case_name:=n;passed:=true;detail:=NULL;
  EXCEPTION WHEN OTHERS THEN case_name:=n;passed:=false;detail:=SQLSTATE||': '||SQLERRM; END;
  RETURN NEXT;
 END LOOP;
END $$;
