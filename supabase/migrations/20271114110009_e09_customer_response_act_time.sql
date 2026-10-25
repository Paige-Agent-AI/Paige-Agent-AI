-- The original customer response locks the action and current relationship before
-- checking expiry. now() is the transaction start, so a row wait could outlive the
-- deadline and still save a response. Recheck the wall clock at that same gate.
-- No ABI, grants, records, response kinds, audit or linked Action Bus/Rail change.
BEGIN;
DO $e09_response_act_time$
DECLARE
  _oid oid := 'public.customer_respond_to_action(uuid,text,text,timestamptz)'::regprocedure;
  _def text := pg_catalog.pg_get_functiondef(_oid);
  _body_md5 text := (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=_oid);
  _old text := 'IF v_action.status = ''expired'' OR v_action.expires_at <= now() THEN';
  _new text := 'IF v_action.status = ''expired'' OR v_action.expires_at <= pg_catalog.clock_timestamp() THEN';
BEGIN
  -- Full-schema replay and observed production differ in two retained STEP 4
  -- comments only. Both predecessors and their exact forward bodies are proven.
  IF _body_md5 IN ('3ef4c14c7e0545af4103f724b445ea8a','3e5b6bc2a80879db33ceb837c1ec7c15') THEN
    RETURN;
  END IF;
  IF _body_md5 NOT IN ('ae38f2c63729317d003cb8936ef2a6bb','e1095a18ee344a3b1528e7320d33fdd9')
    OR (pg_catalog.length(_def)-pg_catalog.length(pg_catalog.replace(_def,_old,'')))<>pg_catalog.length(_old)
    OR pg_catalog.strpos(_def,_new)>0 THEN
    RAISE EXCEPTION 'customer response act-time predecessor changed; reconcile before release';
  END IF;
  EXECUTE pg_catalog.replace(_def,_old,_new);
END
$e09_response_act_time$;
COMMIT;
