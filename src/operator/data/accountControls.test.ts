import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { accountEditReadback, parseAccountDeletionPreview,parseResourceReceipt,previewRetirementResources } from './accountControls';

describe('operator account controls readback', () => {
  it.each(['tts_cache','generated_media','team_hub_files'])('only accepts verified %s file absence for permanent resource retirement',provider=>{
    const row={tenant_id:'test-tenant-a',operation_id:'test-operation',mode:'delete',state:'resources_ready',account_count:1,results:[{provider,state:'verified',provider_status:'removed',reason:null}]};
    expect(parseResourceReceipt('test-tenant-a','test-operation',row)).toEqual(row);
    for(const value of [{...row,mode:'archive'},{...row,results:[{...row.results[0],provider_status:'present'}]},{...row,results:[{...row.results[0],state:'unknown'}]}])expect(()=>parseResourceReceipt('test-tenant-a','test-operation',value)).toThrow();
  });
  it.each([['tts_cache','remove_cache'],['generated_media','remove_media'],['team_hub_files','remove_files']])('reads a delete preview listing %s with its own action, %s, and nothing else',async(provider,action)=>{
    const accounts=[{id:'test-tenant-a',name:'Example',account_type:'standalone'}];
    const row=(resource:Record<string,unknown>,mode='delete')=>({tenant_id:'test-tenant-a',accounts,blockers:[],execution_available:true,version:'files',mode,resources:[{provider,tenant_id:'test-tenant-a',action,object_count:3,...resource}]});
    rpc.mockResolvedValueOnce({data:row({}),error:null});
    expect((await previewRetirementResources('test-tenant-a','delete')).resources).toEqual([{provider,tenant_id:'test-tenant-a',action,object_count:3}]);
    for(const [value,mode] of [[row({action:'remove_media'===action?'remove_files':'remove_media'}),'delete'],[row({object_count:0}),'delete'],[row({object_count:101}),'delete'],[row({},'archive'),'archive']] as const){
      rpc.mockResolvedValueOnce({data:value,error:null});
      await expect(previewRetirementResources('test-tenant-a',mode)).rejects.toThrow('Provider scope could not be verified');
    }
  });
  it('refuses a foreign, mismatched or falsely ready provider receipt',()=>{
    const row={tenant_id:'test-tenant-a',operation_id:'test-operation',mode:'archive',state:'resources_ready',account_count:1,results:[{provider:'twilio',state:'verified',provider_status:'suspended',reason:null}]};
    expect(parseResourceReceipt('test-tenant-a','test-operation',row)).toEqual(row);
    for(const value of [{...row,tenant_id:'test-tenant-b'},{...row,operation_id:'foreign-operation'},{...row,results:[]},{...row,results:[{...row.results[0],state:'unknown'}]},{...row,results:[{...row.results[0],provider_status:'active'}]}])expect(()=>parseResourceReceipt('test-tenant-a','test-operation',value)).toThrow();
  });
  it('requires the exact target and saved values', () => {
    expect(accountEditReadback('test-tenant-a', 'Revised', 'active', { id: 'test-tenant-a', name: 'Revised', status: 'active' })).toBe(true);
    for (const row of [null, { id: 'test-tenant-b', name: 'Revised', status: 'active' }, { id: 'test-tenant-a', name: 'Old', status: 'active' }]) {
      expect(accountEditReadback('test-tenant-a', 'Revised', 'active', row)).toBe(false);
    }
  });
  it('refuses malformed or wrong-target deletion scope', () => {
    expect(() => parseAccountDeletionPreview('test-tenant-a', null)).toThrow();
    expect(() => parseAccountDeletionPreview('test-tenant-a', { tenant_id: 'test-tenant-b', accounts: [], blockers: [] })).toThrow();
    for (const accountType of [null, undefined, 1, false, {}]) {
      expect(() => parseAccountDeletionPreview('test-tenant-a', { tenant_id: 'test-tenant-a', accounts: [{ id: 'test-tenant-a', name: 'Example', account_type: accountType }], blockers: [], execution_available: false })).toThrow();
    }
  });
  it('keeps missing recovery/execution contracts visibly blocked', () => {
    const preview = parseAccountDeletionPreview('test-tenant-a', { tenant_id: 'test-tenant-a', accounts: [{id:'test-tenant-a',name:'Example Agency',account_type:'agency'}], blockers: ['Recovery procedure unavailable'], execution_available: false });
    expect(preview.blockers).toContain('Recovery procedure unavailable');
    expect(preview.execution_available).toBe(false);
  });
});
