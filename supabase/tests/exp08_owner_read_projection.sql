-- Extends the ORIGINAL disposable lifecycle fixture. Real original readers/helpers are loaded
-- by its runner. Claims/resolver, minimal tables and provider delivery rank are explicit ports.
ALTER TABLE public.tenants ADD COLUMN name text DEFAULT 'Test workspace';
ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN last_sign_in_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS banned_until timestamptz;
ALTER TABLE public.tenant_members ADD COLUMN responsibilities text;
ALTER TABLE public.tenant_business_owners ADD COLUMN display_name text,
 ADD COLUMN ownership_interest numeric DEFAULT 73;
CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,full_name text,avatar_url text);
CREATE TABLE public.tenant_invite_tokens(id uuid PRIMARY KEY,tenant_id uuid,email text,
 default_role public.tenant_role,created_at timestamptz DEFAULT now(),expires_at timestamptz,
 revoked_at timestamptz,uses integer DEFAULT 0,kind text DEFAULT 'team',archived_at timestamptz,
 business_owner_id uuid,job_title text,responsibilities text,created_by uuid);
CREATE TABLE public.email_send_log(status text,created_at timestamptz,error_message text,metadata jsonb);
CREATE FUNCTION public.email_delivery_rank(text) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE TABLE public.platform_billing_contacts(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,revoked_at timestamptz);

CREATE FUNCTION proof.owner_read_setup(actor text DEFAULT 'holder') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 TRUNCATE public.tenant_invite_tokens,public.email_send_log,public.platform_billing_contacts,public.profiles;
 PERFORM proof.reset_rows();
 UPDATE public.tenants SET owner_user_id='e8000000-0000-4000-8000-000000060100'
  WHERE id='e8000000-0000-4000-8000-000000060010';
 UPDATE auth.users SET email='person@tests.invalid';
 INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role) VALUES
 ('e8000000-0000-4000-8000-000000061003','e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060300',false,
 CASE actor WHEN 'admin' THEN 'admin'::public.tenant_role WHEN 'coowner' THEN 'owner'::public.tenant_role WHEN 'owner_label_only' THEN 'owner'::public.tenant_role ELSE 'member'::public.tenant_role END);
 IF actor='coowner' THEN UPDATE public.tenant_members SET is_owner=true WHERE user_id='e8000000-0000-4000-8000-000000060300'; END IF;
 INSERT INTO public.tenant_business_owners(id,tenant_id,owner_kind,legal_name,display_name,owner_seat_vacant_since) VALUES
 ('e8000000-0000-4000-8000-000000060003','e8000000-0000-4000-8000-000000060010','trust','Test held legal entity','Test held entity',now()-interval '1 day'),
 ('e8000000-0000-4000-8000-000000060004','e8000000-0000-4000-8000-000000060010','company','Test pending entity',NULL,NULL),
 ('e8000000-0000-4000-8000-000000060005','e8000000-0000-4000-8000-000000060010','individual','Test individual',NULL,now()-interval '1 day');
 INSERT INTO public.tenant_invite_tokens(id,tenant_id,email,default_role,expires_at,business_owner_id,created_by) VALUES
 ('e8000000-0000-4000-8000-000000062001','e8000000-0000-4000-8000-000000060010','invite@tests.invalid','owner',now()+interval '1 day','e8000000-0000-4000-8000-000000060004','e8000000-0000-4000-8000-000000060100'),
 ('e8000000-0000-4000-8000-000000062002','e8000000-0000-4000-8000-000000060020','foreign@tests.invalid','owner',now()+interval '1 day','e8000000-0000-4000-8000-000000060002','e8000000-0000-4000-8000-000000060200');
 INSERT INTO public.platform_billing_contacts(tenant_id,user_id) VALUES
 ('e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060100'),
 ('e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060300');
 PERFORM set_config('proof.current_tenant','e8000000-0000-4000-8000-000000060010',false);
 PERFORM set_config('request.jwt.claim.sub',CASE WHEN actor='holder' THEN 'e8000000-0000-4000-8000-000000060100' ELSE 'e8000000-0000-4000-8000-000000060300' END,false);
END $$;

CREATE FUNCTION proof.owner_read_cases(only_cases text[] DEFAULT NULL) RETURNS TABLE(case_name text,passed boolean,detail text) LANGUAGE plpgsql AS $$
DECLARE n text; actor text; w jsonb; c jsonb; member jsonb; holder jsonb; expected_state text;
BEGIN
 FOREACH n IN ARRAY ARRAY['holder','admin','coowner','member','owner_label_only','holder_missing','holder_paused','holder_archived',
 'self_billing','other_billing_private','revoked_billing','foreign_billing','entity_label','private_legal_fields',
 'held_seat','holder_options','options_private','pending_option','expired_option','individual_excluded',
 'foreign_entity_excluded','search_paging','invitations_preserved','conversations_off','suspended_viewer','no_actor','no_workspace',
 'missing_identity','soft_deleted_identity','banned_identity','expired_ban','unsupported_tier'] LOOP
  IF only_cases IS NOT NULL AND NOT(n=ANY(only_cases)) THEN CONTINUE; END IF;
  actor:=CASE WHEN n IN ('admin','coowner','member','owner_label_only') THEN n WHEN n IN ('self_billing','other_billing_private','options_private','holder_missing','holder_paused','holder_archived') THEN 'admin' ELSE 'holder' END;
  PERFORM proof.owner_read_setup(actor);expected_state:='working';
  BEGIN
   IF n='holder_missing' THEN UPDATE public.tenants SET owner_user_id=NULL;expected_state:='none'; END IF;
   IF n='holder_paused' THEN UPDATE public.tenant_members SET status='suspended' WHERE user_id='e8000000-0000-4000-8000-000000060100';expected_state:='paused'; END IF;
   IF n='holder_archived' THEN UPDATE public.tenants SET archived_at=now();expected_state:='archived'; END IF;
   IF n='revoked_billing' THEN UPDATE public.platform_billing_contacts SET revoked_at=now(); END IF;
   IF n='foreign_billing' THEN UPDATE public.platform_billing_contacts SET tenant_id='e8000000-0000-4000-8000-000000060020'; END IF;
   IF n='expired_option' THEN UPDATE public.tenant_invite_tokens SET expires_at=now()-interval '1 second'; END IF;
   IF n='conversations_off' THEN UPDATE public.tenant_members SET team_hub_access=false WHERE user_id=auth.uid(); END IF;
   IF n='suspended_viewer' THEN UPDATE public.tenant_members SET status='suspended' WHERE user_id=auth.uid(); END IF;
   IF n='no_actor' THEN PERFORM set_config('request.jwt.claim.sub','',false); END IF;
   IF n='no_workspace' THEN PERFORM set_config('proof.current_tenant','',false); END IF;
   IF n='missing_identity' THEN DELETE FROM auth.users WHERE id=auth.uid(); END IF;
   IF n='soft_deleted_identity' THEN UPDATE auth.users SET deleted_at=now() WHERE id=auth.uid(); END IF;
   IF n='banned_identity' THEN UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=auth.uid(); END IF;
   IF n='expired_ban' THEN UPDATE auth.users SET banned_until=now()-interval '1 second' WHERE id=auth.uid(); END IF;
   IF n='unsupported_tier' THEN UPDATE public.tenants SET account_type='agency' WHERE id='e8000000-0000-4000-8000-000000060010'; END IF;
   IF n IN ('suspended_viewer','no_actor','no_workspace') THEN
    BEGIN PERFORM public.get_solo_team_workspace();RAISE EXCEPTION 'reader admitted invalid caller'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    PERFORM proof.assert_true(public.get_paige_team_context() IS NULL,'context must abstain');
   ELSIF n IN ('missing_identity','soft_deleted_identity','banned_identity') THEN
    PERFORM proof.assert_true(public.get_solo_team_workspace() IS NULL AND public.get_paige_team_context() IS NULL,'current identity required by both readers');
   ELSE
    w:=public.get_solo_team_workspace();c:=public.get_paige_team_context();
    SELECT value INTO member FROM jsonb_array_elements(w->'members') WHERE value->>'user_id'='e8000000-0000-4000-8000-000000060300';
    SELECT value INTO holder FROM jsonb_array_elements(w->'members') WHERE value->>'user_id'='e8000000-0000-4000-8000-000000060100';
    PERFORM proof.assert_true(w ? 'viewer_is_account_holder' AND c ? 'viewer_is_account_holder','original readers need holder projection');
    PERFORM proof.assert_true(w->'viewer_is_account_holder'=c->'viewer_is_account_holder' AND w->'account_holder_state'=c->'account_holder_state','same holder facts in both readers');
    PERFORM proof.assert_true((w->>'viewer_is_account_holder')::boolean=(actor='holder' AND n<>'unsupported_tier'),'holder is not a role label');
    PERFORM proof.assert_true(CASE WHEN actor IN ('member','owner_label_only') OR n='unsupported_tier' THEN w->'account_holder_state'='null'::jsonb ELSE w->>'account_holder_state'=expected_state END,'state visibility/current source');
    CASE n
     WHEN 'member','owner_label_only' THEN PERFORM proof.assert_true(holder->'business_owner'='null'::jsonb AND w->'owner_seats_held'='[]'::jsonb AND w->'business_owner_options'='[]'::jsonb,'member/role-only private data withheld');
     WHEN 'self_billing' THEN PERFORM proof.assert_true(member->'billing_contact'='true'::jsonb,'self sees own designation');
     WHEN 'other_billing_private' THEN PERFORM proof.assert_true(holder->'billing_contact'='null'::jsonb,'admin cannot inspect another billing designation');
     WHEN 'revoked_billing','foreign_billing' THEN PERFORM proof.assert_true(holder->'billing_contact'='false'::jsonb,'only current same-tenant billing designation');
     WHEN 'entity_label' THEN PERFORM proof.assert_true(holder->'business_owner'->>'display_name'='Test entity A','fallback legal name on original same-tenant link');
     WHEN 'private_legal_fields' THEN PERFORM proof.assert_true(position('ownership_interest' IN w::text)=0 AND position('ownership_interest' IN c::text)=0 AND position('"legal_name"' IN w::text)=0,'never full legal profile');
     WHEN 'held_seat' THEN PERFORM proof.assert_true(jsonb_array_length(w->'owner_seats_held')=1 AND w->'owner_seats_held'=c->'owner_seats_held','same original vacancy record');
     WHEN 'holder_options' THEN PERFORM proof.assert_true(jsonb_array_length(w->'business_owner_options')=3,'holder original non-individual options');
     WHEN 'options_private' THEN PERFORM proof.assert_true(w->'business_owner_options'='[]'::jsonb AND c->'business_owner_options'='[]'::jsonb,'no admin ownership options');
     WHEN 'pending_option','expired_option' THEN
      PERFORM proof.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(w->'business_owner_options') o WHERE o->>'id'='e8000000-0000-4000-8000-000000060004' AND o->>'seat_state'=CASE n WHEN 'pending_option' THEN 'invited' ELSE 'none' END
       AND CASE n WHEN 'pending_option' THEN o->'pending_invitation'->>'email'='invite@tests.invalid' ELSE o->'pending_invitation'='null'::jsonb END),'live invite option state and exact recipient');
     WHEN 'individual_excluded' THEN PERFORM proof.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w->'business_owner_options') o WHERE o->>'kind'='individual'),'individual options excluded');
     WHEN 'foreign_entity_excluded' THEN PERFORM proof.assert_true(position('Test entity B' IN w::text)=0 AND position('foreign@tests.invalid' IN c::text)=0,'foreign entities and invitations withheld');
     WHEN 'search_paging' THEN PERFORM proof.assert_true(jsonb_array_length(public.get_solo_team_workspace(NULL,'all',1,0)->'members')=1 AND jsonb_array_length(public.get_solo_team_workspace('unmatchable','all',25,0)->'members')=0,'original search/page preserved');
     WHEN 'invitations_preserved' THEN PERFORM proof.assert_true(jsonb_array_length(w->'invitations')=1 AND w->'invitations'->0->>'email'='invite@tests.invalid' AND w->'invitations'->0->'token'='null'::jsonb,'original invitation/no token semantics');
     WHEN 'unsupported_tier' THEN PERFORM proof.assert_true(holder->'business_owner'='null'::jsonb AND w->'business_owner_options'='[]'::jsonb AND c->'owner_seats_held'='[]'::jsonb,'no Solo legal projection on unsupported tier');
     WHEN 'holder' THEN PERFORM proof.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(w->'business_owner_options') o WHERE o->>'id'='e8000000-0000-4000-8000-000000060001' AND o->'representative'->>'user_id'='e8000000-0000-4000-8000-000000060100' AND o->'representative'->>'display_name'='person@tests.invalid'),'exact same-tenant representative source');
     ELSE NULL;
    END CASE;
   END IF;
   case_name:=n;passed:=true;detail:=NULL;
  EXCEPTION WHEN OTHERS THEN case_name:=n;passed:=false;detail:=SQLSTATE||': '||SQLERRM; END;
  RETURN NEXT;
 END LOOP;
END $$;
