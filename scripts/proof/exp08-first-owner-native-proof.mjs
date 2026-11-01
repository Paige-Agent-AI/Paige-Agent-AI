// Deterministic packaging of the original inert I2 patches for Supabase's native test runner.
// This tool never connects to a database or creates a migration. Source scripts stay canonical.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const templateURL=new URL('./exp08-first-owner-native.template.sql',import.meta.url);
const outputURL=new URL('../../supabase/tests/exp08_first_owner_history_native.sql',import.meta.url);
const read=url=>readFileSync(url,'utf8').replace(/\r\n/g,'\n');
export function compileFirstOwnerNativeProof(template=read(templateURL),readSource=name=>read(new URL('./'+name,import.meta.url))) {
 const used=[];
 const expanded=template.replace(/^\\ir \.\.\/\.\.\/scripts\/proof\/(exp08-first-owner-(?:history|invitation)-patch\.sql)$/gm,(_line,name)=>{
  const source=readSource(name);assert.ok(source.trim(),name);
  assert.doesNotMatch(source,/^(?:BEGIN|COMMIT|ROLLBACK);$/m,'A component must not end the native test transaction');
  used.push(name);return `-- ORIGINAL INERT COMPONENT ${name} canonical-LF SHA256 ${createHash('sha256').update(source).digest('hex')}\n${source}\n-- END ORIGINAL INERT COMPONENT ${name}`;
 });
 assert.deepEqual(used,['exp08-first-owner-history-patch.sql','exp08-first-owner-invitation-patch.sql','exp08-first-owner-history-patch.sql','exp08-first-owner-invitation-patch.sql']);
 assert.doesNotMatch(expanded,/^\\(?:i|ir)\s/m,'Native proof must not depend on an unmounted host file');
 assert.equal([...expanded.matchAll(/^BEGIN;$/gm)].length,1);assert.equal([...expanded.matchAll(/^ROLLBACK;$/gm)].length,1);
 assert.match(expanded,/SELECT plan\(32\);/);assert.equal([...expanded.matchAll(/^SELECT (?:is|ok|throws_ok|lives_ok)\(/gm)].length,32);
 return '-- GENERATED original EXP08 full-schema proof. Edit the template/canonical scripts, then run exp08-first-owner-native-proof.mjs --write.\n'+expanded;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const mode=process.argv[2];assert.ok(['--check','--write','--self-test'].includes(mode),'Choose --check, --write or --self-test');
 const expected=compileFirstOwnerNativeProof();
 if(mode==='--write'){writeFileSync(outputURL,expected);console.log('Wrote self-contained original native32 test; no database operation.');}
 if(mode==='--check'){assert.equal(read(outputURL),expected,'Original native32 test differs from canonical template/patches');console.log('Original native32 test is canonical and self-contained.');}
 if(mode==='--self-test'){
  assert.throws(()=>compileFirstOwnerNativeProof(read(templateURL).replace('SELECT plan(32);','SELECT plan(31);')),/plan/);
  assert.throws(()=>compileFirstOwnerNativeProof(read(templateURL).replace('\\ir ../../scripts/proof/exp08-first-owner-history-patch.sql','\\ir ../../scripts/proof/missing.sql')));
  assert.notEqual(compileFirstOwnerNativeProof(read(templateURL),(name)=>read(new URL('./'+name,import.meta.url))+'\n-- source drift\n'),expected,'Candidate source changes must change the generated test');
  console.log('Native32 packaging controls PASS: plan/include refusal and source drift visible.');
 }
}
