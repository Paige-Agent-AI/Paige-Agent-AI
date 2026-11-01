import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewedSetupSelection, cleanSoloSetupBrief, prepareOwnerConfirmedBrief } from '../../src/solo/settings-setup-contract.ts';

const actorId='10000000-0000-4000-8000-000000000001';
const tenantId='20000000-0000-4000-8000-000000000001';
const selection=()=>({schemaVersion:1,actorId,tenantId,reviewId:'30000000-0000-4000-8000-000000000001',
  expectedUpdatedAt:'2026-11-01T12:00:00.123456Z',expectedContextRevision:3,
  facts:[{field:'offers',value:'Advisory',reference:{contractVersion:1,tenantId,
    documentId:'40000000-0000-4000-8000-000000000001',revision:2,contentSha256:'a'.repeat(64)},
    excerpts:[{start:10,end:18,text:'Advisory'}]}]});

test('exact selected source and raw CAS survive detached capture; no approval synthesized',()=>{
  const input=selection(),captured=parseReviewedSetupSelection(input);
  input.facts[0].reference.revision=9;input.facts[0].excerpts[0].text='changed!';
  assert.equal(captured.facts[0].reference.revision,2);
  assert.equal(captured.facts[0].excerpts[0].text,'Advisory');
  assert.equal(captured.expectedUpdatedAt,'2026-11-01T12:00:00.123456Z');
  assert.equal('approved' in captured,false);
});
test('original UTF16 source offsets retain supplementary characters',()=>{
  const s=selection();s.facts[0].excerpts=[{start:3,end:5,text:'🌱'}];
  assert.deepEqual(parseReviewedSetupSelection(s).facts[0].excerpts,s.facts[0].excerpts);
});
const hostile={
  'foreign workspace source':s=>{s.facts[0].reference.tenantId=actorId;},
  'client approval flag':s=>{s.approved=true;},
  'source authority injection':s=>{s.facts[0].reference.approved=true;},
  'unselected private representative':s=>{s.facts[0].field='authorizedRepresentativeUserId';},
  'duplicate field equivocation':s=>{s.facts.push({...s.facts[0],value:'Other'});},
  'empty selection':s=>{s.facts=[];},
  'missing evidence':s=>{s.facts[0].excerpts=[];},
  'malformed SHA':s=>{s.facts[0].reference.contentSha256='a'.repeat(63);},
  'fractional revision':s=>{s.facts[0].reference.revision=2.5;},
  'native revision overflow':s=>{s.facts[0].reference.revision=2147483648;},
  'missing raw CAS':s=>{delete s.expectedUpdatedAt;},
  'bad CAS':s=>{s.expectedUpdatedAt='invalid';},
  'negative Setup revision':s=>{s.expectedContextRevision=-1;},
  'silent value normalization':s=>{s.facts[0].value=' Advisory ';},
  'quote length mismatch':s=>{s.facts[0].excerpts[0].end=19;},
  'split supplementary quote range':s=>{s.facts[0].excerpts=[{start:3,end:4,text:'🌱'}];},
  'negative offset':s=>{s.facts[0].excerpts=[{start:-1,end:7,text:'Advisory'}];},
  'source location overflow':s=>{s.facts[0].excerpts=[{start:480000,end:480008,text:'Advisory'}];},
  'unbounded quote amplification':s=>{s.facts[0].excerpts=[{start:0,end:12001,text:'x'.repeat(12001)}];},
  'unbounded value':s=>{s.facts[0].value='x'.repeat(4001);},
};
for(const [name,mutate] of Object.entries(hostile))test(`reject ${name}`,()=>{
  const s=selection();mutate(s);assert.throws(()=>parseReviewedSetupSelection(s),/SETUP_REVIEW_INVALID/);
});
test('ordinary manual Setup still works without a reviewed source or approval receipt',()=>{
  const manual=cleanSoloSetupBrief({publicName:'Example Advisory',offers:'Advisory'});
  const confirmed=prepareOwnerConfirmedBrief(manual,'2026-11-01T12:00:00Z');
  assert.equal(confirmed.offers,'Advisory');assert.equal(confirmed.provenance.offers.source,'owner_confirmed');
  assert.equal('reviewedFactApproval' in confirmed,false);
});
