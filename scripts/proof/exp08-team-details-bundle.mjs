// One original atomic test composition; production carrier uses the same literal definitions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {literalTeamPreflight} from './exp08-team-details-literal-native.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const projectionHeader="-- INERT original EXP08 I2 §5.5 candidate. No managed version/publication/apply.\n-- Extends two ORIGINAL readers, not their authority, writers or grants.\nBEGIN;\nSET LOCAL lock_timeout='2s';\n";
export function buildTeamDetailsBundle(profile=read('./exp08-owner-work-profile-patch.sql'),permission=read('./exp08-team-permission-patch.sql'),ownerProjection=read('./exp08-owner-read-projection-patch.sql')){
 for(const [source,name,hash] of [[profile,'set_solo_team_member_work_profile','1d99e171c55d259c18961068a7829fea'],[permission,'set_solo_team_member_permission','aab67c9a70880f160de550e4361a6142']]){
  assert(source.includes(`CREATE OR REPLACE FUNCTION public.${name}(`));
  assert(source.includes(hash),'Original pinned body guard required');
  assert.doesNotMatch(source,/^(?:BEGIN|COMMIT|ROLLBACK);$/m);
  assert(['$exp08_details_bundle$','$exp08_details_profile$','$exp08_details_permission$'].every(tag=>!source.includes(tag)),'Outer SQL delimiter collision');
 }
 assert(ownerProjection.startsWith(projectionHeader)&&ownerProjection.endsWith('\nCOMMIT;\n'),'Exact original projection transaction shell required');
 const projection=ownerProjection.slice(projectionHeader.length,-'\nCOMMIT;\n'.length);
 assert(['$exp08_details_bundle$','$exp08_details_projection$'].every(tag=>!projection.includes(tag)),'Projection outer delimiter collision');
 assert.doesNotMatch(projection,/^(?:BEGIN|COMMIT|ROLLBACK);$/m);
 const sql=`-- Original six-function Team composition, atomic under the existing test runner.\nDO $exp08_details_bundle$\nBEGIN\nEXECUTE $exp08_details_preflight$${literalTeamPreflight()}$exp08_details_preflight$;\nEXECUTE $exp08_details_profile$${profile}$exp08_details_profile$;\nEXECUTE $exp08_details_permission$${permission}$exp08_details_permission$;\nEXECUTE $exp08_details_projection$${projection}$exp08_details_projection$;\nEND $exp08_details_bundle$;\n`;
 return {sql,sha256:createHash('sha256').update(sql).digest('hex'),components:[profile,permission,ownerProjection].map(source=>createHash('sha256').update(source).digest('hex'))};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 assert.deepEqual(process.argv.slice(2),['--check']);
 const result=buildTeamDetailsBundle();
 assert.equal(result.sql.split('EXECUTE $exp08_details_profile$').length,2);
 assert.equal(result.sql.split('EXECUTE $exp08_details_permission$').length,2);
 assert.throws(()=>buildTeamDetailsBundle('DO $profile_patch$ BEGIN; END $profile_patch$;',read('./exp08-team-permission-patch.sql')));
 assert.throws(()=>buildTeamDetailsBundle(read('./exp08-owner-work-profile-patch.sql')+'\n$exp08_details_profile$',read('./exp08-team-permission-patch.sql')));
 console.log(JSON.stringify({unversioned:true,sha256:result.sha256,components:result.components,negativePackagingControls:'PASS',databaseExecution:'UNVERIFIED'}));
}
