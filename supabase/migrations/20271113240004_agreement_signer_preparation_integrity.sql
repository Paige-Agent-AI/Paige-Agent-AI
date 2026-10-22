-- EXP04: govern the existing signer-preparation writer, not a new signing engine.
-- Same signature, defaults, session/tenant/admin prefix, DTO, event and ACL.
-- No data backfill, token, consent, signing, sender, payment or admission effect.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$
DECLARE
 original_body text:=$original$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _status text;
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

  SELECT status INTO _status FROM public.paige_agreements
   WHERE id = _signing_id AND tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
  END IF;
  -- Only a draft. Adding a party to a document other people have already been shown would change
  -- what they agreed to after they agreed to it.
  IF _status <> 'draft' THEN
    RAISE EXCEPTION 'this agreement has already been sent; a signer cannot be added to it now'
      USING ERRCODE = '23514';
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
 replacement_body text:=$replacement$
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
$replacement$;
 current_body text;
 definition text;
BEGIN
 SELECT p.prosrc INTO current_body FROM pg_catalog.pg_proc p
  WHERE p.oid='public.add_agreement_signer(uuid,uuid,text,text,text,integer)'::regprocedure;
 IF current_body=replacement_body THEN RETURN; END IF;
 IF current_body IS DISTINCT FROM original_body THEN
  RAISE EXCEPTION 'Original signer writer changed; reconcile before applying';
 END IF;
 definition:=pg_catalog.pg_get_functiondef('public.add_agreement_signer(uuid,uuid,text,text,text,integer)'::regprocedure);
 IF pg_catalog.strpos(definition,original_body)=0 THEN
  RAISE EXCEPTION 'Original signer definition changed; reconcile before applying';
 END IF;
 EXECUTE pg_catalog.replace(definition,original_body,replacement_body);
END $migration$;
-- CREATE OR REPLACE from the exact original definition retains owner/ACL/defaults.
COMMIT;
