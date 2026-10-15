// Native synthetic database proof. No customer session, provider or payment action.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const [binary,port,user,directory]=process.argv.slice(2);
assert(binary&&/^\d+$/.test(port??'')&&user&&directory);
let database='postgres',checks=0;
const sql=input=>{
  const result=spawnSync(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input,encoding:'utf8',windowsHide:true,maxBuffer:8e6});
  if(result.status!==0)throw Error(result.stderr);
  return result.stdout.trim();
};
const read=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const normalized=path=>path.replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(normalized(sql('SHOW data_directory;')),normalized(directory));
const own=`e04_client_commercial_${randomUUID().replaceAll('-','')}`;
sql(`CREATE DATABASE ${own};`);database=own;
const tenant='aaaaaaaa-0000-4000-8000-000000000001',foreignTenant='bbbbbbbb-0000-4000-8000-000000000002';
const actor='11111111-0000-4000-8000-000000000001',other='22222222-0000-4000-8000-000000000002';
const client='cccccccc-0000-4000-8000-000000000001',otherClient='cccccccc-0000-4000-8000-000000000002';
const foreignClient='cccccccc-0000-4000-8000-000000000003';
const invoice='dddddddd-0000-4000-8000-000000000001',voidInvoice='dddddddd-0000-4000-8000-000000000002';
const recorded='dddddddd-0000-4000-8000-000000000003',foreignInvoice='dddddddd-0000-4000-8000-000000000004';
const privateInvoice='dddddddd-0000-4000-8000-000000000005',draft='dddddddd-0000-4000-8000-000000000006';
const literal=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const call=(overrides={})=>{
  const args={actor,tenant,client,invoice:null,limit:40,after:null,uid:actor,role:'authenticated',...overrides};
  return `SET ROLE ${args.role}; SET test.uid='${args.uid}'; SET test.owner='false';
    SELECT public.read_client_commercial_status_scoped('${args.actor}','${args.tenant}','${args.client}',
      ${args.invoice?`'${args.invoice}'`:'NULL'},${args.limit===null?'NULL':args.limit},${args.after===null?'NULL':literal(args.after)});`;
};
const result=args=>JSON.parse(sql(call(args)));
const refuses=(input,code='42501')=>{assert.throws(()=>sql(input),new RegExp(code));checks++;};
try{
  // Minimal synthetic records; the balance function and new scoped reader below
  // are actual repository SQL, not a JavaScript replica of their calculation.
  sql(`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
  CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.owner',true)::boolean,false) $$;
  CREATE TABLE tenants(id uuid PRIMARY KEY,account_type text,parent_tenant_id uuid);
  CREATE TABLE tenant_members(tenant_id uuid,user_id uuid,status text);
  CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid,linked_user_id uuid,merged_into_contact_id uuid);
  CREATE TABLE paige_invoices(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,invoice_number text,status text,currency text,
    due_date date,billing_document jsonb,billing_issued_snapshot_version bigint,billing_issued_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),amount_total_cents bigint);
  CREATE TABLE paige_invoice_payments(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,invoice_id uuid,kind text,
    amount_cents bigint,evidence_kind text,provider_environment text);
  INSERT INTO auth.users(id) VALUES('${actor}'),('${other}');
  INSERT INTO tenants VALUES('${tenant}','standalone',NULL),('${foreignTenant}','standalone',NULL);
  INSERT INTO clients VALUES('${client}','${tenant}','${actor}',NULL),('${otherClient}','${tenant}','${other}',NULL),('${foreignClient}','${foreignTenant}','${other}',NULL);
  INSERT INTO paige_invoices(id,tenant_id,contact_id,invoice_number,status,currency,due_date,billing_document,billing_issued_snapshot_version,billing_issued_at,amount_total_cents) VALUES
    ('${invoice}','${tenant}','${client}','SYN-1','issued','usd','2026-10-15','{"schema_version":1,"snapshot":{"title":"Synthetic issued document"}}',1,'2026-10-14T12:00:00Z',350000),
    ('${voidInvoice}','${tenant}','${client}','SYN-VOID','void','usd','2026-10-15',NULL,1,'2026-10-14T12:00:00Z',100000),
    ('${recorded}','${tenant}','${client}','SYN-IMPORT','recorded','eur','2026-10-15',NULL,NULL,'2026-10-14T12:00:00Z',1200),
    ('${foreignInvoice}','${foreignTenant}','${foreignClient}','PRIVATE-FOREIGN','issued','usd','2026-10-15',NULL,1,now(),9000000),
    ('${privateInvoice}','${tenant}','${otherClient}','PRIVATE-OTHER','issued','usd','2026-10-15',NULL,1,now(),9000000),
    ('${draft}','${tenant}','${client}','PRIVATE-DRAFT','draft','usd',NULL,NULL,NULL,now(),9000000);
  INSERT INTO paige_invoice_payments(tenant_id,invoice_id,kind,amount_cents,evidence_kind,provider_environment) VALUES
    ('${tenant}','${invoice}','receipt',40000,'provider_verified','live'),
    ('${tenant}','${invoice}','reversal',10000,'manual_recorded',NULL),
    ('${tenant}','${invoice}','receipt',12000,'manual_recorded',NULL),
    ('${tenant}','${invoice}','receipt',3000,'provider_verified','test');`);
  sql(`CREATE TABLE profiles(user_id uuid,full_name text);
    ALTER TABLE tenants ADD COLUMN status text DEFAULT 'active';
    ALTER TABLE clients ADD COLUMN status text DEFAULT 'active';
    ALTER TABLE paige_invoices ADD COLUMN billing_draft_version bigint DEFAULT 1,
      ADD COLUMN billing_lifecycle_version bigint DEFAULT 1,ADD COLUMN billing_draft jsonb,
      ADD COLUMN billing_issued_by uuid,ADD COLUMN billing_document_digest text DEFAULT repeat('a',64),
      ADD COLUMN updated_at timestamptz DEFAULT now();
    ALTER TABLE paige_invoice_payments ADD COLUMN currency text DEFAULT 'usd',
      ADD COLUMN method text DEFAULT 'cash',ADD COLUMN received_at timestamptz DEFAULT now(),
      ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN reverses_payment_id uuid,
      ADD COLUMN import_provenance jsonb,ADD COLUMN actor_user_id uuid,
      ADD COLUMN provider text,ADD COLUMN provider_operation_id uuid,ADD COLUMN provider_verified_at timestamptz,
      ADD COLUMN merchant_account_id text,ADD COLUMN provider_transaction_id text,ADD COLUMN provider_settlement_id text;
    UPDATE paige_invoice_payments SET provider='stripe',method='stripe',provider_operation_id=gen_random_uuid(),
      provider_verified_at=now(),merchant_account_id='acct_synthetic',provider_transaction_id='pi_synthetic_'||replace(id::text,'-',''),
      provider_settlement_id='ch_synthetic_'||replace(id::text,'-','') WHERE evidence_kind='provider_verified';
    UPDATE paige_invoice_payments SET reverses_payment_id=(SELECT id FROM paige_invoice_payments WHERE kind='receipt' AND evidence_kind='manual_recorded' LIMIT 1)
      WHERE kind='reversal';`);
  // The canonical provider schema currently permits verified receipts only.
  // Manual correction fixtures do not imply provider refund/reversal support.
  const providerSchema=read('supabase/migrations/20270597000001_sales_invoice_provider_operations.sql');
  const shapeStart=providerSchema.indexOf('ALTER TABLE public.paige_invoice_payments DROP CONSTRAINT IF EXISTS sales_provider_receipt_shape;');
  const shapeEnd=providerSchema.indexOf('ALTER TABLE public.paige_invoice_payments DROP CONSTRAINT IF EXISTS sales_provider_receipt_scope;',shapeStart);
  assert(shapeStart>=0&&shapeEnd>shapeStart);sql(providerSchema.slice(shapeStart,shapeEnd));
  const lifecycle=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql');
  const readerStart=lifecycle.indexOf('CREATE OR REPLACE FUNCTION public._sales_invoice_read(');
  const readerEnd=lifecycle.indexOf('\nCREATE OR REPLACE FUNCTION ',readerStart+1);
  assert(readerStart>=0&&readerEnd>readerStart);sql(lifecycle.slice(readerStart,readerEnd));
  sql('ALTER FUNCTION public._sales_invoice_read(uuid,uuid,integer) RENAME TO _sales_invoice_read_before_provider;');
  const balanceSql=read('supabase/migrations/20270601000002_sales_performance_contract.sql');
  const end=balanceSql.indexOf('-- Preserve incumbent document/payment presentation');
  assert(end>0);sql(balanceSql.slice(0,end));
  const currentReaderStart=balanceSql.indexOf('CREATE OR REPLACE FUNCTION public._sales_invoice_read(');
  const currentReaderEnd=balanceSql.indexOf('\nCREATE OR REPLACE FUNCTION ',currentReaderStart+1);
  assert(currentReaderStart>=0&&currentReaderEnd>currentReaderStart);sql(balanceSql.slice(currentReaderStart,currentReaderEnd));
  const ledgerSql=read('supabase/migrations/20270555000000_sales_invoice_payment_breakdown.sql');
  sql(ledgerSql.slice(0,ledgerSql.indexOf('CREATE OR REPLACE FUNCTION public.read_sales_invoice_payment_ledger(')));
  sql('ALTER FUNCTION public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) RENAME TO _sales_invoice_payment_ledger_before_provider;');
  const providerSql=read('supabase/migrations/20270597000001_sales_invoice_provider_operations.sql');
  const providerLedgerStart=providerSql.indexOf('CREATE OR REPLACE FUNCTION public._sales_invoice_payment_ledger(');
  const providerLedgerEnd=providerSql.indexOf('\nDO $$ BEGIN',providerLedgerStart+1);
  assert(providerLedgerStart>=0&&providerLedgerEnd>providerLedgerStart);sql(providerSql.slice(providerLedgerStart,providerLedgerEnd));
  sql(`CREATE TABLE paige_invoice_provider_operations(id uuid PRIMARY KEY,tenant_id uuid,invoice_id uuid,client_id uuid,
    invoice_version bigint,issued_snapshot_version bigint,provider text,merchant_account_id text,merchant_binding_version bigint,
    environment text,amount_minor bigint,currency text,state text,provider_url text,expires_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE tenant_stripe_accounts(tenant_id uuid,stripe_account_id text,binding_version bigint,provider_environment text,
      charges_enabled boolean,sales_payment_permission boolean);`);
  const migration=read('supabase/migrations/20271101164000_e04_client_commercial_status.sql');
  sql(migration);sql(migration);
  const first=result();
  equal(first.client_id,client);equal(first.invoice_count,3);equal(first.has_more,false);
  equal(first.balances,[
    {currency:'eur',remaining_minor:'1200',manual_recorded_minor:'0',provider_verified_minor:'0',test_provider_minor:'0'},
    {currency:'usd',remaining_minor:'305000',manual_recorded_minor:'2000',provider_verified_minor:'43000',test_provider_minor:'3000'},
  ]);
  equal(first.invoices.map(row=>row.id),[recorded,voidInvoice,invoice]);
  equal(first.invoices.find(row=>row.id===recorded).document_available,false);
  equal(first.next_payment,{state:'unavailable',reason:'effective_due_obligation_not_recorded'});
  equal(first.engagement_completion,{state:'not_evaluated'});
  equal(result({invoice}).invoice.document.snapshot.title,'Synthetic issued document');
  equal(result({invoice}).invoice.remaining_minor,'305000');
  const ledgerCall=(invoiceId=invoice,selectedClient=client,role='authenticated',cursor=null)=>`SET ROLE ${role};SET test.uid='${actor}';SET test.owner='false';
    SELECT public.read_client_sales_invoice_payment_ledger_scoped('${actor}','${tenant}','${selectedClient}','${invoiceId}',1,${cursor===null?'NULL':literal(cursor)});`;
  const ledger1=JSON.parse(sql(ledgerCall()));
  equal(ledger1.invoice_id,invoice);equal(ledger1.payment_ledger.count,4);equal(ledger1.has_more,true);
  equal(ledger1.remaining_cents,305000);equal(ledger1.provider_verified_cents,43000);
  equal(ledger1.test_provider_cents,3000);
  const allLedger=JSON.parse(sql(ledgerCall().replace(',1,NULL',',100,NULL')));
  equal(allLedger.payment_ledger.rows.filter(row=>row.provenance==='provider_verified').map(row=>row.provider_environment).sort(),['live','test']);
  equal(ledger1.payment_ledger.rows.every(row=>!Object.hasOwn(row,'provider_operation_id')),true);
  sql(`UPDATE paige_invoices SET status='uncollectible' WHERE id='${invoice}';`);
  equal(result({invoice}).invoice.status,'issued');equal(JSON.parse(sql(ledgerCall())).status,'issued');
  sql(`UPDATE paige_invoices SET status='issued' WHERE id='${invoice}';`);
  const ledger2=JSON.parse(sql(ledgerCall(invoice,client,'authenticated',ledger1.next_cursor)));
  equal(ledger2.payment_ledger.rows[0].ordinal,2);
  const requestCall=(selectedInvoice=invoice,selectedClient=client,role='authenticated')=>`SET ROLE ${role};SET test.uid='${actor}';SET test.owner='false';
    SELECT public.read_client_sales_invoice_payment_request_scoped('${actor}','${tenant}','${selectedClient}','${selectedInvoice}');`;
  equal(JSON.parse(sql(requestCall())).payment_request,null);
  equal(JSON.parse(sql(requestCall())).test_provider_cents,3000);
  for(const selectedInvoice of [foreignInvoice,privateInvoice,draft,voidInvoice,recorded])refuses(requestCall(selectedInvoice));
  refuses(requestCall(invoice,otherClient));refuses(requestCall(invoice,client,'anon'));refuses(requestCall(invoice,client,'service_role'));
  sql(`INSERT INTO tenant_stripe_accounts VALUES('${tenant}','acct_synthetic',1,'test',true,true);
    INSERT INTO paige_invoice_provider_operations(id,tenant_id,invoice_id,client_id,invoice_version,issued_snapshot_version,
      provider,merchant_account_id,merchant_binding_version,environment,amount_minor,currency,state,provider_url,expires_at)
    VALUES('eeeeeeee-0000-4000-8000-000000000001','${tenant}','${invoice}','${client}',1,1,'stripe','acct_synthetic',1,'test',50000,'usd',
      'customer_action_required','https://checkout.stripe.com/c/pay/synthetic',now()+interval '1 hour');`);
  const request=()=>JSON.parse(sql(requestCall())).payment_request;
  equal(request().environment,'test');equal(request().provider_url,'https://checkout.stripe.com/c/pay/synthetic');
  const suppress=(change,restore)=>{sql(change);equal(request().provider_url,null);sql(restore);};
  suppress('UPDATE tenant_stripe_accounts SET sales_payment_permission=false;','UPDATE tenant_stripe_accounts SET sales_payment_permission=true;');
  suppress('UPDATE tenant_stripe_accounts SET charges_enabled=false;','UPDATE tenant_stripe_accounts SET charges_enabled=true;');
  suppress("UPDATE tenant_stripe_accounts SET provider_environment='live';","UPDATE tenant_stripe_accounts SET provider_environment='test';");
  suppress('UPDATE tenant_stripe_accounts SET binding_version=2;','UPDATE tenant_stripe_accounts SET binding_version=1;');
  suppress("UPDATE paige_invoice_provider_operations SET expires_at=now()-interval '1 second';","UPDATE paige_invoice_provider_operations SET expires_at=now()+interval '1 hour';");
  suppress("UPDATE paige_invoice_provider_operations SET state='outcome_unknown';","UPDATE paige_invoice_provider_operations SET state='customer_action_required';");
  suppress('UPDATE paige_invoice_provider_operations SET amount_minor=350000;','UPDATE paige_invoice_provider_operations SET amount_minor=50000;');
  suppress('UPDATE paige_invoice_provider_operations SET invoice_version=2;','UPDATE paige_invoice_provider_operations SET invoice_version=1;');
  suppress('UPDATE paige_invoice_provider_operations SET issued_snapshot_version=2;','UPDATE paige_invoice_provider_operations SET issued_snapshot_version=1;');
  suppress(`UPDATE paige_invoice_provider_operations SET client_id='${otherClient}';`,`UPDATE paige_invoice_provider_operations SET client_id='${client}';`);
  suppress("UPDATE paige_invoice_provider_operations SET currency='eur';","UPDATE paige_invoice_provider_operations SET currency='usd';");
  suppress("UPDATE paige_invoice_provider_operations SET provider_url='https://evil.example/';","UPDATE paige_invoice_provider_operations SET provider_url='https://checkout.stripe.com/c/pay/synthetic';");
  for(const selectedInvoice of [privateInvoice,foreignInvoice,draft])refuses(ledgerCall(selectedInvoice));
  refuses(ledgerCall(invoice,otherClient));refuses(ledgerCall(invoice,client,'anon'));refuses(ledgerCall(invoice,client,'service_role'));
  const page1=result({limit:1}),page2=result({limit:1,after:page1.next_cursor}),page3=result({limit:1,after:page2.next_cursor});
  equal([page1.invoices[0].id,page2.invoices[0].id,page3.invoices[0].id],[recorded,voidInvoice,invoice]);
  equal([page1.has_more,page2.has_more,page3.has_more],[true,true,false]);
  equal(page1.balances,first.balances);
  for(const input of [{invoice:foreignInvoice},{invoice:privateInvoice},{invoice:draft},{actor:other},{tenant:foreignTenant},{client:otherClient},{uid:''},{role:'anon'},{role:'service_role'}])refuses(call(input));
  for(const limit of [0,41,null])refuses(call({limit}),'22023');
  for(const after of [{},{issued_at:'infinity',id:invoice},{issued_at:'invalid',id:invoice},{issued_at:'2026-10-14',id:'invalid'},{issued_at:'2026-10-14',id:invoice,extra:true}])refuses(call({after}),'22023');
  sql(`INSERT INTO tenant_members VALUES('${tenant}','${actor}','active');`);refuses(call());
  refuses(ledgerCall());
  refuses(requestCall());
  sql(`UPDATE tenant_members SET status='inactive';`);equal(result().client_id,client);
  sql(`UPDATE clients SET linked_user_id='${other}' WHERE id='${client}';`);refuses(call());
  sql(`UPDATE clients SET linked_user_id='${actor}',merged_into_contact_id='${otherClient}' WHERE id='${client}';`);refuses(call());
  sql(`UPDATE clients SET merged_into_contact_id=NULL WHERE id='${client}';UPDATE clients SET linked_user_id='${actor}' WHERE id='${otherClient}';`);refuses(call());
  sql(`UPDATE clients SET linked_user_id='${other}' WHERE id='${otherClient}';UPDATE auth.users SET deleted_at=now() WHERE id='${actor}';`);refuses(call());
  sql(`UPDATE auth.users SET deleted_at=NULL,banned_until=now()+interval '1 hour' WHERE id='${actor}';`);refuses(call());
  sql(`UPDATE auth.users SET banned_until=NULL WHERE id='${actor}';UPDATE tenants SET account_type='agency' WHERE id='${tenant}';`);refuses(call());
  sql(`UPDATE tenants SET account_type='standalone',parent_tenant_id='${foreignTenant}' WHERE id='${tenant}';`);refuses(call());
  sql(`UPDATE tenants SET parent_tenant_id=NULL WHERE id='${tenant}';`);
  sql(`UPDATE clients SET status='inactive' WHERE id='${client}';`);
  refuses(call());refuses(ledgerCall());refuses(requestCall());
  sql(`UPDATE clients SET status='active' WHERE id='${client}';UPDATE tenants SET status='suspended' WHERE id='${tenant}';`);
  refuses(call());refuses(ledgerCall());refuses(requestCall());
  sql(`UPDATE tenants SET status='active' WHERE id='${tenant}';`);
  refuses(call().replace("SET test.owner='false'","SET test.owner='true'"));
  sql(`INSERT INTO paige_invoice_payments(tenant_id,invoice_id,kind,amount_cents,evidence_kind,provider_environment)
    VALUES('${tenant}','${invoice}','receipt',5000,'manual_recorded',NULL);
    UPDATE paige_invoices SET billing_lifecycle_version=2,updated_at=clock_timestamp() WHERE id='${invoice}';`);
  refuses(ledgerCall(invoice,client,'authenticated',ledger1.next_cursor),'40001');
  equal(result({invoice}).invoice.remaining_minor,'300000');
  equal(result().balances.find(row=>row.currency==='usd').test_provider_minor,'3000');
  equal(sql('SELECT count(*) FROM paige_invoices;'),'6');
  console.log(JSON.stringify({result:'PASS',checks,migrationReplay:2,scope:'Synthetic auth fixtures, actual canonical SQL balance producer, exact scoped invoice reader only; not hosted client login or payment evidence'}));
}finally{database='postgres';sql(`DROP DATABASE ${own};`);}
