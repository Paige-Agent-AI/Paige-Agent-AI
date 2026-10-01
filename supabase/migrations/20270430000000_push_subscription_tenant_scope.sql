-- A device's push subscription belongs to exactly one business.
--
-- The device is the person's; each subscription records the business it was registered for. A
-- person may receive notifications from every business they work with and mute each one, because
-- each business holds its own subscription for the device. That lets a person see their own
-- businesses on their own device — not one business learn of another.
--
-- After this migration:
--   * a subscription records its business: the one named, else the business the registering person
--     is working in when they belong to it, else the single business they belong to (as a member or a
--     client); a new registration with none of those is refused;
--   * the person must belong to that business, and only the person registers their own device;
--   * the business cannot be changed afterwards;
--   * one device holds at most one subscription per business;
--   * a business's admins see only subscriptions registered for that business;
--   * a subscription with no business matches no business, in every policy and in the sender.
--
-- The business is nullable for exactly one reason: a legacy registration made before subscriptions
-- recorded a business, for which none can be derived (owner ruling Q1, 2026-09-26: kept, unmapped,
-- receiving nothing). New registrations always carry one.

-- Step 1: the business column. Nullable only for the legacy case above.
ALTER TABLE public.push_subscriptions
  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
COMMENT ON COLUMN public.push_subscriptions.tenant_id IS
  'The business this device subscription was registered for. NULL only for a legacy registration made before subscriptions recorded a business and for which none can be derived (Q1, 2026-09-26): such a subscription matches no business and receives nothing. New registrations always carry one; immutable.';

-- Step 2: place existing subscriptions by the single business their person belongs to (as a member
-- or as a client); leave any with no single business unmapped, per Q1.
UPDATE public.push_subscriptions s
   SET tenant_id = one.t
  FROM (SELECT p, (array_agg(DISTINCT t))[1] AS t
          FROM (SELECT tm.user_id AS p, tm.tenant_id AS t FROM public.tenant_members tm WHERE tm.status = 'active'
                UNION SELECT c.linked_user_id, c.tenant_id FROM public.clients c WHERE c.linked_user_id IS NOT NULL) x
         GROUP BY p HAVING count(DISTINCT t) = 1) one
 WHERE s.tenant_id IS NULL AND s.user_id = one.p;

-- Step 3: one subscription per device per business. An unmapped legacy subscription counts as its own
-- value, so a device holds at most one of those too.
ALTER TABLE public.push_subscriptions DROP CONSTRAINT push_subscriptions_user_id_endpoint_key;
CREATE UNIQUE INDEX push_subscriptions_person_endpoint_tenant_key
  ON public.push_subscriptions (user_id, endpoint, tenant_id) NULLS NOT DISTINCT;
CREATE INDEX push_subscriptions_tenant_id_idx ON public.push_subscriptions (tenant_id);

-- Step 4: fill, validate and fix the business on every write.
CREATE OR REPLACE FUNCTION public.enforce_push_subscription_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _record_tenants uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'PUSH_TENANT_IMMUTABLE: a subscription''s business cannot be changed'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'PUSH_TENANT_IMMUTABLE: a subscription''s person cannot be changed'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Only the person registers their own device; the service role may register on their behalf.
  IF _caller IS NOT NULL AND _caller IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'PUSH_REGISTRANT_NOT_SUBJECT: only the person registers their own device'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.tenant_id IS NULL AND _caller IS NOT NULL THEN
    NEW.tenant_id := public.current_user_tenant_id();
    -- The active workspace can be one the person does not belong to (a platform administrator working
    -- in a customer's business); a device is never registered there.
    IF NEW.tenant_id IS NOT NULL
       AND NOT (public.tenant_assignee_qualifies(NEW.tenant_id, NEW.user_id)
                OR EXISTS (SELECT 1 FROM public.clients c
                            WHERE c.tenant_id = NEW.tenant_id AND c.linked_user_id = NEW.user_id)) THEN
      NEW.tenant_id := NULL;
    END IF;
  END IF;
  IF NEW.tenant_id IS NULL THEN
    -- Otherwise the single business the person belongs to, as a member or as a client, places it. With
    -- more than one, which business they meant is unknowable here and the registration is refused
    -- rather than guessed.
    SELECT array_agg(DISTINCT t) INTO _record_tenants FROM (
      SELECT tm.tenant_id AS t FROM public.tenant_members tm WHERE tm.user_id = NEW.user_id AND tm.status = 'active'
      UNION SELECT c.tenant_id FROM public.clients c WHERE c.linked_user_id = NEW.user_id) s;
    IF coalesce(array_length(_record_tenants, 1), 0) = 1 THEN
      NEW.tenant_id := _record_tenants[1];
    END IF;
  END IF;
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'PUSH_TENANT_UNRESOLVED: no business to record this registration for'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (public.tenant_assignee_qualifies(NEW.tenant_id, NEW.user_id)
          OR EXISTS (SELECT 1 FROM public.clients c
                      WHERE c.tenant_id = NEW.tenant_id AND c.linked_user_id = NEW.user_id)) THEN
    RAISE EXCEPTION 'PUSH_SUBJECT_NOT_IN_TENANT: the person does not belong to this business'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_push_subscription_tenant() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_enforce_push_subscription_tenant
  BEFORE INSERT OR UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_push_subscription_tenant();

-- Step 5: a business's admins see only its own subscriptions. A subscription with no business matches
-- nothing: the predicate requires a business before any other branch can apply.
ALTER POLICY "Admins can view all push subscriptions" ON public.push_subscriptions
  TO authenticated
  USING (tenant_id IS NOT NULL
         AND (is_super_admin() OR is_tenant_admin(tenant_id) OR agency_can_manage_child(tenant_id)));
