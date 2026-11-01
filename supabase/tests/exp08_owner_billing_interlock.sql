-- Isolated original-writer integration, NOT a production/SDK/RLS/customer proof.
-- The runner installs the REAL Billing scope and revoke bodies. Only active-workspace
-- resolution and minimal table shapes are fixture ports; no Billing writer is mocked.
CREATE TABLE public.platform_billing_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,
 designation text,revoked_at timestamptz,revoked_by uuid
);
CREATE FUNCTION public.billing_active_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('proof.billing_tenant',true),''),
 'e8000000-0000-4000-8000-000000060010')::uuid $$;

CREATE FUNCTION proof.billing_cases() RETURNS TABLE(case_name text,passed boolean,detail text)
LANGUAGE plpgsql AS $$
DECLARE n text; refused boolean; reason text; before_rows jsonb; before_seats jsonb;
BEGIN
 FOREACH n IN ARRAY ARRAY['no_designations','delegate_cleanup','self_stepdown_cleanup',
 'sole_primary_unpaid_refused','duplicate_target_primaries_rollback','historical_duplicate_cleanup',
 'foreign_scope_refused','foreign_scope_no_contacts_refused','revoked_and_foreign_preserved',
 'sub_account_no_designations','parented_no_designations','sub_account_designation_refused','parented_designation_refused'] LOOP
  PERFORM proof.revoke_setup();
  TRUNCATE public.platform_billing_contacts;
  PERFORM set_config('proof.billing_tenant','e8000000-0000-4000-8000-000000060010',false);
  BEGIN
   IF n NOT IN ('no_designations','foreign_scope_no_contacts_refused','sub_account_no_designations','parented_no_designations') THEN
    INSERT INTO public.platform_billing_contacts(id,tenant_id,user_id,designation) VALUES
     ('e8000000-0000-4000-8000-000000063001','e8000000-0000-4000-8000-000000060010',
      'e8000000-0000-4000-8000-000000060100',
      CASE WHEN n IN ('sole_primary_unpaid_refused','duplicate_target_primaries_rollback','historical_duplicate_cleanup')
       THEN 'primary_contact' ELSE 'delegate' END);
   END IF;
   IF n LIKE 'sub_account_%' THEN
    UPDATE public.tenants SET account_type='sub_account' WHERE id='e8000000-0000-4000-8000-000000060010';
   ELSIF n LIKE 'parented_%' THEN
    UPDATE public.tenants SET parent_tenant_id='e8000000-0000-4000-8000-000000060020' WHERE id='e8000000-0000-4000-8000-000000060010';
   END IF;
   IF n IN ('duplicate_target_primaries_rollback','historical_duplicate_cleanup') THEN
    INSERT INTO public.platform_billing_contacts(id,tenant_id,user_id,designation) VALUES
     ('e8000000-0000-4000-8000-000000063002','e8000000-0000-4000-8000-000000060010',
      'e8000000-0000-4000-8000-000000060100','primary_contact');
   END IF;
   IF n='historical_duplicate_cleanup' THEN
    INSERT INTO public.platform_billing_contacts(tenant_id,user_id,designation) VALUES
     ('e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060300','primary_contact');
   END IF;
   IF n='self_stepdown_cleanup' THEN
    PERFORM set_config('request.jwt.claim.sub','e8000000-0000-4000-8000-000000060100',false);
   END IF;
   IF n LIKE 'foreign_scope%' THEN
    -- A real eligible foreign workspace/Owner, so only target binding can reject it.
    UPDATE public.tenants SET account_type='standalone' WHERE id='e8000000-0000-4000-8000-000000060020';
    INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role) VALUES
     ('e8000000-0000-4000-8000-000000061005','e8000000-0000-4000-8000-000000060020',
      'e8000000-0000-4000-8000-000000060300',true,'owner');
    PERFORM set_config('proof.billing_tenant','e8000000-0000-4000-8000-000000060020',false);
   END IF;
   IF n='revoked_and_foreign_preserved' THEN
    INSERT INTO public.platform_billing_contacts(id,tenant_id,user_id,designation,revoked_at) VALUES
     ('e8000000-0000-4000-8000-000000063003','e8000000-0000-4000-8000-000000060020',
      'e8000000-0000-4000-8000-000000060100','delegate',NULL),
     ('e8000000-0000-4000-8000-000000063004','e8000000-0000-4000-8000-000000060010',
      'e8000000-0000-4000-8000-000000060100','delegate','2026-01-01');
   END IF;
   SELECT jsonb_agg(to_jsonb(b) ORDER BY id) INTO before_rows FROM public.platform_billing_contacts b;
   SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_seats FROM public.tenant_members m;
   refused:=false;reason:=NULL;
   BEGIN
    PERFORM public.revoke_co_owner('e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060100');
   EXCEPTION WHEN insufficient_privilege THEN refused:=true;reason:=SQLERRM; END;
   IF n IN ('sole_primary_unpaid_refused','duplicate_target_primaries_rollback','foreign_scope_refused','foreign_scope_no_contacts_refused',
    'sub_account_designation_refused','parented_designation_refused') THEN
    PERFORM proof.assert_true(refused,'required Billing refusal');
    IF n IN ('sole_primary_unpaid_refused','duplicate_target_primaries_rollback') THEN
     PERFORM proof.assert_true(reason='billing_primary_contact_required','original strict last-primary error');
    ELSIF n IN ('sub_account_designation_refused','parented_designation_refused') THEN
     PERFORM proof.assert_true(reason='CO_OWNER_BILLING_CLEANUP_UNAVAILABLE','explicit unavailable cleanup refusal');
    ELSE
     PERFORM proof.assert_true(reason='CO_OWNER_BILLING_SCOPE_MISMATCH','explicit current-workspace binding');
    END IF;
    PERFORM proof.assert_true(before_rows IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.platform_billing_contacts b),'all contacts rolled back');
    PERFORM proof.assert_true(before_seats IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tenant_members m),'all seats rolled back');
    PERFORM proof.assert_true(NOT EXISTS(SELECT 1 FROM public.paige_audit_log),'no partial audit');
   ELSE
    PERFORM proof.assert_true(NOT refused,'permitted demotion');
    PERFORM proof.assert_true(NOT EXISTS(SELECT 1 FROM public.platform_billing_contacts WHERE
     tenant_id='e8000000-0000-4000-8000-000000060010' AND user_id='e8000000-0000-4000-8000-000000060100' AND revoked_at IS NULL),'target live designations ended');
    PERFORM proof.assert_true((SELECT NOT is_owner AND role='admin' AND business_owner_id IS NULL FROM public.tenant_members
     WHERE tenant_id='e8000000-0000-4000-8000-000000060010' AND user_id='e8000000-0000-4000-8000-000000060100'),'original seat demoted');
    PERFORM proof.assert_true((SELECT count(*) FROM public.paige_audit_log WHERE action='platform_billing_contact_revoked')=
     CASE WHEN n IN ('no_designations','sub_account_no_designations','parented_no_designations') THEN 0
      WHEN n='historical_duplicate_cleanup' THEN 2 ELSE 1 END,'one original audit per live designation');
    PERFORM proof.assert_true(NOT EXISTS(SELECT 1 FROM public.paige_audit_log WHERE actor_user_id IS DISTINCT FROM auth.uid()),'original actual actor');
    IF n='revoked_and_foreign_preserved' THEN
     PERFORM proof.assert_true((SELECT revoked_at IS NULL FROM public.platform_billing_contacts WHERE id='e8000000-0000-4000-8000-000000063003')
      AND (SELECT revoked_at='2026-01-01'::timestamptz FROM public.platform_billing_contacts WHERE id='e8000000-0000-4000-8000-000000063004'),'foreign/revoked contacts unchanged');
    END IF;
   END IF;
   case_name:=n;passed:=true;detail:=NULL;
  EXCEPTION WHEN OTHERS THEN case_name:=n;passed:=false;detail:=SQLSTATE||': '||SQLERRM; END;
  RETURN NEXT;
 END LOOP;
 PERFORM set_config('proof.billing_tenant','e8000000-0000-4000-8000-000000060010',false);
 TRUNCATE public.platform_billing_contacts;
END $$;
