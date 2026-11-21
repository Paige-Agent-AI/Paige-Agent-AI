// One owner-approved historical migration, not a generic ordering exemption/applier.
// ANT-11/1e7965f7: November21 direct approval; ordinary newer-only policy is intact.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGINAL33=Object.freeze({
 version:'20271133000033', frontier:'20271133000036', project:'xygzykjyynhzqytbqnzu',
 file:'supabase/migrations/20271133000033_exp05_atomic_automation_draft.sql',
 sha256:'c18ed1b82477ed7bef81e755ddf4eb9ece9a15d825ba430cc59384514a7bb3c3',
 dependencies:'395adbfee90337c45e279a3eb7503bc5',
 ledger:'4f0248c7d667610b9a318d1509f0e668', statements:'213989b7436bd934ad6ad2abbbd6727f',
 functions:Object.freeze([
  'private.automation_draft_args(jsonb):d4248759056bc832f70146d19594fa06',
  'private.automation_draft_scope(uuid):bc80f25f1f2e0cfd8a19b18e47b76259',
  'public.read_automation_draft(uuid,uuid,jsonb):a20956dc0e58313b6065615f16729e0e',
  'public.save_automation_draft(uuid,uuid,jsonb):844de63ea8a9a606ef4a7406c66d2b86',
 ]),
});

export function permitsOriginal33({file,baseNewest,addedFiles,sha256}){
 return file===ORIGINAL33.file && baseNewest===ORIGINAL33.frontier
  && addedFiles.length===1 && addedFiles[0]===file && sha256===ORIGINAL33.sha256;
}

export function validateVersions(local,remote,phase){
 assert(['before','after'].includes(phase),'Known release phase required');
 for(const values of [local,remote]){
  assert(values.length>0 && values.every(v=>/^\d{14}$/.test(v)),'Complete nonempty version set required');
  assert.equal(new Set(values).size,values.length,'Duplicate version refused');
  assert.equal([...values].sort().at(-1),ORIGINAL33.frontier,'Original36 frontier required');
  for(const v of ['20271133000028','20271133000030',ORIGINAL33.frontier]) assert(values.includes(v),'Prerequisite absent');
 }
 assert(local.includes(ORIGINAL33.version),'Original33 must exist in the candidate');
 const missing=local.filter(v=>!remote.includes(v));
 assert.deepEqual(remote.filter(v=>!local.includes(v)),[],'Foreign remote migration refused');
 assert.deepEqual(missing,phase==='before'?[ORIGINAL33.version]:[],'Only original33 may be pending');
 return {phase,local:local.length,remote:remote.length,missing};
}

export function validateDryRun(text){
 // Pinned official2.116 legacy-db-push-core/confirmPushAll emits this exact section.
 const clean=text.replace(/\u001b\[[0-9;]*m/g,'').replace(/\r\n/g,'\n');
 const header='Would push these migrations:\n';
 assert.equal(clean.split(header).length,2,'Exactly one official proposed-migration section required');
 const section=clean.split(header)[1].match(/^(?: • [^\n]+\n)+/)?.[0];
 assert.equal(section,` • ${ORIGINAL33.file.split('/').at(-1)}\n`,'The proposed section must contain ONLY original33');
 assert(!/Would (?:seed|create custom roles)|unable|failed|no migrations will be applied/i.test(clean),'Ambiguous/no-op or additional effects refused');
 const files=[...new Set(clean.match(/\b\d{14}_[a-z0-9_]+\.sql\b/g)??[])];
 assert.deepEqual(files,[ORIGINAL33.file.split('/').at(-1)],'No additional migration names allowed');
 return true;
}

export function validateCatalog(value,before,phase){
 assert(['before','after'].includes(phase),'Known catalog phase required');
 assert.equal(value.frontier,ORIGINAL33.frontier,'Production frontier changed');
 assert.equal(value.dependencies,ORIGINAL33.dependencies,'Original schema/authority/Rail contract changed');
 assert.equal(value.ledger_without33,ORIGINAL33.ledger,'Preexisting migration ledger changed');
 assert.equal(value.count33,phase==='before'?0:1,'Original33 ledger identity is not exact');
 assert.deepEqual(value.functions,phase==='before'?[]:ORIGINAL33.functions,'Four original function bodies/ABI/ACLs must match');
 if(phase==='before'){
  assert.equal(value.name33,null); assert.equal(value.statements33,null);
 }else{
  assert.equal(value.name33,'exp05_atomic_automation_draft');
  assert.equal(value.statements33,ORIGINAL33.statements,'Applied statement transcript changed');
  assert(before,'Original before-catalog is required');
  assert.equal(value.dependencies,before.dependencies);
  assert.equal(value.ledger_without33,before.ledger_without33);
 }
 return true;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,phase,path,beforePath]=process.argv.slice(2);
 const sha256=createHash('sha256').update(readFileSync(ORIGINAL33.file)).digest('hex');
 assert.equal(sha256,ORIGINAL33.sha256,'Immutable33 changed');
 if(mode==='ledger'){
  // Reuse the incumbent canonical Remote-header/JSON parser; no second ledger parser.
  const remote=execFileSync(process.execPath,['scripts/ci/reproduce-production-grants.mjs','--parse-ledger',path],{encoding:'utf8'}).trim().split(/\r?\n/);
  const local=execFileSync('git',['ls-files','supabase/migrations/'],{encoding:'utf8'}).trim().split(/\r?\n/)
   .map(p=>/\/(\d{14})_[^/]+\.sql$/.exec(p)?.[1]).filter(Boolean);
  console.log(JSON.stringify(validateVersions(local,remote,phase)));
 }else if(mode==='dry-run'){
  validateDryRun(readFileSync(phase,'utf8')); console.log('PASS: dry-run proposes only original33');
 }else if(mode==='catalog'){
  validateCatalog(JSON.parse(readFileSync(path,'utf8')),beforePath?JSON.parse(readFileSync(beforePath,'utf8')):null,phase);
  console.log(`PASS: ${phase} original33 catalog`);
 }else throw new Error('Known read-only original33 validation mode required');
}
