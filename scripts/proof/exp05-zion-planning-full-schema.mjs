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
assert.equal(carrier.slice(carrier.indexOf('-- INERT SOURCE CANDIDATE,')),candidate,
 'The forward migration must retain the complete original native candidate exercised by this proof');
assert.equal(historyCarrier.slice(historyCarrier.indexOf('-- Original EXP05 Planning history correction.')),history,
 'The history forward carrier must retain the complete source exercised by this proof');
assert.equal(linkCarrier.slice(linkCarrier.indexOf('-- Forward-only presentation correction;')),linkCap,
 'The link-cap forward carrier must retain the complete source exercised by this proof');
const unwrap=source=>{
 assert.equal(source.match(/^BEGIN;$/gm)?.length,1,'Exactly one candidate transaction');
 assert.equal(source.match(/^COMMIT;$/gm)?.length,1,'Exactly one candidate commit');
 return source.replace(/^BEGIN;\n/m,'').replace(/\nCOMMIT;\s*$/,'\n');
};
unwrap(candidate);unwrap(history);
const body=unwrap(linkCap);
const originalLinks=linkCap.split('$original$')[1],boundedLinks=linkCap.split('$bounded$')[1];
assert(originalLinks&&boundedLinks,'Complete inverse hunks present');
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
const sql=`BEGIN;
SELECT plan(12);
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
CREATE TEMP TABLE e5_installed AS SELECT oid,to_jsonb(p) full_metadata FROM pg_proc p WHERE pronamespace='public'::regnamespace;
${body}
SELECT ok(NOT EXISTS(SELECT 1 FROM e5_installed b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.full_metadata IS DISTINCT FROM to_jsonb(p)),
 'Replay preserves every function, source and full installed metadata');
SELECT * FROM finish();
ROLLBACK;
`;
if(process.argv.includes('--self-test')){
 assert(sql.startsWith('BEGIN;\nSELECT plan(12);'));assert(sql.endsWith('ROLLBACK;\n'));
 assert.equal((sql.match(/^BEGIN;$/gm)??[]).length,1);assert.equal((sql.match(/^COMMIT;$/gm)??[]).length,0);
 assert.equal(sql.split(body).length,3,'Exact candidate bytes embedded twice without transaction wrappers');
 assert(!/INSERT INTO (public|auth)\./i.test(sql));
 console.log('PASS: all three exact carriers verified; latest forward twice inside one rollback-only test;12 assertions; no business fixture/ledger');
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
