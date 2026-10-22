// Native synthetic proof on the existing disposable agreements cluster.
// Session auth stand-ins are not JWT, provider, signing or customer acceptance.
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const [binary, port, user, expectedDirectory, mode] = process.argv.slice(2);
assert(binary && /^\d+$/.test(port ?? '') && user && expectedDirectory);
assert(['baseline', 'repaired'].includes(mode));
let database = 'postgres', checks = 0;
const sql = input => {
  const r = spawnSync(binary, ['-h', '127.0.0.1', '-p', port, '-U', user, '-d', database, '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { input, encoding: 'utf8', windowsHide: true, maxBuffer: 8e6, timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || String(r.error));
  return r.stdout.trim();
};
const normalize = value => value.replaceAll('\\', '/').toLowerCase().replace(/\/$/, '');
assert.equal(normalize(sql('SHOW data_directory;')), normalize(expectedDirectory), 'Only the task-owned cluster is allowed');
const fixture = `agreement_freeze_${randomUUID().replaceAll('-', '')}`;
sql(`CREATE DATABASE ${fixture};`); database = fixture;
const read = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const tenant = 'aaaaaaaa-0000-4000-8000-000000000001';
const actor = '11111111-0000-4000-8000-000000000001';
const client = 'c1111111-0000-4000-8000-000000000001';
const context = `SET ROLE authenticated; SET test.uid='${actor}'; SET test.tenant='${tenant}'; SET test.admin='true'; SET test.member='true'; `;
const check = (condition, message) => { assert(condition, message); checks++; };
const refused = (statement, code='23514', prefix=context) => {
  sql(prefix + `DO $proof$ BEGIN BEGIN ${statement}; RAISE EXCEPTION 'Expected native refusal ${code}'; EXCEPTION WHEN SQLSTATE '${code}' THEN NULL; END; END $proof$;`);
  checks++;
};
const children = new Map();
const concurrent = (input, onOutput=()=>{}, holdInput) => new Promise((resolve, reject) => {
  const child=spawn(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-qAt','-v','ON_ERROR_STOP=1'],
    {windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',error='',finished;
  children.set(child,new Promise(done=>{finished=done;}));
  const timer=setTimeout(()=>{child.kill();reject(new Error('Native freeze session exceeded 30 seconds'));},30_000);
  child.stdout.on('data',data=>{output+=data;onOutput(output);});child.stderr.on('data',data=>{error+=data;});
  child.on('error',failure=>{clearTimeout(timer);reject(failure);});
  child.on('close',code=>{clearTimeout(timer);children.delete(child);finished();code===0?resolve(output.trim()):reject(new Error(error));});
  if(holdInput) { holdInput(child); child.stdin.write(input); }
  else child.stdin.end(input);
});
try {
  sql(read('scripts/agreements/_fixture-schema.sql'));
  sql('ALTER TABLE tenant_client_agreements ADD COLUMN offer_id uuid REFERENCES tenant_products(id), ADD COLUMN catalog_price_id uuid;');
  for (const name of ['20270401000000_agreements_engine_records.sql', '20271020000310_sales_agreement_trigger_contracts.sql',
    '20270404000000_agreement_signing_contract.sql', '20270405000000_agreement_signer_seam.sql']) sql(read(`supabase/migrations/${name}`));
  const seed = read('supabase/migrations/20270519010000_contact_methods_dependents.sql');
  const start = seed.indexOf('CREATE OR REPLACE FUNCTION public.seed_agreement_counterparty()');
  const end = seed.indexOf('$function$;', start) + '$function$;'.length;
  assert(start >= 0 && end > start); sql(seed.slice(start, end));
  sql(read('supabase/migrations/20271113120000_agreement_draft_request_identity.sql'));
  sql(read('supabase/migrations/20271113130000_agreement_draft_revision_history.sql'));
  const saveHash = sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_paige_agreement(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text,timestamptz)'::regprocedure;");
  const originalLinkHash = sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.issue_agreement_signing_link(uuid,uuid,integer)'::regprocedure;");
  check(saveHash === '1bd28e75afa0f50bb07b717795a5be0e', 'Original SAVE reproduced before freeze proof');
  if (mode === 'repaired') {
    const migration = read('supabase/migrations/20271113150000_agreement_frozen_draft_integrity.sql');
    sql(migration); sql(migration);
  }
  const fresh = JSON.parse(sql(context + `SELECT save_paige_agreement('${tenant}',NULL,'${client}','Original review title','Original review wording');`));
  const edited = JSON.parse(sql(context + `SELECT save_paige_agreement('${tenant}','${fresh.id}','${client}','Corrected before freeze','Reviewed exact wording',NULL,NULL,'paige_draft',NULL,NULL,'${fresh.updated_at}');`));
  check(edited.id === fresh.id && edited.version === 2 && edited.body_markdown === 'Reviewed exact wording', 'Unfrozen draft correction remains usable through original SAVE');
  sql(`UPDATE paige_agreements SET content_sha256=repeat('a',64),content_storage_key='${tenant}/${fresh.id}/presented.pdf' WHERE id='${fresh.id}';`);
  const frozen = JSON.parse(sql(`SELECT to_jsonb(a) FROM paige_agreements a WHERE id='${fresh.id}';`));
  check(frozen.status === 'draft' && frozen.content_sha256 === 'a'.repeat(64), 'Actual engine supports a frozen document while delivery is still draft');
  const preparation = JSON.parse(sql(context + `SELECT read_paige_agreement_preparation('${tenant}','${fresh.id}');`));
  check(preparation.agreement.can_edit === false, 'Existing native reader already denies frozen-draft correction');
  console.log(JSON.stringify({ checkpoint: 'genuine native frozen draft established', checks }));
  const before = sql(`SELECT jsonb_build_object('record',to_jsonb(a),'events',(SELECT count(*) FROM paige_agreement_events WHERE agreement_id=a.id),'revisions',(SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id=a.id)) FROM paige_agreements a WHERE id='${fresh.id}';`);
  refused(`PERFORM save_paige_agreement('${tenant}','${fresh.id}','${client}','Changed after freeze','Different wording after freeze',NULL,NULL,'paige_draft',NULL,NULL,'${frozen.updated_at}')`);
  check(sql(`SELECT jsonb_build_object('record',to_jsonb(a),'events',(SELECT count(*) FROM paige_agreement_events WHERE agreement_id=a.id),'revisions',(SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id=a.id)) FROM paige_agreements a WHERE id='${fresh.id}';`) === before, 'Refusal preserves entire original record, native audit and retained revisions');
  refused(`PERFORM save_paige_agreement('${tenant}','${fresh.id}','${client}','Changed title only','Reviewed exact wording')`);
  refused(`PERFORM save_paige_agreement('${tenant}','${fresh.id}','${client}','Corrected before freeze',NULL,NULL,NULL,'tenant_upload',NULL,'${tenant}/replacement.pdf')`);
  const otherClient=randomUUID(),offer=randomUUID(),terms=randomUUID();
  sql(`INSERT INTO clients(id,tenant_id) VALUES('${otherClient}','${tenant}'); INSERT INTO tenant_products(id,tenant_id) VALUES('${offer}','${tenant}'); INSERT INTO tenant_client_agreements(id,tenant_id,contact_id,offer_id) VALUES('${terms}','${tenant}','${client}','${offer}');`);
  for(const change of [`contact_id='${otherClient}'`,`offer_id='${offer}'`,`commercial_terms_id='${terms}'`,
    "version=version+1","body_markdown='Service overwrite'","title='Service rename'",`document_path='${tenant}/replacement.pdf'`,
    "content_sha256=repeat('b',64)","content_storage_key=NULL"]) {
    refused(`UPDATE paige_agreements SET ${change} WHERE id='${fresh.id}'`,'23514','SET ROLE service_role; ');
  }
  // Recoverable lifecycle metadata is deliberately not frozen by this source guard.
  sql(`UPDATE paige_agreements SET expires_at=now()+interval '7 days' WHERE id='${fresh.id}';`);
  check(sql(`SELECT body_markdown='Reviewed exact wording' AND content_sha256=repeat('a',64) AND expires_at IS NOT NULL FROM paige_agreements WHERE id='${fresh.id}';`)==='t','Delivery recovery metadata can advance without rewriting the retained source');
  const link=JSON.parse(sql(context+`SELECT issue_agreement_signing_link('${tenant}','${fresh.id}',30);`));
  check(link.signing_id===fresh.id && typeof link.token==='string','Existing native link/status path still works; synthetic token is never logged');
  check(sql(`SELECT status FROM paige_agreements WHERE id='${fresh.id}';`)==='sent','Original native link writer advances the same agreement');
  refused(`PERFORM save_paige_agreement('${tenant}','${fresh.id}','${client}','Sent edit','Sent overwrite')`);
  const voided=JSON.parse(sql(context+`SELECT void_paige_agreement('${tenant}','${fresh.id}','Synthetic recovery decision');`));
  check(voided.id===fresh.id && voided.status==='voided','Existing void path remains available for the original retained document');
  check(sql(`SELECT bool_and(token_revoked_at IS NOT NULL) FROM paige_agreement_signers WHERE agreement_id='${fresh.id}' AND token_hash IS NOT NULL;`)==='t','Original void revokes the original synthetic signing link');
  const partial=JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}',NULL,'${client}','Partial artifact','Partial frozen wording');`));
  sql(`UPDATE paige_agreements SET content_storage_key='${tenant}/${partial.id}/presented.pdf' WHERE id='${partial.id}';`);
  const partialRead=JSON.parse(sql(context+`SELECT read_paige_agreement_preparation('${tenant}','${partial.id}');`));
  check(partialRead.agreement.can_edit===false,'Key-only partial artifact is already noneditable in the canonical reader');
  refused(`PERFORM save_paige_agreement('${tenant}','${partial.id}','${client}','Partial artifact','Unreviewed replacement')`);
  refused(`UPDATE paige_agreements SET content_storage_key='${tenant}/new-key.pdf' WHERE id='${partial.id}'`,'23514','SET ROLE service_role; ');
  sql(`UPDATE paige_agreements SET content_sha256=repeat('c',64) WHERE id='${partial.id}';`);
  check(sql(`SELECT content_sha256=repeat('c',64) AND body_markdown='Partial frozen wording' FROM paige_agreements WHERE id='${partial.id}';`)==='t','Existing retained key can acquire its original digest without changing source or key');
  const digestOnly=JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}',NULL,'${client}','Digest artifact','Digest frozen wording');`));
  sql(`UPDATE paige_agreements SET content_sha256=repeat('d',64) WHERE id='${digestOnly.id}';`);
  refused(`PERFORM save_paige_agreement('${tenant}','${digestOnly.id}','${client}','Digest artifact','Unreviewed replacement')`);
  refused(`UPDATE paige_agreements SET content_storage_key='${tenant}/replacement.pdf' WHERE id='${digestOnly.id}'`,'23514','SET ROLE service_role; ');
  sql(`UPDATE paige_agreements SET sealed_storage_key='${tenant}/${partial.id}/completed.pdf' WHERE id='${partial.id}';`);
  refused(`UPDATE paige_agreements SET sealed_storage_key='${tenant}/replacement-completed.pdf' WHERE id='${partial.id}'`,'23514','SET ROLE service_role; ');
  sql(`UPDATE paige_agreements SET sealed_sha256=repeat('f',64) WHERE id='${partial.id}';`);
  refused(`UPDATE paige_agreements SET sealed_sha256=repeat('e',64) WHERE id='${partial.id}'`,'23514','SET ROLE service_role; ');
  check(sql(`SELECT sealed_sha256=repeat('f',64) AND body_markdown='Partial frozen wording' FROM paige_agreements WHERE id='${partial.id}';`)==='t','Sealing metadata can complete while the original source and retained files remain immutable');
  // Two real overlapping sessions: legacy SAVE has no CAS. The native trigger
  // must still see the just-committed freeze rather than its earlier draft read.
  const racing=JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}',NULL,'${client}','Concurrent source','Concurrent reviewed wording');`));
  sql('CREATE TABLE proof_freeze_clock(kind text PRIMARY KEY,at timestamptz DEFAULT clock_timestamp()); GRANT SELECT,INSERT ON proof_freeze_clock TO authenticated;');
  let releaseHeld,rejectHeld;
  const held=new Promise((resolve,reject)=>{releaseHeld=resolve;rejectHeld=reject;});
  const barrier=setTimeout(()=>rejectHeld(new Error('Native freeze lock was not reached')),5_000);
  let freezeProcess;
  const application=`e04_freeze_${randomUUID().replaceAll('-','')}`;
  const freeze=concurrent(`BEGIN; UPDATE paige_agreements SET content_sha256=repeat('e',64),content_storage_key='${tenant}/${racing.id}/presented.pdf' WHERE id='${racing.id}'; SELECT 'FREEZE_LOCK_HELD';\n`,
    output=>{if(output.includes('FREEZE_LOCK_HELD')){clearTimeout(barrier);releaseHeld();}},child=>{freezeProcess=child;});
  freeze.catch(failure=>{clearTimeout(barrier);rejectHeld(failure);});
  await held;
  const edit=concurrent(`SET application_name='${application}'; ${context} INSERT INTO proof_freeze_clock(kind) VALUES('edit_started'); DO $race$ BEGIN BEGIN PERFORM save_paige_agreement('${tenant}','${racing.id}','${client}','Concurrent overwrite','Concurrent unreviewed wording'); RAISE EXCEPTION 'Expected retained source refusal'; EXCEPTION WHEN SQLSTATE '23514' THEN NULL; END; END $race$; SELECT 'FROZEN_EDIT_REFUSED';`);
  edit.catch(()=>{}); // finally also awaits process closure if a barrier assertion fails.
  let waiting=false;
  const deadline=Date.now()+5_000;
  while(Date.now()<deadline) {
    waiting=sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='${fixture}' AND application_name='${application}' AND wait_event_type='Lock');`)==='t';
    if(waiting) break;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  check(waiting,'Actual legacy SAVE is observed waiting for the original freeze lock before commit');
  freezeProcess.stdin.end("INSERT INTO proof_freeze_clock(kind) VALUES('freeze_releasing'); COMMIT;\n");
  for(const outcome of await Promise.allSettled([freeze,edit])) if(outcome.status==='rejected') throw outcome.reason;
  check(sql("SELECT (SELECT at FROM proof_freeze_clock WHERE kind='edit_started') < (SELECT at FROM proof_freeze_clock WHERE kind='freeze_releasing');")==='t','Two actual sessions overlap the original freeze lock');
  check(sql(`SELECT body_markdown='Concurrent reviewed wording' AND content_sha256=repeat('e',64) FROM paige_agreements WHERE id='${racing.id}';`)==='t','Legacy edit cannot overwrite source after the concurrent freeze commits');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${racing.id}';`)==='1' && sql(`SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id='${racing.id}';`)==='1','Refused race creates no extra native edit event or retained revision');
  refused(`PERFORM save_paige_agreement('${tenant}',NULL,'${client}','Unauthorized draft','Must not write')`,'42501',context.replace("test.admin='true'","test.admin='false'"));
  refused(`PERFORM save_paige_agreement('bbbbbbbb-0000-4000-8000-000000000002',NULL,'${client}','Wrong business','Must not write')`,'42501');
  refused(`PERFORM save_paige_agreement('${tenant}',NULL,'${client}','Anonymous draft','Must not write')`,'42501','SET ROLE anon; ');
  check(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_paige_agreement(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text,timestamptz)'::regprocedure;")===saveHash,'Original SAVE source remains unchanged');
  check(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.issue_agreement_signing_link(uuid,uuid,integer)'::regprocedure;")===originalLinkHash,'Original native link source remains unchanged');
  check(sql("SELECT proconfig @> ARRAY['search_path=\"\"'] FROM pg_proc WHERE oid='public.enforce_agreement_seal_immutable()'::regprocedure;")==='t','Native integrity trigger has an empty search path');
  check(sql("SELECT tgenabled='O' FROM pg_trigger WHERE tgname='trg_agreement_seal_immutable' AND tgrelid='paige_agreements'::regclass;")==='t','Original integrity trigger remains enabled');
  console.log(JSON.stringify({ result:'PASS', checks, migrationReplay:mode==='repaired'?2:0, concurrentSessions:2, scope:'Native synthetic original-writer integrity only; CI, release, actual frozen bytes/provider/JWT and customer acceptance remain owed' }));
} finally {
  const closing=[...children.values()];for(const child of children.keys())child.kill();await Promise.allSettled(closing);
  database = 'postgres'; sql(`DROP DATABASE ${fixture};`);
}
