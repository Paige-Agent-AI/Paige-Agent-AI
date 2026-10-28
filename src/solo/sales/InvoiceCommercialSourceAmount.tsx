import type {CollectionAmountBasis} from '../../../supabase/functions/_shared/sales-collections/amount-basis';
import {collectionMoney,currencyDigits} from './collections/presentation';

export type InvoiceCommercialSourceAmountFacts={minor:number|null;currency:string|null;basis:CollectionAmountBasis};
const labels:Record<CollectionAmountBasis,string>={total:'Engagement total',per_cycle:'Amount per billing cycle',per_installment:'Amount per installment',unverified:'Recorded amount'};

/** Original read facts only. Never changes invoice economics or grants execution authority. */
export function InvoiceCommercialSourceAmount({facts,revision,referenceRevision,invoiceTotalMinor,invoiceCurrency}:{facts?:InvoiceCommercialSourceAmountFacts;revision:number;referenceRevision?:number;invoiceTotalMinor?:number;invoiceCurrency:string}){
 const minor=facts?.minor,currency=facts?.currency;
 const amount=typeof minor==='number'&&Number.isSafeInteger(minor)&&minor>=0&&typeof currency==='string'&&currencyDigits(currency)!==null?{minor,currency:currency.toUpperCase()}:null;
 const meaning=facts&&Object.prototype.hasOwnProperty.call(labels,facts.basis)?facts.basis:'unverified';
 const currencyMismatch=amount!==null&&amount.currency!==invoiceCurrency.toUpperCase();
 const totalMismatch=amount!==null&&!currencyMismatch&&meaning==='total'&&Number.isSafeInteger(invoiceTotalMinor)&&amount.minor!==invoiceTotalMinor;
 return <section className="ide-source-amount ide-full" aria-label="Selected commercial source amount">
  <dl><dt>{labels[meaning]}</dt><dd>{amount?collectionMoney(amount.minor,amount.currency):'Amount unavailable'}{amount&&<small>{amount.currency}</small>}</dd></dl>
  <p role="status">Draft reference: revision {referenceRevision??'unavailable'}{referenceRevision!==revision&&<> · Current record: revision {revision}</>}</p>
  {!amount?<p>The original amount or currency is unavailable.</p>:meaning==='unverified'?<p>Amount meaning is unverified. Review the original terms.</p>:meaning==='per_installment'?<p>Review the original payment plan for the full engagement amount.</p>:null}
  {currencyMismatch&&<p className="ide-notice">Source currency: {amount.currency}. This invoice: {invoiceCurrency.toUpperCase()}. Review the selected terms before saving.</p>}
  {totalMismatch&&<p className="ide-notice">Invoice total differs from the engagement total. Review the invoice items or selected terms.</p>}
 </section>;
}
