-- No finance record, file or function grants anything through the retired title role.
--
-- "Coach" is a title a business gives its people. It never grants permission. On the consumer-finance
-- tables 18 policies, one storage policy and one function still let the platform-wide `coach` role in.
-- After this migration none do:
--   * reads: the coach branch is removed and not replaced. These rows (banking relationships,
--     certifications, credit predictions, credit personal info, funding outcomes, journey applications,
--     milestones, funding secured) carry no business, so an assignment cannot be scoped to one; an
--     assignment read here would cross businesses. The same rule 20270503000000 applied to goals and
--     chat embeddings. The person themselves and the business's owners and admins keep their reads;
--   * writes: the coach branch is removed. Whether an assigned member may write a client's finance
--     records is a product decision, and this migration does not make it;
--   * policies that existed only for the role (the coach update and read of credit personal info, the
--     three coach funding_secured policies, coach research results, coach outreach drafts) are dropped;
--   * delete_credit_report_upload no longer accepts the role; admins keep it.
--
-- The business-certification policies and the denial-letter files policy carry separate filed findings.
-- This migration only removes the retired role from them; their admin branches are left exactly as they
-- were. The denial-letter files policy exists only where the schema is rebuilt from migrations, so it
-- is edited only if present.
--
-- Who is affected on production today: 0 membership seats hold coach. The 4 people who hold the
-- platform-wide coach role also hold admin or above; they keep every path through the admin branches.

-- Applied as one statement, so production takes all of it or none of it: the deploy runs each
-- top-level statement on its own, and a partial apply would leave non-repeatable renames and drops
-- behind. A short lock wait keeps a blocked attempt from holding up other queries on these tables;
-- it fails the deploy instead, and the next attempt starts clean.
SET lock_timeout = '10s';

DO $$
DECLARE
  _def text;
  _new text;
BEGIN
  -- Reads: the coach branch is removed.
  ALTER POLICY "Users select own banking relationships" ON public.banking_relationships
    USING ((auth.uid() = user_id) OR public.tenant_staff_owns_user(auth.uid(), user_id));

  ALTER POLICY "Owners can view their certifications" ON public.business_certifications
    USING ((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));

  ALTER POLICY "Admins view all predictions, coaches view assigned" ON public.credit_predictions
    USING (public.tenant_staff_owns_user(auth.uid(), user_id));
  ALTER POLICY "Admins view all predictions, coaches view assigned" ON public.credit_predictions
    RENAME TO "Business owners and admins view predictions";

  ALTER POLICY "Admins view all outcomes, coaches view assigned" ON public.funding_application_outcomes
    USING (public.tenant_staff_owns_user(auth.uid(), user_id));
  ALTER POLICY "Admins view all outcomes, coaches view assigned" ON public.funding_application_outcomes
    RENAME TO "Business owners and admins view outcomes";

  ALTER POLICY "Admins and coaches view all journey applications" ON public.funding_journey_applications
    USING (public.tenant_staff_owns_user(auth.uid(), user_id));
  ALTER POLICY "Admins and coaches view all journey applications" ON public.funding_journey_applications
    RENAME TO "Business owners and admins view journey applications";

  ALTER POLICY "Admins and coaches view all funding milestones" ON public.funding_milestones
    USING (public.tenant_staff_owns_user(auth.uid(), user_id));
  ALTER POLICY "Admins and coaches view all funding milestones" ON public.funding_milestones
    RENAME TO "Business owners and admins view funding milestones";

  -- Writes: the coach branch is removed.
  ALTER POLICY "Admins and coaches can manage certifications" ON public.business_certifications
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
  ALTER POLICY "Admins and coaches can manage certifications" ON public.business_certifications
    RENAME TO "Admins can manage certifications";

  ALTER POLICY "Admins insert any outcomes, coaches insert for assigned" ON public.funding_application_outcomes
    WITH CHECK (public.tenant_staff_owns_user(auth.uid(), user_id));
  ALTER POLICY "Admins insert any outcomes, coaches insert for assigned" ON public.funding_application_outcomes
    RENAME TO "Business owners and admins insert outcomes";

  ALTER POLICY "Admins and coaches insert journey applications" ON public.funding_journey_applications
    WITH CHECK (public.tenant_staff_owns_user(auth.uid(), user_id));
  ALTER POLICY "Admins and coaches insert journey applications" ON public.funding_journey_applications
    RENAME TO "Business owners and admins insert journey applications";

  ALTER POLICY "Admins and coaches update all journey applications" ON public.funding_journey_applications
    USING (public.tenant_staff_owns_user(auth.uid(), user_id))
    WITH CHECK (public.tenant_staff_owns_user(auth.uid(), user_id));
  ALTER POLICY "Admins and coaches update all journey applications" ON public.funding_journey_applications
    RENAME TO "Business owners and admins update journey applications";

  ALTER POLICY "Admins and coaches insert funding milestones" ON public.funding_milestones
    WITH CHECK (public.tenant_staff_owns_user(auth.uid(), user_id));
  ALTER POLICY "Admins and coaches insert funding milestones" ON public.funding_milestones
    RENAME TO "Business owners and admins insert funding milestones";

  -- Policies that existed only for the role.
  DROP POLICY "Coaches can update assigned client personal info" ON public.credit_report_personal_info;
  DROP POLICY "Coaches can view assigned client personal info" ON public.credit_report_personal_info;
  DROP POLICY "Coaches can insert funding_secured for assigned clients" ON public.funding_secured;
  DROP POLICY "Coaches can update funding_secured for assigned clients" ON public.funding_secured;
  DROP POLICY "Coaches can view assigned client funding_secured" ON public.funding_secured;
  DROP POLICY "Coaches can manage own research results" ON public.lender_research_results;
  DROP POLICY "Coaches manage assigned client outreach drafts" ON public.outreach_drafts;

  -- The denial-letter files policy: the coach branch is removed where the policy exists. Production
  -- has no such policy; a database rebuilt from migrations does. Its name is left as is, because
  -- renaming a storage policy needs the storage owner, which migrations do not run as.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
             AND policyname = 'Admins and coaches read all denial letters') THEN
    ALTER POLICY "Admins and coaches read all denial letters" ON storage.objects
      USING (bucket_id = 'denial-letters' AND public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;

  -- delete_credit_report_upload: the role is no longer accepted. Edited where it stands so the
  -- signature, settings and grants are kept; the migration stops if the fragment is not found.
  _def := pg_get_functiondef('public.delete_credit_report_upload(uuid, uuid)'::regprocedure);
  _new := regexp_replace(_def, '\s+OR\s+public\.has_role\(_caller,\s*''coach''::app_role\)', '', 'g');
  IF _new = _def THEN
    RAISE EXCEPTION 'delete_credit_report_upload: the retired role check was not found';
  END IF;
  IF _new ~ '''coach''' THEN
    RAISE EXCEPTION 'delete_credit_report_upload still names the retired role';
  END IF;
  EXECUTE _new;
END $$;

RESET lock_timeout;
