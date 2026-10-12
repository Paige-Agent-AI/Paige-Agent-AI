import type {PaymentRequest,ProviderOperation} from './payment-contract.ts';
import type {HostedPaymentReadback} from './stripe-hosted.ts';
import type {ProviderEnvironment} from './merchant.ts';

/** Read-only port. The existing provider transport must establish delegated merchant
 * authority and select its fixed environment host before supplying these responses.
 * This module never dispatches, captures, allocates, or resolves credentials. */
export interface PayPalPaymentReader {
 environment:ProviderEnvironment;
 retrieveOrder(id:string,merchantId:string):Promise<unknown>;
 retrieveCapture(id:string,merchantId:string):Promise<unknown>;
}
type Row=Record<string,unknown>;
const row=(v:unknown):Row|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:null;
const uncertain=():HostedPaymentReadback=>({state:'outcome_unknown',code:'PROVIDER_READBACK_REQUIRED'});
// Initial proof supports USD only. Other currency exponents require explicit provider
// capability grounding; never infer two decimal places for an arbitrary currency.
function minor(v:unknown):number|null {
 const m=row(v);if(m?.currency_code!=='USD'||typeof m.value!=='string'||!/^\d{1,8}\.\d{2}$/.test(m.value))return null;
 const [whole,fraction]=m.value.split('.');const n=Number(whole)*100+Number(fraction);
 return Number.isSafeInteger(n)?n:null;
}
export async function readPayPalPayment(request:PaymentRequest,op:ProviderOperation,port:PayPalPaymentReader,now:()=>number=Date.now):Promise<HostedPaymentReadback> {
 if(op.provider!=='paypal'||op.tenant_id!==request.tenant_id||op.request_id!==request.id||
  !/^[A-Z0-9]{13}$/.test(op.merchant_id)||!op.id||!op.idempotency_key||op.application_fee_minor!==0||
  !Number.isSafeInteger(op.merchant_version)||op.merchant_version<1||
  !Number.isSafeInteger(request.amount_minor)||request.amount_minor<=0||request.amount_minor>2147483647||
  !request.invoice_id||!request.client_id||!['test','live'].includes(op.environment)||port.environment!==op.environment)
  throw new Error('PAYMENT_OPERATION_SCOPE_MISMATCH');
 if(request.currency!=='usd'||!op.provider_operation_id||! /^[A-Z0-9]{1,36}$/.test(op.provider_operation_id))return uncertain();
 try {
  const order=row(await port.retrieveOrder(op.provider_operation_id,op.merchant_id));
  const units=order?.purchase_units;
  if(order?.id!==op.provider_operation_id||order.intent!=='CAPTURE'||!Array.isArray(units)||units.length!==1)return uncertain();
  const unit=row(units[0]);
  if(!unit||unit.reference_id!==op.id||unit.custom_id!==request.id||unit.invoice_id!==request.invoice_id||
   row(unit.payee)?.merchant_id!==op.merchant_id||minor(unit.amount)!==request.amount_minor)return uncertain();
  const base={provider_object_id:op.provider_operation_id};
  if(['CREATED','APPROVED','PAYER_ACTION_REQUIRED'].includes(String(order.status)))return {state:'provider_accepted',...base};
  if(order.status!=='COMPLETED')return uncertain();
  const captures=row(unit.payments)?.captures;
  if(!Array.isArray(captures)||captures.length!==1)return uncertain();
  const embedded=row(captures[0]);
  if(!embedded||typeof embedded.id!=='string'||! /^[A-Z0-9]{1,36}$/.test(embedded.id)||
   minor(embedded.amount)!==request.amount_minor||embedded.final_capture!==true)return uncertain();
  if(embedded.status!=='COMPLETED'||embedded.disbursement_mode==='DELAYED')return {state:'provider_accepted',...base};
  if(embedded.disbursement_mode!=='INSTANT')return uncertain();
  const capture=row(await port.retrieveCapture(embedded.id,op.merchant_id));
  if(!capture||capture.id!==embedded.id||capture.final_capture!==true||minor(capture.amount)!==request.amount_minor||
   capture.invoice_id!==request.invoice_id||row(capture.payee)?.merchant_id!==op.merchant_id||
   row(row(capture.supplementary_data)?.related_ids)?.order_id!==op.provider_operation_id)return uncertain();
  if(capture.status==='PENDING')return {state:'provider_accepted',...base};
  if(capture.status!=='COMPLETED'||capture.disbursement_mode!=='INSTANT')return uncertain();
  const breakdown=row(capture.seller_receivable_breakdown);
  const fee=minor(breakdown?.paypal_fee),net=minor(breakdown?.net_amount);
  if(!breakdown||minor(breakdown.gross_amount)!==request.amount_minor||fee===null||net===null||
   fee+net!==request.amount_minor||(['platform_fees','exchange_rate','receivable_amount','receivable_amount_in_receivable_currency','paypal_fee_in_receivable_currency','net_amount_in_receivable_currency'].some(key=>key in breakdown)))return uncertain();
  const host=op.environment==='test'?'api-m.sandbox.paypal.com':'api-m.paypal.com';
  const expected=`https://${host}/v2/payments/captures/${embedded.id}`;
  if(!Array.isArray(capture.links)||!capture.links.some(v=>{const l=row(v);return l?.rel==='self'&&l.method==='GET'&&l.href===expected;}))return uncertain();
  const received=typeof capture.create_time==='string'?Date.parse(capture.create_time):NaN;
  if(!Number.isFinite(received)||received<=0||received>now())return uncertain();
  // Completed, instantly disbursed merchant capture, not a bank payout. Allocation
  // remains exclusively the canonical settlement writer's responsibility.
  return {state:'settled',...base,provider_transaction_id:embedded.id,provider_settlement_id:embedded.id,
   amount_minor:request.amount_minor,currency:request.currency,provider_received_at:new Date(received).toISOString()};
 }catch {return uncertain();}
}
