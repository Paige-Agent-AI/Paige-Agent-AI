// Canonical original atomic catalog proof packaging. No database access.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {buildTeamDetailsBundle} from './exp08-team-details-bundle.mjs';
const template=new URL('./exp08-team-details-bundle-native.template.sql',import.meta.url);
const out=new URL('../../supabase/tests/exp08_team_details_bundle_native.sql',import.meta.url);
const read=p=>readFileSync(p,'utf8').replace(/\r\n/g,'\n');
function compile(t=read(template),bundle=buildTeamDetailsBundle()){
 const marker='-- EXP08_ATOMIC_BUNDLE';
 assert.equal(t.split(marker).length-1,5);
 assert.match(t,/SELECT plan\(14\);/);
 assert.equal([...t.matchAll(/^SELECT (?:is|ok|throws_ok|lives_ok)\(/gm)].length,14);
 const compiled=t.replaceAll(marker,`-- Canonical original atomic bundle SHA256 ${bundle.sha256}\n${bundle.sql}`);
 assert.equal([...compiled.matchAll(/^BEGIN;$/gm)].length,1);assert.equal([...compiled.matchAll(/^ROLLBACK;$/gm)].length,1);
 assert.doesNotMatch(compiled,/^\\(?:i|ir)\s/m);
 return '-- GENERATED from original Team details bundle/template; no execution attestation.\n'+compiled;
}
assert(['--write','--check','--self-test'].includes(process.argv[2])&&process.argv.length===3);
const expected=compile();
if(process.argv[2]==='--write'){writeFileSync(out,expected);console.log('Wrote original atomic14 schema-only rollback proof; execution UNVERIFIED.');}
if(process.argv[2]==='--check'){assert.equal(read(out),expected);console.log('Original atomic14 canonical packaging PASS; execution UNVERIFIED.');}
if(process.argv[2]==='--self-test'){
 assert.throws(()=>compile(read(template).replace('plan(14)','plan(13)')));
 assert.throws(()=>compile(read(template).replace('-- EXP08_ATOMIC_BUNDLE','-- missing')));
 assert.notEqual(compile(read(template),{...buildTeamDetailsBundle(),sql:buildTeamDetailsBundle().sql+'\n-- drift'}),expected);
 console.log('Original atomic14 packaging negative controls PASS; execution UNVERIFIED.');
}
