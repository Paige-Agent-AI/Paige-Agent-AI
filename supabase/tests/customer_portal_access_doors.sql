-- E09 Slice 7 (integration): the open-access gate on the customer doors that Documents, Profile &
-- Consent, Agreements and Payments added after Slice 7 was written. Full replayed schema, actual
-- caller roles, synthetic data only (§63: Northwind Studio, Jordan Rivera); all rolled back.
--
-- Proves, for each door (client_portal_documents, client_portal_can_upload_file_object,
-- client_portal_communication_preferences, client_portal_set_communication_preference,
-- client_portal_set_shared_context_consent, client_portal_agreements,
-- client_portal_open_agreement_signing, client_portal_agreement_document_scope, and the three
-- Payments reads through _client_portal_billing_client):
--   * OPEN access is allowed and returns the door's data;
--   * PAUSED and ENDED access are refused with the door's own existing refusal (NULL, the
--     {ok:false,...} answer, or its 42501 message — never a new code or shape);
--   * a pause that lands after the resolver's read (simulated by a resolver without the access
--     predicate, i.e. the read that predates the pause) is still refused, because every door re-proves
--     the relationship through the ONE shared helper _client_portal_lock_relationship, whose re-proof
--     carries the open-access predicate (and, for writers, the row lock) — the race this closes;
--   * every door calls that helper and none calls the resolver directly; the helper is internal.
-- Round 2 (verifier + compliance) adds:
--   7. the Profile & Consent writers' locked re-check is the call that refuses when a pause lands
--      between their unlocked check and the lock (a stand-in helper pauses right after the first call);
--   8. client_portal_save_welcome's locked re-check is likewise the call that refuses;
--   9. a customer's existing Cura thread is refused once paused or ended
--      (paige_chat_customer_thread_authorized);
--  10. ensure_client_role_self_heal grants nothing to a paused client, and load_self_context /
--      customer_paige_activity_summary refuse a paused link for a team member who is also linked as the
--      business's client (the open §58 self-link path), where the access predicate is what decides;
--  11. pause and end through the real writer revoke a signing link the PORTAL issued, and leave a link
--      the business emailed as it is;
--  12. after a real end through set_client_portal_access, the invoice, its payment ledger, the agreements
--      and the client's files all still exist and the owner still reads them;
--  13. the owner's file-share answer, file list and "how they can be reached" say paused / ended
--      instead of "can open it" or "not joined yet".
BEGIN;
SELECT plan(107);

-- ── Seed ────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0997100-0000-4000-8000-000000000001','authenticated','authenticated','doors-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0997100-0000-4000-8000-000000000002','authenticated','authenticated','jordan.rivera.doors@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0997200-0000-4000-8000-000000000001','test-tenant-e09-access-doors','Northwind Studio','active','standalone',NULL,'E09AD',9497001,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0997200-0000-4000-8000-000000000001','e0997100-0000-4000-8000-000000000001','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e0997200-0000-4000-8000-000000000001' WHERE user_id='e0997100-0000-4000-8000-000000000001';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0997300-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997100-0000-4000-8000-000000000002','e0997100-0000-4000-8000-000000000001','Jordan','Rivera','active');

-- Documents: one file shared with Jordan, and one upload Jordan has reserved but not yet sent.
INSERT INTO public.client_files(id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state,created_at,updated_at) VALUES
 ('e0997400-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001','e0997100-0000-4000-8000-000000000001',
  'e0997200-0000-4000-8000-000000000001/e0997300-0000-4000-8000-000000000001/internal/e0997400-0000-4000-8000-000000000001','Welcome pack.pdf','application/pdf',11,'shared','ready',now()-interval '1 day','2027-01-01T00:00:00Z'),
 ('e0997400-0000-4000-8000-000000000002','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001','e0997100-0000-4000-8000-000000000002',
  'e0997200-0000-4000-8000-000000000001/e0997300-0000-4000-8000-000000000001/client_upload/e0997100-0000-4000-8000-000000000002/e0997400-0000-4000-8000-000000000002','Signed brief.pdf','application/pdf',12,'client_upload','pending',now()-interval '1 hour','2027-01-01T00:00:00Z');

-- Payments: one managed invoice issued to Jordan (the frozen issued shape sales_billing_draft_shape requires).
INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,due_date,memo,
  billing_draft_version,billing_draft,billing_last_operation_id,billing_last_request,billing_lifecycle_version,
  billing_issued_snapshot_version,billing_issued_at,billing_issued_by,billing_document,billing_document_digest,created_by)
VALUES ('e0997500-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001','NW-0101','issued',120000,'usd',current_date+14,'PRIVATE MEMO NOTE',
  1,'{}'::jsonb,gen_random_uuid(),'{}'::jsonb,2,1,now()-interval '2 days','e0997100-0000-4000-8000-000000000001',
  jsonb_build_object('schema_version',1,'invoice_number','NW-0101','issuer_name','Northwind Studio','client_name','Jordan Rivera','total_cents',120000),
  repeat('a',64),'e0997100-0000-4000-8000-000000000001');

-- Agreements: one sent to Jordan to sign, one completed and sealed; Jordan is the counterparty signer
-- on both at his own login address (the Slice A visibility rule).
INSERT INTO public.paige_agreements(id,tenant_id,contact_id,title,body_markdown,status,content_sha256,sealed_sha256,sealed_storage_key,sent_at,completed_at,expires_at,created_by) VALUES
 ('e0997600-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001','Website build agreement','Synthetic body 1','sent',repeat('c',64),NULL,NULL,now()-interval '1 day',NULL,now()+interval '10 days','e0997100-0000-4000-8000-000000000001'),
 ('e0997600-0000-4000-8000-000000000002','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001','Discovery agreement','Synthetic body 2','completed',repeat('c',64),repeat('d',64),'tenant/sealed-doors-2.pdf',now()-interval '5 days',now()-interval '1 day',NULL,'e0997100-0000-4000-8000-000000000001');
INSERT INTO public.paige_agreement_signers(id,agreement_id,tenant_id,full_name,email,signer_role,signing_order,status,
  esign_consent_at,esign_consent_slug,esign_consent_version,esign_consent_sha256,typed_name,signed_at) VALUES
 ('e0997700-0000-4000-8000-000000000001','e0997600-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','Jordan Rivera','jordan.rivera.doors@tests.invalid','counterparty',1,'pending',NULL,NULL,NULL,NULL,NULL,NULL),
 ('e0997700-0000-4000-8000-000000000002','e0997600-0000-4000-8000-000000000002','e0997200-0000-4000-8000-000000000001','Jordan Rivera','jordan.rivera.doors@tests.invalid','counterparty',1,'signed',
  now()-interval '2 hours','esign-consent',1,repeat('e',64),'Jordan Rivera',now()-interval '1 hour');

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.jordan(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e0997100-0000-4000-8000-000000000002', _sql) $$;
-- Where Jordan's access stands, written through the writer's own seam switch (the guard admits it),
-- so each state is exactly what set_client_portal_access leaves: paused keeps the link, ended clears
-- it and remembers him, open remembers nobody.
CREATE FUNCTION pg_temp.set_access(_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('paige.portal_access_write','1',true);
 IF _state='paused' THEN
  UPDATE public.clients SET linked_user_id='e0997100-0000-4000-8000-000000000002',portal_access_state='paused',
   portal_access_former_user_id=NULL,portal_access_reason='other',portal_access_changed_at=clock_timestamp()
   WHERE id='e0997300-0000-4000-8000-000000000001';
 ELSIF _state='ended' THEN
  UPDATE public.clients SET linked_user_id=NULL,portal_access_state='ended',
   portal_access_former_user_id='e0997100-0000-4000-8000-000000000002',portal_access_reason='other',portal_access_changed_at=clock_timestamp()
   WHERE id='e0997300-0000-4000-8000-000000000001';
 ELSE
  UPDATE public.clients SET linked_user_id='e0997100-0000-4000-8000-000000000002',portal_access_state='open',
   portal_access_former_user_id=NULL,portal_access_reason=NULL,portal_access_changed_at=clock_timestamp()
   WHERE id='e0997300-0000-4000-8000-000000000001';
 END IF;
 PERFORM set_config('paige.portal_access_write','',true);
END $$;
-- Every door, as Jordan, reduced to one comparable answer each.
CREATE FUNCTION pg_temp.doors() RETURNS TABLE(door text, r jsonb) LANGUAGE sql AS $$
 SELECT 'documents', pg_temp.jordan($q$SELECT public.client_portal_documents()$q$)
 UNION ALL SELECT 'can_upload', pg_temp.jordan($q$SELECT to_jsonb(public.client_portal_can_upload_file_object('e0997200-0000-4000-8000-000000000001/e0997300-0000-4000-8000-000000000001/client_upload/e0997100-0000-4000-8000-000000000002/e0997400-0000-4000-8000-000000000002'))$q$)
 UNION ALL SELECT 'preferences', pg_temp.jordan($q$SELECT public.client_portal_communication_preferences()$q$)
 UNION ALL SELECT 'set_preference', pg_temp.jordan($q$SELECT public.client_portal_set_communication_preference('email','newsletter',false)$q$)
 UNION ALL SELECT 'set_consent', pg_temp.jordan($q$SELECT public.client_portal_set_shared_context_consent(false)$q$)
 UNION ALL SELECT 'agreements', pg_temp.jordan($q$SELECT public.client_portal_agreements()$q$)
 UNION ALL SELECT 'open_signing', pg_temp.jordan($q$SELECT public.client_portal_open_agreement_signing('e0997600-0000-4000-8000-000000000001')$q$)
 UNION ALL SELECT 'document_scope', pg_temp.jordan($q$SELECT public.client_portal_agreement_document_scope('e0997600-0000-4000-8000-000000000002')$q$)
 UNION ALL SELECT 'invoices', pg_temp.jordan($q$SELECT public.client_portal_invoices()$q$)
 UNION ALL SELECT 'invoice_ledger', pg_temp.jordan($q$SELECT public.client_portal_invoice_ledger('e0997500-0000-4000-8000-000000000001')$q$)
 UNION ALL SELECT 'payment_request', pg_temp.jordan($q$SELECT public.client_portal_invoice_payment_request('e0997500-0000-4000-8000-000000000001')$q$)
$$;
CREATE FUNCTION pg_temp.d(_door text) RETURNS jsonb LANGUAGE sql AS $$ SELECT r FROM pg_temp.doors() WHERE door=_door $$;
-- The helper, called the way a definer door calls it: as its owner, with Jordan's claims.
CREATE FUNCTION pg_temp.helper(_mode text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims','{"sub":"e0997100-0000-4000-8000-000000000002","role":"authenticated"}',true);
 BEGIN EXECUTE format('SELECT to_jsonb(public._client_portal_lock_relationship(NULL,%L))',_mode) INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.def(_sig text) RETURNS text LANGUAGE sql AS
 $$ SELECT CASE WHEN to_regprocedure(_sig) IS NULL THEN '' ELSE pg_get_functiondef(to_regprocedure(_sig)) END $$;

-- ── 1. The one helper, and every door goes through it ───────────────────────────────────────────
SELECT ok(CASE WHEN to_regprocedure('public._client_portal_lock_relationship(uuid,text)') IS NULL THEN false ELSE
   NOT has_function_privilege('anon','public._client_portal_lock_relationship(uuid,text)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public._client_portal_lock_relationship(uuid,text)','EXECUTE')
   AND NOT has_function_privilege('service_role','public._client_portal_lock_relationship(uuid,text)','EXECUTE') END,
 'the shared helper _client_portal_lock_relationship exists and no API role can call it directly');
SELECT is(pg_temp.helper('bogus')->>'sqlstate','22023','the helper refuses a lock mode it does not know');
SELECT ok(pg_temp.def(sig) LIKE '%public._client_portal_lock_relationship(%' AND pg_temp.def(sig) NOT LIKE '%client_portal_relationship_id(%',
  format('%s re-proves the relationship through the shared helper, never the bare resolver', sig))
FROM unnest(ARRAY[
 'public.client_portal_documents(uuid,integer,timestamptz,uuid)',
 'public.client_portal_can_upload_file_object(text)',
 'public.client_portal_communication_preferences(uuid)',
 'public.client_portal_set_communication_preference(text,text,boolean,uuid)',
 'public.client_portal_set_shared_context_consent(boolean,uuid)',
 'public.client_portal_agreements(uuid,integer)',
 'public.client_portal_open_agreement_signing(uuid,uuid)',
 'public.client_portal_agreement_document_scope(uuid,uuid)',
 'public._client_portal_billing_client(uuid)']) sig;

-- ── 2. Open access: every door answers with its data ────────────────────────────────────────────
SELECT ok(pg_temp.d('documents')::text LIKE '%e0997400-0000-4000-8000-000000000001%','open: Documents lists the shared file');
SELECT is(pg_temp.d('can_upload'),'true'::jsonb,'open: the reserved upload may be sent');
SELECT ok(pg_temp.d('preferences') ? 'email','open: the preferences read answers');
SELECT ok(pg_temp.d('set_preference') IS NOT NULL AND NOT pg_temp.d('set_preference') ? 'sqlstate','open: a preference change is accepted');
SELECT ok(pg_temp.d('set_consent') IS NOT NULL AND NOT pg_temp.d('set_consent') ? 'sqlstate','open: the data-sharing change is accepted');
SELECT ok(pg_temp.d('agreements')::text LIKE '%e0997600-0000-4000-8000-000000000001%','open: Agreements lists the agreement to sign');
SELECT is(pg_temp.d('open_signing')->>'ok','true','open: the signing link opens');
SELECT is(pg_temp.d('document_scope')->>'agreement_id','e0997600-0000-4000-8000-000000000002','open: the signed copy is in scope for download');
SELECT ok(pg_temp.d('invoices')::text LIKE '%NW-0101%','open: Payments lists the issued invoice');
SELECT ok(pg_temp.d('invoice_ledger') IS NOT NULL AND NOT pg_temp.d('invoice_ledger') ? 'sqlstate','open: the invoice ledger answers');
SELECT ok(pg_temp.d('payment_request') ? 'remaining_cents','open: the payment request answers');

-- ── 3. Paused: each door's own existing refusal ─────────────────────────────────────────────────
SELECT pg_temp.set_access('paused');
SELECT ok(pg_temp.d('documents') IS NULL,'paused: Documents answers no relationship (NULL)');
SELECT is(pg_temp.d('can_upload'),'false'::jsonb,'paused: the upload is refused');
SELECT ok(pg_temp.d('preferences') IS NULL,'paused: the preferences read answers no relationship (NULL)');
SELECT is(pg_temp.d('set_preference')->>'error','customer relationship unavailable','paused: a preference change is refused with its existing message');
SELECT is(pg_temp.d('set_consent')->>'error','customer relationship unavailable','paused: the data-sharing change is refused with its existing message');
SELECT ok(pg_temp.d('agreements') IS NULL,'paused: Agreements answers no relationship (NULL)');
SELECT is(pg_temp.d('open_signing'),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'paused: the signing link is refused with its existing answer');
SELECT is(pg_temp.d('document_scope')->>'error','CLIENT_AGREEMENT_UNAVAILABLE','paused: the download is refused with its existing 42501');
SELECT ok(pg_temp.d('invoices') IS NULL,'paused: Payments answers no relationship (NULL)');
SELECT ok(pg_temp.d('invoice_ledger') IS NULL,'paused: the ledger answers no relationship (NULL)');
SELECT ok(pg_temp.d('payment_request') IS NULL,'paused: the payment request answers no relationship (NULL)');

-- ── 4. Ended: the same refusals ─────────────────────────────────────────────────────────────────
SELECT pg_temp.set_access('ended');
SELECT ok(pg_temp.d('documents') IS NULL,'ended: Documents answers no relationship (NULL)');
SELECT is(pg_temp.d('can_upload'),'false'::jsonb,'ended: the upload is refused');
SELECT ok(pg_temp.d('preferences') IS NULL,'ended: the preferences read answers no relationship (NULL)');
SELECT is(pg_temp.d('set_preference')->>'error','customer relationship unavailable','ended: a preference change is refused');
SELECT is(pg_temp.d('set_consent')->>'error','customer relationship unavailable','ended: the data-sharing change is refused');
SELECT ok(pg_temp.d('agreements') IS NULL,'ended: Agreements answers no relationship (NULL)');
SELECT is(pg_temp.d('open_signing'),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'ended: the signing link is refused');
SELECT is(pg_temp.d('document_scope')->>'error','CLIENT_AGREEMENT_UNAVAILABLE','ended: the download is refused');
SELECT ok(pg_temp.d('invoices') IS NULL,'ended: Payments answers no relationship (NULL)');
SELECT ok(pg_temp.d('invoice_ledger') IS NULL,'ended: the ledger answers no relationship (NULL)');
SELECT ok(pg_temp.d('payment_request') IS NULL,'ended: the payment request answers no relationship (NULL)');

-- ── 5. A pause that lands after the resolver read: still refused ────────────────────────────────
-- The resolver is restated WITHOUT its access predicate, standing in for a read whose snapshot
-- predates the pause (a pause committed between the resolver and the door's locked re-proof). The
-- doors must refuse on their own re-proof, which is the shared helper's.
CREATE TEMP TABLE resolver_def AS SELECT pg_get_functiondef('public.client_portal_relationship_id(uuid)'::regprocedure) AS def;
DO $$ BEGIN EXECUTE replace((SELECT def FROM resolver_def), E'\n    AND c.portal_access_state = ''open''', ''); END $$;
SELECT ok(pg_temp.def('public.client_portal_relationship_id(uuid)') NOT LIKE '%portal_access_state%','(the stand-in resolver no longer reads the access state)');
SELECT pg_temp.set_access('paused');
SELECT ok(pg_temp.d('documents') IS NULL,'late pause: Documents is still refused');
SELECT is(pg_temp.d('can_upload'),'false'::jsonb,'late pause: the upload is still refused');
SELECT ok(pg_temp.d('preferences') IS NULL,'late pause: the preferences read is still refused');
SELECT is(pg_temp.d('set_preference')->>'error','customer relationship unavailable','late pause: a preference change is still refused');
SELECT is(pg_temp.d('set_consent')->>'error','customer relationship unavailable','late pause: the data-sharing change is still refused');
SELECT ok(pg_temp.d('agreements') IS NULL,'late pause: Agreements is still refused');
SELECT is(pg_temp.d('open_signing'),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'late pause: the signing link is still refused');
SELECT is(pg_temp.d('document_scope')->>'error','CLIENT_AGREEMENT_UNAVAILABLE','late pause: the download is still refused');
SELECT ok(pg_temp.d('invoices') IS NULL,'late pause: Payments is still refused');
SELECT ok(pg_temp.d('invoice_ledger') IS NULL,'late pause: the ledger is still refused');
SELECT ok(pg_temp.d('payment_request') IS NULL,'late pause: the payment request is still refused');
SELECT ok(pg_temp.helper('share') IS NULL,'late pause: the helper itself answers no relationship (NULL)');
DO $$ BEGIN EXECUTE (SELECT def FROM resolver_def); END $$;

-- ── 6. Restored: the doors answer again ─────────────────────────────────────────────────────────
SELECT pg_temp.set_access('open');
SELECT is(pg_temp.helper('none'),to_jsonb('e0997300-0000-4000-8000-000000000001'::text),'restored: the helper answers Jordan''s relationship');
SELECT ok(pg_temp.d('documents')::text LIKE '%e0997400-0000-4000-8000-000000000001%','restored: Documents lists the shared file again');
SELECT ok(pg_temp.d('invoices')::text LIKE '%NW-0101%','restored: Payments lists the invoice again');
SELECT ok(pg_temp.d('agreements')::text LIKE '%e0997600-0000-4000-8000-000000000001%','restored: Agreements lists the agreement again');

-- ── 7. The Profile & Consent writers: the re-check under the lock is the one that refuses ─────────
-- A stand-in helper answers the FIRST call (the writer's unlocked 'none' check) from the real helper
-- while access is open, then pauses Jordan through the writer's seam — exactly a staff pause committing
-- between that check and the advisory key. The writer must refuse on its re-check under the lock, before
-- anything else: same message as today, and no third helper call (the read-back after a write). A
-- sequence counts the calls, because the refusal rolls back everything else, the pause included.
CREATE TEMP SEQUENCE helper_calls;
ALTER FUNCTION public._client_portal_lock_relationship(uuid,text) RENAME TO _client_portal_lock_relationship_real;
CREATE FUNCTION public._client_portal_lock_relationship(p_tenant_id uuid, p_lock text DEFAULT 'share')
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid; n bigint := nextval('pg_temp.helper_calls');
BEGIN
  v := public._client_portal_lock_relationship_real(p_tenant_id, p_lock);
  IF n = 1 AND v IS NOT NULL THEN
    PERFORM pg_catalog.set_config('paige.portal_access_write','1',true);
    UPDATE public.clients SET portal_access_state='paused', portal_access_reason='other',
      portal_access_changed_at=pg_catalog.clock_timestamp() WHERE id = v;
    PERFORM pg_catalog.set_config('paige.portal_access_write','',true);
  END IF;
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.race(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
  PERFORM setval('pg_temp.helper_calls', 1, false);
  _r := pg_temp.jordan(_sql);
  RETURN coalesce(_r->>'error', 'accepted') || ' | helper calls ' || (SELECT last_value FROM pg_temp.helper_calls)::text;
END $$;
SELECT pg_temp.set_access('open');
SELECT is(pg_temp.race($q$SELECT public.client_portal_set_communication_preference('email','newsletter',false)$q$),
  'customer relationship unavailable | helper calls 2',
  'a pause landing after the preference writer''s first check is refused by its re-check under the lock');
SELECT is(pg_temp.race($q$SELECT public.client_portal_set_shared_context_consent(false)$q$),
  'customer relationship unavailable | helper calls 2',
  'a pause landing after the data-sharing writer''s first check is refused by its re-check under the lock');
SELECT is((SELECT portal_access_state FROM public.clients WHERE id='e0997300-0000-4000-8000-000000000001'),'open',
  '(the refusal rolled the stand-in pause back with it)');
SELECT is(pg_temp.race($q$SELECT public.client_portal_communication_preferences()$q$),'accepted | helper calls 1',
  '(control: a door that only reads makes one helper call)');
SELECT pg_temp.set_access('open');
DROP FUNCTION public._client_portal_lock_relationship(uuid,text);
ALTER FUNCTION public._client_portal_lock_relationship_real(uuid,text) RENAME TO _client_portal_lock_relationship;

-- ── 8. client_portal_save_welcome: its locked re-check is the one that refuses ──────────────────
-- The same stand-in, on the resolver save_welcome calls first. Its re-check under the row lock must
-- refuse before anything else runs; without it, the save would reach the Welcome read-back (a second
-- resolver call) before refusing.
CREATE TEMP SEQUENCE resolver_calls;
ALTER FUNCTION public.client_portal_relationship_id(uuid) RENAME TO client_portal_relationship_id_real;
CREATE FUNCTION public.client_portal_relationship_id(p_tenant_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid; n bigint := nextval('pg_temp.resolver_calls');
BEGIN
  v := public.client_portal_relationship_id_real(p_tenant_id);
  IF n = 1 AND v IS NOT NULL THEN
    PERFORM pg_catalog.set_config('paige.portal_access_write','1',true);
    UPDATE public.clients SET portal_access_state='paused', portal_access_reason='other',
      portal_access_changed_at=pg_catalog.clock_timestamp() WHERE id = v;
    PERFORM pg_catalog.set_config('paige.portal_access_write','',true);
  END IF;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.client_portal_relationship_id(uuid) TO authenticated;
SELECT setval('pg_temp.resolver_calls', 1, false);
SELECT is((SELECT coalesce(r->>'error','accepted') || ' | resolver calls ' || (SELECT last_value FROM pg_temp.resolver_calls)::text
  FROM (SELECT pg_temp.jordan($q$SELECT public.client_portal_save_welcome(repeat('a',32),'{}'::jsonb,'{}'::jsonb)$q$) AS r) x),
  'customer relationship unavailable | resolver calls 1',
  'a pause landing after the Welcome save''s resolver read is refused by its re-check under the row lock');
DROP FUNCTION public.client_portal_relationship_id(uuid);
ALTER FUNCTION public.client_portal_relationship_id_real(uuid) RENAME TO client_portal_relationship_id;
SELECT pg_temp.set_access('open');

-- ── 9. Cura chat: an existing customer thread is refused once access is not open ─────────────────
INSERT INTO public.paige_chat_threads(id,tenant_id,contact_id,caller_user_id,audience,lens,title,auto_delete_at) VALUES
 ('e0997900-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001',
  'e0997100-0000-4000-8000-000000000002','customer_private','client','Jordan and Cura',now()+interval '30 days');
CREATE FUNCTION pg_temp.thread_ok() RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.jordan($q$SELECT to_jsonb(public.paige_chat_customer_thread_authorized('e0997900-0000-4000-8000-000000000001'))$q$) $$;
SELECT is(pg_temp.thread_ok(),'true'::jsonb,'open: Jordan''s existing Cura thread is authorized');
SELECT pg_temp.set_access('paused');
SELECT is(pg_temp.thread_ok(),'false'::jsonb,'paused: the same existing thread is refused');
SELECT pg_temp.set_access('ended');
SELECT is(pg_temp.thread_ok(),'false'::jsonb,'ended: the same existing thread is refused');
SELECT pg_temp.set_access('open');
SELECT is(pg_temp.thread_ok(),'true'::jsonb,'restored: the thread is authorized again');

-- ── 10. Self-heal, and a team member who is also linked as the business's client ─────────────────
-- ensure_client_role_self_heal is called as its owner (no API role holds EXECUTE today), with Jordan's claims.
CREATE FUNCTION pg_temp.as_owner_with(_actor uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
 BEGIN EXECUTE _sql INTO _r; EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
DELETE FROM public.user_roles WHERE user_id='e0997100-0000-4000-8000-000000000002' AND role='client';
SELECT pg_temp.set_access('paused');
SELECT is(pg_temp.as_owner_with('e0997100-0000-4000-8000-000000000002',$q$SELECT to_jsonb(count(*)) FROM public.ensure_client_role_self_heal()$q$),'0'::jsonb,
  'paused: the self-heal finds no relationship to heal');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='e0997100-0000-4000-8000-000000000002' AND role='client'),
  'paused: and grants no client role');
SELECT pg_temp.set_access('open');
SELECT is(pg_temp.as_owner_with('e0997100-0000-4000-8000-000000000002',$q$SELECT to_jsonb(count(*)) FROM public.ensure_client_role_self_heal()$q$),'1'::jsonb,
  'open: the self-heal answers the relationship');
-- The owner is also linked as a client of their own business (set up as the table owner; the §58 self-link
-- path an invitation can still produce). They read that row through the staff policy, so here the access
-- predicate in load_self_context / customer_paige_activity_summary is the only thing that decides.
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0997300-0000-4000-8000-000000000002','e0997200-0000-4000-8000-000000000001','e0997100-0000-4000-8000-000000000001','e0997100-0000-4000-8000-000000000001','Owner','Selflinked','active');
CREATE FUNCTION pg_temp.owner(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e0997100-0000-4000-8000-000000000001', _sql) $$;
SELECT is(pg_temp.jordan($q$SELECT public.load_self_context()$q$)->>'error','NO_LINKED_CONTACT',
  '(a pure customer cannot read their own clients row at all, open or not)');
SELECT is(pg_temp.owner($q$SELECT public.load_self_context()$q$)->>'ok','true','open self-link: the team member''s client context loads');
SELECT is(pg_temp.owner($q$SELECT public.customer_paige_activity_summary()$q$)->>'ok','true','open self-link: their activity summary answers');
DO $$ BEGIN PERFORM set_config('paige.portal_access_write','1',true);
  UPDATE public.clients SET portal_access_state='paused',portal_access_reason='other',portal_access_changed_at=clock_timestamp()
   WHERE id='e0997300-0000-4000-8000-000000000002';
  PERFORM set_config('paige.portal_access_write','',true); END $$;
SELECT is(pg_temp.owner($q$SELECT public.load_self_context()$q$)->>'error','NO_LINKED_CONTACT','paused self-link: the client context is refused');
SELECT is(pg_temp.owner($q$SELECT public.customer_paige_activity_summary()$q$)->>'error','NO_LINKED_CONTACT','paused self-link: the activity summary is refused');

-- ── 11. Signing links: one the portal issued stops on pause / end; one the business emailed stays ──
-- A second agreement whose link the business emailed (a 'sent' event, a token the portal never issued).
INSERT INTO public.paige_agreements(id,tenant_id,contact_id,title,body_markdown,status,content_sha256,sent_at,expires_at,created_by) VALUES
 ('e0997600-0000-4000-8000-000000000003','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001','Retainer agreement','Synthetic body 3','sent',repeat('c',64),now()-interval '1 day',now()+interval '10 days','e0997100-0000-4000-8000-000000000001');
INSERT INTO public.paige_agreement_signers(id,agreement_id,tenant_id,full_name,email,signer_role,signing_order,status,token_hash,token_expires_at) VALUES
 ('e0997700-0000-4000-8000-000000000003','e0997600-0000-4000-8000-000000000003','e0997200-0000-4000-8000-000000000001','Jordan Rivera','jordan.rivera.doors@tests.invalid','counterparty',1,'pending',
  encode(extensions.digest(repeat('b',64),'sha256'),'hex'),now()+interval '7 days');
INSERT INTO public.paige_agreement_events(agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_user_id) VALUES
 ('e0997600-0000-4000-8000-000000000003','e0997200-0000-4000-8000-000000000001','e0997700-0000-4000-8000-000000000003','sent','owner','e0997100-0000-4000-8000-000000000001');
-- A payment recorded on the invoice, so section 12 can prove the ledger survives an end.
INSERT INTO public.paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at) VALUES
 ('e0997800-0000-4000-8000-000000000001','e0997500-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997100-0000-4000-8000-000000000001','receipt',20000,'usd','zelle',now()-interval '1 day');
CREATE TEMP TABLE links(name text PRIMARY KEY, token text);
CREATE FUNCTION pg_temp.opens(_token text) RETURNS boolean LANGUAGE sql AS
 $$ SELECT (pg_temp.as_user(NULL,format('SELECT to_jsonb(is_valid) FROM public.peek_agreement_signing(%L)',_token),'anon'))::text::boolean $$;
-- The owner acts through the one writer, at the version they last read.
CREATE FUNCTION pg_temp.owner_access(_action text, _reason text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.owner(format('SELECT public.set_client_portal_access(%L,%L,%L,%L,%L,NULL,%L)',
   'e0997100-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001',
   _action,_reason,
   (pg_temp.owner($q$SELECT public.read_client_portal_access('e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001')$q$)->>'since')))
$$;
SELECT pg_temp.set_access('open');
-- Sections 2-6 opened the signing link dozens of times (pg_temp.d runs every door); the portal allows ten
-- an hour, so those earlier opens are cleared here (fixture housekeeping in this rolled-back run only).
DELETE FROM public.paige_audit_log WHERE action='agreement.portal_link_issued' AND target_id='e0997600-0000-4000-8000-000000000001';
INSERT INTO links SELECT 'portal', pg_temp.jordan($q$SELECT public.client_portal_open_agreement_signing('e0997600-0000-4000-8000-000000000001')$q$)->>'token';
SELECT ok(pg_temp.opens((SELECT token FROM links WHERE name='portal')),'open: the link the portal just issued opens the signing page');
SELECT ok(pg_temp.opens(repeat('b',64)),'open: the link the business emailed opens the signing page');
SELECT is(pg_temp.owner_access('pause','payment')->>'state','paused','the owner pauses Jordan through the writer');
SELECT ok(NOT pg_temp.opens((SELECT token FROM links WHERE name='portal')),'paused: the link the portal issued no longer opens');
SELECT ok((SELECT token_hash IS NULL AND token_revoked_at IS NULL AND token_expires_at IS NOT NULL FROM public.paige_agreement_signers WHERE id='e0997700-0000-4000-8000-000000000001'),
  'paused: only its token is cleared (no revocation stamp, the deadline kept)');
SELECT ok(pg_temp.opens(repeat('b',64)),'paused: the link the business emailed still opens, as it was');
SELECT is((SELECT data->>'signing_links_revoked' FROM public.audit_logs WHERE entity_id='e0997300-0000-4000-8000-000000000001'
  AND action='client_portal.access_paused' ORDER BY created_at DESC LIMIT 1),'1','the pause audit counts the one portal link it stopped');
SELECT is(pg_temp.owner_access('restore')->>'state','open','the owner restores Jordan');
INSERT INTO links SELECT 'portal2', pg_temp.jordan($q$SELECT public.client_portal_open_agreement_signing('e0997600-0000-4000-8000-000000000001')$q$)->>'token';
SELECT ok(pg_temp.opens((SELECT token FROM links WHERE name='portal2')),'restored: the portal issues a fresh link that opens');
SELECT ok((SELECT token_expires_at <= now()+interval '24 hours' FROM public.paige_agreement_signers WHERE id='e0997700-0000-4000-8000-000000000001'),
  'restored: and it lasts no longer than the portal''s 24 hours');
SELECT is(pg_temp.owner_access('end','engagement_ended')->>'state','ended','the owner ends Jordan''s access through the writer');
SELECT ok(NOT pg_temp.opens((SELECT token FROM links WHERE name='portal2')),'ended: the link the portal issued no longer opens');
SELECT ok(pg_temp.opens(repeat('b',64)),'ended: the link the business emailed still opens, as it was');

-- ── 12. After a real end, the commercial history is all still there and the owner still reads it ──
SELECT ok((SELECT linked_user_id IS NULL AND portal_access_state='ended' AND portal_access_former_user_id='e0997100-0000-4000-8000-000000000002'
  FROM public.clients WHERE id='e0997300-0000-4000-8000-000000000001'),'(the end went through set_client_portal_access: link cleared, Jordan remembered)');
SELECT is((SELECT count(*) FROM public.paige_invoices WHERE contact_id='e0997300-0000-4000-8000-000000000001'),1::bigint,'ended: the invoice issued to Jordan still exists');
SELECT is((SELECT count(*) FROM public.paige_invoice_payments WHERE invoice_id='e0997500-0000-4000-8000-000000000001'),1::bigint,'ended: its payment ledger row still exists');
SELECT is((SELECT count(*) FROM public.paige_agreements WHERE contact_id='e0997300-0000-4000-8000-000000000001'),3::bigint,'ended: all three agreements still exist');
SELECT is((SELECT count(*) FROM public.paige_agreement_signers s JOIN public.paige_agreements a ON a.id=s.agreement_id WHERE a.contact_id='e0997300-0000-4000-8000-000000000001'),3::bigint,
  'ended: and their signer rows, the completed signature among them');
SELECT is((SELECT count(*) FROM public.client_files WHERE contact_id='e0997300-0000-4000-8000-000000000001'),2::bigint,'ended: both of Jordan''s files still exist');
SELECT is(pg_temp.owner($q$SELECT public.read_sales_invoice('e0997200-0000-4000-8000-000000000001','e0997500-0000-4000-8000-000000000001')$q$)->>'invoice_number','NW-0101',
  'ended: the owner still reads the invoice');
SELECT is(pg_temp.owner($q$SELECT public.read_sales_invoice_payment_ledger('e0997200-0000-4000-8000-000000000001','e0997500-0000-4000-8000-000000000001')$q$)#>>'{payment_ledger,rows,0,id}',
  'e0997800-0000-4000-8000-000000000001','ended: the owner still reads the payment ledger');
SELECT is(pg_temp.owner($q$SELECT to_jsonb(count(*)) FROM public.paige_agreements WHERE contact_id='e0997300-0000-4000-8000-000000000001'$q$),'3'::jsonb,
  'ended: the owner still reads every agreement');
SELECT ok(pg_temp.owner($q$SELECT public.client_file_owner_list('e0997100-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001')$q$)::text
  LIKE '%e0997400-0000-4000-8000-000000000001%','ended: the owner still reads Jordan''s files');
SELECT ok(pg_temp.d('invoices') IS NULL AND pg_temp.d('documents') IS NULL AND pg_temp.d('agreements') IS NULL,'ended: while Jordan reads none of it');

-- ── 13. The owner's answers say what the client can actually see ─────────────────────────────────
CREATE FUNCTION pg_temp.share_answer() RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.owner(format('SELECT public.client_file_set_client_share(%L,%L,%L,true,%L)',
   'e0997100-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997400-0000-4000-8000-000000000001',
   (SELECT updated_at FROM public.client_files WHERE id='e0997400-0000-4000-8000-000000000001')))
$$;
CREATE FUNCTION pg_temp.owner_reads() RETURNS text LANGUAGE sql AS $$
 SELECT (pg_temp.share_answer()->>'portal_connected') || ' ' || coalesce(pg_temp.share_answer()->>'portal_access','-')
  || ' | list ' || (pg_temp.owner($q$SELECT public.client_file_owner_list('e0997100-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001')$q$)->>'portal_connected')
  || ' | reach ' || (pg_temp.owner($q$SELECT public.read_client_communication_state('e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001')$q$)->>'portal_joined')
  || ' ' || coalesce(pg_temp.owner($q$SELECT public.read_client_communication_state('e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001')$q$)->>'portal_access','-')
$$;
SELECT is(pg_temp.owner_reads(),'false ended | list false | reach false ended','ended: the share answer, the file list and the reach card say ended, never "not joined yet"');
SELECT pg_temp.set_access('paused');
SELECT is(pg_temp.owner_reads(),'false paused | list false | reach true paused','paused: they say paused — linked, but unable to see the file');
SELECT pg_temp.set_access('open');
SELECT is(pg_temp.owner_reads(),'true open | list true | reach true open','open: they say the client can see it');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.owner($q$SELECT public.client_file_owner_list('e0997100-0000-4000-8000-000000000001','e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000001')$q$)) k),
  ARRAY['contact_id','files','has_more','ok','portal_connected'],'the file list keeps exactly its keys (the Files card reads them exactly)');
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0997300-0000-4000-8000-000000000003','e0997200-0000-4000-8000-000000000001',NULL,'e0997100-0000-4000-8000-000000000001','Never','Joined','active');
SELECT is(pg_temp.owner($q$SELECT public.read_client_communication_state('e0997200-0000-4000-8000-000000000001','e0997300-0000-4000-8000-000000000003')$q$)->>'portal_access',
  'not_joined','a client who never joined reads not_joined');

SELECT * FROM finish();
ROLLBACK;
