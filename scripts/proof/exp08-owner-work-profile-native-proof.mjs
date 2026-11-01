// Canonical packaging for the original work-profile actual-schema rollback proof. No DB access.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const template=new URL('./exp08-owner-work-profile-native.template.sql',import.meta.url);
const patch=new URL('./exp08-owner-work-profile-patch.sql',import.meta.url);
const out=new URL('../../supabase/tests/exp08_owner_work_profile_native.sql',import.meta.url);
const read=u=>readFileSync(u,'utf8').replace(/\r\n/g,'\n');
function compile(t=read(template),source=read(patch)){
 assert.doesNotMatch(source,/^(?:BEGIN|COMMIT|ROLLBACK);$/m);
 const marker='\\ir ../../scripts/proof/exp08-owner-work-profile-patch.sql';
 assert.equal(t.split(marker).length-1,2);
 assert.match(t,/SELECT plan\(28\);/);
 assert.equal([...t.matchAll(/^SELECT (?:is|ok|throws_ok|lives_ok)\(/gm)].length,28);
 const expanded=t.replaceAll(marker,`-- CANONICAL original scoped profile SHA256 ${createHash('sha256').update(source).digest('hex')}\n${source}`);
 assert.doesNotMatch(expanded,/^\\(?:i|ir)\s/m);
 assert.equal([...expanded.matchAll(/^BEGIN;$/gm)].length,1);
 assert.equal([...expanded.matchAll(/^ROLLBACK;$/gm)].length,1);
 return '-- GENERATED: edit original template/patch then run exp08-owner-work-profile-native-proof.mjs --write.\n'+expanded;
}
const mode=process.argv[2];assert.ok(['--write','--check','--self-test'].includes(mode));const expected=compile();
if(mode==='--write'){writeFileSync(out,expected);console.log('Wrote canonical original profile native28; no DB operation.');}
if(mode==='--check'){assert.equal(read(out),expected);console.log('Original profile native28 canonical and self-contained.');}
if(mode==='--self-test'){
 assert.throws(()=>compile(read(template).replace('SELECT plan(28);','SELECT plan(27);')));
 assert.throws(()=>compile(read(template).replace('exp08-owner-work-profile-patch.sql','missing.sql')));
 assert.notEqual(compile(read(template),read(patch)+'\n-- drift\n'),expected);
 console.log('Native profile packaging negative controls PASS; native execution UNVERIFIED.');
}
