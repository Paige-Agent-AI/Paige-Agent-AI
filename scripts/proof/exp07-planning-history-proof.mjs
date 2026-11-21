// Extend only the original disposable E05 proof; never connect to a live project.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {planningHistorySource} from './exp07-planning-history-source.mjs';
export function planningHistoryCompatibilityChecks(repo){
 const candidate=readFileSync(join(repo,'supabase/migrations/20271133000038_exp07_planning_history_social_compatibility.sql'),'utf8').replace(/\r\n/g,'\n');
 const patch=candidate.match(/^DO \$patch\$[\s\S]*?^END \$patch\$;/m)?.[0];
 assert(patch,'Whole original candidate DO body');
 assert.equal(candidate.match(/^BEGIN;$/gm)?.length,1);assert.equal(candidate.match(/^COMMIT;$/gm)?.length,1);
 const {sig,original,current}=planningHistorySource(repo);
 assert(candidate.includes("'f31a93f9774a628bb1c0c24128fd4674','cc46be59b917b6eceb6df323f74b451f'"));
 const mutations=[
  ['unknown source',`EXECUTE replace(pg_get_functiondef('${sig}'::regprocedure),$known$${current}$known$,$unknown$${current}\n-- unknown source$unknown$)`],
  ['executable source drift',`EXECUTE replace(pg_get_functiondef('${sig}'::regprocedure),'RETURN ''{}''::jsonb','RETURN ''{"unknown":true}''::jsonb')`],
  ...[['VOLATILE','volatility'],['SECURITY INVOKER','security'],['SET search_path=public','search path'],['OWNER TO authenticated','owner']]
   .map(([alter,name])=>[name,`EXECUTE 'ALTER FUNCTION ${sig} ${alter}'`]),
  ...['PUBLIC','anon','authenticated','service_role'].map(role=>[role+' EXECUTE',`EXECUTE 'GRANT EXECUTE ON FUNCTION ${sig} TO ${role}'`])
 ];
 assert.equal(mutations.length,10);
 const controls=mutations.map(([name,mutation])=>`DO $negative$
DECLARE refused boolean:=false; before_attempt jsonb;
BEGIN
 BEGIN
  ${mutation};
  SELECT to_jsonb(p) INTO before_attempt FROM pg_proc p WHERE p.oid='${sig}'::regprocedure;
  BEGIN
   EXECUTE $native_patch$${patch}$native_patch$;
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT IN ('EXP07 Planning compatibility metadata drift','EXP07 Planning compatibility source drift') THEN RAISE; END IF;
   refused:=true;
  END;
  IF NOT refused OR before_attempt IS DISTINCT FROM (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid='${sig}'::regprocedure) THEN
   RAISE EXCEPTION 'EXP07 negative did not refuse without change: ${name}'; END IF;
  RAISE EXCEPTION USING ERRCODE='Z0701',MESSAGE='rollback only this controlled mutation';
 EXCEPTION WHEN SQLSTATE 'Z0701' THEN NULL;
 END;
END $negative$;
SELECT pg_temp.check((SELECT p.prosrc=$exact$${current}$exact$ FROM pg_proc p WHERE p.oid='${sig}'::regprocedure),
 'EXP07 forward refuses ${name} and restores the exact compatible preimage');`).join('\n');
 return `CREATE TEMP TABLE exp07_history_before AS SELECT oid,to_jsonb(p) metadata FROM pg_proc p WHERE pronamespace='public'::regnamespace;
SELECT pg_temp.check((SELECT prosrc=$original_history$${original}$original_history$ FROM pg_proc WHERE oid='${sig}'::regprocedure),
 'EXP07 preparation begins at the complete original private history source');
${candidate}
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM exp07_history_before b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND
 (b.metadata-'prosrc' IS DISTINCT FROM to_jsonb(p)-'prosrc' OR
  b.metadata->>'prosrc' IS DISTINCT FROM p.prosrc AND p.oid<>'${sig}'::regprocedure)),
 'EXP07 forward preserves whole OIDs/ABI/authority/ACL/settings and every outside source');
SELECT pg_temp.check((SELECT md5(prosrc)='cc46be59b917b6eceb6df323f74b451f' FROM pg_proc WHERE oid='${sig}'::regprocedure),
 'EXP07 exact private compatibility source installed before immutable Social34');
CREATE TEMP TABLE exp07_history_installed AS SELECT oid,to_jsonb(p) metadata FROM pg_proc p WHERE pronamespace='public'::regnamespace;
${candidate}
${controls}
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM exp07_history_installed b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.metadata IS DISTINCT FROM to_jsonb(p)),
 'EXP07 exact replay and all ten refused source/metadata/ACL mutations conserve the whole public function catalog');
`;
}

export function provePlanningScopeHistory(psql,connection,context){
 assert.equal(connection[connection.indexOf('-d')+1],'exp08_team_hub_a2b_proof');
 assert(['127.0.0.1','localhost'].includes(connection[connection.indexOf('-h')+1]));
 const sql=q=>execFileSync(psql,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1',...connection],
  {input:q,encoding:'utf8',windowsHide:true,timeout:15000}).trim();
 const json=q=>JSON.parse(sql(q).split(/\r?\n/).find(s=>s.startsWith('{')||s.startsWith('[')));
 const sig='public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)';
 const snapshot=json(`SELECT jsonb_build_object('definition',pg_get_functiondef(p.oid),'source',p.prosrc,'metadata',to_jsonb(p))
  FROM pg_proc p WHERE p.oid='${sig}'::regprocedure;`);
 const read=(kind,readOnly)=>json(`BEGIN${readOnly?' READ ONLY':''};SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub','${context.actor}',true);
  SELECT set_config('request.jwt.claim.role','authenticated',true);
  SELECT public.${kind==='history'?`team_hub_list_messages('${context.tenant}','${context.channel}')`:
   `team_hub_search('${context.tenant}','concurrent',20)`};COMMIT;`);
 const results=[];
 // Original concurrency probes leave this synthetic actor demoted. The original
 // history proof also restores this same fixture membership before inspecting it.
 sql(`UPDATE public.tenant_members SET role='admin',status='active' WHERE tenant_id='${context.tenant}' AND user_id='${context.actor}';`);
 try{
  const initial=read('history',true);
  assert.equal(initial.ok,true);
  const ids=initial.messages.filter(r=>r.body?.includes('Original concurrent Planning answer.')).map(r=>r.id);
  assert.equal(ids.length,2,'Two original race answers survive the actual compatibility forward');
  const unknown=snapshot.definition.replace(snapshot.source,()=>snapshot.source+'\n-- unknown scope source');
  assert.notEqual(unknown,snapshot.definition);sql(unknown+';');
  for(const readOnly of [false,true]){
   const hidden=read('history',readOnly);assert.equal(hidden.ok,true);
   const rows=hidden.messages.filter(r=>ids.includes(r.id));assert.equal(rows.length,2);
   assert(rows.every(r=>r.source_unavailable===true&&!r.body.includes('Original concurrent Planning answer.')));
   const search=read('search',readOnly);assert.equal(search.ok,true);
   assert.equal((search.results??[]).filter(r=>ids.includes(r.message_id)).length,0);
   results.push({name:'unknown exact read-scope source masks original history and excludes Search',readOnly,pass:true});
  }
 }finally{
  sql(snapshot.definition+';');
  assert.deepEqual(json(`SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid='${sig}'::regprocedure;`),snapshot.metadata);
 }
 return results;
}
