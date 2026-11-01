// Deterministic artifact of the original reviewed components. No database access.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {buildOwnerRecoveryBundle} from './exp08-owner-recovery-bundle.mjs';
const file=new URL('../../supabase/migrations/20271126230008_exp08_owner_recovery_native.sql',import.meta.url);
const header=`-- EXP08 original owner recovery: prospective guarded native carrier.
-- Generated once from the original reviewed atomic components; their embedded
-- preparation comments describe their source context, not this carrier's state.
-- Never rewrite after application. Changes require a new guarded forward carrier.
-- Requires current exact-head review/CI, real schema proof and normal native order.
-- No provider/email dispatch, automatic recovery or new approval/result authority.
`;
const original='-- INERT compiled original recovery bundle; not a versioned migration or activation.\n';
export function ownerRecoveryCarrier(){
 const bundle=buildOwnerRecoveryBundle();assert.ok(bundle.sql.startsWith(original));
 return header+bundle.sql.slice(original.length);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 assert.ok(process.argv.length===3&&['--write-once','--check'].includes(process.argv[2]),'Use --write-once on the empty CLI scaffold, or --check');
 const expected=ownerRecoveryCarrier(),actual=readFileSync(file,'utf8').replace(/\r\n/g,'\n');
 if(process.argv[2]==='--write-once'){
  assert.equal(actual.trim(),'','Never overwrite a populated or applied migration');
  writeFileSync(file,expected);
 }else assert.equal(actual,expected,'Carrier differs from its original reviewed components; reconcile before release');
 console.log(JSON.stringify({carrier:file.pathname.split('/').at(-1),sha256:createHash('sha256').update(expected).digest('hex'),mode:process.argv[2]}));
}
