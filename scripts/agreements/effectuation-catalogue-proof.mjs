import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {basename} from 'node:path';

// Reuse the caller's directory-checked, unique disposable database. Load only
// actual catalogue bodies/renames/ACLs, never unrelated migration effects.
export function proveEffectuationCatalogue({sql,read,scope,tenant,migration}){
 let checks=0;
 const functionBody=source=>{
  const start=source.search(/CREATE OR REPLACE FUNCTION public\.list_tool_autonomy\(/i);
  const end=source.indexOf('$$;',start);assert(start>=0&&end>start);
  return source.slice(start,end+3);
 };
 const base='20270546000000_studio_content_workspace_authority.sql';
 sql(functionBody(read('supabase/migrations/'+base)));
 const predecessors=readdirSync(new URL('../../supabase/migrations/',import.meta.url))
  .filter(name=>name>base&&name<basename(migration)&&name.endsWith('.sql')).sort();
 let wrappers=0;
 for(const name of predecessors){
  const source=read('supabase/migrations/'+name);
  if(!/CREATE OR REPLACE FUNCTION public\.list_tool_autonomy\(/i.test(source))continue;
  const rename=source.match(/DO\s+\$\$\s*BEGIN\s*IF to_regprocedure\('public\.(_list_tool_autonomy\w*)\(uuid\)'\) IS NULL THEN\s*ALTER FUNCTION public\.list_tool_autonomy\(uuid\) RENAME TO \1;\s*END IF;\s*END \$\$;/i);
  assert(rename,`Actual catalogue predecessor rename missing: ${name}`);
  const acls=[...source.matchAll(/^[\t ]*(?:REVOKE|GRANT)[^;]*FUNCTION public\.(?:list|_list)_tool_autonomy[^;]*;/gmi)].map(match=>match[0]);
  sql(rename[0]+functionBody(source)+acls.join('\n'));wrappers++;
 }
 assert(wrappers>=15,'Load every existing catalogue wrapper, not an abbreviated fixture');checks++;
 const key='sales_effectuate_commercial_terms';
 const rows=(suffix='')=>`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY tool_key),'[]') FROM public.list_tool_autonomy('${tenant}') t ${suffix};`;
 const before=sql(scope+'SET ROLE authenticated;'+rows());
 assert(!JSON.parse(before).some(row=>row.tool_key===key));checks++;
 const original=sql("SELECT pg_get_functiondef('public.list_tool_autonomy(uuid)'::regprocedure);");
 sql(read(migration));sql(read(migration));
 assert.equal(sql("SELECT pg_get_functiondef('public._list_tool_autonomy_before_e04_effectuation(uuid)'::regprocedure);"),original.replace('public.list_tool_autonomy(','public._list_tool_autonomy_before_e04_effectuation('));checks++;
 assert.equal(sql(scope+'SET ROLE authenticated;'+rows(`WHERE tool_key<>'${key}'`)),before);checks++;
 assert.equal(JSON.parse(sql(scope+'SET ROLE authenticated;'+rows())).length,JSON.parse(before).length+1);checks++;
 const row=JSON.parse(sql(scope+'SET ROLE authenticated;'+rows(`WHERE tool_key='${key}'`)))[0];
 assert.deepEqual(row,{tool_key:key,label:'Make signed commercial terms effective',category:'Payments',mode:'confirm',is_default:true,updated_at:null});checks++;
 sql(`INSERT INTO tenant_tool_autonomy VALUES('${tenant}','${key}','off','2026-10-15T00:00:00Z');`);
 const saved=JSON.parse(sql(scope+'SET ROLE authenticated;'+rows(`WHERE tool_key='${key}'`)))[0];
 assert.equal(saved.mode,'off');checks++;assert.equal(saved.is_default,false);checks++;
 assert.equal(Date.parse(saved.updated_at),Date.parse('2026-10-15T00:00:00Z'));checks++;
 assert.equal(sql("SET test.uid='';SET ROLE service_role;"+rows()),sql(scope+'SET ROLE authenticated;'+rows()));checks++;
 const other='bbbbbbbb-0000-4000-8000-000000000002';
 assert.throws(()=>sql(scope+`SET ROLE authenticated;SELECT * FROM public.list_tool_autonomy('${other}');`),/42501.*AUTONOMY_FORBIDDEN/);checks++;
 assert.equal(sql(scope+`SET test.owner='true';SET ROLE authenticated;SELECT mode FROM public.list_tool_autonomy('${other}') WHERE tool_key='${key}';`),'confirm');checks++;
 assert.equal(sql(scope+`SET ROLE authenticated;SELECT mode FROM public.list_tool_autonomy() WHERE tool_key='${key}';`),'off');checks++;
 assert.throws(()=>sql(`SET ROLE anon;SELECT * FROM public.list_tool_autonomy('${tenant}');`),/42501/);checks++;
 for(const role of ['anon','authenticated','service_role']){
  assert.throws(()=>sql(scope+`SET ROLE ${role};SELECT * FROM public._list_tool_autonomy_before_e04_effectuation('${tenant}');`),/42501/);checks++;
  assert.equal(sql(`SELECT has_function_privilege('${role}','public._list_tool_autonomy_before_e04_effectuation(uuid)','EXECUTE');`),'f');checks++;
 }
 assert.equal(sql("SELECT NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid IN('public.list_tool_autonomy(uuid)'::regprocedure,'public._list_tool_autonomy_before_e04_effectuation(uuid)'::regprocedure) AND a.grantee=0 AND a.privilege_type='EXECUTE');"),'t');checks++;
 return {checks,predecessorWrappers:wrappers,incumbentRows:JSON.parse(before).length,migrationReplay:2};
}
