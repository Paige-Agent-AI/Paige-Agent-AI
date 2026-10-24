import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

/** Selectively reuse #2190's original real package/balance/Rail setup inside the
 * incumbent fenced agreement proof. Auth and metadata are synthetic; no hosted
 * customer, provider, actual file or payment acceptance is established here. */
export async function proveAcceptedCommercialRecord({sql,read,tenant,actor,invoiceId,agreementId,expected,legacyId,startSession,observe}){
 let checks=0;const check=(v,message)=>{assert(v,message);checks++;};
 const json=q=>JSON.parse(sql(q)),scope=`SET test.uid='${actor}';SET test.tenant='${tenant}';SET ROLE authenticated;`;
 const extract=(source,name)=>{const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=source.indexOf('END $$;',start);assert(start>=0&&end>start,name);return source.slice(start,end+7);};
 sql(`ALTER TABLE profiles ADD COLUMN full_name text;
  ALTER TABLE clients ADD COLUMN entity_name text,ADD COLUMN entity_type text;
  ALTER TABLE paige_invoices ADD COLUMN invoice_number text DEFAULT 'SYN-1',ADD COLUMN amount_total_cents integer DEFAULT 350000,
   ADD COLUMN billing_issued_snapshot_version bigint,ADD COLUMN billing_issued_at timestamptz,ADD COLUMN billing_issued_by uuid,
   ADD COLUMN billing_document jsonb,ADD COLUMN billing_document_digest text,ADD COLUMN due_date date,
   ADD COLUMN billing_import_version bigint,ADD COLUMN billing_import_provenance jsonb,ADD COLUMN created_at timestamptz DEFAULT now();
  CREATE TABLE paige_invoice_payments(id uuid PRIMARY KEY,tenant_id uuid,invoice_id uuid,actor_user_id uuid,kind text,amount_cents integer,currency text,method text,received_at timestamptz,created_at timestamptz DEFAULT now(),reverses_payment_id uuid,import_provenance jsonb,evidence_kind text,provider text,provider_environment text,provider_verified_at timestamptz,reference text,notes text,reason text);
  CREATE TABLE paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT clock_timestamp(),actor_agent_slug text,actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
  CREATE TABLE paige_subagents(slug text,tenant_id uuid,rail_display_name text);CREATE SCHEMA realtime;
  CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
  UPDATE paige_invoices SET billing_draft=billing_draft||jsonb_build_object('agreement_id','${agreementId}','delivery_channel_intents',jsonb_build_array('email')) WHERE id='${invoiceId}';`);
 const lifecycle=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql');
 sql(extract(lifecycle,'_sales_invoice_read').replace('public._sales_invoice_read(','public._sales_invoice_read_before_provider('));
 const balance=read('supabase/migrations/20270601000002_sales_performance_contract.sql');
 const balanceStart=balance.indexOf('CREATE OR REPLACE FUNCTION public._sales_invoice_balance_rows(');
 sql(balance.slice(balanceStart,balance.indexOf('$$;',balanceStart)+3)+extract(balance,'_sales_invoice_read'));
 sql(extract(read('supabase/migrations/20270547000000_sales_collections.sql'),'_sales_collection_validate_terms'));
 const rail12=read('supabase/migrations/20261212000000_paige_can_show_her_work.sql'),rail20=read('supabase/migrations/20261220000000_an_act_that_landed_but_was_not_recorded.sql');
 sql(extract(rail20,'_workspace_event_display')+extract(rail12,'_record_workspace_rail_event')+extract(rail20,'record_capability_run'));
 sql(read('supabase/migrations/20270598000001_sales_commercial_package_read.sql'));
 const conditions=read('supabase/migrations/20270601000009_sales_commercial_conditions.sql');
 sql(conditions.slice(0,conditions.indexOf('-- Extend the ONE canonical writer.')));
 const conditionsRead=conditions.indexOf('-- Only the existing read projection changes.');assert(conditionsRead>0);sql(conditions.slice(conditionsRead));
 const reference=read('supabase/migrations/20270601000013_sales_invoice_terms_reference.sql');
 sql(extract(reference,'_sales_invoice_terms_reference_shape'));
 const referenceRead=reference.indexOf("DO $$ DECLARE body text; prior text; BEGIN\n body:=pg_get_functiondef('public.read_sales_commercial_package");assert(referenceRead>0);sql(reference.slice(referenceRead));
 const call=(t=tenant,i=invoiceId,a=agreementId)=>`SELECT read_sales_accepted_agreement('${t}','${i}','${a}');`;
 const owner=(prefix='')=>json(prefix+scope+call());
 const refused=(query,code='42501')=>{
  const start=query.lastIndexOf('SELECT read_sales_accepted_agreement(');assert(start>=0);
  sql(query.slice(0,start)+`DO $proof$ BEGIN BEGIN ${query.slice(start).replace(/^SELECT\s+/,'PERFORM ')}
   RAISE EXCEPTION 'Expected exact original refusal ${code}';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);
  checks++;
 };
 const packageBody=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.read_sales_commercial_package(uuid,uuid)'::regprocedure;");
 check(packageBody==='d909de5729a47809119455d54952a5ef','Load the actual current canonical package, not a fabricated balance/permission projector');
 const got=owner();check(got.state==='recorded','Explicit original owner read confirms the current accepted evidence');
 assert.deepEqual(got.payload,expected);checks++;
 check(got.tenant_id===tenant&&got.invoice_id===invoiceId&&got.agreement_id===agreementId&&got.receipt_id,
  'The original tenant/client/invoice/agreement scope and canonical Rail receipt survive');
 check(!JSON.stringify(got).includes('storage_key'),'Owner DTO omits private storage credentials/keys');
 const repeat=owner();assert.deepEqual(repeat.payload,got.payload);checks++;
 check(repeat.receipt_id!==got.receipt_id,'A fresh read gets the original Rail read receipt, not another signature event');
 check(sql("SELECT count(*) FROM paige_invoice_payments;")==='0','Reading accepted terms creates no financial allocation or obligation');
 const originalAgreement=sql(`SELECT to_jsonb(a) FROM paige_agreements a WHERE id='${agreementId}';`);
 check(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.read_sales_commercial_package(uuid,uuid)'::regprocedure;")===packageBody,
  'The existing closed package DTO and original implementation remain unchanged');
 for(const role of ['anon','service_role'])refused(`SET ROLE ${role};`+call());
 for(const query of [call(randomUUID()),call(tenant,randomUUID()),call(tenant,invoiceId,legacyId),call(tenant,invoiceId,randomUUID())])refused(scope+query);
 for(const change of ["UPDATE tenant_members SET role='member';","UPDATE tenant_members SET status='inactive';",
  `UPDATE profiles SET active_tenant_id='bbbbbbbb-0000-4000-8000-000000000002';`,"UPDATE auth.users SET deleted_at=now();",
  "UPDATE auth.users SET banned_until=now()+interval '1 day';","UPDATE tenants SET status='suspended';"]){
  refused('BEGIN;'+change+scope+call());
 }
 const count=sql('SELECT count(*) FROM paige_workspace_events;');
 refused('BEGIN;ALTER TABLE paige_workspace_events ADD CONSTRAINT synthetic_receipt_failure CHECK(false) NOT VALID;'+scope+call(),'23514');
 check(sql('SELECT count(*) FROM paige_workspace_events;')===count,'A refused receipt never leaves a successful partial read record');
 const tag='e04_accepted_scope_'+randomUUID().replaceAll('-','');
 // Use the incumbent authority lock order. An earlier fixture held the invoice
 // then tried to retire membership, inverting the canonical actor-first fence
 // and causing a diagnostic deadlock. That invalid setup is retained separately.
 const holder=startSession(tag+'holder',`BEGIN;SELECT _sales_invoice_actor('${actor}','${tenant}');UPDATE tenant_members SET role='member' WHERE user_id='${actor}';SELECT pg_sleep(2);COMMIT;`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}holder' AND wait_event='PgSleep');`);
 const waiting=startSession(tag+'owner',scope+`DO $proof$ BEGIN BEGIN ${call().replace(/^SELECT\s+/,'PERFORM ')}RAISE EXCEPTION 'Expected retired owner refusal';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}owner' AND wait_event_type='Lock');`);checks++;
 await Promise.all([holder,waiting]);checks++;
 sql(`UPDATE tenant_members SET role='owner' WHERE user_id='${actor}';`);
 check(sql('SELECT count(*) FROM paige_workspace_events;')===count,'Post-wait authority refusal rolls back the original package receipt');
 check(sql(`SELECT to_jsonb(a) FROM paige_agreements a WHERE id='${agreementId}';`)===originalAgreement,'Owner read never changes the accepted source record');
 return {checks,concurrentSessions:2,observedLockWaits:1,scope:'Actual original native package/balance/actor/Rail bodies with synthetic session identity; no hosted customer acceptance'};
}
