-- ANT-49: separate row contracts; no row backfill, RLS or signing-state changes.
-- Restore the commercial validator from its canonical originating migration.
-- Keep the signing validator's existing semantics under a table-specific identity.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.enforce_commercial_agreement_tenant_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients c
                  WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'that client belongs to a different workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_products p
                  WHERE p.id = NEW.offer_id AND p.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'that offer belongs to a different workspace' USING ERRCODE = '42501';
  END IF;
  IF NEW.catalog_price_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.tenant_prices pr
                      WHERE pr.id = NEW.catalog_price_id
                        AND pr.tenant_id = NEW.tenant_id
                        AND pr.product_id = NEW.offer_id) THEN
    RAISE EXCEPTION 'that price is not a plan on this offer in this workspace' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_commercial_agreement_tenant_links() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.enforce_signing_agreement_tenant_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients c
                  WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'that client belongs to a different workspace' USING ERRCODE = '42501';
  END IF;

  IF NEW.offer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.tenant_products p
                      WHERE p.id = NEW.offer_id AND p.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'that offer belongs to a different workspace' USING ERRCODE = '42501';
  END IF;

  IF NEW.commercial_terms_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.tenant_client_agreements a
                      WHERE a.id = NEW.commercial_terms_id
                        AND a.tenant_id = NEW.tenant_id
                        AND a.contact_id = NEW.contact_id) THEN
    RAISE EXCEPTION 'those commercial terms belong to a different workspace or a different client'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.source_version_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.tenant_agreement_versions v
                      WHERE v.id = NEW.source_version_id AND v.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'that agreement template belongs to a different workspace' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_signing_agreement_tenant_links() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_agreement_tenant_links ON public.tenant_client_agreements;
CREATE TRIGGER trg_agreement_tenant_links BEFORE INSERT OR UPDATE ON public.tenant_client_agreements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_commercial_agreement_tenant_links();
DROP TRIGGER IF EXISTS trg_agreement_tenant_links ON public.paige_agreements;
CREATE TRIGGER trg_agreement_tenant_links BEFORE INSERT OR UPDATE ON public.paige_agreements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_signing_agreement_tenant_links();
-- The historical helper is retained unmodified for compatibility, but neither table uses it.
-- Snapshot, seal, status-forward, signer and event guards are untouched.
COMMIT;
