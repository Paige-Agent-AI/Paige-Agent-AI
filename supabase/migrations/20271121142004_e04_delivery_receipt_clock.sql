-- Preserve original Work/review/release writers and their distinct clock semantics.
-- Review uses clock_timestamp(); release and audit receipts use transaction time.
-- Compare matching canonical receipt times, never infer a release from chronology.
BEGIN;
DO $receipt_clock$
DECLARE p pg_catalog.pg_proc%ROWTYPE; identity oid; before_metadata jsonb; definition text;
 anchor text:=$anchor$OR r.released_at<s.reviewed_at$anchor$;
 replacement text:=$replacement$OR r.released_at<coalesce((SELECT max(l.created_at) FROM public.audit_logs l
     WHERE l.entity='operations_delivery' AND l.entity_id=s.id AND l.action='delivery_reviewed'
      AND l.user_id=s.reviewed_by AND l.data->'tenant_id'=pg_catalog.to_jsonb(_tenant)
      AND l.data->>'state'=s.state AND l.data->'revision_no'=pg_catalog.to_jsonb(s.revision_no)),
     'infinity'::timestamptz)$replacement$;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public._sales_client_reviewed_delivery(uuid,uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN ('93f5fb101c0c54acab9ac2ac4a4f37e3','b0ec45d7adb8c38e6b582ac2cd00dbbb')
  OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
   WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'Original private delivery projection changed' USING ERRCODE='23514';
 END IF;
 identity:=p.oid;
 before_metadata:=pg_catalog.to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'];
 IF pg_catalog.md5(p.prosrc)='93f5fb101c0c54acab9ac2ac4a4f37e3' THEN
  definition:=pg_catalog.pg_get_functiondef(identity);
  IF (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,anchor,'')))/pg_catalog.length(anchor)<>1 THEN
   RAISE EXCEPTION 'Original delivery clock anchor changed' USING ERRCODE='23514';
  END IF;
  EXECUTE pg_catalog.replace(definition,anchor,replacement);
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=identity;
 IF 'public._sales_client_reviewed_delivery(uuid,uuid,uuid)'::regprocedure::oid<>identity
  OR before_metadata IS DISTINCT FROM pg_catalog.to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid']
  OR pg_catalog.md5(p.prosrc)<>'b0ec45d7adb8c38e6b582ac2cd00dbbb' THEN
  RAISE EXCEPTION 'Private delivery receipt-clock readback differs' USING ERRCODE='23514';
 END IF;
END $receipt_clock$;
COMMIT;
