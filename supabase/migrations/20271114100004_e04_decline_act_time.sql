-- Preserve the original signing engine and public recipient-token contract.
-- Lock in the same parent-before-signer order as the original signature writer,
-- then validate CURRENT authority. No new signing/approval/event store or grant.
-- definer-anon-exempt: preserves the original token-authorized external-recipient contract from 20270404000000; CREATE OR REPLACE retains its explicit anon/authenticated-only ACL, not default PUBLIC access. Identity comes only from a 256-bit credential hash, is revalidated under both original locks, and all invalid credentials receive the same refusal. No new signature, role grant or recovery permission.
BEGIN;
SET LOCAL lock_timeout='5s';

DO $guard$
DECLARE p record;
BEGIN
  SELECT f.*,l.lanname INTO p FROM pg_catalog.pg_proc f
    JOIN pg_catalog.pg_language l ON l.oid=f.prolang
    WHERE f.oid='public.decline_agreement_signing(text,text)'::pg_catalog.regprocedure;
  IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN ('654e4364555e35ee4e0d47601aea0754','0e6103f6efe199f0e4e6eb88aa0eea1a')
    OR p.prosecdef IS DISTINCT FROM true OR p.lanname<>'plpgsql'
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
    OR p.pronargdefaults<>1 OR p.proargnames IS DISTINCT FROM ARRAY['_token','_reason']::text[]
    OR p.prorettype<>'jsonb'::pg_catalog.regtype
    OR NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'Original agreement decline contract changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.decline_agreement_signing(_token text, _reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  _hash text;
  _initial public.paige_agreement_signers%ROWTYPE;
  _s public.paige_agreement_signers%ROWTYPE;
  _a public.paige_agreements%ROWTYPE;
  _act_at timestamptz;
  _bounded_reason text;
BEGIN
  IF _token IS NULL OR _token !~ '^[0-9a-f]{64}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false);
  END IF;
  _hash:=pg_catalog.encode(extensions.digest(_token,'sha256'),'hex');
  SELECT * INTO _initial FROM public.paige_agreement_signers WHERE token_hash=_hash;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false); END IF;

  -- The credential resolves identity; the browser never chooses a record/tenant.
  -- Lock the ORIGINAL parent first, just as _record_agreement_signature does.
  SELECT * INTO _a FROM public.paige_agreements
    WHERE id=_initial.agreement_id AND tenant_id=_initial.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false); END IF;
  SELECT * INTO _s FROM public.paige_agreement_signers
    WHERE id=_initial.id AND agreement_id=_a.id AND tenant_id=_a.tenant_id FOR UPDATE;
  _act_at:=pg_catalog.clock_timestamp();
  IF NOT FOUND OR _s.token_hash IS DISTINCT FROM _hash
    OR _s.token_revoked_at IS NOT NULL OR _s.token_expires_at IS NULL OR _s.token_expires_at<=_act_at
    OR _s.status NOT IN ('pending','viewed') OR _a.status NOT IN ('sent','viewed','partially_signed')
    OR (_a.expires_at IS NOT NULL AND _a.expires_at<=_act_at) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false);
  END IF;

  _bounded_reason:=pg_catalog.left(coalesce(_reason,''),1000);
  UPDATE public.paige_agreement_signers
    SET status='declined',declined_at=_act_at,decline_reason=_bounded_reason,updated_at=_act_at
    WHERE id=_s.id AND agreement_id=_a.id AND tenant_id=_a.tenant_id;
  UPDATE public.paige_agreements
    SET status='declined',declined_at=_act_at,updated_at=_act_at WHERE id=_a.id AND tenant_id=_a.tenant_id;
  -- Preserve the original rule: one decline ends this request for everyone.
  -- A lost acknowledgement never makes a revoked credential valid again.
  UPDATE public.paige_agreement_signers SET token_revoked_at=_act_at,updated_at=_act_at
    WHERE agreement_id=_a.id AND tenant_id=_a.tenant_id AND token_hash IS NOT NULL AND token_revoked_at IS NULL;
  INSERT INTO public.paige_agreement_events
    (agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_email,detail,created_at)
    VALUES(_a.id,_a.tenant_id,_s.id,'declined','signer',_s.email,
      pg_catalog.jsonb_build_object('reason',nullif(pg_catalog.btrim(_bounded_reason),'')),_act_at);
  RETURN pg_catalog.jsonb_build_object('ok',true);
END;
$function$;

-- CREATE OR REPLACE retains the existing owner and exact ACL. No REGRANT,
-- public recovery exception, prepared-signing admission or historical repair.
COMMIT;
