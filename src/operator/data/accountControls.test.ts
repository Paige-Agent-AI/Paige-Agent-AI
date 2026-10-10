import { describe, expect, it } from 'vitest';
import { accountEditReadback, parseAccountDeletionPreview,parseResourceReceipt } from './accountControls';

describe('operator account controls readback', () => {
  it('only accepts verified cached-file absence for permanent resource retirement',()=>{
    const row={tenant_id:'test-tenant-a',operation_id:'test-operation',mode:'delete',state:'resources_ready',account_count:1,results:[{provider:'tts_cache',state:'verified',provider_status:'removed',reason:null}]};
    expect(parseResourceReceipt('test-tenant-a','test-operation',row)).toEqual(row);
    for(const value of [{...row,mode:'archive'},{...row,results:[{...row.results[0],provider_status:'present'}]},{...row,results:[{...row.results[0],state:'unknown'}]}])expect(()=>parseResourceReceipt('test-tenant-a','test-operation',value)).toThrow();
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
