import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { readAgreementRetainedWording, readAgreementRevisions } from './agreementRevisionApi';
const tenant='aaaaaaaa-0000-4000-8000-000000000001',agreement='bbbbbbbb-0000-4000-8000-000000000001';
const revision='cccccccc-0000-4000-8000-000000000001',other='dddddddd-0000-4000-8000-000000000001';
const at='2026-10-21T20:00:00.123456+00:00';
const row=()=>({id:revision,revision_no:3,source_body_version:2,source_updated_at:at,title:'Retained title',body_source:'paige_draft',retained_at:at,retained_by:null,snapshot_sha256:'a'.repeat(64)});
const page=()=>({agreement_id:agreement,current_source_version:2,current_updated_at:at,revisions:[row()],truncated:false,next_before_revision_no:null});
const wording=()=>({...row(),agreement_id:agreement,contact_id:other,offer_id:null,commercial_terms_id:null,source_version_id:null,body_markdown:'Actual synthetic wording',has_source_document:false});
const answer=(data:unknown)=>rpc.mockResolvedValue({data,error:null});
beforeEach(()=>rpc.mockReset());
describe('original agreement retained-wording transport',()=>{
  it('reads one bounded original-agreement page without confusing occurrence and body version',async()=>{
    answer(page());expect(await readAgreementRevisions(tenant,agreement.toUpperCase())).toMatchObject({ok:true,value:{revisions:[{revision_no:3,source_body_version:2}]}});
    expect(rpc).toHaveBeenCalledWith('read_paige_agreement_draft_revisions',{_expected_tenant_id:tenant,_signing_id:agreement.toUpperCase(),_limit:20,_before_revision_no:null});
  });
  it('keeps an actual empty historical page distinct from failed reads',async()=>{
    answer({...page(),revisions:[]});expect(await readAgreementRevisions(tenant,agreement)).toMatchObject({ok:true,value:{revisions:[],truncated:false}});
    rpc.mockResolvedValue({data:null,error:{code:'XX000',message:'private provider detail'}});const result=await readAgreementRevisions(tenant,agreement);expect(result).toMatchObject({ok:false,reason:'unconfirmed'});expect(JSON.stringify(result)).not.toContain('private provider');
  });
  it.each([
    { ...page(), agreement_id:other },
    { ...page(), revisions:[row(),row()] },
    { ...page(), revisions:[row(),{...row(),id:other,revision_no:4}] },
    { ...page(), truncated:true,next_before_revision_no:null },
    { ...page(), next_before_revision_no:3 },
    { ...page(), truncated:true,next_before_revision_no:2 },
    { ...page(), document_path:'private-synthetic-key' },
    { ...page(), revisions:[{...row(),body_markdown:'private-synthetic-wording'}] },
  ])('refuses foreign, expanded, repeated or misleading pagination data',async data=>{
    answer(data);const result=await readAgreementRevisions(tenant,agreement);expect(result).toMatchObject({ok:false,reason:'unconfirmed'});expect(JSON.stringify(result)).not.toContain('private-synthetic');
  });
  it('carries a strict decreasing cursor and refuses a repeated prior page',async()=>{
    answer(page());expect(await readAgreementRevisions(tenant,agreement,4)).toMatchObject({ok:true});
    expect(rpc).toHaveBeenLastCalledWith('read_paige_agreement_draft_revisions',expect.objectContaining({_before_revision_no:4}));
    expect(await readAgreementRevisions(tenant,agreement,3)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it.each([0,-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1])('refuses an invalid cursor before network access',async before=>{
    expect(await readAgreementRevisions(tenant,agreement,before)).toMatchObject({ok:false,reason:'refused'});expect(rpc).not.toHaveBeenCalled();
  });
  it('requires the exact selected original and revision for wording',async()=>{
    answer(wording());expect(await readAgreementRetainedWording(tenant,agreement,revision.toUpperCase())).toMatchObject({ok:true,value:{body_markdown:'Actual synthetic wording'}});
    answer({...wording(),agreement_id:other});expect(await readAgreementRetainedWording(tenant,agreement,revision)).toMatchObject({ok:false,reason:'unconfirmed'});
    answer({...wording(),id:other});expect(await readAgreementRetainedWording(tenant,agreement,revision)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it.each([
    {...wording(),document_path:'private-synthetic-key'},
    {...wording(),token:'private-synthetic-token'},
    {...wording(),body_markdown:null},
    {...wording(),body_source:'tenant_upload',has_source_document:true},
    {...wording(),has_source_document:true},
    {...wording(),snapshot_sha256:'bad-checksum'},
  ])('does not expose unverified wording or private expanded source data',async data=>{
    answer(data);const result=await readAgreementRetainedWording(tenant,agreement,revision);expect(result).toMatchObject({ok:false,reason:'unconfirmed'});expect(JSON.stringify(result)).not.toContain('private-synthetic');
  });
  it('distinguishes an uploaded-source reference from actual readable bytes',async()=>{
    answer({...wording(),body_source:'tenant_upload',has_source_document:true,body_markdown:null});expect(await readAgreementRetainedWording(tenant,agreement,revision)).toMatchObject({ok:true,value:{body_markdown:null,has_source_document:true}});
  });
  it('preserves native authority refusal and never invokes a write',async()=>{
    rpc.mockResolvedValue({data:null,error:{code:'42501'}});expect(await readAgreementRevisions(tenant,agreement)).toMatchObject({ok:false,reason:'refused'});
    expect(await readAgreementRetainedWording('invalid',agreement,revision)).toMatchObject({ok:false,reason:'refused'});expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.every(([name])=>String(name).startsWith('read_paige_agreement_draft_revision'))).toBe(true);
  });
});
