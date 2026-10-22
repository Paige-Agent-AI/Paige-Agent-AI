import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgreementPreparation } from './agreementPreparationApi';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { canPrepareAgreementSigners, prepareAgreementSignerCommand, recoverAgreementSigner, saveAgreementSigner } from './agreementSignerApi';
const tenant='aaaaaaaa-0000-4000-8000-000000000001', agreement='bbbbbbbb-0000-4000-8000-000000000001', client='cccccccc-0000-4000-8000-000000000001', signer='dddddddd-0000-4000-8000-000000000001', event='eeeeeeee-0000-4000-8000-000000000001';
const at='2026-10-22T04:00:00.123456+00:00';
const original=():AgreementPreparation['agreement']=>({id:agreement,contact_id:client,offer_id:null,commercial_terms_id:null,title:'Supplied service agreement',body_source:'paige_draft',source_version_id:null,body_markdown:'Retained supplied wording.',has_source_document:false,status:'draft',version:7,updated_at:at,expires_at:null,can_edit:true,content_sha256:null,sealed_sha256:null});
const draft=()=>({fullName:'  Sample Recipient  ',email:'  Recipient@example.test  ',role:'counterparty' as const,order:''});
const command=()=>prepareAgreementSignerCommand(tenant,original(),signer,draft())!;
const receipt=()=>({schema_version:1,state:'recorded',agreement_id:agreement,client_id:client,signer_id:signer,full_name:'Sample Recipient',email:'recipient@example.test',signer_role:'counterparty',signing_order:3,status:'pending',source_version:8,source_updated_at:at,event_id:event});
beforeEach(()=>rpc.mockReset());
afterEach(()=>vi.useRealTimers());
describe('original checked signer preparation boundary',()=>{
  it('captures exact original source/client/time and native normalized intent with one immutable signer identity',async()=>{
    const c=command();expect(c).toMatchObject({expectedUpdatedAt:at,expectedVersion:7,fullName:'Sample Recipient',email:'recipient@example.test',order:null});expect(Object.isFrozen(c)).toBe(true);
    rpc.mockResolvedValue({data:receipt(),error:null});expect(await saveAgreementSigner(c)).toMatchObject({ok:true,value:{event_id:event}});
    expect(rpc).toHaveBeenCalledWith('prepare_agreement_signer',{_expected_tenant_id:tenant,_signing_id:agreement,_expected_contact_id:client,_expected_version:7,_expected_updated_at:at,_signer_id:signer,_full_name:'Sample Recipient',_email:'recipient@example.test',_signer_role:'counterparty',_signing_order:null});
  });
  it('accepts native same-request replay without promoting it to a signature or send',async()=>{
    rpc.mockResolvedValue({data:{...receipt(),state:'replayed'},error:null});expect(await saveAgreementSigner(command())).toMatchObject({ok:true,value:{state:'replayed',status:'pending'}});expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{can_edit:false},{status:'sent'},{status:'completed'},{content_sha256:'a'.repeat(64)},{sealed_sha256:'b'.repeat(64)}])('does not prepare a retained or unauthorized source %j',patch=>{
    const a=original();Object.assign(a,patch);expect(canPrepareAgreementSigners(a)).toBe(false);expect(prepareAgreementSignerCommand(tenant,a,signer,draft())).toBeNull();expect(rpc).not.toHaveBeenCalled();
  });
  it('preserves legitimate uploaded-document party preparation before retaining its reviewed version',()=>{
    const a=original();Object.assign(a,{body_source:'tenant_upload',body_markdown:null,has_source_document:true});expect(prepareAgreementSignerCommand(tenant,a,signer,draft())).not.toBeNull();
  });
  it.each([{fullName:''},{fullName:'\t\n'},{fullName:'x'.repeat(201)},{email:'recipient@invalid'},{role:'owner'},{order:'0'},{order:'1.2'},{order:'1e2'},{order:'2147483648'}])('rejects unsupported details before RPC %j',patch=>{
    expect(prepareAgreementSignerCommand(tenant,original(),signer,{...draft(),...patch} as never)).toBeNull();expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{agreement_id:event},{client_id:event},{signer_id:event},{full_name:'Different person'},{email:'different@example.test'},{signer_role:'witness'},{source_version:9},{state:'recovered'},{status:'signed'},{event_id:null},{secret:'synthetic private value'}])('withholds success for mismatched/expanded original receipts %j',async patch=>{
    rpc.mockResolvedValue({data:{...receipt(),...patch},error:null});const result=await saveAgreementSigner(command());expect(result).toMatchObject({ok:false,reason:'unconfirmed'});expect(JSON.stringify(result)).not.toContain('synthetic private value');
  });
  it('requires an exact explicitly assigned position',async()=>{
    const c=prepareAgreementSignerCommand(tenant,original(),signer,{...draft(),order:'2'})!;
    rpc.mockResolvedValue({data:receipt(),error:null});expect(await saveAgreementSigner(c)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it.each([['42501','refused','authority'],['40001','conflict',undefined],['23505','refused','state'],['23514','refused','state'],['55000','unconfirmed',undefined]])('separates native %s without echoing sensitive errors',async(code,reason,refusal)=>{
    rpc.mockResolvedValue({data:null,error:{code,message:'synthetic private failure'}});const result=await saveAgreementSigner(command());expect(result).toMatchObject({ok:false,reason,...(refusal?{refusal}:{})});expect(JSON.stringify(result)).not.toContain('synthetic private failure');
  });
  it('recovers only through the original opaque signer and original client binding',async()=>{
    rpc.mockResolvedValue({data:{...receipt(),state:'recovered'},error:null});expect(await recoverAgreementSigner(tenant,agreement,client,signer)).toMatchObject({ok:true,value:{state:'recovered',event_id:event}});
    expect(rpc).toHaveBeenCalledWith('recover_agreement_signer_preparation',{_expected_tenant_id:tenant,_signing_id:agreement,_signer_id:signer});
    rpc.mockResolvedValue({data:{...receipt(),state:'recovered',client_id:event},error:null});expect(await recoverAgreementSigner(tenant,agreement,client,signer)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('keeps absent recovery unconfirmed and never recreates the signer',async()=>{
    rpc.mockResolvedValue({data:{state:'unconfirmed'},error:null});expect(await recoverAgreementSigner(tenant,agreement,client,signer)).toEqual({ok:true,value:{state:'unconfirmed'}});expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('never issues a native write/read for malformed request identities',async()=>{
    await saveAgreementSigner({...command(),signerId:'missing'});await recoverAgreementSigner(tenant,agreement,'missing',signer);expect(rpc).not.toHaveBeenCalled();
  });
  it('bounds a lost response and never converts the late acknowledgment to success',async()=>{
    vi.useFakeTimers();let resolve!:(value:unknown)=>void;rpc.mockReturnValue(new Promise(done=>{resolve=done;}));const waiting=saveAgreementSigner(command());await vi.advanceTimersByTimeAsync(20_001);const result=await waiting;expect(result).toMatchObject({ok:false,reason:'unconfirmed'});resolve({data:receipt(),error:null});await Promise.resolve();expect(result.ok).toBe(false);expect(vi.getTimerCount()).toBe(0);
  });
});
