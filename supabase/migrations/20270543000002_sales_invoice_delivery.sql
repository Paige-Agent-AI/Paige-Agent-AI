-- Governed invoice email reuses messages, the canonical gate and hash-only invoice grants.
-- No queue, provider store or approval authority is created here.
CREATE UNIQUE INDEX IF NOT EXISTS messages_sales_invoice_operation
 ON public.messages ((meta#>>'{sales_invoice_binding,operation_id}'))
 WHERE meta ? 'sales_invoice_binding';

CREATE OR REPLACE FUNCTION public._sales_invoice_message_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NOT NULL AND (NEW.meta ? 'sales_invoice_binding' OR (TG_OP='UPDATE' AND OLD.meta ? 'sales_invoice_binding')) THEN
  RAISE EXCEPTION 'Invoice messages use the governed sender' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_message_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sales_invoice_message_guard ON public.messages;
CREATE TRIGGER sales_invoice_message_guard BEFORE INSERT OR UPDATE ON public.messages
 FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_message_guard();

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
  AND coalesce(r.billing_document#>>'{snapshot,recipient_email}','') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  AND c.id IS NOT NULL AND c.active=true AND c.status='active' AND c.channel_type='email' AND c.provider IN ('resend','gmail','smtp') AND length(trim(c.from_address))>0,
  'summary','Send the issued invoice using the selected business email connection.','remaining_cents',facts->'remaining_cents','manual_recorded_cents',facts->'manual_recorded_cents');
END $$;

CREATE OR REPLACE FUNCTION public.read_sales_invoice_delivery_result(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 SELECT * INTO m FROM public.messages WHERE tenant_id=_expected_tenant_id AND meta#>>'{sales_invoice_binding,operation_id}'=_operation_id::text;
 IF NOT FOUND THEN RETURN NULL; END IF;
 b:=m.meta->'sales_invoice_binding';
 IF b->>'actor_user_id' IS DISTINCT FROM _actor_user_id::text OR b->'command' IS DISTINCT FROM _command THEN RAISE EXCEPTION 'Delivery replay mismatch' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('ok',b->>'state'='provider_accepted','outcome',b->>'state','operation_id',_operation_id,'message_id',m.id,'provider_receipt_available',m.provider_message_id IS NOT NULL,'delivery_confirmed',false);
END $$;

CREATE OR REPLACE FUNCTION public.prepare_sales_invoice_delivery(_actor_user_id uuid,_expected_tenant_id uuid,_invoice_id uuid,_expected_version bigint,_operation_id uuid,_connector_id uuid,_subject text,_body_html text,_content_digest text,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.paige_invoices%ROWTYPE; c public.channel_connectors%ROWTYPE; m public.messages%ROWTYPE; b jsonb; cmd jsonb; recipient text;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,'invoice.email_send','billing_send_invoice',_governance);
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81742));
 IF EXISTS(SELECT 1 FROM public.paige_invoice_operations WHERE id=_operation_id) THEN RAISE EXCEPTION 'Operation belongs to another invoice action' USING ERRCODE='22023'; END IF;
 cmd:=jsonb_build_object('action','invoice.email_send','invoice_id',_invoice_id,'expected_version',_expected_version,'connector_id',_connector_id);
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
 SELECT * INTO c FROM public.channel_connectors WHERE id=_connector_id AND tenant_id=_expected_tenant_id;
 IF c.id IS NULL OR c.active IS DISTINCT FROM true OR c.status<>'active' OR c.channel_type<>'email' OR c.provider NOT IN ('resend','gmail','smtp') OR coalesce(length(trim(c.from_address)),0)=0 THEN RAISE EXCEPTION 'Business sender unavailable' USING ERRCODE='42501'; END IF;
 recipient:=r.billing_document#>>'{snapshot,recipient_email}';
 IF recipient IS NULL OR recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(recipient)>320
  OR _subject IS NULL OR length(_subject)>200 OR _subject ~ E'[\r\n]' OR _body_html IS NULL OR length(_body_html)>100000
  OR (length(_body_html)-length(replace(_body_html,'{{PAIGE_INVOICE_LINK}}','')))/length('{{PAIGE_INVOICE_LINK}}')<>1
  OR _body_html LIKE '%?token=%' OR _content_digest IS DISTINCT FROM encode(extensions.digest(convert_to(_subject||E'\n'||_body_html||E'\n'||r.billing_document_digest||E'\n'||r.billing_issued_snapshot_version::text,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'Delivery content invalid' USING ERRCODE='22023'; END IF;
 b:=jsonb_build_object('operation_id',_operation_id,'tenant_id',_expected_tenant_id,'invoice_id',r.id,'client_id',r.contact_id,'actor_user_id',_actor_user_id,
  'issued_snapshot_version',r.billing_issued_snapshot_version,'document_digest',r.billing_document_digest,'content_digest',_content_digest,'connector_id',_connector_id,
  'state','prepared','expected_lifecycle_version',_expected_version,'command',cmd,'governance',_governance);
 INSERT INTO public.messages(tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,recipients,subject,body_html,meta)
 VALUES(_expected_tenant_id,r.contact_id,_connector_id,'contact:'||_expected_tenant_id::text||':'||r.contact_id::text,'email','outbound','draft',jsonb_build_array(jsonb_build_object('address',recipient)),_subject,_body_html,jsonb_build_object('sales_invoice_binding',b)) RETURNING * INTO m;
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
 RETURN b||jsonb_build_object('message_id',m.id,'recipient',m.recipients->0->>'address','subject',m.subject,'body_html',m.body_html,
  'eligible',b->>'state'='prepared' AND m.status='draft' AND m.channel_type='email' AND m.direction='outbound' AND r.status='issued'
   AND r.billing_issued_snapshot_version=(b->>'issued_snapshot_version')::bigint AND r.billing_document_digest=b->>'document_digest'
   AND r.billing_lifecycle_version=(b->>'expected_lifecycle_version')::bigint AND (public._sales_invoice_read(m.tenant_id,r.id)->>'remaining_cents')::bigint>0
   AND m.contact_id=r.contact_id AND m.connector_id=(b->>'connector_id')::uuid
   AND m.recipients->0->>'address'=r.billing_document#>>'{snapshot,recipient_email}'
   AND c.active=true AND c.status='active' AND c.channel_type='email' AND c.provider IN ('resend','gmail','smtp') AND length(trim(c.from_address))>0);
END $$;

CREATE OR REPLACE FUNCTION public.claim_sales_invoice_delivery(_message_id uuid,_operation_id uuid,_grant_id uuid,_token_hash text,_expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb; facts jsonb;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 PERFORM public._sales_invoice_actor((m.meta#>>'{sales_invoice_binding,actor_user_id}')::uuid,m.tenant_id);
 PERFORM 1 FROM public.paige_invoices WHERE id=(m.meta#>>'{sales_invoice_binding,invoice_id}')::uuid AND tenant_id=m.tenant_id FOR UPDATE;
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE;
 facts:=public.read_sales_invoice_delivery_binding(_message_id); b:=m.meta->'sales_invoice_binding';
 IF facts->'eligible' IS DISTINCT FROM 'true'::jsonb OR b->>'operation_id' IS DISTINCT FROM _operation_id::text OR _grant_id IS NULL
  OR coalesce(_token_hash,'') !~ '^[0-9a-f]{64}$' OR _expires_at<=now() OR _expires_at>now()+interval '30 days' THEN RAISE EXCEPTION 'Delivery claim refused' USING ERRCODE='42501'; END IF;
 -- The invoice lock serializes admission across distinct approved operations.
 -- Preparation alone does not establish that another attempt is safe to send.
 IF EXISTS (SELECT 1 FROM public.messages other WHERE other.tenant_id=m.tenant_id AND other.id<>m.id
   AND other.meta#>>'{sales_invoice_binding,invoice_id}'=b->>'invoice_id'
   AND other.meta#>>'{sales_invoice_binding,issued_snapshot_version}'=b->>'issued_snapshot_version'
   AND other.meta#>>'{sales_invoice_binding,state}' IN ('dispatching','unknown')) THEN
  RAISE EXCEPTION 'Another invoice delivery requires readback' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.paige_invoice_access_grants(id,tenant_id,invoice_id,issued_snapshot_version,scope,delivery_operation_id,token_hash,expires_at,actor_user_id)
 VALUES(_grant_id,m.tenant_id,(b->>'invoice_id')::uuid,(b->>'issued_snapshot_version')::bigint,'delivery',_operation_id,_token_hash,_expires_at,(b->>'actor_user_id')::uuid);
 UPDATE public.messages SET meta=jsonb_set(meta,'{sales_invoice_binding,state}','"dispatching"'),error=NULL WHERE id=m.id;
 RETURN facts||jsonb_build_object('state','dispatching','grant_id',_grant_id);
END $$;

CREATE OR REPLACE FUNCTION public.finalize_sales_invoice_delivery(_message_id uuid,_operation_id uuid,_outcome text,_provider_message_id text,_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb; state text;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE; b:=m.meta->'sales_invoice_binding'; state:=b->>'state';
 IF b IS NULL OR b->>'operation_id' IS DISTINCT FROM _operation_id::text OR _outcome IS NULL OR _outcome NOT IN ('provider_accepted','unknown','failed') THEN RAISE EXCEPTION 'Delivery receipt invalid' USING ERRCODE='22023'; END IF;
 IF state IN ('provider_accepted','unknown','failed') THEN
  IF state IS DISTINCT FROM _outcome THEN RAISE EXCEPTION 'Delivery receipt conflicts' USING ERRCODE='40001'; END IF;
 ELSE
  IF NOT(state='dispatching' OR (state='prepared' AND _outcome='failed')) THEN RAISE EXCEPTION 'Delivery not claimed' USING ERRCODE='42501'; END IF;
  IF _outcome='provider_accepted' AND (m.status<>'sent' OR m.provider_message_id IS DISTINCT FROM _provider_message_id OR _provider_message_id IS NULL) THEN RAISE EXCEPTION 'Provider readback missing' USING ERRCODE='55000'; END IF;
  UPDATE public.messages SET meta=jsonb_set(meta,'{sales_invoice_binding,state}',to_jsonb(_outcome)),status=CASE WHEN _outcome='provider_accepted' THEN status ELSE 'failed' END,error=CASE WHEN _outcome='provider_accepted' THEN NULL ELSE 'Invoice delivery requires review' END WHERE id=m.id;
  PERFORM public.record_capability_run(m.tenant_id,(b->>'actor_user_id')::uuid,'billing_send_invoice',CASE WHEN _outcome='provider_accepted' THEN 'capability_succeeded' WHEN _outcome='unknown' THEN 'capability_outcome_unknown' ELSE 'capability_failed' END,_operation_id,NULL);
 END IF;
 RETURN jsonb_build_object('ok',_outcome='provider_accepted','outcome',_outcome,'operation_id',_operation_id,'message_id',m.id,'delivery_confirmed',false);
END $$;

REVOKE ALL ON FUNCTION public.preview_sales_invoice_delivery_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_sales_invoice_delivery_command(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.read_sales_invoice_delivery_result(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_delivery_result(uuid,uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_sales_invoice_delivery(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_sales_invoice_delivery(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.read_sales_invoice_delivery_binding(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_delivery_binding(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_sales_invoice_delivery(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sales_invoice_delivery(uuid,uuid,uuid,text,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_sales_invoice_delivery(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_sales_invoice_delivery(uuid,uuid,text,text,text) TO service_role;

-- Human UI discovery only; connector credentials and configuration remain private.
CREATE OR REPLACE FUNCTION public.list_sales_invoice_senders(_expected_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb;
BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'provider',c.provider,'from_address',c.from_address) ORDER BY c.id),'[]'::jsonb) INTO rows
 FROM public.channel_connectors c WHERE c.tenant_id=_expected_tenant_id AND c.active=true AND c.status='active'
 AND c.channel_type='email' AND c.provider IN ('resend','gmail','smtp') AND coalesce(length(trim(c.from_address)),0)>0;
 RETURN rows;
END $$;
REVOKE ALL ON FUNCTION public.list_sales_invoice_senders(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_sales_invoice_senders(uuid) TO authenticated;
