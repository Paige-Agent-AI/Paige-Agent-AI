-- The canonical delivery claim holds the rendered invoice version until dispatch finishes.
-- Claim and commercial mutations serialize on the same invoice row. No time-based unlock:
-- an interrupted dispatcher requires canonical provider readback/finalization, never a new send.
CREATE OR REPLACE FUNCTION public._sales_invoice_dispatch_mutation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_invoice_id uuid; v_tenant_id uuid;
BEGIN
 IF TG_TABLE_NAME='paige_invoice_payments' THEN
  v_invoice_id:=NEW.invoice_id; v_tenant_id:=NEW.tenant_id;
  PERFORM 1 FROM public.paige_invoices i WHERE i.id=v_invoice_id AND i.tenant_id=v_tenant_id FOR UPDATE;
 ELSE
  IF ROW(NEW.billing_lifecycle_version,NEW.status) IS NOT DISTINCT FROM ROW(OLD.billing_lifecycle_version,OLD.status) THEN RETURN NEW; END IF;
  v_invoice_id:=OLD.id; v_tenant_id:=OLD.tenant_id;
 END IF;
 IF EXISTS(SELECT 1 FROM public.messages m WHERE m.tenant_id=v_tenant_id
   AND m.meta#>>'{sales_invoice_binding,invoice_id}'=v_invoice_id::text
   AND m.meta#>>'{sales_invoice_binding,state}'='dispatching') THEN
  RAISE EXCEPTION 'Invoice delivery is in progress. Read its delivery outcome before changing payments or invoice state.' USING ERRCODE='P5501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_dispatch_mutation_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sales_invoice_dispatch_version_guard ON public.paige_invoices;
CREATE TRIGGER sales_invoice_dispatch_version_guard BEFORE UPDATE OF billing_lifecycle_version,status ON public.paige_invoices
 FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_dispatch_mutation_guard();
DROP TRIGGER IF EXISTS sales_invoice_dispatch_receipt_guard ON public.paige_invoice_payments;
CREATE TRIGGER sales_invoice_dispatch_receipt_guard BEFORE INSERT ON public.paige_invoice_payments
 FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_dispatch_mutation_guard();
