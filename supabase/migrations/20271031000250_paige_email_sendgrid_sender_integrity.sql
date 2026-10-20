-- ============================================================================
-- Experience 03 · S3 — PAIGE Email (SendGrid) sender integrity (round-3 security H2).
--
-- WHY. A SendGrid connector sends through the PLATFORM's Mail Send key, and SendGrid authenticates a
-- domain for the whole shared account, not per business: the provider will accept any From any
-- business has verified. 20271031000100 binds a SendGrid From to a domain THIS business verified, but
-- only on the governed email door (prepare_comms_email_send / read_comms_email_send_binding). Two
-- write paths could still undermine it:
--   (a) channel_connectors is writable by any workspace admin (channel_connectors_insert/_update), and
--       nothing validated provider or sender — so an admin could create a SendGrid connector whose
--       From is another business's domain, or the platform's own. send-message now refuses every
--       SendGrid send that is not the door's dispatch (supabase/functions/send-message/index.ts,
--       PAIGE_EMAIL_DOOR_REQUIRED); this trigger stops the connector being written at all.
--   (b) tenant_email_domains was unique only per business, (tenant_id, domain), so two businesses
--       could each hold a "verified" row for the same domain, and one SendGrid domain id could back
--       two businesses' rows. Only the verification service writes those facts (000100's guard), but
--       nothing stopped the service from recording a second claim.
--
-- WHAT.
--   1. guard_channel_connector_sendgrid_writer (BEFORE INSERT OR UPDATE on channel_connectors): a
--      request that carries a JWT and is not the service role — any signed-in user, a workspace admin
--      or the platform owner from the app, anon — may not INSERT a provider='sendgrid' connector, may
--      not UPDATE a connector INTO provider='sendgrid', and may not change a SendGrid connector in any
--      way other than switching it OFF. Switching off stays allowed because
--      deactivate_email_connector_on_domain_delete/_unverify (SECURITY DEFINER, fired by an admin's own
--      domain write) disable every email connector on that domain, SendGrid included — refusing that
--      would make a business unable to remove its own domain. A SendGrid connector is created and
--      changed by the operator step under the service role (or a non-JWT database session such as a
--      migration, which RLS does not govern either).
--   2. tenant_email_domains_sendgrid_verified_domain: at most one SendGrid-VERIFIED row per domain
--      across all businesses (lower(btrim(domain)), the exact comparison _comms_email_sendgrid_
--      sender_verified makes).
--   3. tenant_email_domains_sendgrid_domain_id: one SendGrid domain-authentication id backs at most one
--      row (btrim(sendgrid_domain_id), the form the verified check reads).
--   Neither index proves a business OWNS its domain — SendGrid reporting a domain valid for the shared
--   account is not that proof. A per-business DNS ownership proof is still owed before any SendGrid
--   verification writer ships (round-3 security H2, "related design gap").
--
-- PRODUCTION (read 2026-10-13, SELECT only): channel_connectors holds 8 rows, all provider='resend'
-- (6 active); zero SendGrid connectors, so (1) refuses nothing that exists. The SendGrid fact columns
-- do not exist on production until 20271031000100 applies (every row NULL), so (2)/(3) cannot collide;
-- the DO block still checks and fails loudly with the reason rather than deleting anything (§13).
-- No tenant_email_domains domain appears twice on production.
--
-- COMPATIBILITY. RLS on channel_connectors is untouched (G1, a separate change, tightens it); this
-- trigger is narrower than any policy and composes with one. Existing triggers fire in name order:
-- trg_channel_connectors_tenant (INSERT) and trg_channel_connectors_updated_at run before this one,
-- trg_personal_mailbox_owner after (it only preserves a personal mailbox owner, never provider or
-- sender).
--
-- §59: the trigger function is SECURITY INVOKER (it reads only the request's JWT claims through
-- auth.uid()/auth.role(), no table), is not callable directly, and is granted to nobody. A SECURITY
-- DEFINER caller cannot launder an untrusted request: auth.role() is the JWT's claim, not the current
-- database role, so a signed-in user reaching channel_connectors through a DEFINER function is still
-- refused.
-- §37 producer inventory (writers of channel_connectors; read 2026-10-13):
--   * app UI (EmailIntegrationConfig, IntegrationsHub, OwnerWelcome, useSoloNumbers/useSoloComms):
--     resend/twilio/gmail/smtp rows only — unaffected; no UI writes provider='sendgrid'.
--   * edge (service role): smtp-connect, smtp-disconnect, gmail-oauth-callback, gmail-disconnect,
--     comms-mailbox-command — service role is trusted, and none writes SendGrid.
--   * SQL: provision_email_connector_on_verify / provision_paige_managed_email_connector (resend only);
--     deactivate_email_connector_on_domain_delete/_unverify (switch-off — allowed, see 1).
--   * supabase/tests/paige_email_sendgrid_door.sql inserts SendGrid connectors with no JWT claims
--     (trusted, unchanged); paige_email_sendgrid_sender_integrity.sql proves this migration.
-- ============================================================================

-- 1 ─ Only the service role (or a non-JWT database session) writes a SendGrid connector.
CREATE OR REPLACE FUNCTION public.guard_channel_connector_sendgrid_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _role text := coalesce(auth.role(), '');
  -- Trusted: the service role, or no JWT at all (a migration or operator database session).
  -- Never: authenticated or anon, whatever function they reached this table through.
  _trusted boolean := _role = 'service_role' OR (auth.uid() IS NULL AND _role NOT IN ('authenticated', 'anon'));
  _old_rest jsonb;
  _new_rest jsonb;
BEGIN
  IF _trusted THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.provider = 'sendgrid' THEN
      RAISE EXCEPTION 'PAIGE_EMAIL_CONNECTOR_PROTECTED: a PAIGE Email sender can only be set up by the platform'
        USING ERRCODE = '42501',
              HINT = 'PAIGE Email senders are created by the platform after the business verifies its domain.';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.provider = 'sendgrid' AND OLD.provider IS DISTINCT FROM 'sendgrid' THEN
    RAISE EXCEPTION 'PAIGE_EMAIL_CONNECTOR_PROTECTED: a connector cannot be switched to a PAIGE Email sender'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.provider = 'sendgrid' AND OLD.provider = 'sendgrid' THEN
    -- Everything but the on/off state and its timestamp must be exactly as the platform wrote it.
    _old_rest := to_jsonb(OLD) - 'active' - 'status' - 'updated_at';
    _new_rest := to_jsonb(NEW) - 'active' - 'status' - 'updated_at';
    IF _new_rest IS DISTINCT FROM _old_rest THEN
      RAISE EXCEPTION 'PAIGE_EMAIL_CONNECTOR_PROTECTED: a PAIGE Email sender can only be changed by the platform'
        USING ERRCODE = '42501';
    END IF;
    -- Switching OFF (or leaving it as it was) is allowed; switching it ON is the platform's.
    IF (NEW.active IS TRUE AND NEW.status = 'active')
       AND NOT (OLD.active IS TRUE AND OLD.status = 'active') THEN
      RAISE EXCEPTION 'PAIGE_EMAIL_CONNECTOR_PROTECTED: a PAIGE Email sender can only be switched on by the platform'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_channel_connector_sendgrid_writer() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.guard_channel_connector_sendgrid_writer() IS
  'Experience 03 (security H2): only the service role (or a non-JWT database session) may create a provider=''sendgrid'' connector, switch one to sendgrid, change one, or switch one on. A signed-in request may only switch a SendGrid connector off. send-message separately refuses any SendGrid send that is not the governed email door''s dispatch.';

DROP TRIGGER IF EXISTS trg_guard_channel_connector_sendgrid ON public.channel_connectors;
CREATE TRIGGER trg_guard_channel_connector_sendgrid
  BEFORE INSERT OR UPDATE ON public.channel_connectors
  FOR EACH ROW EXECUTE FUNCTION public.guard_channel_connector_sendgrid_writer();

-- 2/3 ─ One verified claim per domain, one row per SendGrid domain id, across all businesses.
DO $$
DECLARE _domains int; _ids int;
BEGIN
  SELECT count(*) INTO _domains FROM (
    SELECT 1 FROM public.tenant_email_domains WHERE sendgrid_status = 'verified'
     GROUP BY lower(btrim(domain)) HAVING count(*) > 1) d;
  SELECT count(*) INTO _ids FROM (
    SELECT 1 FROM public.tenant_email_domains WHERE sendgrid_domain_id IS NOT NULL
     GROUP BY btrim(sendgrid_domain_id) HAVING count(*) > 1) d;
  IF _domains > 0 OR _ids > 0 THEN
    RAISE EXCEPTION 'PAIGE_EMAIL_DOMAIN_DUPLICATES: % domain(s) verified by more than one business and % SendGrid domain id(s) on more than one row; resolve them before these indexes can be created', _domains, _ids
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_email_domains_sendgrid_verified_domain
  ON public.tenant_email_domains ((lower(btrim(domain))))
  WHERE sendgrid_status = 'verified';
COMMENT ON INDEX public.tenant_email_domains_sendgrid_verified_domain IS
  'Experience 03 (security H2): at most one business holds a PAIGE Email (SendGrid) verified claim on a domain. Not an ownership proof.';

CREATE UNIQUE INDEX IF NOT EXISTS tenant_email_domains_sendgrid_domain_id
  ON public.tenant_email_domains ((btrim(sendgrid_domain_id)))
  WHERE sendgrid_domain_id IS NOT NULL;
COMMENT ON INDEX public.tenant_email_domains_sendgrid_domain_id IS
  'Experience 03 (security H2): one SendGrid domain-authentication id backs at most one domain row.';
