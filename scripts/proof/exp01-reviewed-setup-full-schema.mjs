// Existing disposable Supabase CI stack only. No remote URL, DDL endpoint,
// migration-ledger edit or new database/project is accepted by this runner.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
for(const args of [
 ['scripts/proof/build-exp01-reviewed-setup-guards.mjs','--check'],
 ['--experimental-strip-types','--test','scripts/proof/exp01-reviewed-setup-contract.test.mjs','scripts/proof/exp01-reviewed-setup-client.test.mjs'],
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
const sql=test.replace('-- EXP01_INSTALL_CANDIDATE',()=>body(source.stdout.replaceAll('\r\n','\n'))+'\n'+candidate)
 .replace('-- EXP01_REPLAY_CANDIDATE',()=>candidate);
assert.equal(sql.split(candidate).length,3,'both candidate inserts are byte-exact, including dollar-quoted SQL');
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
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.port==='54322','only existing CI loopback54322');
  const run=spawnSync('supabase',['test','db',output],{stdio:'inherit',timeout:180000});
  if(run.error)throw run.error;process.exitCode=run.status??1;
 }finally{rmSync(output,{force:true});}
}
