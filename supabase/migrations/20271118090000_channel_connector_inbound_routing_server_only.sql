-- ============================================================================
-- Experience 03 — inbound routing fields are written by PAIGE's server code only.
--
-- WHY. handle-inbound-email routes every reply on channel_connectors.inbound_address (exact) and,
-- outside paigeagent.ai, inbound_domain. Both columns were writable from a browser session by any
-- workspace admin (channel_connectors_insert/_update RLS). The global unique indexes stop an admin
-- taking an address or domain another business already holds, but not one nobody holds yet: a
-- retired business's old <slug>@mail.paigeagent.ai, the slug a future business will be given, or
-- a customer domain before its real owner connects it. Whoever claims it first receives that mail.
-- Recorded as a follow-up of #2976 (config-registry); owner approved 2026-10-27.
--
-- WHAT. guard_channel_connector_inbound_routing (BEFORE INSERT OR UPDATE): a write that comes
-- DIRECTLY from an authenticated or anon session may not set inbound_address/inbound_domain on
-- INSERT, nor change either on UPDATE. Every other column keeps its current RLS behaviour.
--
-- TRUST is the role the statement runs as (current_user), not the JWT, ON PURPOSE. The legitimate
-- writers are all SECURITY DEFINER functions owned by postgres, and two of them are reached from a
-- signed-in owner's own write: trg_tenants_paige_managed_email_connector re-provisions the managed
-- address when the business's slug or name changes, and provision_email_connector_on_verify fires
-- from a tenant_email_domains write. A JWT-based check (the rule guard_channel_connector_sendgrid_
-- writer uses) would refuse those and break renaming a business from the app. The other writers
-- (provision_gmail_connection, disconnect_gmail_connection, the deactivate_* domain triggers,
-- smtp-connect which leaves inbound_address NULL) run as the service role or as postgres.
-- No app or edge code writes these columns from a browser session (src/ only reads them).
--
-- PRODUCTION (read 2026-10-27, SELECT only): 9 connectors carry inbound_address, all PAIGE-managed
-- <slug>@mail.paigeagent.ai equal to their from_address; 0 carry inbound_domain. Nothing existing is
-- changed or refused. Trigger order: after trg_channel_connectors_tenant/_updated_at, before
-- trg_guard_channel_connector_sendgrid and trg_personal_mailbox_owner (neither writes these columns).
--
-- REVERSAL: DROP TRIGGER trg_guard_channel_connector_inbound_routing ON public.channel_connectors.
-- Proof: supabase/tests/channel_connector_inbound_routing_server_only.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_channel_connector_inbound_routing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- SECURITY INVOKER, so current_user is the role the writing statement runs as: authenticated/anon
  -- for a direct PostgREST write, the definer's owner inside a SECURITY DEFINER function.
  _direct_browser boolean := current_user IN ('authenticated', 'anon');
  _routing_written boolean;
BEGIN
  IF NOT _direct_browser THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    _routing_written := NEW.inbound_address IS NOT NULL OR NEW.inbound_domain IS NOT NULL;
  ELSE
    _routing_written := NEW.inbound_address IS DISTINCT FROM OLD.inbound_address
      OR NEW.inbound_domain IS DISTINCT FROM OLD.inbound_domain;
  END IF;
  IF _routing_written THEN
    RAISE EXCEPTION 'PAIGE_INBOUND_ROUTING_PROTECTED: which address or domain delivers mail to a business is set by PAIGE, not directly from the app'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_channel_connector_inbound_routing() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_channel_connector_inbound_routing ON public.channel_connectors;
CREATE TRIGGER trg_guard_channel_connector_inbound_routing
BEFORE INSERT OR UPDATE ON public.channel_connectors
FOR EACH ROW EXECUTE FUNCTION public.guard_channel_connector_inbound_routing();
