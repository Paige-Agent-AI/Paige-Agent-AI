import {describe, expect, it} from 'vitest';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model.ts';
import {previewCollectionSchedule} from '../../supabase/functions/_shared/sales-collections/model.ts';

const intent = {total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-05',installment_cents:30000,first_installment_date:'2026-11-01',cadence:'monthly'};
describe('COMMERCIAL-ASSEMBLY-01 deterministic schedule foundation',()=>{
 it('represents a 500 deposit plus ten monthly 300 payments without a percentage approximation',()=>{
  const result=assembleFixedRepaymentSchedule(intent);
  expect(result.state).toBe('ready');if(result.state!=='ready')throw Error('schedule unavailable');
  expect(result.deposit_cents).toBe(50000);expect(result.remaining_after_deposit_cents).toBe(300000);
  expect(result.installment_count).toBe(10);expect(result.rows.map(r=>r.amount_cents)).toEqual([50000,...Array(10).fill(30000)]);
  expect(result.rows.map(r=>r.due_date)).toEqual(['2026-10-05','2026-11-01','2026-12-01','2027-01-01','2027-02-01','2027-03-01','2027-04-01','2027-05-01','2027-06-01','2027-07-01','2027-08-01']);
  expect(previewCollectionSchedule(result.terms).rows).toEqual(result.rows);
  expect(result.rows.reduce((sum,r)=>sum+r.amount_cents,0)).toBe(350000);
 });
 it('asks for the missing first payment date instead of guessing today or next month',()=>{
  expect(assembleFixedRepaymentSchedule({...intent,first_installment_date:undefined})).toEqual({state:'needs_input',fields:['first_installment_date']});
 });
 it('asks for missing currency and deposit date without inventing USD or collection timing',()=>{
  expect(assembleFixedRepaymentSchedule({...intent,currency:undefined,deposit_date:undefined})).toEqual({state:'needs_input',fields:['currency','deposit_date']});
 });
 it('keeps a smaller last installment in integer minor units',()=>{
  const result=assembleFixedRepaymentSchedule({...intent,total_cents:350001});
  if(result.state!=='ready')throw Error('schedule unavailable');
  expect(result.rows.at(-1)?.amount_cents).toBe(1);expect(result.installment_count).toBe(11);
  expect(result.rows.reduce((s,r)=>s+r.amount_cents,0)).toBe(350001);
 });
 it('anchors monthly and quarterly dates to the original day through leap and month-end dates',()=>{
  const result=assembleFixedRepaymentSchedule({...intent,deposit_cents:0,deposit_date:undefined,total_cents:900,installment_cents:300,first_installment_date:'2024-01-31'});
  if(result.state!=='ready')throw Error();expect(result.rows.map(r=>r.due_date)).toEqual(['2024-01-31','2024-02-29','2024-03-31']);
  const quarterly=assembleFixedRepaymentSchedule({...intent,deposit_cents:0,total_cents:900,installment_cents:300,first_installment_date:'2024-01-31',cadence:'quarterly'});
  if(quarterly.state!=='ready')throw Error();expect(quarterly.rows.map(r=>r.due_date)).toEqual(['2024-01-31','2024-04-30','2024-07-31']);
 });
 it('uses exact owner-provided custom dates and refuses insufficient dates',()=>{
  const input={...intent,total_cents:110000,cadence:'custom',first_installment_date:undefined,custom_dates:['2026-11-02','2026-12-14']};
  const result=assembleFixedRepaymentSchedule(input);if(result.state!=='ready')throw Error();
  expect(result.rows.map(r=>r.due_date)).toEqual(['2026-10-05','2026-11-02','2026-12-14']);
  expect(assembleFixedRepaymentSchedule({...input,custom_dates:['2026-11-02']})).toMatchObject({state:'refused',code:'CUSTOM_DATES_COUNT_MISMATCH'});
 });
 it.each([0,-1,1.5,NaN,Infinity,2147483648,Number.MAX_SAFE_INTEGER])('refuses invalid or out-of-range total %s',total_cents=>{
  expect(assembleFixedRepaymentSchedule({...intent,total_cents})).toMatchObject({state:'refused'});
 });
 it('refuses conflicting dates, invalid calendars and unbounded schedules',()=>{
  for(const patch of [{deposit_date:'2026-11-01'},{first_installment_date:'2026-02-30'},{installment_cents:1},{cadence:'weekly'},{deposit_cents:350000}]){
   expect(assembleFixedRepaymentSchedule({...intent,...patch})).toMatchObject({state:'refused'});
  }
 });
 it('does not accept model authority or financial truth fields',()=>{
  expect(assembleFixedRepaymentSchedule({...intent,paid:true})).toMatchObject({state:'refused'});
  expect(assembleFixedRepaymentSchedule({...intent,approved:true})).toMatchObject({state:'refused'});
 });
});
