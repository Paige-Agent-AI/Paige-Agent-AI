// Existing disposable Supabase CI stack only. No remote URL, DDL endpoint,
// migration-ledger edit or new database/project is accepted by this runner.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
for(const args of [
 ['scripts/proof/build-exp01-reviewed-setup-guards.mjs','--check'],
 ['scripts/proof/build-exp01-chat-knowledge-guards.mjs','--check'],
 ['--experimental-strip-types','--test','scripts/proof/exp01-reviewed-setup-contract.test.mjs','scripts/proof/exp01-reviewed-setup-client.test.mjs'],
 ['--experimental-strip-types','--test','scripts/proof/exp01-chat-knowledge-client.test.mjs'],
]) {
 const run=spawnSync(process.execPath,args,{stdio:'inherit',timeout:30000});
 if(run.status!==0)throw Error('Original EXP01 receipt preparation proof failed');
}
const originalSourceRef='7955df03da6873286f290d4148c1f0fcda77c91e';
const sourcePath='supabase/migrations/20271126210013_knowledge_source_writer_validation.sql';
const read=p=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
function body(sql){
 const begin=/^BEGIN;\s*$/gmi,end=/^COMMIT;\s*$/gmi;
 assert.equal([...sql.matchAll(begin)].length,1,'one original outer BEGIN');
 assert.equal([...sql.matchAll(end)].length,1,'one original outer COMMIT');
 assert.ok(sql.search(begin)<sql.search(end),'original transaction order');
 return sql.replace(begin,'-- Original outer BEGIN supplied by rollback-only proof').replace(end,'-- Original COMMIT suppressed inside rollback-only proof');
}
// A shallow Actions checkout does not contain this original unmerged source.
// Fetch only its immutable object; never choose a moving branch or apply it.
if(spawnSync('git',['cat-file','-e',`${originalSourceRef}^{commit}`],{stdio:'ignore'}).status!==0){
 const fetch=spawnSync('git',['fetch','--no-tags','--depth=1','origin',originalSourceRef],{encoding:'utf8',timeout:60000});
 if(fetch.status!==0)throw Error('Pinned original E13 source fetch failed; no substitution');
}
const source=spawnSync('git',['show',`${originalSourceRef}:${sourcePath}`],{encoding:'utf8',maxBuffer:1024*1024});
if(source.status!==0)throw Error('Pinned original E13 source object unavailable; do not substitute a helper or bypass the dependency guard');
const candidate=body(read('scripts/proof/exp01-reviewed-setup-candidate.sql'));
const test=read('supabase/tests/exp01_reviewed_setup_receipt.sql');
assert.equal(test.split('-- EXP01_INSTALL_CANDIDATE').length,2);
assert.equal(test.split('-- EXP01_REPLAY_CANDIDATE').length,2);
const receiptSql=test.replace('-- EXP01_INSTALL_CANDIDATE',()=>body(source.stdout.replaceAll('\r\n','\n'))+'\n'+candidate)
 .replace('-- EXP01_REPLAY_CANDIDATE',()=>candidate);
assert.equal(receiptSql.split(candidate).length,3,'both candidate inserts are byte-exact, including dollar-quoted SQL');
const hostCandidateSource=read('scripts/proof/exp01-chat-knowledge-candidate.sql');
const hostCarrierSource=read('supabase/migrations/20271127040001_exp01_chat_knowledge_links.sql');
assert.equal(hostCarrierSource.slice(hostCarrierSource.indexOf('\n')),hostCandidateSource.slice(hostCandidateSource.indexOf('\n')),
 'released carrier is byte-exact original Chat candidate after its first descriptive comment');
const hostAclSource=read('supabase/migrations/20271127040002_exp01_chat_knowledge_explicit_acl.sql');
const hostGuard=hostCandidateSource.split('-- E01_CHAT_INSTALL_GUARD_BEGIN\n')[1].split('-- E01_CHAT_INSTALL_GUARD_END')[0];
const explicitSignatures=[
 'stage_paige_chat_knowledge_intake(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer)',
 'save_paige_chat_knowledge_link(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer)',
 'list_paige_chat_knowledge_links(uuid,uuid,uuid,uuid,integer)',
];
assert.equal(hostAclSource,'-- Reassert original restricted ACLs per signature; preserve applied27040001 unchanged.\nBEGIN;\n'+hostGuard+
 explicitSignatures.map(s=>'REVOKE ALL ON FUNCTION public.'+s+' FROM PUBLIC,anon,authenticated,service_role;\nGRANT EXECUTE ON FUNCTION public.'+s+' TO authenticated;\n').join('')+'COMMIT;\n',
 'forward only reasserts exact original restricted ACLs behind the unchanged eight-function guard');
const hostCandidate=body(hostCandidateSource)+'\n'+body(hostAclSource);
const hostTest=read('supabase/tests/exp01_chat_knowledge_link.sql');
assert.equal(hostTest.split('-- EXP01_CHAT_INSTALL_CANDIDATE').length,2);
assert.equal(hostTest.split('-- EXP01_CHAT_REPLAY_CANDIDATE').length,2);
const hostSql=hostTest.replace('-- EXP01_CHAT_INSTALL_CANDIDATE',()=>hostCandidate)
 .replace('-- EXP01_CHAT_REPLAY_CANDIDATE',()=>hostCandidate);
assert.equal(hostSql.split(hostCandidate).length,3,'host native bodies are byte-exact on installation and replay');
// Exercise scoped Admin positives BEFORE the original unchanged revocation.
// Rollback-only host negatives restore their savepoint, never reinstate a seat.
const hostInsertion="UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='e0100200-0000-4000-8000-000000000001' AND user_id='e0100100-0000-4000-8000-000000000002';";
assert.equal(receiptSql.split(hostInsertion).length,2);
const sql=receiptSql.replace(hostInsertion,()=>hostSql+'\n'+hostInsertion);
assert.equal(sql.replace(hostSql+'\n',''),receiptSql,'all original receipt assertions and order are unchanged');
assert.match(sql,/^BEGIN;/m);assert.match(sql,/ROLLBACK;\s*$/);
mkdirSync('.cache',{recursive:true});const output='.cache/exp01-reviewed-setup-full-schema.sql';
writeFileSync(output,sql);
if(process.argv.includes('--emit-only')){
 console.log(JSON.stringify({result:'COMPOSED_ONLY',output,originalSourceRef,bytes:Buffer.byteLength(sql),runtime:'UNVERIFIED'}));
}else{
 try{
  const status=spawnSync('supabase',['status','--output','json'],{encoding:'utf8',timeout:30000});
  if(status.status!==0)throw Error('Existing local Supabase stack unavailable; no remote fallback');
  const config=JSON.parse(status.stdout);const url=new URL(config.DB_URL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.port==='54322'
   &&url.username==='postgres'&&url.pathname==='/postgres','only existing CI loopback54322/postgres');
  const causal=spawnSync(process.execPath,['scripts/proof/exp01-reviewed-setup-postgres.mjs','54322'],{
   stdio:'inherit',timeout:60000,env:{...process.env,EXP01_SOURCE_VALIDATOR_REF:originalSourceRef,
    PGPASSWORD:decodeURIComponent(url.password)},
  });
  if(causal.error)throw causal.error;
  if(causal.status!==0)throw Error('Original EXP01 disposable concurrency/authority proof failed');
  const psql=process.env.OPERATOR_PROOF_PSQL||'psql';
  const localEnv={...process.env,PGPASSWORD:decodeURIComponent(url.password)};
  const directory=spawnSync(psql,['-X','-h',url.hostname,'-p',url.port,'-U','postgres','-d','postgres','-Atc','SHOW data_directory'],{
   encoding:'utf8',timeout:10000,env:localEnv,
  });
  if(directory.status!==0||!directory.stdout.trim())throw Error('Original local host-proof database identity unavailable');
  const hostNative=spawnSync(process.platform==='win32'?'python':'python3',[
   'scripts/proof/exp01-chat-knowledge-postgres.py','--psql',psql,'--port',url.port,'--expected-data-directory',directory.stdout.trim(),
  ],{stdio:'inherit',timeout:120000,env:localEnv});
  if(hostNative.error)throw hostNative.error;
  if(hostNative.status!==0)throw Error('Original Chat Knowledge host authority/concurrency proof failed');
  const run=spawnSync('supabase',['test','db',output],{stdio:'inherit',timeout:180000});
  if(run.error)throw run.error;process.exitCode=run.status??1;
 }finally{rmSync(output,{force:true});}
}
