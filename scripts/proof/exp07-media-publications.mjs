import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
// This runner cannot select an arbitrary host/database or use production credentials.
const port=process.env.EXP07_FIXTURE_PORT;
assert.match(port??'',/^\d+$/);assert(Number(port)>=1024&&Number(port)<=65535&&Number(port)!==5432);
const args=['-X','-w','-h','127.0.0.1','-p',port,'-U','postgres','-d','social_presence_connection_readiness_contract','-At','-v','ON_ERROR_STOP=1'];
const run=sql=>spawnSync(process.env.PSQL_BIN??'psql',args,{input:sql,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:1024*1024});
const name=run('select current_database();');assert.equal(name.status,0,name.stderr);assert.equal(name.stdout.trim(),'social_presence_connection_readiness_contract');
const migration=readFileSync('supabase/migrations/20271133000034_exp07_media_snapshot_receipt_compatibility.sql','utf8');
// This fixture covers the original media functions; the original Hub A2b suite applies the FULL carrier.
const mediaSection=migration.split('-- EXP07: closed Social proposal/receipt bindings')[0];
assert.notEqual(mediaSection,migration,'Expected original Hub composition marker');
const candidate=mediaSection.replace(/^BEGIN;\r?\n/m,'').replace(/^COMMIT;\s*$/m,'');
const suite=readFileSync('supabase/tests/exp07_media_publications.sql','utf8');
const parts=suite.split(/-- PROBE: (?:duplicate|privacy|performance)\r?\n/);assert.equal(parts.length,4);
// Real failing-first controls against the unchanged applied native definitions.
for(const [index,reason] of [[1,'MEDIA_REVISION_BLOCKED'],[2,'MEMBER_MEDIA_EXPOSED']]) {
 const baseline=run(`BEGIN;\n${parts[0]}\n${parts[index]}\nROLLBACK;`);
 assert.notEqual(baseline.status,0,`Original source did not expose ${reason}`);assert(baseline.stderr.includes(reason),baseline.stderr);
 console.log(`PASS: original native source fails ${reason} probe`);
}
const contract=suite.match(/CREATE TEMP TABLE media_original_contract AS[\s\S]*?::regprocedure\);/)[0];
const result=run(`BEGIN;\n${contract}\n${candidate}\n${candidate}\n${suite.replace(contract,'')}\nROLLBACK;`);
assert.equal(result.status,0,result.stderr);
console.log(result.stderr.split('\n').filter(x=>/NOTICE:.*PASS:/.test(x)).join('\n'));
console.log('PASS: candidate replay and native media/receipt behavior in rollback-only synthetic transaction');
const guard=candidate.match(/DO \$guard\$[\s\S]*?\$guard\$;/)?.[0];assert(guard);
const original=run("select pg_get_functiondef('public.content_publication_bind(uuid,uuid,uuid,text,uuid,uuid,jsonb)'::regprocedure);").stdout.trim();
const changed=original.replace("'content-publication:'","'changed-publication:'");assert.notEqual(changed,original);
for(const [label,mutation] of [
 ['source',changed.endsWith(';')?changed:changed+';'],
 ['reader ACL','GRANT EXECUTE ON FUNCTION public.content_publication_list(uuid,uuid) TO anon;'],
 ['writer ACL','GRANT EXECUTE ON FUNCTION public.content_publication_bind(uuid,uuid,uuid,text,uuid,uuid,jsonb) TO authenticated;'],
 ['search path',"ALTER FUNCTION public.content_publication_list(uuid,uuid) SET search_path TO '';"],
 ['security mode','ALTER FUNCTION public.content_publication_record(uuid,uuid,text,text,text,text,text,jsonb) SECURITY INVOKER;'],
]) {
 const negative=run(`BEGIN;\n${mutation}\n${guard}\nROLLBACK;`);
 assert.notEqual(negative.status,0);assert(negative.stderr.includes('EXP07_PUBLICATION_SOURCE_CHANGED'),negative.stderr);
 console.log(`PASS: actual migration guard refuses ${label} drift and rolls back`);
}
