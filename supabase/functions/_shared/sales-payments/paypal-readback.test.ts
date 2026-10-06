import {describe,it,expect,vi} from 'vitest';
import {readPayPalPayment, type PayPalPaymentReader} from './paypal-readback.ts';
import type {PaymentRequest,ProviderOperation} from './payment-contract.ts';

const request:PaymentRequest={id:'request-fixture',tenant_id:'test-tenant-a',invoice_id:'invoice-fixture',invoice_version:2,issued_snapshot_version:1,client_id:'client-fixture',commercial_package_id:null,amount_minor:50000,currency:'usd',purpose:'deposit',idempotency_key:'operation-fixture'};
const operation:ProviderOperation={id:'operation-fixture',tenant_id:request.tenant_id,request_id:request.id,provider:'paypal',merchant_id:'YXZY75W2GKDQE',merchant_version:1,environment:'test',idempotency_key:'operation-fixture',provider_operation_id:'25M43554V9523650M',state:'provider_accepted',application_fee_minor:0};
const money={currency_code:'USD',value:'500.00'};
const capture=()=>({id:'74L756601X447022Y',status:'COMPLETED',disbursement_mode:'INSTANT',final_capture:true,amount:{...money},invoice_id:request.invoice_id,payee:{merchant_id:operation.merchant_id},supplementary_data:{related_ids:{order_id:operation.provider_operation_id}},seller_receivable_breakdown:{gross_amount:{...money},paypal_fee:{currency_code:'USD',value:'15.00'},net_amount:{currency_code:'USD',value:'485.00'}},create_time:'2026-10-04T10:00:00Z',links:[{rel:'self',method:'GET',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/74L756601X447022Y'}]});
const order=()=>({id:operation.provider_operation_id,intent:'CAPTURE',status:'COMPLETED',purchase_units:[{reference_id:operation.id,custom_id:request.id,invoice_id:request.invoice_id,payee:{merchant_id:operation.merchant_id},amount:{...money},payments:{captures:[{id:'74L756601X447022Y',status:'COMPLETED',amount:{...money},final_capture:true,disbursement_mode:'INSTANT'}]}}]});
const reader=(o:unknown=order(),c:unknown=capture()):PayPalPaymentReader=>({environment:'test',retrieveOrder:vi.fn().mockResolvedValue(o),retrieveCapture:vi.fn().mockResolvedValue(c)});
const now=()=>Date.parse('2026-10-06T10:00:00Z');

describe('PayPal canonical readback (no dispatch or allocation)',()=>{
 it('reads exact merchant/order/capture and returns safe verified gross facts',async()=>{
  const port=reader();const result=await readPayPalPayment(request,operation,port,now);
  expect(result).toEqual({state:'settled',provider_object_id:operation.provider_operation_id,provider_transaction_id:'74L756601X447022Y',provider_settlement_id:'74L756601X447022Y',amount_minor:50000,currency:'usd',provider_received_at:'2026-10-04T10:00:00.000Z'});
  expect(port.retrieveOrder).toHaveBeenCalledWith(operation.provider_operation_id,operation.merchant_id);
  expect(port.retrieveCapture).toHaveBeenCalledWith('74L756601X447022Y',operation.merchant_id);
 });
 it.each(['CREATED','APPROVED','PAYER_ACTION_REQUIRED'])('%s is not settlement',async status=>{
  const o=order();o.status=status;const port=reader(o);expect((await readPayPalPayment(request,operation,port,now)).state).toBe('provider_accepted');expect(port.retrieveCapture).not.toHaveBeenCalled();
 });
 it.each(['PENDING','DECLINED','REFUNDED','PARTIALLY_REFUNDED'])('capture %s never allocates',async status=>{const c=capture();c.status=status;expect((await readPayPalPayment(request,operation,reader(order(),c),now)).state).not.toBe('settled');});
 it.each(['tenant_id','request_id','provider','environment','application_fee_minor'])('refuses changed operation %s before provider read',async key=>{
  const port=reader();const changed={...operation,[key]:key==='application_fee_minor'?1:'foreign'};
  await expect(readPayPalPayment(request,changed as ProviderOperation,port,now)).rejects.toThrow();expect(port.retrieveOrder).not.toHaveBeenCalled();
 });
 it('lost provider object stays unknown without creating or searching another payment',async()=>{const port=reader();expect((await readPayPalPayment(request,{...operation,provider_operation_id:null},port,now)).state).toBe('outcome_unknown');expect(port.retrieveOrder).not.toHaveBeenCalled();});
 it.each(['merchant','amount','currency','reference','invoice','multiple'])('rejects mismatched order %s',async kind=>{
  const o=order();const u=o.purchase_units[0];if(kind==='merchant')u.payee.merchant_id='FOREIGNMERCH1';if(kind==='amount')u.amount.value='501.00';if(kind==='currency')u.amount.currency_code='EUR';if(kind==='reference')u.custom_id='other-request';if(kind==='invoice')u.invoice_id='other-invoice';if(kind==='multiple')o.purchase_units.push({...u});
  const port=reader(o);expect((await readPayPalPayment(request,operation,port,now)).state).toBe('outcome_unknown');expect(port.retrieveCapture).not.toHaveBeenCalled();
 });
 it.each(['merchant','amount','currency','order','invoice','environment','date','fee','conversion','disbursement','missing-disbursement'])('rejects mismatched capture %s',async kind=>{
  const c=capture();if(kind==='conversion')(c.seller_receivable_breakdown as Record<string,unknown>).exchange_rate={};if(kind==='disbursement')c.disbursement_mode='DELAYED';if(kind==='missing-disbursement')delete (c as Partial<typeof c>).disbursement_mode;if(kind==='merchant')c.payee.merchant_id='FOREIGNMERCH1';if(kind==='amount')c.amount.value='501.00';if(kind==='currency')c.amount.currency_code='EUR';if(kind==='order')c.supplementary_data.related_ids.order_id='OTHERORDER';if(kind==='invoice')c.invoice_id='other-invoice';if(kind==='environment')c.links[0].href=c.links[0].href.replace('.sandbox','');if(kind==='date')c.create_time='2030-01-01T00:00:00Z';if(kind==='fee')(c.seller_receivable_breakdown as Record<string,unknown>).platform_fees=[{amount:{currency_code:'USD',value:'1.00'}}];
  expect((await readPayPalPayment(request,operation,reader(order(),c),now)).state).toBe('outcome_unknown');
 });
 it('deferred disbursement is not settled',async()=>{const o=order();o.purchase_units[0].payments.captures[0].disbursement_mode='DELAYED';expect((await readPayPalPayment(request,operation,reader(o),now)).state).toBe('provider_accepted');});
 it('redacts transport errors and never returns raw provider or payer information',async()=>{const port=reader();vi.mocked(port.retrieveCapture).mockRejectedValue(new Error('secret-token raw-error customer@example.test'));const result=await readPayPalPayment(request,operation,port,now);expect(result).toEqual({state:'outcome_unknown',code:'PROVIDER_READBACK_REQUIRED'});});
});
