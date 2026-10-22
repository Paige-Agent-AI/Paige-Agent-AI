-- EXP09 exact customer intent over the original EXP04 read-only financial sources.
-- The existing billing helper owns Auth, relationship and SHARE lock order. No writer or DTO changes.
BEGIN;

CREATE FUNCTION public.client_portal_invoices_scoped(p_tenant_id uuid, p_expected_client_id uuid, p_limit integer DEFAULT 20, p_after jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $native$
BEGIN
  IF p_tenant_id IS NULL OR p_expected_client_id IS NULL THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  -- This SAME original helper holds the actual customer through the original reader and transaction.
  -- Do not substitute a frontend identity, Account write lock, new permission rule or ledger.
  IF public._client_portal_billing_client(p_tenant_id) IS DISTINCT FROM p_expected_client_id THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN public.client_portal_invoices(p_tenant_id,p_limit,p_after);
END;
$native$;
REVOKE ALL ON FUNCTION public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb) TO authenticated;

CREATE FUNCTION public.client_portal_invoice_ledger_scoped(p_invoice_id uuid, p_tenant_id uuid, p_expected_client_id uuid, _limit integer DEFAULT 100, _cursor jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $native$
BEGIN
  IF p_tenant_id IS NULL OR p_expected_client_id IS NULL THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  -- This SAME original helper holds the actual customer through the original reader and transaction.
  -- Do not substitute a frontend identity, Account write lock, new permission rule or ledger.
  IF public._client_portal_billing_client(p_tenant_id) IS DISTINCT FROM p_expected_client_id THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN public.client_portal_invoice_ledger(p_invoice_id,p_tenant_id,_limit,_cursor);
END;
$native$;
REVOKE ALL ON FUNCTION public.client_portal_invoice_ledger_scoped(uuid,uuid,uuid,integer,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_invoice_ledger_scoped(uuid,uuid,uuid,integer,jsonb) TO authenticated;

CREATE FUNCTION public.client_portal_invoice_payment_request_scoped(p_invoice_id uuid, p_tenant_id uuid, p_expected_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $native$
BEGIN
  IF p_tenant_id IS NULL OR p_expected_client_id IS NULL THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  -- This SAME original helper holds the actual customer through the original reader and transaction.
  -- Do not substitute a frontend identity, Account write lock, new permission rule or ledger.
  IF public._client_portal_billing_client(p_tenant_id) IS DISTINCT FROM p_expected_client_id THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN public.client_portal_invoice_payment_request(p_invoice_id,p_tenant_id);
END;
$native$;
REVOKE ALL ON FUNCTION public.client_portal_invoice_payment_request_scoped(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_invoice_payment_request_scoped(uuid,uuid,uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
