import { beforeEach, describe, expect, it, vi } from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {prepareAgreementCorrection,saveAgreementCorrection,type AgreementCorrectionCommand} from './agreementCorrectionApi';
import type {AgreementPreparation} from './agreementPreparationApi';

const tenant='aaaaaaaa-0000-4000-8000-000000000001',id='bbbbbbbb-0000-4000-8000-000000000001';
const client='cccccccc-0000-4000-8000-000000000001',offer='dddddddd-0000-4000-8000-000000000001';
const terms='eeeeeeee-0000-4000-8000-000000000001',template='ffffffff-0000-4000-8000-000000000001';
const before='2026-10-21T20:00:00.123456+00:00',after='2026-10-21T20:01:00.654321+00:00';
const original=():AgreementPreparation['agreement']=>({id,contact_id:client,offer_id:offer,commercial_terms_id:terms,
  title:'Original title',body_markdown:'Original wording',body_source:'tenant_template',source_version_id:template,
  status:'draft',version:3,updated_at:before,expires_at:null,can_edit:true,has_source_document:false,content_sha256:null,sealed_sha256:null});
const prepared=()=>prepareAgreementCorrection(tenant,original(),' Corrected title ',' Corrected wording ')!;
const saved=()=>({id,tenant_id:tenant,contact_id:client,offer_id:offer,commercial_terms_id:terms,title:'Corrected title',
  body_markdown:'Corrected wording',body_source:'tenant_template',source_version_id:template,status:'draft',version:4,updated_at:after});
beforeEach(()=>rpc.mockReset());

describe('original agreement correction boundary',()=>{
  it('freezes original identity, exact timestamp and reviewed text; sends only original SAVE/CAS',async()=>{
    const command=prepared(); expect(Object.isFrozen(command)).toBe(true);
    rpc.mockResolvedValue({data:{...saved(),document_path:'synthetic-private-object',draft_request_sha256:'synthetic-private-request'},error:null});
    const result=await saveAgreementCorrection(command);
    expect(result).toEqual({ok:true,value:{agreementId:id,version:4,updatedAt:after}});
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('save_paige_agreement',{_expected_tenant_id:tenant,_agreement_id:id,_contact_id:client,
      _title:' Corrected title ',_body_markdown:' Corrected wording ',_offer_id:offer,_commercial_terms_id:terms,
      _body_source:'tenant_template',_source_version_id:template,_document_path:null,_expected_updated_at:before});
  });
  it('retains the original content counter for a title-only correction',async()=>{
    const command=prepareAgreementCorrection(tenant,original(),'Corrected title','Original wording')!;
    expect(command.expectedVersion).toBe(3);
    rpc.mockResolvedValue({data:{...saved(),body_markdown:'Original wording',version:3},error:null});
    expect(await saveAgreementCorrection(command)).toMatchObject({ok:true,value:{version:3}});
  });
  it('preserves native line breaks and tabs rather than inventing JS trim receipt semantics',async()=>{
    const body=' \n\tReviewed clause. \n ';
    const command=prepareAgreementCorrection(tenant,original(),'Corrected title',body)!;
    rpc.mockResolvedValue({data:{...saved(),body_markdown:'\n\tReviewed clause. \n'},error:null});
    expect(await saveAgreementCorrection(command)).toMatchObject({ok:true,value:{version:4}});
    expect(rpc.mock.calls[0][1]._body_markdown).toBe(body);
    rpc.mockResolvedValue({data:{...saved(),body_markdown:'Reviewed clause.'},error:null});
    expect(await saveAgreementCorrection(command)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('does not increment the native content counter when only the title changes beside a final newline',async()=>{
    const source={...original(),body_markdown:'Original wording\n'};
    const command=prepareAgreementCorrection(tenant,source,'Corrected title','Original wording\n')!;
    expect(command.expectedVersion).toBe(3);
    rpc.mockResolvedValue({data:{...saved(),body_markdown:'Original wording\n',version:3},error:null});
    expect(await saveAgreementCorrection(command)).toMatchObject({ok:true,value:{version:3}});
  });
  it.each([{can_edit:false},{status:'completed'},{content_sha256:'a'.repeat(64)},{sealed_sha256:'b'.repeat(64)},
    {body_source:'tenant_upload',has_source_document:true,body_markdown:null},{updated_at:''},{source_version_id:null}])('withholds preparation for unavailable retained/source state %j',patch=>{
    expect(prepareAgreementCorrection(tenant,{...original(),...patch} as AgreementPreparation['agreement'],'Corrected','New text')).toBeNull();expect(rpc).not.toHaveBeenCalled();
  });
  it('does not submit unchanged wording or a missing original CAS',async()=>{
    expect(prepareAgreementCorrection(tenant,original(),'Original title','Original wording')).toBeNull();
    expect(await saveAgreementCorrection({...prepared(),expectedUpdatedAt:null} as unknown as AgreementCorrectionCommand)).toMatchObject({ok:false,reason:'refused'});
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{id:offer},{tenant_id:offer},{contact_id:offer},{offer_id:null},{commercial_terms_id:null},
    {source_version_id:null},{title:'Different title'},{body_markdown:'Different body'},{version:5},{updated_at:before},{status:'sent'}])('withholds acknowledgment for mismatched original/result %j',async patch=>{
    rpc.mockResolvedValue({data:{...saved(),...patch},error:null});
    expect(await saveAgreementCorrection(prepared())).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it.each([['42501','refused','authority'],['23514','refused','state'],['40001','conflict',undefined]])('distinguishes native refusal %s without returning private errors',async(code,reason,refusal)=>{
    rpc.mockResolvedValue({data:null,error:{code,message:'synthetic-private-native-body'}});
    const result=await saveAgreementCorrection(prepared());expect(result).toMatchObject({ok:false,reason});
    if(refusal)expect(result).toMatchObject({refusal});expect(JSON.stringify(result)).not.toContain('synthetic-private');
  });
  it('keeps a lost response unconfirmed and explicit retry uses the identical frozen CAS and payload',async()=>{
    const command=prepared();rpc.mockRejectedValueOnce(new Error('synthetic private transport')).mockResolvedValueOnce({data:null,error:{code:'40001'}});
    expect(await saveAgreementCorrection(command)).toMatchObject({ok:false,reason:'unconfirmed'});
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await saveAgreementCorrection(command)).toMatchObject({ok:false,reason:'conflict'});
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);expect(command.expectedUpdatedAt).toBe(before);
  });
});
