-- INT-339: canonical authority for platform referral administration.
-- Preserve affiliate-owned reads and the separate operator Analytics contracts.
BEGIN;

ALTER POLICY ap_admin ON public.affiliate_profiles TO authenticated
  USING (public.is_platform_owner()) WITH CHECK (public.is_platform_owner());
ALTER POLICY rc_admin ON public.referral_codes TO authenticated
  USING (public.is_platform_owner()) WITH CHECK (public.is_platform_owner());
ALTER POLICY cv_admin ON public.referral_conversions TO authenticated
  USING (public.is_platform_owner()) WITH CHECK (public.is_platform_owner());
ALTER POLICY cp_admin ON public.commission_payments TO authenticated
  USING (public.is_platform_owner()) WITH CHECK (public.is_platform_owner());
ALTER POLICY tier_admin ON public.affiliate_commission_tiers TO authenticated
  USING (public.is_platform_owner()) WITH CHECK (public.is_platform_owner());
ALTER POLICY clicks_admin ON public.referral_clicks TO authenticated
  USING (public.is_platform_owner());
ALTER POLICY rc_read_owner ON public.referral_codes TO authenticated
  USING (
    public.is_platform_owner()
    OR EXISTS (
      SELECT 1 FROM public.affiliate_profiles ap
      WHERE ap.id = referral_codes.affiliate_id AND ap.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.approve_affiliate_application(
  _application_id uuid,
  _tier_key text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _app          public.affiliate_applications%ROWTYPE;
  _tier_id      uuid;
  _final_tier   text;
  _matched_user uuid;
  _code         text;
  _affiliate_id uuid;
  _name_seed    text;
BEGIN
  IF auth.uid() IS NULL OR public.is_platform_owner() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _app FROM public.affiliate_applications WHERE id = _application_id;
  IF _app.id IS NULL THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  IF _app.status <> 'pending' THEN
    RAISE EXCEPTION 'Application is not pending (current status: %)', _app.status;
  END IF;

  _final_tier := COALESCE(_tier_key, _app.requested_tier_key, 'external');

  SELECT id INTO _tier_id
  FROM public.affiliate_commission_tiers
  WHERE tier_key = _final_tier
  LIMIT 1;
  IF _tier_id IS NULL THEN
    RAISE EXCEPTION 'Unknown commission tier: %', _final_tier;
  END IF;

  -- Try to match application to an existing auth user by email
  _matched_user := _app.user_id;
  IF _matched_user IS NULL THEN
    SELECT id INTO _matched_user
    FROM auth.users
    WHERE lower(email) = lower(_app.email)
    LIMIT 1;
  END IF;

  -- If user already has an affiliate profile, just link the application
  IF _matched_user IS NOT NULL THEN
    SELECT id INTO _affiliate_id
    FROM public.affiliate_profiles
    WHERE user_id = _matched_user
    LIMIT 1;
  END IF;

  -- Otherwise create a new affiliate profile
  IF _affiliate_id IS NULL THEN
    IF _matched_user IS NULL THEN
      RAISE EXCEPTION 'Cannot approve: applicant has no account yet. Ask them to sign up at the email %s first, then re-approve.', _app.email;
    END IF;

    -- Generate a unique referral code (mirrors auto_enroll_affiliate logic)
    _name_seed := COALESCE(
      NULLIF(regexp_replace(_app.full_name, '[^a-zA-Z0-9]', '', 'g'), ''),
      'PAIGE'
    );
    _code := upper(substr(_name_seed, 1, 4))
          || upper(substr(md5(random()::text || _matched_user::text), 1, 4));

    FOR i IN 1..5 LOOP
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE code = _code);
      _code := upper(substr(_name_seed, 1, 4))
            || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    END LOOP;

    INSERT INTO public.affiliate_profiles
      (user_id, referral_code, commission_tier_id, enrolled_from, active)
    VALUES
      (_matched_user, _code, _tier_id, 'application_' || _final_tier, true)
    RETURNING id INTO _affiliate_id;

    INSERT INTO public.referral_codes (code, affiliate_id, active)
    VALUES (_code, _affiliate_id, true)
    ON CONFLICT (code) DO NOTHING;
  END IF;

  -- Mark application approved
  UPDATE public.affiliate_applications
  SET status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = _notes,
      resulting_affiliate_id = _affiliate_id,
      user_id = COALESCE(user_id, _matched_user)
  WHERE id = _application_id;

  RETURN json_build_object(
    'success', true,
    'affiliate_id', _affiliate_id,
    'matched_user_id', _matched_user
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_affiliate_application(
  _application_id uuid,
  _notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_platform_owner() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.affiliate_applications
  SET status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = _notes
  WHERE id = _application_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or not pending';
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_affiliate_application(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_affiliate_application(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_affiliate_application(uuid,text,text), public.reject_affiliate_application(uuid,text) FROM PUBLIC, anon;
COMMIT;
