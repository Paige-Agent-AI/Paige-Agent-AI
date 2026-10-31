-- Original local lifecycle fixture; real incumbent helpers, explicit minimal Auth/claims/table ports.
ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz, ADD COLUMN banned_until timestamptz;
CREATE FUNCTION proof.identity_cases() RETURNS TABLE(case_name text,passed boolean,detail text)
LANGUAGE plpgsql AS $$
DECLARE n text; target uuid; person uuid; selected uuid[]; want_active boolean; want_part boolean; want_hold boolean;
 actual_active boolean; actual_part boolean; actual_hold boolean;
BEGIN
 FOREACH n IN ARRAY ARRAY['active_actor','active_target','deleted_actor','deleted_target','soft_deleted_actor',
  'soft_deleted_target','banned_actor','banned_target','expired_ban','ban_ends_now','indefinite_ban',
  'other_person_banned','foreign_person','wrong_tenant','ended_seat','suspended_seat','conversations_off',
  'mixed_foreign_selection','mixed_banned_selection','duplicate_selection','empty_selection','null_selection'] LOOP
  PERFORM proof.reset_rows();
  PERFORM set_config('request.jwt.claim.sub','e8000000-0000-4000-8000-000000060100',false);
  target:='e8000000-0000-4000-8000-000000060010';person:='e8000000-0000-4000-8000-000000060100';
  want_active:=true;want_part:=true;want_hold:=true;
  BEGIN
   IF n IN ('active_target','deleted_target','soft_deleted_target','banned_target','mixed_banned_selection') THEN
    INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role) VALUES
     ('e8000000-0000-4000-8000-000000061003',target,'e8000000-0000-4000-8000-000000060300',false,'member');
    IF n<>'mixed_banned_selection' THEN person:='e8000000-0000-4000-8000-000000060300'; END IF;
   END IF;
   selected:=ARRAY[person];
   CASE n
    WHEN 'active_actor','active_target' THEN NULL;
    WHEN 'deleted_actor','deleted_target' THEN DELETE FROM auth.users WHERE id=person;want_active:=false;
    WHEN 'soft_deleted_actor','soft_deleted_target' THEN UPDATE auth.users SET deleted_at=now() WHERE id=person;want_active:=false;
    WHEN 'banned_actor','banned_target' THEN UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=person;want_active:=false;
    WHEN 'expired_ban' THEN UPDATE auth.users SET banned_until=now()-interval '1 second' WHERE id=person;
    WHEN 'ban_ends_now' THEN UPDATE auth.users SET banned_until=now() WHERE id=person;
    WHEN 'indefinite_ban' THEN UPDATE auth.users SET banned_until='infinity'::timestamptz WHERE id=person;want_active:=false;
    WHEN 'other_person_banned' THEN UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='e8000000-0000-4000-8000-000000060300';
    WHEN 'foreign_person' THEN person:='e8000000-0000-4000-8000-000000060200';selected:=ARRAY[person];want_active:=false;
    WHEN 'wrong_tenant' THEN target:='e8000000-0000-4000-8000-000000060020';want_active:=false;
    WHEN 'ended_seat' THEN DELETE FROM public.tenant_members WHERE tenant_id=target AND user_id=person;want_active:=false;
    WHEN 'suspended_seat' THEN UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=target AND user_id=person;want_active:=false;
    WHEN 'conversations_off' THEN UPDATE public.tenant_members SET team_hub_access=false WHERE tenant_id=target AND user_id=person;want_part:=false;want_hold:=false;
    WHEN 'mixed_foreign_selection' THEN selected:=ARRAY[person,'e8000000-0000-4000-8000-000000060200'::uuid];want_hold:=false;
    WHEN 'mixed_banned_selection' THEN
     UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='e8000000-0000-4000-8000-000000060300';
     selected:=ARRAY[person,'e8000000-0000-4000-8000-000000060300'::uuid];want_hold:=false;
    WHEN 'duplicate_selection' THEN selected:=ARRAY[person,person];
    WHEN 'empty_selection' THEN selected:=ARRAY[]::uuid[];
    WHEN 'null_selection' THEN selected:=NULL;
   END CASE;
   IF NOT want_active THEN want_part:=false;want_hold:=false; END IF;
   actual_active:=public._team_hub_is_active(target,person);
   actual_part:=public._team_hub_participates(target,person);
   actual_hold:=public._team_hub_hold_seats(target,selected);
   PERFORM proof.assert_true(actual_active IS NOT DISTINCT FROM want_active
    AND actual_part IS NOT DISTINCT FROM want_part AND actual_hold IS NOT DISTINCT FROM want_hold,
    format('expected active/participates/held %s/%s/%s; got %s/%s/%s',want_active,want_part,want_hold,actual_active,actual_part,actual_hold));
   case_name:=n;passed:=true;detail:=NULL;
  EXCEPTION WHEN OTHERS THEN case_name:=n;passed:=false;detail:=SQLSTATE||': '||SQLERRM; END;
  RETURN NEXT;
 END LOOP;
END $$;
