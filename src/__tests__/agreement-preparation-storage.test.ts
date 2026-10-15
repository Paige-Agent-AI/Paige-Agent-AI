// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {e04CommercialFixture,e04Id} from '../test/fixtures/e04-commercial-presentation';
import {prepareRetainedAgreementArtifact} from '../../supabase/functions/_shared/agreements/prepare-retained';
const bytes=new TextEncoder().encode('%PDF-1.7\nSynthetic controlled renderer, not actual PDF proof.');
async function setup(){
 const f=await e04CommercialFixture(),renderer=vi.fn().mockResolvedValue(bytes),current=vi.fn().mockResolvedValue(true),upload=vi.fn().mockResolvedValue({error:null}),download=vi.fn().mockResolvedValue({data:new Blob([bytes]),error:null});
 const from=vi.fn().mockReturnValue({upload,download}),run=()=>prepareRetainedAgreementArtifact(f.tenant,f.operation,f.command,f.caller,{from},current,renderer);
 return {...f,renderer,current,upload,download,from,run};
}
it('renders exact canonical source, uploads once without overwrite, verifies actual owned bytes and returns only the internal artifact',async()=>{
 const f=await setup(),result=await f.run(),path=`${f.tenant}/${f.agreement}/presented-commercial-${f.operation}-${f.command.payload_digest}.pdf`;
 expect(f.from).toHaveBeenCalledExactlyOnceWith('paige-agreements');expect(f.upload).toHaveBeenCalledExactlyOnceWith(path,bytes,{contentType:'application/pdf',upsert:false});expect(f.download).toHaveBeenCalledExactlyOnceWith(path);
 expect(result.payload).toEqual(f.proposed.presentation.payload);expect(result.payload_digest).toBe(f.command.payload_digest);expect(result.content_storage_key).toBe(path);
 expect(f.renderer.mock.calls[0][0].bodyMarkdown).toContain('Service starts: 2026-11-01');expect(result).not.toHaveProperty('receipt_id');expect(result).not.toHaveProperty('operation');
});
it('adopts only identical readback from an interrupted original upload, keeping its exact path',async()=>{
 const f=await setup();f.upload.mockRejectedValue(Error('synthetic ambiguous upload'));const result=await f.run();expect(f.upload).toHaveBeenCalledTimes(1);expect(f.download).toHaveBeenCalledWith(result.content_storage_key);
});
it.each(['read_error','wrong_size','same_length_wrong_hash','invalid_header','read_throws'])('refuses unverified artifact %s without returning a business completion',async kind=>{
 const f=await setup();
 if(kind==='read_error')f.download.mockResolvedValue({data:new Blob([bytes]),error:{message:'private detail'}});
 if(kind==='wrong_size')f.download.mockResolvedValue({data:new Blob(['oversized or truncated']),error:null});
 if(kind==='same_length_wrong_hash'){const wrong=bytes.slice();wrong[wrong.length-1]^=1;f.download.mockResolvedValue({data:new Blob([wrong]),error:null});}
 if(kind==='invalid_header')f.renderer.mockResolvedValue(new TextEncoder().encode('not a PDF'));
 if(kind==='read_throws')f.download.mockRejectedValue(Error('private detail'));
 await expect(f.run()).rejects.toMatchObject({code:kind==='invalid_header'?'RENDER_UNAVAILABLE':'STORAGE_UNVERIFIED'});
 if(kind==='invalid_header')expect(f.upload).not.toHaveBeenCalled();
});
it('rejects changed canonical source before upload',async()=>{
 const f=await setup();f.rows.paige_agreements.body_markdown='Changed owner text';await expect(f.run()).rejects.toMatchObject({code:'SOURCE_CHANGED'});expect(f.upload).not.toHaveBeenCalled();
});
it('rejects current workspace/role loss before source or upload',async()=>{
 const f=await setup();f.authority.tenant=e04Id(99);await expect(f.run()).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});expect(f.renderer).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();
 const g=await setup();g.authority.admin=false;await expect(g.run()).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});expect(g.upload).not.toHaveBeenCalled();
});
it('retires workspace changes after render and after upload without asserting no storage effect',async()=>{
 const f=await setup();f.current.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);await expect(f.run()).rejects.toMatchObject({code:'WORKSPACE_CHANGED'});expect(f.upload).not.toHaveBeenCalled();
 const g=await setup();g.current.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);await expect(g.run()).rejects.toMatchObject({code:'WORKSPACE_CHANGED'});expect(g.upload).toHaveBeenCalledTimes(1);
});

it('known render failure before any upload is correctable rather than permanently uncertain',async()=>{
 const f=await setup();f.renderer.mockRejectedValue(Error('synthetic unsupported document'));
 await expect(f.run()).rejects.toMatchObject({code:'RENDER_UNAVAILABLE'});expect(f.upload).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();
});
