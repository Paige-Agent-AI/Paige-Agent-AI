-- Invoice presentation lives on the canonical tenant brand. No provider action or new ledger.
CREATE OR REPLACE FUNCTION public._sales_invoice_settings_default() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT '{"prefix":"INV-","next_number":1,"padding":5,"template":"classic","accent":"#4931ac","logo_data_uri":null,"footer":"","payment_instructions":""}'::jsonb $$;

CREATE OR REPLACE FUNCTION public._sales_invoice_validate_settings(s jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE logo text; payload text; bytes bytea;
BEGIN
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR octet_length(s::text)>185000
  OR (SELECT count(*) FROM jsonb_object_keys(s))<>8
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN ('prefix','next_number','padding','template','accent','logo_data_uri','footer','payment_instructions'))
  OR jsonb_typeof(s->'prefix') IS DISTINCT FROM 'string' OR (s->>'prefix') !~ '^[A-Z0-9-]{0,20}$'
  OR jsonb_typeof(s->'next_number') IS DISTINCT FROM 'number' OR (s->>'next_number') !~ '^[1-9][0-9]{0,8}$'
  OR jsonb_typeof(s->'padding') IS DISTINCT FROM 'number' OR (s->>'padding') !~ '^[1-9]$'
  OR jsonb_typeof(s->'template') IS DISTINCT FROM 'string' OR (s->>'template') NOT IN ('classic','modern','service')
  OR jsonb_typeof(s->'accent') IS DISTINCT FROM 'string' OR (s->>'accent') !~ '^#[0-9A-Fa-f]{6}$'
  OR jsonb_typeof(s->'footer') IS DISTINCT FROM 'string' OR length(s->>'footer')>1000
  OR jsonb_typeof(s->'payment_instructions') IS DISTINCT FROM 'string' OR length(s->>'payment_instructions')>2000
  OR jsonb_typeof(s->'logo_data_uri') NOT IN ('string','null') THEN
  RAISE EXCEPTION 'Invalid invoice settings' USING ERRCODE='22023';
 END IF;
 logo:=s->>'logo_data_uri';
 IF logo IS NOT NULL THEN
  IF length(logo)>175000 OR logo !~ '^data:image/(png|jpeg);base64,([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' THEN
   RAISE EXCEPTION 'Invalid embedded invoice logo' USING ERRCODE='22023'; END IF;
  payload:=split_part(logo,',',2); bytes:=decode(payload,'base64');
  IF octet_length(bytes)>131072 OR replace(encode(bytes,'base64'),E'\n','')<>payload
   OR (logo LIKE 'data:image/png;%' AND (octet_length(bytes)<20 OR substring(bytes FROM 1 FOR 8)<>decode('89504e470d0a1a0a','hex') OR substring(bytes FROM octet_length(bytes)-7 FOR 8)<>decode('49454e44ae426082','hex')))
   OR (logo LIKE 'data:image/jpeg;%' AND (octet_length(bytes)<5 OR substring(bytes FROM 1 FOR 3)<>decode('ffd8ff','hex') OR substring(bytes FROM octet_length(bytes)-1 FOR 2)<>decode('ffd9','hex'))) THEN
   RAISE EXCEPTION 'Invalid embedded invoice logo bytes' USING ERRCODE='22023'; END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public._sales_invoice_preferences(_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p jsonb;
BEGIN
 SELECT brand->'invoice_preferences' INTO p FROM public.tenants WHERE id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
 IF p IS NULL THEN p:=jsonb_build_object('version',0,'settings',public._sales_invoice_settings_default()); END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'version','') !~ '^(0|[1-9][0-9]{0,17})$' THEN
  RAISE EXCEPTION 'Invalid stored invoice preferences' USING ERRCODE='22023'; END IF;
 PERFORM public._sales_invoice_validate_settings(p->'settings');
 RETURN jsonb_build_object('tenant_id',_tenant,'version',(p->>'version')::bigint,'settings',p->'settings','can_manage',true);
END $$;
CREATE OR REPLACE FUNCTION public.read_sales_invoice_preferences(_expected_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=auth.uid(); tenant uuid:=public.current_user_tenant_id();
BEGIN
 IF tenant IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public._sales_invoice_actor(actor,tenant);
 RETURN public._sales_invoice_preferences(tenant);
END $$;

-- Browser brand replacement cannot bypass the governed settings command.
CREATE OR REPLACE FUNCTION public._sales_invoice_brand_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.brand ? 'invoice_preferences') OR (TG_OP='UPDATE' AND NEW.brand->'invoice_preferences' IS DISTINCT FROM OLD.brand->'invoice_preferences') THEN
  IF current_user IN ('authenticated','anon') THEN RAISE EXCEPTION 'Invoice preferences require canonical approval' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_invoice_preferences_guard ON public.tenants;
CREATE TRIGGER sales_invoice_preferences_guard BEFORE INSERT OR UPDATE OF brand ON public.tenants FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_brand_guard();
DO $$ BEGIN
 IF to_regprocedure('public._sales_invoice_prior_set_tenant_brand(uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION public.set_tenant_brand(uuid,jsonb) RENAME TO _sales_invoice_prior_set_tenant_brand;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.set_tenant_brand(_tenant_id uuid,_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF _patch ? 'invoice_preferences' AND _patch->'invoice_preferences' IS DISTINCT FROM (SELECT brand->'invoice_preferences' FROM public.tenants WHERE id=_tenant_id) THEN
  RAISE EXCEPTION 'Invoice preferences require canonical approval' USING ERRCODE='42501'; END IF;
 RETURN public._sales_invoice_prior_set_tenant_brand(_tenant_id,_patch-'invoice_preferences');
END $$;

-- Existing global constraint was inappropriate for tenant-owned human numbering.
ALTER TABLE public.paige_invoices DROP CONSTRAINT IF EXISTS paige_invoices_invoice_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_tenant_number ON public.paige_invoices(tenant_id,invoice_number);
ALTER TABLE public.paige_invoice_operations ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE public.paige_invoice_operations DROP CONSTRAINT IF EXISTS sales_invoice_operation_scope;
ALTER TABLE public.paige_invoice_operations ADD CONSTRAINT sales_invoice_operation_scope CHECK
 ((invoice_id IS NULL AND command->>'action' IS NOT DISTINCT FROM 'invoice.settings_update') OR (invoice_id IS NOT NULL AND command->>'action' IS DISTINCT FROM 'invoice.settings_update'));

-- Runs before the existing frozen guard; only draft->issued, never changes issued originals.
CREATE OR REPLACE FUNCTION public._sales_invoice_publish_presentation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p jsonb; s jsonb; seq bigint; number text; t public.tenants%ROWTYPE;
BEGIN
 IF OLD.billing_draft_version IS NOT NULL AND OLD.status='draft' AND NEW.status='issued' THEN
  SELECT * INTO t FROM public.tenants WHERE id=NEW.tenant_id FOR UPDATE;
  p:=public._sales_invoice_preferences(NEW.tenant_id); s:=p->'settings'; seq:=(s->>'next_number')::bigint;
  IF seq>=999999999 THEN RAISE EXCEPTION 'Invoice sequence exhausted' USING ERRCODE='22023'; END IF;
  number:=(s->>'prefix')||lpad(seq::text,greatest(length(seq::text),(s->>'padding')::integer),'0');
  IF EXISTS(SELECT 1 FROM public.paige_invoices WHERE tenant_id=NEW.tenant_id AND invoice_number=number AND id<>NEW.id) THEN
   RAISE EXCEPTION 'Invoice number already exists in workspace' USING ERRCODE='23505'; END IF;
  NEW.invoice_number:=number;
  NEW.billing_document:=NEW.billing_document||jsonb_build_object('invoice_number',number,'renderer_version','paige-invoice-html-v2',
   'presentation',s||jsonb_build_object('template',coalesce(nullif(current_setting('sales.invoice_publish_template',true),''),s->>'template'),
    'preferences_version',p->'version','issuer_email',t.brand->'support_email','issuer_phone',t.brand->'business_phone','issuer_website',t.brand->'website','issuer_address',t.brand->'address'));
  NEW.billing_document_digest:=encode(extensions.digest(convert_to(NEW.billing_document::text,'UTF8'),'sha256'),'hex');
  UPDATE public.tenants SET brand=jsonb_set(coalesce(brand,'{}'::jsonb),'{invoice_preferences}',jsonb_build_object('version',(p->>'version')::bigint+1,'settings',jsonb_set(s,'{next_number}',to_jsonb(seq+1))),true) WHERE id=NEW.tenant_id;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_invoice_appearance ON public.paige_invoices;
CREATE TRIGGER sales_invoice_appearance BEFORE UPDATE ON public.paige_invoices FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_publish_presentation();

-- Preserve the currently installed canonical bodies; wrappers add just the settings action.
DO $$ BEGIN
 IF to_regprocedure('public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)') IS NULL THEN
  ALTER FUNCTION public.execute_sales_invoice_command(uuid,uuid,uuid,jsonb,jsonb) RENAME TO _sales_invoice_prior_execute;
  ALTER FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) RENAME TO _sales_invoice_prior_preview;
 END IF;
END $$;
-- Modify only the asserted allowed-key literal in the installed body, not a copied predecessor.
DO $$ DECLARE body text; old text:=$s$allowed:=ARRAY['action','invoice_id','expected_version'];$s$; replacement text:=$s$allowed:=ARRAY['action','invoice_id','expected_version','template'];$s$;
BEGIN
 SELECT pg_get_functiondef('public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF strpos(body,replacement)=0 THEN
  IF strpos(body,old)=0 OR (length(body)-length(replace(body,old,'')))<>length(old) THEN
   RAISE EXCEPTION 'Canonical invoice command allowed-key seam changed'; END IF;
  EXECUTE replace(body,old,replacement);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public._sales_invoice_settings_command(c jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR octet_length(c::text)>185500 OR (SELECT count(*) FROM jsonb_object_keys(c))<>3
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN ('action','expected_version','settings'))
  OR c->>'action' IS DISTINCT FROM 'invoice.settings_update' OR jsonb_typeof(c->'expected_version') IS DISTINCT FROM 'number'
  OR coalesce(c->>'expected_version','') !~ '^(0|[1-9][0-9]{0,17})$' THEN RAISE EXCEPTION 'Invalid invoice settings command' USING ERRCODE='22023'; END IF;
 PERFORM public._sales_invoice_validate_settings(c->'settings');
 -- 999999999 is a readable exhausted state after the last supported issuance, never user input.
 IF (c#>>'{settings,next_number}')::bigint>999999998 THEN
  RAISE EXCEPTION 'Invoice settings sequence must allow a supported issuance' USING ERRCODE='22023'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.preview_sales_invoice_command(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE p jsonb;
BEGIN
 IF _command->>'action' IS DISTINCT FROM 'invoice.settings_update' THEN
  IF _command ? 'template' AND (_command->>'action' IS DISTINCT FROM 'invoice.publish' OR jsonb_typeof(_command->'template') IS DISTINCT FROM 'string' OR _command->>'template' NOT IN ('classic','modern','service')) THEN
   RAISE EXCEPTION 'Invalid invoice publication template' USING ERRCODE='22023'; END IF;
  RETURN public._sales_invoice_prior_preview(_actor_user_id,_expected_tenant_id,_command);
 END IF;
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._sales_invoice_settings_command(_command);
 p:=public._sales_invoice_preferences(_expected_tenant_id);
 IF p->'version' IS DISTINCT FROM _command->'expected_version' THEN RAISE EXCEPTION 'Invoice preferences version conflict' USING ERRCODE='40001'; END IF;
 IF p#>>'{settings,prefix}'=_command#>>'{settings,prefix}' AND (_command#>>'{settings,next_number}')::bigint<(p#>>'{settings,next_number}')::bigint THEN
  RAISE EXCEPTION 'Invoice sequence cannot rewind within the same prefix' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('eligible',true,'version',p->'version','preferences',p,'summary','Update invoice appearance and numbering for this workspace. Existing issued invoices remain unchanged.');
END $$;
CREATE OR REPLACE FUNCTION public.execute_sales_invoice_command(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE p jsonb; prior jsonb; result jsonb;
BEGIN
 IF _command->>'action' IS DISTINCT FROM 'invoice.settings_update' THEN
  IF _command ? 'template' AND (_command->>'action' IS DISTINCT FROM 'invoice.publish' OR jsonb_typeof(_command->'template') IS DISTINCT FROM 'string' OR _command->>'template' NOT IN ('classic','modern','service')) THEN
   RAISE EXCEPTION 'Invalid invoice publication template' USING ERRCODE='22023'; END IF;
  PERFORM set_config('sales.invoice_publish_template',coalesce(_command->>'template',''),true);
  RETURN public._sales_invoice_prior_execute(_actor_user_id,_expected_tenant_id,_operation_id,_command,_governance);
 END IF;
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._sales_invoice_settings_command(_command);
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'Invalid invoice operation' USING ERRCODE='22023'; END IF;
 PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,'invoice.settings_update','sales_update_invoice_settings',_governance);
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81742));
 prior:=public.read_sales_invoice_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF EXISTS(SELECT 1 FROM public.messages WHERE meta#>>'{sales_invoice_binding,operation_id}'=_operation_id::text) THEN RAISE EXCEPTION 'Operation already belongs to invoice delivery' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=_expected_tenant_id FOR UPDATE;
 p:=public._sales_invoice_preferences(_expected_tenant_id);
 IF p->'version' IS DISTINCT FROM _command->'expected_version' THEN RAISE EXCEPTION 'Invoice preferences version conflict' USING ERRCODE='40001'; END IF;
 IF p#>>'{settings,prefix}'=_command#>>'{settings,prefix}' AND (_command#>>'{settings,next_number}')::bigint<(p#>>'{settings,next_number}')::bigint THEN
  RAISE EXCEPTION 'Invoice sequence cannot rewind within the same prefix' USING ERRCODE='22023'; END IF;
 UPDATE public.tenants SET brand=jsonb_set(coalesce(brand,'{}'::jsonb),'{invoice_preferences}',jsonb_build_object('version',(p->>'version')::bigint+1,'settings',_command->'settings'),true) WHERE id=_expected_tenant_id;
 PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,'sales_update_invoice_settings','capability_succeeded',_operation_id,NULL);
 result:=jsonb_build_object('ok',true,'preferences',public._sales_invoice_preferences(_expected_tenant_id),'operation',jsonb_build_object('id',_operation_id,'action','invoice.settings_update'));
 INSERT INTO public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result) VALUES(_operation_id,_expected_tenant_id,NULL,_actor_user_id,_command,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public._sales_invoice_prior_set_tenant_brand(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._sales_invoice_prior_preview(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._sales_invoice_settings_default() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._sales_invoice_validate_settings(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._sales_invoice_preferences(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._sales_invoice_settings_command(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._sales_invoice_brand_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._sales_invoice_publish_presentation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.execute_sales_invoice_command(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sales_invoice_command(uuid,uuid,uuid,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.read_sales_invoice_preferences(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_preferences(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_tenant_brand(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_tenant_brand(uuid,jsonb) TO authenticated,service_role;

-- Extend the live catalogue, including Studio/Collections, without copying or erasing rows.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_invoice_preferences(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_invoice_preferences;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_invoice_preferences(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_invoice_preferences(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY
 WITH catalog(tool_key,label) AS (VALUES ('sales_update_invoice_settings','Update customer invoice appearance and numbering'))
 SELECT c.tool_key,c.label,'Payments'::text,coalesce(t.mode,'confirm'),t.mode IS NULL,t.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy t ON t.tenant_id=tenant AND t.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

-- A named display on the same canonical Rail, preserving all other installed projections.
DO $$ BEGIN
 IF to_regprocedure('public._workspace_event_before_invoice_preferences(text,text,text)') IS NULL THEN
  ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_before_invoice_preferences;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_before_invoice_preferences(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public._workspace_event_before_invoice_preferences(_source_kind,_outcome,_capability);
 IF _source_kind='capability_run' AND _capability='sales_update_invoice_settings' THEN
  result:=result||jsonb_build_object('title',CASE WHEN _outcome='capability_succeeded' THEN 'Updated invoice appearance and numbering' ELSE 'Invoice settings were not confirmed updated' END,
   'summary',CASE WHEN _outcome='capability_succeeded' THEN 'Saved invoice preferences for this workspace. Previously issued invoices keep their original presentation.' ELSE 'The canonical outcome does not confirm a settings change.' END);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;
