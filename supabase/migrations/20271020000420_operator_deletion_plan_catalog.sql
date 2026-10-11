-- ANT-47 timeout repair, round 2 (measured follow-up to 20271020000400/401).
-- After round 1 the worst scope's plan walk re-timed at 5198ms (from 8342ms): the preview
-- fits the authenticated role's 8s statement budget, but operator_delete_archived_account
-- walks the plan three times (preview + execution + absence readback) and still exceeds it.
-- The measured remainder: ~17 information_schema view queries inside the function (~45ms
-- each as this definer) and unindexed FK columns on closure children (paige_actions alone
-- carries seven; its child-side joins sequential-scan every probe).
--
-- This migration rewrites the function's two information_schema queries to equivalent
-- pg_catalog queries (same rows, same string_agg order — the proof suite's old-vs-new plan
-- equivalence re-verifies byte equality) and adds the audited FK-column indexes. No
-- algorithmic, contract or authority change of any kind.
CREATE OR REPLACE FUNCTION public.operator_account_deletion_plan(_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE plan jsonb:='{}'; blockers jsonb:='[]'; r record; tids jsonb; old jsonb; round int; changed boolean; n bigint; hash text; invalid bigint; cond text; entry jsonb; resource record; frontier text[]; next_frontier text[];
BEGIN
 -- ANT-47 round 2: the same discovery against pg_catalog directly; information_schema
 -- views cost ~45ms per query as this definer and the walk issued ~17 of them.
 FOR r IN SELECT cl.relname table_name,string_agg(format('t.%I=ANY($1)',a.attname),' OR ' ORDER BY a.attname) predicate
   FROM pg_attribute a JOIN pg_class cl ON cl.oid=a.attrelid
   JOIN pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname='public'
   JOIN pg_type ty ON ty.oid=a.atttypid AND ty.typname='uuid'
   WHERE cl.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND cl.relname<>'operator_account_archives' AND a.attname NOT IN ('retired_tenant_id','retired_working_context_tenant_id')
     AND (a.attname='tenant_id' OR a.attname LIKE '%\_tenant\_id' ESCAPE '\' OR (cl.relname='tenants' AND a.attname='id'))
   GROUP BY cl.relname ORDER BY cl.relname
 LOOP
   -- tenants are only the exact confirmed IDs; parent_tenant_id never widens them here.
   cond:=CASE WHEN r.table_name='tenants' THEN 't.id=ANY($1)' ELSE r.predicate END;
   EXECUTE format('SELECT coalesce(jsonb_agg(ctid::text ORDER BY ctid),''[]'') FROM public.%I t WHERE %s',r.table_name,cond) INTO tids USING _ids;
   IF jsonb_array_length(tids)>0 THEN plan:=plan||jsonb_build_object(r.table_name,tids); END IF;
 END LOOP;
 -- Discover all FK descendants, including records that lack a tenant column.
 -- ANT-47 timeout repair: a worklist frontier probes each foreign key only when its parent
 -- relation changed in the previous round (or just entered the plan) instead of re-probing
 -- every candidate FK every round. The fixpoint, the 30-round ceiling and each probe are
 -- unchanged in result; only redundant re-probes of unchanged parents are skipped, so the
 -- walk keeps the API role's bounded statement budget on real data volumes.
 frontier:=ARRAY(SELECT jsonb_object_keys(plan));
 FOR round IN 1..30 LOOP
   changed:=false; next_frontier:='{}';
   FOR r IN SELECT k.oid,c.relname child,p.relname parent FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class p ON p.oid=k.confrelid
     WHERE k.contype='f' AND n.nspname='public' AND plan ? p.relname AND p.relname<>'profiles' AND public.operator_retirement_disposition(p.relname)='delete' AND p.relname=ANY(frontier) ORDER BY c.relname,k.oid
   LOOP
     cond:=public.operator_retirement_fk_join(r.oid);
     old:=coalesce(plan->r.child,'[]');
     EXECUTE format('SELECT coalesce(jsonb_agg(ctid::text ORDER BY ctid),''[]'') FROM public.%I WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) OR ctid IN (SELECT c.ctid FROM public.%I c JOIN public.%I p ON %s WHERE p.ctid::text IN (SELECT value FROM jsonb_array_elements_text($2)))',r.child,r.child,r.parent,cond) INTO tids USING old,plan->r.parent;
     IF tids<>old THEN plan:=plan||jsonb_build_object(r.child,tids); changed:=true; next_frontier:=next_frontier||ARRAY[r.child]; END IF;
   END LOOP;
   frontier:=next_frontier;
   EXIT WHEN NOT changed;
 END LOOP;
 IF changed THEN blockers:=blockers||jsonb_build_array('Dependency graph exceeded the bounded review depth. Administrator disposition required.'); END IF;
 -- PAIGE phone mappings are deletable without a vendor call. Foreign ownership still refuses.
 IF EXISTS(SELECT 1 FROM public.tenant_phone_numbers p JOIN public.tenant_twilio_subaccounts t ON t.id=p.subaccount_id WHERE p.tenant_id=ANY(_ids) AND t.tenant_id<>p.tenant_id) THEN
  blockers:=blockers||jsonb_build_array('tenant_phone_numbers has cross-account ownership. Preserve the surviving account; reconcile its relationship first.');
 END IF;
 IF EXISTS(SELECT 1 FROM public.mcp_connections WHERE tenant_id=ANY(_ids) AND (legacy_source IS DISTINCT FROM 'tenant_n8n_connections' OR provider_key<>'n8n')) THEN blockers:=blockers||jsonb_build_array('mcp_connections: An independent connector requires its canonical disconnection and credential disposition.'); END IF;
 IF EXISTS(SELECT 1 FROM public.platform_subscriptions WHERE tenant_id=ANY(_ids) AND (stripe_subscription_id IS NOT NULL OR stripe_customer_id IS NOT NULL)) THEN blockers:=blockers||jsonb_build_array('Live billing references require authoritative billing retirement before account deletion.'); END IF;
 IF EXISTS(SELECT 1 FROM public.paige_voice_cost_reservations WHERE tenant_id=ANY(_ids) AND state IN ('reserved','ambiguous')) THEN
  blockers:=blockers||jsonb_build_array('Unsettled voice cost reservations require canonical settlement before deletion.');
 END IF;
 FOR r IN SELECT key relation,value tids FROM jsonb_each(plan) ORDER BY key LOOP
   n:=jsonb_array_length(r.tids);
   IF n>20000 THEN blockers:=blockers||jsonb_build_array(format('%s exceeds the bounded cleanup size; use a reviewed maintenance operation.',r.relation)); END IF;
   -- Every explicit scope field on a selected row must be empty or within the confirmed tree.
   SELECT string_agg(format('(t.%I IS NOT NULL AND NOT(t.%I=ANY($2)))',a.attname,a.attname),' OR ') INTO cond FROM pg_attribute a
     JOIN pg_class cl ON cl.oid=a.attrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname='public' JOIN pg_type ty ON ty.oid=a.atttypid AND ty.typname='uuid'
     WHERE cl.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND cl.relname=r.relation AND (a.attname='tenant_id' OR a.attname LIKE '%\_tenant\_id' ESCAPE '\') AND NOT(cl.relname='tenants' AND a.attname='parent_tenant_id');
   IF cond IS NOT NULL AND public.operator_retirement_disposition(r.relation)<>'preserve' THEN
     EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) AND (%s)',r.relation,cond) INTO invalid USING r.tids,_ids;
     IF invalid>0 THEN blockers:=blockers||jsonb_build_array(format('%s has cross-account dependencies. Preserve the surviving account; resolve its relationship first.',r.relation)); END IF;
   END IF;
   EXECUTE format('SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),'''')) FROM public.%I t WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1))',r.relation) INTO hash USING r.tids;
   -- File references are obligations even when their storage path is not tenant-prefixed.
   -- Only counts leave this helper; file URLs/keys and attachment payloads never do.
   EXECUTE format('SELECT count(*) FROM public.%I t WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) AND (nullif(to_jsonb(t)->>''storage_path'','''') IS NOT NULL OR nullif(to_jsonb(t)->>''file_path'','''') IS NOT NULL OR nullif(to_jsonb(t)->>''storage_key'','''') IS NOT NULL OR nullif(to_jsonb(t)->>''file_url'','''') IS NOT NULL OR coalesce(to_jsonb(t)->''attachments'',''null''::jsonb) NOT IN (''null''::jsonb,''[]''::jsonb,''{}''::jsonb))',r.relation) INTO invalid USING r.tids;
   IF invalid>0 THEN blockers:=blockers||jsonb_build_array(format('%s: %s file-bearing records require canonical object cleanup and absence verification before deletion.',r.relation,invalid)); END IF;
   IF r.relation='tenant_knowledge_docs' THEN
    EXECUTE 'SELECT count(*) FROM public.tenant_knowledge_docs t WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) AND (to_jsonb(t)->>''promoted_to_canon_id'' IS NOT NULL OR coalesce(to_jsonb(t)->>''share_to_network'',''false'')=''true'')' INTO invalid USING r.tids;
    IF invalid>0 THEN blockers:=blockers||jsonb_build_array('Network-shared Knowledge requires the canonical shared-record disposition before deletion.'); END IF;
   END IF;
   entry:=jsonb_build_object('tids',r.tids,'count',n,'hash',hash,'disposition',public.operator_retirement_disposition(r.relation));
   plan:=jsonb_set(plan,ARRAY[r.relation],entry);
   IF entry->>'disposition'='blocked' THEN blockers:=blockers||jsonb_build_array(format('%s: %s records require supported provider, file, financial, legal or security disposition.',r.relation,n)); END IF;
 END LOOP;
 RETURN jsonb_build_object('tables',plan,'blockers',blockers);
END $$;

REVOKE ALL ON FUNCTION public.operator_account_deletion_plan(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
