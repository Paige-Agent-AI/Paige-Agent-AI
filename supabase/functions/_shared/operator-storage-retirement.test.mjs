import test from 'node:test';
import assert from 'node:assert/strict';
import {retireTenantTtsCache} from './operator-storage-retirement.ts';
const tenant='00000000-0000-0000-0000-000000000011',foreign='00000000-0000-0000-0000-000000000012';
const object={id:tenant,name:tenant+'/'+('a'.repeat(64))+'.mp3',fingerprint:'reviewed'};
function fixture(options={}){
 const calls=[];let present=options.present??true;
 const admin={storage:{from:bucket=>{assert.equal(bucket,'tts-cache');return{
  remove:async paths=>{calls.push(['remove',paths]);if(options.throwRemove)throw Error('private error');if(!options.errorRemove&&!options.remains)present=false;return{error:options.errorRemove??null};},
  list:async(prefix,settings)=>{calls.push(['list',prefix,settings]);return{data:options.noData?null:present?[{name:object.name.split('/')[1]}]:[],error:options.errorList??null};}
 };}}};
 return{admin,calls};
}
test('Storage API removal binds exact tenant paths and independently lists absence',async()=>{
 const f=fixture();const r=await retireTenantTtsCache(f.admin,tenant,[object],false,async()=>true);
 assert.deepEqual(r,{state:'verified',provider_status:'removed'});assert.deepEqual(f.calls[0],['remove',[object.name]]);assert.deepEqual(f.calls[1],['list',tenant,{limit:101,offset:0}]);
});
test('foreign, platform, traversal, malformed and duplicate paths never call Storage',async()=>{
 for(const refs of [[{...object,name:foreign+'/'+('a'.repeat(64))+'.mp3'}],[{...object,name:'_platform/'+('a'.repeat(64))+'.mp3'}],[{...object,name:tenant+'/../foreign.mp3'}],[{...object,name:tenant+'/not-a-cache.mp3'}],[object,object],Array(101).fill(object),[]]){
  const f=fixture();assert.equal((await retireTenantTtsCache(f.admin,tenant,refs,false,async()=>true)).state,'blocked');assert.equal(f.calls.length,0);
 }
});
test('revoked authority refuses before removal; changed binding after removal stays unknown',async()=>{
 const refused=fixture();assert.equal((await retireTenantTtsCache(refused.admin,tenant,[object],false,async()=>false)).state,'blocked');assert.equal(refused.calls.length,0);
 const changed=fixture();let n=0;assert.equal((await retireTenantTtsCache(changed.admin,tenant,[object],false,async()=>++n===1)).state,'unknown');
});
test('lost or failed remove never retries automatically or claims completion',async()=>{
 for(const options of [{throwRemove:true},{errorRemove:{message:'private data'}}]){const f=fixture(options);const r=await retireTenantTtsCache(f.admin,tenant,[object],false,async()=>true);assert.equal(r.state,'unknown');assert.equal(f.calls.filter(c=>c[0]==='remove').length,1);assert.ok(!JSON.stringify(r).includes('private'));}
});
test('successful remove with remaining objects or missing inventory stays unknown',async()=>{
 for(const options of [{remains:true},{noData:true},{errorList:{message:'private data'}}]){const f=fixture(options);assert.equal((await retireTenantTtsCache(f.admin,tenant,[object],false,async()=>true)).state,'unknown');}
});
test('read-only reconciliation cannot remove data and resolves absence on the same scope',async()=>{
 for(const present of [true,false]){const f=fixture({present});const r=await retireTenantTtsCache(f.admin,tenant,[object],true,async()=>true);assert.equal(r.state,present?'unknown':'verified');assert.equal(f.calls.some(c=>c[0]==='remove'),false);}
});
