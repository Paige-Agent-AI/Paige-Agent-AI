-- Original I2 §5.4b integration fixture. Actual I1 mint/accept bodies are loaded by the original
-- native runner. Auth/platform/agency inputs and minimal tables are ports; no RLS/customer proof.
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
ALTER TABLE auth.users ADD COLUMN email text;
ALTER TABLE public.tenants ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.tenant_members ADD COLUMN joined_at timestamptz;
ALTER TABLE public.tenant_members ALTER COLUMN id SET DEFAULT gen_random_uuid();
CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
CREATE TABLE proof.platform_owners(user_id uuid PRIMARY KEY);
CREATE TABLE proof.agency_managers(tenant_id uuid,user_id uuid);
CREATE FUNCTION public.is_platform_owner(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM proof.platform_owners WHERE user_id=$1) $$;
CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT public.is_platform_owner(auth.uid()) $$;
CREATE FUNCTION public.is_tenant_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.agency_can_manage_child(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM proof.agency_managers WHERE tenant_id=$1 AND user_id=$2) $$;
CREATE TABLE public.tenant_invite_tokens(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 token text NOT NULL UNIQUE,kind text NOT NULL,default_role public.tenant_role NOT NULL DEFAULT 'member',
 created_by uuid,expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',max_uses integer,
 uses integer NOT NULL DEFAULT 0,last_used_at timestamptz,revoked_at timestamptz,
 contact_id uuid,email text,agency_role text,team_hub_access boolean NOT NULL DEFAULT true);

CREATE FUNCTION proof.owner_invitation_cases() RETURNS TABLE(case_name text,passed boolean,detail text)
LANGUAGE plpgsql AS $$
DECLARE n text;t uuid;p uuid:=gen_random_uuid();a uuid:=gen_random_uuid();u uuid:=gen_random_uuid();
 v_token text; should_refuse boolean;got_refusal boolean;state text;before_rows jsonb;after_rows jsonb;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(p,'platform@example.invalid'),(a,'agency@example.invalid'),(u,'invitee@example.invalid');
 INSERT INTO proof.platform_owners VALUES(p);
 INSERT INTO public.profiles VALUES(u,NULL);
 FOREACH n IN ARRAY ARRAY['mint_fresh','mint_subaccount','mint_pointer','mint_suspended','mint_history',
   'accept_fresh','accept_pointer','accept_suspended','accept_history','accept_agency_paused',
   'accept_dual_agency_paused','mint_enterprise_history','accept_enterprise_history'] LOOP
  t:=gen_random_uuid();v_token:=gen_random_uuid()::text;
  INSERT INTO public.tenants(id,account_type) VALUES(t,CASE WHEN n LIKE '%enterprise%' THEN 'enterprise'
    WHEN n='mint_subaccount' OR n LIKE '%agency%' THEN 'sub_account' ELSE 'standalone' END);
  IF n LIKE '%pointer%' THEN UPDATE public.tenants SET owner_user_id=a WHERE id=t; END IF;
  IF n LIKE '%suspended%' OR n LIKE '%paused%' THEN
    INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,role,status) VALUES(t,a,true,'owner','suspended');
  END IF;
  IF n LIKE '%history%' THEN UPDATE public.tenants SET first_owner_seated_at='2021-01-01Z' WHERE id=t; END IF;
  IF n LIKE '%agency%' THEN INSERT INTO proof.agency_managers VALUES(t,CASE WHEN n LIKE '%dual%' THEN p ELSE a END); END IF;
  IF n LIKE 'accept%' THEN
    INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,default_role,created_by,max_uses)
    VALUES(t,v_token,'subaccount_owner','admin',CASE WHEN n='accept_agency_paused' THEN a ELSE p END,1);
  END IF;
  should_refuse:=n IN ('mint_pointer','mint_suspended','mint_history','accept_pointer','accept_suspended','accept_history');
  before_rows:=jsonb_build_object('tenant',(SELECT to_jsonb(x) FROM public.tenants x WHERE id=t),
    'members',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tenant_members x WHERE tenant_id=t),
    'tokens',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tenant_invite_tokens x WHERE tenant_id=t),
    'profile',(SELECT to_jsonb(x) FROM public.profiles x WHERE user_id=u),
    'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.paige_audit_log x WHERE tenant_id=t));
  got_refusal:=false;state:=NULL;
  BEGIN
    IF n LIKE 'mint%' THEN
      PERFORM set_config('request.jwt.claim.sub',p::text,true);
      PERFORM public.create_tenant_invite_token(t,'subaccount_owner','admin',7,1,NULL,NULL);
    ELSE
      PERFORM set_config('request.jwt.claim.sub',u::text,true);
      PERFORM public.accept_tenant_invite(v_token);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE;
    got_refusal:=state='42501';
  END;
  after_rows:=jsonb_build_object('tenant',(SELECT to_jsonb(x) FROM public.tenants x WHERE id=t),
    'members',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tenant_members x WHERE tenant_id=t),
    'tokens',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tenant_invite_tokens x WHERE tenant_id=t),
    'profile',(SELECT to_jsonb(x) FROM public.profiles x WHERE user_id=u),
    'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.paige_audit_log x WHERE tenant_id=t));
  IF should_refuse THEN
    RETURN QUERY SELECT n,got_refusal AND before_rows=after_rows,coalesce(state,'request accepted');
  ELSIF n LIKE 'accept%' THEN
    RETURN QUERY SELECT n,state IS NULL AND EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=t AND user_id=u AND is_owner)
      AND EXISTS(SELECT 1 FROM public.tenants WHERE id=t AND owner_user_id=u AND first_owner_seated_at IS NOT NULL)
      AND EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token=v_token AND uses=1),coalesce(state,'accepted');
  ELSE
    RETURN QUERY SELECT n,state IS NULL AND EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE tenant_id=t),coalesce(state,'minted');
  END IF;
 END LOOP;
END $$;
