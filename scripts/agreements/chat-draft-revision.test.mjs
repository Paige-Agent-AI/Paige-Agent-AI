import test from 'node:test';
import assert from 'node:assert/strict';
import { draftAgreement } from '../../supabase/functions/_shared/agreements/chat-write.ts';

const tenant='10000000-0000-4000-8000-000000000001';
const agreement='20000000-0000-4000-8000-000000000001';
const contact='30000000-0000-4000-8000-000000000001';
const offer='40000000-0000-4000-8000-000000000001';
const terms='50000000-0000-4000-8000-000000000001';
const template='60000000-0000-4000-8000-000000000001';
const stamp='2026-10-01T12:00:00.123456+00:00';
const source={id:agreement,tenant_id:tenant,contact_id:contact,status:'draft',updated_at:stamp,
  offer_id:offer,commercial_terms_id:terms,body_source:'tenant_template',source_version_id:template,document_path:null};
function port(row=source, readError=null, writeError=null) {
  const reads=[],writes=[];
  const caller={from(table){
    reads.push(['table',table]);
    const query={eq(k,v){reads.push([k,v]);return query;},maybeSingle(){return Promise.resolve({data:row,error:readError});}};
    return {select(columns){reads.push(['columns',columns]);return query;}};
  },rpc(name,args){writes.push([name,args]);return Promise.resolve({data:{id:agreement,title:'Revised',status:'draft'},error:writeError});}};
  return {caller,reads,writes};
}
const input=p=>({caller:p.caller,expectedTenantId:tenant,contactId:contact,title:'Revised',bodyMarkdown:'Owner-approved text',agreementId:agreement,expectedUpdatedAt:stamp});

test('revision preserves canonical offer, terms and template source through the existing writer',async()=>{
  const p=port();const result=await draftAgreement(input(p));
  assert.equal(result.success,true);assert.equal(result.created,false);
  assert.deepEqual(p.writes,[['save_paige_agreement',{
    _expected_tenant_id:tenant,_agreement_id:agreement,_contact_id:contact,_title:'Revised',_body_markdown:'Owner-approved text',
    _offer_id:offer,_commercial_terms_id:terms,_body_source:'tenant_template',_source_version_id:template,_document_path:null,_expected_updated_at:stamp,
  }]]);
  assert.ok(p.reads.some(x=>x[0]==='tenant_id'&&x[1]===tenant));
  assert.ok(p.reads.some(x=>x[0]==='id'&&x[1]===agreement));
});
test('revision without an approved source timestamp attempts no read or write',async()=>{
  for(const expectedUpdatedAt of [undefined,null,'','not-a-date']){
    const p=port();const r=await draftAgreement({...input(p),expectedUpdatedAt});
    assert.equal(r.success,false);assert.equal(p.reads.length,0);assert.equal(p.writes.length,0);
  }
});
test('new drafts still use the incumbent create path without a revision read',async()=>{
  const p=port();const r=await draftAgreement({...input(p),agreementId:undefined,expectedUpdatedAt:undefined});
  assert.equal(r.success,true);assert.equal(r.created,true);assert.equal(p.reads.length,0);
  assert.equal(p.writes[0][1]._agreement_id,null);
});
test('stale approved source is refused instead of adopting the latest timestamp',async()=>{
  const p=port({...source,updated_at:'2026-10-02T12:00:00.123456+00:00'});
  const r=await draftAgreement(input(p));assert.equal(r.success,false);assert.equal(r.reason,'conflict');assert.equal(p.writes.length,0);
});
test('foreign agreement, workspace or contact cannot be adopted during revision',async()=>{
  for(const row of [{...source,id:offer},{...source,tenant_id:offer},{...source,contact_id:offer},null]){
    const p=port(row);const r=await draftAgreement(input(p));assert.equal(r.success,false);assert.equal(p.writes.length,0);
  }
});
test('sent or signed agreements never reach the draft writer',async()=>{
  for(const status of ['sent','viewed','partially_signed','completed','voided','expired','declined']){
    const p=port({...source,status});const r=await draftAgreement(input(p));assert.equal(r.success,false);assert.equal(p.writes.length,0);
  }
});
test('uploaded document is preserved by refusing a markdown rewrite',async()=>{
  const p=port({...source,body_source:'tenant_upload',source_version_id:null,document_path:'fixture/document.pdf'});
  const r=await draftAgreement(input(p));assert.equal(r.success,false);assert.equal(p.writes.length,0);assert.match(r.message,/uploaded/i);
});
test('malformed or incomplete provenance is refused without inventing defaults',async()=>{
  for(const row of [{...source,body_source:'unknown'},{...source,offer_id:'invalid'},{...source,commercial_terms_id:undefined},{...source,source_version_id:null},{...source,document_path:'unexpected.pdf'}]){
    const p=port(row);const r=await draftAgreement(input(p));assert.equal(r.success,false);assert.equal(p.writes.length,0);
  }
});
test('unbound markdown draft retains null bindings and its actual body source',async()=>{
  const p=port({...source,body_source:'paige_draft',offer_id:null,commercial_terms_id:null,source_version_id:null});
  const r=await draftAgreement(input(p));assert.equal(r.success,true);
  assert.equal(p.writes[0][1]._offer_id,null);assert.equal(p.writes[0][1]._commercial_terms_id,null);assert.equal(p.writes[0][1]._body_source,'paige_draft');
});
test('concurrent change after the read remains guarded by the original approved timestamp',async()=>{
  const p=port(source,null,{code:'40001',message:'fixture concurrent change'});const r=await draftAgreement(input(p));
  assert.equal(p.writes[0][1]._expected_updated_at,stamp);assert.equal(r.success,false);assert.equal(r.reason,'conflict');
});
test('read refusals and transport faults attempt no write and expose no database details',async()=>{
  const p=port(null,{code:'42501',message:'fixture private database details'});const r=await draftAgreement(input(p));
  assert.equal(r.success,false);assert.equal(p.writes.length,0);assert.doesNotMatch(r.message,/fixture private/);
  const q=port();q.caller.from=()=>{throw new Error('fixture private transport');};
  const s=await draftAgreement(input(q));assert.equal(s.success,false);assert.equal(q.writes.length,0);assert.doesNotMatch(s.message,/fixture private/);
});
test('write transport uncertainty requires inspection instead of a blind duplicate retry',async()=>{
  const p=port();p.caller.rpc=()=>Promise.reject(new Error('fixture dropped response'));
  const r=await draftAgreement(input(p));assert.equal(r.success,false);assert.equal(r.reason,'no_readback');assert.doesNotMatch(r.message,/try again|nothing was written/i);
});
test('foreign or non-draft write readback cannot become success',async()=>{
  for(const data of [{id:offer,status:'draft'},{id:agreement,status:'completed'},{id:'invalid',status:'draft'}]){
    const p=port();p.caller.rpc=()=>Promise.resolve({data,error:null});
    const r=await draftAgreement(input(p));assert.equal(r.success,false);assert.equal(r.reason,'no_readback');
  }
});
