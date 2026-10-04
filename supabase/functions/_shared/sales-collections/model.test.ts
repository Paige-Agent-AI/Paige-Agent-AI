import { describe, expect, it } from 'vitest';
import { parseCollectionTerms } from './contract.ts';
import { previewCollectionSchedule, previewAgreedCharges } from './model.ts';

const plan = { schema_version: 1, kind: 'installment', currency: 'usd', total_cents: 1000, anchor_date: '2026-01-31', cadence: 'monthly', count: 3 };
describe('canonical commercial collection terms', () => {
  it('preserves integer total and original date anchor across month ends', () => {
    const result = previewCollectionSchedule(parseCollectionTerms(plan));
    expect(result.rows.map(r => r.due_date)).toEqual(['2026-01-31','2026-02-28','2026-03-31']);
    expect(result.rows.map(r => r.amount_cents)).toEqual([334,333,333]);
    expect(result.rows.reduce((sum,r) => sum+r.amount_cents,0)).toBe(1000);
  });
  it('supports annual leap anchor, quarterly and bounded open recurring', () => {
    expect(previewCollectionSchedule(parseCollectionTerms({ ...plan, kind: 'recurring', anchor_date:'2024-02-29', cadence:'annual', count:3 })).rows.map(r=>r.due_date)).toEqual(['2024-02-29','2025-02-28','2026-02-28']);
    const recurring = previewCollectionSchedule(parseCollectionTerms({ ...plan, kind:'recurring', cadence:'quarterly', count:null }), 5);
    expect(recurring.rows).toHaveLength(5); expect(recurring.has_more).toBe(true); expect(recurring.amount_basis).toBe('per_cycle');
    expect(recurring.rows.every(r=>r.amount_cents===1000)).toBe(true);
  });
  it('does not lose schedule obligations after an end date', () => {
    expect(()=>parseCollectionTerms({...plan,end_date:'2026-02-28'})).toThrow();
  });
  it('supports full, deposit, milestone and custom explicit dates without duplicating total', () => {
    expect(previewCollectionSchedule(parseCollectionTerms({...plan,kind:'full',count:1})).rows).toHaveLength(1);
    expect(previewCollectionSchedule(parseCollectionTerms({...plan,kind:'deposit',count:2,deposit_cents:200})).rows.map(r=>r.amount_cents)).toEqual([200,800]);
    for(const kind of ['milestone','custom']) {
      const rows=previewCollectionSchedule(parseCollectionTerms({...plan,kind,cadence:'custom',count:2,dates:[{due_date:'2026-01-31',amount_cents:400,label:'Start'},{due_date:'2026-03-01',amount_cents:600,label:'Finish'}]})).rows;
      expect(rows.map(r=>r.amount_cents)).toEqual([400,600]);
    }
  });
  it('preserves currency and defaults fees/interest to zero', () => {
    const terms=parseCollectionTerms({...plan,currency:'jpy'});
    expect(terms.currency).toBe('jpy'); expect(previewAgreedCharges(terms,1000,30)).toEqual({late_fee_cents:0,interest_cents:0,total_cents:0,provenance:'agreed_metadata_preview_only'});
  });
  it('requires explicit agreement basis for nonzero rates; preview never writes/accrues', () => {
    expect(()=>parseCollectionTerms({...plan,interest:{annual_bps:1000}})).toThrow();
    const terms=parseCollectionTerms({...plan,interest:{annual_bps:1000,agreement_basis:'Signed terms'},late_fee:{fixed_cents:10,rate_bps:0,grace_days:5,agreement_basis:'Signed terms'}});
    expect(previewAgreedCharges(terms,1000,365)).toMatchObject({interest_cents:100,late_fee_cents:10});
    expect(previewAgreedCharges(terms,1000,5)).toMatchObject({late_fee_cents:0});
  });
  it.each([{count:0},{count:1.5},{total_cents:NaN},{currency:'USD'},{anchor_date:'2026-02-30'},{cadence:'daily'},{authority:true},{dates:[{due_date:'2026-01-31',amount_cents:900}]}])('refuses invalid shape %j', patch=>expect(()=>parseCollectionTerms({...plan,...patch})).toThrow());
});
