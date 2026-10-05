-- S2: server-frozen catalog facts extend the existing canonical draft command and operation.
-- No model price override, Catalog writer, second invoice ledger or financial calculator.
CREATE OR REPLACE FUNCTION public.read_sales_invoice_draft_catalog(
 _actor_user_id uuid,_expected_tenant_id uuid,_draft jsonb,_lock boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ids uuid[]; facts jsonb; expected integer;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF jsonb_typeof(_draft->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(_draft->'items') NOT BETWEEN 1 AND 50 OR octet_length(_draft::text)>60000 THEN
  RAISE EXCEPTION 'Invalid catalog draft' USING ERRCODE='22023'; END IF;
 SELECT array_agg(DISTINCT (line->>'price_id')::uuid ORDER BY (line->>'price_id')::uuid) INTO ids
 FROM jsonb_array_elements(_draft->'items') line WHERE line->>'price_id' IS NOT NULL;
 expected:=coalesce(array_length(ids,1),0);
 IF expected<1 OR expected>50 THEN RAISE EXCEPTION 'Selected catalog prices required' USING ERRCODE='22023'; END IF;
 IF _lock THEN
  -- Match the Catalog writer's product-before-price lock order, retaining locks through save.
  PERFORM p.id FROM public.tenant_products p WHERE p.tenant_id=_expected_tenant_id AND p.id IN
   (SELECT tp.product_id FROM public.tenant_prices tp WHERE tp.tenant_id=_expected_tenant_id AND tp.id=ANY(ids)) ORDER BY p.id FOR SHARE;
  PERFORM tp.id FROM public.tenant_prices tp WHERE tp.tenant_id=_expected_tenant_id AND tp.id=ANY(ids) ORDER BY tp.id FOR SHARE;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('price_id',tp.id,'product_id',p.id,'product_name',p.name,
   'unit_minor',tp.unit_amount,'currency',lower(tp.currency),'kind',tp.kind,'billing_interval',tp.billing_interval,
   'interval_count',tp.interval_count,'installments_total',tp.installments_total,'active',tp.active,'product_status',p.status)
   ORDER BY tp.id),'[]'::jsonb) INTO facts
 FROM public.tenant_prices tp JOIN public.tenant_products p ON p.id=tp.product_id AND p.tenant_id=tp.tenant_id
 WHERE tp.tenant_id=_expected_tenant_id AND tp.id=ANY(ids) AND tp.active AND p.status='active'
  AND char_length(p.name) BETWEEN 1 AND 200 AND lower(tp.currency)='usd' AND tp.unit_amount BETWEEN 1 AND 2147483647
  AND tp.installments_total IS NULL AND CASE WHEN _draft->>'kind'='recurring' THEN
   tp.kind='recurring' AND tp.billing_interval='month' AND tp.interval_count=1
   ELSE tp.kind='one_time' AND tp.billing_interval='one_time' END;
 IF jsonb_array_length(facts)<>expected THEN RAISE EXCEPTION 'Selected price unavailable or unsupported; clarify terms' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('tenant_id',_expected_tenant_id,'prices',facts);
END $$;
REVOKE ALL ON FUNCTION public.read_sales_invoice_draft_catalog(uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_draft_catalog(uuid,uuid,jsonb,boolean) TO service_role;

-- Historical replay matches the exact owner intent, excluding only server-origin catalog facts.
-- The execution reader still compares the complete approved command including those facts.
CREATE OR REPLACE FUNCTION public.read_sales_invoice_draft_intent_result(
 _actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_operations%ROWTYPE;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF _command->>'action' IS NULL OR _command->>'action' NOT IN ('invoice.draft_create','invoice.draft_revise') OR _command ? 'catalog_prices' THEN
  RAISE EXCEPTION 'Draft replay intent required' USING ERRCODE='22023'; END IF;
 SELECT * INTO op FROM public.paige_invoice_operations WHERE id=_operation_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF op.actor_user_id IS DISTINCT FROM _actor_user_id OR op.tenant_id IS DISTINCT FROM _expected_tenant_id
  OR (op.command-'catalog_prices') IS DISTINCT FROM _command THEN RAISE EXCEPTION 'Operation reused with different intent' USING ERRCODE='22023'; END IF;
 RETURN op.result;
END $$;
REVOKE ALL ON FUNCTION public.read_sales_invoice_draft_intent_result(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_draft_intent_result(uuid,uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.execute_sales_invoice_draft_command(
 _actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb,_governance jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE action text:=_command->>'action';tool text;lane text;channel text:=_governance->>'approval_channel';
 prior jsonb;result jsonb;saved jsonb;invoice uuid;expected bigint;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF _operation_id IS NULL OR jsonb_typeof(_command) IS DISTINCT FROM 'object' OR octet_length(_command::text)>65000
  OR action NOT IN ('invoice.draft_create','invoice.draft_revise') OR action IS NULL
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k NOT IN ('action','invoice_id','expected_version','draft','catalog_prices'))
  OR jsonb_typeof(_command->'draft') IS DISTINCT FROM 'object'
  OR coalesce(_command->>'expected_version','') !~ '^(0|[1-9][0-9]{0,17})$' THEN
  RAISE EXCEPTION 'Invalid governed invoice draft' USING ERRCODE='22023'; END IF;
 invoice:=(_command->>'invoice_id')::uuid;expected:=(_command->>'expected_version')::bigint;
 IF invoice IS NULL OR (action='invoice.draft_create' AND expected<>0) OR (action='invoice.draft_revise' AND expected<1) THEN
  RAISE EXCEPTION 'Invalid governed draft identity' USING ERRCODE='22023'; END IF;
 tool:=CASE action WHEN 'invoice.draft_create' THEN 'billing_create_invoice' ELSE 'sales_revise_invoice_draft' END;
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81742));
 -- Same immutable operation ledger and historical result reader used by issued-invoice acts.
 prior:=public.read_sales_invoice_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF EXISTS(SELECT 1 FROM public.messages WHERE meta#>>'{sales_invoice_binding,operation_id}'=_operation_id::text) THEN
  RAISE EXCEPTION 'Operation already belongs to delivery' USING ERRCODE='22023'; END IF;
 IF _governance->>'actor_user_id' IS DISTINCT FROM _actor_user_id::text
  OR _governance->>'tenant_id' IS DISTINCT FROM _expected_tenant_id::text OR _governance->>'tool' IS DISTINCT FROM tool
  OR _governance->>'action' IS DISTINCT FROM action OR _governance->'decision_receipt_recorded' IS DISTINCT FROM 'true'::jsonb
  OR channel IS NULL OR channel NOT IN ('operator_card','standing_autonomy_setting') THEN
  RAISE EXCEPTION 'Canonical draft decision required' USING ERRCODE='42501'; END IF;
 lane:=public.resolve_tool_autonomy(_expected_tenant_id,tool);
 IF lane IS NULL OR lane NOT IN ('auto','confirm') OR (lane='confirm' AND channel<>'operator_card')
  OR (channel='operator_card' AND coalesce(_governance->>'approved_fingerprint','') !~ '^[0-9a-f]{16}$') THEN
  RAISE EXCEPTION 'Canonical draft authority unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_command#>'{draft,items}') line WHERE line->>'price_id' IS NOT NULL) THEN
  IF _command->'catalog_prices' IS DISTINCT FROM public.read_sales_invoice_draft_catalog(_actor_user_id,_expected_tenant_id,_command->'draft',true)->'prices' THEN
   RAISE EXCEPTION 'Reviewed catalog facts changed; request fresh review' USING ERRCODE='40001'; END IF;
 ELSIF _command ? 'catalog_prices' THEN RAISE EXCEPTION 'Unexpected catalog facts' USING ERRCODE='22023'; END IF;
 saved:=public._save_sales_billing_draft(_actor_user_id,_expected_tenant_id,invoice,expected,_operation_id,_command->'draft');
 PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,tool,'capability_succeeded',_operation_id,NULL);
 result:=jsonb_build_object('ok',true,'outcome',CASE action WHEN 'invoice.draft_create' THEN 'draft_created' ELSE 'draft_revised' END,
  'row',public._sales_invoice_read(_expected_tenant_id,invoice),'operation',jsonb_build_object('id',_operation_id,'action',action));
 IF result#>>'{row,status}' IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Draft readback unavailable' USING ERRCODE='55000'; END IF;
 INSERT INTO public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result)
 VALUES(_operation_id,_expected_tenant_id,invoice,_actor_user_id,_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.execute_sales_invoice_draft_command(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sales_invoice_draft_command(uuid,uuid,uuid,jsonb,jsonb) TO service_role;


