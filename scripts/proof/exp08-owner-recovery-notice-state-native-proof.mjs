// Canonical packaging only. Native pgTAP execution requires the original schema job.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const template=new URL('./exp08-owner-recovery-notice-state-native.template.sql',import.meta.url);
const patch=new URL('./exp08-owner-recovery-notice-state.sql',import.meta.url);
const output=new URL('../../supabase/tests/exp08_owner_recovery_notice_state_native.sql',import.meta.url);
const read=p=>readFileSync(p,'utf8').replace(/\r\n/g,'\n');
function compile(t=read(template),source=read(patch)){
 assert.doesNotMatch(source,/^(?:BEGIN|COMMIT|ROLLBACK);$/m);
 const marker='-- EXP08_NOTICE_STATE_PATCH';
 assert.equal(t.split(marker).length-1,5);
 assert.match(t,/SELECT plan\(16\);/);
 assert.equal([...t.matchAll(/^SELECT (?:is|ok|throws_ok|lives_ok)\(/gm)].length,16);
 const sql=t.replaceAll(marker,()=>`-- Canonical original notice-state SHA256 ${createHash('sha256').update(source).digest('hex')}\n${source}`);
 assert.doesNotMatch(sql,/^\\(?:i|ir)\s/m);
 assert.equal([...sql.matchAll(/^BEGIN;$/gm)].length,1);
 assert.equal([...sql.matchAll(/^ROLLBACK;$/gm)].length,1);
 return '-- GENERATED from original notice-state template/source; execution UNVERIFIED.\n'+sql;
}
const mode=process.argv[2];assert(process.argv.length===3&&['--write','--check','--self-test'].includes(mode));
const expected=compile();
if(mode==='--write'){writeFileSync(output,expected);console.log('Wrote canonical notice-state native16; native execution UNVERIFIED.');}
if(mode==='--check'){assert.equal(read(output),expected);console.log('Canonical notice-state native16 packaging PASS; native execution UNVERIFIED.');}
if(mode==='--self-test'){
 assert.throws(()=>compile(read(template).replace('plan(16)','plan(15)')));
 assert.throws(()=>compile(read(template).replace('-- EXP08_NOTICE_STATE_PATCH','-- missing')));
 assert.throws(()=>compile(read(template),read(patch)+'\nCOMMIT;'));
 assert.notEqual(compile(read(template),read(patch)+'\n-- drift'),expected);
 const literal="-- literal dollar controls: $& $` $' $$";
 assert.equal(compile(read(template),read(patch)+'\n'+literal).split(literal).length-1,5);
 console.log('Canonical packaging negative controls PASS; native execution UNVERIFIED.');
}
