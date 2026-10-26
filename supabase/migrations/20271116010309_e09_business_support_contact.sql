-- CLI scaffold 20261026183251; renamed while empty/unapplied to a proposed forward
-- successor after the original E02 10102/10202 window. Recheck order before merge.
-- Public contact only. No new writer, grant, provisioner, sender or support store.
DO $migration$
DECLARE
  _oid oid := 'public.get_client_portal_brand()'::regprocedure;
  _body text;
  _before text := 'rb.product_name, rb.from_name, rb.support_email';
  _after text := $projection$rb.product_name, rb.from_name,
    -- E09_BUSINESS_SUPPORT_V1: never inherit a different business/platform contact.
    (SELECT btrim(candidate.email)
     FROM (
       SELECT 1 AS priority, t.brand->>'support_email' AS email
       FROM public.tenants t WHERE t.id = me.tid
       UNION ALL SELECT 2, p.support_email
       UNION ALL
       SELECT 3, i.local_part || '@' || s.shared_domain
       FROM public.tenant_email_identities i
       JOIN public.platform_email_settings s ON s.id = true
       WHERE i.tenant_id = me.tid AND i.kind = 'shared' AND i.status = 'active'
         -- A sending identity is not a receiving mailbox. Require the original
         -- inbound receiver's exact active route to this same business.
         AND EXISTS (SELECT 1 FROM public.channel_connectors c
           WHERE c.tenant_id = me.tid AND c.channel_type = 'email' AND c.active
             AND lower(c.inbound_address) = lower(i.local_part || '@' || s.shared_domain))
         AND NOT EXISTS (SELECT 1 FROM public.channel_connectors c
           WHERE c.tenant_id IS DISTINCT FROM me.tid AND c.channel_type = 'email' AND c.active
             -- Preserve the original receiver's match semantics as well as
             -- the exact own-business route; an ambiguous match is not readiness.
             AND c.inbound_address ILIKE (i.local_part || '@' || s.shared_domain))
     ) candidate
     WHERE length(btrim(candidate.email)) <= 254
       AND candidate.email !~ '[[:cntrl:]]'
       AND btrim(candidate.email) ~ '^[A-Za-z0-9!#$%&''*+/=?^_`{|}~.-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
       AND split_part(btrim(candidate.email),'@',1) !~ '(^\.|\.\.|\.$)'
       AND lower(btrim(candidate.email)) !~ '^(privacy|support|help|no-?reply)@(mail\.)?paigeagent\.ai$'
     ORDER BY candidate.priority LIMIT 1) AS support_email$projection$;
BEGIN
  SELECT prosrc INTO STRICT _body FROM pg_proc WHERE oid = _oid;
  -- Exact replay is harmless; unknown source is a review hold, never overwritten.
  IF position(_after IN _body) > 0 AND md5(replace(_body,_after,_before)) = '76db8ac4261c65f20a6465d0fc42fdab' THEN
    RETURN;
  END IF;
  IF md5(_body) <> '76db8ac4261c65f20a6465d0fc42fdab'
     OR position(_before IN _body) = 0 THEN
    RAISE EXCEPTION 'E09 business support projection: incumbent source changed; reconcile before applying' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(pg_get_functiondef(_oid), _before, _after);
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid=_oid),_after,_before)) <> '76db8ac4261c65f20a6465d0fc42fdab' THEN
    RAISE EXCEPTION 'E09 business support projection: inverse verification failed' USING ERRCODE = '55000';
  END IF;
END $migration$;
