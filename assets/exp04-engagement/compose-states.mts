import { readFileSync, writeFileSync } from 'node:fs';
import { composeClientEngagementStatus } from '../../supabase/functions/_shared/client-engagement/status.ts';
// Regenerates states.json from the real read fixture through the shared composer. Run from the repo root:
//   node --experimental-strip-types assets/exp04-engagement/compose-states.mts
// then re-inline it as STATES in prototype.html and re-run render.mjs.
const src = JSON.parse(readFileSync(new URL('../../src/__tests__/fixtures/exp04-client-status-source.json', import.meta.url),'utf8'));
const clone = () => structuredClone(src);
const populated = composeClientEngagementStatus(clone());
const early = clone(); // just signed-up: agreement out for signature, nothing paid yet, no work
early.signings[0].status='sent'; early.signings[0].sealed=false; early.signings[0].completed_at=null;
early.invoices = early.invoices.filter((i:any)=>i.invoice_number==='E4-0001').map((i:any)=>({...i,manual_recorded_minor:0,provider_verified_live_minor:0,provider_verified_test_minor:0,allocated_minor:0,remaining_minor:i.amount_minor,reversal_count:0,open_payment_requests:[],failed_payment_requests:0}));
early.work={...early.work,total:0,done:0,open:0,overdue:0,blocked:0,cancelled:0,undated_open:0,items:[]};
const empty = clone(); empty.terms=[];empty.signings=[];empty.invoices=[];empty.client_name='Test Empty Client';
empty.work={...empty.work,total:0,done:0,open:0,overdue:0,blocked:0,cancelled:0,undated_open:0,items:[]};
writeFileSync(new URL('./states.json', import.meta.url), JSON.stringify({
  populated, early: composeClientEngagementStatus(early), empty: composeClientEngagementStatus(empty) }, null, 2)+'\n');
console.log('ok');
