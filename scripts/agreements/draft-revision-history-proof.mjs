// Native synthetic proof on the existing agreements integrity runner's owned cluster.
// Fixture auth helpers are not production JWT or customer acceptance evidence.
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const [binary, port, user, expectedDirectory, mode] = process.argv.slice(2);
assert(binary && /^\d+$/.test(port ?? '') && user && expectedDirectory);
assert(['baseline', 'repaired'].includes(mode), 'Explicit baseline/repaired mode required');
let database = 'postgres', checks = 0;
const sql = input => {
  const r = spawnSync(binary, ['-h', '127.0.0.1', '-p', port, '-U', user, '-d', database, '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { input, encoding: 'utf8', windowsHide: true, maxBuffer: 8e6, timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || String(r.error));
  return r.stdout.trim();
};
const normalize = value => value.replaceAll('\\', '/').toLowerCase().replace(/\/$/, '');
assert.equal(normalize(sql('SHOW data_directory;')), normalize(expectedDirectory), 'Only the task-owned cluster is allowed');
const fixture = `agreement_revision_${randomUUID().replaceAll('-', '')}`;
sql(`CREATE DATABASE ${fixture};`); database = fixture;
const read = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const tenant = 'aaaaaaaa-0000-4000-8000-000000000001';
const actor = '11111111-0000-4000-8000-000000000001';
const client = 'c1111111-0000-4000-8000-000000000001';
const context = `SET ROLE authenticated; SET test.uid='${actor}'; SET test.tenant='${tenant}'; SET test.admin='true'; SET test.member='true'; `;
const check = (condition, message) => { assert(condition, message); checks++; };
const refused = (statement, code='42501', prefix=context) => {
  sql(prefix + `DO $proof$ BEGIN BEGIN ${statement}; RAISE EXCEPTION 'Expected native refusal ${code}'; EXCEPTION WHEN SQLSTATE '${code}' THEN NULL; END; END $proof$;`);
  checks++;
};
const children=new Map();
const concurrent=(input,onOutput=()=>{})=>new Promise((resolve,reject)=>{
  const child=spawn(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-qAt','-v','ON_ERROR_STOP=1'],
    {windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',error='',finished;
  children.set(child,new Promise(done=>{finished=done;}));
  const timer=setTimeout(()=>{child.kill();reject(new Error('Native revision session exceeded 30 seconds'));},30_000);
  child.stdout.on('data',data=>{output+=data;onOutput(output);});child.stderr.on('data',data=>{error+=data;});
  child.on('error',failure=>{clearTimeout(timer);reject(failure);});
  child.on('close',code=>{clearTimeout(timer);children.delete(child);finished();code===0?resolve(output.trim()):reject(new Error(error));});
  child.stdin.end(input);
});

try {
  sql(read('scripts/agreements/_fixture-schema.sql'));
  sql('ALTER TABLE tenant_client_agreements ADD COLUMN offer_id uuid REFERENCES tenant_products(id), ADD COLUMN catalog_price_id uuid;');
  for (const name of ['20270401000000_agreements_engine_records.sql', '20271020000310_sales_agreement_trigger_contracts.sql',
    '20270404000000_agreement_signing_contract.sql', '20270405000000_agreement_signer_seam.sql']) sql(read(`supabase/migrations/${name}`));
  const seedSource = read('supabase/migrations/20270519010000_contact_methods_dependents.sql');
  const start = seedSource.indexOf('CREATE OR REPLACE FUNCTION public.seed_agreement_counterparty()');
  const end = seedSource.indexOf('$function$;', start) + '$function$;'.length;
  assert(start >= 0 && end > start); sql(seedSource.slice(start, end));
  sql(read('supabase/migrations/20271113120000_agreement_draft_request_identity.sql'));
  check(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_paige_agreement(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text,timestamptz)'::regprocedure;") === '1bd28e75afa0f50bb07b717795a5be0e', 'Original canonical SAVE is reproduced unchanged');
  const legacy=JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}',NULL,'${client}','Existing draft','Known pre-retention wording');`));
  if (mode === 'repaired') {
    const migration = read('supabase/migrations/20271113130000_agreement_draft_revision_history.sql');
    sql(migration); sql(migration);
    check(sql(`SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id='${legacy.id}';`)==='0','Migration replay does not invent or backfill earlier history');
    const absent=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revisions('${tenant}','${legacy.id}',20);`));
    check(absent.revisions.length===0 && absent.current_source_version===1,'An actual existing agreement can truthfully have no retained earlier wording');
    const secondActor='22222222-0000-4000-8000-000000000002';
    sql(context.replace(`test.uid='${actor}'`,`test.uid='${secondActor}'`)+`SELECT save_paige_agreement('${tenant}','${legacy.id}','${client}','Existing draft','Known post-retention wording',NULL,NULL,'paige_draft',NULL,NULL,'${legacy.updated_at}');`);
    const known=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revisions('${tenant}','${legacy.id}',20);`));
    check(known.revisions.length===2 && known.revisions.every(r=>r.retained_by===secondActor),'First later correction retains the known before/after state under its actual retention actor');
    const oldKnown=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revision('${tenant}','${legacy.id}','${known.revisions.at(-1).id}');`));
    check(oldKnown.body_markdown==='Known pre-retention wording' && oldKnown.source_updated_at===legacy.updated_at,'Retained baseline preserves actual pre-edit wording/time without claiming an earlier retention event');
    check(sql(`SELECT created_by FROM paige_agreements WHERE id='${legacy.id}';`)===actor,'Later retention never reattributes original agreement authorship');
  }

  const first = JSON.parse(sql(context + `SELECT save_paige_agreement('${tenant}',NULL,'${client}','Revision evidence','First synthetic wording');`));
  const after = JSON.parse(sql(context + `SELECT save_paige_agreement('${tenant}','${first.id}','${client}','Revision evidence','Corrected synthetic wording',NULL,NULL,'paige_draft',NULL,NULL,'${first.updated_at}');`));
  check(first.id === after.id && first.version === 1 && after.version === 2, 'A real native correction preserves agreement identity and advances its content version');
  check(sql(`SELECT body_markdown FROM paige_agreements WHERE id='${first.id}';`) === 'Corrected synthetic wording', 'Readback is the actually corrected original row');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${first.id}' AND event_type IN ('created','edited');`) === '2', 'Original writer still emits exactly its own two native events');

  const exists = sql("SELECT to_regclass('public.paige_agreement_draft_revisions') IS NOT NULL;") === 't';
  if (mode === 'baseline') {
    const oldCurrent = sql(`SELECT count(*) FROM paige_agreements WHERE id='${first.id}' AND body_markdown='First synthetic wording';`);
    const oldAudit = sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${first.id}' AND detail::text LIKE '%First synthetic wording%';`);
    console.log(JSON.stringify({ mode, firstContentVersion: first.version, currentContentVersion: after.version,
      originalTextInCurrentRecord: Number(oldCurrent), originalTextInNativeAudit: Number(oldAudit), retainedRevisionRelation: exists,
      scope: 'Synthetic original writer/records only; no customer/provider execution' }));
    check(exists && (oldCurrent !== '0' || oldAudit !== '0'), 'Earlier saved wording must remain inspectable; a version counter alone does not retain it');
  } else {
    check(exists, 'Draft history is subordinate to the original agreement');
    const list = JSON.parse(sql(context + `SELECT read_paige_agreement_draft_revisions('${tenant}','${first.id}',20);`));
    check(list.agreement_id === first.id && list.revisions.length === 2, 'Both actual saved states are discoverable under the same original agreement');
    const retained = JSON.parse(sql(context + `SELECT read_paige_agreement_draft_revision('${tenant}','${first.id}','${list.revisions.at(-1).id}');`));
    check(retained.body_markdown === 'First synthetic wording' && retained.source_body_version === 1, 'Selected original wording is read from its immutable native revision');
    check(list.revisions.map(r=>r.source_body_version).join(',')==='2,1', 'History is ordered by actual retained sequence');
    check(!/body_markdown|document_path|storage_key|token|request_sha256/.test(JSON.stringify(list)), 'Bounded history list exposes metadata only');
    check(!/document_path|storage_key|token|request_sha256/.test(JSON.stringify(retained)), 'Selected wording excludes private source locators and credentials');
    check(retained.retained_by===actor && /^[a-f0-9]{64}$/.test(retained.snapshot_sha256), 'Snapshot retains the actual native caller and source checksum');
    const beforeCount=sql(`SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id='${first.id}';`);
    sql(context+`SELECT read_paige_agreement_draft_revisions('${tenant}','${first.id}',20); SELECT read_paige_agreement_draft_revision('${tenant}','${first.id}','${retained.id}');`);
    check(sql(`SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id='${first.id}';`)===beforeCount, 'Ordinary reads do not create retained activity');

    const page=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revisions('${tenant}','${first.id}',1);`));
    check(page.revisions.length===1 && page.truncated===true && page.next_before_revision_no===2, 'A bounded history page explicitly exposes its cursor and truncation');
    const older=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revisions('${tenant}','${first.id}',1,${page.next_before_revision_no});`));
    check(older.revisions.length===1 && older.revisions[0].id===retained.id && older.truncated===false && older.next_before_revision_no===null, 'Older actual history is reachable without repeating or manufacturing entries');
    refused(`PERFORM read_paige_agreement_draft_revisions('${tenant}','${first.id}',0)`,'22023');
    refused(`PERFORM read_paige_agreement_draft_revisions('${tenant}','${first.id}',51)`,'22023');
    refused(`PERFORM read_paige_agreement_draft_revisions('${tenant}','${first.id}',NULL)`,'22023');
    refused(`PERFORM read_paige_agreement_draft_revisions('${tenant}','${first.id}',20,0)`,'22023');
    const otherTenant='bbbbbbbb-0000-4000-8000-000000000002';
    refused(`PERFORM read_paige_agreement_draft_revisions('${otherTenant}','${first.id}',20)`);
    refused(`PERFORM read_paige_agreement_draft_revisions('${tenant}','${randomUUID()}',20)`);
    refused(`PERFORM read_paige_agreement_draft_revision('${tenant}','${first.id}','${randomUUID()}')`);
    refused(`PERFORM read_paige_agreement_draft_revision('${tenant}','${first.id}','${retained.id}')`,'42501',context.replace("test.admin='true'","test.admin='false'"));
    const foreignContext=context.replace(`test.tenant='${tenant}'`,`test.tenant='${otherTenant}'`);
    refused(`PERFORM read_paige_agreement_draft_revisions('${otherTenant}','${first.id}',20)`,'42501',foreignContext);
    refused(`PERFORM read_paige_agreement_draft_revision('${otherTenant}','${first.id}','${retained.id}')`,'42501',foreignContext);
    const another=JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}',NULL,'${client}','Another actual draft','Separate synthetic wording');`));
    refused(`PERFORM read_paige_agreement_draft_revision('${tenant}','${another.id}','${retained.id}')`);

    for(const signature of ['read_paige_agreement_draft_revisions(uuid,uuid,integer,bigint)','read_paige_agreement_draft_revision(uuid,uuid,uuid)']) {
      check(sql(`SELECT has_function_privilege('authenticated','public.${signature}','EXECUTE') AND NOT has_function_privilege('anon','public.${signature}','EXECUTE') AND NOT has_function_privilege('service_role','public.${signature}','EXECUTE');`)==='t','Exact authenticated-only reader ACL');
      check(sql(`SELECT NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.${signature}'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE');`)==='t','No implicit PUBLIC function execution');
    }
    refused(`PERFORM read_paige_agreement_draft_revisions('${tenant}','${first.id}',20)`,'42501','SET ROLE anon; ');
    refused(`PERFORM read_paige_agreement_draft_revision('${tenant}','${first.id}','${retained.id}')`,'42501','SET ROLE service_role; ');
    for(const role of ['anon','authenticated','service_role']) check(sql(`SELECT NOT has_table_privilege('${role}','public.paige_agreement_draft_revisions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');`)==='t','Private history has no direct application-role table access');
    check(sql("SELECT relrowsecurity FROM pg_class WHERE oid='public.paige_agreement_draft_revisions'::regclass;")==='t','Private revision relation has RLS enabled');
    for(const signature of ['_paige_agreement_draft_state(public.paige_agreements)','_guard_paige_agreement_draft_revision()','_retain_paige_agreement_draft_revision()']) {
      for(const role of ['anon','authenticated','service_role']) check(sql(`SELECT NOT has_function_privilege('${role}','public.${signature}','EXECUTE');`)==='t','Internal native retention helpers are not application-callable');
    }
    refused(`UPDATE paige_agreement_draft_revisions SET title='Rewritten history' WHERE id='${retained.id}'`,'23514','');
    refused(`DELETE FROM paige_agreement_draft_revisions WHERE id='${retained.id}'`,'23514','');
    refused('TRUNCATE paige_agreement_draft_revisions','23514','');
    refused(`INSERT INTO paige_agreement_draft_revisions SELECT (jsonb_populate_record(NULL::paige_agreement_draft_revisions,to_jsonb(r)||jsonb_build_object('id','${randomUUID()}','tenant_id','${otherTenant}','revision_no',999999))).* FROM paige_agreement_draft_revisions r WHERE id='${retained.id}'`,'23514','');

    const unchanged=JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}','${first.id}','${client}','Revision evidence','Corrected synthetic wording',NULL,NULL,'paige_draft',NULL,NULL,'${after.updated_at}');`));
    check(unchanged.version===2 && sql(`SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id='${first.id}';`)==='2','A no-op body save does not invent a retained revision');
    const reverted=JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}','${first.id}','${client}','Revision evidence','First synthetic wording',NULL,NULL,'paige_draft',NULL,NULL,'${unchanged.updated_at}');`));
    const renamed=JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}','${first.id}','${client}','Corrected title','First synthetic wording',NULL,NULL,'paige_draft',NULL,NULL,'${reverted.updated_at}');`));
    const revisions=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revisions('${tenant}','${first.id}',20);`));
    check(reverted.version===3 && renamed.version===3 && revisions.revisions.length===4,'Reverting wording and correcting title each retain actual history without relabeling the engine content version');
    check(revisions.revisions[0].title==='Corrected title' && revisions.revisions[0].revision_no===4 && revisions.revisions.at(-1).source_body_version===1,'Retained sequence and original body-version remain distinct');
    sql('CREATE TABLE proof_revision_race_clock(kind text PRIMARY KEY,at timestamptz DEFAULT clock_timestamp()); GRANT SELECT,INSERT ON proof_revision_race_clock TO authenticated;');
    const eventsBefore=Number(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${first.id}';`));
    let releaseHeld,rejectHeld;
    const held=new Promise((resolve,reject)=>{releaseHeld=resolve;rejectHeld=reject;});
    const barrierTimer=setTimeout(()=>rejectHeld(new Error('Native revision lock barrier was not reached')),5_000);
    const winner=concurrent(`BEGIN; ${context}
      SELECT save_paige_agreement('${tenant}','${first.id}','${client}','Corrected title','Concurrent retained winner',NULL,NULL,'paige_draft',NULL,NULL,'${renamed.updated_at}');
      SELECT 'HISTORY_LOCK_HELD'; SELECT pg_sleep(0.8);
      INSERT INTO proof_revision_race_clock(kind) VALUES('first_releasing'); COMMIT;`,
      output=>{if(output.includes('HISTORY_LOCK_HELD')){clearTimeout(barrierTimer);releaseHeld();}});
    winner.catch(failure=>{clearTimeout(barrierTimer);rejectHeld(failure);});
    await held;
    const loser=concurrent(`${context} INSERT INTO proof_revision_race_clock(kind) VALUES('second_started');
      DO $race$ BEGIN BEGIN
        PERFORM save_paige_agreement('${tenant}','${first.id}','${client}','Corrected title','Concurrent stale overwrite',NULL,NULL,'paige_draft',NULL,NULL,'${renamed.updated_at}');
        RAISE EXCEPTION 'Expected stale native correction to refuse';
      EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END; END $race$; SELECT 'STALE_CORRECTION_REFUSED';`);
    const outcomes=await Promise.allSettled([winner,loser]);
    for(const outcome of outcomes) if(outcome.status==='rejected') throw outcome.reason;
    check(sql("SELECT (SELECT at FROM proof_revision_race_clock WHERE kind='second_started') < (SELECT at FROM proof_revision_race_clock WHERE kind='first_releasing');")==='t','Two real correction sessions overlap while the first holds the original agreement lock');
    check(sql(`SELECT body_markdown FROM paige_agreements WHERE id='${first.id}';`)==='Concurrent retained winner','Stale concurrent correction cannot overwrite the retained winner');
    check(sql(`SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id='${first.id}';`)==='5','Only the actual successful concurrent correction adds a revision');
    check(Number(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${first.id}';`))===eventsBefore+1,'Refused concurrent correction creates no extra native activity');
    const last=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revisions('${tenant}','${first.id}',20);`));
    check(last.revisions.map(r=>r.revision_no).join(',')==='5,4,3,2,1','Concurrent native writes preserve one ordered immutable revision sequence');
    const beforeSend=sql(`SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id='${first.id}';`);
    const link=JSON.parse(sql(context+`SELECT issue_agreement_signing_link('${tenant}','${first.id}',30);`));
    check(link.signing_id===first.id && typeof link.token==='string','Original native link/freeze transition remains callable in the synthetic fixture; token is never logged');
    check(sql(`SELECT status FROM paige_agreements WHERE id='${first.id}';`)==='sent' && sql(`SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id='${first.id}';`)===beforeSend,'Native sent transition does not manufacture another wording revision');
    refused(`PERFORM save_paige_agreement('${tenant}','${first.id}','${client}','Changed sent title','Forbidden sent wording')`,'23514');
    refused(`UPDATE paige_agreements SET body_markdown='Forbidden signed rewrite' WHERE id='${first.id}'`,'23514','');
    const historicalAfterSend=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revision('${tenant}','${first.id}','${retained.id}');`));
    check(historicalAfterSend.body_markdown==='First synthetic wording','Original earlier wording remains inspectable after native freeze without rewriting signed content');
    const key=randomUUID();
    const requestCall=`create_paige_agreement_draft_once('${tenant}','${key}','${client}','Request recovery with history','Original correlated wording')`;
    const one=JSON.parse(sql(context+`SELECT ${requestCall};`)),two=JSON.parse(sql(context+`SELECT ${requestCall};`));
    check(one.state==='created' && two.state==='recovered' && one.signing_id===two.signing_id && one.creation_event_id===two.creation_event_id,'Existing request recovery preserves its original record/event with retention installed');
    check(sql(`SELECT count(*) FROM paige_agreement_draft_revisions WHERE agreement_id='${one.signing_id}';`)==='1' && sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${one.signing_id}';`)==='1','Assigned correlation metadata and replay add no extra revision or native activity');
    const template=randomUUID();sql(`INSERT INTO tenant_agreement_versions(id,tenant_id) VALUES('${template}','${tenant}');`);
    const sourced=JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}',NULL,'${client}','Original template source','Template-derived synthetic wording',NULL,NULL,'tenant_template','${template}',NULL,NULL);`));
    let sourceHistory=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revisions('${tenant}','${sourced.id}',20);`));
    const templateRevision=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revision('${tenant}','${sourced.id}','${sourceHistory.revisions[0].id}');`));
    check(templateRevision.body_source==='tenant_template' && templateRevision.source_version_id===template && templateRevision.body_markdown==='Template-derived synthetic wording','Original template identity and actual derived wording remain inspectable together');
    const uploaded=JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}','${sourced.id}','${client}','Uploaded source',NULL,NULL,NULL,'tenant_upload',NULL,'${tenant}/synthetic-source-one.pdf','${sourced.updated_at}');`));
    sql(context+`SELECT save_paige_agreement('${tenant}','${sourced.id}','${client}','Uploaded source',NULL,NULL,NULL,'tenant_upload',NULL,'${tenant}/synthetic-source-two.pdf','${uploaded.updated_at}');`);
    sourceHistory=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revisions('${tenant}','${sourced.id}',20);`));
    const uploadRevision=JSON.parse(sql(context+`SELECT read_paige_agreement_draft_revision('${tenant}','${sourced.id}','${sourceHistory.revisions[0].id}');`));
    check(sourceHistory.revisions.length===3 && uploadRevision.body_source==='tenant_upload' && uploadRevision.has_source_document===true && uploadRevision.body_markdown===null,'Changed upload reference retains distinct native source history without inventing document text');
    check(!/document_path|synthetic-source|storage_key|token/.test(JSON.stringify(uploadRevision)),'Human upload-history read does not disclose the private object locator or imply byte verification');
    check(sql(`SELECT count(DISTINCT document_path) FROM paige_agreement_draft_revisions WHERE agreement_id='${sourced.id}' AND body_source='tenant_upload';`)==='2','Both actual private upload references remain retained under the same original agreement');
    check(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_paige_agreement(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text,timestamptz)'::regprocedure;") === '1bd28e75afa0f50bb07b717795a5be0e', 'Retention preserves the exact original SAVE body');
    console.log(JSON.stringify({ result: 'PASS', checks, migrationReplay: 2,concurrentSessions:2,
      scope: 'Native synthetic retention/authority/recovery/freeze only; review/CI, actual PDF bytes and production/JWT/customer/provider acceptance remain required' }));
  }
} finally {
  const closing=[...children.values()];for(const child of children.keys())child.kill();await Promise.allSettled(closing);
  database = 'postgres';
  sql(`DROP DATABASE ${fixture};`);
}
