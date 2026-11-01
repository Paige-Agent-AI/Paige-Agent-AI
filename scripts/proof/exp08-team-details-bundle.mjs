// Unversioned original Team details composition. No database operation or version reservation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export function buildTeamDetailsBundle(profile=read('./exp08-owner-work-profile-patch.sql'),permission=read('./exp08-team-permission-patch.sql'),ownerProjection=read('./exp08-owner-read-projection-patch.sql')){
 for(const [source,tag,hash] of [[profile,'profile_patch','1d99e171c55d259c18961068a7829fea'],[permission,'permission_patch','aab67c9a70880f160de550e4361a6142']]){
  assert.match(source,new RegExp('DO \\$'+tag+'\\$'));
  assert(source.includes(hash),'Original pinned body guard required');
  assert.doesNotMatch(source,/^(?:BEGIN|COMMIT|ROLLBACK);$/m);
  assert(['$exp08_details_bundle$','$exp08_details_profile$','$exp08_details_permission$'].every(tag=>!source.includes(tag)),'Outer SQL delimiter collision');
 }
 const projectionStart=ownerProjection.indexOf('DO $owner_read$');
 assert(projectionStart>0&&ownerProjection.endsWith('\nCOMMIT;\n'),'Exact original projection transaction shell required');
 assert.equal(ownerProjection.slice(0,projectionStart),"-- INERT original EXP08 I2 §5.5 candidate. No managed version/publication/apply.\n-- Extends two ORIGINAL readers, not their authority, writers or grants.\nBEGIN;\nSET LOCAL lock_timeout='2s';\n");
 const projection=ownerProjection.slice(projectionStart,-'\nCOMMIT;\n'.length);
 assert.equal(projection.split('DO $owner_read$').length,2);
 assert(['$exp08_details_bundle$','$exp08_details_projection$'].every(tag=>!projection.includes(tag)),'Projection outer delimiter collision');
 assert.doesNotMatch(projection,/^(?:BEGIN|COMMIT|ROLLBACK);$/m);
 const sql=`-- INERT original Team details bundle; no versioned carrier, apply or activation.
-- Original write components and projection DO remain byte-exact inside ONE atomic statement.
DO $exp08_details_bundle$
DECLARE
 profile_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)');
 permission_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 profile_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)');
 permission_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)');
 workspace_reader regprocedure:=pg_catalog.to_regprocedure('public.get_solo_team_workspace(text,text,integer,integer)');
 context_reader regprocedure:=pg_catalog.to_regprocedure('public.get_paige_team_context()');
 profile_original boolean; permission_original boolean; workspace_original boolean; context_original boolean;
BEGIN
 IF profile_base IS NULL OR permission_base IS NULL OR workspace_reader IS NULL OR context_reader IS NULL THEN RAISE EXCEPTION 'EXP08 Team details missing original door'; END IF;
 SELECT pg_catalog.md5(prosrc)='1d99e171c55d259c18961068a7829fea' INTO profile_original FROM pg_catalog.pg_proc WHERE oid=profile_base;
 SELECT pg_catalog.md5(prosrc)='aab67c9a70880f160de550e4361a6142' INTO permission_original FROM pg_catalog.pg_proc WHERE oid=permission_base;
 SELECT pg_catalog.md5(prosrc)='ded4ae3cb9d57f2c1ed0cef52493590b' INTO workspace_original FROM pg_catalog.pg_proc WHERE oid=workspace_reader;
 SELECT pg_catalog.md5(prosrc)='623d712d745867ed8f7d29374e3a6078' INTO context_original FROM pg_catalog.pg_proc WHERE oid=context_reader;
 IF (profile_scoped IS NULL) IS DISTINCT FROM (permission_scoped IS NULL)
  OR (profile_scoped IS NULL AND (NOT profile_original OR NOT permission_original OR NOT workspace_original OR NOT context_original))
  OR (profile_scoped IS NOT NULL AND (profile_original OR permission_original OR workspace_original OR context_original)) THEN
  RAISE EXCEPTION 'EXP08 Team details partial installation';
 END IF;
 -- Original component guards verify complete bodies, ABIs, owner/config/ACL and overloads.
 -- A later guard failure rolls back every prior component change in this statement.
 EXECUTE $exp08_details_profile$${profile}$exp08_details_profile$;
 EXECUTE $exp08_details_permission$${permission}$exp08_details_permission$;
 PERFORM pg_catalog.set_config('lock_timeout','2s',true);
 EXECUTE $exp08_details_projection$${projection}$exp08_details_projection$;
END $exp08_details_bundle$;
`;
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
