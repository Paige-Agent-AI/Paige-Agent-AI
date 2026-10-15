-- Extends canonical message bindings; no new queue, ledger or provider registry.
CREATE OR REPLACE FUNCTION public.prepare_sales_invoice_channel_delivery(_actor_user_id uuid,_expected_tenant_id uuid,_invoice_id uuid,_expected_version bigint,_operation_id uuid,_connector_id uuid,_subject text,_body_html text,_content_digest text,_governance jsonb,_channel text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.paige_invoices%ROWTYPE; c public.channel_connectors%ROWTYPE; m public.messages%ROWTYPE; b jsonb; cmd jsonb; recipient text;
BEGIN
 IF _channel IS NULL OR _channel NOT IN ('email','sms') THEN RAISE EXCEPTION 'Unsupported invoice channel' USING ERRCODE='22023'; END IF;
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,CASE WHEN _channel='sms' THEN 'invoice.sms_send' ELSE 'invoice.email_send' END,'billing_send_invoice',_governance);
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81742));
 IF EXISTS(SELECT 1 FROM public.paige_invoice_operations WHERE id=_operation_id) THEN RAISE EXCEPTION 'Operation belongs to another invoice action' USING ERRCODE='22023'; END IF;
 cmd:=jsonb_build_object('action',CASE WHEN _channel='sms' THEN 'invoice.sms_send' ELSE 'invoice.email_send' END,'invoice_id',_invoice_id,'expected_version',_expected_version,'connector_id',_connector_id);
 SELECT * INTO r FROM public.paige_invoices WHERE id=_invoice_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 SELECT * INTO m FROM public.messages WHERE tenant_id=_expected_tenant_id AND meta#>>'{sales_invoice_binding,operation_id}'=_operation_id::text;
 IF FOUND THEN
  b:=m.meta->'sales_invoice_binding';
  IF b->>'actor_user_id' IS DISTINCT FROM _actor_user_id::text OR b->'command' IS DISTINCT FROM cmd OR b->>'content_digest' IS DISTINCT FROM _content_digest THEN RAISE EXCEPTION 'Delivery replay mismatch' USING ERRCODE='22023'; END IF;
  RETURN b||jsonb_build_object('message_id',m.id,'recipient',m.recipients->0->>'address','client_id',m.contact_id,'replayed',true);
 END IF;
 IF r.id IS NULL OR r.status<>'issued' OR r.billing_lifecycle_version IS DISTINCT FROM _expected_version OR (public._sales_invoice_read(_expected_tenant_id,r.id)->>'remaining_cents')::bigint<=0 THEN RAISE EXCEPTION 'Issued invoice changed' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.messages WHERE tenant_id=_expected_tenant_id AND meta#>>'{sales_invoice_binding,invoice_id}'=_invoice_id::text
  AND meta#>>'{sales_invoice_binding,issued_snapshot_version}'=r.billing_issued_snapshot_version::text AND meta#>>'{sales_invoice_binding,state}' IN ('dispatching','unknown')) THEN RAISE EXCEPTION 'Unknown delivery requires reconciliation' USING ERRCODE='55000'; END IF;
 IF _channel='email' THEN
 SELECT * INTO c FROM public.channel_connectors WHERE id=_connector_id AND tenant_id=_expected_tenant_id;
 IF c.id IS NULL OR c.active IS DISTINCT FROM true OR c.status<>'active' OR c.channel_type<>'email' OR c.provider NOT IN ('resend','gmail','smtp') OR coalesce(length(trim(c.from_address)),0)=0 THEN RAISE EXCEPTION 'Business sender unavailable' USING ERRCODE='42501'; END IF;
 ELSE
 IF _connector_id IS NOT NULL THEN RAISE EXCEPTION 'SMS resolves tenant sender automatically' USING ERRCODE='22023'; END IF;
 END IF;
 recipient:=r.billing_document#>>CASE WHEN _channel='sms' THEN '{snapshot,recipient_phone}'::text[] ELSE '{snapshot,recipient_email}'::text[] END;
 IF recipient IS NULL OR (_channel='email' AND recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') OR (_channel='sms' AND recipient !~ '^\+[1-9][0-9]{6,14}$') OR length(recipient)>320
  OR _subject IS NULL OR length(_subject)>200 OR _subject ~ E'[\r\n]' OR _body_html IS NULL OR length(_body_html)>100000 OR (_channel='sms' AND length(_body_html)>1400)
  OR (length(_body_html)-length(replace(_body_html,'{{PAIGE_INVOICE_LINK}}','')))/length('{{PAIGE_INVOICE_LINK}}')<>1
  OR _body_html LIKE '%?token=%' OR _content_digest IS DISTINCT FROM encode(extensions.digest(convert_to(_subject||E'\n'||_body_html||E'\n'||r.billing_document_digest||E'\n'||r.billing_issued_snapshot_version::text,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'Delivery content invalid' USING ERRCODE='22023'; END IF;
 b:=jsonb_build_object('operation_id',_operation_id,'tenant_id',_expected_tenant_id,'invoice_id',r.id,'client_id',r.contact_id,'actor_user_id',_actor_user_id,
  'issued_snapshot_version',r.billing_issued_snapshot_version,'document_digest',r.billing_document_digest,'content_digest',_content_digest,'connector_id',_connector_id,
  'channel',_channel,'state','prepared','expected_lifecycle_version',_expected_version,'command',cmd,'governance',_governance);
 INSERT INTO public.messages(tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,recipients,subject,body_html,body_text,meta)
 VALUES(_expected_tenant_id,r.contact_id,_connector_id,'contact:'||_expected_tenant_id::text||':'||r.contact_id::text,_channel,'outbound','draft',jsonb_build_array(jsonb_build_object('address',recipient)),_subject,CASE WHEN _channel='email' THEN _body_html END,CASE WHEN _channel='sms' THEN _body_html END,jsonb_build_object('sales_invoice_binding',b)) RETURNING * INTO m;
 RETURN b||jsonb_build_object('message_id',m.id,'recipient',recipient,'client_id',r.contact_id,'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.read_sales_invoice_delivery_binding(_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; r public.paige_invoices%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 b:=m.meta->'sales_invoice_binding'; IF b IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.paige_invoices WHERE id=(b->>'invoice_id')::uuid AND tenant_id=m.tenant_id;
 SELECT * INTO c FROM public.channel_connectors WHERE id=m.connector_id AND tenant_id=m.tenant_id;
 PERFORM public._sales_invoice_actor((b->>'actor_user_id')::uuid,m.tenant_id);
 RETURN b||jsonb_build_object('message_id',m.id,'recipient',m.recipients->0->>'address','subject',m.subject,'body_html',coalesce(m.body_html,m.body_text),'channel',m.channel_type,
  'eligible',b->>'state'='prepared' AND m.status='draft' AND m.channel_type IN ('email','sms') AND m.direction='outbound' AND r.status='issued'
   AND r.billing_issued_snapshot_version=(b->>'issued_snapshot_version')::bigint AND r.billing_document_digest=b->>'document_digest'
   AND r.billing_lifecycle_version=(b->>'expected_lifecycle_version')::bigint AND (public._sales_invoice_read(m.tenant_id,r.id)->>'remaining_cents')::bigint>0
   AND m.contact_id=r.contact_id AND m.connector_id IS NOT DISTINCT FROM (b->>'connector_id')::uuid
   AND m.recipients->0->>'address'=r.billing_document#>>CASE WHEN m.channel_type='sms' THEN '{snapshot,recipient_phone}'::text[] ELSE '{snapshot,recipient_email}'::text[] END
   AND (m.channel_type='sms' OR (c.active=true AND c.status='active' AND c.channel_type='email' AND c.provider IN ('resend','gmail','smtp') AND length(trim(c.from_address))>0)));
END $$;


REVOKE ALL ON FUNCTION public.prepare_sales_invoice_channel_delivery(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_sales_invoice_channel_delivery(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,jsonb,text) TO service_role;
CREATE OR REPLACE FUNCTION public.preview_sales_invoice_delivery_command(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.paige_invoices%ROWTYPE; c public.channel_connectors%ROWTYPE; facts jsonb;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 SELECT * INTO r FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id;
 SELECT * INTO c FROM public.channel_connectors WHERE id=(_command->>'connector_id')::uuid AND tenant_id=_expected_tenant_id;
 IF r.id IS NOT NULL THEN facts:=public._sales_invoice_read(_expected_tenant_id,r.id); END IF;
 RETURN jsonb_build_object('eligible',r.id IS NOT NULL AND r.status='issued' AND r.billing_lifecycle_version=(_command->>'expected_version')::bigint
  AND r.billing_issued_snapshot_version IS NOT NULL AND r.billing_document_digest ~ '^[0-9a-f]{64}$' AND (facts->>'remaining_cents')::bigint>0
  AND ((_command->>'action'='invoice.sms_send' AND coalesce(r.billing_document#>>'{snapshot,recipient_phone}','') ~ '^\+[1-9][0-9]{6,14}$') OR (_command->>'action'='invoice.email_send' AND coalesce(r.billing_document#>>'{snapshot,recipient_email}','') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND c.id IS NOT NULL AND c.active=true AND c.status='active' AND c.channel_type='email' AND c.provider IN ('resend','gmail','smtp') AND length(trim(c.from_address))>0)),
  'summary',CASE WHEN _command->>'action'='invoice.sms_send' THEN 'Send the issued invoice using tenant SMS after recipient consent and registration checks.' ELSE 'Send the issued invoice using the selected business email connection.' END,'remaining_cents',facts->'remaining_cents','manual_recorded_cents',facts->'manual_recorded_cents');
END $$;


