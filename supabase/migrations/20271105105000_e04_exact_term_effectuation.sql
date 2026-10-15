-- CLI scaffold 20261015051700, moved while UNAPPLIED to reserved051050.
-- Explicit owner UI only. No Chat/Live admission, provider action, new obligation,
-- ledger, approval store, executor or historical backfill.
BEGIN;
SET LOCAL lock_timeout='5s';

-- Extract the incumbent business body once, byte-for-byte. Keep the public
-- human writer's auth prefix, error behavior, signature, defaults and ACLs.
DO $migration$ DECLARE original text; business text:=$business$  _status := nullif(btrim(coalesce(_status, '')), '');
  IF _status IS NULL OR _status NOT IN ('draft','active','paused','completed','cancelled') THEN
    RAISE EXCEPTION 'that is not a state an agreement can be in: %', left(coalesce(_status, 'nothing'), 40) USING ERRCODE = 'PA002';
  END IF;

  -- A cancelled or completed agreement is HISTORY. Reopening it would rewrite what a client owed
  -- and when, so a new arrangement is a new record rather than a resurrected one.
  SELECT * INTO _row FROM public.tenant_client_agreements
   WHERE id = _agreement_id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
  END IF;
  IF _row.status IN ('completed', 'cancelled') AND _status <> _row.status THEN
    RAISE EXCEPTION 'this agreement is already %; record a new one rather than reopening it', _row.status USING ERRCODE = 'PA002';
  END IF;
  -- One LIVE arrangement per client per offer. Without this the partial unique index answers with
  -- its own name, which is a database object in visible copy.
  IF _status IN ('active','paused') AND _row.status NOT IN ('active','paused')
     AND EXISTS (SELECT 1 FROM public.tenant_client_agreements other
                  WHERE other.tenant_id = _tenant
                    AND other.contact_id = _row.contact_id
                    AND other.offer_id = _row.offer_id
                    AND other.id <> _row.id
                    AND other.status IN ('active','paused')) THEN
    RAISE EXCEPTION 'this client already has a live arrangement for that offer; end that one first' USING ERRCODE = 'PA002';
  END IF;
  _row := NULL;

  -- The same completeness rule the table carries, said in words BEFORE the constraint can fire.
  -- `cancelled` is exempt for the reason the CHECK is: cancelling is abandonment, and requiring a
  -- start date before someone may walk away made a half-finished draft uncancellable.
  IF _status NOT IN ('draft', 'cancelled') THEN
    SELECT * INTO _row FROM public.tenant_client_agreements
     WHERE id = _agreement_id AND tenant_id = _tenant;
    IF _row.id IS NULL THEN
      RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
    END IF;
    IF _row.starts_on IS NULL THEN
      RAISE EXCEPTION 'give this a start date before making it %', left(_status, 40) USING ERRCODE = 'PA002';
    END IF;
    IF _row.price_basis = 'quote_pending' THEN
      RAISE EXCEPTION 'this is still awaiting its quote, so it cannot be made % yet', left(_status, 40) USING ERRCODE = 'PA002';
    END IF;
    _row := NULL;
  END IF;

  UPDATE public.tenant_client_agreements
     SET status = _status
   WHERE id = _agreement_id
     AND tenant_id = _tenant
     AND (_expected_updated_at IS NULL OR updated_at = _expected_updated_at)
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.tenant_client_agreements
                WHERE id = _agreement_id AND tenant_id = _tenant) THEN
      RAISE EXCEPTION 'someone else changed this agreement while you were editing it'
        USING ERRCODE = '40001';
    END IF;
    RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
  END IF;

  RETURN to_jsonb(_row);$business$;
BEGIN
 original:=pg_catalog.pg_get_functiondef('public.set_client_agreement_status(uuid,uuid,text,timestamptz)'::regprocedure);
 IF pg_catalog.strpos(original,'RETURN public._set_client_agreement_status(')=0 THEN
  IF pg_catalog.strpos(original,business)=0 THEN RAISE EXCEPTION 'Canonical status writer changed; reconcile before applying'; END IF;
  EXECUTE 'CREATE OR REPLACE FUNCTION public._set_client_agreement_status(_actor uuid,_tenant uuid,_agreement_id uuid,_status text,_expected_updated_at timestamptz)
   RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''''
   AS $writer$ DECLARE _row public.tenant_client_agreements; BEGIN '||business||' END; $writer$';
  EXECUTE pg_catalog.replace(original,business,'  RETURN public._set_client_agreement_status(_actor,_tenant,_agreement_id,_status,_expected_updated_at);');
 ELSE
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef('public._set_client_agreement_status(uuid,uuid,uuid,text,timestamptz)'::regprocedure),business)=0 THEN
   RAISE EXCEPTION 'Shared status writer changed; reconcile before applying'; END IF;
 END IF;
END $migration$;
REVOKE ALL ON FUNCTION public._set_client_agreement_status(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- Current provenance points to an immutable original operation. Later accepted
-- revisions may replace the pointer only through the governed writer; prior
-- versions remain in the incumbent immutable Collections operation history.
ALTER TABLE public.tenant_client_agreements
 ADD COLUMN IF NOT EXISTS effective_signing_id uuid,
 ADD COLUMN IF NOT EXISTS effective_terms_version bigint,
 ADD COLUMN IF NOT EXISTS effective_at timestamptz,
 ADD COLUMN IF NOT EXISTS effective_operation_id uuid,
 ADD COLUMN IF NOT EXISTS effective_source_digest text;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.tenant_client_agreements'::regclass AND conname='e04_effective_provenance_complete') THEN
  ALTER TABLE public.tenant_client_agreements ADD CONSTRAINT e04_effective_provenance_complete CHECK (
   (effective_signing_id IS NULL AND effective_terms_version IS NULL AND effective_at IS NULL AND effective_operation_id IS NULL AND effective_source_digest IS NULL)
   OR (effective_signing_id IS NOT NULL AND effective_terms_version IS NOT NULL AND effective_terms_version>=0 AND effective_at IS NOT NULL AND effective_operation_id IS NOT NULL AND effective_source_digest IS NOT NULL AND effective_source_digest ~ '^[a-f0-9]{64}$'));
  ALTER TABLE public.tenant_client_agreements ADD CONSTRAINT e04_effective_signing_fk FOREIGN KEY(effective_signing_id) REFERENCES public.paige_agreements(id) DEFERRABLE INITIALLY DEFERRED;
  ALTER TABLE public.tenant_client_agreements ADD CONSTRAINT e04_effective_operation_fk FOREIGN KEY(effective_operation_id) REFERENCES public.paige_sales_collection_operations(id) DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public._sales_effective_provenance_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE owner_name text; changed boolean;
BEGIN
 changed:=CASE WHEN TG_OP='INSERT' THEN NEW.effective_signing_id IS NOT NULL OR NEW.effective_terms_version IS NOT NULL
  OR NEW.effective_at IS NOT NULL OR NEW.effective_operation_id IS NOT NULL OR NEW.effective_source_digest IS NOT NULL
 ELSE ROW(NEW.effective_signing_id,NEW.effective_terms_version,NEW.effective_at,NEW.effective_operation_id,NEW.effective_source_digest)
  IS DISTINCT FROM ROW(OLD.effective_signing_id,OLD.effective_terms_version,OLD.effective_at,OLD.effective_operation_id,OLD.effective_source_digest) END;
 SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO owner_name FROM pg_catalog.pg_class c WHERE c.oid=TG_RELID;
 IF changed AND current_user IS DISTINCT FROM owner_name THEN RAISE EXCEPTION 'Effective commercial provenance requires the canonical writer' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._sales_effective_provenance_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS sales_effective_provenance_guard ON public.tenant_client_agreements;
CREATE TRIGGER sales_effective_provenance_guard BEFORE INSERT OR UPDATE ON public.tenant_client_agreements FOR EACH ROW EXECUTE FUNCTION public._sales_effective_provenance_guard();

CREATE OR REPLACE FUNCTION public._validate_sales_effectuation(_command jsonb) RETURNS void
 LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF pg_catalog.jsonb_typeof(_command) IS DISTINCT FROM 'object' OR pg_catalog.octet_length(_command::text)>3000
  OR _command->>'action' IS DISTINCT FROM 'collection.effectuate_terms'
  OR (_command-ARRAY['action','agreement_id','expected_version','expected_updated_at','signing_id','signing_version','invoice_id','invoice_draft_version','payload_digest','sealed_sha256'])<>'{}'::jsonb
  OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(_command))<>10 THEN RAISE EXCEPTION 'Invalid effectuation command' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['agreement_id','signing_id','invoice_id'] LOOP
  IF pg_catalog.jsonb_typeof(_command->k) IS DISTINCT FROM 'string' OR coalesce(_command->>k,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Invalid effectuation source' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['expected_version','signing_version','invoice_draft_version'] LOOP
  IF pg_catalog.jsonb_typeof(_command->k) IS DISTINCT FROM 'number' OR coalesce(_command->>k,'') !~ '^[0-9]{1,16}$'
   OR (_command->>k)::numeric>9007199254740991 OR (k<>'expected_version' AND (_command->>k)::bigint<1) THEN RAISE EXCEPTION 'Invalid effectuation revision' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['payload_digest','sealed_sha256'] LOOP
  IF pg_catalog.jsonb_typeof(_command->k) IS DISTINCT FROM 'string' OR coalesce(_command->>k,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid effectuation digest' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF pg_catalog.jsonb_typeof(_command->'expected_updated_at') IS DISTINCT FROM 'string'
  OR coalesce(_command->>'expected_updated_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  THEN RAISE EXCEPTION 'Exact commercial revision timestamp required' USING ERRCODE='22023'; END IF;
 PERFORM (_command->>'expected_updated_at')::timestamptz;
END $$;
REVOKE ALL ON FUNCTION public._validate_sales_effectuation(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._preview_sales_effectuation(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE; t public.tenant_client_agreements%ROWTYPE; i public.paige_invoices%ROWTYPE; p jsonb;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._validate_sales_effectuation(_command);
 SELECT * INTO t FROM public.tenant_client_agreements WHERE id=(_command->>'agreement_id')::uuid AND tenant_id=_expected_tenant_id;
 SELECT * INTO a FROM public.paige_agreements WHERE id=(_command->>'signing_id')::uuid AND tenant_id=_expected_tenant_id;
 SELECT * INTO i FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id;
 p:=public._paige_accepted_commercial_payload(a);
 IF t.id IS NULL OR a.id IS NULL OR i.id IS NULL OR p IS NULL OR t.status NOT IN ('draft','active')
  OR t.starts_on IS NULL OR t.price_basis='quote_pending'
  OR a.contact_id IS DISTINCT FROM t.contact_id OR a.offer_id IS DISTINCT FROM t.offer_id OR a.commercial_terms_id IS DISTINCT FROM t.id
  OR i.contact_id IS DISTINCT FROM t.contact_id OR i.billing_draft#>>'{agreement_snapshot,id}' IS DISTINCT FROM a.id::text
  OR i.billing_draft#>>'{commercial_terms_reference,id}' IS DISTINCT FROM t.id::text
  OR t.collection_terms_version::text IS DISTINCT FROM _command->>'expected_version'
  OR a.version::text IS DISTINCT FROM _command->>'signing_version'
  OR i.billing_draft_version::text IS DISTINCT FROM _command->>'invoice_draft_version'
  OR t.updated_at IS DISTINCT FROM (_command->>'expected_updated_at')::timestamptz
  OR p#>>'{source,terms_updated_at}' IS DISTINCT FROM _command->>'expected_updated_at'
  OR p#>>'{source,terms_version}' IS DISTINCT FROM _command->>'expected_version'
  OR p#>>'{source,invoice_id}' IS DISTINCT FROM i.id::text
  OR p#>>'{source,invoice_draft_version}' IS DISTINCT FROM _command->>'invoice_draft_version'
  OR a.commercial_presentation->>'payload_digest' IS DISTINCT FROM _command->>'payload_digest'
  OR a.sealed_sha256 IS DISTINCT FROM _command->>'sealed_sha256'
  OR t.agreed_amount_minor::text IS DISTINCT FROM p->>'principal_minor'
  OR pg_catalog.lower(t.agreed_currency) IS DISTINCT FROM p->>'currency'
  OR t.collection_terms IS DISTINCT FROM p->'collection_terms'
  OR i.billing_draft->'commercial_conditions' IS DISTINCT FROM p->'conditions'
  OR i.billing_draft->'total_minor' IS DISTINCT FROM p->'principal_minor' THEN
  RETURN pg_catalog.jsonb_build_object('eligible',false,'summary','Signed and current commercial terms must match exactly. Refresh the records before continuing.'); END IF;
 RETURN pg_catalog.jsonb_build_object('eligible',true,'summary','Make the matching signed commercial terms effective. No invoice, payment request, payment, onboarding or service completion is created.',
  'consequence',pg_catalog.jsonb_build_object('agreement_id',t.id,'signing_id',a.id,'signing_version',a.version,
   'terms_version',t.collection_terms_version,'invoice_id',i.id,'payload_digest',_command->>'payload_digest','sealed_sha256',a.sealed_sha256,
   'expected_updated_at',_command->>'expected_updated_at','invoice_draft_version',i.billing_draft_version,
   'client_id',t.contact_id,'amount_cents',p->'principal_minor','currency',p->>'currency','starts_on',t.starts_on,
   'state_before',t.status,'state_after','active','effect',CASE WHEN t.status='active' THEN 'record_provenance_only' ELSE 'activate_matching_terms' END));
END $$;
REVOKE ALL ON FUNCTION public._preview_sales_effectuation(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Same immutable store, with one business effect per accepted signing/revision.
CREATE UNIQUE INDEX IF NOT EXISTS sales_effectuation_pair_unique ON public.paige_sales_collection_operations
 (tenant_id,(command->>'signing_id'),(command->>'expected_version')) WHERE command->>'action'='collection.effectuate_terms';
DO $$ DECLARE body text; anchor text:='  IF NOT FOUND THEN RETURN NULL; END IF;'; BEGIN
 body:=pg_catalog.pg_get_functiondef('public.read_sales_collection_command_result(uuid,uuid,uuid,jsonb)'::regprocedure);
 IF pg_catalog.strpos(body,'_validate_sales_effectuation')=0 THEN
  IF pg_catalog.strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Canonical operation reader changed'; END IF;
  body:=pg_catalog.replace(body,anchor,$replacement$  IF NOT FOUND THEN
   IF _command->>'action'='collection.effectuate_terms' THEN
    PERFORM public._validate_sales_effectuation(_command);
    SELECT * INTO op FROM public.paige_sales_collection_operations WHERE tenant_id=_expected_tenant_id
     AND command->>'action'='collection.effectuate_terms' AND command->>'signing_id'=_command->>'signing_id'
     AND command->>'expected_version'=_command->>'expected_version';
    IF FOUND THEN
     IF op.command IS DISTINCT FROM _command THEN RAISE EXCEPTION 'Accepted terms already recorded against a different source' USING ERRCODE='22023'; END IF;
     RETURN op.result;
    END IF;
   END IF;
   RETURN NULL;
  END IF;$replacement$);
  EXECUTE body;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public._execute_sales_effectuation(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb,_governance jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb; preview jsonb; saved jsonb; result jsonb; at_time timestamptz; mode text; receipt_id uuid;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._validate_sales_effectuation(_command);
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_operation_id::text,81747));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_expected_tenant_id::text||':'||(_command->>'signing_id')||':'||(_command->>'expected_version'),81748));
 prior:=public.read_sales_collection_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,'collection.effectuate_terms','sales_effectuate_commercial_terms',_governance);
 mode:=public.resolve_tool_autonomy(_expected_tenant_id,'sales_effectuate_commercial_terms');
 IF mode IS NULL OR mode NOT IN ('auto','confirm') THEN RAISE EXCEPTION 'Current commercial write authority unavailable' USING ERRCODE='42501'; END IF;
 -- Retain the incumbent resource lock order: signing -> commercial -> invoice.
 PERFORM id FROM public.paige_agreements WHERE id=(_command->>'signing_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
 PERFORM id FROM public.tenant_client_agreements WHERE id=(_command->>'agreement_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
 PERFORM id FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id FOR SHARE;
 PERFORM id FROM public.paige_agreement_signers WHERE agreement_id=(_command->>'signing_id')::uuid FOR SHARE;
 preview:=public._preview_sales_effectuation(_actor_user_id,_expected_tenant_id,_command);
 IF preview->'eligible' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Signed and current commercial terms no longer match' USING ERRCODE='40001'; END IF;
 IF preview#>>'{consequence,state_before}'='draft' THEN
  saved:=public._set_client_agreement_status(_actor_user_id,_expected_tenant_id,(_command->>'agreement_id')::uuid,'active',(_command->>'expected_updated_at')::timestamptz);
 END IF;
 at_time:=pg_catalog.clock_timestamp();
 UPDATE public.tenant_client_agreements SET effective_signing_id=(_command->>'signing_id')::uuid,
  effective_terms_version=(_command->>'expected_version')::bigint,effective_at=at_time,effective_operation_id=_operation_id,effective_source_digest=_command->>'payload_digest'
  WHERE id=(_command->>'agreement_id')::uuid AND tenant_id=_expected_tenant_id RETURNING pg_catalog.to_jsonb(tenant_client_agreements.*) INTO saved;
 IF saved->>'status' IS DISTINCT FROM 'active' OR saved->>'effective_operation_id' IS DISTINCT FROM _operation_id::text THEN
  RAISE EXCEPTION 'Effective terms readback unavailable' USING ERRCODE='55000'; END IF;
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,'sales_effectuate_commercial_terms','capability_succeeded',_operation_id,NULL,NULL,NULL,NULL,
  pg_catalog.jsonb_build_object('origin','owner_ui','agreement_id',_command->>'agreement_id','signing_id',_command->>'signing_id','terms_version',_command->'expected_version'));
 SELECT id INTO receipt_id FROM public.paige_workspace_events WHERE tenant_id=_expected_tenant_id AND actor_id=_actor_user_id
  AND source_kind='capability_run' AND source_id=_operation_id AND source_revision=0 AND outcome='capability_succeeded'
  AND capability_key='sales_effectuate_commercial_terms' AND detail->>'origin'='owner_ui'
  AND detail->>'agreement_id'=_command->>'agreement_id' AND detail->>'signing_id'=_command->>'signing_id'
  AND detail->'terms_version'=_command->'expected_version';
 IF receipt_id IS NULL THEN RAISE EXCEPTION 'Effective terms receipt readback unavailable' USING ERRCODE='55000'; END IF;
 result:=pg_catalog.jsonb_build_object('ok',true,'outcome','commercial_terms_effectuated','historical_receipt',true,'receipt_id',receipt_id,
  'row',pg_catalog.jsonb_build_object('id',saved->>'id','tenant_id',_expected_tenant_id,'status_at_execution','active',
   'signing_id',_command->>'signing_id','signing_version',_command->'signing_version','terms_version',_command->'expected_version',
   'effective_at',at_time,'source_digest',_command->>'payload_digest','actor_user_id',_actor_user_id,'effect',preview#>>'{consequence,effect}'),
  'operation',pg_catalog.jsonb_build_object('id',_operation_id,'action','collection.effectuate_terms'));
 INSERT INTO public.paige_sales_collection_operations(id,tenant_id,actor_user_id,command,result) VALUES(_operation_id,_expected_tenant_id,_actor_user_id,_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._execute_sales_effectuation(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Extend the installed command router without replacing any incumbent branch.
DO $$ DECLARE body text; prior text; entry record; BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('public.preview_sales_collection_command(uuid,uuid,jsonb)','    RETURN public._preview_sales_effectuation(_actor_user_id,_expected_tenant_id,_command);'),
  ('public.execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb)','    RETURN public._execute_sales_effectuation(_actor_user_id,_expected_tenant_id,_operation_id,_command,_governance);')
 ) x(signature,dispatch) LOOP
  body:=pg_catalog.pg_get_functiondef(entry.signature::regprocedure);
  IF pg_catalog.strpos(body,entry.dispatch)>0 THEN CONTINUE; END IF;
  prior:=body;
  body:=pg_catalog.replace(body,$anchor$  IF action='collection.create_commercial_terms' THEN$anchor$,
   '  IF action=''collection.effectuate_terms'' THEN'||E'\n'||entry.dispatch||E'\n  END IF;\n'||$anchor$  IF action='collection.create_commercial_terms' THEN$anchor$);
  IF body=prior THEN RAISE EXCEPTION 'Canonical Collections router changed'; END IF;
  EXECUTE body;
 END LOOP;
END $$;

-- Extend the same bounded package record for durable owner/PAIGE readback.
DO $$ DECLARE body text; anchor text:=$anchor$'record_owner','commercial_collection_terms','schedule'$anchor$; BEGIN
 body:=pg_catalog.pg_get_functiondef('public.read_sales_commercial_package(uuid,uuid)'::regprocedure);
 IF pg_catalog.strpos(body,'effective_provenance')=0 THEN
  IF pg_catalog.strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Canonical package terms anchor changed'; END IF;
  body:=pg_catalog.replace(body,anchor,$replacement$'effective_provenance',CASE WHEN t.effective_operation_id IS NULL THEN NULL ELSE
   pg_catalog.jsonb_build_object('signing_id',t.effective_signing_id,'terms_version',t.effective_terms_version,
    'recorded_at',t.effective_at,'operation_id',t.effective_operation_id) END,
   'record_owner','commercial_collection_terms','schedule'$replacement$);
  EXECUTE body;
 END IF;
END $$;

-- One more exact-key link in the incumbent Rail wrapper chain. This key has
-- no Chat tool and represents only an owner/admin UI act. All other keys,
-- including E4-S3 time-zone attribution, delegate byte-for-byte.
DO $$ BEGIN
 IF pg_catalog.to_regprocedure('public._workspace_event_display_before_e04_effectuation(text,text,text)') IS NULL THEN
  ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_e04_effectuation;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display_before_e04_effectuation(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=public._workspace_event_display_before_e04_effectuation(_source_kind,_outcome,_capability);
 IF _source_kind='capability_run' AND _capability='sales_effectuate_commercial_terms' THEN
  result:=result||pg_catalog.jsonb_build_object('actor_type','owner_staff',
   'title',CASE WHEN _outcome='capability_succeeded' THEN 'Signed commercial terms made effective' ELSE 'Commercial terms not made effective' END,
   'summary',CASE WHEN _outcome='capability_succeeded' THEN 'An owner or admin approved the matching signed commercial terms. No payment or completed service is confirmed.' ELSE 'The action did not complete. Refresh the current commercial record.' END);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;
COMMIT;
