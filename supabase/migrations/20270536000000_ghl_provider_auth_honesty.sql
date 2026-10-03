-- The GHL provider-descriptor corrections (owner direction 2026-10-03: "perfect the GHL
-- connection — double-check their requirements and compare to what we have built"; revised
-- after external review of the first draft).
--
-- THE COMPARISON, grounded on GHL's own documentation: PAIGE's VERIFIED connection path is
-- the universal endpoint https://services.leadconnectorhq.com/mcp/ with a Private
-- Integration Token as the bearer credential (sub-account → Settings → Private
-- Integrations; the PIT's scopes govern which MCP tools are offered) PLUS a locationId
-- header on every call. GHL's client-specific OAuth surfaces (the /mcp/<client>/v2
-- endpoints) EXIST but are NOT YET VERIFIED for PAIGE — the owner's 2026-10-02 attempt
-- through GHL's own lc-mcp marketplace consent died at their Invalid-scope(s) bug. Nothing
-- here claims GHL universally lacks OAuth; the descriptor narrows to the PAIGE-SUPPORTED
-- surface, and re-adding the oauth facet later is a one-line change after an end-to-end
-- proof against the runbook.
--
-- THREE objects:
--   1. A GENERIC mechanism — mcp_providers.required_custom_headers: header names a
--      bearer/header connection of this provider MUST carry (case-insensitive). Enforced
--      by ONE trigger home on mcp_connections, so EVERY writer (create, re-key, and any
--      future one) is covered without reproducing writer bodies: a provider declares
--      metadata, never a code branch.
--   2. The gohighlevel row goes honest: auth_kinds '{bearer}' (the verified surface),
--      resource_url_shape '/mcp/', required_custom_headers '{locationId}'.
--   3. The trigger itself — decrypts the row's header bundle only inside the definer,
--      raises the closed code MCP_MISSING_REQUIRED_HEADER naming the missing header
--      NAMES (never header VALUES — values are credential material).

ALTER TABLE public.mcp_providers
  ADD COLUMN IF NOT EXISTS required_custom_headers text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.mcp_providers.required_custom_headers IS
 'Header names (case-insensitive) that a bearer/header connection for this provider MUST include in its custom-header bundle. Enforced by the trg_mcp_provider_required_headers trigger on mcp_connections — a provider declares metadata, never a code branch.';

UPDATE public.mcp_providers
SET auth_kinds = '{bearer}',
    resource_url_shape = '/mcp/',
    required_custom_headers = '{locationId}',
    updated_at = now(),
    notes = 'Go High Level (LeadConnector) MCP — PAIGE''s VERIFIED path: the universal endpoint https://services.leadconnectorhq.com/mcp/ with a Private Integration Token as the bearer (sub-account → Settings → Private Integrations; the PIT''s scopes govern which MCP tools are offered) PLUS a locationId custom header (enforced at the connection write). GHL''s client-specific OAuth surfaces (/mcp/<client>/v2) exist but are NOT YET VERIFIED for PAIGE — the facet stays off this descriptor until an end-to-end proof lands. CRM lane: contacts, conversations, opportunities, calendars.'
WHERE provider_key = 'gohighlevel';

CREATE OR REPLACE FUNCTION public._mcp_enforce_provider_required_headers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  required text[];
  present  text;
  headers  jsonb;
  missing  text[];
BEGIN
  -- Only the executable credential-bearing facets carry a custom-header bundle contract.
  IF NEW.auth_kind NOT IN ('bearer', 'header') THEN RETURN NEW; END IF;

  SELECT required_custom_headers INTO required
  FROM public.mcp_providers WHERE provider_key = NEW.provider_key;
  IF required IS NULL OR array_length(required, 1) IS NULL THEN RETURN NEW; END IF;

  headers := CASE
    WHEN NEW.custom_headers_ct IS NULL THEN '{}'::jsonb
    ELSE public.platform_decrypt(NEW.custom_headers_ct)::jsonb
  END;

  missing := ARRAY(
    SELECT r FROM unnest(required) r
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_object_keys(headers) k WHERE lower(k) = lower(r)
    )
  );
  IF array_length(missing, 1) IS NOT NULL THEN
    -- Names only: a header VALUE is credential material and never crosses into an error.
    RAISE EXCEPTION 'MCP_MISSING_REQUIRED_HEADER: %', array_to_string(missing, ', ')
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mcp_provider_required_headers ON public.mcp_connections;
CREATE TRIGGER trg_mcp_provider_required_headers
  BEFORE INSERT OR UPDATE OF auth_kind, custom_headers_ct, provider_key
  ON public.mcp_connections
  FOR EACH ROW EXECUTE FUNCTION public._mcp_enforce_provider_required_headers();

REVOKE ALL ON FUNCTION public._mcp_enforce_provider_required_headers() FROM PUBLIC, anon, authenticated;
