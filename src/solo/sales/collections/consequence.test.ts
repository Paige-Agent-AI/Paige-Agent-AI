import {describe,it,expect} from 'vitest';
import {readReceiptConsequence} from './consequence';
const invoice='22222222-2222-4222-8222-222222222222';
const command={action:'collection.record_receipt' as const,invoice_id:invoice,expected_version:1,amount_cents:10000,currency:'usd',method:'cash' as const,received_at:'2026-10-04T12:00:00.000Z',reference:null,notes:null};
const consequence={invoice_number:'SOURCE-1',currency:'usd',original_total_cents:100000,remaining_cents:60000,amount_cents:10000,method:'cash',received_at:command.received_at,resulting_remaining_cents:50000};
describe('Authoritative collection receipt review',()=>{
 it('accepts exact captured receipt consequence and preserves current outstanding',()=>{expect(readReceiptConsequence(consequence,command)).toEqual(consequence)});
 it('refuses absent, foreign amount/date/method and inconsistent balances',()=>{for(const value of [null,{...consequence,amount_cents:20000},{...consequence,received_at:'2026-10-03T12:00:00Z'},{...consequence,method:'wire'},{...consequence,resulting_remaining_cents:60000},{...consequence,notes:'private'}])expect(readReceiptConsequence(value,command)).toBeNull()});
 it('uses canonical original receipt facts for a traceable reversal',()=>{const reverse={action:'collection.reverse_receipt' as const,invoice_id:invoice,expected_version:2,payment_id:'33333333-3333-4333-8333-333333333333',reason:'Mistaken receipt'};expect(readReceiptConsequence({...consequence,resulting_remaining_cents:70000},reverse)?.amount_cents).toBe(10000);expect(readReceiptConsequence(consequence,reverse)).toBeNull()});
});
