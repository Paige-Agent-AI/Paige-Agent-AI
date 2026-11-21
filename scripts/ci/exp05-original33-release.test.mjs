import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGINAL33, permitsOriginal33, validateVersions, validateDryRun, validateCatalog } from './exp05-original33-release.mjs';

const file=ORIGINAL33.file;
test('owner exception admits only the exact immutable33 addition below36',()=>{
 const good={file,baseNewest:ORIGINAL33.frontier,addedFiles:[file],sha256:ORIGINAL33.sha256};
 assert.equal(permitsOriginal33(good),true);
 for(const delta of [{file:file.replace('atomic','other')},{baseNewest:'20271133000037'},
  {addedFiles:[file,'supabase/migrations/20271133000034_other.sql']},{sha256:'0'.repeat(64)}])
  assert.equal(permitsOriginal33({...good,...delta}),false);
});
const remote=['20271133000028','20271133000030','20271133000036'];
const local=[...remote,ORIGINAL33.version];
test('complete canonical ledger sets must show only33 missing, then exactly caught up',()=>{
 assert.equal(validateVersions(local,remote,'before').missing[0],ORIGINAL33.version);
 assert.equal(validateVersions(local,local,'after').missing.length,0);
 for(const [l,r,phase] of [[local,remote,'after'],[local,local,'before'],
  [[...local,'20271133000034'],remote,'before'],[local,[...remote,'20271133000037'],'before'],
  [local,remote.slice(1),'before'],[[...local,ORIGINAL33.version],remote,'before'],[[],[],'before']])
  assert.throws(()=>validateVersions(l,r,phase));
});
test('official dry-run must name only the exact original33 file',()=>{
 assert.equal(validateDryRun(`Would push these migrations:\n • ${file.split('/').at(-1)}\n`),true);
 const name=file.split('/').at(-1);
 for(const text of ['', 'Linked project is up to date.', file+'\n20271133000034_other.sql',file.replace('atomic','other'),
  `DRY RUN: unable to determine proposed migrations. Diagnostic source: ${name}`,
  `DRY RUN: no migrations will be applied. Previously considered: ${name}`,
  `Would push these migrations:\n • ${name}\n • 20271133000034_other.sql\n`,
  `Would push these migrations:\n • ${name}\nWould seed these files:\n`,
  `Would push these migrations:\n • ${name}\nWould push these migrations:\n • ${name}\n`])
  assert.throws(()=>validateDryRun(text));
});
test('catalog pre/post requires absent then exact four functions and unchanged original records',()=>{
 const before={frontier:ORIGINAL33.frontier,count33:0,name33:null,statements33:null,functions:[],dependencies:ORIGINAL33.dependencies,ledger_without33:ORIGINAL33.ledger};
 const after={...before,count33:1,name33:'exp05_atomic_automation_draft',statements33:ORIGINAL33.statements,functions:ORIGINAL33.functions};
 assert.equal(validateCatalog(before,null,'before'),true);
 assert.equal(validateCatalog(after,before,'after'),true);
 for(const delta of [{count33:0},{name33:'other'},{statements33:'changed'},{functions:[]},{functions:[...ORIGINAL33.functions,'extra']},
  {dependencies:'changed'},{ledger_without33:'changed'},{frontier:'20271133000037'}])
  assert.throws(()=>validateCatalog({...after,...delta},before,'after'));
 assert.throws(()=>validateCatalog({...before,functions:ORIGINAL33.functions},null,'before'));
});
