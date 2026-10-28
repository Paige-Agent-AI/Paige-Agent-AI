-- Select the existing recorded business alias explicitly; its historical
-- connector label is not a transport, a default sender or provider readiness.
-- Only the two existing private E04 comparisons change. All public writers,
-- approval/Work/claim engines, grants and original records remain untouched.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $repair$
DECLARE item record; p pg_catalog.pg_proc%ROWTYPE; original_owner oid; revised text;
BEGIN
 SELECT proowner INTO original_owner FROM pg_catalog.pg_proc
  WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_actor(uuid,uuid)');
 IF original_owner IS NULL OR pg_catalog.to_regprocedure('public.resolve_tenant_sender(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Original agreement sender dependency unavailable' USING ERRCODE='23514';
 END IF;
 -- A historical connector label must not restore the retired provider's replay
 -- permission. Preserve the ORIGINAL SendGrid-only reconciliation dependency.
 IF (SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc
  WHERE oid=pg_catalog.to_regprocedure('public._comms_email_reconcilable(jsonb)')) IS DISTINCT FROM '2997fb0926a99f919ec8795e6f2765e6' THEN
  RAISE EXCEPTION 'Original email reconciliation source changed' USING ERRCODE='23514';
 END IF;
 FOR item IN SELECT * FROM (VALUES
  ('private.e04_prepared_confirmation_source(uuid,uuid,jsonb)',
   '039070012a306af391746d9ce95eeb61','075f6fd5a9d433e63a201309f72eb99f',
   $old$AND connector.channel_type='email' AND connector.provider='sendgrid'$old$,
   $new$AND connector.channel_type='email'
      AND (connector.provider='sendgrid' OR (connector.provider='resend'
       AND pg_catalog.lower(pg_catalog.btrim(connector.from_address))=r#>>'{sender,from_address}'
       AND EXISTS(SELECT 1 FROM (SELECT public.resolve_tenant_sender(_tenant) AS identity) original
        WHERE original.identity->>'tenant_id'=_tenant::text
         AND original.identity->>'kind'='shared' AND original.identity->>'source'='shared'
         AND pg_catalog.lower(pg_catalog.btrim(original.identity->>'from_address'))=r#>>'{sender,from_address}')))$new$),
  ('private.e04_agreement_email_binding(jsonb,boolean)',
   '25d777de071baeda11bb44fbf9a5f518','f7b028542fd76d1276776054d804da1e',
   $old$OR _binding->>'provider' IS DISTINCT FROM 'sendgrid'$old$,
   $new$OR NOT coalesce(_binding->>'provider'='sendgrid' OR (_binding->>'provider'='resend'
    AND EXISTS(SELECT 1 FROM public.channel_connectors connector
     CROSS JOIN LATERAL (SELECT public.resolve_tenant_sender((_binding->>'tenant_id')::uuid) AS identity) original
     WHERE connector.id=(_binding->>'connector_id')::uuid AND connector.tenant_id=(_binding->>'tenant_id')::uuid
      AND connector.channel_type='email' AND connector.provider='resend'
      AND pg_catalog.lower(pg_catalog.btrim(connector.from_address))=_binding->>'from_address'
      AND original.identity->>'tenant_id'=_binding->>'tenant_id'
      AND original.identity->>'kind'='shared' AND original.identity->>'source'='shared'
      AND pg_catalog.lower(pg_catalog.btrim(original.identity->>'from_address'))=_binding->>'from_address')),false)$new$)
 ) AS changes(identity,before_sha,after_sha,old_text,new_text) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(item.identity);
  IF NOT FOUND OR p.proowner IS DISTINCT FROM original_owner OR NOT p.prosecdef
   OR p.pronargdefaults<>0 OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
   OR p.proretset OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.prokind<>'f'
   OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR (item.identity LIKE '%confirmation_source%' AND
    (p.proargnames IS DISTINCT FROM ARRAY['_actor','_tenant','_args']::text[] OR p.prorettype<>'void'::regtype OR p.pronargs<>3))
   OR (item.identity LIKE '%email_binding%' AND
    (p.proargnames IS DISTINCT FROM ARRAY['_binding','_fresh']::text[] OR p.prorettype<>'jsonb'::regtype OR p.pronargs<>2))
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE a.privilege_type='EXECUTE' AND a.grantee<>original_owner)
   OR pg_catalog.md5(p.prosrc) NOT IN (item.before_sha,item.after_sha) THEN
   RAISE EXCEPTION 'Original agreement sender source changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
  IF pg_catalog.md5(p.prosrc)=item.before_sha THEN
   revised:=pg_catalog.replace(p.prosrc,item.old_text,item.new_text);
   IF revised=p.prosrc OR pg_catalog.md5(revised)<>item.after_sha THEN
    RAISE EXCEPTION 'Agreement sender source replacement differs' USING ERRCODE='23514';
   END IF;
   EXECUTE pg_catalog.replace(pg_catalog.pg_get_functiondef(p.oid),item.old_text,item.new_text);
  END IF;
 END LOOP;
END $repair$;
COMMIT;
