import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareReviewedSetup, inspectReviewedSetup, readReviewedSetup } from '../../src/solo/data/reviewed-setup-client.ts';
const actorId='10000000-0000-4000-8000-000000000001',tenantId='20000000-0000-4000-8000-000000000001';
const requestId='50000000-0000-4000-8000-000000000001',receiptId='60000000-0000-4000-8000-000000000001';
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(){
 const selection={schemaVersion:1,actorId,tenantId,reviewId:'30000000-0000-4000-8000-000000000001',
  expectedUpdatedAt:'2026-11-01T12:00:00.123456Z',expectedContextRevision:3,
  facts:[{field:'offers',value:'Advisory',reference:{contractVersion:1,tenantId,documentId:'40000000-0000-4000-8000-000000000001',revision:1,contentSha256:'a'.repeat(64)},excerpts:[{start:0,end:8,text:'Advisory'}]}]};
 const receipt={schemaVersion:1,receiptId,requestId,reviewId:selection.reviewId,actorId,tenantId,purpose:'setup_business_facts',
  selectedFacts:clone(selection.facts),selectionHash:'b'.repeat(64),updatedAt:'2026-11-01T12:00:01.654321Z',contextRevision:4};
 const recorded={status:'recorded',receiptId,current:true,receipt};
 let current=true,currentScope={actorId,tenantId};const calls=[];
 const scope={actorId,tenantId,isCurrent:()=>current};
 const client={getScope:async()=>currentScope,rpc:async(name,args)=>{
  calls.push({name,args:clone(args)});
  return {data:clone(name.startsWith('stage_')?selection:recorded),error:null};
 }};
 return {selection,receipt,recorded,calls,scope,client,leave:()=>{current=false;},switchScope:s=>{currentScope=s;},
  handle:()=>prepareReviewedSetup(client,scope,selection)};
}
const code=c=>e=>e?.code===c;

test('full reload discovers original staged selection and authoritative receipt, without a write',async()=>{
 const f=fixture();f.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{proposal:f.selection,
  approval:{requestId,inspection:f.recorded}},error:null};};
 const reopened=await readReviewedSetup(f.client,f.scope);
 assert.equal(reopened.proposal.reviewId,f.selection.reviewId);
 assert.equal(reopened.approval.receipt.receiptId,receiptId);
 assert.deepEqual(f.calls.map(c=>c.name),['read_solo_reviewed_business_facts']);
});
test('discovery withholds facts after actor/workspace change during its await',async()=>{
 const f=fixture();f.client.rpc=async()=>{f.leave();return {data:{proposal:f.selection,approval:null},error:null};};
 await assert.rejects(readReviewedSetup(f.client,f.scope),code('SCOPE_CHANGED'));
});
test('discovery never accepts another actors staged selection',async()=>{
 const f=fixture();const proposal=clone(f.selection);proposal.actorId=requestId;
 f.client.rpc=async()=>({data:{proposal,approval:null},error:null});
 await assert.rejects(readReviewedSetup(f.client,f.scope),code('READBACK_MISMATCH'));
});
test('explicit stage never approves; explicit selected save uses original ABI and authoritative inspection',async()=>{
 const f=fixture(),h=f.handle();await h.stage();assert.deepEqual(f.calls.map(c=>c.name),['stage_solo_reviewed_business_facts']);
 const r=await h.approve(requestId,['offers']);assert.equal(r.receipt.receiptId,receiptId);
 assert.deepEqual(f.calls.map(c=>c.name),['stage_solo_reviewed_business_facts','save_solo_reviewed_business_facts','inspect_solo_reviewed_business_facts']);
 assert.deepEqual(f.calls[1].args,{_expected_tenant_id:tenantId,_expected_actor_id:actorId,_review_id:f.selection.reviewId,
  _expected_updated_at:f.selection.expectedUpdatedAt,_expected_context_revision:3,_request_id:requestId,_selected_fields:['offers'],_purpose:'setup_business_facts'});
 await assert.rejects(h.approve(requestId,['offers']),code('REVIEW_REQUIRED'));
});
test('approval requires completed native review and does not infer approval from source input',async()=>{
 const f=fixture();await assert.rejects(f.handle().approve(requestId,['offers']),code('REVIEW_REQUIRED'));assert.equal(f.calls.length,0);
});
for(const sourceDecision of ['adopt','override'])test(`original ${sourceDecision} decision is bound to stage and authoritative receipt`,async()=>{
 const f=fixture();f.selection.facts[0].sourceDecision=sourceDecision;f.receipt.selectedFacts[0].sourceDecision=sourceDecision;
 const h=f.handle();await h.stage();const r=await h.approve(requestId,['offers']);
 assert.equal(f.calls[0].args._facts[0].sourceDecision,sourceDecision);
 assert.equal(r.receipt.selectedFacts[0].sourceDecision,sourceDecision);
 assert.equal('_sourceDecisions' in f.calls[1].args,false,'save cannot inject a different decision map');
});
test('changed source decision in authoritative receipt is UNKNOWN, never a repeat save',async()=>{
 const f=fixture();f.selection.facts[0].sourceDecision='override';f.receipt.selectedFacts[0].sourceDecision='adopt';
 const h=f.handle();await h.stage();await assert.rejects(h.approve(requestId,['offers']),e=>e.code==='READBACK_MISMATCH'&&e.mayHaveSaved&&e.requestId===requestId);
 await assert.rejects(h.approve(requestId,['offers']),code('INSPECTION_REQUIRED'));
 assert.equal(f.calls.filter(c=>c.name.startsWith('save_')).length,1);
});
test('capture before first await detaches mutable source and selected fields',async()=>{
 const f=fixture(),h=f.handle();f.selection.facts[0].value='Tampered';
 // Native fixture must return the originally captured selection, not mutated host input.
 const original=clone(f.selection);original.facts[0].value='Advisory';
 const rpc=f.client.rpc;f.client.rpc=async(name,args)=>name.startsWith('stage_')?{data:original,error:null}:rpc(name,args);
 await h.stage();const fields=['offers'];const p=h.approve(requestId,fields);fields[0]='industry';
 assert.equal((await p).receipt.selectedFacts[0].value,'Advisory');assert.deepEqual(f.calls[0].args._selected_fields,['offers']);
});
for(const [name,fields] of [['empty',[]],['duplicate',['offers','offers']],['unreviewed',['industry']]])test(`${name} selected fields produce zero save calls`,async()=>{
 const f=fixture(),h=f.handle();await h.stage();await assert.rejects(h.approve(requestId,fields),code('INPUT_INVALID'));assert.equal(f.calls.length,1);
});
test('UNKNOWN save cannot repeat or change identity before inspection',async()=>{
 const f=fixture(),rpc=f.client.rpc;let failed=false;
 f.client.rpc=async(name,args)=>{if(name.startsWith('save_')&&!failed){failed=true;f.calls.push({name,args});throw Error('lost acknowledgement');}return rpc(name,args);};
 const h=f.handle();await h.stage();await assert.rejects(h.approve(requestId,['offers']),e=>e.code==='SAVE_UNVERIFIED'&&e.mayHaveSaved&&e.requestId===requestId);
 await assert.rejects(h.approve(requestId,['offers']),code('INSPECTION_REQUIRED'));
 assert.equal(f.calls.filter(c=>c.name.startsWith('save_')).length,1);
 const r=await h.reconcile();assert.equal(r.receiptId,receiptId);assert.equal(f.calls.filter(c=>c.name.startsWith('save_')).length,1);
 await assert.rejects(h.approve(requestId,['offers']),code('REVIEW_REQUIRED'));
});
test('absent-at-read permits only an explicit same-identity retry, never automatic write',async()=>{
 const f=fixture(),rpc=f.client.rpc;let save=false;
 f.client.rpc=async(name,args)=>{
  if(name.startsWith('save_')&&!save){save=true;f.calls.push({name,args});throw Error('unknown');}
  if(name.startsWith('inspect_')&&f.calls.filter(c=>c.name.startsWith('save_')).length===1){f.calls.push({name,args});return {data:{status:'absent_at_read'},error:null};}
  return rpc(name,args);
 };
 const h=f.handle();await h.stage();await assert.rejects(h.approve(requestId,['offers']));
 assert.equal((await h.reconcile()).status,'absent_at_read');assert.equal(f.calls.filter(c=>c.name.startsWith('save_')).length,1);
 await assert.rejects(h.approve('50000000-0000-4000-8000-000000000002',['offers']),code('REQUEST_CHANGED'));
 assert.equal((await h.approve(requestId,['offers'])).receiptId,receiptId);
});
test('historical source-changed receipt remains historical and does not issue another save',async()=>{
 const f=fixture(),rpc=f.client.rpc;
 f.client.rpc=async(name,args)=>name.startsWith('inspect_')?{data:{status:'recorded',receiptId,current:false,reason:'source_unavailable_or_changed'},error:null}:rpc(name,args);
 const h=f.handle();await h.stage();const r=await h.approve(requestId,['offers']);assert.equal(r.current,false);assert.equal('receipt' in r,false);
 await assert.rejects(h.approve(requestId,['offers']),code('REVIEW_REQUIRED'));
});
test('contradictory error plus success data cannot establish a receipt',async()=>{
 const f=fixture(),rpc=f.client.rpc;f.client.rpc=async(name,args)=>{const r=await rpc(name,args);return name.startsWith('save_')?{...r,error:{code:'40001'}}:r;};
 const h=f.handle();await h.stage();await assert.rejects(h.approve(requestId,['offers']),e=>e.code==='SAVE_UNVERIFIED'&&e.mayHaveSaved);
 await assert.rejects(h.approve(requestId,['offers']),code('INSPECTION_REQUIRED'));
});
for(const [name,change] of [
 ['different actor',r=>{r.receipt.actorId='10000000-0000-4000-8000-000000000002';}],
 ['different request',r=>{r.receipt.requestId='50000000-0000-4000-8000-000000000002';}],
 ['different selected value',r=>{r.receipt.selectedFacts[0].value='Wrong';}],
 ['different source',r=>{r.receipt.selectedFacts[0].reference.revision=2;}],
 ['wrong Setup revision',r=>{r.receipt.contextRevision=3;}],
 ['execution purpose',r=>{r.receipt.purpose='execute_work';}],
 ['unknown approval flag',r=>{r.receipt.approved=true;}],
])test(`native readback refuses ${name}`,async()=>{
 const f=fixture(),rpc=f.client.rpc;f.client.rpc=async(name,args)=>{const r=await rpc(name,args);if(!name.startsWith('stage_'))change(r.data);return r;};
 const h=f.handle();await h.stage();await assert.rejects(h.approve(requestId,['offers']),e=>e.code==='READBACK_MISMATCH'&&e.mayHaveSaved);
});
test('foreign current workspace stops before any native call',async()=>{
 const f=fixture();f.switchScope({actorId,tenantId:'20000000-0000-4000-8000-000000000002'});
 await assert.rejects(f.handle().stage(),code('SCOPE_CHANGED'));assert.equal(f.calls.length,0);
});
for(const at of ['stage','save','inspect'])test(`late ${at} acknowledgement after departure cannot disclose facts`,async()=>{
 const f=fixture(),rpc=f.client.rpc;
 f.client.rpc=async(name,args)=>{const r=await rpc(name,args);if(name.startsWith(at+'_'))f.leave();return r;};
 const h=f.handle();if(at==='stage')await assert.rejects(h.stage(),code('SCOPE_CHANGED'));
 else {await h.stage();await assert.rejects(h.approve(requestId,['offers']),e=>e.code==='SCOPE_CHANGED'&&e.mayHaveSaved);}
});
test('late inspection scope resolution itself cannot return source content',async()=>{
 const f=fixture();let resolutions=0;f.client.getScope=async()=>{if(++resolutions===2)f.leave();return {actorId,tenantId};};
 await assert.rejects(inspectReviewedSetup(f.client,f.scope,requestId),code('SCOPE_CHANGED'));
});
test('overlapping action is refused while a native stage is unresolved',async()=>{
 const f=fixture(),rpc=f.client.rpc;let release;const gate=new Promise(r=>{release=r;});
 f.client.rpc=async(name,args)=>{if(name.startsWith('stage_'))await gate;return rpc(name,args);};
 const h=f.handle(),stage=h.stage();await assert.rejects(h.approve(requestId,['offers']),code('BUSY'));release();await stage;
});
test('lost readback after save retains UNKNOWN and refuses another save until inspection succeeds',async()=>{
 const f=fixture(),rpc=f.client.rpc;let denied=true;
 f.client.rpc=async(name,args)=>{if(name.startsWith('inspect_')&&denied)throw Error('private transport body');return rpc(name,args);};
 const h=f.handle();await h.stage();await assert.rejects(h.approve(requestId,['offers']),e=>e.mayHaveSaved&&e.code==='INSPECTION_FAILED'&&!e.message.includes('private'));
 await assert.rejects(h.reconcile(),e=>e.code==='INSPECTION_FAILED'&&!e.message.includes('private'));
 await assert.rejects(h.approve(requestId,['offers']),code('INSPECTION_REQUIRED'));
 denied=false;assert.equal((await h.reconcile()).receiptId,receiptId);assert.equal(f.calls.filter(c=>c.name.startsWith('save_')).length,1);
});
test('a malformed staged selection is never enough to approve',async()=>{
 const f=fixture(),rpc=f.client.rpc;f.client.rpc=async(name,args)=>{const r=await rpc(name,args);if(name.startsWith('stage_'))r.data.facts[0].reference.revision=2;return r;};
 const h=f.handle();await assert.rejects(h.stage(),code('STAGE_UNVERIFIED'));await assert.rejects(h.approve(requestId,['offers']),code('REVIEW_REQUIRED'));
 assert.equal(f.calls.length,1);
});
test('stage transport errors cannot disclose raw response content',async()=>{
 const f=fixture();f.client.rpc=async()=>{throw Error('private raw transport body');};
 await assert.rejects(f.handle().stage(),e=>e.code==='STAGE_UNVERIFIED'&&!e.message.includes('private'));
});
