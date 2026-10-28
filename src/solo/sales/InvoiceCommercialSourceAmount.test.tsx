import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {InvoiceCommercialSourceAmount,type InvoiceCommercialSourceAmountFacts} from './InvoiceCommercialSourceAmount';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(()=>{act(()=>root.unmount());host.remove()});
function show(facts?:InvoiceCommercialSourceAmountFacts,referenceRevision=1){act(()=>root.render(<InvoiceCommercialSourceAmount facts={facts} revision={2} referenceRevision={referenceRevision} invoiceTotalMinor={350000} invoiceCurrency="usd"/>))}

it.each([
 ['total','Engagement total'],['per_cycle','Amount per billing cycle'],['per_installment','Amount per installment'],['unverified','Recorded amount'],
] as const)('keeps original %s amount meaning distinct from the invoice total',(basis,label)=>{
 show({minor:30000,currency:'usd',basis});
 expect(host.querySelector('dt')?.textContent).toBe(label);expect(host.querySelector('dd')?.textContent).toContain('$300.00');
 expect(host.textContent?.includes('Invoice total differs')).toBe(basis==='total');
 if(basis==='unverified')expect(host.textContent).toContain('Amount meaning is unverified');
 if(basis==='per_installment')expect(host.textContent).toContain('original payment plan for the full engagement amount');
 expect(host.textContent).not.toMatch(/signed|paid|approved|effective/i);
});
it('shows the draft revision separately from the current source and updates only on new reference props',()=>{
 show({minor:350000,currency:'usd',basis:'total'});expect(host.textContent).toContain('Draft reference: revision 1');expect(host.textContent).toContain('Current record: revision 2');
 show({minor:350000,currency:'usd',basis:'total'},2);expect(host.textContent).toContain('Draft reference: revision 2');expect(host.textContent).not.toContain('Current record:');
});
it.each([undefined,{minor:null,currency:'usd',basis:'total'},{minor:350000,currency:null,basis:'total'},{minor:350000,currency:'not-currency',basis:'total'}] as const)('does not turn incomplete or unsupported money into zero (%j)',facts=>{
 show(facts);expect(host.textContent).toContain('Amount unavailable');expect(host.textContent).not.toContain('$0.00');expect(host.textContent).not.toContain('Invoice total differs');
});
it('preserves a genuine zero and warns on mismatched whole principal',()=>{show({minor:0,currency:'usd',basis:'total'});expect(host.textContent).toContain('$0.00');expect(host.textContent).toContain('Invoice total differs')});
it('uses canonical currency units and distinguishes source currency without conversion',()=>{
 show({minor:1234,currency:'jpy',basis:'total'});expect(host.querySelector('dd')?.textContent).toContain('1,234');expect(host.querySelector('dd')?.textContent).not.toContain('12.34');
 expect(host.textContent).toContain('Source currency: JPY. This invoice: USD.');expect(host.textContent).not.toContain('Invoice total differs');
});
