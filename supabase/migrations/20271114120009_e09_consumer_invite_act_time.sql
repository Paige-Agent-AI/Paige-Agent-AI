-- Recheck a customer invitation's deadline after its existing token/contact/
-- business locks and before linking a customer or writing a role/audit/receipt.
-- Original non-consumer branches, ABI and grants are unchanged.
BEGIN;
DO $e09_consumer_act_time$
DECLARE
  _oid oid := 'public.accept_tenant_invite(text)'::regprocedure;
  _def text := pg_catalog.pg_get_functiondef(_oid);
  _hash text := (SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=_oid);
  _business text := E'    PERFORM 1 FROM public.tenants WHERE id = _tok.tenant_id AND status = ''active'' FOR SHARE;\n    IF NOT FOUND THEN RAISE EXCEPTION ''customer relationship unavailable'' USING ERRCODE = ''42501''; END IF;\n';
  _effect text := E'    UPDATE public.clients SET linked_user_id = _uid,\n';
  _clock text := E'    IF _tok.expires_at <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION ''invite has expired''; END IF;\n';
BEGIN
  IF _hash='99b75b7f65d50cc4971c12dca4bef74e' THEN RETURN; END IF;
  IF _hash<>'543bb36574e23f05c20838b7ee56413f'
    OR (pg_catalog.length(_def)-pg_catalog.length(pg_catalog.replace(_def,_business,'')))<>pg_catalog.length(_business)
    OR (pg_catalog.length(_def)-pg_catalog.length(pg_catalog.replace(_def,_effect,'')))<>pg_catalog.length(_effect)
    OR pg_catalog.strpos(_def,_clock)>0 THEN
    RAISE EXCEPTION 'consumer invitation act-time source changed; reconcile before release';
  END IF;
  EXECUTE pg_catalog.replace(pg_catalog.replace(_def,_business,''),_effect,_business||_clock||_effect);
END
$e09_consumer_act_time$;
COMMIT;
