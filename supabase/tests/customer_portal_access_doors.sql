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
BEGIN;
SELECT plan(61);

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

SELECT * FROM finish();
ROLLBACK;
