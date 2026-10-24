import {beforeEach,describe,expect,it,vi} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {listAgreementTemplates,prepareTemplateVersion,readAgreementTemplate,recoverTemplateCreation,saveTemplateVersion,
  unspecifiedTemplateOptions,type AgreementTemplateVersion} from './agreementTemplateApi';
const tenant='aaaaaaaa-0000-4000-8000-000000000001',id='bbbbbbbb-0000-4000-8000-000000000001',previous='cccccccc-0000-4000-8000-000000000001';
const at='2026-10-21T20:00:00.123456+00:00',after='2026-10-21T20:01:00.123456+00:00';
const source=():AgreementTemplateVersion=>({id:previous,template_slug:'service-'+previous,title:'Original business template',body_markdown:'Original supplied wording.',
  version:3,is_active:true,source_mode:'tenant_fork',preparation_options:{...unspecifiedTemplateOptions},preparation_purpose:'client_engagement',
  source_template_version_id:null,source_template_updated_at:null,has_uploaded_source:false,created_at:at,updated_at:at});
const prepared=()=>prepareTemplateVersion(tenant,id,source(),' Corrected template ','\nSupplied revised wording.\n',{jurisdiction:'Business jurisdiction',review_route:'qualified_legal',reviewer:null})!;
const receipt=()=>({id,template_slug:'service-'+previous,title:'Corrected template',body_markdown:'\nSupplied revised wording.\n',version:4,is_active:true,
  preparation_options:{jurisdiction:'Business jurisdiction',review_route:'qualified_legal',reviewer:null},preparation_purpose:'client_engagement',
  source_template_version_id:previous,source_template_updated_at:at,created_at:after,updated_at:after});
beforeEach(()=>rpc.mockReset());
describe('original business template native boundary',()=>{
  it('freezes one reviewed source/time and exact wording without inventing legal review',async()=>{
    const command=prepared();expect(Object.isFrozen(command)).toBe(true);expect(Object.isFrozen(command.options)).toBe(true);
    rpc.mockResolvedValue({data:receipt(),error:null});expect(await saveTemplateVersion(command)).toEqual({ok:true,value:receipt()});
    expect(rpc).toHaveBeenCalledExactlyOnceWith('create_agreement_template_version',{_expected_tenant_id:tenant,_version_id:id,_previous_version_id:previous,
      _title:' Corrected template ',_body_markdown:'\nSupplied revised wording.\n',_preparation_options:command.options,_expected_source_updated_at:at});
    expect(JSON.stringify(command)).not.toContain('review_completed');
  });
  it('allows new wording with unspecified jurisdiction and reviewer',()=>{
    const command=prepareTemplateVersion(tenant,id,null,'New business template','Supplied words.',{...unspecifiedTemplateOptions});
    expect(command).toMatchObject({previousVersionId:null,expectedSourceUpdatedAt:null,expectedVersion:1,expectedSlug:'service-'+id});
  });
  it('retains a legacy source explicitly without changing its original group/version',()=>{
    const original={...source(),preparation_purpose:null,preparation_options:null,template_slug:'original-legal-profile',version:8};
    expect(prepareTemplateVersion(tenant,id,original,'Client template','Owner-supplied words.',{...unspecifiedTemplateOptions})).toMatchObject({
      previousVersionId:previous,expectedSourceUpdatedAt:at,expectedVersion:1,expectedSlug:'service-'+id});
    expect(original.version).toBe(8);
  });
  it.each([{has_uploaded_source:true},{source_mode:'tenant_upload'},{body_markdown:null},{updated_at:''}])('withholds unsupported source %j',patch=>{
    expect(prepareTemplateVersion(tenant,id,{...source(),...patch} as AgreementTemplateVersion,'Title','Words',{...unspecifiedTemplateOptions})).toBeNull();expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{review_route:'approved'},{review_completed:true},{reviewer:'Hidden reviewer'},{jurisdiction:' '}])('refuses invented/malformed options %j',patch=>{
    expect(prepareTemplateVersion(tenant,id,null,'Title','Words',{...unspecifiedTemplateOptions,...patch} as never)).toBeNull();expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{id:previous},{template_slug:'other'},{version:5},{body_markdown:'Different words'},{source_template_version_id:null},
    {source_template_updated_at:after},{preparation_options:{...unspecifiedTemplateOptions}},{preparation_purpose:null},
    {document_path:'synthetic-private-locator'}])('keeps mismatched or nonclosed acknowledgment unconfirmed %j',async patch=>{
    rpc.mockResolvedValue({data:{...receipt(),...patch},error:null});expect(await saveTemplateVersion(prepared())).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('preserves identity and frozen source on explicit transport retry',async()=>{
    rpc.mockRejectedValueOnce(new Error('synthetic-private-transport')).mockResolvedValueOnce({data:receipt(),error:null});const command=prepared();
    expect(await saveTemplateVersion(command)).toMatchObject({ok:false,reason:'unconfirmed'});expect(rpc).toHaveBeenCalledTimes(1);
    expect(await saveTemplateVersion(command)).toMatchObject({ok:true});expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
  });
  it('reads exactly one original version without accepting another source',async()=>{
    rpc.mockResolvedValue({data:source(),error:null});expect(await readAgreementTemplate(tenant,previous)).toMatchObject({ok:true,value:{id:previous}});
    expect(await readAgreementTemplate(tenant,id)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('distinguishes pending creation from access refusal and never substitutes another recovered ID',async()=>{
    rpc.mockResolvedValueOnce({data:{state:'unconfirmed'},error:null}).mockResolvedValueOnce({data:null,error:{code:'42501',message:'synthetic-private-auth'}})
      .mockResolvedValueOnce({data:{state:'recovered',version_record:source()},error:null});
    expect(await recoverTemplateCreation(tenant,id)).toEqual({ok:true,value:{state:'unconfirmed'}});
    const refused=await recoverTemplateCreation(tenant,id);expect(refused).toMatchObject({ok:false,reason:'refused'});expect(JSON.stringify(refused)).not.toContain('synthetic-private');
    expect(await recoverTemplateCreation(tenant,id)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('returns metadata without fetching wording, and rejects duplicate/corrupt cursors',async()=>{
    const {body_markdown:unused,...row}=source();void unused;
    rpc.mockResolvedValueOnce({data:{items:[row],next_cursor:null},error:null}).mockResolvedValueOnce({data:{items:[row,row],next_cursor:null},error:null})
      .mockResolvedValueOnce({data:{items:[row],next_cursor:{created_at:at,id:previous}},error:null});
    const result=await listAgreementTemplates(tenant);expect(result).toMatchObject({ok:true,value:{items:[row]}});expect(JSON.stringify(result)).not.toContain('body_markdown');
    expect(await listAgreementTemplates(tenant)).toMatchObject({ok:false,reason:'unconfirmed'});expect(await listAgreementTemplates(tenant)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('does not call native functions with a missing source/business identity',async()=>{
    expect(await readAgreementTemplate('',previous)).toMatchObject({ok:false,reason:'refused'});expect(await recoverTemplateCreation(tenant,'new')).toMatchObject({ok:false,reason:'refused'});
    expect(await saveTemplateVersion({...prepared(),expectedSourceUpdatedAt:null})).toMatchObject({ok:false,reason:'refused'});expect(rpc).not.toHaveBeenCalled();
  });
});
