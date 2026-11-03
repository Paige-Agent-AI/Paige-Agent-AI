// Existing Supabase stack installs ALL immutable forward carriers from scratch.
// Replay the latest correction twice here; never reapply an old superseded body.
// No new project, migration-ledger entry or business fixture.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,unlinkSync } from 'node:fs';
import { randomUUID,createHash } from 'node:crypto';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const candidate=readFileSync(join(repo,'scripts/proof/exp05-zion-planning-read-candidate.sql'),'utf8').replace(/\r\n/g,'\n');
const carrier=readFileSync(join(repo,'supabase/migrations/20271127000005_exp05_zion_planning_source_binding.sql'),'utf8').replace(/\r\n/g,'\n');
const history=readFileSync(join(repo,'scripts/proof/exp05-zion-planning-history-readonly.sql'),'utf8').replace(/\r\n/g,'\n');
const historyCarrier=readFileSync(join(repo,'supabase/migrations/20271127010005_exp05_zion_planning_readonly_history.sql'),'utf8').replace(/\r\n/g,'\n');
const linkCap=readFileSync(join(repo,'scripts/proof/exp05-zion-planning-link-cap.sql'),'utf8').replace(/\r\n/g,'\n');
const linkCarrier=readFileSync(join(repo,'supabase/migrations/20271127020005_exp05_zion_planning_link_cap.sql'),'utf8').replace(/\r\n/g,'\n');
const historyScope=readFileSync(join(repo,'scripts/proof/exp05-zion-planning-history-scope.sql'),'utf8').replace(/\r\n/g,'\n');
const scopeCarrier=readFileSync(join(repo,'supabase/migrations/20271127030005_exp05_zion_planning_history_scope.sql'),'utf8').replace(/\r\n/g,'\n');
assert.equal(carrier.slice(carrier.indexOf('-- INERT SOURCE CANDIDATE,')),candidate,
 'The forward migration must retain the complete original native candidate exercised by this proof');
assert.equal(historyCarrier.slice(historyCarrier.indexOf('-- Original EXP05 Planning history correction.')),history,
 'The history forward carrier must retain the complete source exercised by this proof');
assert.equal(linkCarrier.slice(linkCarrier.indexOf('-- Forward-only presentation correction;')),linkCap,
 'The link-cap forward carrier must retain the complete source exercised by this proof');
assert.equal(scopeCarrier.slice(scopeCarrier.indexOf('-- Forward-only restoration of the original')),historyScope,
 'The historical scope forward carrier must retain the complete source exercised by this proof');
const unwrap=source=>{
 assert.equal(source.match(/^BEGIN;$/gm)?.length,1,'Exactly one candidate transaction');
 assert.equal(source.match(/^COMMIT;$/gm)?.length,1,'Exactly one candidate commit');
 return source.replace(/^BEGIN;\n/m,'').replace(/\nCOMMIT;\s*$/,'\n');
};
unwrap(candidate);unwrap(history);unwrap(linkCap);
const body=unwrap(historyScope);
const originalLinks=linkCap.split('$original$')[1],boundedLinks=linkCap.split('$bounded$')[1];
const originalScope=historyScope.split('$original$')[1],boundedScope=historyScope.split('$bounded$')[1];
assert(originalLinks&&boundedLinks,'Complete inverse hunks present');
assert(originalScope&&boundedScope,'Complete historical scope inverse hunks present');
assert(!/^COMMIT;$/m.test(body));
// Establish the WHOLE original replay variant independently of the native pin.
const fixture=readFileSync(join(repo,'supabase/tests/fixtures/exp05-zion-planning-original.sql'),'utf8').replace(/\r\n/g,'\n');
const live=fixture.slice(fixture.indexOf('CREATE OR REPLACE FUNCTION public.plan_list(')).split('AS $function$')[1].split('$function$')[0];
const comments='       -- Plan-window filter applies only in the default (plan-window) mode; in\n       -- by-item-date mode we keep all plans and filter their items by date.\n';
const anchor='       AND (p_by_item_date OR ((p_from';
const immutable=readFileSync(join(repo,'supabase/migrations/20260712040000_plan_list_contact_and_calendar.sql'),'utf8').replace(/\r\n/g,'\n');
assert(immutable.includes(comments+anchor));assert.equal(live.split(anchor).length,2);
assert.equal(createHash('md5').update(live).digest('hex'),'702f2b52fc0d4e5c615fde7ec906b840');
assert.equal(createHash('md5').update(live.replace(anchor,comments+anchor)).digest('hex'),'a8c0a676cdd686bc17d5dbbb7d605ecc');
let sql=`BEGIN;
SELECT plan(13);
CREATE FUNCTION pg_temp.e5_metadata(p pg_proc) RETURNS jsonb LANGUAGE sql AS $$
 SELECT CASE WHEN p.proname='team_hub_search' THEN jsonb_set(to_jsonb(p)-'prosrc','{proargdefaults}',
  to_jsonb(regexp_replace(p.proargdefaults::text,':location -?[0-9]+',':location -1','g'))) ELSE to_jsonb(p)-'prosrc' END $$;
CREATE TEMP TABLE e5_original AS SELECT oid,proname,prosrc,pg_temp.e5_metadata(p) metadata FROM pg_proc p
 WHERE pronamespace='public'::regnamespace;
${body}
SELECT ok(NOT EXISTS(SELECT 1 FROM e5_original b LEFT JOIN pg_proc p USING(oid)
 WHERE b.metadata IS DISTINCT FROM pg_temp.e5_metadata(p) OR (p.prosrc<>b.prosrc AND p.proname NOT IN
 ('_team_hub_assert_agent_read_scope','team_hub_stage_agent_read_context','_team_hub_agent_read_annotations','team_hub_search'))),
 'Full-schema original OIDs/ABI/owner/ACL/config/default behavior and all outside-owned bodies conserved');
SELECT ok((SELECT p.prosrc=b.prosrc AND md5(p.prosrc) IN
 ('702f2b52fc0d4e5c615fde7ec906b840','a8c0a676cdd686bc17d5dbbb7d605ecc')
 FROM e5_original b JOIN pg_proc p USING(oid) WHERE p.oid=
 'public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean)'::regprocedure),
 'Original complete reader unchanged; only the two exact immutable source variants admitted');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)'::regprocedure),
 'bd0e68f3c3e88976786d716dc4a870a6','Original public post including native stage guard unchanged');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.team_hub_list_messages(uuid,uuid,uuid,timestamptz,uuid,integer)'::regprocedure),
 '425c6d84055788cc651001b8fe13199d','Original public history reader unchanged');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public._team_hub_message_json(public.team_hub_messages)'::regprocedure),
 '1876c9f943d5f51ddef29d4528e5e981','Original public serializer unchanged');
SELECT ok((SELECT count(*)=5 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
 ('_team_hub_planning_read_source','_team_hub_planning_source_versions','_team_hub_assert_planning_read',
 '_team_hub_stage_planning_read','_team_hub_planning_read_annotations'))
 AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
 WHERE p.proname IN ('_team_hub_planning_read_source','_team_hub_planning_source_versions','_team_hub_assert_planning_read',
 '_team_hub_stage_planning_read','_team_hub_planning_read_annotations') AND a.grantee<>p.proowner),
 'Actual full-schema Planning helpers remain private, without browser or service EXECUTE');
SELECT ok(has_function_privilege('service_role','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE'),
 'Original four-argument stage remains service-only');
SELECT ok((SELECT md5(replace(prosrc,E'  WHERE m.id=ANY(hits)\\n   AND NOT coalesce((public._team_hub_agent_read_annotations(m.id)->>''source_unavailable'')::boolean,false)',
 '  WHERE m.id=ANY(hits)'))='d71b872a84e35d1b6b758006181e15d2' AND pg_get_expr(proargdefaults,0)='20'
 FROM pg_proc WHERE oid='public.team_hub_search(uuid,text,integer)'::regprocedure),
 'Complete Search inverse/default20 preserved outside Planning revocation filter');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)'::regprocedure),
 'b92f4236bb2ef1e4bb01c584d0645ba7','Exact source-bound Planning guard installed on full schema');
SELECT ok((SELECT bool_and(provolatile='s') FROM pg_proc WHERE oid=ANY(ARRAY[
 'public._team_hub_planning_read_annotations(public.team_hub_agent_turns)'::regprocedure,
 'public.team_hub_list_messages(uuid,uuid,uuid,timestamptz,uuid,integer)'::regprocedure,
 'public.team_hub_search(uuid,text,integer)'::regprocedure])),
 'Historical Planning annotation and original public readers honor read-only transaction semantics');
SELECT is((SELECT md5(replace(prosrc,$e5bounded$${boundedLinks}$e5bounded$,$e5original$${originalLinks}$e5original$))
 FROM pg_proc WHERE oid='public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)'::regprocedure),
 '5ca11bdb927e4d4a571f1936f608d2b5','Complete native stage inverse is unchanged outside bounded navigation');
SELECT is((SELECT md5(replace(prosrc,$e5scope$${boundedScope}$e5scope$,$e5originalscope$${originalScope}$e5originalscope$))
 FROM pg_proc WHERE oid='public._team_hub_planning_read_annotations(public.team_hub_agent_turns)'::regprocedure),
 'f6ffa06936970dd1ad1a8d3b1cb98be1','Complete READ ONLY history inverse unchanged outside original read/card access class');
CREATE TEMP TABLE e5_installed AS SELECT oid,to_jsonb(p) full_metadata FROM pg_proc p WHERE pronamespace='public'::regnamespace;
${body}
SELECT ok(NOT EXISTS(SELECT 1 FROM e5_installed b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.full_metadata IS DISTINCT FROM to_jsonb(p)),
 'Replay preserves every function, source and full installed metadata');
SELECT * FROM finish();
ROLLBACK;
`;
const calendarMode=process.argv.includes('--calendar');
if(calendarMode){
 const calendar=readFileSync(join(repo,'scripts/proof/exp05-zion-calendar-read-candidate.sql'),'utf8').replace(/\r\n/g,'\n');
 const calendarCarrier=readFileSync(join(repo,'supabase/migrations/20271129000005_exp05_zion_calendar_source_binding.sql'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(calendarCarrier.slice(calendarCarrier.indexOf('-- INERT EXP05 Calendar admission preparation,')),calendar,
  'The Calendar forward retains the ENTIRE candidate exercised by native proofs');
 const latest=unwrap(calendar);
 const original=JSON.parse(readFileSync(join(repo,'supabase/tests/fixtures/exp05-zion-calendar-original-native.json'),'utf8'));
 const changes=[...calendar.matchAll(/\('([^']+)','([a-f0-9]{32})',\$source\$([\s\S]*?)\$source\$\)/g)];
 assert.equal(changes.length,4,'Exactly four guarded incumbent body changes');
 const inverse=[];
 for(const [,sig,old,replacement] of changes){
  const name=sig.slice('public.'.length,sig.indexOf('('));
  const snapshot=original[name]; assert(snapshot,'Whole predecessor source retained');
  const prefix='AS $function$';
  const source=snapshot.definition.slice(snapshot.definition.indexOf(prefix)+prefix.length,snapshot.definition.lastIndexOf('$function$'));
  assert.equal(createHash('md5').update(source).digest('hex'),old,'Independent complete predecessor body pin');
  assert.equal(snapshot.md5,old);
  inverse.push(`('${sig}',$current$${replacement}$current$,$previous$${source}$previous$)`);
 }
 const rewind=`CREATE TEMP TABLE e5_calendar_entry AS SELECT oid,to_jsonb(p) full_metadata FROM pg_proc p WHERE pronamespace='public'::regnamespace;
DO $inverse$
DECLARE sig text; expected text; previous text; p pg_proc; metadata jsonb;
BEGIN
 FOR sig,expected,previous IN SELECT * FROM (VALUES ${inverse.join(',\n')}) v(sig,expected,previous) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(sig);
  IF p.prosrc IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Calendar full-schema source is not installed: %',sig; END IF;
  metadata:=to_jsonb(p)-'prosrc';
  EXECUTE replace(pg_get_functiondef(p.oid),p.prosrc,previous);
  IF metadata IS DISTINCT FROM (SELECT to_jsonb(r)-'prosrc' FROM pg_proc r WHERE r.oid=p.oid) THEN
   RAISE EXCEPTION 'Calendar proof inverse changed native metadata'; END IF;
 END LOOP;
END $inverse$;
`;
 // Preserve ALL thirteen original assertions, literal source and inverse checks.
 // Rewind only the four known bodies within this rollback-only test, exercise
 // the original latest Planning carrier, then restore/replay the actual latest
 // Calendar forward. Never reapply superseded source to production or a ledger.
 const extra=`${latest}
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid)'::regprocedure),
 '6ec4ba377abfe348192cdf17bb973869','Original canonical Calendar reader is unchanged');
SELECT ok((SELECT count(*)=3 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('_team_hub_calendar_read_source','_team_hub_assert_calendar_read','_team_hub_stage_calendar_read'))
 AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.proname IN
 ('_team_hub_calendar_read_source','_team_hub_assert_calendar_read','_team_hub_stage_calendar_read') AND a.grantee<>p.proowner),
 'Calendar validators stay private with no browser/service grant');
SELECT ok(NOT EXISTS(SELECT 1 FROM e5_calendar_entry b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.full_metadata IS DISTINCT FROM to_jsonb(p)),
 'Restoring latest Calendar preserves every whole native body/OID/ABI/owner/ACL/config/default');
${latest}
SELECT ok(NOT EXISTS(SELECT 1 FROM e5_calendar_entry b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.full_metadata IS DISTINCT FROM to_jsonb(p)),
 'Latest Calendar exact replay preserves the full installed catalog');
SELECT ok((SELECT provolatile='s' FROM pg_proc WHERE oid='public._team_hub_planning_read_annotations(public.team_hub_agent_turns)'::regprocedure)
 AND (SELECT NOT prosrc LIKE '%FOR SHARE%' AND NOT prosrc LIKE '%FOR UPDATE%' FROM pg_proc
  WHERE oid='public._team_hub_planning_read_annotations(public.team_hub_agent_turns)'::regprocedure),
 'Composed Calendar/Planning historical projection remains genuinely read-only');
SELECT ok((SELECT prosrc LIKE '%octet_length(t.read_context::text)>8192%' AND prosrc LIKE '%context_limit%'
 FROM pg_proc WHERE oid='public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)'::regprocedure),
 'Original bounded context has a known pre-update no-change capacity refusal');
`;
 const prior=sql;
 assert.equal(prior.split('SELECT plan(13);').length,2);
 assert.equal(prior.split('SELECT * FROM finish();').length,2);
 // SQL contains literal dollar/apostrophe regex anchors: callback replacements
 // preserve the bytes rather than interpreting JavaScript replacement tokens.
 sql=prior.replace('SELECT plan(13);',()=>`SELECT plan(19);\n${rewind}`).replace('SELECT * FROM finish();',()=>`${extra}SELECT * FROM finish();`);
 assert(sql.includes(prior.slice(prior.indexOf('CREATE FUNCTION pg_temp.e5_metadata'),prior.indexOf('SELECT * FROM finish();'))),
  'All original thirteen assertions, setup and inverse checks retained byte-exact');
}
if(calendarMode){
 // Rewind ONLY the latest four Task-reference bodies inside this rollback-only
 // proof, retain all19 original assertions, then restore/replay the real forward.
 const task=readFileSync(join(repo,'supabase/migrations/20271130030005_exp05_zion_original_task_references.sql'),'utf8').replace(/\r\n/g,'\n');
 const latestTask=unwrap(task);
 const hunks=[...task.matchAll(/\('([^']+)',(\d+),'([a-f0-9]{32})','([a-f0-9]{32})',\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\)/g)];
 assert.equal(hunks.length,8,'Exactly eight guarded original Task-reference hunks');
 const pins=[...new Map(hunks.map(([,sig,,before,after])=>[sig,`('${sig}','${before}','${after}')`])).values()];
 assert.equal(pins.length,4,'Exactly four incumbent native functions');
 const values=hunks.map(([,sig,n,,,old,next])=>`('${sig}',${n},$task_old$${old}$task_old$,$task_new$${next}$task_new$)`);
 const rewind=`CREATE TEMP TABLE e5_task_entry AS SELECT oid,to_jsonb(p) full_metadata FROM pg_proc p WHERE pronamespace='public'::regnamespace;
DO $task_inverse$
DECLARE sig text; before_hash text; after_hash text; p pg_proc; metadata jsonb; replacement text; h record;
BEGIN
 FOR sig,before_hash,after_hash IN SELECT * FROM (VALUES ${pins.join(',\n')}) v(sig,before_hash,after_hash) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(sig);
  IF md5(p.prosrc) IS DISTINCT FROM after_hash THEN RAISE EXCEPTION 'Task full-schema source is not installed: %',sig; END IF;
  metadata:=to_jsonb(p)-'prosrc'; replacement:=p.prosrc;
  FOR h IN SELECT * FROM (VALUES ${values.join(',\n')}) v(name,ordinal,old_text,new_text) WHERE name=sig ORDER BY ordinal DESC LOOP
   IF (length(replacement)-length(replace(replacement,h.new_text,'')))/length(h.new_text)<>1 THEN RAISE EXCEPTION 'Task inverse hunk drift'; END IF;
   replacement:=replace(replacement,h.new_text,h.old_text);
  END LOOP;
  IF md5(replacement)<>before_hash THEN RAISE EXCEPTION 'Task complete inverse drift'; END IF;
  EXECUTE replace(pg_get_functiondef(p.oid),p.prosrc,replacement);
  IF metadata IS DISTINCT FROM (SELECT to_jsonb(q)-'prosrc' FROM pg_proc q WHERE q.oid=p.oid) THEN RAISE EXCEPTION 'Task inverse changed metadata'; END IF;
 END LOOP;
END $task_inverse$;
`;
 const extra=`${latestTask}
SELECT ok(NOT EXISTS(SELECT 1 FROM e5_task_entry b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.full_metadata IS DISTINCT FROM to_jsonb(p)),
 'Restoring latest Task forward preserves all whole bodies/OIDs/ABI/owner/ACL/config/default');
${latestTask}
SELECT ok(NOT EXISTS(SELECT 1 FROM e5_task_entry b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.full_metadata IS DISTINCT FROM to_jsonb(p)),
 'Latest Task exact replay preserves the full installed catalog');
SELECT ok(NOT has_function_privilege('authenticated','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE')
 AND has_function_privilege('service_role','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE'),
 'Original Task staging remains service-only with no browser grant');
SELECT ok((SELECT provolatile='s' AND NOT prosrc LIKE '%FOR SHARE%' AND NOT prosrc LIKE '%FOR UPDATE%'
 FROM pg_proc WHERE oid='public._team_hub_planning_read_annotations(public.team_hub_agent_turns)'::regprocedure),
 'Composed Task/Calendar/Planning history stays read-only');
`;
 const prior=sql;
 sql=prior.replace('SELECT plan(19);',()=>`SELECT plan(23);\n${rewind}`).replace('SELECT * FROM finish();',()=>`${extra}SELECT * FROM finish();`);
 assert(sql.includes(prior.slice(prior.indexOf('CREATE TEMP TABLE e5_calendar_entry'),prior.indexOf('SELECT * FROM finish();'))),
  'All original nineteen Calendar/Planning assertions and inverses retained byte-exact');
}
if(process.argv.includes('--self-test')){
 assert(sql.startsWith(`BEGIN;\nSELECT plan(${calendarMode?23:13});`));assert(sql.endsWith('ROLLBACK;\n'));
 assert.equal((sql.match(/^BEGIN;$/gm)??[]).length,1);assert.equal((sql.match(/^COMMIT;$/gm)??[]).length,0);
 assert.equal(sql.split(body).length,3,'Exact candidate bytes embedded twice without transaction wrappers');
 assert(!/INSERT INTO (public|auth)\./i.test(sql));
 console.log(`PASS: ${calendarMode?'six':'four'} exact carriers verified; latest forward twice inside one rollback-only test;${calendarMode?23:13} assertions; no business fixture/ledger`);
}else{
 const cli=process.env.SUPABASE_BIN??'supabase';
 const state=spawnSync(cli,['status','-o','json'],{cwd:repo,encoding:'utf8',timeout:30000});
 assert.equal(state.status,0,'Existing LOCAL Supabase stack must be running; never fall back to production');
 const endpoint=new URL(JSON.parse(state.stdout).DB_URL);
 assert(['127.0.0.1','localhost'].includes(endpoint.hostname)&&endpoint.port==='54322'&&endpoint.pathname==='/postgres',
  'Existing isolated local CI stack only');
 const path=join(repo,'supabase/tests',`.exp05-planning-native-${randomUUID()}.sql`);
 try{
  writeFileSync(path,sql);
  const result=spawnSync(cli,['test','db',path],{cwd:repo,stdio:'inherit',timeout:120000});
  process.exitCode=result.status===0?0:1;
 }finally{unlinkSync(path);}
}
