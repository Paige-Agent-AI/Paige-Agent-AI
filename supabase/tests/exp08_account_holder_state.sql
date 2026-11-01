-- Extends the ORIGINAL isolated lifecycle fixture; real owner/holder helpers are loaded by its runner.
-- Auth identity/claims, company predicate and minimal table shapes remain explicit local ports.
ALTER TABLE public.tenants ADD COLUMN archived_at timestamptz;
CREATE FUNCTION proof.holder_state_cases() RETURNS TABLE(case_name text,passed boolean,detail text)
LANGUAGE plpgsql AS $$
DECLARE n text; expected text; actual text; target uuid;
BEGIN
 FOREACH n IN ARRAY ARRAY['working','paused','billing_resume','pointer_missing','identity_deleted',
  'archived_working','archived_deleted_identity','archived_without_pointer','seat_missing','seat_demoted',
  'owner_label_only','other_person_owner','other_person_paused_owner','foreign_owner_seat','foreign_paused_seat','paused_member',
  'archived_seat_without_archive','reentry_owner','missing_tenant','null_tenant'] LOOP
  PERFORM proof.reset_rows();
  target:='e8000000-0000-4000-8000-000000060010';expected:='working';
  UPDATE public.tenants SET owner_user_id='e8000000-0000-4000-8000-000000060100' WHERE id=target;
  PERFORM set_config('request.jwt.claim.sub','e8000000-0000-4000-8000-000000060100',false);
  BEGIN
   CASE n
    WHEN 'working' THEN NULL;
    WHEN 'paused' THEN UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=target;expected:='paused';
    WHEN 'billing_resume' THEN
     UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=target;
     UPDATE public.tenant_members SET status='active' WHERE tenant_id=target;
    WHEN 'pointer_missing' THEN UPDATE public.tenants SET owner_user_id=NULL WHERE id=target;expected:='none';
    WHEN 'identity_deleted' THEN DELETE FROM auth.users WHERE id='e8000000-0000-4000-8000-000000060100';expected:='none';
    WHEN 'archived_working','archived_deleted_identity','archived_without_pointer' THEN
     UPDATE public.tenants SET archived_at=now() WHERE id=target;expected:='archived';
     IF n='archived_deleted_identity' THEN DELETE FROM auth.users WHERE id='e8000000-0000-4000-8000-000000060100'; END IF;
     IF n='archived_without_pointer' THEN UPDATE public.tenants SET owner_user_id=NULL WHERE id=target; END IF;
    WHEN 'seat_missing' THEN DELETE FROM public.tenant_members WHERE tenant_id=target;expected:='none';
    WHEN 'seat_demoted','owner_label_only','paused_member' THEN
     UPDATE public.tenant_members SET business_owner_id=NULL,is_owner=false,
      role=CASE WHEN n='owner_label_only' THEN 'owner'::public.tenant_role ELSE 'admin'::public.tenant_role END,
      status=CASE WHEN n='paused_member' THEN 'suspended' ELSE 'active' END WHERE tenant_id=target;
     expected:='none';
    WHEN 'other_person_owner','other_person_paused_owner' THEN
     UPDATE public.tenants SET owner_user_id='e8000000-0000-4000-8000-000000060300' WHERE id=target;expected:='none';
     IF n='other_person_paused_owner' THEN UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=target; END IF;
    WHEN 'foreign_owner_seat','foreign_paused_seat' THEN
     DELETE FROM public.tenant_members WHERE tenant_id=target;
     INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role,status) VALUES
      ('e8000000-0000-4000-8000-000000061003','e8000000-0000-4000-8000-000000060020',
       'e8000000-0000-4000-8000-000000060100',true,'owner',CASE WHEN n='foreign_paused_seat' THEN 'suspended' ELSE 'active' END);
     expected:='none';
    WHEN 'archived_seat_without_archive' THEN UPDATE public.tenant_members SET status='archived' WHERE tenant_id=target;expected:='none';
    WHEN 'reentry_owner' THEN
     DELETE FROM public.tenant_members WHERE tenant_id=target;
     INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role) VALUES
      ('e8000000-0000-4000-8000-000000061003',target,'e8000000-0000-4000-8000-000000060100',true,'owner');
    WHEN 'missing_tenant' THEN target:='e8000000-0000-4000-8000-000000060099';expected:=NULL;
    WHEN 'null_tenant' THEN target:=NULL;expected:=NULL;
   END CASE;
   actual:=public._tenant_account_holder_state(target);
   PERFORM proof.assert_true(actual IS NOT DISTINCT FROM expected,format('expected %L, got %L',expected,actual));
   case_name:=n;passed:=true;detail:=NULL;
  EXCEPTION WHEN OTHERS THEN case_name:=n;passed:=false;detail:=SQLSTATE||': '||SQLERRM; END;
  RETURN NEXT;
 END LOOP;
END $$;
