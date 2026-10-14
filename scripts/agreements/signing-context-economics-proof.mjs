// PRIVATE failing-first grounding. Native synthetic PG only; no real signature or provider.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const [binary, port, user, expectedDirectory, mode] = process.argv.slice(2);
let checks=0;const check=(value,message)=>{assert(value,message);checks++};
assert(binary && /^\d+$/.test(port ?? '') && user && expectedDirectory);
assert(['baseline','repaired'].includes(mode), 'Explicit baseline or repaired proof mode required');
let db = 'postgres';
const sql = input => {
  const result = spawnSync(binary, ['-h', '127.0.0.1', '-p', port, '-U', user, '-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', windowsHide: true, maxBuffer: 8e6 });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const normalize = text => text.replaceAll('\\', '/').toLowerCase().replace(/\/$/, '');
assert.equal(normalize(sql('SHOW data_directory;')), normalize(expectedDirectory));
const fixture = `commercial_snapshot_${randomUUID().replaceAll('-', '')}`;
sql(`CREATE DATABASE ${fixture};`); db = fixture;
const read = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
try {
  sql(read('scripts/agreements/_fixture-schema.sql'));
  // The shared historical fixture omits commercial-only fields; restore their
  // production row shape before applying the already-delivered ANT-49 trigger.
  sql(`ALTER TABLE tenant_client_agreements ADD COLUMN offer_id uuid REFERENCES tenant_products(id), ADD COLUMN catalog_price_id uuid;
    INSERT INTO tenant_products(id,tenant_id) VALUES('44444444-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001');`);
  sql(read('supabase/migrations/20270401000000_agreements_engine_records.sql'));
  sql(read('supabase/migrations/20271020000310_sales_agreement_trigger_contracts.sql'));
  sql(read('supabase/migrations/20270404000000_agreement_signing_contract.sql'));
  sql(read('supabase/migrations/20270407000000_agreement_view_tracking.sql'));
  sql(`SET test.uid='11111111-0000-4000-8000-000000000001'; SET test.tenant='aaaaaaaa-0000-4000-8000-000000000001'; SET test.admin='true'; SET test.member='true';
    INSERT INTO tenant_client_agreements(id,tenant_id,contact_id,offer_id,agreed_amount_minor,agreed_currency,term_kind)
    VALUES('55555555-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','c1111111-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000001',350000,'USD','installments');`);
  const created = JSON.parse(sql(`SET test.uid='11111111-0000-4000-8000-000000000001'; SET test.tenant='aaaaaaaa-0000-4000-8000-000000000001'; SET test.admin='true'; SET test.member='true';
    SELECT save_paige_agreement(_expected_tenant_id=>'aaaaaaaa-0000-4000-8000-000000000001',_agreement_id=>NULL,_contact_id=>'c1111111-0000-4000-8000-000000000001',_title=>'Synthetic commercial A',_body_markdown=>'Principal USD3500; deposit USD500; ten explicitly dated USD300 principal obligations.',_commercial_terms_id=>'55555555-0000-4000-8000-000000000001');`));
  const id = created.id;
  assert(/^[0-9a-f-]{36}$/.test(id));
  sql(`UPDATE paige_agreements SET status='sent',content_sha256=repeat('a',64),content_storage_key='fixture/approved-A.pdf',sent_at=now() WHERE id='${id}';
    INSERT INTO paige_agreement_signers(agreement_id,tenant_id,full_name,email,signing_order,token_hash,token_expires_at)
    VALUES('${id}','aaaaaaaa-0000-4000-8000-000000000001','Synthetic Signer','fixture@example.com',1,encode(digest(repeat('c',64),'sha256'),'hex'),now()+interval '1 day');`);
  if(mode==='repaired') {
    const migration=read('supabase/migrations/20271101120000_signing_context_unknown_economics.sql');
    sql(migration);sql(migration);
  }
  const context = (token="repeat('c',64)",role='anon') => JSON.parse(sql(`SET ROLE ${role}; SELECT row_to_json(p) FROM peek_agreement_signing(${token}) p;`));
  const before=context();check(before.is_valid,'Valid legacy document must stay readable');
  check(Object.keys(before).length===12,'Keep exact twelve-column response');
  check(before.document_title==='Synthetic commercial A'&&before.document_body.includes('USD3500'),'Read canonical unchanged document');
  check(before.amount_minor===null&&before.amount_currency===null&&before.term_summary===null,'No unproven mutable economics header');
  const hash=sql(`SELECT content_sha256 FROM paige_agreements WHERE id='${id}';`);
  const firstView=sql(`SELECT viewed_at FROM paige_agreements WHERE id='${id}';`);
  sql(`UPDATE tenant_client_agreements SET agreed_amount_minor=370000,agreed_currency='EUR',term_kind='recurring' WHERE id='55555555-0000-4000-8000-000000000001';`);
  const after=context("repeat('c',64)",'authenticated');
  check(after.is_valid&&after.amount_minor===null&&after.amount_currency===null&&after.term_summary===null,'Source mutation must not create signed-economic claims');
  check(sql(`SELECT content_sha256 FROM paige_agreements WHERE id='${id}';`)===hash,'Source mutation preserves document hash');
  check(sql(`SELECT viewed_at FROM paige_agreements WHERE id='${id}';`)===firstView,'First-view timestamp is idempotent');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${id}' AND event_type='viewed';`)==='1','First-view event occurs once');
  for(const token of ['NULL',"''","'malformed'","repeat('d',64)"]) {
    const denied=context(token);check(denied.is_valid===false&&Object.entries(denied).every(([k,v])=>k==='is_valid'||v===null),'Malformed or unknown/foreign token uniform denial');
  }
  sql(`UPDATE paige_agreement_signers SET token_expires_at=now()-interval '1 day' WHERE agreement_id='${id}';`);
  check(context().is_valid===false,'Expired signer token denied');
  sql(`UPDATE paige_agreement_signers SET token_expires_at=now()+interval '1 day',token_revoked_at=now() WHERE agreement_id='${id}';`);
  check(context().is_valid===false,'Revoked signer token denied');
  sql(`UPDATE paige_agreement_signers SET token_revoked_at=NULL WHERE agreement_id='${id}'; UPDATE paige_agreements SET expires_at=now()-interval '1 day' WHERE id='${id}';`);
  check(context().is_valid===false,'Expired agreement denied');
  sql(`UPDATE paige_agreements SET expires_at=NULL WHERE id='${id}';`);
  check(context().is_valid===true,'Valid document remains readable after restored fixture expiry');
  sql(`UPDATE paige_agreements SET commercial_terms_id=NULL WHERE id='${id}';`);
  check(context().amount_minor===null&&context().is_valid===true,'No linked terms remains unknown and readable');
  sql(`DO $proof$ BEGIN BEGIN INSERT INTO paige_agreement_signers(agreement_id,tenant_id,full_name,email,signing_order,token_hash,token_expires_at) VALUES('${id}','bbbbbbbb-0000-4000-8000-000000000002','Foreign fixture','foreign@example.test',2,encode(digest(repeat('e',64),'sha256'),'hex'),now()+interval '1 day'); RAISE EXCEPTION 'foreign signer scope accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $proof$;`);checks++;
  check(context("repeat('e',64)").is_valid===false,'Rejected foreign-tenant signer token exposes no document');
  sql(`SET ROLE anon; DO $proof$ BEGIN BEGIN PERFORM 1 FROM public.paige_agreements; RAISE EXCEPTION 'anon direct signing table access accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $proof$;`);checks++;
  check(sql(`SELECT has_function_privilege('anon','public.peek_agreement_signing(text)','EXECUTE') AND has_function_privilege('authenticated','public.peek_agreement_signing(text)','EXECUTE');`)==='t','Original caller grants preserved');
  check(sql(`SELECT NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.peek_agreement_signing(text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE');`)==='t','PUBLIC execute remains revoked');
  sql(`DO $proof$ BEGIN BEGIN UPDATE paige_agreements SET content_sha256=repeat('b',64) WHERE id='${id}'; RAISE EXCEPTION 'immutable hash guard failed'; EXCEPTION WHEN check_violation THEN NULL; END; BEGIN UPDATE paige_agreements SET body_markdown='changed' WHERE id='${id}'; RAISE EXCEPTION 'immutable body guard failed'; EXCEPTION WHEN check_violation THEN NULL; END; END $proof$;`);checks+=2;
  console.log(JSON.stringify({result:'PASS',checks,scope:'Native PostgreSQL synthetic canonical writer and actual anon/authenticated token read; no customer authentication, real signature, provider or production',migrationReplay:mode==='repaired'?2:0}));

} finally { db = 'postgres'; sql(`DROP DATABASE ${fixture};`); }
