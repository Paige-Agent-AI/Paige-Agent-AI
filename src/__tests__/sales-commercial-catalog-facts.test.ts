import {describe,it,expect} from 'vitest';
import {validateCatalogPriceFacts} from '../../supabase/functions/_shared/sales-commercial/catalog-facts';
const price='40000000-0000-4000-8000-000000000001',product='50000000-0000-4000-8000-000000000001';
const fact={price_id:price,product_id:product,product_name:'Service',unit_minor:350000,currency:'usd',kind:'one_time',billing_interval:'one_time',interval_count:null,installments_total:null,active:true,product_status:'active'};
const draft={kind:'deposit',items:[{price_id:price},{price_id:price},{price_id:null}]};
describe('server-resolved catalog review facts',()=>{
 it('one source fact covers repeated line references without inventing quantity or invoice totals',()=>{expect(validateCatalogPriceFacts(draft,[fact])).toEqual([fact]);expect(validateCatalogPriceFacts(draft,[fact])[0]).not.toHaveProperty('total_minor')});
 it.each([{price_id:product},{product_id:'invented'},{unit_minor:1.5},{unit_minor:0},{unit_minor:2147483648},{currency:'eur'},{active:false},{product_status:'paused'},{product_name:' '},{product_name:'x'.repeat(201)},{kind:'deposit'},{kind:'installment'},{billing_interval:'year'},{installments_total:10},{stripe_price_id:'price_provider'}])('refuses unsupported or substituted facts %j',patch=>{expect(()=>validateCatalogPriceFacts(draft,[{...fact,...patch}])).toThrow()});
 it('refuses missing, duplicate and unselected prices',()=>{for(const facts of [[],[fact,fact],[{...fact,price_id:product}]])expect(()=>validateCatalogPriceFacts(draft,facts)).toThrow()});
 it('monthly cycle price stays a cycle fact and cannot satisfy a finite obligation',()=>{const monthly={...fact,kind:'recurring',billing_interval:'month',interval_count:1,unit_minor:30000};expect(validateCatalogPriceFacts({...draft,kind:'recurring'},[monthly])[0].unit_minor).toBe(30000);expect(()=>validateCatalogPriceFacts(draft,[monthly])).toThrow();expect(()=>validateCatalogPriceFacts({...draft,kind:'recurring'},[{...monthly,interval_count:3}])).toThrow()});
});
