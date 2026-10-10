import { describe, expect, it } from 'vitest';
import { accountEditReadback, parseAccountDeletionPreview } from './accountControls';

describe('operator account controls readback', () => {
  it('requires the exact target and saved values', () => {
    expect(accountEditReadback('test-tenant-a', 'Revised', 'active', { id: 'test-tenant-a', name: 'Revised', status: 'active' })).toBe(true);
    for (const row of [null, { id: 'test-tenant-b', name: 'Revised', status: 'active' }, { id: 'test-tenant-a', name: 'Old', status: 'active' }]) {
      expect(accountEditReadback('test-tenant-a', 'Revised', 'active', row)).toBe(false);
    }
  });
  it('refuses malformed or wrong-target deletion scope', () => {
    expect(() => parseAccountDeletionPreview('test-tenant-a', null)).toThrow();
    expect(() => parseAccountDeletionPreview('test-tenant-a', { tenant_id: 'test-tenant-b', accounts: [], blockers: [] })).toThrow();
  });
  it('keeps missing recovery/execution contracts visibly blocked', () => {
    const preview = parseAccountDeletionPreview('test-tenant-a', { tenant_id: 'test-tenant-a', accounts: [{id:'test-tenant-a',name:'Example Agency',account_type:'agency'}], blockers: ['Recovery procedure unavailable'], execution_available: false });
    expect(preview.blockers).toContain('Recovery procedure unavailable');
    expect(preview.execution_available).toBe(false);
  });
});
