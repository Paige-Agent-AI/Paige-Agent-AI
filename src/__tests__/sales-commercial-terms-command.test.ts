import {describe,it,expect} from 'vitest';
import {parseCommercialTermsCreateCommand} from '../../supabase/functions/_shared/sales-commercial/terms-command';

const request={action:'collection.create_commercial_terms',client_id:'30000000-0000-4000-8000-000000000001',
 offer_id:'40000000-0000-4000-8000-000000000001',term_kind:'installment',agreed_amount_minor:350000,agreed_currency:'usd',
 billing_interval:'month',interval_count:1,installments_total:10,payment_schedule:'custom',starts_on:'2026-11-01',ends_on:null,title:null,notes:null};
describe('bounded canonical commercial record creation command',()=>{
 it('retains explicit obligation and cadence without constructing a schedule or granting authority',()=>expect(parseCommercialTermsCreateCommand(request)).toEqual(request));
 it('supports a fixed one-time obligation with explicitly absent recurring fields',()=>expect(parseCommercialTermsCreateCommand({...request,term_kind:'one_time',billing_interval:null,interval_count:null,installments_total:null})).toMatchObject({term_kind:'one_time',agreed_amount_minor:350000}));
 it('accepts quarterly intent as three calendar months without making date guesses',()=>expect(parseCommercialTermsCreateCommand({...request,interval_count:3})).toMatchObject({interval_count:3}));
 it.each(['actor_user_id','tenant_id','approved','governance','card_number','cvv','collection_terms','agreement_id'])('rejects untrusted or separate-act field %s',key=>expect(()=>parseCommercialTermsCreateCommand({...request,[key]:'unsafe'})).toThrow());
 it.each(['client_id','offer_id','starts_on','payment_schedule','notes'])('requires explicit %s',key=>{const input={...request} as Record<string,unknown>;delete input[key];expect(()=>parseCommercialTermsCreateCommand(input)).toThrow();});
 it.each([0,-1,3.5,2147483648,NaN])('rejects invalid minor amount %s',agreed_amount_minor=>expect(()=>parseCommercialTermsCreateCommand({...request,agreed_amount_minor})).toThrow());
 it.each(['2026-02-30','11/1/2026','2026-11-01T12:00:00Z'])('refuses guessed or invalid date %s',starts_on=>expect(()=>parseCommercialTermsCreateCommand({...request,starts_on})).toThrow());
 it('refuses end date before start',()=>expect(()=>parseCommercialTermsCreateCommand({...request,ends_on:'2026-10-01'})).toThrow());
 it('does not convert an indefinite recurring mandate into a fixed obligation',()=>expect(()=>parseCommercialTermsCreateCommand({...request,term_kind:'recurring'})).toThrow());
 it('does not coerce currency or money strings',()=>{expect(()=>parseCommercialTermsCreateCommand({...request,agreed_currency:'USD'})).toThrow();expect(()=>parseCommercialTermsCreateCommand({...request,agreed_amount_minor:'350000'})).toThrow();});
});
