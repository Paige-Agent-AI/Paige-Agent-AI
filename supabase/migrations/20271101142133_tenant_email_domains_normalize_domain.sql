-- ============================================================================
-- Experience 03 · S3 — one spelling of a sending domain (issue #2133).
--
-- WHY. The PAIGE Email (SendGrid) sender check has two readers of tenant_email_domains.domain that
-- disagreed about what a domain IS:
--   * the database predicate _comms_email_sendgrid_sender_verified (20271031000100) and the
--     one-verified-claim index (20271031000250) compare lower(btrim(domain));
--   * the readiness read (supabase/functions/_shared/comms-email/readiness.ts,
--     readSendgridSenderVerified) looks the row up with PostgREST equality on the lower-cased From
--     domain, i.e. exact `domain = 'example.com'`.
-- Nothing normalized the column, so a row stored as 'Example.com' or ' example.com ' was a verified
-- sender to the database and SENDER_VERIFICATION_MISSING to readiness. Writers differ:
-- manage-tenant-domain trims and lower-cases, paige-mcp comms_add_email_domain lower-cases but does
-- not trim, and a tenant admin can write the table directly under RLS.
--
-- WHAT. The column is normalized where it is written, so every reader sees one spelling and
-- readiness.ts needs no change:
--   1. normalize_tenant_email_domain (BEFORE INSERT OR UPDATE OF domain): domain := lower(btrim(domain)),
--      the exact form the predicate and the verified-claim index use. btrim strips spaces only, the
--      same as the predicate; it does not invent a broader rule. The trigger is named
--      trg_domain_normalize so it sorts before trg_guard_domain_* (same-timing BEFORE triggers fire in
--      name order): the guards see the stored spelling.
--   2. guard_tenant_email_domain_sendgrid_facts (20271031000100) re-pointing test compares
--      lower(btrim(domain)) instead of lower(domain). Without this, normalizing an existing
--      ' example.com' row would read as a different domain and silently clear its SendGrid
--      verification. Everything else in the function is unchanged.
--   3. Backfill existing rows. It REFUSES, deleting and merging nothing, when (a) two rows of one
--      business would become the same domain (UNIQUE (tenant_id, domain) would then collide), or
--      (b) a row to be rewritten has an email connector provisioned on its current spelling
--      (deactivate_email_connector_on_domain_delete/_unverify match inbound_domain = domain
--      exactly; rewriting the domain alone would orphan that connector).
--
-- BEHAVIOUR CHANGE (stated): two rows of one business that differ only by case or surrounding spaces
-- are now refused (23505 on tenant_email_domains_tenant_id_domain_key) instead of stored twice.
-- manage-tenant-domain already lower-cases, so for it nothing changes.
--
-- PRODUCTION (read 2026-10-14, SELECT only): 1 row; 0 rows whose domain differs from
-- lower(btrim(domain)); 0 (tenant, normalized domain) collisions; 0 rows with any SendGrid fact. The
-- backfill therefore rewrites nothing that exists and neither refusal can fire today.
--
-- RELEASE ORDER (merge gate, read before merging). deploy-migrations.yml runs a plain
-- `supabase db push`, which refuses any local migration older than production's newest recorded one.
-- Decided 2026-10-14: this migration merges FIRST. Production's newest when renumbered (SELECT only) was
-- 20271101110001 (#2146), below this version (renumbered from 20271101042133 for that reason). The two sibling branches that sort near it, the S3 reply-screen
-- UI and Experience 03 email G1, are each renumbered above it before they merge. Before merging, re-read production's newest
-- version; if it is at or above this one, renumber this file above it.
--
-- Proof: supabase/tests/tenant_email_domain_normalization.sql.
-- ============================================================================

-- 1 ─ Normalize on write.
CREATE OR REPLACE FUNCTION public.normalize_tenant_email_domain()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.domain IS NOT NULL THEN
    NEW.domain := lower(btrim(NEW.domain));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_tenant_email_domain() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.normalize_tenant_email_domain() IS
  'Issue #2133: stores tenant_email_domains.domain as lower(btrim(domain)), the spelling _comms_email_sendgrid_sender_verified and the readiness read both compare against.';

DROP TRIGGER IF EXISTS trg_domain_normalize ON public.tenant_email_domains;
CREATE TRIGGER trg_domain_normalize
  BEFORE INSERT OR UPDATE OF domain ON public.tenant_email_domains
  FOR EACH ROW EXECUTE FUNCTION public.normalize_tenant_email_domain();

-- 2 ─ The SendGrid provenance guard: 20271031000100 verbatim except the re-pointing comparison.
CREATE OR REPLACE FUNCTION public.guard_tenant_email_domain_sendgrid_facts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _role text := coalesce(auth.role(), '');
  -- Trusted: the service role, or no JWT at all (a migration or operator database session) — the same
  -- rule as guard_channel_connector_sendgrid_writer (20271031000250). Never authenticated or anon: an
  -- anonymous request has no auth.uid() either, and must not pass as the verification service.
  _trusted boolean := _role = 'service_role' OR (auth.uid() IS NULL AND _role NOT IN ('authenticated', 'anon'));
  _facts_written boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _facts_written := NEW.sendgrid_domain_id IS NOT NULL OR NEW.sendgrid_status IS NOT NULL OR NEW.sendgrid_verified_at IS NOT NULL;
  ELSE
    _facts_written := NEW.sendgrid_domain_id IS DISTINCT FROM OLD.sendgrid_domain_id
      OR NEW.sendgrid_status IS DISTINCT FROM OLD.sendgrid_status
      OR NEW.sendgrid_verified_at IS DISTINCT FROM OLD.sendgrid_verified_at;
  END IF;
  IF _facts_written AND NOT _trusted THEN
    RAISE EXCEPTION 'PAIGE_EMAIL_VERIFICATION_PROTECTED: the sending domain''s verification can only be recorded by the verification service'
      USING ERRCODE = '42501';
  END IF;
  -- A verification belongs to one domain of one business. Re-pointing the row clears it, unless the
  -- trusted verification service is recording the new domain's facts in this same write. "Same
  -- domain" is lower(btrim(domain)), the comparison _comms_email_sendgrid_sender_verified makes (#2133).
  IF TG_OP = 'UPDATE' AND NOT _facts_written
     AND (lower(btrim(NEW.domain)) IS DISTINCT FROM lower(btrim(OLD.domain)) OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    NEW.sendgrid_domain_id := NULL;
    NEW.sendgrid_status := NULL;
    NEW.sendgrid_verified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_tenant_email_domain_sendgrid_facts() FROM PUBLIC, anon, authenticated;

-- 3 ─ Backfill, refusing instead of merging or orphaning.
DO $$
DECLARE _collisions int; _linked int;
BEGIN
  SELECT count(*) INTO _collisions FROM (
    SELECT 1 FROM public.tenant_email_domains
     GROUP BY tenant_id, lower(btrim(domain)) HAVING count(*) > 1) d;
  SELECT count(*) INTO _linked FROM public.tenant_email_domains d
   WHERE d.domain IS DISTINCT FROM lower(btrim(d.domain))
     AND EXISTS (SELECT 1 FROM public.channel_connectors c
                  WHERE c.tenant_id = d.tenant_id AND c.channel_type = 'email' AND c.inbound_domain = d.domain);
  IF _collisions > 0 OR _linked > 0 THEN
    RAISE EXCEPTION 'TENANT_EMAIL_DOMAIN_NORMALIZE_REFUSED: % business domain(s) differ only by case or spaces and % row(s) to normalize back an email connector; resolve them before this migration can normalize the column', _collisions, _linked
      USING ERRCODE = '23505';
  END IF;
END $$;

UPDATE public.tenant_email_domains
   SET domain = lower(btrim(domain))
 WHERE domain IS DISTINCT FROM lower(btrim(domain));
