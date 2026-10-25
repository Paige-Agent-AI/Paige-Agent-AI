import test from 'node:test';
import assert from 'node:assert/strict';
import {retireTenantTtsCache,retireTenantGeneratedMedia,retireTenantTeamHubFiles} from './operator-storage-retirement.ts';
const tenant='00000000-0000-0000-0000-000000000011',foreign='00000000-0000-0000-0000-000000000012';
const fileId='0f0e0d0c-0b0a-4908-8706-050403020100';
// [retire, bucket, reviewed file under the tenant, the prefix the absence readback must list]
for(const [retire,bucket,file,listed] of [[retireTenantTtsCache,'tts-cache',('a'.repeat(64))+'.mp3',tenant],[retireTenantGeneratedMedia,'paige-generated','1780000000000-abcdef12.png',tenant],[retireTenantTeamHubFiles,'comms-attachments','team-hub/'+fileId,tenant+'/team-hub']]){
const object={id:tenant,name:tenant+'/'+file,fingerprint:'reviewed'};
function fixture(options={}){
 const calls=[];let present=options.present??true;
 const admin={storage:{from:selected=>{assert.equal(selected,bucket);return{
  remove:async paths=>{calls.push(['remove',paths]);if(options.throwRemove)throw Error('private error');if(!options.errorRemove&&!options.remains)present=false;return{error:options.errorRemove??null};},
  list:async(prefix,settings)=>{calls.push(['list',prefix,settings]);return{data:options.noData?null:present?[{name:object.name.split('/').pop()}]:[],error:options.errorList??null};}
 };}}};
 return{admin,calls};
}
test(bucket+': Storage API removal binds exact tenant paths and independently lists absence',async()=>{
 const f=fixture();const r=await retire(f.admin,tenant,[object],false,async()=>true);
 assert.deepEqual(r,{state:'verified',provider_status:'removed'});assert.deepEqual(f.calls[0],['remove',[object.name]]);assert.deepEqual(f.calls[1],['list',listed,{limit:101,offset:0}]);
});
test(bucket+': foreign, platform, traversal, malformed and duplicate paths never call Storage',async()=>{
 for(const refs of [[{...object,name:foreign+'/'+file}],[{...object,name:'_platform/'+file}],[{...object,name:tenant+'/../'+file}],[{...object,name:tenant+'/independent-file.pdf'}],[object,object],Array(101).fill(object),[]]){
  const f=fixture();assert.equal((await retire(f.admin,tenant,refs,false,async()=>true)).state,'blocked');assert.equal(f.calls.length,0);
 }
});
if(bucket==='comms-attachments')test(bucket+': only the canonical Team Hub path is removable; Inbox attachments and look-alikes never call Storage',async()=>{
 for(const name of [tenant+'/'+fileId,tenant+'/'+fileId+'-invoice.pdf',tenant+'/team-hub/'+fileId.toUpperCase(),tenant+'/team-hub/'+fileId+'/nested',tenant+'/team-hub/'+fileId+'.pdf',
  tenant+'/team-hub/not-a-uuid',tenant+'/Team-Hub/'+fileId,tenant+'/team-hub//'+fileId,tenant+'/team-hub/../'+fileId,'team-hub/'+fileId,foreign+'/team-hub/'+fileId]){
  const f=fixture();assert.equal((await retire(f.admin,tenant,[{...object,name}],false,async()=>true)).state,'blocked',name);assert.equal(f.calls.length,0);
 }
 const f=fixture();assert.equal((await retire(f.admin,tenant,[object,{...object,name:tenant+'/team-hub/1f0e0d0c-0b0a-4908-8706-050403020100'}],false,async()=>true)).state,'verified');
 assert.equal(f.calls[0][1].length,2);assert.ok(f.calls.filter(c=>c[0]==='list').every(c=>c[1]===tenant+'/team-hub'),'readback never lists the tenant folder shared with Inbox attachments');
});
test(bucket+': revoked authority refuses before removal; changed binding after removal stays unknown',async()=>{
 const refused=fixture();assert.equal((await retire(refused.admin,tenant,[object],false,async()=>false)).state,'blocked');assert.equal(refused.calls.length,0);
 const changed=fixture();let n=0;assert.equal((await retire(changed.admin,tenant,[object],false,async()=>++n===1)).state,'unknown');
});
test(bucket+': lost or failed remove never retries automatically or claims completion',async()=>{
 for(const options of [{throwRemove:true},{errorRemove:{message:'private data'}}]){const f=fixture(options);const r=await retire(f.admin,tenant,[object],false,async()=>true);assert.equal(r.state,'unknown');assert.equal(f.calls.filter(c=>c[0]==='remove').length,1);assert.ok(!JSON.stringify(r).includes('private'));}
});
test(bucket+': successful remove with remaining objects or missing inventory stays unknown',async()=>{
 for(const options of [{remains:true},{noData:true},{errorList:{message:'private data'}}]){const f=fixture(options);assert.equal((await retire(f.admin,tenant,[object],false,async()=>true)).state,'unknown');}
});
test(bucket+': read-only reconciliation cannot remove data and resolves absence on the same scope',async()=>{
 for(const present of [true,false]){const f=fixture({present});const r=await retire(f.admin,tenant,[object],true,async()=>true);assert.equal(r.state,present?'unknown':'verified');assert.equal(f.calls.some(c=>c[0]==='remove'),false);}
});
}
