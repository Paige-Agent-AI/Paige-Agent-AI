// Canonical packaging for the original permission actual-schema rollback proof. No DB access.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const template=new URL('./exp08-team-permission-native.template.sql',import.meta.url);
const patch=new URL('./exp08-team-permission-patch.sql',import.meta.url);
const out=new URL('../../supabase/tests/exp08_team_permission_native.sql',import.meta.url);
const read=u=>readFileSync(u,'utf8').replace(/\r\n/g,'\n');
function compile(t=read(template),source=read(patch)){
 assert.doesNotMatch(source,/^(?:BEGIN|COMMIT|ROLLBACK);$/m);
 const marker='\\ir ../../scripts/proof/exp08-team-permission-patch.sql';
 assert.equal(t.split(marker).length-1,2);
 assert.match(t,/SELECT plan\(32\);/);
 assert.equal([...t.matchAll(/^SELECT (?:is|ok|throws_ok|lives_ok)\(/gm)].length,32);
 const expanded=t.replaceAll(marker,`-- CANONICAL original scoped permission SHA256 ${createHash('sha256').update(source).digest('hex')}\n${source}`);
 assert.doesNotMatch(expanded,/^\\(?:i|ir)\s/m);
 assert.equal([...expanded.matchAll(/^BEGIN;$/gm)].length,1);
 assert.equal([...expanded.matchAll(/^ROLLBACK;$/gm)].length,1);
 return '-- GENERATED: edit original template/patch then run exp08-team-permission-native-proof.mjs --write.\n'+expanded;
}
const mode=process.argv[2];assert.ok(['--write','--check','--self-test'].includes(mode));const expected=compile();
if(mode==='--write'){writeFileSync(out,expected);console.log('Wrote canonical original permission native32; no DB operation.');}
if(mode==='--check'){assert.equal(read(out),expected);console.log('Original permission native32 canonical and self-contained.');}
if(mode==='--self-test'){
 assert.throws(()=>compile(read(template).replace('SELECT plan(32);','SELECT plan(31);')));
 assert.throws(()=>compile(read(template).replace('exp08-team-permission-patch.sql','missing.sql')));
 assert.notEqual(compile(read(template),read(patch)+'\n-- drift\n'),expected);
 console.log('Native permission packaging negative controls PASS; native execution UNVERIFIED.');
}
