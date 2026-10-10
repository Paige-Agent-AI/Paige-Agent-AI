import { describe, expect, it, vi } from 'vitest';
import { AccountFileCleanupError, deleteWithEligibleFiles, isEligibleFileReview } from './accountDeletion';
import { AccountRpcError, type LifecyclePreview, type ResourcePreview, type ResourceReceipt } from './accountControls';
const preview: LifecyclePreview = {tenant_id:'synthetic-a',archive_operation_id:'archive-a',accounts:[{id:'synthetic-a',name:'Example',account_type:'standalone'}],blockers:['Files need cleanup'],storage_count:2,execution_available:false,version:'before',data_version:'business-data'};
const files: ResourcePreview = {...preview,mode:'delete',blockers:[],execution_available:true,version:'files',resources:[{tenant_id:'synthetic-a',provider:'tts_cache',action:'remove_cache',object_count:1},{tenant_id:'synthetic-a',provider:'generated_media',action:'remove_media',object_count:1}]};
function fixture() {
 const io = {preview:vi.fn().mockResolvedValueOnce(preview).mockResolvedValue({...preview,version:'after',storage_count:0,blockers:[],execution_available:true}),run:vi.fn(),execute:vi.fn().mockResolvedValue({state:'deleted'})};
 io.run.mockImplementation(async (_id,operation,_action)=>({tenant_id:'synthetic-a',operation_id:operation,mode:'delete',account_count:1,state:io.run.mock.calls.length===1?'resources_preparing':'resources_ready',results:[{provider:'tts_cache',state:'verified',provider_status:'removed',reason:null},{provider:'generated_media',state:'verified',provider_status:'removed',reason:null}]} satisfies ResourceReceipt));
 return io;
}
describe('one confirmed Delete through existing Storage contracts',()=>{
 it('cleans supported files then deletes with fresh server version, without provider execution or another confirmation',async()=>{
  const io=fixture();expect(await deleteWithEligibleFiles('synthetic-a','archive-a','Example',preview,files,io)).toEqual({state:'deleted'});
  expect(io.run.mock.calls.map(c=>c[2])).toEqual(['prepare','continue']);expect(io.run.mock.calls[0][3]).toEqual(files);
  expect(io.execute).toHaveBeenCalledExactlyOnceWith('synthetic-a','delete','archive-a','Example','after');
 });
 it.each(['twilio','n8n'])('refuses a %s provider plan rather than executing external effects',async provider=>{
  const io=fixture(),foreign={...files,resources:[{...files.resources[0],provider}]} as ResourcePreview;
  expect(isEligibleFileReview(preview,foreign)).toBe(false);await expect(deleteWithEligibleFiles('synthetic-a','archive-a','Example',preview,foreign,io)).rejects.toBeInstanceOf(AccountRpcError);expect(io.run).not.toHaveBeenCalled();
 });
 it('starts no file removal when the server reports an independent dependency blocker',async()=>{
  const io=fixture(),blocked={...files,execution_available:false,blockers:['A linked record belongs to another account.']};
  await expect(deleteWithEligibleFiles('synthetic-a','archive-a','Example',preview,blocked,io)).rejects.toBeInstanceOf(AccountRpcError);
  expect(io.run).not.toHaveBeenCalled();expect(io.execute).not.toHaveBeenCalled();
 });
 it('refuses changed scope/data before file removal and after file removal',async()=>{
  for(const after of [false,true]) {
   const io=fixture();io.preview.mockReset();if(after)io.preview.mockResolvedValueOnce(preview);
   io.preview.mockResolvedValue({...preview,version:'changed',data_version:'new-data',execution_available:true});
   await expect(deleteWithEligibleFiles('synthetic-a','archive-a','Example',preview,files,io)).rejects.toMatchObject({code:'40001'});
   expect(io.execute).not.toHaveBeenCalled();if(!after)expect(io.run).not.toHaveBeenCalled();
  }
 });
 it.each(['resources_unknown','resources_failed'])('stops on %s; never retries or removes account',async state=>{
  const io=fixture();io.run.mockImplementation(async(_id,operation)=>({operation_id:operation,state}));
  await expect(deleteWithEligibleFiles('synthetic-a','archive-a','Example',preview,files,io)).rejects.toBeInstanceOf(AccountFileCleanupError);
  expect(io.run).toHaveBeenCalledTimes(1);expect(io.execute).not.toHaveBeenCalled();
 });
 it('binds confirmation, archive identity and exact tenant before any write',async()=>{
  for(const [id,archive,name] of [['foreign','archive-a','Example'],['synthetic-a','foreign','Example'],['synthetic-a','archive-a','wrong']]) {
   const io=fixture();await expect(deleteWithEligibleFiles(id,archive,name,preview,files,io)).rejects.toMatchObject({code:'40001'});expect(io.run).not.toHaveBeenCalled();
  }
 });
 it('records uncertain file request for readback without replaying it',async()=>{
  const io=fixture();io.run.mockRejectedValue(new Error('response lost'));
  await expect(deleteWithEligibleFiles('synthetic-a','archive-a','Example',preview,files,io)).rejects.toMatchObject({operationId:expect.any(String)});expect(io.run).toHaveBeenCalledTimes(1);expect(io.execute).not.toHaveBeenCalled();
 });
});
