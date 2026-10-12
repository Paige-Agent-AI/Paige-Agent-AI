import assert from 'node:assert/strict';
import {startInteractiveTurn,createInteractiveSettlement,createInteractiveExecution} from '../supabase/functions/_shared/paige-turn/interactive.ts';
const intent='00000000-0000-4000-8000-000000000001';
let executor=null,releases=0,receipts=0,begun=0,admit;
const bothBegun=new Promise(r=>admit=r);
const request=()=>{const settlement=createInteractiveSettlement({owns:async()=>executor===intent,readback:async()=>receipts>0,
 fallback:async()=>{receipts++;return {error:null};},release:async()=>{releases++;executor=null;}});
return {intent,begin:async()=>{if(++begun===2)admit();await bothBegun;return {data:{status:'accepted',turn_id:intent},error:null};},
 store:{state:async()=>({latest:intent,executor}),acquire:async()=>{if(executor)return false;executor=intent;return true;},release:()=>settlement.release()}};};
const starts=await Promise.all([startInteractiveTurn(request()),startInteractiveTurn(request())]);
const winner=starts.find(r=>r.boundary.proceed),loser=starts.find(r=>!r.boundary.proceed);
assert.ok(winner?.execution);assert.equal(loser?.boundary.code,'INTERACTIVE_ALREADY_RUNNING');
assert.equal(executor,intent,'acquisition loser must not settle or release the running request');
assert.equal(releases,0);
assert.equal(receipts,0,'loser must not issue terminal evidence while winner is running');
await winner.lifetime.handlerFinished();assert.equal(executor,null);assert.equal(releases,1);
assert.equal(receipts,1,'confirmed owner retains canonical fallback settlement');
executor=null;releases=0;
const unknown=await startInteractiveTurn({intent,begin:async()=>({data:{status:'accepted',turn_id:intent},error:null}),
 store:{state:async()=>({latest:intent,executor}),acquire:async()=>{executor=intent;throw Error('acquire response unavailable');},release:async()=>{releases++;executor=null;}}});
assert.equal(unknown.boundary.proceed,false);assert.equal(executor,intent,'uncertain acquire must retain authority for canonical recovery');assert.equal(releases,0);
for (const state of [async()=>({latest:null,executor:intent}),async()=>{throw Error('state unavailable');},async()=>({latest:intent,executor:null})]) {
 const unowned=createInteractiveExecution(intent,{state,acquire:async()=>false,release:async()=>{releases++;}});
 await assert.rejects(unowned.acquire(0));await unowned.release();assert.equal(releases,0,'failed acquire cannot invoke settlement cleanup');
}
console.log('PASS canonical adapter: same-intent acquisition loser cannot settle another execution; uncertain acquire stays held; confirmed owner releases once');
