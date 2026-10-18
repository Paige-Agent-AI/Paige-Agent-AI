-- E09 Payments: full replayed schema, actual caller roles, synthetic data; all rolled back.
-- Proves: a customer reads only the invoices their OWN business relationship has issued to them
-- (managed issued + void; never a draft, a CSV-imported obligation, a legacy row, another client's,
-- another business's or a merged contact's), through an exact key allowlist; balances, open and
-- past-due counts come from the one canonical Sales balance owner; a test-mode provider receipt is
-- reported as test activity; the list never carries a payment link; the ledger strips the internal
-- provider-operation identity and never carries notes, references or actors; the payment-request
-- read returns only an EXISTING validated link and every incumbent projection guard nulls it; none
-- of the three reads writes anything; a sub-account's customer reads the same way (no tier filter);
-- and the incumbent owner and bearer reads are byte-for-byte untouched by this slice. The scope helper
-- also refuses, as E04 #2170 (aeb0db5f1) `_assert_e04_client_commercial_scope` does, a linked client who
-- is active staff of the same business, a platform owner, and a deleted or banned account (section 4b).
BEGIN;
SELECT plan(115);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0995100-0000-4000-8000-000000000001','authenticated','authenticated','payments-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000002','authenticated','authenticated','payments-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000003','authenticated','authenticated','jordan.rivera.payments@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000004','authenticated','authenticated','sam.okafor.payments@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000005','authenticated','authenticated','payments-staff-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000006','authenticated','authenticated','payments-agency@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000007','authenticated','authenticated','payments-sub-account@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000008','authenticated','authenticated','payments-sub-customer@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000009','authenticated','authenticated','payments-two-businesses@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000010','authenticated','authenticated','payments-merged@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000011','authenticated','authenticated','payments-client-and-staff@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000012','authenticated','authenticated','payments-platform-owner-client@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000013','authenticated','authenticated','payments-suspended-client@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0995100-0000-4000-8000-000000000014','authenticated','authenticated','payments-staff-elsewhere@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0995200-0000-4000-8000-000000000001','test-tenant-e09-payments-a','Northwind Studio','active','standalone',NULL,'E09PA',9485001,'{}'),
 ('e0995200-0000-4000-8000-000000000002','test-tenant-e09-payments-b','Test tenant payments B','active','standalone',NULL,'E09PB',9485002,'{}'),
 ('e0995200-0000-4000-8000-000000000003','test-tenant-e09-payments-agency','Test agency payments','active','agency',NULL,'E09PG',9485003,'{}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0995200-0000-4000-8000-000000000004','test-tenant-e09-payments-sub','Test sub-account payments','active','sub_account','e0995200-0000-4000-8000-000000000003','E09PS',9485004,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0995200-0000-4000-8000-000000000002','e0995100-0000-4000-8000-000000000002','owner','active',true,now()),
 ('e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000005','member','active',false,now()),
 ('e0995200-0000-4000-8000-000000000003','e0995100-0000-4000-8000-000000000006','owner','active',true,now()),
 ('e0995200-0000-4000-8000-000000000004','e0995100-0000-4000-8000-000000000007','owner','active',true,now()),
 -- Linked as a client of Northwind AND an active member of Northwind's own team.
 ('e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000011','member','active',false,now()),
 -- Linked as a client of Northwind and an active member of a DIFFERENT business (control).
 ('e0995200-0000-4000-8000-000000000002','e0995100-0000-4000-8000-000000000014','member','active',false,now());
-- A platform owner who is also linked as a client of Northwind (no JWT here: a trusted grant context).
INSERT INTO public.user_roles(user_id,role) VALUES ('e0995100-0000-4000-8000-000000000012','super_admin');
UPDATE public.profiles SET active_tenant_id='e0995200-0000-4000-8000-000000000001'
 WHERE user_id IN('e0995100-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000005');
UPDATE public.profiles SET active_tenant_id='e0995200-0000-4000-8000-000000000002' WHERE user_id='e0995100-0000-4000-8000-000000000002';
UPDATE public.profiles SET active_tenant_id='e0995200-0000-4000-8000-000000000004' WHERE user_id='e0995100-0000-4000-8000-000000000007';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0995300-0000-4000-8000-000000000001','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000003','e0995100-0000-4000-8000-000000000001','Jordan','Rivera','active'),
 ('e0995300-0000-4000-8000-000000000002','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000004','e0995100-0000-4000-8000-000000000001','Sam','Okafor','active'),
 ('e0995300-0000-4000-8000-000000000003','e0995200-0000-4000-8000-000000000001',NULL,'e0995100-0000-4000-8000-000000000001','Unconnected','Contact','active'),
 ('e0995300-0000-4000-8000-000000000004','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000010','e0995100-0000-4000-8000-000000000001','Merged','Away','active'),
 ('e0995300-0000-4000-8000-000000000006','e0995200-0000-4000-8000-000000000002',NULL,'e0995100-0000-4000-8000-000000000002','Foreign','Client','active'),
 ('e0995300-0000-4000-8000-000000000007','e0995200-0000-4000-8000-000000000004','e0995100-0000-4000-8000-000000000008','e0995100-0000-4000-8000-000000000007','Sub','Customer','active'),
 ('e0995300-0000-4000-8000-000000000009','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000011','e0995100-0000-4000-8000-000000000001','Casey','Lindqvist','active'),
 ('e0995300-0000-4000-8000-000000000010','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000012','e0995100-0000-4000-8000-000000000001','Morgan','Achebe','active'),
 ('e0995300-0000-4000-8000-000000000011','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000013','e0995100-0000-4000-8000-000000000001','Riley','Tanaka','active'),
 ('e0995300-0000-4000-8000-000000000012','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000014','e0995100-0000-4000-8000-000000000001','Avery','Mensah','active');
-- The merged contact's survivor is the unconnected contact (same tenant, per the lineage FK).
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('app.crm_merge_lineage_write','on',true);
UPDATE public.clients SET merged_into_contact_id='e0995300-0000-4000-8000-000000000003',merged_at=now() WHERE id='e0995300-0000-4000-8000-000000000004';
SELECT set_config('app.crm_merge_lineage_write','off',true);
SELECT set_config('request.jwt.claims','{}',true);

-- A managed invoice in the frozen issued/void shape sales_billing_draft_shape requires.
CREATE FUNCTION pg_temp.issue(_id uuid,_tenant uuid,_contact uuid,_number text,_status text,_currency text,_amount integer,
 _issued_at timestamptz,_due date) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,due_date,memo,
  billing_draft_version,billing_draft,billing_last_operation_id,billing_last_request,billing_lifecycle_version,
  billing_issued_snapshot_version,billing_issued_at,billing_issued_by,billing_document,billing_document_digest,created_by)
 SELECT _id,_tenant,_contact,_number,_status,_amount,_currency,_due,'PRIVATE MEMO NOTE',
  1,'{}'::jsonb,gen_random_uuid(),'{}'::jsonb,2,1,_issued_at,m.user_id,
  jsonb_build_object('schema_version',1,'invoice_number',_number,'issuer_name',t.name,'client_name','Synthetic client','total_cents',_amount),
  repeat('a',64),m.user_id
 FROM public.tenants t JOIN public.tenant_members m ON m.tenant_id=t.id AND m.is_owner WHERE t.id=_tenant
$$;
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000001','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000001','NW-0001','issued','usd',350000,now()-interval '10 days',current_date-3);
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000002','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000001','NW-0002','issued','usd',100000,now()-interval '8 days',current_date+20);
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000003','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000001','NW-0003','void','usd',20000,now()-interval '6 days',current_date-30);
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000004','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000001','NW-0004','issued','eur',50000,now()-interval '4 days',current_date+10);
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000008','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000002','SAMS-PRIVATE','issued','usd',9000000,now()-interval '2 days',current_date+5);
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000009','e0995200-0000-4000-8000-000000000002','e0995300-0000-4000-8000-000000000006','FOREIGN-PRIVATE','issued','usd',9000000,now()-interval '2 days',current_date+5);
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000010','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000004','MERGED-PRIVATE','issued','usd',9000000,now()-interval '2 days',current_date+5);
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000011','e0995200-0000-4000-8000-000000000004','e0995300-0000-4000-8000-000000000007','SUB-0001','issued','usd',25000,now()-interval '3 days',current_date+7);
-- One issued invoice for each refused caller, so a reverted guard returns real data, not an empty read.
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000012','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000009','STAFFCLIENT-0001','issued','usd',11000,now()-interval '3 days',current_date+7);
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000013','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000010','OWNERCLIENT-0001','issued','usd',12000,now()-interval '3 days',current_date+7);
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000014','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000011','SUSPENDED-0001','issued','usd',13000,now()-interval '3 days',current_date+7);
SELECT pg_temp.issue('e0995400-0000-4000-8000-000000000015','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000012','ELSEWHERE-0001','issued','usd',14000,now()-interval '3 days',current_date+7);
-- Jordan's rows that must never reach him: a managed draft, a CSV-imported obligation, a legacy row.
INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,
 billing_draft_version,billing_draft,billing_last_operation_id,billing_last_request) VALUES
 ('e0995400-0000-4000-8000-000000000005','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000001','DRAFT-PRIVATE','draft',9000000,'usd',1,'{}',gen_random_uuid(),'{}');
INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,billing_import_provenance,billing_import_version) VALUES
 ('e0995400-0000-4000-8000-000000000006','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000001','CSV-PRIVATE','recorded',9000000,'usd','{"evidence":"owner_imported_unverified","source":"csv"}',1);
INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency) VALUES
 ('e0995400-0000-4000-8000-000000000007','e0995200-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000001','LEGACY-PRIVATE','sent',9000000,'usd');

-- The business's own TEST-mode merchant (no network, no Stripe). INSERT always starts unpermitted.
INSERT INTO public.tenant_stripe_accounts(tenant_id,stripe_account_id,provider_environment,charges_enabled,details_submitted)
 VALUES ('e0995200-0000-4000-8000-000000000001','acct_TESTnorthwind','test',true,true);
UPDATE public.tenant_stripe_accounts SET sales_payment_permission=true WHERE tenant_id='e0995200-0000-4000-8000-000000000001';

-- Receipts on NW-0001: one manual (with private notes/reference), one TEST provider receipt settled
-- through its own operation. NW-0002 is paid in full by a manual receipt.
INSERT INTO public.paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,reference,notes,created_at) VALUES
 ('e0995500-0000-4000-8000-000000000001','e0995400-0000-4000-8000-000000000001','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000001','receipt',12000,'usd','zelle',now()-interval '9 days','PRIVATE REFERENCE TEXT','PRIVATE STAFF NOTE',now()-interval '9 days'),
 ('e0995500-0000-4000-8000-000000000003','e0995400-0000-4000-8000-000000000002','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000001','receipt',100000,'usd','wire',now()-interval '7 days',NULL,NULL,now()-interval '7 days');
INSERT INTO public.paige_invoice_provider_operations(id,tenant_id,invoice_id,client_id,actor_user_id,invoice_version,issued_snapshot_version,
 provider,merchant_account_id,merchant_binding_version,environment,amount_minor,currency,purpose,command,authority_fingerprint,idempotency_key,
 state,dispatch_claim_token,dispatch_started_at,provider_object_id,provider_status,provider_url,expires_at,verified_readback,settled_at,allocation_payment_id,created_at) VALUES
 ('e0995600-0000-4000-8000-000000000001','e0995200-0000-4000-8000-000000000001','e0995400-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000001',2,1,
  'stripe','acct_TESTnorthwind',1,'test',3000,'usd','partial','{}','0123456789abcdef','e09-payments-settled-01',
  'settled',gen_random_uuid(),now()-interval '9 days','cs_test_settled01','complete','https://checkout.stripe.com/c/pay/cs_test_settled01',now()-interval '8 days',
  '{"provider_transaction_id":"pi_test_settled01","provider_settlement_id":"ch_test_settled01"}',now()-interval '8 days','e0995500-0000-4000-8000-000000000002',now()-interval '9 days');
INSERT INTO public.paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,created_at,
 evidence_kind,provider_operation_id,provider,merchant_account_id,provider_environment,provider_transaction_id,provider_settlement_id,provider_verified_at) VALUES
 ('e0995500-0000-4000-8000-000000000002','e0995400-0000-4000-8000-000000000001','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000001','receipt',3000,'usd','stripe',now()-interval '8 days',now()-interval '8 days',
  'provider_verified','e0995600-0000-4000-8000-000000000001','stripe','acct_TESTnorthwind','test','pi_test_settled01','ch_test_settled01',now()-interval '8 days');
-- The business's OPEN payment request on NW-0001 (test-mode link, created later so it is the latest).
INSERT INTO public.paige_invoice_provider_operations(id,tenant_id,invoice_id,client_id,actor_user_id,invoice_version,issued_snapshot_version,
 provider,merchant_account_id,merchant_binding_version,environment,amount_minor,currency,purpose,command,authority_fingerprint,idempotency_key,
 state,dispatch_claim_token,dispatch_started_at,provider_object_id,provider_status,provider_url,expires_at,created_at) VALUES
 ('e0995600-0000-4000-8000-000000000002','e0995200-0000-4000-8000-000000000001','e0995400-0000-4000-8000-000000000001','e0995300-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000001',2,1,
  'stripe','acct_TESTnorthwind',1,'test',50000,'usd','partial','{}','fedcba9876543210','e09-payments-open-02',
  'customer_action_required',gen_random_uuid(),now()-interval '1 day','cs_test_open02','open','https://checkout.stripe.com/c/pay/cs_test_open02',now()+interval '1 hour',now()-interval '1 day');
-- The incumbent share grant (bearer page), for the §58 regression check.
INSERT INTO public.paige_invoice_access_grants(id,tenant_id,invoice_id,issued_snapshot_version,scope,token_hash,expires_at,actor_user_id) VALUES
 ('e0995700-0000-4000-8000-000000000001','e0995200-0000-4000-8000-000000000001','e0995400-0000-4000-8000-000000000001',1,'share',repeat('b',64),now()+interval '1 day','e0995100-0000-4000-8000-000000000001');

CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon;
 ELSIF _role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.jordan(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e0995100-0000-4000-8000-000000000003', _sql) $$;
CREATE FUNCTION pg_temp.list(_sql text DEFAULT 'SELECT public.client_portal_invoices()') RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.jordan(_sql) $$;
CREATE FUNCTION pg_temp.inv(_r jsonb, _id text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT e FROM jsonb_array_elements(_r->'invoices') e WHERE e->>'id' = _id $$;
CREATE FUNCTION pg_temp.ids(_r jsonb) RETURNS text LANGUAGE sql AS
 $$ SELECT coalesce(string_agg(e->>'invoice_number', ',' ORDER BY o), '') FROM jsonb_array_elements(_r->'invoices') WITH ORDINALITY x(e,o) $$;
CREATE FUNCTION pg_temp.keys(_o jsonb) RETURNS text LANGUAGE sql AS
 $$ SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(_o) k $$;
CREATE FUNCTION pg_temp.ledger(_invoice text, _extra text DEFAULT '') RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.jordan(format('SELECT public.client_portal_invoice_ledger(%L%s)', _invoice, _extra)) $$;
CREATE FUNCTION pg_temp.request(_invoice text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.jordan(format('SELECT public.client_portal_invoice_payment_request(%L)', _invoice)) $$;
CREATE FUNCTION pg_temp.link() RETURNS text LANGUAGE sql AS
 $$ SELECT pg_temp.request('e0995400-0000-4000-8000-000000000001') #>> '{payment_request,provider_url}' $$;
-- Fixture-only mutation of an operation whose identity the incumbent trigger freezes. The read under
-- test is not relaxed, only the seed; the trigger is re-enabled before the read runs.
CREATE FUNCTION pg_temp.fixture(_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 SET CONSTRAINTS ALL IMMEDIATE;  -- the deferred allocation FK fires now (and passes) so ALTER can run
 ALTER TABLE public.paige_invoice_provider_operations DISABLE TRIGGER sales_payment_operation_immutable;
 EXECUTE _sql;
 ALTER TABLE public.paige_invoice_provider_operations ENABLE TRIGGER sales_payment_operation_immutable;
END $$;
CREATE TEMP TABLE before_counts AS SELECT
 (SELECT count(*) FROM public.paige_invoice_provider_operations) ops,(SELECT count(*) FROM public.paige_invoice_payments) pays,
 (SELECT count(*) FROM public.paige_invoice_access_grants) grants,(SELECT count(*) FROM public.paige_invoice_operations) inv_ops,
 (SELECT count(*) FROM public.paige_invoices) invoices,(SELECT count(*) FROM public.paige_audit_log) audit;
GRANT SELECT ON before_counts TO authenticated, anon, service_role;

-- ── 1. Grants and shape ───────────────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon','public.client_portal_invoices(uuid,integer,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','public.client_portal_invoice_ledger(uuid,uuid,integer,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','public.client_portal_invoice_payment_request(uuid,uuid)','EXECUTE'), 'anon cannot execute any customer billing read');
SELECT ok(has_function_privilege('authenticated','public.client_portal_invoices(uuid,integer,jsonb)','EXECUTE')
 AND has_function_privilege('authenticated','public.client_portal_invoice_ledger(uuid,uuid,integer,jsonb)','EXECUTE')
 AND has_function_privilege('authenticated','public.client_portal_invoice_payment_request(uuid,uuid)','EXECUTE'), 'authenticated can execute the three customer billing reads');
SELECT ok(has_function_privilege('service_role','public.client_portal_invoices(uuid,integer,jsonb)','EXECUTE')
 AND has_function_privilege('service_role','public.client_portal_invoice_ledger(uuid,uuid,integer,jsonb)','EXECUTE')
 AND has_function_privilege('service_role','public.client_portal_invoice_payment_request(uuid,uuid)','EXECUTE'), 'service_role can execute the three customer billing reads');
SELECT ok(NOT has_function_privilege('anon','public._client_portal_billing_client(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public._client_portal_billing_client(uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public._client_portal_billing_client(uuid)','EXECUTE'), 'the private scope helper is callable by no API role');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND p.proname IN ('client_portal_invoices','client_portal_invoice_ledger','client_portal_invoice_payment_request','_client_portal_billing_client')
  AND p.provolatile='v' AND p.prosecdef AND array_to_string(p.proconfig,',')='search_path=public, pg_temp'), 4,
 'all four are SECURITY DEFINER, VOLATILE (they take FOR SHARE locks) and pin search_path');
SELECT ok(has_function_privilege('service_role','public._sales_invoice_read(uuid,uuid,integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public._sales_invoice_read(uuid,uuid,integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public._sales_invoice_payment_projection(uuid,uuid,uuid,bigint)','EXECUTE')
 AND NOT has_function_privilege('service_role','public._sales_invoice_payment_projection(uuid,uuid,uuid,bigint)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public._sales_invoice_balance_rows(uuid,uuid)','EXECUTE'), 'the incumbent Sales owners keep their grants exactly');

-- ── 2. Visibility ─────────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.ids(pg_temp.list()), 'NW-0004,NW-0003,NW-0002,NW-0001', 'Jordan sees exactly his issued and voided invoices, newest first');
SELECT is((pg_temp.list()->>'invoice_count')::int, 4, 'invoice_count counts only what he can see');
SELECT is(pg_temp.inv(pg_temp.list(),'e0995400-0000-4000-8000-000000000003')->>'status', 'void', 'a voided invoice stays visible as void');
SELECT is((SELECT string_agg(DISTINCT e->>'status', ',') FROM jsonb_array_elements(pg_temp.list()->'invoices') e WHERE e->>'invoice_number'<>'NW-0003'), 'issued', 'every other visible invoice is issued');
SELECT is(pg_temp.list()->>'tenant_id', 'e0995200-0000-4000-8000-000000000001', 'the business is his own relationship''s');
SELECT is(pg_temp.list()->>'business_name', 'Northwind Studio', 'business_name is the business''s name');
SELECT ok(pg_temp.list()::text !~ '(PRIVATE|DRAFT-|CSV-|LEGACY-|SAMS-|FOREIGN-|MERGED-)', 'no draft, CSV import, legacy row, other client, other business or merged contact, and no memo');

-- ── 3. Exact keys ─────────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.keys(pg_temp.list()), 'balances,business_name,has_more,invoice_count,invoices,next_cursor,open_count,read_at,schema_version,tenant_id', 'root keys are exact');
SELECT is((SELECT count(DISTINCT pg_temp.keys(e))::int FROM jsonb_array_elements(pg_temp.list()->'invoices') e), 1, 'every invoice row has the same key set');
SELECT is(pg_temp.keys(pg_temp.list()->'invoices'->0), 'amount_minor,currency,due_date,id,invoice_number,issued_at,manual_recorded_minor,past_due,payable,provider_verified_minor,remaining_minor,status,test_provider_minor', 'invoice keys are exact');
SELECT is((SELECT count(DISTINCT pg_temp.keys(e))::int FROM jsonb_array_elements(pg_temp.list()->'balances') e), 1, 'every balance row has the same key set');
SELECT is(pg_temp.keys(pg_temp.list()->'balances'->0), 'currency,manual_recorded_minor,provider_verified_minor,remaining_minor,test_provider_minor', 'balance keys are exact');
SELECT ok(pg_temp.list()::text !~ '(checkout\.stripe\.com|acct_|cs_test|e0995600|e0995100)', 'the list carries no payment link, merchant, provider object, operation id or person id');
SELECT is(pg_temp.list()->>'schema_version', '1', 'schema_version is 1');

-- ── 4. Who can read ───────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.as_user(NULL,'SELECT public.client_portal_invoices()')->>'error', 'customer authentication required', 'a signed-out caller is refused');
SELECT is(pg_temp.as_user(NULL,'SELECT public.client_portal_invoices()')->>'sqlstate', '42501', 'with 42501');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000005','SELECT public.client_portal_invoices()'), NULL, 'a staff member with no client relationship reads nothing');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000001','SELECT public.client_portal_invoices()'), NULL, 'the business owner is not a customer of their own business');
SELECT is(pg_temp.list(format('SELECT public.client_portal_invoices(%L)','e0995200-0000-4000-8000-000000000002')), NULL, 'a foreign tenant argument narrows to nothing; it never supplies authority');
SELECT is(pg_temp.ids(pg_temp.list(format('SELECT public.client_portal_invoices(%L)','e0995200-0000-4000-8000-000000000001'))), 'NW-0004,NW-0003,NW-0002,NW-0001', 'his own tenant argument narrows to the same relationship');
-- Two relationships need the global one-login-one-client index lifted inside this rolled-back test
-- (multi-business membership is Slice 8); it is restored right after.
DROP INDEX public.clients_linked_user_id_unique;
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0995300-0000-4000-8000-000000000005','e0995200-0000-4000-8000-000000000001','e0995100-0000-4000-8000-000000000009','e0995100-0000-4000-8000-000000000001','Two','Businesses','active'),
 ('e0995300-0000-4000-8000-000000000008','e0995200-0000-4000-8000-000000000002','e0995100-0000-4000-8000-000000000009','e0995100-0000-4000-8000-000000000002','Two','Businesses','active');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000009','SELECT public.client_portal_invoices()')->>'error', 'select an authorized customer relationship', 'two relationships refuse with the exact message');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000009',format('SELECT public.client_portal_invoices(%L)','e0995200-0000-4000-8000-000000000001'))->>'tenant_id', 'e0995200-0000-4000-8000-000000000001', 'a tenant argument selects one of two legitimate relationships');
DELETE FROM public.clients WHERE id IN ('e0995300-0000-4000-8000-000000000005','e0995300-0000-4000-8000-000000000008');
CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients(linked_user_id) WHERE linked_user_id IS NOT NULL;
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000010','SELECT public.client_portal_invoices()'), NULL, 'a merged contact has no relationship');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000003','SELECT public.client_portal_invoices()','anon')->>'sqlstate', '42501', 'anon is refused by the grant');

-- ── 4b. Refused callers (guards ported from E04 #2170 aeb0db5f1, `_assert_e04_client_commercial_scope`) ─
-- Each refused caller is a real linked client with a real issued invoice, so reverting a guard returns
-- that invoice instead of nothing. #2170's standalone-only tenant filter is NOT ported (§60/§61; section 7).
CREATE FUNCTION pg_temp.reads(_actor uuid, _invoice text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'list', pg_temp.as_user(_actor, 'SELECT public.client_portal_invoices()'),
  'ledger', pg_temp.as_user(_actor, format('SELECT public.client_portal_invoice_ledger(%L)', _invoice)),
  'request', pg_temp.as_user(_actor, format('SELECT public.client_portal_invoice_payment_request(%L)', _invoice))) $$;
-- Same person linked as a client AND active staff of the same business: no customer billing read.
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000011','e0995400-0000-4000-8000-000000000012')->'list', 'null'::jsonb, 'a linked client who is also active staff of the same business reads no invoice list');
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000011','e0995400-0000-4000-8000-000000000012')->'ledger', 'null'::jsonb, 'and no ledger');
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000011','e0995400-0000-4000-8000-000000000012')->'request', 'null'::jsonb, 'and no payment request');
SELECT is(pg_temp.ids(pg_temp.as_user('e0995100-0000-4000-8000-000000000014','SELECT public.client_portal_invoices()')), 'ELSEWHERE-0001', 'a linked client who is staff of a DIFFERENT business still reads their own invoices');
-- A platform owner linked as a client: no customer billing read.
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000012','e0995400-0000-4000-8000-000000000013')->'list', 'null'::jsonb, 'a platform owner linked as a client reads no invoice list');
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000012','e0995400-0000-4000-8000-000000000013')->'ledger', 'null'::jsonb, 'and no ledger');
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000012','e0995400-0000-4000-8000-000000000013')->'request', 'null'::jsonb, 'and no payment request');
-- A deleted or banned account is refused as unauthenticated, with 42501.
SELECT is(pg_temp.ids(pg_temp.as_user('e0995100-0000-4000-8000-000000000013','SELECT public.client_portal_invoices()')), 'SUSPENDED-0001', 'before suspension the client reads their invoice');
UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = 'e0995100-0000-4000-8000-000000000013';
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000013','e0995400-0000-4000-8000-000000000014')->'list'->>'sqlstate', '42501', 'a banned account reads no invoice list (42501)');
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000013','e0995400-0000-4000-8000-000000000014')->'ledger'->>'error', 'customer authentication required', 'and no ledger');
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000013','e0995400-0000-4000-8000-000000000014')->'request'->>'error', 'customer authentication required', 'and no payment request');
UPDATE auth.users SET banned_until = now() - interval '1 day' WHERE id = 'e0995100-0000-4000-8000-000000000013';
SELECT is(pg_temp.ids(pg_temp.as_user('e0995100-0000-4000-8000-000000000013','SELECT public.client_portal_invoices()')), 'SUSPENDED-0001', 'a ban that has expired no longer refuses');
UPDATE auth.users SET banned_until = NULL, deleted_at = now() WHERE id = 'e0995100-0000-4000-8000-000000000013';
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000013','e0995400-0000-4000-8000-000000000014')->'list'->>'sqlstate', '42501', 'a deleted account reads no invoice list (42501)');
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000013','e0995400-0000-4000-8000-000000000014')->'ledger'->>'error', 'customer authentication required', 'and no ledger');
SELECT is(pg_temp.reads('e0995100-0000-4000-8000-000000000013','e0995400-0000-4000-8000-000000000014')->'request'->>'error', 'customer authentication required', 'and no payment request');
UPDATE auth.users SET deleted_at = NULL WHERE id = 'e0995100-0000-4000-8000-000000000013';

-- ── 5. Balances (one canonical owner) ─────────────────────────────────────────────────────────────
SELECT is((SELECT e FROM jsonb_array_elements(pg_temp.list()->'balances') e WHERE e->>'currency'='usd'),
 '{"currency":"usd","remaining_minor":"335000","provider_verified_minor":"3000","manual_recorded_minor":"112000","test_provider_minor":"3000"}'::jsonb,
 'usd balance: void excluded, both receipts allocated, the test receipt reported as test');
SELECT is((SELECT e FROM jsonb_array_elements(pg_temp.list()->'balances') e WHERE e->>'currency'='eur'),
 '{"currency":"eur","remaining_minor":"50000","provider_verified_minor":"0","manual_recorded_minor":"0","test_provider_minor":"0"}'::jsonb, 'eur balance is its own currency');
SELECT is((pg_temp.list()->>'open_count')::int, 2, 'open_count is the issued invoices with something remaining');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(pg_temp.list()->'invoices') e WHERE (e->>'past_due')::boolean), 1, 'only the overdue open invoice is past due');
SELECT is(pg_temp.inv(pg_temp.list(),'e0995400-0000-4000-8000-000000000001') - 'issued_at' - 'due_date',
 '{"id":"e0995400-0000-4000-8000-000000000001","invoice_number":"NW-0001","status":"issued","currency":"usd","amount_minor":"350000","remaining_minor":"335000","provider_verified_minor":"3000","manual_recorded_minor":"12000","test_provider_minor":"3000","payable":true,"past_due":true}'::jsonb,
 'NW-0001: partially paid, past due, payable through the business''s existing link');
SELECT is(pg_temp.inv(pg_temp.list(),'e0995400-0000-4000-8000-000000000002')->>'remaining_minor', '0', 'NW-0002 is paid in full');
SELECT ok(NOT (pg_temp.inv(pg_temp.list(),'e0995400-0000-4000-8000-000000000002')->>'payable')::boolean
 AND NOT (pg_temp.inv(pg_temp.list(),'e0995400-0000-4000-8000-000000000002')->>'past_due')::boolean, 'a paid invoice is neither payable nor past due');
SELECT ok(NOT (pg_temp.inv(pg_temp.list(),'e0995400-0000-4000-8000-000000000003')->>'payable')::boolean
 AND NOT (pg_temp.inv(pg_temp.list(),'e0995400-0000-4000-8000-000000000003')->>'past_due')::boolean, 'a voided invoice is never payable or past due, even after its due date');
SELECT ok(NOT (pg_temp.inv(pg_temp.list(),'e0995400-0000-4000-8000-000000000004')->>'payable')::boolean, 'an invoice with no payment request is not payable');
SELECT is(pg_temp.inv(pg_temp.list(),'e0995400-0000-4000-8000-000000000004')->>'due_date', (current_date+10)::text, 'due_date is the invoice''s own');

-- ── 6. Paging ─────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE pages(n int, r jsonb);
GRANT SELECT ON pages TO authenticated;
INSERT INTO pages SELECT 1, pg_temp.list('SELECT public.client_portal_invoices(NULL,1)');
INSERT INTO pages SELECT 2, pg_temp.list(format('SELECT public.client_portal_invoices(NULL,1,%L::jsonb)',(SELECT r->'next_cursor' FROM pages WHERE n=1)));
INSERT INTO pages SELECT 3, pg_temp.list(format('SELECT public.client_portal_invoices(NULL,1,%L::jsonb)',(SELECT r->'next_cursor' FROM pages WHERE n=2)));
INSERT INTO pages SELECT 4, pg_temp.list(format('SELECT public.client_portal_invoices(NULL,1,%L::jsonb)',(SELECT r->'next_cursor' FROM pages WHERE n=3)));
SELECT is((SELECT string_agg(pg_temp.ids(r), ',' ORDER BY n) FROM pages), 'NW-0004,NW-0003,NW-0002,NW-0001', 'keyset pages walk the same order with no gap or repeat');
SELECT is((SELECT string_agg(r->>'has_more', ',' ORDER BY n) FROM pages), 'true,true,true,false', 'has_more is true only while an older invoice exists');
SELECT ok((SELECT r->'next_cursor' = 'null'::jsonb FROM pages WHERE n=4), 'the last page has no cursor');
SELECT is((SELECT pg_temp.keys(r->'next_cursor') FROM pages WHERE n=1), 'id,issued_at', 'the cursor is exactly (issued_at, id)');
SELECT ok((SELECT bool_and(r->'balances' = pg_temp.list()->'balances' AND r->>'open_count'='2' AND r->>'invoice_count'='4') FROM pages), 'totals are all-page on every page');
SELECT is(pg_temp.list('SELECT public.client_portal_invoices(NULL,0)')->>'sqlstate', '22023', 'limit 0 is refused');
SELECT is(pg_temp.list('SELECT public.client_portal_invoices(NULL,41)')->>'sqlstate', '22023', 'limit 41 is refused');
SELECT is(pg_temp.list('SELECT public.client_portal_invoices(NULL,NULL)')->>'sqlstate', '22023', 'a null limit is refused');
SELECT is(pg_temp.list('SELECT public.client_portal_invoices(NULL,1,''{}''::jsonb)')->>'sqlstate', '22023', 'an empty cursor is refused');
SELECT is(pg_temp.list('SELECT public.client_portal_invoices(NULL,1,''{"issued_at":"2027-01-01","id":"e0995400-0000-4000-8000-000000000001","x":1}''::jsonb)')->>'sqlstate', '22023', 'a widened cursor is refused');
SELECT is(pg_temp.list('SELECT public.client_portal_invoices(NULL,1,''{"issued_at":"2027-01-01","id":"nope"}''::jsonb)')->>'sqlstate', '22023', 'a malformed cursor id is refused');
SELECT is(pg_temp.list('SELECT public.client_portal_invoices(NULL,1,''{"issued_at":"infinity","id":"e0995400-0000-4000-8000-000000000001"}''::jsonb)')->>'sqlstate', '22023', 'an infinite cursor time is refused');
SELECT is(pg_temp.list('SELECT public.client_portal_invoices(NULL,1,''[1]''::jsonb)')->>'sqlstate', '22023', 'a non-object cursor is refused');

-- ── 7. Sub-account parity (no tier filter) ────────────────────────────────────────────────────────
SELECT is(pg_temp.ids(pg_temp.as_user('e0995100-0000-4000-8000-000000000008','SELECT public.client_portal_invoices()')), 'SUB-0001', 'a sub-account''s customer sees the invoice their business issued');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000008','SELECT public.client_portal_invoices()')->>'tenant_id', 'e0995200-0000-4000-8000-000000000004', 'scoped to the sub-account, never its agency');

-- ── 8. Ledger ─────────────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.ledger('e0995400-0000-4000-8000-000000000001')->>'invoice_id', 'e0995400-0000-4000-8000-000000000001', 'his own invoice''s ledger reads');
SELECT is((pg_temp.ledger('e0995400-0000-4000-8000-000000000001')#>>'{payment_ledger,count}')::int, 2, 'with both receipts');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.ledger('e0995400-0000-4000-8000-000000000001')#>'{payment_ledger,rows}') e WHERE e ? 'provider_operation_id'), 'no ledger row carries the internal provider-operation id');
SELECT is((SELECT e->>'provider_environment' FROM jsonb_array_elements(pg_temp.ledger('e0995400-0000-4000-8000-000000000001')#>'{payment_ledger,rows}') e WHERE e->>'provenance'='provider_verified'), 'test', 'the provider receipt says it was a test');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.ledger('e0995400-0000-4000-8000-000000000001')#>'{payment_ledger,rows}') e WHERE e->>'provenance'<>'provider_verified' AND e ? 'provider_environment'), 'a manual receipt carries no provider environment');
SELECT ok(pg_temp.ledger('e0995400-0000-4000-8000-000000000001')::text !~ '(PRIVATE STAFF NOTE|PRIVATE REFERENCE TEXT|actor|e0995600|e0995100)', 'no notes, references, actors or operation ids');
SELECT is((pg_temp.ledger('e0995400-0000-4000-8000-000000000001')->>'test_provider_cents')::int, 3000, 'the ledger root reports the test amount');
SELECT is((pg_temp.ledger('e0995400-0000-4000-8000-000000000001')->>'remaining_cents')::int, 335000, 'and the canonical remaining balance');
SELECT is(pg_temp.ledger('e0995400-0000-4000-8000-000000000008')->>'error', 'CLIENT_INVOICE_UNAVAILABLE', 'another client''s invoice is unavailable');
SELECT is(pg_temp.ledger('e0995400-0000-4000-8000-000000000005')->>'error', 'CLIENT_INVOICE_UNAVAILABLE', 'his own draft is unavailable');
SELECT is(pg_temp.ledger('e0995400-0000-4000-8000-000000000009')->>'error', 'CLIENT_INVOICE_UNAVAILABLE', 'another business''s invoice is unavailable');
SELECT is(pg_temp.ledger('e0995400-0000-4000-8000-000000000006')->>'sqlstate', '42501', 'his CSV-imported obligation is unavailable');
SELECT is(pg_temp.ledger('e0995400-0000-4000-8000-000000000003')->>'status', 'void', 'his voided invoice''s ledger reads as void');
SELECT is((pg_temp.ledger('e0995400-0000-4000-8000-000000000001',',NULL,1')->>'has_more')::boolean, true, 'the ledger pages with the incumbent cursor');
SELECT is((pg_temp.ledger('e0995400-0000-4000-8000-000000000001',format(',NULL,1,%L::jsonb',pg_temp.ledger('e0995400-0000-4000-8000-000000000001',',NULL,1')->'next_cursor'))#>>'{payment_ledger,rows,0,ordinal}')::int, 2, 'and the second page continues at ordinal 2');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000003',format('SELECT public.client_portal_invoice_ledger(%L)','e0995400-0000-4000-8000-000000000001'),'anon')->>'sqlstate', '42501', 'anon cannot read a ledger');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000005',format('SELECT public.client_portal_invoice_ledger(%L)','e0995400-0000-4000-8000-000000000001')), NULL, 'staff with no relationship read no ledger');

-- ── 9–11. Payment request: only the EXISTING validated link ──────────────────────────────────────
SELECT is(pg_temp.keys(pg_temp.request('e0995400-0000-4000-8000-000000000001')), 'invoice_id,invoice_number,payment_request,remaining_cents,test_provider_cents', 'payment request root keys are exact');
SELECT is(pg_temp.request('e0995400-0000-4000-8000-000000000001') - 'payment_request',
 '{"invoice_id":"e0995400-0000-4000-8000-000000000001","invoice_number":"NW-0001","remaining_cents":335000,"test_provider_cents":3000}'::jsonb, 'with the canonical remaining and test amounts as numbers');
SELECT is((pg_temp.request('e0995400-0000-4000-8000-000000000001')->'payment_request') - 'expires_at',
 '{"amount_minor":50000,"currency":"usd","state":"customer_action_required","environment":"test","provider_url":"https://checkout.stripe.com/c/pay/cs_test_open02"}'::jsonb, 'the business''s existing test-mode link, and nothing else');
SELECT ok(pg_temp.request('e0995400-0000-4000-8000-000000000001')::text !~ '(acct_|e0995600|e0995100|cs_test_settled)', 'no merchant, operation, actor or prior session');
UPDATE public.tenant_stripe_accounts SET charges_enabled=false WHERE tenant_id='e0995200-0000-4000-8000-000000000001';
SELECT is(pg_temp.link(), NULL, 'a merchant that cannot take charges nulls the link');
SELECT is(pg_temp.inv(pg_temp.list(),'e0995400-0000-4000-8000-000000000001')->>'payable', 'false', 'and the list stops calling the invoice payable: payable IS the incumbent projection''s verdict');
UPDATE public.tenant_stripe_accounts SET charges_enabled=true WHERE tenant_id='e0995200-0000-4000-8000-000000000001';
UPDATE public.paige_invoice_provider_operations SET expires_at=now()-interval '1 second' WHERE id='e0995600-0000-4000-8000-000000000002';
SELECT is(pg_temp.link(), NULL, 'an expired request nulls the link');
UPDATE public.paige_invoice_provider_operations SET expires_at=now()+interval '1 hour' WHERE id='e0995600-0000-4000-8000-000000000002';
SELECT pg_temp.fixture($$UPDATE public.paige_invoice_provider_operations SET issued_snapshot_version=2 WHERE id='e0995600-0000-4000-8000-000000000002'$$);
SELECT is(pg_temp.link(), NULL, 'a request for another issued version nulls the link');
SELECT pg_temp.fixture($$UPDATE public.paige_invoice_provider_operations SET issued_snapshot_version=1, amount_minor=400000 WHERE id='e0995600-0000-4000-8000-000000000002'$$);
SELECT is(pg_temp.link(), NULL, 'a request above the remaining balance nulls the link');
SELECT pg_temp.fixture($$UPDATE public.paige_invoice_provider_operations SET amount_minor=50000, provider_url='https://checkout.stripe.com/x/elsewhere' WHERE id='e0995600-0000-4000-8000-000000000002'$$);
SELECT is(pg_temp.link(), NULL, 'a link that is not a Stripe Checkout payment page is never returned');
SELECT pg_temp.fixture($$UPDATE public.paige_invoice_provider_operations SET provider_url='https://checkout.stripe.com/c/pay/cs_test_open02', provider='paypal' WHERE id='e0995600-0000-4000-8000-000000000002'$$);
SELECT is(pg_temp.link(), NULL, 'a processor with no proven merchant binding produces no link');
SELECT pg_temp.fixture($$UPDATE public.paige_invoice_provider_operations SET provider='stripe' WHERE id='e0995600-0000-4000-8000-000000000002'$$);
SELECT is(pg_temp.link(), 'https://checkout.stripe.com/c/pay/cs_test_open02', 'restored, the same link reads again');
SELECT is(pg_temp.request('e0995400-0000-4000-8000-000000000004') - 'invoice_id' - 'invoice_number',
 '{"remaining_cents":50000,"test_provider_cents":0,"payment_request":null}'::jsonb, 'no payment request: the answer says so and invents none');
SELECT is(pg_temp.request('e0995400-0000-4000-8000-000000000003')->>'error', 'CLIENT_INVOICE_UNAVAILABLE', 'a voided invoice has no payment request');
SELECT is(pg_temp.request('e0995400-0000-4000-8000-000000000008')->>'error', 'CLIENT_INVOICE_UNAVAILABLE', 'another client''s request is unavailable');
SELECT is(pg_temp.request('e0995400-0000-4000-8000-000000000005')->>'error', 'CLIENT_INVOICE_UNAVAILABLE', 'a draft has no request');
SELECT is(pg_temp.request('e0995400-0000-4000-8000-000000000006')->>'error', 'CLIENT_INVOICE_UNAVAILABLE', 'a CSV-imported obligation has no request');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000008',format('SELECT public.client_portal_invoice_payment_request(%L)','e0995400-0000-4000-8000-000000000001'))->>'error', 'CLIENT_INVOICE_UNAVAILABLE', 'a customer of another business cannot read his link');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000003',format('SELECT public.client_portal_invoice_payment_request(%L)','e0995400-0000-4000-8000-000000000001'),'anon')->>'sqlstate', '42501', 'anon cannot read a payment request');
SELECT is(pg_temp.as_user(NULL,format('SELECT public.client_portal_invoice_payment_request(%L)','e0995400-0000-4000-8000-000000000001'))->>'error', 'customer authentication required', 'signed out, no payment request');

-- ── 12. Nothing was written by any read ───────────────────────────────────────────────────────────
SELECT is((SELECT row(ops,pays,grants,inv_ops,invoices,audit)::text FROM before_counts),
 (SELECT row((SELECT count(*) FROM public.paige_invoice_provider_operations),(SELECT count(*) FROM public.paige_invoice_payments),
  (SELECT count(*) FROM public.paige_invoice_access_grants),(SELECT count(*) FROM public.paige_invoice_operations),
  (SELECT count(*) FROM public.paige_invoices),(SELECT count(*) FROM public.paige_audit_log))::text),
 'no provider operation, payment, grant, invoice operation, invoice or audit row was created by a read');
SELECT is((SELECT state FROM public.paige_invoice_provider_operations WHERE id='e0995600-0000-4000-8000-000000000002'), 'customer_action_required', 'the open request was never dispatched, claimed or settled by a read');

-- ── 13–14. Incumbent owner and bearer reads are untouched (§58/§37) ───────────────────────────────
SELECT is(pg_temp.keys(pg_temp.as_user(NULL,format('SELECT public.read_public_sales_invoice_payment_request(%L)',repeat('b',64)),'service_role')),
 'invoice_number,payment_request,remaining_cents', 'the bearer payment request keeps its exact root keys');
SELECT is(pg_temp.as_user(NULL,format('SELECT public.read_public_sales_invoice_payment_request(%L)',repeat('b',64)),'service_role') #>> '{payment_request,provider_url}',
 'https://checkout.stripe.com/c/pay/cs_test_open02', 'and still returns the same link');
SELECT ok(NOT (pg_temp.as_user(NULL,format('SELECT public.read_public_sales_invoice_payment_request(%L)',repeat('b',64)),'service_role') -> 'payment_request' ? 'environment'), 'the bearer projection gained no key');
SELECT ok(EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.as_user(NULL,format('SELECT public.read_public_sales_invoice_payment_ledger(%L)',repeat('b',64)),'service_role')#>'{payment_ledger,rows}') e WHERE e ? 'provider_operation_id'), 'the bearer ledger keeps its incumbent provider-operation field');
SELECT is(pg_temp.as_user('e0995100-0000-4000-8000-000000000001',format('SELECT public.list_sales_invoice_payment_operations(%L,%L)','e0995200-0000-4000-8000-000000000001','e0995400-0000-4000-8000-000000000001')) #>> '{rows,0,provider_url}',
 'https://checkout.stripe.com/c/pay/cs_test_open02', 'the owner''s payment-operations read is unchanged');
SELECT ok(NOT (pg_temp.as_user('e0995100-0000-4000-8000-000000000001',format('SELECT public.list_sales_invoice_payment_operations(%L,%L)','e0995200-0000-4000-8000-000000000001','e0995400-0000-4000-8000-000000000001')) #> '{rows,0}' ? 'environment'), 'and gained no key');

SELECT * FROM finish();
ROLLBACK;
