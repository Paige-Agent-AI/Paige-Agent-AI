-- EXP04 checked internal party preparation. Same original signer PK and edit event.
-- One private canonical business body serves legacy and checked entry points.
-- No extra request/execution store, approval, sender, signature or payment engine.
BEGIN;
SET LOCAL lock_timeout='5s';
-- Original immutable event supplies exactly one creation receipt per signer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_signer_preparation_receipt
 ON public.paige_agreement_events(tenant_id,agreement_id,signer_id)
 WHERE event_type='edited' AND detail ? 'signer_preparation';
DO $guard$
DECLARE expected_body text:=$expected$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _status text;
  _source public.paige_agreements%ROWTYPE;
  _event_id uuid:=pg_catalog.gen_random_uuid();
  _recorded_version integer;
  _recorded_at timestamptz;
  _receipt jsonb;
  _detail jsonb;
  _order integer;
  _row public.paige_agreement_signers;
  _name text := btrim(coalesce(_full_name,''));
  _mail text := lower(btrim(coalesce(_email,'')));
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could save; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'only an owner or admin may add a signer to an agreement' USING ERRCODE = '42501';
  END IF;
  IF (_preparation_id IS NULL) IS DISTINCT FROM (_preparation_digest IS NULL)
     OR (_preparation_digest IS NOT NULL AND _preparation_digest !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'Invalid signer preparation identity' USING ERRCODE='22023';
  END IF;
  IF _name = '' THEN
    RAISE EXCEPTION 'a signer needs the name they will sign under' USING ERRCODE = '23514';
  END IF;
  IF position('@' in _mail) < 2 THEN
    RAISE EXCEPTION 'a signer needs an email address the link can be sent to' USING ERRCODE = '23514';
  END IF;
  IF _signer_role NOT IN ('counterparty','tenant_signatory','witness') THEN
    RAISE EXCEPTION 'that is not a signer role this engine understands' USING ERRCODE = '23514';
  END IF;

  -- Serialize preparation on the SAME original document before choosing order.
  SELECT * INTO _source FROM public.paige_agreements
   WHERE id = _signing_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
  END IF;
  _status := _source.status;
  -- Only a draft. Adding a party to a document other people have already been shown would change
  -- what they agreed to after they agreed to it.
  IF _status <> 'draft' THEN
    RAISE EXCEPTION 'this agreement has already been sent; a signer cannot be added to it now'
      USING ERRCODE = '23514';
  END IF;

  -- Delivery can still say Draft after a document was retained for review.
  -- Parties belong to that exact reviewed source and cannot change underneath it.
  IF _source.content_storage_key IS NOT NULL OR _source.content_sha256 IS NOT NULL
    OR _source.sealed_storage_key IS NOT NULL OR _source.sealed_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'this agreement document is retained; its signers cannot be changed'
      USING ERRCODE='23514';
  END IF;

  IF _signing_order IS NULL THEN
    SELECT coalesce(max(signing_order), 0) + 1 INTO _order
      FROM public.paige_agreement_signers WHERE agreement_id = _signing_id;
  ELSE
    IF _signing_order < 1 THEN
      RAISE EXCEPTION 'signing order starts at 1' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.paige_agreement_signers
      WHERE agreement_id = _signing_id AND signing_order = _signing_order;
    IF FOUND THEN
      RAISE EXCEPTION 'another signer already holds position % on this agreement', _signing_order
        USING ERRCODE = '23505';
    END IF;
    _order := _signing_order;
  END IF;

  INSERT INTO public.paige_agreement_signers
    (id, agreement_id, tenant_id, full_name, email, signer_role, signing_order)
  VALUES (coalesce(_preparation_id,pg_catalog.gen_random_uuid()), _signing_id, _tenant, _name, _mail, _signer_role, _order)
  RETURNING * INTO _row;

  -- A party change invalidates a previously reviewed source version without
  -- changing supplied words, signing evidence or any historical agreement.
  UPDATE public.paige_agreements SET version=version+1
   WHERE id=_signing_id AND tenant_id=_tenant RETURNING version,updated_at INTO _recorded_version,_recorded_at;

  _receipt:=jsonb_build_object(
    'signer_id', _row.id, 'full_name', _row.full_name, 'email', _row.email,
    'signer_role', _row.signer_role, 'signing_order', _row.signing_order, 'status', _row.status
  );
  _detail:=pg_catalog.jsonb_build_object('added_signer_order',_order);
  IF _preparation_id IS NOT NULL THEN
    _receipt:=pg_catalog.jsonb_build_object('schema_version',1,'state','recorded',
      'agreement_id',_signing_id,'client_id',_source.contact_id,'signer_id',_row.id,
      'full_name',_row.full_name,'email',_row.email,'signer_role',_row.signer_role,
      'signing_order',_row.signing_order,'status',_row.status,
      'source_version',_recorded_version,'source_updated_at',_recorded_at,'event_id',_event_id);
    _detail:=_detail||pg_catalog.jsonb_build_object('signer_preparation',
      pg_catalog.jsonb_build_object('digest',_preparation_digest,'receipt',_receipt));
  END IF;
  INSERT INTO public.paige_agreement_events
    (id,agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_user_id,detail)
  VALUES (_event_id,_signing_id,_tenant,_row.id,'edited','owner',_actor,_detail);

  -- Legacy retains its six fields; checked preparation adds only source/event identity.
  RETURN _receipt;
END;
$expected$; actual_body text;
BEGIN
 SELECT prosrc INTO actual_body FROM pg_catalog.pg_proc
  WHERE oid=pg_catalog.to_regprocedure('public._write_agreement_signer(uuid,uuid,text,text,text,integer,uuid,text)');
 IF actual_body IS NOT NULL AND actual_body IS DISTINCT FROM expected_body THEN
  RAISE EXCEPTION 'Canonical signer business body changed; reconcile before applying';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public._write_agreement_signer(
 _expected_tenant_id uuid,_signing_id uuid,_full_name text,_email text,
 _signer_role text,_signing_order integer,_preparation_id uuid,_preparation_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $private$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _status text;
  _source public.paige_agreements%ROWTYPE;
  _event_id uuid:=pg_catalog.gen_random_uuid();
  _recorded_version integer;
  _recorded_at timestamptz;
  _receipt jsonb;
  _detail jsonb;
  _order integer;
  _row public.paige_agreement_signers;
  _name text := btrim(coalesce(_full_name,''));
  _mail text := lower(btrim(coalesce(_email,'')));
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could save; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'only an owner or admin may add a signer to an agreement' USING ERRCODE = '42501';
  END IF;
  IF (_preparation_id IS NULL) IS DISTINCT FROM (_preparation_digest IS NULL)
     OR (_preparation_digest IS NOT NULL AND _preparation_digest !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'Invalid signer preparation identity' USING ERRCODE='22023';
  END IF;
  IF _name = '' THEN
    RAISE EXCEPTION 'a signer needs the name they will sign under' USING ERRCODE = '23514';
  END IF;
  IF position('@' in _mail) < 2 THEN
    RAISE EXCEPTION 'a signer needs an email address the link can be sent to' USING ERRCODE = '23514';
  END IF;
  IF _signer_role NOT IN ('counterparty','tenant_signatory','witness') THEN
    RAISE EXCEPTION 'that is not a signer role this engine understands' USING ERRCODE = '23514';
  END IF;

  -- Serialize preparation on the SAME original document before choosing order.
  SELECT * INTO _source FROM public.paige_agreements
   WHERE id = _signing_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
  END IF;
  _status := _source.status;
  -- Only a draft. Adding a party to a document other people have already been shown would change
  -- what they agreed to after they agreed to it.
  IF _status <> 'draft' THEN
    RAISE EXCEPTION 'this agreement has already been sent; a signer cannot be added to it now'
      USING ERRCODE = '23514';
  END IF;

  -- Delivery can still say Draft after a document was retained for review.
  -- Parties belong to that exact reviewed source and cannot change underneath it.
  IF _source.content_storage_key IS NOT NULL OR _source.content_sha256 IS NOT NULL
    OR _source.sealed_storage_key IS NOT NULL OR _source.sealed_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'this agreement document is retained; its signers cannot be changed'
      USING ERRCODE='23514';
  END IF;

  IF _signing_order IS NULL THEN
    SELECT coalesce(max(signing_order), 0) + 1 INTO _order
      FROM public.paige_agreement_signers WHERE agreement_id = _signing_id;
  ELSE
    IF _signing_order < 1 THEN
      RAISE EXCEPTION 'signing order starts at 1' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.paige_agreement_signers
      WHERE agreement_id = _signing_id AND signing_order = _signing_order;
    IF FOUND THEN
      RAISE EXCEPTION 'another signer already holds position % on this agreement', _signing_order
        USING ERRCODE = '23505';
    END IF;
    _order := _signing_order;
  END IF;

  INSERT INTO public.paige_agreement_signers
    (id, agreement_id, tenant_id, full_name, email, signer_role, signing_order)
  VALUES (coalesce(_preparation_id,pg_catalog.gen_random_uuid()), _signing_id, _tenant, _name, _mail, _signer_role, _order)
  RETURNING * INTO _row;

  -- A party change invalidates a previously reviewed source version without
  -- changing supplied words, signing evidence or any historical agreement.
  UPDATE public.paige_agreements SET version=version+1
   WHERE id=_signing_id AND tenant_id=_tenant RETURNING version,updated_at INTO _recorded_version,_recorded_at;

  _receipt:=jsonb_build_object(
    'signer_id', _row.id, 'full_name', _row.full_name, 'email', _row.email,
    'signer_role', _row.signer_role, 'signing_order', _row.signing_order, 'status', _row.status
  );
  _detail:=pg_catalog.jsonb_build_object('added_signer_order',_order);
  IF _preparation_id IS NOT NULL THEN
    _receipt:=pg_catalog.jsonb_build_object('schema_version',1,'state','recorded',
      'agreement_id',_signing_id,'client_id',_source.contact_id,'signer_id',_row.id,
      'full_name',_row.full_name,'email',_row.email,'signer_role',_row.signer_role,
      'signing_order',_row.signing_order,'status',_row.status,
      'source_version',_recorded_version,'source_updated_at',_recorded_at,'event_id',_event_id);
    _detail:=_detail||pg_catalog.jsonb_build_object('signer_preparation',
      pg_catalog.jsonb_build_object('digest',_preparation_digest,'receipt',_receipt));
  END IF;
  INSERT INTO public.paige_agreement_events
    (id,agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_user_id,detail)
  VALUES (_event_id,_signing_id,_tenant,_row.id,'edited','owner',_actor,_detail);

  -- Legacy retains its six fields; checked preparation adds only source/event identity.
  RETURN _receipt;
END;
$private$;
REVOKE ALL ON FUNCTION public._write_agreement_signer(uuid,uuid,text,text,text,integer,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE
 original_body text:=$original$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _status text;
  _source public.paige_agreements%ROWTYPE;
  _order integer;
  _row public.paige_agreement_signers;
  _name text := btrim(coalesce(_full_name,''));
  _mail text := lower(btrim(coalesce(_email,'')));
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could save; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'only an owner or admin may add a signer to an agreement' USING ERRCODE = '42501';
  END IF;
  IF _name = '' THEN
    RAISE EXCEPTION 'a signer needs the name they will sign under' USING ERRCODE = '23514';
  END IF;
  IF position('@' in _mail) < 2 THEN
    RAISE EXCEPTION 'a signer needs an email address the link can be sent to' USING ERRCODE = '23514';
  END IF;
  IF _signer_role NOT IN ('counterparty','tenant_signatory','witness') THEN
    RAISE EXCEPTION 'that is not a signer role this engine understands' USING ERRCODE = '23514';
  END IF;

  -- Serialize preparation on the SAME original document before choosing order.
  SELECT * INTO _source FROM public.paige_agreements
   WHERE id = _signing_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
  END IF;
  _status := _source.status;
  -- Only a draft. Adding a party to a document other people have already been shown would change
  -- what they agreed to after they agreed to it.
  IF _status <> 'draft' THEN
    RAISE EXCEPTION 'this agreement has already been sent; a signer cannot be added to it now'
      USING ERRCODE = '23514';
  END IF;

  -- Delivery can still say Draft after a document was retained for review.
  -- Parties belong to that exact reviewed source and cannot change underneath it.
  IF _source.content_storage_key IS NOT NULL OR _source.content_sha256 IS NOT NULL
    OR _source.sealed_storage_key IS NOT NULL OR _source.sealed_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'this agreement document is retained; its signers cannot be changed'
      USING ERRCODE='23514';
  END IF;

  IF _signing_order IS NULL THEN
    SELECT coalesce(max(signing_order), 0) + 1 INTO _order
      FROM public.paige_agreement_signers WHERE agreement_id = _signing_id;
  ELSE
    IF _signing_order < 1 THEN
      RAISE EXCEPTION 'signing order starts at 1' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.paige_agreement_signers
      WHERE agreement_id = _signing_id AND signing_order = _signing_order;
    IF FOUND THEN
      RAISE EXCEPTION 'another signer already holds position % on this agreement', _signing_order
        USING ERRCODE = '23505';
    END IF;
    _order := _signing_order;
  END IF;

  INSERT INTO public.paige_agreement_signers
    (agreement_id, tenant_id, full_name, email, signer_role, signing_order)
  VALUES (_signing_id, _tenant, _name, _mail, _signer_role, _order)
  RETURNING * INTO _row;

  -- A party change invalidates a previously reviewed source version without
  -- changing supplied words, signing evidence or any historical agreement.
  UPDATE public.paige_agreements SET version=version+1
   WHERE id=_signing_id AND tenant_id=_tenant;

  INSERT INTO public.paige_agreement_events
    (agreement_id, tenant_id, signer_id, event_type, actor_kind, actor_user_id, detail)
  VALUES (_signing_id, _tenant, _row.id, 'edited', 'owner', _actor,
          jsonb_build_object('added_signer_order', _order));

  -- Deliberately narrow: never the token hash, never the whole row.
  RETURN jsonb_build_object(
    'signer_id', _row.id, 'full_name', _row.full_name, 'email', _row.email,
    'signer_role', _row.signer_role, 'signing_order', _row.signing_order, 'status', _row.status
  );
END;
$original$;
 delegated_body text:=$delegated$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _status text;
  _source public.paige_agreements%ROWTYPE;
  _order integer;
  _row public.paige_agreement_signers;
  _name text := btrim(coalesce(_full_name,''));
  _mail text := lower(btrim(coalesce(_email,'')));
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could save; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'only an owner or admin may add a signer to an agreement' USING ERRCODE = '42501';
  END IF;
  RETURN public._write_agreement_signer(_expected_tenant_id,_signing_id,_full_name,_email,_signer_role,_signing_order,NULL,NULL);
END;
$delegated$;
 current_body text; definition text;
BEGIN
 SELECT prosrc INTO current_body FROM pg_catalog.pg_proc
  WHERE oid='public.add_agreement_signer(uuid,uuid,text,text,text,integer)'::regprocedure;
 IF current_body=delegated_body THEN RETURN; END IF;
 IF current_body IS DISTINCT FROM original_body THEN
  RAISE EXCEPTION 'Original signer writer changed; reconcile before applying';
 END IF;
 definition:=pg_catalog.pg_get_functiondef('public.add_agreement_signer(uuid,uuid,text,text,text,integer)'::regprocedure);
 IF pg_catalog.strpos(definition,original_body)=0 THEN
  RAISE EXCEPTION 'Original signer definition changed; reconcile before applying';
 END IF;
 EXECUTE pg_catalog.replace(definition,original_body,delegated_body);
END $migration$;

-- One private projection of the ORIGINAL immutable receipt; never raw detail.
CREATE OR REPLACE FUNCTION public._read_agreement_signer_preparation(
 _actor uuid,_tenant uuid,_agreement uuid,_signer uuid,_digest text,_client uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $receipt$
DECLARE signer public.paige_agreement_signers%ROWTYPE; event_row public.paige_agreement_events%ROWTYPE; receipt jsonb;
BEGIN
 SELECT * INTO signer FROM public.paige_agreement_signers WHERE id=_signer;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF signer.tenant_id IS DISTINCT FROM _tenant OR signer.agreement_id IS DISTINCT FROM _agreement THEN
  RAISE EXCEPTION 'Signer preparation unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO event_row FROM public.paige_agreement_events e
  WHERE e.tenant_id=_tenant AND e.agreement_id=_agreement AND e.signer_id=_signer
   AND e.actor_kind='owner' AND e.actor_user_id=_actor AND e.event_type='edited'
   AND e.detail ? 'signer_preparation'
   AND e.detail#>>'{signer_preparation,digest}' ~ '^[a-f0-9]{64}$'
   AND (_digest IS NULL OR e.detail#>>'{signer_preparation,digest}'=_digest)
   AND e.detail#>>'{signer_preparation,receipt,signer_id}'=_signer::text
  LIMIT 1;
 receipt:=event_row.detail#>'{signer_preparation,receipt}';
 IF event_row.id IS NULL OR pg_catalog.jsonb_typeof(receipt) IS DISTINCT FROM 'object'
    OR receipt->>'schema_version' IS DISTINCT FROM '1' OR receipt->>'state' IS DISTINCT FROM 'recorded'
    OR receipt->>'event_id' IS DISTINCT FROM event_row.id::text
    OR receipt->>'agreement_id' IS DISTINCT FROM _agreement::text
    OR receipt->>'signer_id' IS DISTINCT FROM _signer::text
    OR coalesce(receipt->>'client_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    OR (_client IS NOT NULL AND receipt->>'client_id' IS DISTINCT FROM _client::text)
    OR pg_catalog.jsonb_typeof(receipt->'full_name') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(receipt->'email') IS DISTINCT FROM 'string'
    OR coalesce(receipt->>'signer_role','') NOT IN ('counterparty','tenant_signatory','witness')
    OR receipt->>'status' IS DISTINCT FROM 'pending'
    OR pg_catalog.jsonb_typeof(receipt->'signing_order') IS DISTINCT FROM 'number'
    OR coalesce(receipt->>'signing_order','') !~ '^[1-9][0-9]*$'
    OR pg_catalog.jsonb_typeof(receipt->'source_version') IS DISTINCT FROM 'number'
    OR coalesce(receipt->>'source_version','') !~ '^[1-9][0-9]*$'
    OR pg_catalog.jsonb_typeof(receipt->'source_updated_at') IS DISTINCT FROM 'string' THEN
  IF _digest IS NULL THEN RAISE EXCEPTION 'Signer preparation unavailable' USING ERRCODE='42501'; END IF;
  RAISE EXCEPTION 'This preparation identity belongs to different original work' USING ERRCODE='40001';
 END IF;
 RETURN pg_catalog.jsonb_build_object('schema_version',1,'state','recorded',
  'agreement_id',_agreement,'client_id',receipt->'client_id','signer_id',_signer,
  'full_name',receipt->'full_name','email',receipt->'email','signer_role',receipt->'signer_role',
  'signing_order',receipt->'signing_order','status','pending','source_version',receipt->'source_version',
  'source_updated_at',receipt->'source_updated_at','event_id',event_row.id);
END $receipt$;
REVOKE ALL ON FUNCTION public._read_agreement_signer_preparation(uuid,uuid,uuid,uuid,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.prepare_agreement_signer(
 _expected_tenant_id uuid,_signing_id uuid,_expected_contact_id uuid,
 _expected_version integer,_expected_updated_at timestamptz,_signer_id uuid,
 _full_name text,_email text,_signer_role text DEFAULT 'counterparty',_signing_order integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $checked$
DECLARE
 actor uuid:=auth.uid(); source public.paige_agreements%ROWTYPE;
 existing public.paige_agreement_signers%ROWTYPE;
 name text:=pg_catalog.btrim(coalesce(_full_name,'')); mail text:=pg_catalog.lower(pg_catalog.btrim(coalesce(_email,'')));
 intent jsonb; digest text; receipt jsonb;
BEGIN
 -- Reuse the original human-reader authority before any lookup or mutation.
 -- The private writer independently repeats the original execution-time floor.
 PERFORM public.read_paige_agreement_preparation(_expected_tenant_id,_signing_id);
 IF _signer_id IS NULL OR _expected_contact_id IS NULL OR _expected_version IS NULL OR _expected_version<1
    OR _expected_updated_at IS NULL OR name='' OR pg_catalog.length(name)>200
    OR pg_catalog.length(mail)>320 OR mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR _signer_role IS NULL OR _signer_role NOT IN ('counterparty','tenant_signatory','witness')
    OR (_signing_order IS NOT NULL AND _signing_order<1) THEN
  RAISE EXCEPTION 'Complete supported signer preparation required' USING ERRCODE='22023';
 END IF;
 -- Native-only normalized intent identity. This is not a financial calculation.
 intent:=pg_catalog.jsonb_build_array(_expected_tenant_id,_signing_id,_expected_contact_id,
   _expected_version,extract(epoch FROM _expected_updated_at),name,mail,_signer_role,_signing_order);
 digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(intent::text,'UTF8')),'hex');
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'agreement-signer:'||_expected_tenant_id::text||':'||_signer_id::text,0));
 -- Authorization can change while a prior request holds this identity.
 PERFORM public.read_paige_agreement_preparation(_expected_tenant_id,_signing_id);
 SELECT * INTO existing FROM public.paige_agreement_signers WHERE id=_signer_id;
 IF FOUND THEN
  receipt:=public._read_agreement_signer_preparation(actor,_expected_tenant_id,_signing_id,_signer_id,digest,_expected_contact_id);
  RETURN pg_catalog.jsonb_set(receipt,'{state}','"replayed"'::jsonb);
 END IF;
 SELECT * INTO source FROM public.paige_agreements
  WHERE id=_signing_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Signer preparation unavailable' USING ERRCODE='42501'; END IF;
 IF source.contact_id IS DISTINCT FROM _expected_contact_id OR source.version IS DISTINCT FROM _expected_version
    OR source.updated_at IS DISTINCT FROM _expected_updated_at THEN
  RAISE EXCEPTION 'The reviewed agreement changed before party preparation' USING ERRCODE='40001';
 END IF;
 RETURN public._write_agreement_signer(_expected_tenant_id,_signing_id,_full_name,_email,_signer_role,_signing_order,_signer_id,digest);
END $checked$;
REVOKE ALL ON FUNCTION public.prepare_agreement_signer(uuid,uuid,uuid,integer,timestamptz,uuid,text,text,text,integer)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_agreement_signer(uuid,uuid,uuid,integer,timestamptz,uuid,text,text,text,integer) TO authenticated;

-- Read-only actor-bound recovery. Waiting shares the exact creation identity;
-- an absent result remains unconfirmed, never proof of cancellation or refusal.
CREATE OR REPLACE FUNCTION public.recover_agreement_signer_preparation(
 _expected_tenant_id uuid,_signing_id uuid,_signer_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $recover$
DECLARE actor uuid:=auth.uid(); receipt jsonb;
BEGIN
 PERFORM public.read_paige_agreement_preparation(_expected_tenant_id,_signing_id);
 IF _signer_id IS NULL THEN RAISE EXCEPTION 'Original preparation identity required' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'agreement-signer:'||_expected_tenant_id::text||':'||_signer_id::text,0));
 PERFORM public.read_paige_agreement_preparation(_expected_tenant_id,_signing_id);
 receipt:=public._read_agreement_signer_preparation(actor,_expected_tenant_id,_signing_id,_signer_id,NULL,NULL);
 IF receipt IS NULL THEN RETURN pg_catalog.jsonb_build_object('state','unconfirmed'); END IF;
 RETURN pg_catalog.jsonb_set(receipt,'{state}','"recovered"'::jsonb);
END $recover$;
REVOKE ALL ON FUNCTION public.recover_agreement_signer_preparation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recover_agreement_signer_preparation(uuid,uuid,uuid) TO authenticated;
COMMIT;
