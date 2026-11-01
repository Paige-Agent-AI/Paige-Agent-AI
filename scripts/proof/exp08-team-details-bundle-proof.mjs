// Original component ports only: atomic native-source composition, NOT Auth/RLS/customer proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
import {buildTeamDetailsBundle} from './exp08-team-details-bundle.mjs';
assert.equal(process.env.EXP08_DISPOSABLE,'1');
assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST));
const port=Number(process.env.PGPORT);assert(Number.isSafeInteger(port)&&port!==5432);
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const source=read('../../supabase/migrations/20260901001520_solo_team_workspace.sql');
function original(text,name){const a=text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=text.indexOf('$function$;',a);assert(a>=0&&b>a);return text.slice(a,b+11);}
const profile='public.set_solo_team_member_work_profile(uuid,text,text)',permission='public.set_solo_team_member_permission(uuid,text)';
const profileScoped='public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)',permissionScoped='public.set_solo_team_member_permission(uuid,text,uuid,uuid)';
const db=new OperatorPostgresFixture(port),bundle=buildTeamDetailsBundle(),cases=[];
const scalar=q=>db.run(q).split('\n').at(-1);
const attempt=q=>{const r=spawnSync(db.psql,db.args(),{input:q,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});assert.ifError(r.error);return r;};
const catalog=()=>scalar(`SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission')`);
const state=()=>scalar(`SELECT jsonb_build_object('members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tenant_members m),'owners',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.tenant_business_owners b),'audit',(SELECT jsonb_agg(to_jsonb(a)) FROM public.audit_logs a))::text`);
const meta=sig=>scalar(`SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE p.oid='${sig}'::regprocedure`);
const exists=sig=>scalar(`SELECT to_regprocedure('${sig}') IS NOT NULL`)==='t';
function denied(q,pattern){const before=catalog(),data=state(),r=attempt(q);assert.equal(r.status,3,r.stderr);assert.match(r.stderr,pattern);assert.equal(catalog(),before,'Failed atomic install must preserve the complete original catalog');assert.equal(state(),data,'Failed atomic install must preserve all rows');}
function resetBase(){db.run(`DROP FUNCTION IF EXISTS ${profileScoped};DROP FUNCTION IF EXISTS ${permissionScoped};${original(source,'set_solo_team_member_work_profile')};${original(source,'set_solo_team_member_permission')};REVOKE ALL ON FUNCTION ${profile},${permission} FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION ${profile},${permission} TO authenticated;`);}
try{
 db.run(read('../../supabase/tests/exp08_entity_owner_seat_ended.sql'));
 db.run(read('../../supabase/tests/exp08_owner_work_profile.sql'));
 db.run(original(read('../../supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql'),'is_tenant_owner'));
 db.run(original(read('../../supabase/migrations/20271116020008_exp08_co_owner_authority.sql'),'is_tenant_account_holder'));
 resetBase();db.run('SELECT proof.reset_rows();');
 const data=state(),profileMetadata=meta(profile),permissionMetadata=meta(permission);
 // Causal counterfactual: separate autocommit components leave the first installed.
 db.run(`ALTER FUNCTION ${permission} STRICT;`);
 db.run(read('./exp08-owner-work-profile-patch.sql'));
 const failed=attempt(read('./exp08-team-permission-patch.sql'));
 assert.equal(failed.status,3);assert.match(failed.stderr,/permission original metadata drift/);assert(exists(profileScoped));assert(!exists(permissionScoped));
 cases.push('counterfactual separate statements leave partial profile installation after permission metadata refusal');
 db.run(`ALTER FUNCTION ${permission} CALLED ON NULL INPUT;`);resetBase();
 db.run(`ALTER FUNCTION ${permission} STRICT;`);
 denied(bundle.sql,/permission original metadata drift/);
 assert(!exists(profileScoped)&&!exists(permissionScoped));
 assert.equal(scalar(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${profile}'::regprocedure`),'1d99e171c55d259c18961068a7829fea');
 cases.push('same late permission metadata refusal atomically rolls back the already-executed profile component');
 db.run(`ALTER FUNCTION ${permission} CALLED ON NULL INPUT;`);
 db.run(`GRANT EXECUTE ON FUNCTION ${permission} TO anon;`);denied(bundle.sql,/permission original metadata drift/);db.run(`REVOKE EXECUTE ON FUNCTION ${permission} FROM anon;`);
 cases.push('late original permission ACL drift leaves every catalog object and row unchanged');
 db.run(bundle.sql);assert(exists(profileScoped)&&exists(permissionScoped));assert.equal(meta(profile),profileMetadata);assert.equal(meta(permission),permissionMetadata);assert.equal(state(),data);
 cases.push('atomic first install preserves both original ABIs and nonbody metadata and makes no data changes');
 const installed=catalog();db.run(bundle.sql);assert.equal(catalog(),installed);assert.equal(state(),data);
 cases.push('whole atomic bundle replay is catalog-and-data exact');
 const scopedDefinition=scalar(`SELECT to_json(pg_get_functiondef('${permissionScoped}'::regprocedure))`);
 db.run(`DROP FUNCTION ${permissionScoped};`);denied(bundle.sql,/partial installation/);
 cases.push('partial scoped installation refuses instead of normalizing surviving source');
 db.run(JSON.parse(scopedDefinition)+`;REVOKE ALL ON FUNCTION ${permissionScoped} FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION ${permissionScoped} TO authenticated;`);
 for(const sig of [profileScoped,permissionScoped]){
  db.run(`GRANT EXECUTE ON FUNCTION ${sig} TO anon;`);denied(bundle.sql,/original door drift/);db.run(`REVOKE EXECUTE ON FUNCTION ${sig} FROM anon;`);
  cases.push('complete replay refuses scoped ACL drift for '+sig);
 }
 const repairedOriginal=scalar(`SELECT to_json(pg_get_functiondef('${profile}'::regprocedure))`);
 db.run(original(source,'set_solo_team_member_work_profile'));
 denied(bundle.sql,/partial installation/);db.run(JSON.parse(repairedOriginal));
 cases.push('restored legacy base with surviving scoped APIs is partial and cannot silently normalize');
 db.run(bundle.sql);assert.equal(state(),data);
 for(const sig of [profileScoped,permissionScoped])for(const role of ['anon','service_role'])assert.equal(scalar(`SELECT has_function_privilege('${role}','${sig}','EXECUTE')`),'f');
 cases.push('both scoped doors remain authenticated-only with no anon/service execution');
 console.log(JSON.stringify({scope:'ported disposable PostgreSQL component proof only; no managed/native full-schema/Auth/customer result',bundleSha256:bundle.sha256,cases,passed:cases.length},null,2));
} finally {
 db.run(`DROP DATABASE ${db.database};`,[],'postgres');
 console.log('Disposed only this original proof database '+db.database);
}
